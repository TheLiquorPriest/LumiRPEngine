// The main agent (INC2-SPEC C14; AGENT-LOOP-PLAN §7, §10). With Settings → Agents → Pipeline set to
// a main agent, an agent per chat runs each agent turn. The turn is still classic's own flow, step by
// step (the orchestrator's seams), and each model call the flow makes is a request the main agent
// works. The engine keeps C14's order, opening the turn's stages one after another:
//   - first, when the last turn left it to this one, the last reply's memory (`pipeline.memory`);
//   1. the intent;
//   2. the engine's checks: Ask first, the check cards and the intent gate;
//   3. the scene, the minds and the director's decisions, with the intent's judgements, which follow
//      the gates;
//   4. the engine's plan;
//   5. the director's beats;
//   6. the narrator's reply;
//   7. the read, the knowledge and the suggested choices;
//   8. the memory.
// The engine's stages are its marks (`open`): the gates let the turn play, the plan, the read. In
// each stage a role works in, the main agent is sent the stage's requests; it runs the roles it
// wants (`run_role`, with its task for each), revises a run within its role's revision cap (`revise`),
// and hands the engine what it has (`commit`), which ends the stage. A request it didn't run goes on
// without its role; a role out of its stage is refused. A request the flow makes once a stage is
// committed (the judge after a puzzle's answer, the skip after the minds) opens the stage again.
//
// Each stage is one send to an agent started afresh from the main session (`compaction.ts`), with
// this turn's earlier stages after it; the first stage's message is the turn task (`turn-task.ts`),
// and the commit ends the send (`ToolOutcome.end`). Before it, the turn's session is read at its
// parent, rolled back if GM → Workspace asked, else compacted once it passes its tokens. The main
// agent failing (its send ends short of a commit) stops the turn: before the reply, with the
// engine-failed card and its Retry (`Diagnostics.fatal`); after it, the read stops as a cancelled one
// does, which leaves Retry read. There is no fallback to classic. The turn's segment of the session,
// with any compaction or rollback it made, is written at its close (`Orchestrator.closed`).

