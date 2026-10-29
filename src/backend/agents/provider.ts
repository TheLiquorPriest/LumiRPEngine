// The provider adapter (AGENT-LOOP-PLAN §3.2, §8, §12; INC1-SPEC R1): how an agent's call reaches a
// model through Lumiverse's quiet generation, and what comes back.
//
// Tool turns are native. Spindle's messages take content parts (`LlmMessagePartDTO`), so an
// assistant turn goes back as its text and `tool_use` parts and the results as `tool_result` parts,
// which each provider maps to its own (Lumiverse `src/llm/providers/anthropic.ts:627-640`,
// `openai-compatible.ts:373-444`, `google.ts:242-251`). LRE's older convention, the results in a
// plain user message (`TEXT_TURNS`), stays only for a connection that refuses tools: there they are
// offered as text, and the calls the model writes are recovered from its text, as they are from any
// model that writes a call instead of making it. Both are one interface (`ToolTurnEncoding`), so a
// change on the host swaps an encoding, not the loop.
//
// Here too: the effort a call goes with (§8, "Thinking in agent tool loops"); a prompt's order and
// its cache breakpoints (§8, within §16's 4 for Anthropic, the connection's own included); the usage
// request; and the accounts each connection keeps per user: its throttles, and the acceptance runs'
// guard and ceilings (§12), which every call reserves against before it is sent. The runs and the
// connections they guard are kept in `agent-acceptance.json`, which no build from before the agents
// writes, so its settings writes never drop the guard (`SettingsStore` reads the list from here).

