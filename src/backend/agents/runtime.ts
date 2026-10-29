// The agent runtime (AGENT-LOOP-PLAN §3.1, §10; INC1-SPEC R1): LRE's own agent loop, LumiAgent a
// design reference only (decided, B). An agent starts from its spec (`startAgent`) and is talked to
// through its handle: each `send` gives it a message and runs its loop, calling the model, running
// the tools it calls (as many at once as its budget lets) and sending the results back, until it
// answers or a limit stops it. Every limit is a setting (Settings → Agents, `shared/agent-settings.ts`):
//
// - per call: the prompt's tokens, `max_tokens` (never more than the agent's or the turn's tokens
//   left), its time, and the tools one answer may call;
// - per agent: tokens in and out, rounds of tool calls, time from its first message, and revisions:
//   each message after its first answer counts against them;
// - per turn (`AgentTurn`, shared by a turn's agents): tokens in and out, rounds, time;
// - per connection (`AgentAccounts`): throttles, and the acceptance runs' guard and ceilings.
//
// The loop detector stops an agent the moment it would make the same call with the same arguments
// a setting's number of times in a row. A tool result past a setting's length reaches the model
// clipped, the whole kept in the agent's scratch for the built-in `scratch_read`. Cancel goes
// through the signals the host's calls take: the handle's own, a send's, and each deadline's.