import { ROLE_IDS, type RoleId } from "../../shared/agent-roles";
import { AGENT_ROLES, MAIN_AGENT_ROLE, mainBudget, roleBudget } from "../../shared/agent-settings";
import { type AgentKnowledge, knowledgeWithin } from "../../shared/agent-tools";
import type { DiagPhase } from "../../shared/diagnostics";
import { STEP_LABEL } from "../../shared/diagnostics";
import type { ChatId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { LedgerEvent } from "../../shared/ledger";
import { MAIN_TEXT, MAIN_TOOLS, type MainRequestKind, type MainRoleStage } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import type { UserSettings } from "../../shared/settings";
import { isWorkspacePath } from "../../shared/stores";
import { nounFor } from "../../shared/words";
import type { Judgement } from "../../engine/adjudication";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import type { DiagAt } from "../diagnostics";
import type { RunMindsResult } from "../minds";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { SkipRun } from "../skip";
import type { ExtractRead, InterpretRead } from "../steps";
import type { TieOdds } from "../turn-steps";
import { screenBrief, type TaskReads } from "./brief";
import { compact, historyOf, isMainMessage, knowledgeOf, lastMainTurn, MAIN_BY, type MainMessage, type MainSession, readSession, rebasedRefs, rolledBack, type SessionLens, sessionTokens, summaryOf } from "./compaction";
import { type AgentHandle, type AgentHistoryMessage, type AgentReply, type AgentSpec, type AgentTool, type AgentTurn, startAgent, type ToolOutcome } from "./runtime";
import { type Rebase, sessionAt } from "./sessions";
import type { ToolReader } from "./tools/read-view";
import { TOOL_DEFINITIONS, toolsFor } from "./tools/registry";
import type { ChatHead } from "./tools/workspace";
import { recordAgentCalls } from "./transcripts";
import type { ChooseTask, DirectorProse, ExtractTask, MemoryTask, ProseTask, RoleResult, RoleRun, SceneOut, TurnBrief } from "./turn-ctx";
import { digestOf, MAIN_PINS, MAIN_PINS_TEXTS, pinnedFiles, tidy, turnTask } from "./turn-task";
import type { StagePhase } from "./turn-writer";
import { emptyUsage } from "./usage";
import { firedTimeout } from "../../shared/timeouts";

/** Where each request is worked: its role, and the stage of the turn it belongs to (a memory asked before the plan is the last turn's). */
const REQUESTS: Readonly<Record<MainRequestKind, { role: RoleId; stage: MainRoleStage }>> = {
  interpret: { role: "intent", stage: "intent" },
  judge: { role: "intent", stage: "prepare" },
  puzzle: { role: "intent", stage: "prepare" },
  scene: { role: "scene", stage: "prepare" },
  minds: { role: "minds", stage: "prepare" },
  decisions: { role: "director", stage: "prepare" },
  skipPlan: { role: "skip", stage: "prepare" },
  skip: { role: "skip", stage: "prepare" },
  prose: { role: "director", stage: "beats" },
  extract: { role: "read", stage: "read" },
  effects: { role: "world", stage: "read" },
  knowledge: { role: "knowledge", stage: "read" },
  offscreen: { role: "director", stage: "read" },
  choices: { role: "director", stage: "read" },
  memory: { role: "memory", stage: "memory" },
};

/** The stages a role works in, in the turn's order. */
const ORDER: readonly MainRoleStage[] = ["memory_before", "intent", "prepare", "beats", "read", "memory"];

/** C14's number of each stage; the memory left to this turn is the last turn's eighth. */
const NUMBER: Readonly<Record<MainRoleStage, number>> = { memory_before: 8, intent: 1, prepare: 3, beats: 5, read: 7, memory: 8 };

/** The Diagnostics phase each stage's records join. */
const DIAG_PHASE: Readonly<Record<MainRoleStage, DiagPhase>> = { memory_before: "memory", intent: "pre", prepare: "pre", beats: "prose", read: "read", memory: "memory" };

/** How wide each knowledge reads; a mind's own knowledge is its character's, which only the GM's takes in. */
const WIDTH: Readonly<Record<AgentKnowledge | "own", number>> = { pov: 0, everyone: 1, gm: 2, own: 2 };

/** The main agent's name as Settings → Agents gives it: the step its failure names on the engine-failed card. */
const MAIN_LABEL = AGENT_ROLES.find((r) => r.id === MAIN_AGENT_ROLE)?.label ?? MAIN_AGENT_ROLE;

/** What a request comes back with: the answer the main agent committed, or none; `failed` when it ran the role and no run answered. */
export type RequestOutcome<O> = { out: O } | { failed: boolean };

/** One run of a request's role, the latest standing. */
interface Run {
  agentId: string;
  result: RoleResult<unknown>;
  task: string;
  revisions: string[];
  promptOnly: boolean;
  /** A line of its brief was kept from the role (`briefFor`). */
  withheld: boolean;
  /** What a decision's run recorded of its choosers' learnings (`ChooseTask.heard`), handed to the turn only once its answer stands, at commit. */
  learned: LedgerEvent[][];
}

/** A model call of the turn's flow, waiting on the main agent. */
interface Request {
  kind: MainRequestKind;
  role: RoleId;
  stage: MainRoleStage;
  task: unknown;
  run: RoleRun<unknown, unknown>;
  signal: AbortSignal;
  /** The id the main agent names its runs by: its first run's, which a revision keeps. */
  handle: string | null;
  current: Run | null;
  round: Round | null;
  done: boolean;
  settle(outcome: RequestOutcome<unknown> | { abandoned: unknown }): void;
}

/** One send of the main agent: a stage's requests, until its commit. */
interface Round {
  stage: MainRoleStage;
  requests: Request[];
  committed: boolean;
  controller: AbortController;
  /** Runs under way, which commit waits for. */
  running: Set<Promise<unknown>>;
}

/** What a main-agent turn runs with, from its orchestrator's run. */
export interface MainHost {
  readonly rt: Runtime;
  readonly chatId: ChatId;
  readonly userId: UserId;
  /** The user's settings as the turn read them. */
  readonly settings: UserSettings;
  readonly turn: AgentTurn;
  /** Ends when the turn's run ends: Cancel, a failure, a newer run, or its close. */
  readonly stop: AbortSignal;
  /** Holds the blobs the turn makes until its record carries them, or it is dropped. */
  readonly holder: string;
  /** The turn's Diagnostics place, which a generation taking the prepared turn moves. */
  at(): DiagAt;
  phase(): StagePhase;
  head(): ChatHead | null;
  reader(knowledge: AgentKnowledge): ToolReader;
  /** Runs `role` once on `task`, as the orchestrator runs a role (C9, C10), with what the main agent told it; its settings' onFail never applies. */
  run(input: { role: RoleId; run: RoleRun<unknown, unknown>; task: unknown; signal: AbortSignal; brief: TurnBrief; promptOnly: boolean }): Promise<{ agentId: string; result: RoleResult<unknown> }>;
  /** Drops what a run that no longer stands staged. */
  drop(agentId: string): void;
  /** The action the turn plays once the gates let it, with its parameters, as the bridge holds it. */
  intent(): JsonValue;
}

/** Where a turn starts: the player's words, and the chain before it (up to its target), as its core overlays the records. */
export interface MainStart {
  text: string;
  core: LedgerCore;
  observed: ChainMessage[];
}

export class MainTurn {
  /** Requests not yet answered, in the order the flow made them. */
  private readonly requests: Request[] = [];
  /** The engine's marks: the stages it has reached that open by them. */
  private readonly opened = new Set<MainRoleStage>(["memory_before", "intent"]);
  private round: Round | null = null;
  private waking = false;
  /** Why the main agent failed; from then on every request goes on without its role. */
  private failure: string | null = null;
  private session: MainSession | null = null;
  /** The compaction or rollback the turn made, which its record carries. */
  private rebase: Rebase | null = null;
  private summarized = false;
  /** The turn task with its pinned files, and as the session keeps it, without them (they are sent afresh each turn). */
  private task = "";
  private keptTask = "";
  /** What this turn's stages were sent and did: as the agent read them, and as its session keeps them. */
  private readonly sent: AgentHistoryMessage[] = [];
  private readonly kept: MainMessage[] = [];
  private replyShown = false;

  constructor(
    private readonly host: MainHost,
    private readonly start: MainStart,
  ) {
    // A turn's run ending lets go of every request still waiting, as a classic call stops with its signal.
    host.stop.addEventListener("abort", () => {
      for (const r of [...this.requests]) r.settle({ abandoned: host.stop.reason ?? new Error("the turn's run ended") });
    }, { once: true });
  }

  private get texts(): PromptTexts {
    return this.host.settings.prompts.texts;
  }

  private text(id: string, vars: Readonly<Record<string, string>> = {}): string {
    return renderPrompt(id, this.texts, vars);
  }

  // ---------------------------------------------------------------- the flow's side

  /**
   * A model call of the flow, at its seam: the main agent works it in its stage, and the flow gets the
   * answer it committed. One made after the main agent failed goes on without its role at once; one
   * whose phase's time ran out (Settings → Timeouts) goes on without it then, as classic's call
   * answers nothing; one the turn's Cancel or its run's end cuts short throws, as classic's would.
   */
  request<T, O>(kind: MainRequestKind, run: RoleRun<T, O>, task: T, signal: AbortSignal): Promise<RequestOutcome<O>> {
    if (this.failure !== null) return Promise.resolve({ failed: true });
    if (signal.aborted) return firedTimeout(signal) ? Promise.resolve({ failed: true }) : Promise.reject(signal.reason);
    const { role } = REQUESTS[kind];
    const stage = kind === "memory" && this.host.phase() === "pre" ? "memory_before" : REQUESTS[kind].stage;
    const { promise, resolve, reject } = Promise.withResolvers<RequestOutcome<O>>();
    const abandon = (): void => r.settle(firedTimeout(signal) ? { failed: true } : { abandoned: signal.reason });
    const r: Request = {
      kind,
      role,
      stage,
      task,
      run: run as RoleRun<unknown, unknown>,
      signal,
      handle: null,
      current: null,
      round: null,
      done: false,
      settle: (outcome) => {
        if (r.done) return;
        r.done = true;
        signal.removeEventListener("abort", abandon);
        const at = this.requests.indexOf(r);
        if (at >= 0) this.requests.splice(at, 1);
        if ("abandoned" in outcome) reject(outcome.abandoned);
        else resolve(outcome as RequestOutcome<O>);
        // A stage whose every request the flow gave up on is over: its agent is stopped.
        const round = r.round;
        if (round && !round.committed && round.requests.every((q) => q.done)) round.controller.abort(signal.aborted ? signal.reason : this.host.stop.reason);
      },
    };
    signal.addEventListener("abort", abandon, { once: true });
    this.requests.push(r);
    this.wake();
    return promise;
  }

  /** The engine reached a stage that opens by its mark: the gates let the turn play, the plan is made, or the reply is in. */
  open(stage: "prepare" | "beats" | "read"): void {
    this.opened.add(stage);
    this.wake();
  }

  /** What of its session the main agent reads this turn (`prepare`). */
  private lens: SessionLens = { knowledge: "gm", message: () => false };

  /** The turn's messages for its session segment, the reply after them when no stage showed it; null when the main agent never worked a stage. */
  segment(reply: string): MainMessage[] | null {
    if (this.kept.length === 0) return null;
    // The reply is the player's to read: it is the player character's knowledge.
    return this.replyShown || reply.trim() === "" ? [...this.kept] : [...this.kept, { role: "user", content: this.text(MAIN_TEXT.engineReply, { reply }), by: MAIN_BY, knowledge: "pov" }];
  }

  /** The compaction or rollback the turn made, for its record; or, when the main agent never read its session, the rollback asked for, made now. */
  async rebased(): Promise<Rebase | null> {
    if (this.session !== null || this.failure !== null) return this.rebase;
    const { core, observed } = this.start;
    return rolledBack(this.host.rt, { chatId: this.host.chatId, userId: this.host.userId, holder: this.host.holder, at: sessionAt(core.chain(observed), core.journal.tombstones) });
  }

  // ---------------------------------------------------------------- the stages

  /** Starts the next stage's send once the requests the flow made together are in. */
  private wake(): void {
    if (this.waking || this.round !== null || this.failure !== null) return;
    this.waking = true;
    setTimeout(() => {
      this.waking = false;
      this.next();
    }, 0);
  }

  /** A stage opens once the engine reached it; the memory after the read once the read's requests are answered. */
  private isOpen(stage: MainRoleStage): boolean {
    if (stage === "memory") return this.opened.has("read") && !this.requests.some((r) => r.stage === "read");
    return this.opened.has(stage);
  }

  private next(): void {
    if (this.round !== null || this.failure !== null || this.host.stop.aborted) return;
    const stage = ORDER.find((s) => this.isOpen(s) && this.requests.some((r) => r.stage === s && r.round === null));
    if (stage === undefined) return;
    void this.play(stage, this.requests.filter((r) => r.stage === stage && r.round === null));
  }

  private async play(stage: MainRoleStage, requests: Request[]): Promise<void> {
    const round: Round = { stage, requests, committed: false, controller: new AbortController(), running: new Set() };
    for (const r of requests) r.round = round;
    this.round = round;
    const signal = AbortSignal.any([this.host.stop, round.controller.signal]);
    try {
      const first = this.session === null;
      if (first) await this.prepare(signal);
      const message = this.stageMessage(stage, requests);
      const sent = first ? `${this.task}\n\n${message}` : message;
      const history = this.history();
      // The session's last message is the engine's: it leads this one.
      const lead = history.at(-1)?.role === "user" ? history.pop()?.text : undefined;
      const agent = startAgent(this.spec(round, history), { host: this.host.rt.host, userId: this.host.userId, settings: this.host.settings.agents, texts: this.texts, accounts: this.host.rt.agentAccounts, turn: this.host.turn });
      const reply = await this.send(agent, lead ? `${lead}\n\n${sent}` : sent, signal, stage);
      if (round.committed) {
        this.keep(first ? `${this.keptTask}\n\n${message}` : message, sent, agent);
        return;
      }
      if (signal.aborted) return;
      this.fail(stage, reply.status === "answered" ? "it ended the stage without committing it" : (reply.reason ?? reply.status));
    } catch (error) {
      if (!signal.aborted) this.fail(stage, error instanceof Error ? error.message : String(error));
    } finally {
      this.round = null;
      this.wake();
    }
  }

  /**
   * The turn's session, before its first stage: read at its parent, as the main agent's knowledge
   * reads it now (`SessionLens`); the rollback GM → Workspace asked for, when this turn's session
   * stands on that compaction; else, once what it reads passes Settings → Agents → Compaction's
   * tokens, compacted. Then the turn task: the digest since its last turn on the chain it reads (the
   * chat so far for a fresh session, or one it reads nothing of) and its pinned files.
   */
  private async prepare(signal: AbortSignal): Promise<void> {
    const { rt, chatId, userId, holder, settings } = this.host;
    const { core, observed } = this.start;
    const main = settings.agents.main;
    const chain = core.chain(observed);
    const refs = sessionAt(chain, core.journal.tombstones);
    // Its own messages made under its knowledge or a narrower one, and of those whose tools read a
    // workspace file, only while the file's readers still take its knowledge in (a moved or deleted
    // file narrows nothing).
    const readers = new Map(this.host.head() ? (await (await this.host.reader("gm").view()).workspace()).map((f) => [f.path, f.readers] as const) : []);
    const reads = (path: unknown): boolean => {
      const r = typeof path === "string" ? readers.get(path) : undefined;
      return r === undefined || knowledgeWithin(r, main.knowledge);
    };
    this.lens = { knowledge: main.knowledge, message: (m) => isMainMessage(m) && knowledgeWithin(knowledgeOf(m), main.knowledge) && (Array.isArray(m.files) ? m.files : []).every(reads) };
    let session = await readSession(rt, userId, refs);
    const own = new Set(session.segments.filter((s) => s.messages.some((m) => this.lens.message(m))).map((s) => s.hash));
    const last = lastMainTurn(chain, core.journal.tombstones, summaryOf(session, this.lens) === null ? { ...refs, base: null } : refs, own);
    const rollback = await rolledBack(rt, { chatId, userId, holder, at: refs });
    if (rollback) {
      this.rebase = rollback;
      session = await readSession(rt, userId, rebasedRefs(rollback));
    } else if (sessionTokens(session, this.lens) > settings.agents.compaction.atTokens) {
      const made = await compact(rt, { userId, holder, session, keep: settings.agents.compaction.keepTurns, texts: this.texts, lens: this.lens, summarize: (system, message) => this.summarizer(system, message, signal) });
      if (made && "rebase" in made) {
        this.rebase = made.rebase;
        session = made.session;
      } else if (made) rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the main session wasn't compacted (${made.failed}); it goes on whole`, userId);
    }
    this.session = session;
    const digest = digestOf({ core, observed, registry: rt.registry, last, fresh: last === null && summaryOf(session, this.lens) === null, tokens: main.digestTokens, texts: this.texts });
    // Its pinned files, read with its knowledge on the turn's head; none while the chat's world isn't loaded.
    const pins = this.host.head() ? await pinnedFiles(await this.host.reader(main.knowledge).view(), { role: MAIN_PINS, tokens: main.pinsTokens, pinned: true, texts: this.texts, framing: MAIN_PINS_TEXTS }) : "";
    this.task = turnTask(this.texts, { message: this.start.text, digest, pins });
    this.keptTask = turnTask(this.texts, { message: this.start.text, digest, pins: "" });
  }

  /** The main agent's history for a stage: its session, then this turn's stages so far. */
  private history(): AgentHistoryMessage[] {
    const out = this.session ? historyOf(this.session, this.texts, this.lens) : [];
    for (const m of this.sent) {
      const last = out.at(-1);
      if (last?.role === m.role) last.text = `${last.text}\n\n${m.text}`;
      else out.push({ ...m });
    }
    return out;
  }

  private spec(round: Round, history: AgentHistoryMessage[]): AgentSpec {
    const { settings } = this.host;
    const main = settings.agents.main;
    const head = this.host.head();
    const vars = { world: head?.world.name ?? "", pov: head ? (head.state.entities[head.world.pov]?.name ?? head.world.pov) : "" };
    return { role: MAIN_AGENT_ROLE, connectionId: main.connectionId, model: main.model, effort: main.effort, system: this.text(MAIN_TEXT.system, vars), prefix: [], tools: this.tools(round), budget: mainBudget(settings.agents), history };
  }

  /** A send of the main agent's, on the activity line while it works, its calls Diagnostics records. */
  private async send(agent: AgentHandle, text: string, signal: AbortSignal, stage: MainRoleStage): Promise<AgentReply> {
    const { rt, chatId, userId } = this.host;
    rt.diag.agentWorking(chatId, userId, agent.id, STEP_LABEL[MAIN_AGENT_ROLE] ?? MAIN_LABEL);
    let reply: AgentReply;
    try {
      reply = await agent.send(text, signal);
    } catch (error) {
      reply = { status: "failed", text: "", code: "failed", reason: error instanceof Error ? error.message : String(error), usage: emptyUsage() };
    } finally {
      rt.diag.agentDone(chatId, userId, agent.id);
    }
    const main = this.host.settings.agents.main;
    await recordAgentCalls(rt.diag, { at: this.host.at(), phase: DIAG_PHASE[stage], role: MAIN_AGENT_ROLE, connection: main.connectionId ?? "active", model: main.model, transcript: agent.transcript() }).catch((error: unknown) => rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the main agent's calls weren't all recorded (${error instanceof Error ? error.message : String(error)})`, userId));
    return reply;
  }

  /** The compaction's call: one send with no tools on the main agent's connection, model and effort. */
  private async summarizer(system: string, message: string, signal: AbortSignal): Promise<AgentReply> {
    const { settings } = this.host;
    const main = settings.agents.main;
    const agent = startAgent({ role: MAIN_AGENT_ROLE, connectionId: main.connectionId, model: main.model, effort: main.effort, system, prefix: [], tools: [], budget: mainBudget(settings.agents) }, { host: this.host.rt.host, userId: this.host.userId, settings: settings.agents, texts: this.texts, accounts: this.host.rt.agentAccounts, turn: this.host.turn });
    return this.send(agent, message, signal, this.round?.stage ?? "intent");
  }

  /**
   * A committed stage joins the turn's messages: what the agent was sent, and what it did, call by
   * call; each with the knowledge it was made under, and the stage's with the workspace files its
   * tools read, so a later turn reads them only as its knowledge and their readers allow then.
   */
  private keep(stored: string, sent: string, agent: AgentHandle): void {
    const t = agent.transcript();
    const args = new Map<string, JsonObject>();
    const did: string[] = [];
    const files = new Set<string>();
    for (const e of t.entries) {
      if (e.kind === "answer") {
        if (e.text.trim() !== "") did.push(e.text.trim());
        for (const c of e.calls) args.set(c.id, c.args);
      } else if (e.kind === "result") {
        did.push(this.text(MAIN_TEXT.historyCall, { tool: e.name, args: JSON.stringify(args.get(e.callId) ?? {}), result: e.text }));
        if (WORKSPACE_TOOLS.has(e.name)) for (const path of [args.get(e.callId)?.path, ...pathsIn(e.text)]) if (isWorkspacePath(path)) files.add(path);
      }
    }
    const done = did.join("\n\n");
    const knowledge = this.host.settings.agents.main.knowledge;
    this.sent.push({ role: "user", text: sent }, { role: "assistant", text: done });
    this.kept.push({ role: "user", content: stored, by: MAIN_BY, knowledge }, { role: "assistant", content: done, by: MAIN_BY, knowledge, ...(files.size > 0 ? { files: [...files] } : {}) });
  }

  /** The main agent failed: the turn stops (see the header), and every request still waiting goes on without its role. */
  private fail(stage: MainRoleStage, reason: string): void {
    if (this.failure !== null) return;
    this.failure = reason;
    const { rt, chatId, userId } = this.host;
    rt.diag.fatal(this.host.at(), DIAG_PHASE[stage], MAIN_LABEL, reason);
    for (const r of [...this.requests]) r.settle({ failed: true });
    if (this.host.phase() === "post") rt.ledger.cancel(chatId, userId);
  }

  // ---------------------------------------------------------------- what a stage says

  private stageMessage(stage: MainRoleStage, requests: readonly Request[]): string {
    const open = requests.map((r) => this.text(MAIN_TEXT.open, { role: r.role, what: this.text(MAIN_TEXT.request(r.kind)) })).join("\n");
    return tidy(this.text(MAIN_TEXT.stage, { number: String(NUMBER[stage]), stage: this.text(MAIN_TEXT.stageLabel(stage)), engine: this.engineNote(stage, requests), open }));
  }

  /** What the engine did since the main agent's last stage, from what this stage's requests carry. */
  private engineNote(stage: MainRoleStage, requests: readonly Request[]): string {
    const none = this.text(MAIN_TEXT.none);
    if (stage === "memory_before") {
      const task = requests.find((r) => r.kind === "memory")?.task as MemoryTask | undefined;
      return task ? this.text(MAIN_TEXT.engineRemember, { reply: task.input.reply }) : "";
    }
    if (stage === "prepare") return this.text(MAIN_TEXT.enginePrepare, { intent: JSON.stringify(this.host.intent()) });
    if (stage === "beats") {
      const task = requests.find((r) => r.kind === "prose")?.task as ProseTask | undefined;
      if (!task) return "";
      // The plan's lines are what the narrator is told: everyone's knowledge, secrets marked.
      const lines = this.reaches("director") ? [...task.lines.outcome, ...task.lines.montage, ...task.lines.beats].join("\n") : "";
      return this.text(MAIN_TEXT.engineBeats, { lines: lines === "" ? none : lines });
    }
    if (stage === "read") {
      const task = requests.find((r) => r.kind === "extract" || r.kind === "choices")?.task as ExtractTask | undefined;
      if (!task) return "";
      this.replyShown = true;
      return this.text(MAIN_TEXT.engineReply, { reply: task.reply });
    }
    return "";
  }

  /** Whether the main agent's knowledge takes in what `role` reads with: only then does it see the role's answers whole. */
  private reaches(role: RoleId): boolean {
    return WIDTH[this.host.settings.agents.main.knowledge] >= WIDTH[this.host.settings.agents.roles[role].knowledge];
  }

  /** A run's answer as the main agent sees it: the answer's shape, and its content as far as its knowledge reaches the role's. */
  private answerOf(r: Request, out: unknown): JsonValue {
    const whole = this.reaches(r.role);
    switch (r.kind) {
      case "interpret": {
        const read = out as InterpretRead | null;
        return read ? { action: read.action, params: read.params } : null;
      }
      case "judge": {
        const j = out as Judgement | null;
        return j ? { rating: j.rating, reason: j.reason } : null;
      }
      case "puzzle":
        return { probability: out as number | null };
      case "decisions":
      case "offscreen": {
        const odds = out as TieOdds | null;
        return odds === null ? null : whole ? odds : { ties: Object.keys(odds).length };
      }
      case "minds":
      case "memory":
        return { events: (out as RunMindsResult).events.length };
      case "skipPlan":
        return { planned: out !== null };
      case "skip": {
        const skip = out as SkipRun | null;
        return skip ? { beats: skip.record.beats.length } : null;
      }
      case "scene": {
        const scene = out as SceneOut;
        return { lore: scene.lore.length, ...(whole ? { notes: scene.notes } : {}) };
      }
      case "prose": {
        const prose = (out as DirectorProse).prose;
        return whole ? { brief: prose.brief, outline: prose.outline } : { outline: prose.outline.length };
      }
      case "extract": {
        const read = out as ExtractRead;
        return whole ? { proposals: read.proposals, where: read.where } : { proposals: read.proposals.map((p) => (typeof p.type === "string" ? p.type : null)) };
      }
      case "effects":
        return { proposals: (out as JsonObject[]).length };
      case "knowledge":
        return { events: (out as RunMindsResult).events.length };
      case "choices":
        // The player's own suggestions, held to what the player character may know.
        return out as string[];
    }
  }

  private ran(r: Request): string {
    const run = r.current;
    if (!run) return "";
    const via = this.text(run.result.via === "prompt_only" ? MAIN_TEXT.viaPromptOnly : MAIN_TEXT.viaAgent);
    const agent = r.handle ?? run.agentId;
    const answer = run.result.ok ? this.text(MAIN_TEXT.ran, { agent, role: r.role, via, answer: JSON.stringify(this.answerOf(r, run.result.out)) }) : this.text(MAIN_TEXT.ranFailed, { agent, role: r.role, via, reason: run.result.reason });
    return run.withheld ? `${answer}\n${this.text(MAIN_TEXT.briefWithheld, { role: r.role })}` : answer;
  }

  /**
   * What a run is told of the main agent's task and revisions (`TurnAgentCtx.brief`): each task of
   * the run the lines its own knowledge reaches (`screenBrief`), whatever the main agent reads with;
   * `withheld` once a line was kept from one.
   */
  private briefFor(task: string, revisions: readonly string[]): TurnBrief & { withheld: boolean } {
    const text = [this.text(MAIN_TEXT.brief, { task }), ...revisions.map((message) => this.text(MAIN_TEXT.briefRevision, { message }))].join("\n\n");
    const brief = {
      withheld: false,
      for: (reads: TaskReads): string => {
        const told = screenBrief(this.host.rt.registry, this.host.head(), text, reads);
        if (told.withheld) brief.withheld = true;
        return told.text;
      },
    };
    return brief;
  }

  // ---------------------------------------------------------------- the tools

  private tools(round: Round): AgentTool[] {
    const { settings } = this.host;
    const main = settings.agents.main;
    const describe = (name: string, arg: string): string => this.text(MAIN_TEXT.toolArg(name, arg));
    const own: AgentTool[] = [
      {
        name: MAIN_TOOLS.runRole,
        description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.runRole)),
        parameters: { type: "object", properties: { role: { type: "string", enum: [...ROLE_IDS], description: describe(MAIN_TOOLS.runRole, "role") }, task: { type: "string", description: describe(MAIN_TOOLS.runRole, "task") }, prompt_only: { type: "boolean", description: describe(MAIN_TOOLS.runRole, "prompt_only") } }, required: ["role", "task"] },
        run: (args) => this.runRole(round, args),
      },
      {
        name: MAIN_TOOLS.revise,
        description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.revise)),
        parameters: { type: "object", properties: { agentId: { type: "string", description: describe(MAIN_TOOLS.revise, "agentId") }, message: { type: "string", description: describe(MAIN_TOOLS.revise, "message") } }, required: ["agentId", "message"] },
        run: (args) => this.revise(round, args),
      },
      { name: MAIN_TOOLS.commit, description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.commit)), parameters: { type: "object", properties: {} }, run: () => this.commit(round) },
      ...(settings.agents.compaction.summarizeTool ? [{ name: MAIN_TOOLS.summarize, description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.summarize)), parameters: { type: "object", properties: {} }, run: () => this.summarize(round) } satisfies AgentTool] : []),
    ];
    const head = this.host.head();
    if (!head || main.families.length === 0) return own;
    // Its tools read only, with its knowledge: it changes nothing itself.
    const reader = this.host.reader(main.knowledge);
    return [...own, ...toolsFor({ world: head.world, tiers: ["read"], families: main.families, texts: this.texts, env: { userId: this.host.userId, chatId: this.host.chatId, knowledge: main.knowledge, reader, writer: null, agent: { role: MAIN_AGENT_ROLE, id: MAIN_AGENT_ROLE }, signal: this.host.stop } })];
  }

  private refuse(id: string, vars: Readonly<Record<string, string>> = {}): ToolOutcome {
    return { text: this.text(id, vars), error: true };
  }

  /** Why `role` can't run in `stage`: its work comes later (out of order), it has none here now, or its stages are over. */
  private notNow(role: RoleId, stage: MainRoleStage): ToolOutcome {
    // The stages the role works in: its requests', a memory's both before this turn and after its reply.
    const stages = ORDER.filter((s) => Object.values(REQUESTS).some((q) => q.role === role && (q.stage === s || (s === "memory_before" && q.stage === "memory"))));
    const later = stages.find((s) => ORDER.indexOf(s) > ORDER.indexOf(stage));
    if (later !== undefined) return this.refuse(MAIN_TEXT.refusedOrder, { role, number: String(NUMBER[later]), stage: this.text(MAIN_TEXT.stageLabel(later)) });
    if (stages.length === 0 || stages.includes(stage)) return this.refuse(MAIN_TEXT.refusedIdle, { role });
    return this.refuse(MAIN_TEXT.refusedOver, { role });
  }

  /** `run_role`: each of the stage's open requests of the role that hasn't answered runs, with the main agent's task. */
  private async runRole(round: Round, args: JsonObject): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const role = typeof args.role === "string" ? args.role : "";
    if (!(ROLE_IDS as readonly string[]).includes(role)) return this.refuse(MAIN_TEXT.refusedRole, { role, roles: ROLE_IDS.join(", ") });
    const open = round.requests.filter((r) => r.role === role && !r.done);
    if (open.length === 0) return this.notNow(role as RoleId, round.stage);
    // A run that answered stands until a revision; one that failed may run again, prompt-only too.
    const due = open.filter((r) => r.current === null || !r.current.result.ok);
    if (due.length === 0) return this.refuse(MAIN_TEXT.refusedRan, { role, agents: open.map((r) => r.handle ?? "").join(", ") });
    const task = typeof args.task === "string" ? args.task : "";
    await Promise.all(due.map((r) => this.attempt(round, r, task, [], args.prompt_only === true)));
    return { text: due.map((r) => this.ran(r)).join("\n") };
  }

  /** `revise`: the run runs again with its task and every revision sent it, within its role's revision cap; its new answer stands for the old. */
  private async revise(round: Round, args: JsonObject): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const agent = typeof args.agentId === "string" ? args.agentId : "";
    const r = round.requests.find((q) => q.handle === agent && !q.done);
    if (!r?.current) return this.refuse(MAIN_TEXT.refusedAgent, { agent, agents: round.requests.flatMap((q) => (q.handle && !q.done ? [q.handle] : [])).join(", ") || this.text(MAIN_TEXT.none) });
    const limit = roleBudget(this.host.settings.agents, r.role).revisions;
    if (r.current.revisions.length >= limit) return this.refuse(MAIN_TEXT.refusedRevisions, { agent, limit: String(limit), revisions: nounFor(limit, "revision", "revisions") });
    await this.attempt(round, r, r.current.task, [...r.current.revisions, typeof args.message === "string" ? args.message : ""], r.current.promptOnly);
    return { text: this.ran(r) };
  }

  /**
   * One run of a request's role; what the run it replaces staged goes, since its answer no longer
   * stands. A decision's run records its choosers' learnings into its own list (`Run.learned`), so a
   * revision or a run again hands the turn only those of the answer that stands.
   */
  private async attempt(round: Round, r: Request, task: string, revisions: string[], promptOnly: boolean): Promise<void> {
    const brief = this.briefFor(task, revisions);
    const learned: LedgerEvent[][] = [];
    const heard = (r.task as Partial<ChooseTask>).heard;
    const own = heard ? { ...(r.task as ChooseTask), heard: { ...heard, learned: (events: LedgerEvent[]) => learned.push(events) } } : r.task;
    const running = this.host.run({ role: r.role, run: r.run, task: own, signal: AbortSignal.any([r.signal, round.controller.signal]), brief, promptOnly });
    round.running.add(running);
    try {
      const { agentId, result } = await running;
      if (r.current) this.host.drop(r.current.agentId);
      r.current = { agentId, result, task, revisions, promptOnly, withheld: brief.withheld, learned };
      r.handle ??= agentId;
    } finally {
      round.running.delete(running);
    }
  }

  /** `commit`: once the runs under way are in, the stage's requests get what answered, the rest go on without their role, and the send ends. */
  private async commit(round: Round): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    await Promise.allSettled([...round.running]);
    round.committed = true;
    const took: string[] = [];
    const without: string[] = [];
    for (const r of round.requests) {
      if (r.done) continue;
      const result = r.current?.result;
      if (result?.ok) took.push(`${r.role} (${r.handle ?? ""})`);
      else without.push(`${r.role} (${this.text(MAIN_TEXT.request(r.kind))})`);
      // The learnings of the decision run that stands reach the turn now, once.
      if (result?.ok) for (const events of r.current?.learned ?? []) (r.task as Partial<ChooseTask>).heard?.learned(events);
      r.settle(result?.ok ? { out: result.out } : { failed: r.current !== null });
    }
    const none = this.text(MAIN_TEXT.none);
    return { text: this.text(MAIN_TEXT.committed, { ran: took.join(", ") || none, skipped: without.join(", ") || none }), end: true };
  }

  /** `summarize`: the session compacts now (once a turn, a second call in the same answer too), all but its latest turns into one summary its later stages read. */
  private async summarize(round: Round): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const session = this.session;
    if (this.summarized || !session) return this.refuse(MAIN_TEXT.summarizeAgain);
    this.summarized = true;
    const { compaction } = this.host.settings.agents;
    const made = await compact(this.host.rt, { userId: this.host.userId, holder: this.host.holder, session, keep: compaction.keepTurns, texts: this.texts, lens: this.lens, summarize: (system, message) => this.summarizer(system, message, round.controller.signal) });
    if (made === null || "failed" in made) this.summarized = false;
    if (made === null) return this.refuse(MAIN_TEXT.summarizeNothing, { turns: String(session.segments.length), keep: String(compaction.keepTurns) });
    if ("failed" in made) return this.refuse(MAIN_TEXT.summarizeFailed, { reason: made.failed });
    this.rebase = made.rebase;
    this.session = made.session;
    return { text: this.text(MAIN_TEXT.summarized, { summary: made.summary, folded: String(made.folded), kept: String(made.kept) }) };
  }
}

/** The main agent's workspace tools, by name: the files their answers read, its stage's message keeps (`MainMessage.files`). */
const WORKSPACE_TOOLS = new Set(TOOL_DEFINITIONS.filter((d) => d.family === "workspace").map((d) => d.name));

/** The paths a workspace tool's answer names, each `"path"` of its JSON, a clipped answer's too. */
function pathsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"path":("(?:[^"\\]|\\.)*")/g)) {
    try {
      const path: unknown = JSON.parse(m[1] ?? "");
      if (typeof path === "string") out.push(path);
    } catch {
      // A path the clip cut off names no file.
    }
  }
  return out;
}