import type { AcceptanceConnection, AcceptanceRunView, AcceptanceSpend, AcceptanceState, AgentEffort, AgentSettings, ConnectionThrottle } from "../../shared/agent-settings";
import { acceptanceConnectionsOf, roleCaching } from "../../shared/agent-settings";
import { RUNTIME_TEXT } from "../../shared/agent-prompts";
import type { UserId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { isRecord, safeKey } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import { limitOf } from "../../shared/minds";
import type { PromptTexts } from "../../shared/prompts";
import type { ReasoningChoice } from "../../shared/settings";
import { tokensOf } from "../book";
import type { HostConnectionProfile, HostPort, QuietMessage, QuietPart, QuietResult, QuietThinkingBlock, QuietTool } from "../host";
import { readStoredJson } from "../stored-json";
import { isToolRefusal } from "../steps";
import { renderPrompt } from "../prompts";
import { type CallUsage, parseUsage, promptTokens } from "./usage";

// ---------------------------------------------------------------- stops

/** Why an agent stopped short of an answer. */
export type AgentStopCode =
  | "revisions"
  | "busy"
  | "call_tokens_in"
  | "tokens_in"
  | "tokens_out"
  | "tool_turns"
  | "turn_tokens_in"
  | "turn_tokens_out"
  | "turn_tool_turns"
  | "call_time"
  | "wall_time"
  | "turn_time"
  | "acceptance"
  | "ceiling_in"
  | "ceiling_out"
  | "throttle"
  | "loop"
  | "cancelled"
  | "failed";

/** A budget, a ceiling, the acceptance guard, the loop detector or a cancel stopping an agent, with its code and plain words. */
export class AgentStop extends Error {
  constructor(
    readonly code: AgentStopCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentStop";
  }
}

/** A connection refused a call that offered tools natively: the agent asks again with them as text. */
export class ToolsRefused extends Error {
  constructor(cause: unknown) {
    super(`the connection refused native tools (${cause instanceof Error ? cause.message : String(cause)})`, { cause });
    this.name = "ToolsRefused";
  }
}

// ---------------------------------------------------------------- effort

/**
 * An agent's effort as the host's reasoning choice (§8, §16.8): "set by the model" is `auto`, which
 * the host sends as `{source: "custom", effort: "auto"}`, adding no reasoning parameter of its own;
 * `inherit` sends none, so the connection's binding or the user's setting stands.
 */
export function effortChoice(effort: AgentEffort): ReasoningChoice {
  return effort === "model" ? "auto" : effort;
}

/**
 * The effort one call goes with: while "Thinking in agent tool loops" is off, a call that offers
 * tools, natively or as text, goes with reasoning off, since Lumiverse doesn't yet pass back the
 * thinking blocks a reasoning model must be sent again after a tool call (§2, decided A).
 */
export function callEffort(effort: AgentEffort, offersTools: boolean, thinkingInToolLoops: boolean): ReasoningChoice {
  return offersTools && !thinkingInToolLoops ? "off" : effortChoice(effort);
}

// ---------------------------------------------------------------- tool turns

/** A tool call: its id (the provider's, or one the runtime gave a written call), its tool and arguments. */
export interface AgentCall {
  id: string;
  name: string;
  args: JsonObject;
  /** Google's opaque signature, sent back with the call. */
  thoughtSignature?: string;
}

/** A call's result as it goes back to the model: its text, and whether it is a failure. */
export interface ToolResult {
  call: AgentCall;
  text: string;
  error: boolean;
}

/** A model's answer as the next call sends it back: what it said, as written and without the calls recovered from it, the calls, and its reasoning carriers. */
export interface ModelTurn {
  text: string;
  raw: string;
  calls: readonly AgentCall[];
  reasoning?: string;
  thinkingBlocks?: QuietThinkingBlock[];
  reasoningDetails?: JsonObject[];
}

/** How a round of tool calls goes back to the model: the assistant's turn, then the results. */
export interface ToolTurnEncoding {
  readonly kind: "native" | "text";
  assistant(turn: ModelTurn): QuietMessage;
  results(results: readonly ToolResult[], texts: PromptTexts): QuietMessage;
}

/**
 * Native tool turns: the assistant's text and `tool_use` parts, with its reasoning carriers (a
 * thinking model must be sent them again after a tool call), then a `tool_result` part per call.
 * Each message's `content` renders it as text for logs and tests.
 */
export const NATIVE_TURNS: ToolTurnEncoding = {
  kind: "native",
  assistant(turn) {
    const parts: QuietPart[] = turn.text === "" ? [] : [{ type: "text", text: turn.text }];
    for (const c of turn.calls) parts.push({ type: "tool_use", id: c.id, name: c.name, input: c.args, ...(c.thoughtSignature !== undefined ? { thoughtSignature: c.thoughtSignature } : {}) });
    return {
      role: "assistant",
      content: [turn.text, ...turn.calls.map((c) => `${c.name} ${JSON.stringify(c.args)}`)].filter((s) => s !== "").join("\n"),
      parts,
      ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
      ...(turn.thinkingBlocks ? { thinkingBlocks: turn.thinkingBlocks } : {}),
      ...(turn.reasoningDetails ? { reasoningDetails: turn.reasoningDetails } : {}),
    };
  },
  results(results) {
    return { role: "user", content: results.map((r) => r.text).join("\n\n"), parts: results.map((r): QuietPart => ({ type: "tool_result", toolUseId: r.call.id, content: r.text, ...(r.error ? { isError: true as const } : {}) })) };
  },
};

/**
 * Tool turns as text (LRE's convention before native turns, `host.ts`'s old note): the assistant's
 * text as written, calls and all, then one user message with every result, in the editable wording.
 */
export const TEXT_TURNS: ToolTurnEncoding = {
  kind: "text",
  assistant: (turn) => ({ role: "assistant", content: turn.raw }),
  results(results, texts) {
    const each = results.map((r) => (r.error ? renderPrompt(RUNTIME_TEXT.toolError, texts, { name: r.call.name, error: r.text }) : renderPrompt(RUNTIME_TEXT.toolResult, texts, { name: r.call.name, result: r.text })));
    return { role: "user", content: renderPrompt(RUNTIME_TEXT.toolResults, texts, { results: each.join("\n\n") }) };
  },
};

/** Tools offered as text, for a connection that refuses them natively: how to call one, then each tool. */
export function toolsAsText(tools: readonly QuietTool[], texts: PromptTexts): string {
  const each = tools.map((t) => renderPrompt(RUNTIME_TEXT.toolInText, texts, { name: t.name, description: t.description, parameters: JSON.stringify(t.parameters) }));
  return renderPrompt(RUNTIME_TEXT.toolsInText, texts, { tools: each.join("\n\n") });
}

// ---------------------------------------------------------------- calls written as text

/** A call a model wrote as text instead of making it. */
export interface WrittenCall {
  name: string;
  args: JsonObject;
}

/** A written call's arguments as an object: an object, JSON text of one, or nothing for none; null when they're neither. */
function writtenArgs(v: unknown): JsonObject | null {
  if (v === undefined || v === null) return {};
  if (typeof v !== "string") return isRecord(v) ? (v as JsonObject) : null;
  try {
    const parsed: unknown = JSON.parse(v);
    return isRecord(parsed) ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

/**
 * A JSON value as written calls: one call or a list of them, each naming a tool the agent has, its
 * arguments under any of the names models use; null when it isn't that (a tool's description is
 * no call, so an object that has one isn't read as one).
 */
function callsFromJson(value: unknown, names: ReadonlySet<string>): WrittenCall[] | null {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return null;
  const out: WrittenCall[] = [];
  for (const item of list) {
    if (!isRecord(item) || item.description !== undefined) return null;
    const fn = isRecord(item.function) ? item.function : null;
    const named = [item.name, item.tool, item.tool_name, item.function, fn?.name].find((n): n is string => typeof n === "string");
    if (named === undefined || !names.has(named)) return null;
    const args = writtenArgs(item.arguments ?? item.args ?? item.parameters ?? item.input ?? fn?.arguments);
    if (args === null) return null;
    out.push({ name: named, args });
  }
  return out;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
}

/** A written argument's value: JSON where it parses (a number, a list), else its text. */
function writtenValue(text: string): JsonObject[string] {
  const trimmed = text.trim();
  const parsed = parsedJson(trimmed);
  return parsed === undefined ? trimmed : (parsed as JsonObject[string]);
}

/** DeepSeek's own call tokens, leaked into text: `function<｜tool▁sep｜>name` and a fenced JSON (V3), or `name<｜tool▁sep｜>JSON` (V3.1). */
const DEEPSEEK_CALL = /<｜tool▁call▁begin｜>(?:function<｜tool▁sep｜>)?([^\n<]+?)(?:<｜tool▁sep｜>|\n)\s*(?:```(?:json)?\s*)?([\s\S]*?)\s*(?:```\s*)?<｜tool▁call▁end｜>/g;
/** Hermes and Qwen's form, and the one `toolsAsText` asks for. */
const TAGGED_CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
/** Claude's XML form, with or without its namespace. */
const FUNCTION_CALLS = /<(?:antml:)?function_calls>([\s\S]*?)<\/(?:antml:)?function_calls>/g;
const INVOKE = /<(?:antml:)?invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?invoke>/g;
const PARAMETER = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?parameter>/g;
/** Llama's `<function=name>{…}</function>`. */
const LLAMA_CALL = /<function=([^>\s]+)>\s*([\s\S]*?)\s*<\/function>/g;
/** Mistral's `[TOOL_CALLS]` and a JSON list. */
const MISTRAL_CALLS = /\[TOOL_CALLS\]\s*(\[[\s\S]*\]|\{[\s\S]*\})/g;
const FENCED = /```[A-Za-z_]*[ \t]*\n([\s\S]*?)\n?```/g;
/** What's left of a wrapper once the calls in it are taken out. */
const LEFTOVERS = /<｜tool▁calls▁begin｜>|<｜tool▁calls▁end｜>|<(?:antml:)?function_calls>\s*<\/(?:antml:)?function_calls>/g;

/**
 * The calls a model wrote as text instead of making them (§3.1), in the forms models write them,
 * each naming a tool the agent has; and its text without them. A block that names another tool or
 * doesn't parse stays in the text, and a whole answer that is one JSON call counts only when
 * nothing else did.
 */
export function recoverToolCalls(text: string, names: ReadonlySet<string>): { calls: WrittenCall[]; rest: string } {
  const calls: WrittenCall[] = [];
  let rest = text;
  // Each pattern's blocks that read as calls are taken out of the text, in turn; the rest stay.
  const take = (pattern: RegExp, read: (groups: string[]) => WrittenCall[] | null): void => {
    rest = rest.replace(pattern, (match: string, ...captures: unknown[]) => {
      const found = read(captures.slice(0, -2).map((g) => (typeof g === "string" ? g : "")));
      if (!found) return match;
      calls.push(...found);
      return "";
    });
  };
  const named = (name: string, args: string | undefined): WrittenCall[] | null => {
    const parsed = writtenArgs(args);
    return names.has(name) && parsed ? [{ name, args: parsed }] : null;
  };
  take(DEEPSEEK_CALL, ([name = "", args]) => named(name.trim(), args));
  take(TAGGED_CALL, ([body = ""]) => callsFromJson(parsedJson(body), names));
  take(FUNCTION_CALLS, ([body = ""]) => {
    const invoked = [...body.matchAll(INVOKE)].map(([, name = "", inner = ""]) => ({ name, args: Object.fromEntries([...inner.matchAll(PARAMETER)].map(([, key = "", value = ""]) => [key, writtenValue(value)])) as JsonObject }));
    return invoked.length > 0 && invoked.every((c) => names.has(c.name)) ? invoked : null;
  });
  take(LLAMA_CALL, ([name = "", args]) => named(name, args));
  take(MISTRAL_CALLS, ([body = ""]) => callsFromJson(parsedJson(body), names));
  take(FENCED, ([body = ""]) => callsFromJson(parsedJson(body), names));
  if (calls.length === 0) {
    const whole = callsFromJson(parsedJson(rest), names);
    if (whole) return { calls: whole, rest: "" };
  }
  return { calls, rest: calls.length > 0 ? rest.replace(LEFTOVERS, "").trim() : text };
}

// ---------------------------------------------------------------- a call's prompt

/** The stable start of every call of an agent (§8), in order: the cache key, the shared prefix, the role's system prompt, and its tools when they go as text. */
export interface Opening {
  nonce: string | null;
  prefix: readonly string[];
  system: string;
  tools: string | null;
}

/** A message with a cache breakpoint after its last part (a text message becomes one text part). */
function marked(m: QuietMessage): QuietMessage {
  const parts: QuietPart[] = m.parts ? [...m.parts] : [{ type: "text", text: m.content }];
  const last = parts.at(-1);
  if (last) parts[parts.length - 1] = { ...last, cache: true };
  return { ...m, parts };
}

/**
 * One call's messages (§8): the opening as the system message, then the conversation. With
 * breakpoints to spend, on a provider that takes them: the first after the opening, which every
 * call of the agent shares; the second after the conversation so far, so each round reads the
 * rounds before it from the cache; the third after the shared prefix, which other agents with the
 * same prefix read too. With none, the opening goes as one plain text, as every provider takes it.
 */
export function assemble(opening: Opening, conversation: readonly QuietMessage[], breakpoints: number): QuietMessage[] {
  const head = opening.nonce !== null && opening.nonce !== "" ? [opening.nonce] : [];
  const texts = [...head, ...opening.prefix, opening.system, ...(opening.tools ? [opening.tools] : [])].filter((t) => t !== "");
  if (texts.length === 0) return [...conversation];
  const content = texts.join("\n\n");
  if (breakpoints <= 0) return [{ role: "system", content }, ...conversation];
  const parts = texts.map((text): QuietPart => ({ type: "text", text }));
  const lastPrefix = head.length + opening.prefix.filter((t) => t !== "").length - 1;
  parts[parts.length - 1] = { type: "text", text: texts[texts.length - 1] ?? "", cache: true };
  if (breakpoints >= 3 && lastPrefix >= 0 && lastPrefix < parts.length - 1) parts[lastPrefix] = { type: "text", text: texts[lastPrefix] ?? "", cache: true };
  const out: QuietMessage[] = [{ role: "system", content, parts }, ...conversation];
  if (breakpoints >= 2 && conversation.length > 0) out[out.length - 1] = marked(out[out.length - 1] as QuietMessage);
  return out;
}

/** The breakpoints a connection's own prompt caching puts on every request on it: they count against the provider's limit. */
export function ownBreakpoints(cache: NonNullable<HostConnectionProfile["cache"]>, nativeTools: number): number {
  return (cache.system ? 1 : 0) + (cache.lastMessage ? 1 : 0) + (cache.automatic ? 1 : 0) + (cache.tools ? nativeTools : 0);
}

// ---------------------------------------------------------------- accounts

/** The accounts' clock: now, and a wait the call's signal ends early (tests pass their own). */
export interface AccountsClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const SYSTEM_CLOCK: AccountsClock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    if (signal.aborted) {
      reject(signal.reason);
      return promise;
    }
    const stop = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
    return promise;
  },
};

/**
 * Where each user's acceptance runs are kept (`userStorage/agent-acceptance.json`), and the
 * connections they guard: kept here, not only in the settings file, so a build from before the agents
 * (Increment 0), whose settings writes keep only its own keys, never drops the guard.
 */
export const ACCEPTANCE_PATH = "agent-acceptance.json";

/** A throttle's period: its settings are per minute. */
const MINUTE_MS = 60_000;

interface StoredRun {
  label: string;
  openedAt: number;
  closedAt: number | null;
  spend: Record<string, AcceptanceSpend>;
}

interface UserAccounts {
  run: StoredRun | null;
  last: StoredRun | null;
  /** The connections acceptance runs guard, as this file keeps them; undefined until the settings' list moves here. */
  guard: AcceptanceConnection[] | undefined;
  /** What calls in flight hold, per connection. */
  held: Map<string, { tokensIn: number; tokensOut: number }>;
  /** Each connection's requests in the last minute: when, and their tokens. */
  window: Map<string, { at: number; tokens: number }[]>;
  /** Each connection and model's reported prompt tokens over the estimate, once a call has reported them. */
  calibration: Map<string, number>;
  /** Connections seen refusing native tools since the extension started. */
  refusesTools: Set<string>;
  /** The file's writes, in order. */
  writing: Promise<void>;
}

/** A call's hold on its connection, from `reserve` until `settle`. */
export interface Reservation {
  userId: UserId;
  connection: string;
  model: string;
  /** The prompt as estimated, and as held: times the estimate factor, or the model's own ratio once known. */
  estimate: number;
  tokensIn: number;
  tokensOut: number;
  /** The run it counts in, if one was open. */
  run: StoredRun | null;
  entry: { at: number; tokens: number };
}

const emptySpend = (): AcceptanceSpend => ({ tokensIn: 0, cachedIn: 0, tokensOut: 0, calls: 0, refused: 0, estimated: false });

function spendOf(raw: unknown): AcceptanceSpend | null {
  if (!isRecord(raw)) return null;
  const n = (k: string): number => {
    const v = raw[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  };
  return { tokensIn: n("tokensIn"), cachedIn: n("cachedIn"), tokensOut: n("tokensOut"), calls: n("calls"), refused: n("refused"), estimated: raw.estimated === true };
}

function runOf(raw: unknown): StoredRun | null {
  if (!isRecord(raw) || typeof raw.label !== "string" || typeof raw.openedAt !== "number") return null;
  const spend: Record<string, AcceptanceSpend> = {};
  if (isRecord(raw.spend)) for (const [id, s] of Object.entries(raw.spend)) if (safeKey(id)) spend[id] = spendOf(s) ?? emptySpend();
  return { label: raw.label, openedAt: raw.openedAt, closedAt: typeof raw.closedAt === "number" ? raw.closedAt : null, spend };
}

/**
 * Each user's accounts with their connections (§12): the throttles' last minute, what calls in
 * flight hold, the estimate's calibration per model, connections seen refusing native tools, and
 * the acceptance runs, kept in user storage so a restart keeps what a run has spent.
 *
 * Every call `reserve`s before it is sent and `settle`s after. A connection under Acceptance runs
 * with `only` is refused unless a run is open (and a call whose connection can't be told is
 * refused while any is so marked: it might be one). While a run is open, a call holds its prompt's
 * estimate, times the estimate factor until its model has reported real usage, and its
 * `max_tokens`, and one that would pass its connection's ceiling isn't sent; parallel calls hold
 * theirs side by side. A throttle waits for its minute to have room, and refuses only a call
 * bigger than its whole minute.
 */
export class AgentAccounts {
  private readonly users = new Map<UserId, UserAccounts>();
  private readonly loading = new Map<UserId, Promise<UserAccounts>>();
  private readonly listeners = new Set<(userId: UserId) => void>();

  constructor(
    private readonly host: Pick<HostPort, "storage" | "log">,
    private readonly clock: AccountsClock = SYSTEM_CLOCK,
  ) {}

  /** Hears every change to a user's runs: one opened, closed, held against or spent. */
  onChange(listener: (userId: UserId) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(userId: UserId): void {
    for (const listener of this.listeners) listener(userId);
  }

  private async user(userId: UserId): Promise<UserAccounts> {
    const known = this.users.get(userId);
    if (known) return known;
    const pending = this.loading.get(userId);
    if (pending) return pending;
    const load = (async () => {
      const raw = await readStoredJson(this.host, ACCEPTANCE_PATH, userId, "acceptance runs", (r) => isRecord(r) && r.v === 1);
      const file = isRecord(raw) ? raw : {};
      const u: UserAccounts = { run: runOf(file.run), last: runOf(file.last), guard: Array.isArray(file.connections) ? acceptanceConnectionsOf(file.connections) : undefined, held: new Map(), window: new Map(), calibration: new Map(), refusesTools: new Set(), writing: Promise.resolve() };
      this.users.set(userId, u);
      return u;
    })().finally(() => this.loading.delete(userId));
    this.loading.set(userId, load);
    return load;
  }

  /** Writes the user's file after the writes before it; the promise is this write's, failing when it does, while later writes go on. */
  private save(userId: UserId, u: UserAccounts): Promise<void> {
    const text = JSON.stringify({ v: 1, run: u.run, last: u.last, ...(u.guard !== undefined ? { connections: u.guard } : {}) });
    const write = u.writing.then(async () => {
      await this.host.storage.write(`${ACCEPTANCE_PATH}.tmp`, text, userId);
      await this.host.storage.move(`${ACCEPTANCE_PATH}.tmp`, ACCEPTANCE_PATH, userId);
    });
    u.writing = write.catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] the acceptance runs weren't saved (${error instanceof Error ? error.message : String(error)})`, userId));
    return write;
  }

  /** Waits for the user's last write (tests, and a clean stop). */
  async flushed(userId: UserId): Promise<void> {
    await (this.users.get(userId)?.writing ?? Promise.resolve());
  }

  /** The connections acceptance runs guard, as this file keeps them (`SettingsStore` reads them from here); undefined until a list was kept. */
  async guard(userId: UserId): Promise<AcceptanceConnection[] | undefined> {
    return (await this.user(userId)).guard?.map((c) => ({ ...c }));
  }

  /** Keeps the connections acceptance runs guard, beside the runs, once written; a write that fails leaves the list as it was, and says so. */
  async keepGuard(userId: UserId, connections: readonly AcceptanceConnection[]): Promise<void> {
    const u = await this.user(userId);
    const was = u.guard;
    u.guard = connections.map((c) => ({ ...c }));
    try {
      await this.save(userId, u);
    } catch (error) {
      u.guard = was;
      throw error;
    }
  }

  private view(run: StoredRun, u: UserAccounts, settings: Readonly<AgentSettings>): AcceptanceRunView {
    const guarded = settings.acceptance.connections;
    const ids = [...new Set([...guarded.map((c) => c.id), ...Object.keys(run.spend)])];
    return {
      label: run.label,
      openedAt: run.openedAt,
      closedAt: run.closedAt,
      connections: ids.map((id) => {
        const entry = guarded.find((c) => c.id === id);
        const held = run === u.run ? (u.held.get(id) ?? { tokensIn: 0, tokensOut: 0 }) : { tokensIn: 0, tokensOut: 0 };
        return { id, spent: { ...(run.spend[id] ?? emptySpend()) }, reserved: { ...held }, ceiling: entry ? { only: entry.only, tokensIn: entry.tokensIn, tokensOut: entry.tokensOut } : null };
      }),
    };
  }

  /** The open run and the last one closed, with each guarded connection's ceilings now. */
  async state(userId: UserId, settings: Readonly<AgentSettings>): Promise<AcceptanceState> {
    const u = await this.user(userId);
    return { run: u.run ? this.view(u.run, u, settings) : null, last: u.last ? this.view(u.last, u, settings) : null };
  }

  /** Opens a run under `label`; false when one is open already. */
  async open(userId: UserId, label: string): Promise<boolean> {
    const u = await this.user(userId);
    if (u.run) return false;
    u.run = { label, openedAt: this.clock.now(), closedAt: null, spend: {} };
    void this.save(userId, u);
    this.changed(userId);
    return true;
  }

  /** Closes the open run, which becomes the last one; nothing when none is open. */
  async close(userId: UserId): Promise<void> {
    const u = await this.user(userId);
    if (!u.run) return;
    u.run.closedAt = this.clock.now();
    u.last = u.run;
    u.run = null;
    void this.save(userId, u);
    this.changed(userId);
  }

  /** Whether a connection was seen refusing native tools (this session). */
  async refusesTools(userId: UserId, connection: string): Promise<boolean> {
    return (await this.user(userId)).refusesTools.has(connection);
  }

  async refuseTools(userId: UserId, connection: string, reason: string): Promise<void> {
    const u = await this.user(userId);
    if (u.refusesTools.has(connection)) return;
    u.refusesTools.add(connection);
    this.host.log("info", `[LumiRPEngine] connection ${connection} refused native tools (${reason.slice(0, 200)}); its agents are offered them as text from now on`, userId);
  }

  /** Waits until the connection's throttle has room this minute; refuses a call bigger than the whole minute. */
  private async throttle(u: UserAccounts, connection: string, tokens: number, throttle: ConnectionThrottle | undefined, signal: AbortSignal): Promise<void> {
    if (!throttle) return;
    const requests = limitOf(throttle.requestsPerMinute);
    const perMinute = limitOf(throttle.tokensPerMinute);
    if (tokens > perMinute) throw new AgentStop("throttle", `the call's ${tokens} tokens are more than this connection's throttle lets through in a minute (${perMinute})`);
    for (;;) {
      const now = this.clock.now();
      const recent = (u.window.get(connection) ?? []).filter((e) => e.at > now - MINUTE_MS);
      u.window.set(connection, recent);
      const used = recent.reduce((n, e) => n + e.tokens, 0);
      const oldest = recent[0];
      if (!oldest || (recent.length < requests && used + tokens <= perMinute)) return;
      await this.clock.sleep(oldest.at + MINUTE_MS - now, signal);
    }
  }

  /**
   * Holds a call's tokens on its connection (null: the default connection, which couldn't be told)
   * before it is sent: the acceptance guard, the throttle, then the run's ceilings. A Model Roulette
   * connection sends the call on one of its connections (`targets`), picked by the host at random,
   * so the guard refuses it while any of them is guarded; a connection that couldn't be read (null
   * `targets`) might be one, so while a connection is kept for acceptance runs it is refused too, as
   * the default one is. Throws an `AgentStop` when it may not go.
   */
  async reserve(input: { userId: UserId; connection: string | null; targets?: readonly string[] | null; model: string; tokensIn: number; tokensOut: number; settings: Readonly<AgentSettings>; signal: AbortSignal }): Promise<Reservation> {
    const { userId, settings } = input;
    const u = await this.user(userId);
    const guarded = settings.acceptance.connections;
    if (input.connection === null && guarded.some((c) => c.only)) throw new AgentStop("acceptance", "the call's connection is the default one, which couldn't be read, and a connection is kept for acceptance runs: it might be that one");
    const connection = input.connection ?? "";
    if (input.targets === null && guarded.some((c) => c.only)) throw new AgentStop("acceptance", `connection ${connection} couldn't be read, and a connection is kept for acceptance runs: it might be a Model Roulette that sends the call on that one`);
    const picked = (input.targets ?? []).find((target) => guarded.some((c) => c.id === target));
    if (picked !== undefined) throw new AgentStop("acceptance", `connection ${connection} is a Model Roulette that may send the call on connection ${picked}, which acceptance runs guard: an agent never calls through it while any of its connections is guarded`);
    const entry = guarded.find((c) => c.id === connection);
    if (entry?.only && !u.run) throw new AgentStop("acceptance", `connection ${connection} is kept for acceptance runs, and none is open: open one in Settings → Agents → Acceptance runs`);
    const throttle = settings.throttles.find((t) => t.id === connection);
    await this.throttle(u, connection, input.tokensIn + input.tokensOut, throttle, input.signal);
    const factor = u.calibration.get(`${connection}\u0000${input.model}`) ?? settings.acceptance.estimateFactor;
    const tokensIn = Math.ceil(input.tokensIn * factor);
    const run = u.run;
    if (run && entry) {
      const spent = run.spend[connection] ?? emptySpend();
      const held = u.held.get(connection) ?? { tokensIn: 0, tokensOut: 0 };
      const over = (spentNow: number, heldNow: number, more: number, ceiling: Limit): boolean => spentNow + heldNow + more > limitOf(ceiling);
      const code = over(spent.tokensIn, held.tokensIn, tokensIn, entry.tokensIn) ? "ceiling_in" : over(spent.tokensOut, held.tokensOut, input.tokensOut, entry.tokensOut) ? "ceiling_out" : null;
      if (code) {
        run.spend[connection] = { ...spent, refused: spent.refused + 1 };
        void this.save(userId, u);
        this.changed(userId);
        const side = code === "ceiling_in" ? `${spent.tokensIn + held.tokensIn} of ${String(entry.tokensIn)} prompt tokens are spent or held, and it needs about ${tokensIn}` : `${spent.tokensOut + held.tokensOut} of ${String(entry.tokensOut)} answer tokens are spent or held, and it may write ${input.tokensOut}`;
        throw new AgentStop(code, `the call would pass connection ${connection}'s ceiling for this acceptance run: ${side}`);
      }
    }
    const held = u.held.get(connection) ?? { tokensIn: 0, tokensOut: 0 };
    u.held.set(connection, { tokensIn: held.tokensIn + tokensIn, tokensOut: held.tokensOut + input.tokensOut });
    // Only a throttled connection keeps its minute; settling a call corrects its entry to what it spent.
    const entryAt = { at: this.clock.now(), tokens: input.tokensIn + input.tokensOut };
    if (throttle) u.window.set(connection, [...(u.window.get(connection) ?? []), entryAt]);
    if (run) this.changed(userId);
    return { userId, connection, model: input.model, estimate: input.tokensIn, tokensIn, tokensOut: input.tokensOut, run, entry: entryAt };
  }

  /**
   * Ends a call's hold with what it spent. One that failed after it was sent reported nothing, so
   * its run counts its prompt as held, flagged as an estimate; what it wrote, if anything, is unknown.
   */
  settle(r: Reservation, usage: CallUsage | null): void {
    const u = this.users.get(r.userId);
    if (!u) return;
    const held = u.held.get(r.connection) ?? { tokensIn: 0, tokensOut: 0 };
    u.held.set(r.connection, { tokensIn: Math.max(0, held.tokensIn - r.tokensIn), tokensOut: Math.max(0, held.tokensOut - r.tokensOut) });
    if (usage) {
      r.entry.tokens = usage.in + usage.out;
      if (!usage.estimated.includes("in") && r.estimate > 0) u.calibration.set(`${r.connection}\u0000${r.model}`, usage.in / r.estimate);
    }
    if (r.run) {
      const s = r.run.spend[r.connection] ?? emptySpend();
      // A run counts tokens in, cached and out; reasoning is inside out, so its estimate flags nothing here.
      r.run.spend[r.connection] = usage
        ? { ...s, tokensIn: s.tokensIn + usage.in, cachedIn: s.cachedIn + usage.cachedIn, tokensOut: s.tokensOut + usage.out, calls: s.calls + 1, estimated: s.estimated || usage.estimated.some((field) => field !== "reasoningOut") }
        : { ...s, tokensIn: s.tokensIn + r.tokensIn, calls: s.calls + 1, estimated: true };
      void this.save(r.userId, u);
      this.changed(r.userId);
    }
  }
}

// ---------------------------------------------------------------- one agent's calls

/** What a session needs: the host's model calls and connections, the user, their settings and texts, and their accounts. */
export interface ProviderDeps {
  host: Pick<HostPort, "models" | "connections">;
  userId: UserId;
  settings: Readonly<AgentSettings>;
  texts: PromptTexts;
  accounts: AgentAccounts;
}

/** What of an agent's spec its calls are made from. */
export interface CallSpec {
  role: string;
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  system: string;
  prefix: readonly string[];
}

/** One call, assembled and estimated, ready for the budgets to check and then to send. */
export interface PreparedCall {
  messages: QuietMessage[];
  /** The tools offered natively (none when they go as text). */
  tools: QuietTool[];
  /** The agent's tools by name, natively or as text: what a written call may name. */
  names: ReadonlySet<string>;
  /** The tools go as text: the connection refuses them natively. */
  textTools: boolean;
  /** The prompt's tokens, as estimated. */
  estimate: number;
  /** The connection's id (null: the default, which couldn't be read) and the model it answers with. */
  connection: string | null;
  /** A Model Roulette's connections, one of which the host sends the call on (none for any other connection; null when the connection couldn't be read, so they aren't known). */
  targets: readonly string[] | null;
  model: string;
}

/** A model's answer, decoded: what it said, its calls (made, or recovered from its text), its reasoning, and what the call spent. */
export interface ModelReply extends ModelTurn {
  calls: AgentCall[];
  /** The calls were written as text, so their results go back as text. */
  written: boolean;
  usage: CallUsage;
  model: string;
  finishReason: string;
  ms: number;
}

/**
 * An agent's calls (§3.2): its connection read once, each call assembled with its cache key and
 * breakpoints, sent with its effort and a usage request, and decoded. A connection that refuses
 * native tools turns the session to tools as text (`ToolsRefused`), kept for the connection once a
 * call so made works.
 */
export class ProviderSession {
  private profile: HostConnectionProfile | null | undefined;
  /** The agent's tools go as text: its connection refused them natively. */
  textTools = false;
  /** Why the connection refused native tools, until a call with them as text has worked. */
  private refusal: string | null = null;
  private written = 0;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly spec: CallSpec,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The connection as the host reads it, once; null when it can't be read. */
  private async connection(): Promise<HostConnectionProfile | null> {
    if (this.profile === undefined) this.profile = await this.deps.host.connections.profile(this.spec.connectionId, this.deps.userId).catch(() => null);
    return this.profile;
  }

  /** Turns to tools as text after the connection refused them natively. */
  refuseNativeTools(reason: string): void {
    this.textTools = true;
    this.refusal = reason;
  }

  async prepare(conversation: readonly QuietMessage[], tools: readonly QuietTool[]): Promise<PreparedCall> {
    const { settings, texts, accounts, userId } = this.deps;
    const profile = await this.connection();
    const connection = profile?.id ?? this.spec.connectionId;
    if (!this.textTools && connection !== null && tools.length > 0 && (await accounts.refusesTools(userId, connection))) this.textTools = true;
    const native = this.textTools ? [] : [...tools];
    const caching = roleCaching(settings, this.spec.role);
    // Off sends a fresh key on every call, so even a provider's automatic cache never matches (§8).
    const key = caching.on ? caching.nonce : crypto.randomUUID();
    const opening: Opening = { nonce: key === "" ? null : renderPrompt(RUNTIME_TEXT.cacheNonce, texts, { nonce: key }), prefix: this.spec.prefix, system: this.spec.system, tools: this.textTools && tools.length > 0 ? toolsAsText(tools, texts) : null };
    const cache = profile?.cache ?? null;
    const breakpoints = caching.on && cache ? Math.max(0, cache.limit - ownBreakpoints(cache, native.length)) : 0;
    const messages = assemble(opening, conversation, breakpoints);
    return { messages, tools: native, names: new Set(tools.map((t) => t.name)), textTools: this.textTools && tools.length > 0, estimate: promptTokens(messages, native), connection, targets: profile ? profile.targets : null, model: this.spec.model ?? profile?.model ?? "" };
  }

  /**
   * Sends a prepared call: held on its connection first (`AgentAccounts.reserve`, which may refuse
   * it), then made, decoded and settled. A call with native tools whose provider says it takes no
   * tools (`isToolRefusal`) throws `ToolsRefused`; any other failure is the call's own.
   */
  async send(p: PreparedCall, maxTokens: number, signal: AbortSignal): Promise<ModelReply> {
    const { host, userId, settings, accounts } = this.deps;
    const held = await accounts.reserve({ userId, connection: p.connection, targets: p.targets, model: p.model, tokensIn: p.estimate, tokensOut: maxTokens, settings, signal });
    const t0 = this.now();
    let result: QuietResult;
    try {
      result = await host.models.quiet(
        {
          messages: p.messages,
          maxTokens,
          json: false,
          connectionId: this.spec.connectionId,
          model: this.spec.model,
          ...(p.tools.length > 0 ? { tools: p.tools } : {}),
          effort: callEffort(this.spec.effort, p.names.size > 0, settings.thinkingInToolLoops),
          usage: true,
        },
        userId,
        signal,
      );
    } catch (error) {
      accounts.settle(held, null);
      if (!signal.aborted && p.tools.length > 0 && isToolRefusal(error)) throw new ToolsRefused(error);
      throw error;
    }
    const native = (result.toolCalls ?? []).map((c): AgentCall => ({ id: c.callId, name: c.name, args: c.args, ...(c.thoughtSignature !== undefined ? { thoughtSignature: c.thoughtSignature } : {}) }));
    const recovered: { calls: WrittenCall[]; rest: string } = native.length === 0 && p.names.size > 0 ? recoverToolCalls(result.content, p.names) : { calls: [], rest: result.content };
    const calls = native.length > 0 ? native : recovered.calls.map((c): AgentCall => ({ id: `written_${++this.written}`, ...c }));
    const usage = parseUsage(result.usage, this.profile?.provider ?? null, { in: p.estimate, out: tokensOf(`${result.content}${native.map((c) => `${c.name} ${JSON.stringify(c.args)}`).join("")}`), reasoningOut: tokensOf(result.reasoning ?? "") });
    accounts.settle(held, usage);
    if (this.refusal !== null && p.textTools && p.connection !== null) {
      await accounts.refuseTools(userId, p.connection, this.refusal);
      this.refusal = null;
    }
    return {
      text: native.length > 0 ? result.content : recovered.rest,
      raw: result.content,
      calls,
      written: native.length === 0 && calls.length > 0,
      ...(result.reasoning !== undefined ? { reasoning: result.reasoning } : {}),
      ...(result.thinkingBlocks ? { thinkingBlocks: result.thinkingBlocks } : {}),
      ...(result.reasoningDetails ? { reasoningDetails: result.reasoningDetails } : {}),
      usage,
      model: result.model ?? p.model,
      finishReason: result.finishReason,
      ms: this.now() - t0,
    };
  }
}