import type { AgentBudget, AgentEffort, AgentSettings, TurnBudget } from "../../shared/agent-settings";
import { RUNTIME_TEXT } from "../../shared/agent-prompts";
import { STOP_TEXT } from "../../shared/agent-failures";
import type { UserId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { jsonEqual } from "../../shared/json-patch";
import { limitOf } from "../../shared/minds";
import type { PromptTexts } from "../../shared/prompts";
import { timerMs } from "../../shared/timeouts";
import { counted, nounFor } from "../../shared/words";
import type { HostPort, QuietMessage, QuietTool } from "../host";
import { renderPrompt } from "../prompts";
import { type AgentAccounts, type AgentCall, AgentStop, type AgentStopCode, type ModelReply, NATIVE_TURNS, type PreparedCall, ProviderSession, TEXT_TURNS, type ToolResult, ToolsRefused } from "./provider";
import { type AgentUsage, addCall, type CallUsage, emptyUsage } from "./usage";

// ---------------------------------------------------------------- the contract

/** What a tool's run gets besides its arguments: a signal that ends when the agent is cancelled or its time runs out, and who called. */
export interface ToolCtx {
  signal: AbortSignal;
  agentId: string;
  role: string;
  callId: string;
}

/**
 * What a tool gives back for the model: its text, and whether that's a failure. `end` ends the send
 * once the round's results are in, answered with this text and no further call (the main agent's
 * commit, which hands its stage to the engine).
 */
export interface ToolOutcome {
  text: string;
  error?: true;
  end?: true;
}

export interface AgentTool {
  name: string;
  description: string;
  /** Its arguments' JSON Schema, hand-written (§3.1). */
  parameters: JsonObject;
  run(args: JsonObject, ctx: ToolCtx): Promise<ToolOutcome>;
}

/**
 * An agent: its role, the connection and model it runs on (null: the user's default connection,
 * the connection's model), its effort, its system prompt, the stable prefix it shares with other
 * agents (§8: sent first, in order), its tools and its budget; and, for one that takes up a
 * conversation (the GM assistant's thread), the messages it starts from.
 */
export interface AgentSpec {
  role: string;
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  system: string;
  prefix: string[];
  tools: AgentTool[];
  budget: AgentBudget;
  /** The conversation so far, oldest first, sent after the opening and before the agent's first message; none counts as a message it was sent. */
  history?: readonly AgentHistoryMessage[];
}

/** A message of a conversation an agent takes up: the user's, or a model's answer. */
export interface AgentHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

/** How a send ended: an answer, a limit or the guard refusing, the loop detector, a cancel, or a failed call. */
export type AgentStatus = "answered" | "refused" | "stopped" | "cancelled" | "failed";

export interface AgentReply {
  status: AgentStatus;
  /** The answer; short of one, what the model last said, if anything. */
  text: string;
  /** Why it isn't an answer, in a code and plain words. */
  code?: AgentStopCode;
  reason?: string;
  /** What this send spent. */
  usage: AgentUsage;
}

/** One step of an agent's work, for Diagnostics (§3.5): a message it was sent, a model's answer, a call its connection refused for its native tools (asked again with them as text), a tool's result, or its stop. */
export type TranscriptEntry =
  | { kind: "message"; text: string; at: number }
  | { kind: "answer"; text: string; reasoning?: string; calls: { id: string; name: string; args: JsonObject }[]; written: boolean; tools: "native" | "text" | "none"; usage: CallUsage; model: string; finishReason: string; ms: number; at: number }
  | { kind: "tools_refused"; reason: string; ms: number; at: number }
  | { kind: "result"; callId: string; name: string; text: string; error: boolean; scratch?: string; ms: number; at: number }
  | { kind: "stop"; status: AgentStatus; code: AgentStopCode; reason: string; at: number };

export interface AgentTranscript {
  id: string;
  role: string;
  system: string;
  prefix: string[];
  /** The conversation it took up (`AgentSpec.history`), before its entries. */
  history: AgentHistoryMessage[];
  entries: TranscriptEntry[];
}

export interface AgentHandle {
  id: string;
  send(text: string, signal?: AbortSignal): Promise<AgentReply>;
  cancel(): void;
  transcript(): AgentTranscript;
  usage(): AgentUsage;
}

/**
 * Hears a turn's agents at work, for the drawer's live trace (AGENT-LOOP-PLAN §9): the agent's id
 * and role, and what it has spent so far, each time it starts on a message and after each of its
 * calls; `null` once it stops working that message. Nothing else: never what it reads or calls.
 */
export type AgentWatch = (agent: { id: string; role: string }, spent: { in: number; out: number } | null) => void;

/** A turn's agents together (§10): their tokens and rounds of tool calls against the turn's budget, and its time from when the turn began; `watch` hears each of them at work. */
export class AgentTurn {
  readonly startedAt: number;
  readonly used = { in: 0, out: 0, toolTurns: 0 };

  constructor(
    readonly budget: TurnBudget,
    now: () => number = () => Date.now(),
    readonly watch: AgentWatch | null = null,
  ) {
    this.startedAt = now();
  }
}

export interface AgentDeps {
  host: Pick<HostPort, "models" | "connections">;
  userId: UserId;
  settings: Readonly<AgentSettings>;
  /** The user's own texts, by id: each of the runtime's texts sent to a model is theirs where they have one. */
  texts: PromptTexts;
  accounts: AgentAccounts;
  /** The turn the agent works in; null outside one (the GM agent chat). */
  turn: AgentTurn | null;
  /** The clock (tests pass their own). */
  now?: () => number;
}

/** The built-in tool that reads the rest of a clipped result; it takes its name over any tool of the spec's. */
export const SCRATCH_READ = "scratch_read";

export function startAgent(spec: AgentSpec, deps: AgentDeps): AgentHandle {
  return new Agent(spec, deps);
}

// ---------------------------------------------------------------- the loop

const STATUS: Readonly<Partial<Record<AgentStopCode, AgentStatus>>> = { cancelled: "cancelled", failed: "failed", loop: "stopped" };

/** A cut at `at` or one before, so it never splits a character: a UTF-16 unit from 0xD800 to 0xDBFF opens a surrogate pair. */
function cutAt(text: string, at: number): number {
  const unit = text.charCodeAt(at - 1);
  return at > 0 && at < text.length && unit >= 0xd800 && unit <= 0xdbff ? at - 1 : at;
}

class Agent implements AgentHandle {
  readonly id = `agent_${crypto.randomUUID().slice(0, 8)}`;
  /** Ends every call and tool run of the agent: `cancel`. */
  private readonly controller = new AbortController();
  private readonly session: ProviderSession;
  private readonly tools = new Map<string, AgentTool>();
  private readonly offered: QuietTool[];
  /** What the model is sent after its opening: the messages, its answers, the results. */
  private readonly conversation: QuietMessage[] = [];
  private readonly entries: TranscriptEntry[] = [];
  private readonly total = emptyUsage();
  /** Whole results that went to the model clipped, by handle. */
  private readonly scratch = new Map<string, string>();
  private readonly now: () => number;
  private startedAt: number | null = null;
  private answered = false;
  private revisions = 0;
  private busy = false;
  /** A tool's result this round that ends the send (`ToolOutcome.end`): its text is the answer. */
  private ending: string | null = null;

  constructor(
    private readonly spec: AgentSpec,
    private readonly deps: AgentDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.session = new ProviderSession(deps, spec, this.now);
    for (const tool of spec.tools) this.tools.set(tool.name, tool);
    for (const m of spec.history ?? []) this.conversation.push({ role: m.role, content: m.text });
    // An agent with tools gets scratch_read, for the results that come back clipped.
    if (this.tools.size > 0) this.tools.set(SCRATCH_READ, this.scratchRead());
    this.offered = [...this.tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  private text(id: string, vars: Readonly<Record<string, string>> = {}): string {
    return renderPrompt(id, this.deps.texts, vars);
  }

  async send(text: string, signal?: AbortSignal): Promise<AgentReply> {
    const used = emptyUsage();
    if (this.controller.signal.aborted) return this.end(used, new AgentStop("cancelled", { id: STOP_TEXT.cancelled }));
    if (this.busy) return this.end(used, new AgentStop("busy", { id: STOP_TEXT.busy }));
    if (this.answered) {
      if (this.revisions >= this.spec.budget.revisions) return this.end(used, new AgentStop("revisions", { id: STOP_TEXT.revisions, vars: { revisions: counted(this.spec.budget.revisions, "revision", "revisions") } }));
      this.revisions += 1;
    }
    this.busy = true;
    this.ending = null;
    this.startedAt ??= this.now();
    this.conversation.push({ role: "user", content: text });
    this.entries.push({ kind: "message", text, at: this.now() });
    try {
      this.watched();
      return await this.loop(used, signal);
    } finally {
      this.busy = false;
      this.deps.turn?.watch?.({ id: this.id, role: this.spec.role }, null);
    }
  }

  /** Tells the turn's watcher what this agent has spent so far, while it works a message. */
  private watched(): void {
    this.deps.turn?.watch?.({ id: this.id, role: this.spec.role }, { in: this.total.in, out: this.total.out });
  }

  cancel(): void {
    this.controller.abort(new AgentStop("cancelled", { id: STOP_TEXT.cancelled }));
  }

  transcript(): AgentTranscript {
    return { id: this.id, role: this.spec.role, system: this.spec.system, prefix: [...this.spec.prefix], history: [...(this.spec.history ?? [])], entries: [...this.entries] };
  }

  usage(): AgentUsage {
    return { ...this.total };
  }

  /** Calls the model and runs the tools it calls until it answers or a limit stops it. */
  private async loop(used: AgentUsage, signal: AbortSignal | undefined): Promise<AgentReply> {
    const { budget } = this.spec;
    const turn = this.deps.turn;
    // The loop detector's run: the last call and how many times in a row it was made, this send.
    const repeat: { call: AgentCall | null; times: number } = { call: null, times: 0 };
    let said = "";
    for (;;) {
      const late = this.timeUp();
      if (late) return this.end(used, late, said);
      const prepared = await this.session.prepare(this.conversation, this.offered);
      const over = this.overBudget(prepared);
      if (over) return this.end(used, over, said);
      const outLeft = Math.min(limitOf(budget.tokensOut) - this.total.out, turn ? limitOf(turn.budget.tokensOut) - turn.used.out : Number.POSITIVE_INFINITY);
      const scope = this.scope(signal, true);
      const sentAt = this.now();
      let reply: ModelReply;
      try {
        reply = await this.session.send(prepared, Math.min(budget.callTokensOut, outLeft), scope.signal);
      } catch (error) {
        if (error instanceof ToolsRefused) {
          // The connection takes no native tools: the same round again, with them as text, the refusal on the record.
          this.entries.push({ kind: "tools_refused", reason: error.message, ms: this.now() - sentAt, at: this.now() });
          this.session.refuseNativeTools(error.message);
          continue;
        }
        return this.end(used, this.why(error, scope.signal), said);
      } finally {
        scope.clear();
      }
      addCall(reply.usage, reply.ms, this.total, used);
      if (turn) {
        turn.used.in += reply.usage.in;
        turn.used.out += reply.usage.out;
      }
      this.watched();
      said = reply.text;
      this.entries.push({ kind: "answer", text: reply.text, ...(reply.reasoning ? { reasoning: reply.reasoning } : {}), calls: reply.calls.map((c) => ({ id: c.id, name: c.name, args: c.args })), written: reply.written, tools: prepared.names.size === 0 ? "none" : prepared.textTools ? "text" : "native", usage: reply.usage, model: reply.model, finishReason: reply.finishReason, ms: reply.ms, at: this.now() });
      if (reply.calls.length === 0) {
        this.answered = true;
        this.conversation.push({ role: "assistant", content: reply.text });
        return { status: "answered", text: reply.text, usage: { ...used } };
      }
      // No round runs once the time it would run in is gone.
      const stop = this.roundStop(reply.calls, repeat) ?? this.timeUp();
      if (stop) {
        // The calls aren't run, so the model's turn goes on record as what it said.
        if (reply.text !== "") this.conversation.push({ role: "assistant", content: reply.text });
        return this.end(used, stop, said);
      }
      this.total.toolTurns += 1;
      used.toolTurns += 1;
      if (turn) turn.used.toolTurns += 1;
      const tools = this.scope(signal, false);
      let results: ToolResult[];
      try {
        results = await this.runCalls(reply.calls, tools.signal);
      } finally {
        tools.clear();
      }
      const encoding = reply.written ? TEXT_TURNS : NATIVE_TURNS;
      this.conversation.push(encoding.assistant(reply), encoding.results(results, this.deps.texts));
      if (tools.signal.aborted) return this.end(used, this.why(tools.signal.reason, tools.signal), said);
      if (this.ending !== null) {
        const text = this.ending;
        this.ending = null;
        this.answered = true;
        return { status: "answered", text, usage: { ...used } };
      }
    }
  }

  /** The agent's or the turn's time, run out before a call. */
  private timeUp(): AgentStop | null {
    const now = this.now();
    if (now - (this.startedAt ?? now) >= limitOf(this.spec.budget.wallMs)) return new AgentStop("wall_time", { id: STOP_TEXT.wallTime });
    const turn = this.deps.turn;
    if (turn && now - turn.startedAt >= limitOf(turn.budget.wallMs)) return new AgentStop("turn_time", { id: STOP_TEXT.turnTime });
    return null;
  }

  /** A call its prompt's estimate, or the tokens already spent, put past a budget. */
  private overBudget(p: PreparedCall): AgentStop | null {
    const { budget } = this.spec;
    const turn = this.deps.turn;
    if (p.estimate > limitOf(budget.callTokensIn)) return new AgentStop("call_tokens_in", { id: STOP_TEXT.callTokensIn, vars: { tokens: counted(p.estimate, "token", "tokens"), limit: String(budget.callTokensIn) } });
    if (this.total.in + p.estimate > limitOf(budget.tokensIn)) return new AgentStop("tokens_in", { id: STOP_TEXT.tokensIn, vars: { limit: String(budget.tokensIn) } });
    if (this.total.out >= limitOf(budget.tokensOut)) return new AgentStop("tokens_out", { id: STOP_TEXT.tokensOut, vars: { tokens: counted(limitOf(budget.tokensOut), "token", "tokens") } });
    if (turn && turn.used.in + p.estimate > limitOf(turn.budget.tokensIn)) return new AgentStop("turn_tokens_in", { id: STOP_TEXT.turnTokensIn, vars: { limit: String(turn.budget.tokensIn) } });
    if (turn && turn.used.out >= limitOf(turn.budget.tokensOut)) return new AgentStop("turn_tokens_out", { id: STOP_TEXT.turnTokensOut, vars: { tokens: counted(limitOf(turn.budget.tokensOut), "token", "tokens") } });
    return null;
  }

  /** Why a round of calls isn't run: the loop detector, or the agent's or the turn's rounds spent. */
  private roundStop(calls: readonly AgentCall[], repeat: { call: AgentCall | null; times: number }): AgentStop | null {
    const { settings, turn } = this.deps;
    for (const call of calls) {
      const same = repeat.call !== null && repeat.call.name === call.name && jsonEqual(repeat.call.args, call.args);
      repeat.times = same ? repeat.times + 1 : 1;
      repeat.call = call;
      if (repeat.times >= settings.loopRepeats) return new AgentStop("loop", { id: STOP_TEXT.loop, vars: { tool: call.name, times: counted(repeat.times, "time", "times") } });
    }
    if (this.total.toolTurns >= limitOf(this.spec.budget.toolTurns)) return new AgentStop("tool_turns", { id: STOP_TEXT.toolTurns, vars: { rounds: counted(limitOf(this.spec.budget.toolTurns), "round", "rounds") } });
    if (turn && turn.used.toolTurns >= limitOf(turn.budget.toolTurns)) return new AgentStop("turn_tool_turns", { id: STOP_TEXT.turnToolTurns, vars: { rounds: counted(limitOf(turn.budget.toolTurns), "round", "rounds") } });
    return null;
  }

  /**
   * The signal a call (`call`) or a round's tool runs go with: ended by `cancel`, by the send's own
   * signal, and by each deadline left: the agent's time, the turn's and, for a call, its own.
   */
  private scope(signal: AbortSignal | undefined, call: boolean): { signal: AbortSignal; clear(): void } {
    const sources: AbortSignal[] = [this.controller.signal, ...(signal ? [signal] : [])];
    const clears: (() => void)[] = [];
    const deadline = (left: number, stop: AgentStop): void => {
      const ms = timerMs(left);
      if (ms === null) return;
      const ends = new AbortController();
      const timer = setTimeout(() => ends.abort(stop), ms);
      clears.push(() => clearTimeout(timer));
      sources.push(ends.signal);
    };
    const now = this.now();
    const turn = this.deps.turn;
    deadline(limitOf(this.spec.budget.wallMs) - (now - (this.startedAt ?? now)), new AgentStop("wall_time", { id: STOP_TEXT.wallTime }));
    if (turn) deadline(limitOf(turn.budget.wallMs) - (now - turn.startedAt), new AgentStop("turn_time", { id: STOP_TEXT.turnTime }));
    if (call) deadline(limitOf(this.spec.budget.callMs), new AgentStop("call_time", { id: STOP_TEXT.callTime }));
    return { signal: AbortSignal.any(sources), clear: () => clears.forEach((clear) => clear()) };
  }

  /** What stopped a call: a refusal or a deadline (as thrown, or as the signal's reason), a cancel, or a failure. */
  private why(error: unknown, signal: AbortSignal): AgentStop {
    if (error instanceof AgentStop) return error;
    if (signal.aborted) return signal.reason instanceof AgentStop ? signal.reason : new AgentStop("cancelled", { id: STOP_TEXT.cancelled });
    return new AgentStop("failed", { id: STOP_TEXT.failed, vars: { error: error instanceof Error ? error.message : String(error) } });
  }

  /** The run stopped: its transcript says why, in the user's words for the stop (`STOP_TEXT`). */
  private end(used: AgentUsage, stop: AgentStop, said = ""): AgentReply {
    const status = STATUS[stop.code] ?? "refused";
    const reason = this.text(stop.text.id, stop.text.vars);
    this.entries.push({ kind: "stop", status, code: stop.code, reason, at: this.now() });
    return { status, text: said, code: stop.code, reason, usage: { ...used } };
  }

  /** A round's calls, as many at once as the budget lets, results in the calls' order. */
  private async runCalls(calls: readonly AgentCall[], signal: AbortSignal): Promise<ToolResult[]> {
    const { budget } = this.spec;
    const results: ToolResult[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < calls.length) {
        const at = next++;
        const call = calls[at];
        if (call) results[at] = await this.runCall(call, at < limitOf(budget.callTools), signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(budget.concurrency, calls.length) }, worker));
    return results;
  }

  /** One call's result: its tool's outcome (a failure as one), or, past Tool calls per answer (`allowed` false), a note that it wasn't run. */
  private async runCall(call: AgentCall, allowed: boolean, signal: AbortSignal): Promise<ToolResult> {
    const t0 = this.now();
    const tool = this.tools.get(call.name);
    let outcome: ToolOutcome;
    if (!allowed) outcome = { text: this.text(RUNTIME_TEXT.tooManyCalls, { limit: String(this.spec.budget.callTools), tools: nounFor(limitOf(this.spec.budget.callTools), "tool", "tools"), name: call.name }), error: true };
    else if (!tool) outcome = { text: this.text(RUNTIME_TEXT.unknownTool, { name: call.name, tools: [...this.tools.keys()].join(", ") }), error: true };
    else {
      try {
        outcome = await tool.run(call.args, { signal, agentId: this.id, role: this.spec.role, callId: call.id });
      } catch (error) {
        outcome = { text: this.text(RUNTIME_TEXT.toolFailed, { name: call.name, error: error instanceof Error ? error.message : String(error) }), error: true };
      }
    }
    const kept = call.name === SCRATCH_READ ? null : this.clip(outcome.text);
    const text = kept?.text ?? outcome.text;
    this.entries.push({ kind: "result", callId: call.id, name: call.name, text, error: outcome.error === true, ...(kept ? { scratch: kept.handle } : {}), ms: this.now() - t0, at: this.now() });
    if (outcome.end && outcome.error !== true) this.ending = outcome.text;
    return { call, text, error: outcome.error === true };
  }

  /** A result past Tool results clipped past: its start for the model, the whole in scratch. */
  private clip(text: string): { text: string; handle: string } | null {
    const max = this.deps.settings.clipChars;
    if (text.length <= max) return null;
    const shown = cutAt(text, max);
    const handle = `s${this.scratch.size + 1}`;
    this.scratch.set(handle, text);
    return { text: `${text.slice(0, shown)}\n${this.text(RUNTIME_TEXT.clipped, { shown: String(shown), total: String(text.length), handle })}`, handle };
  }

  /** The built-in `scratch_read`: the next part of a clipped result, at most Tool results clipped past at a time. */
  private scratchRead(): AgentTool {
    const max = this.deps.settings.clipChars;
    return {
      name: SCRATCH_READ,
      description: this.text(RUNTIME_TEXT.scratchRead),
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: this.text(RUNTIME_TEXT.scratchHandle) },
          offset: { type: "integer", minimum: 0, description: this.text(RUNTIME_TEXT.scratchOffset) },
          length: { type: "integer", minimum: 1, maximum: max, description: this.text(RUNTIME_TEXT.scratchLength, { max: String(max) }) },
        },
        required: ["handle"],
      },
      run: async (args) => {
        const handle = typeof args.handle === "string" ? args.handle : "";
        const whole = this.scratch.get(handle);
        if (whole === undefined) return { text: this.text(RUNTIME_TEXT.scratchMissing, { handle, handles: [...this.scratch.keys()].join(", ") }), error: true };
        // An offset or length that isn't a whole number reads as none: the start, and as much as one read returns.
        const offset = typeof args.offset === "number" && Number.isInteger(args.offset) ? args.offset : 0;
        const asked = typeof args.length === "number" && Number.isInteger(args.length) ? args.length : max;
        const from = Math.min(Math.max(0, offset), whole.length);
        const length = Math.min(Math.max(1, asked), max);
        const to = cutAt(whole, Math.min(whole.length, from + length));
        return { text: this.text(RUNTIME_TEXT.scratchPart, { handle, from: String(from), to: String(to), total: String(whole.length), text: whole.slice(from, to) }) };
      },
    };
  }
}
