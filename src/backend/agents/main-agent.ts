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
//   6. the narrator's reply, which opens with the final review (`review`): the main agent reviews
//      the prompt the narrator gets and may revise it a line at a time;
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
// parent, rolled back if GM → Workspace asked, else compacted once it passes its tokens: with the
// summary the turn before made ahead of it, or one made now (`compaction-memo.ts`); once it is
// settled, the next turn's compaction may start in the background (`ahead`). The session keeps past
// turns as receipts, each message whole beside its receipt, which `past_turn` reads and greps
// (`receipts.ts`, Settings → Agents → Main agent → Session). The main
// agent failing (its send ends short of a commit) stops the turn: before the reply, with the
// engine-failed card and its Retry (`Diagnostics.fatal`); after it, the read stops as a cancelled one
// does, which leaves Retry read. There is no fallback to classic. The final review is a send of its
// own, which never fails the turn: what its failure does is its own setting. Every send of the turn,
// its review's too, is offered the same tools, each refused out of its own send (a role's in the
// review, the review's in a stage), so each call starts as the one before it did and reads the
// prefix the provider cached: the tools lead what its cache keys on. On the fixed pipeline the main
// agent works that review alone (`MainStart.alone`), with no session and the review's tools only.
// The turn's segment of the session, with any compaction or rollback it made, is written at its
// close (`Orchestrator.closed`).

import { ROLE_IDS, type RoleId } from "../../shared/agent-roles";
import { AGENT_ROLES, compactionBudget, compactionRoute, finalReviewBudget, MAIN_AGENT_ROLE, mainBudget, roleBudget, type AgentEffort } from "../../shared/agent-settings";
import { PERSPECTIVE_LABEL, sourceLabel } from "../../shared/agent-context";
import { RUNTIME_TEXT } from "../../shared/agent-prompts";
import { TOOL_FAMILY_LABEL } from "../../shared/agent-tools";
import type { DiagPhase, TurnPhaseName } from "../../shared/diagnostics";
import { STEP_LABEL, TURN_PHASE_LABEL } from "../../shared/diagnostics";
import type { ChatId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { LedgerEvent } from "../../shared/ledger";
import type { LiveDropWhy } from "../../shared/live";
import { MAIN_TEXT, MAIN_TOOLS, type MainRequestKind, type MainRoleStage } from "../../shared/main-agent-prompts";
import { type FinalEdit, type PromptPart, REVIEW_TEXT, type ReviewDraft } from "../../shared/final-review";
import type { PromptTexts } from "../../shared/prompts";
import type { UserSettings } from "../../shared/settings";
import { secretMarkText } from "../../shared/secret-marks";
import { nounFor } from "../../shared/words";
import type { Judgement } from "../../engine/adjudication";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord } from "../../engine/ledger/path";
import { tokensOf } from "../book";
import type { DiagAt } from "../diagnostics";
import { perceivers } from "../knowledge-step";
import type { RunMindsResult } from "../minds";
import { markWording, renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { SkipRun } from "../skip";
import type { ExtractRead, InterpretRead } from "../steps";
import type { TieOdds } from "../turn-steps";
import { compact, type Compacted, type Fold, foldOf, historyOf, isMainMessage, landSummary, lastMainTurn, MAIN_BY, type MainMessage, type MainSession, readSession, rebasedRefs, rolledBack, sessionTokens, summaryOf } from "./compaction";
import { foldKey, type FoldResult } from "./compaction-memo";
import { isReviewTool, receiptOf, reviewCounts, reviewReceipt } from "./receipts";
import { type AgentHandle, type AgentHistoryMessage, type AgentReply, type AgentSpec, type AgentTool, type AgentTurn, startAgent, type ToolOutcome } from "./runtime";
import { type Rebase, recordSessionOf, sessionAt } from "./sessions";
import { type PastTurnsSource, pastTurnTool } from "./tools/past-turns";
import type { ToolReader } from "./tools/read-view";
import { condenseSource } from "./tools/condense";
import { propose } from "./tools/propose";
import { type LoreLoads, toolsFor } from "./tools/registry";
import type { ToolWriter } from "./tools/writer";
import type { ChatHead } from "./tools/workspace";
import { recordAgentCalls } from "./transcripts";
import { systemInstructions, withInstructions } from "./system-files";
import type { LiveRun } from "./live";
import { commitReview, reviewCommitTool, reviewMessage, reviewTools, type ReviewWork } from "./final-review";
import { knowledgeAnswer, recordYield, type RunWrites, runYield } from "./yields";
import type { ChoicesTask, ChooseTask, DirectorProse, ExtractTask, KnowledgeTask, MemoryTask, ProseTask, RoleResult, RoleRun, SceneOut } from "./turn-ctx";
import { digestOf, MAIN_PINS, MAIN_PINS_TEXTS, pinnedFiles, tidy, turnTask } from "./turn-task";
import type { StagePhase } from "./turn-writer";
import { emptyUsage } from "./usage";
import { archiveTools } from "../depth/archive-tools";
import { quoteView } from "../archive-index";
import { archiveViewOf, type ArchiveView } from "../ledger-io";
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
  curate: { role: "curator", stage: "read" },
  effects: { role: "world", stage: "read" },
  knowledge: { role: "knowledge", stage: "read" },
  offscreen: { role: "director", stage: "read" },
  choices: { role: "director", stage: "read" },
  memory: { role: "memory", stage: "memory" },
};

/** The stage a request is worked in: a memory asked before the plan is the last turn's (`memory_before`). */
export function requestStage(kind: MainRequestKind, phase: StagePhase): MainRoleStage {
  return kind === "memory" && phase === "pre" ? "memory_before" : REQUESTS[kind].stage;
}

/** The stages a role works in, in the turn's order. */
const ORDER: readonly MainRoleStage[] = ["memory_before", "intent", "prepare", "beats", "read", "memory"];

/** C14's number of each stage; the memory left to this turn is the last turn's eighth. */
const NUMBER: Readonly<Record<MainRoleStage, number>> = { memory_before: 8, intent: 1, prepare: 3, beats: 5, read: 7, memory: 8 };

/** The Diagnostics phase each stage's records join. */
const DIAG_PHASE: Readonly<Record<MainRoleStage, DiagPhase>> = { memory_before: "memory", intent: "pre", prepare: "pre", beats: "prose", read: "read", memory: "memory" };

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
  /** What a decision's run recorded of its choosers' learnings (`ChooseTask.heard`), handed to the turn only once its answer stands, at commit. */
  learned: LedgerEvent[][];
  /** What it staged that the turn hasn't committed, and the writes it asked for that were refused, as it ended: its answer says them (`runYield`). */
  writes: RunWrites;
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
  /** A run of it is under way. A request runs once at a time: the calls of one answer run together, and two runs of it would stage together, both landing. */
  busy: boolean;
  /** Fresh runs it has had: run_role on it once a run answered, within its role's Fresh runs per request. */
  reruns: number;
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
  /** The turn's live view (GM → Live), which hears what stopped it; null for a run with none. */
  readonly live: LiveRun | null;
  /** The turn's Diagnostics place, which a generation taking the prepared turn moves. */
  at(): DiagAt;
  phase(): StagePhase;
  head(): ChatHead | null;
  /** Reads the turn's head, everything secrets marked, as every turn agent reads it. */
  reader(): ToolReader;
  /** `role`'s writer in the turn's draft, which the main agent's condense stages a note for it through. */
  writer(role: RoleId): ToolWriter;
  /** Where the main agent loads lore into the reply the turn is writing (`lore_load`, DESIGN §4.6). */
  loads: LoreLoads;
  /** Runs `role` once on `task`, as the orchestrator runs a role (C9, C10), with what the main agent told it; its settings' onFail never applies. */
  run(input: { role: RoleId; run: RoleRun<unknown, unknown>; task: unknown; signal: AbortSignal; brief: string; promptOnly: boolean }): Promise<{ agentId: string; result: RoleResult<unknown> }>;
  /** Drops what a run that no longer stands staged: one a revision or a run again replaced, or one its request went on without; `why` is what GM → Live says. */
  drop(agentId: string, why: LiveDropWhy): void;
  /** What a run staged that the turn hasn't committed, and the writes it asked for that were refused. */
  writes(agentId: string): RunWrites;
  /** The action the turn plays once the gates let it, with its parameters, as the bridge holds it. */
  intent(): JsonValue;
}

/**
 * Where a turn starts: the player's words, and the chain before it (up to its target), as its core
 * overlays the records. `alone`: the main agent works only the turn's final review (the fixed
 * pipeline's), with no session of its own, its task's digest the chat so far. `renarrate`: a
 * Re-narrate's turn, which works only its read and memory: it makes no compaction of its own, and
 * adopts one only where its source turn's was made already (`compaction-memo.ts`).
 */
export interface MainStart {
  text: string;
  core: LedgerCore;
  observed: ChainMessage[];
  alone?: true;
  renarrate?: true;
}

/** What the activity line says while a turn waits on its compaction. */
const COMPACTING = `${TURN_PHASE_LABEL.compaction}…`;

/** "Where the last turn's time went" for each stage's sends. */
const STAGE_PHASE: Readonly<Record<MainRoleStage, TurnPhaseName>> = { memory_before: "stage.memory", intent: "stage.intent", prepare: "stage.prepare", beats: "stage.beats", read: "stage.read", memory: "stage.memory" };

/** A compaction's call as a turn would make it now (`MainTurn.foldCall`): the compaction's route, its instructions and its message, and the key that holds them all. */
interface FoldCall {
  key: string;
  route: { connectionId: string | null; model: string | null; effort: AgentEffort };
  system: string;
  message: string;
}

/** The number in the chat of the reply a turn on `chain` (the chain before it) writes, as the digest numbers replies: a reply the host staged empty for it isn't one yet. */
function replyNumber(chain: readonly ChainMessage[]): number {
  let end = chain.length;
  for (let m = chain[end - 1]; m && !m.isUser && (m.swipes[m.swipeId] ?? "").trim() === ""; m = chain[end - 1]) end--;
  return chain.slice(0, end).filter((m) => !m.isUser).length + 1;
}

export class MainTurn {
  /** Requests not yet answered, in the order the flow made them. */
  private readonly requests: Request[] = [];
  /** The engine's marks: the stages it has reached that open by them. */
  private readonly opened = new Set<MainRoleStage>(["memory_before", "intent"]);
  private round: Round | null = null;
  /** The stage's send under way, which the final review waits for: it comes after the turn's other stages. */
  private playing: Promise<void> | null = null;
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
  /** Its system files (AGENTS.md and roles/main.md, the global workspace's then the chat's), read before its first stage and sent after its system prompt in every call of the turn. */
  private instructions = "";
  /** What this turn's stages were sent and did: as the agent read them, and as its session keeps them. */
  private readonly sent: AgentHistoryMessage[] = [];
  private readonly kept: MainMessage[] = [];
  /** The number of the reply this turn writes, which its receipts give for `past_turn` (`replyNumber`). */
  private reply = 0;
  private replyShown = false;
  /** What ran on its own since the main agent's last message (`autoRan`), one line each: its next send leads with them. */
  private readonly auto: string[] = [];
  /** The chat's archive as the turn's own snapshot holds it, made on its first search: the turn already holds the chat's ledger queue, so its reads never go through it. */
  private archive: ArchiveView | null = null;

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
   * Whichever way the flow goes on without its role, nothing its runs staged lands.
   */
  request<T, O>(kind: MainRequestKind, run: RoleRun<T, O>, task: T, signal: AbortSignal): Promise<RequestOutcome<O>> {
    if (this.failure !== null) return Promise.resolve({ failed: true });
    if (signal.aborted) return firedTimeout(signal) ? Promise.resolve({ failed: true }) : Promise.reject(signal.reason);
    const { role } = REQUESTS[kind];
    const stage = requestStage(kind, this.host.phase());
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
      busy: false,
      reruns: 0,
      round: null,
      done: false,
      settle: (outcome) => {
        if (r.done) return;
        r.done = true;
        signal.removeEventListener("abort", abandon);
        const at = this.requests.indexOf(r);
        if (at >= 0) this.requests.splice(at, 1);
        // A request the flow goes on without lands nothing its run staged, as a run that fails lands
        // nothing (a run under way drops its own as it ends: `attempt`); one it takes keeps them for
        // its phase's commit.
        if (!("out" in outcome) && r.current) this.host.drop(r.current.agentId, "unused");
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

  /**
   * A request its stage ran on its own (`main.stages`: auto), as the fixed pipeline runs it: the main
   * agent's next send leads with it and its answer whole, or the turn's session does when none follows.
   */
  autoRan(kind: MainRequestKind, task: unknown, out: { ok: true; out: unknown } | { ok: false }): void {
    const answer = out.ok ? JSON.stringify(this.answerOf({ kind, task }, out.out)) : this.text(MAIN_TEXT.autoFailed);
    this.auto.push(this.text(MAIN_TEXT.autoLine, { role: REQUESTS[kind].role, what: this.text(MAIN_TEXT.request(kind)), answer }));
  }

  /** What ran on its own since the last send, as the next message leads with it, and none from then on; empty when nothing did. */
  private takeAuto(): string {
    if (this.auto.length === 0) return "";
    const note = this.text(MAIN_TEXT.autoRan, { ran: this.auto.join("\n") });
    this.auto.length = 0;
    return note;
  }

  /** The turn's messages for its session segment, what ran on its own since its last send and the reply after them when no stage showed it; null when the main agent never worked a stage. */
  segment(reply: string): MainMessage[] | null {
    if (this.kept.length === 0) return null;
    const tail = [this.takeAuto(), this.replyShown || reply.trim() === "" ? "" : this.text(MAIN_TEXT.engineReply, { reply })].filter((t) => t !== "");
    return tail.length === 0 ? [...this.kept] : [...this.kept, { role: "user", content: tail.join("\n\n"), by: MAIN_BY }];
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
    const playing = this.play(stage, this.requests.filter((r) => r.stage === stage && r.round === null)).finally(() => {
      if (this.playing === playing) this.playing = null;
    });
    this.playing = playing;
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
      const agent = startAgent(this.spec(this.tools(round), history), { host: this.host.rt.host, userId: this.host.userId, settings: this.host.settings.agents, texts: this.texts, accounts: this.host.rt.agentAccounts, turn: this.host.turn, trace: { phase: DIAG_PHASE[stage], stage: `Stage ${NUMBER[stage]}: ${this.text(MAIN_TEXT.stageLabel(stage))}` } });
      const t0 = Date.now();
      const reply = await this.send(agent, lead ? `${lead}\n\n${sent}` : sent, signal, DIAG_PHASE[stage]);
      const calls = agent.transcript().entries.filter((e) => e.kind === "answer").length;
      this.host.rt.diag.phase(this.host.at(), { name: STAGE_PHASE[stage], ms: Date.now() - t0, cause: `${calls} ${calls === 1 ? "call" : "calls"}` });
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
   * The final review (DESIGN §4.6): one send of the main agent once the turn's other stages before
   * the reply are done, with the narrator's prompt part by part (`draft`). In a turn it decides, it
   * opens stage 6 from its session and the turn's stages so far, with the tools every stage has (the
   * review's work there, the stages' refuse), so its first call reads what the last stage's cached;
   * it joins the turn's messages as a stage does. Alone (the fixed pipeline), it is the turn's one
   * send, from the turn task, with the review's tools beside its read tools, and keeps nothing. Its
   * own budget bounds it, and so does `signal` (its time, the turn's Cancel). It ends at commit, or at
   * an answer that calls nothing more; a send that stops short of both fails it, with why, and
   * nothing of the draft stands. It never fails the main agent's turn: what a failure does is the
   * review's own setting.
   */
  async review(draft: ReviewDraft, signal: AbortSignal): Promise<{ ok: true } | { ok: false; reason: string }> {
    while (this.playing) await this.playing;
    if (this.failure !== null) return { ok: false, reason: this.failure };
    const stop = AbortSignal.any([this.host.stop, signal]);
    const alone = this.start.alone === true;
    try {
      const first = this.session === null;
      if (first) await (alone ? this.prepareAlone() : this.prepare(stop));
      const auto = this.takeAuto();
      const reviewing = reviewMessage(this.texts, draft, alone ? REVIEW_TEXT.stageFixed : REVIEW_TEXT.stageMain);
      // What the session keeps before the review's own message: the turn task when it opens the turn, and what ran on its own.
      const before = [first ? this.keptTask : "", auto].filter((t) => t !== "").join("\n\n");
      const message = auto === "" ? reviewing : `${auto}\n\n${reviewing}`;
      const sent = first ? `${this.task}\n\n${message}` : message;
      const history = this.history();
      // The session's last message is the engine's: it leads this one.
      const lead = history.at(-1)?.role === "user" ? history.pop()?.text : undefined;
      // The parts as its message shows them, which its receipt names: its edits change the draft's.
      const shown = draft.parts.map((p) => ({ ...p, lines: [...p.lines] }));
      const work: ReviewWork = { draft, done: { committed: false } };
      const tools = alone ? [...reviewTools(this.texts, work), reviewCommitTool(this.texts, work), ...this.readTools()] : this.tools(work);
      const spec = { ...this.spec(tools, history, alone ? REVIEW_TEXT.system : MAIN_TEXT.system), budget: finalReviewBudget(this.host.settings.agents) };
      const agent = startAgent(spec, { host: this.host.rt.host, userId: this.host.userId, settings: this.host.settings.agents, texts: this.texts, accounts: this.host.rt.agentAccounts, turn: this.host.turn, trace: { phase: "sections", stage: alone ? "The final review" : "Stage 6: the final review" } });
      const reply = await this.send(agent, lead ? `${lead}\n\n${sent}` : sent, stop, "sections");
      if (!work.done.committed && reply.status !== "answered") return { ok: false, reason: firedTimeout(signal)?.message ?? reply.reason ?? reply.status };
      if (!alone) this.keep(first ? `${this.keptTask}\n\n${message}` : message, sent, agent, { before, parts: shown, edits: draft.edits });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: firedTimeout(signal)?.message ?? (error instanceof Error ? error.message : String(error)) };
    }
  }

  /**
   * The turn's session, before its first stage: read at its parent, its own messages as it keeps
   * them; the rollback GM → Workspace asked for, when this turn's session stands on that
   * compaction; else, once its own messages pass Settings → Agents → Compaction's tokens, compacted
   * (`compacted`). Once it is settled, the next turn's compaction may start ahead of it (`ahead`).
   * Then the turn task: the digest since its last turn on the chain (the chat so far for a fresh
   * session) and its pinned files. "Where the last turn's time went" hears each part: the setup,
   * the compaction, the digest.
   */
  private async prepare(signal: AbortSignal): Promise<void> {
    const { rt, chatId, userId, holder, settings } = this.host;
    const { core, observed } = this.start;
    const main = settings.agents.main;
    const at = this.host.at();
    let t0 = Date.now();
    const chain = core.chain(observed);
    this.reply = replyNumber(chain);
    const refs = sessionAt(chain, core.journal.tombstones);
    // Its system files, read once for the turn, so every stage and the compaction send the same.
    this.instructions = await this.systemText();
    let session = await readSession(rt, userId, refs);
    const own = new Set(session.segments.filter((s) => s.messages.some(isMainMessage)).map((s) => s.hash));
    const last = lastMainTurn(chain, core.journal.tombstones, refs, own);
    const rollback = await rolledBack(rt, { chatId, userId, holder, at: refs });
    rt.diag.phase(at, { name: "setup", ms: Date.now() - t0 });
    if (rollback) {
      this.rebase = rollback;
      session = await readSession(rt, userId, rebasedRefs(rollback));
    } else if (sessionTokens(session) > settings.agents.compaction.atTokens) {
      t0 = Date.now();
      const made = await this.compacted(session, signal);
      rt.diag.phase(at, { name: "compaction", ms: Date.now() - t0, cause: made.cause });
      if (made.compacted) {
        this.rebase = made.compacted.rebase;
        session = made.compacted.session;
      }
    }
    this.session = session;
    this.ahead(session);
    t0 = Date.now();
    await this.taskOf(digestOf({ core, observed, registry: rt.registry, last, fresh: last === null && session.summary === null, tokens: main.digestTokens, texts: this.texts }));
    rt.diag.phase(at, { name: "digest", ms: Date.now() - t0 });
  }

  /**
   * The compaction a session past its tokens needs: the summary made ahead, adopted; one under way,
   * joined, the activity line saying what the turn waits on, until the turn is stopped; else made now, before the turn's first
   * stage, as it says too. A Re-narrate makes none: it adopts one made or under way, else its
   * session goes on whole. A summary that can't land (`summaryOf`) leaves the session whole, with
   * why (`unlanded`). What it did, as "Where the last turn's time went" says it (`cause`).
   */
  private async compacted(session: MainSession, signal: AbortSignal): Promise<{ compacted: Compacted | null; cause: string }> {
    const { rt, chatId, userId, holder, settings } = this.host;
    const c = settings.agents.compaction;
    const fold = foldOf(session, { keep: c.keepTurns, limit: c.summaryTokens, texts: this.texts });
    if (!fold) return { compacted: null, cause: "nothing of the main agent's own to fold" };
    const call = this.foldCall(fold);
    const got = this.start.renarrate ? rt.compactions.find(call.key) : rt.compactions.run(call.key, () => this.fold(call, signal, true));
    if (!got) return { compacted: null, cause: "a Re-narrate makes none: the session went on whole" };
    const waiting = got.found === "running" ? `compaction_${call.key.slice(0, 8)}` : null;
    if (waiting) rt.diag.agentWorking(chatId, userId, waiting, COMPACTING);
    let made: FoldResult;
    // One joined runs on the call made ahead's own time: the turn's Stop doesn't wait on it, and a stopped turn lands nothing.
    const stopped = Promise.withResolvers<FoldResult>();
    const stop = (): void => stopped.resolve({ failed: "the turn was stopped" });
    if (got.found === "running") {
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    }
    try {
      made = await (got.found === "running" ? Promise.race([got.result, stopped.promise]) : got.result);
    } finally {
      signal.removeEventListener("abort", stop);
      if (waiting) rt.diag.agentDone(chatId, userId, waiting);
    }
    if ("failed" in made) {
      this.unlanded(made);
      return { compacted: null, cause: made.cut ? `${made.failed}, so the session went on whole` : `it failed (${made.failed}), so the session went on whole` };
    }
    const compacted = await landSummary(rt, { userId, holder, session, keep: c.keepTurns, summary: made.summary, fold });
    return { compacted, cause: got.found === "made" ? "ready" : got.found === "running" ? "joined the summary made ahead" : `blocking: ${Math.round(tokensOf(call.system + call.message) / 1000)}k tokens` };
  }

  /** A compaction whose summary didn't land: the host log says why, and where it was cut off, Diagnostics warns; the session goes on whole, and the next turn tries again. */
  private unlanded(made: { failed: string; cut?: true }): void {
    const { rt, chatId, userId } = this.host;
    rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the main session wasn't compacted (${made.failed}); it goes on whole`, userId);
    if (made.cut) rt.diag.failed(this.host.at(), DIAG_PHASE[this.round?.stage ?? "intent"], "compaction", `the main session wasn't compacted: ${made.failed}. It goes on whole, and the next turn tries again`, "Raise Summary length, or lower the compaction's effort (Settings → Agents → Main agent → Session)");
  }

  /**
   * Summarize ahead of time (Settings → Agents → Main agent → Session): once this turn's session is
   * settled, when the next turn will compact, the fold it needs starts now, in the background, off
   * this turn's path. The next turn reads this session with this turn's own segment after it, which
   * isn't made yet: it compacts once that passes Compact the session past (the mean of the session's
   * turns stands in for this one), and folds the turns before its latest kept ones, all of them this
   * session's. It finds the fold by its key (`compaction-memo.ts`), as a swipe of it does; a fold
   * already made or under way for it isn't made again. Its call is bounded by the engine run's time.
   */
  private ahead(session: MainSession): void {
    const { rt, settings } = this.host;
    const c = settings.agents.compaction;
    if (c.when !== "ahead" || c.keepTurns < 1) return;
    const turns = session.segments.map((s) => sessionTokens({ summary: null, segments: [s] })).filter((n) => n > 0);
    const mean = turns.length === 0 ? 0 : turns.reduce((a, b) => a + b, 0) / turns.length;
    if (sessionTokens(session) + mean <= c.atTokens) return;
    const fold = foldOf({ summary: session.summary, segments: [...session.segments, { hash: "", messages: [] }] }, { keep: c.keepTurns, limit: c.summaryTokens, texts: this.texts });
    if (!fold) return;
    const call = this.foldCall(fold);
    const limit = settings.timeouts.engineRunMs;
    rt.compactions.run(call.key, () => this.fold(call, limit === "none" ? new AbortController().signal : AbortSignal.timeout(limit), false));
  }

  /** A fold's call as it would be made now: the compaction's route and cap, its instructions with this turn's system files, its message, and the key that holds them all (`foldKey`). */
  private foldCall(fold: Fold): FoldCall {
    const agents = this.host.settings.agents;
    const route = compactionRoute(agents);
    const system = withInstructions(fold.system, this.instructions);
    return { key: foldKey({ userId: this.host.userId, route: { ...route, callTokensOut: compactionBudget(agents).callTokensOut }, system, message: fold.message }), route, system, message: fold.message };
  }

  /**
   * A fold's call: one send with no tools on the compaction's route, its answer capped
   * (`compactionBudget`), and what it answered as a summary that may land (`summaryOf`). While the
   * turn waits on it (`blocking`), the activity line says so and the turn's budget counts it; one
   * made ahead is no turn's.
   */
  private async fold(call: FoldCall, signal: AbortSignal, blocking: boolean): Promise<FoldResult> {
    const { rt, userId, settings } = this.host;
    const phase = DIAG_PHASE[this.round?.stage ?? "intent"];
    const agent = startAgent({ role: MAIN_AGENT_ROLE, ...call.route, system: call.system, prefix: [], tools: [], budget: compactionBudget(settings.agents) }, { host: rt.host, userId, settings: settings.agents, texts: this.texts, accounts: rt.agentAccounts, turn: blocking ? this.host.turn : null, trace: { phase, task: "compaction" } });
    const reply = await this.send(agent, call.message, signal, phase, { label: blocking ? COMPACTING : null, route: call.route });
    return summaryOf(reply, this.text(MAIN_TEXT.none));
  }

  /**
   * The turn task when the main agent works only the final review (`MainStart.alone`, the fixed
   * pipeline): no session of its own is read or kept, so its digest is the chat so far, framed as a
   * fresh session, and nothing is compacted or rolled back. Its system files are read first, as a
   * turn's first stage reads them.
   */
  private async prepareAlone(): Promise<void> {
    const { rt, settings } = this.host;
    const { core, observed } = this.start;
    this.instructions = await this.systemText();
    await this.taskOf(digestOf({ core, observed, registry: rt.registry, last: null, fresh: true, tokens: settings.agents.main.digestTokens, texts: this.texts }));
  }

  /** The turn task with `digest`: its pinned files on the turn's head (none while the chat's world isn't loaded), and as the session keeps it, without them. */
  private async taskOf(digest: string): Promise<void> {
    const main = this.host.settings.agents.main;
    const pins = this.host.head() ? await pinnedFiles(await this.host.reader().view(), { role: MAIN_PINS, tokens: main.pinsTokens, pinned: true, texts: this.texts, framing: MAIN_PINS_TEXTS }) : "";
    this.task = turnTask(this.texts, { message: this.start.text, digest, pins });
    this.keptTask = turnTask(this.texts, { message: this.start.text, digest, pins: "" });
  }

  /** AGENTS.md and roles/main.md, the global workspace's then the chat's, as the turn holds them (DESIGN §4.4); none while the chat's world isn't loaded. */
  private async systemText(): Promise<string> {
    if (!this.host.head()) return "";
    return systemInstructions(await this.host.reader().view(), { role: MAIN_AGENT_ROLE, tokens: this.host.settings.agents.systemTokens, texts: this.texts });
  }

  /** The main agent's history for a stage: its session, then this turn's stages so far. */
  private history(): AgentHistoryMessage[] {
    const out = this.session ? historyOf(this.session, this.texts) : [];
    for (const m of this.sent) {
      const last = out.at(-1);
      if (last?.role === m.role) last.text = `${last.text}\n\n${m.text}`;
      else out.push({ ...m });
    }
    return out;
  }

  /** The main agent as it starts each send: on its connection, model and effort, with `tools`, its stage's budget and its system prompt (`systemId`: the main agent's own, or the final review's when it works that alone). */
  private spec(tools: AgentTool[], history: AgentHistoryMessage[], systemId: string = MAIN_TEXT.system): AgentSpec {
    const { settings } = this.host;
    const main = settings.agents.main;
    const head = this.host.head();
    const vars = { world: head?.world.name ?? "", pov: head ? (head.state.entities[head.world.pov]?.name ?? head.world.pov) : "" };
    // The roles' context config leads its stable prefix: the guide it briefs the roles by, the same every send, so the provider caches it.
    return { role: MAIN_AGENT_ROLE, connectionId: main.connectionId, model: main.model, effort: main.effort, system: withInstructions(this.text(systemId, vars), this.instructions), prefix: [this.contextGuidance()], tools, budget: mainBudget(settings.agents), history };
  }

  /** Settings → Agents → Context for every role, as the main agent is told it (`main.context`): what each starts with, what it is never to be given, its pinned files and its tools. */
  private contextGuidance(): string {
    const { agents } = this.host.settings;
    const none = this.text(MAIN_TEXT.none);
    const named = (list: readonly string[]): string => (list.length > 0 ? list.map(sourceLabel).join(", ") : none);
    const roles = ROLE_IDS.map((role) => {
      const c = agents.context.roles[role];
      const families = agents.roles[role].families;
      return this.text(MAIN_TEXT.contextRole, { role, perspective: PERSPECTIVE_LABEL[c.perspective], start: named(c.start), never: named(c.never), pins: c.pins.length > 0 ? c.pins.join(", ") : none, tools: families.length > 0 ? families.map((f) => TOOL_FAMILY_LABEL[f]).join(", ") : none });
    });
    return this.text(MAIN_TEXT.context, { roles: roles.join("\n") });
  }

  /**
   * A send of the main agent's, its calls Diagnostics records on `route` (the main agent's unless
   * the compaction's). The activity line shows it while it works, as `label` says (the main agent's
   * by default; none for a fold made ahead, which no turn waits on).
   */
  private async send(agent: AgentHandle, text: string, signal: AbortSignal, phase: DiagPhase, opts: { label?: string | null; route?: { connectionId: string | null; model: string | null } } = {}): Promise<AgentReply> {
    const { rt, chatId, userId } = this.host;
    const label = opts.label === undefined ? (STEP_LABEL[MAIN_AGENT_ROLE] ?? MAIN_LABEL) : opts.label;
    if (label !== null) rt.diag.agentWorking(chatId, userId, agent.id, label);
    let reply: AgentReply;
    try {
      reply = await agent.send(text, signal);
    } catch (error) {
      reply = { status: "failed", text: "", code: "failed", reason: error instanceof Error ? error.message : String(error), usage: emptyUsage() };
    } finally {
      if (label !== null) rt.diag.agentDone(chatId, userId, agent.id);
    }
    const route = opts.route ?? this.host.settings.agents.main;
    await recordAgentCalls(rt.diag, { at: this.host.at(), phase, role: MAIN_AGENT_ROLE, connection: route.connectionId ?? "active", model: route.model, transcript: agent.transcript() }).catch((error: unknown) => rt.host.log("warn", `[LumiRPEngine] chat ${chatId}: the main agent's calls weren't all recorded (${error instanceof Error ? error.message : String(error)})`, userId));
    return reply;
  }

  /** condense's call: one send with no tools on the main agent's connection, model and effort. */
  private async summarizer(system: string, message: string, signal: AbortSignal): Promise<AgentReply> {
    const { settings } = this.host;
    const main = settings.agents.main;
    const stage = this.round?.stage ?? "intent";
    const agent = startAgent({ role: MAIN_AGENT_ROLE, connectionId: main.connectionId, model: main.model, effort: main.effort, system: withInstructions(system, this.instructions), prefix: [], tools: [], budget: mainBudget(settings.agents) }, { host: this.host.rt.host, userId: this.host.userId, settings: settings.agents, texts: this.texts, accounts: this.host.rt.agentAccounts, turn: this.host.turn, trace: { phase: DIAG_PHASE[stage], task: "condense" } });
    return this.send(agent, message, signal, DIAG_PHASE[stage]);
  }

  /**
   * A committed stage joins the turn's messages: what the agent was sent, and what it did, call by
   * call. Its later stages read them whole (`sent`); its session keeps them (`kept`) as Settings →
   * Agents → Main agent → Session says: whole, or as receipts (`receipts.ts`), each message whole
   * beside its receipt for `past_turn`. A tool's long answer is kept as its receipt, the final
   * review's own calls as counts, and the review's message (`review`: what the session keeps before
   * it, and the parts it showed, with the edits made) as its parts.
   */
  private keep(stored: string, sent: string, agent: AgentHandle, review?: { before: string; parts: readonly PromptPart[]; edits: readonly FinalEdit[] }): void {
    const main = this.host.settings.agents.main;
    const receipts = main.sessionKeeps === "receipts";
    const t = agent.transcript();
    const args = new Map<string, JsonObject>();
    const did: string[] = [];
    const kept: string[] = [];
    const reviewed: string[] = [];
    for (const e of t.entries) {
      if (e.kind === "answer") {
        if (e.text.trim() !== "") {
          did.push(e.text.trim());
          kept.push(e.text.trim());
        }
        for (const c of e.calls) args.set(c.id, c.args);
      } else if (e.kind === "result") {
        const call = { tool: e.name, args: JSON.stringify(args.get(e.callId) ?? {}) };
        did.push(this.text(MAIN_TEXT.historyCall, { ...call, result: e.text }));
        if (receipts && isReviewTool(e.name)) reviewed.push(e.name);
        else kept.push(this.text(MAIN_TEXT.historyCall, { ...call, result: receipts ? receiptOf(e.text, { chars: main.receiptChars, reply: this.reply, texts: this.texts }) : e.text }));
      }
    }
    const counts = reviewCounts(reviewed, this.texts);
    if (counts !== "") kept.push(counts);
    const done = did.join("\n\n");
    const receipt = receipts && review ? reviewReceipt(review.parts, review.edits, { reply: this.reply, texts: this.texts }) : null;
    const asked = receipt === null ? stored : review?.before ? `${review.before}\n\n${receipt}` : receipt;
    const answered = kept.join("\n\n");
    const message = (role: "user" | "assistant", content: string, whole: string): MainMessage => ({ role, content, by: MAIN_BY, ...(content !== whole ? { whole } : {}) });
    this.sent.push({ role: "user", text: sent }, { role: "assistant", text: done });
    this.kept.push(message("user", asked, stored), message("assistant", answered, done));
  }

  /** The main agent failed: the turn stops (see the header), and every request still waiting goes on without its role. */
  private fail(stage: MainRoleStage, reason: string): void {
    if (this.failure !== null) return;
    this.failure = reason;
    const { rt, chatId, userId } = this.host;
    rt.diag.fatal(this.host.at(), DIAG_PHASE[stage], MAIN_LABEL, reason);
    this.host.live?.add({ kind: "failed", step: MAIN_LABEL, reason });
    for (const r of [...this.requests]) r.settle({ failed: true });
    if (this.host.phase() === "post") rt.ledger.cancel(chatId, userId);
  }

  // ---------------------------------------------------------------- what a stage says

  private stageMessage(stage: MainRoleStage, requests: readonly Request[]): string {
    const open = requests
      .map((r) => {
        const line = this.text(MAIN_TEXT.open, { role: r.role, what: this.text(MAIN_TEXT.request(r.kind)) });
        const people = this.peopleOf(r);
        return people === "" ? line : `${line}\n  ${people}`;
      })
      .join("\n");
    const message = tidy(this.text(MAIN_TEXT.stage, { number: String(NUMBER[stage]), stage: this.text(MAIN_TEXT.stageLabel(stage)), engine: this.engineNote(stage, requests), open }));
    // What ran on its own since the last send leads it (`autoRan`).
    const auto = this.takeAuto();
    return auto === "" ? message : `${auto}\n\n${message}`;
  }

  /** Whom a request's calls are about, as its line follows it: the knowledge step's people, each call one person's or one for them all; nothing for any other request. */
  private peopleOf(r: Request): string {
    if (r.kind !== "knowledge") return "";
    const task = r.task as KnowledgeTask;
    const people = perceivers({ world: task.input.world, presence: task.opening.presence }).map((id) => `${task.opening.state.entities[id]?.name ?? id} (${id})`);
    if (people.length === 0) return "";
    return this.text(this.host.settings.minds.knowledge.batch === "character" ? MAIN_TEXT.openEach : MAIN_TEXT.openScene, { people: people.join(", ") });
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
      // The plan's lines are what the narrator is told: everything, secrets marked.
      const lines = [...task.lines.outcome, ...task.lines.montage, ...task.lines.beats].join("\n");
      return this.text(MAIN_TEXT.engineBeats, { lines: lines === "" ? none : lines });
    }
    if (stage === "read") {
      const task = requests.find((r) => r.kind === "extract" || r.kind === "curate" || r.kind === "choices")?.task as ExtractTask | undefined;
      if (!task) return "";
      this.replyShown = true;
      return this.text(MAIN_TEXT.engineReply, { reply: task.reply });
    }
    return "";
  }

  /** A run's answer as the main agent sees it: the answer's shape and its content, whole, a line carrying a secret marked (a brief or outline line is marked as it is written, `ProseMark`). */
  private answerOf(r: Pick<Request, "kind" | "task">, out: unknown): JsonValue {
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
      case "offscreen":
        return out as TieOdds | null;
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
        return { lore: scene.lore.length, notes: scene.notes };
      }
      case "prose": {
        const prose = (out as DirectorProse).prose;
        return { brief: prose.brief, outline: prose.outline };
      }
      case "extract":
      case "curate": {
        const read = out as ExtractRead;
        return { proposals: read.proposals, where: read.where };
      }
      case "effects":
        return { proposals: (out as JsonObject[]).length };
      case "knowledge":
        // What the knowledge step recorded of its answers: its learnings are the run's `knowledge`, never its `events`.
        return knowledgeAnswer(out as RunMindsResult);
      case "choices": {
        // A suggestion carrying a secret stays (its chip a spoiler); here it is marked, kept from the player character.
        const task = r.task as ChoicesTask;
        const wording = markWording(this.texts);
        return (out as string[]).map((line) => (task.secret(line) ? secretMarkText(line, [], [task.vars.pov ?? ""], wording) : line));
      }
    }
  }

  /**
   * A run as run_role and revise answer it: its answer whole, then what it left the engine
   * (`runYield`): its changes, staged, held for the review card or refused with why, and what of its
   * answer the engine didn't take, and why (a director's line that contradicts the state, flagged and
   * kept, among them); or why it failed.
   */
  private ran(r: Request): string {
    const run = r.current;
    if (!run) return "";
    const via = this.text(run.result.via === "prompt_only" ? MAIN_TEXT.viaPromptOnly : MAIN_TEXT.viaAgent);
    const agent = r.handle ?? run.agentId;
    const gave = run.result.ok ? runYield(this.texts, r.kind, run.result.out, run.writes) : { writes: "", lost: "" };
    const answer = run.result.ok ? this.text(MAIN_TEXT.ran, { agent, role: r.role, via, answer: JSON.stringify(this.answerOf(r, run.result.out)) }) : this.text(MAIN_TEXT.ranFailed, { agent, role: r.role, via, reason: run.result.reason });
    return [answer, gave.writes, gave.lost].filter((t) => t !== "").join("\n");
  }

  /** What a run is told of the main agent's task and revisions (`TurnAgentCtx.brief`), whole. */
  private briefFor(task: string, revisions: readonly string[]): string {
    return [this.text(MAIN_TEXT.brief, { task }), ...revisions.map((message) => this.text(MAIN_TEXT.briefRevision, { message }))].join("\n\n");
  }

  // ---------------------------------------------------------------- the tools

  /**
   * The main agent's tools, the same in every send of its turn, its stages' and (while the final
   * review is on) its review's, so each call starts as the one before it did and reads the prefix the
   * provider cached: the tools lead what the cache keys on. What a tool works on is the send's
   * (`work`), a stage's requests or the review's draft: a stage's own tool refuses in the review and
   * the review's in a stage (`reviewTools`), and commit commits either.
   */
  private tools(work: Round | ReviewWork): AgentTool[] {
    const { settings } = this.host;
    const describe = (name: string, arg: string): string => this.text(MAIN_TEXT.toolArg(name, arg));
    const reviewing = settings.agents.finalReview.on;
    // A stage's own tool in the review is refused: the review only edits the narrator's prompt.
    const inStage =
      (name: string, run: (round: Round, args: JsonObject) => Promise<ToolOutcome>) =>
      (args: JsonObject): Promise<ToolOutcome> =>
        "draft" in work ? Promise.resolve(this.refuse(MAIN_TEXT.refusedReview, { tool: name })) : run(work, args);
    const own: AgentTool[] = [
      {
        name: MAIN_TOOLS.runRole,
        description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.runRole)),
        parameters: { type: "object", properties: { role: { type: "string", enum: [...ROLE_IDS], description: describe(MAIN_TOOLS.runRole, "role") }, task: { type: "string", description: describe(MAIN_TOOLS.runRole, "task") }, prompt_only: { type: "boolean", description: describe(MAIN_TOOLS.runRole, "prompt_only") } }, required: ["role", "task"] },
        run: inStage(MAIN_TOOLS.runRole, (round, args) => this.runRole(round, args)),
      },
      {
        name: MAIN_TOOLS.revise,
        description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.revise)),
        parameters: { type: "object", properties: { agentId: { type: "string", description: describe(MAIN_TOOLS.revise, "agentId") }, message: { type: "string", description: describe(MAIN_TOOLS.revise, "message") } }, required: ["agentId", "message"] },
        run: inStage(MAIN_TOOLS.revise, (round, args) => this.revise(round, args)),
      },
      {
        name: MAIN_TOOLS.commit,
        // One description for a stage's commit and the review's, the same in every send.
        description: [this.text(MAIN_TEXT.tool(MAIN_TOOLS.commit)), ...(reviewing ? [this.text(REVIEW_TEXT.commit)] : [])].join(" "),
        parameters: { type: "object", properties: {} },
        run: () => ("draft" in work ? Promise.resolve(commitReview(this.texts, work)) : this.commit(work)),
      },
      ...(settings.agents.compaction.summarizeTool ? [{ name: MAIN_TOOLS.summarize, description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.summarize)), parameters: { type: "object", properties: {} }, run: inStage(MAIN_TOOLS.summarize, (round) => this.summarize(round)) } satisfies AgentTool] : []),
      {
        name: MAIN_TOOLS.condense,
        description: this.text(MAIN_TEXT.tool(MAIN_TOOLS.condense)),
        parameters: { type: "object", properties: { source: { type: "string", description: describe(MAIN_TOOLS.condense, "source") }, role: { type: "string", enum: [...ROLE_IDS], description: describe(MAIN_TOOLS.condense, "role") }, note: { type: "string", description: describe(MAIN_TOOLS.condense, "note") }, focus: { type: "string", description: describe(MAIN_TOOLS.condense, "focus") } }, required: ["source", "role"] },
        run: inStage(MAIN_TOOLS.condense, (round, args) => this.condense(round, args)),
      },
      // A look back at a past turn in full, in a stage or in the review alike: it changes nothing.
      pastTurnTool({ texts: this.texts, page: Math.max(1000, settings.agents.clipChars - 400), source: () => this.pastTurns() }),
    ];
    return [...own, ...(reviewing ? reviewTools(this.texts, "draft" in work ? work : null) : []), ...this.readTools(), ...this.archiveTools()];
  }

  /** The turn's past turns, for `past_turn`: each reply on the chain before it, numbered as the digest numbers them, whose record holds a segment of the session. */
  private pastTurns(): PastTurnsSource {
    const { core, observed } = this.start;
    const replies: { reply: number; segment: string }[] = [];
    let n = 0;
    for (const m of core.chain(observed)) {
      if (m.isUser) continue;
      n++;
      const segment = recordSessionOf(activeRecord(m, core.journal.tombstones)).segment;
      if (segment !== undefined) replies.push({ reply: n, segment });
    }
    return { replies, read: (hashes) => this.host.rt.sessions.segments(this.host.userId, hashes) };
  }

  /** The main agent's read tools, the GM's view with every secret marked: it changes nothing itself. None while the chat's world isn't loaded. */
  private readTools(): AgentTool[] {
    const main = this.host.settings.agents.main;
    const head = this.host.head();
    if (!head || main.families.length === 0) return [];
    // Its tools read only, the GM's view with every secret marked: it changes nothing itself but the notes it condenses.
    return toolsFor({ world: head.world, tiers: ["read"], families: main.families, texts: this.texts, env: { userId: this.host.userId, chatId: this.host.chatId, knowledge: "gm", marks: true, reader: this.host.reader(), writer: null, agent: { role: MAIN_AGENT_ROLE, id: MAIN_AGENT_ROLE }, signal: this.host.stop, loads: this.host.loads } });
  }

  /**
   * The author's archive tools (DEPTH-PLAN §4.3, §8.7): the chat's own prose before this turn,
   * searched and quoted from the turn's own snapshot, so a re-run never reads the reply it replaces
   * and no read waits on the queue the turn holds. None while the chat's world isn't loaded.
   */
  private archiveTools(): AgentTool[] {
    const head = this.host.head();
    if (!head) return [];
    const { rt, chatId, userId } = this.host;
    const view = (): ArchiveView => (this.archive ??= archiveViewOf(this.start.core, this.start.observed));
    return archiveTools({ texts: this.texts, world: head.world, state: head.state, source: { search: async (q) => rt.archive.searchView(chatId, userId, view(), q), quote: async (r) => quoteView(view(), r) } });
  }

  /** `condense`: a source condensed with the main agent's own model (`condenseSource`) into a workspace note staged as `role`'s, which a task names. */
  private async condense(round: Round, args: JsonObject): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const role = typeof args.role === "string" ? args.role : "";
    if (!(ROLE_IDS as readonly string[]).includes(role)) return this.refuse(MAIN_TEXT.refusedRole, { role, roles: ROLE_IDS.join(", ") });
    const view = await this.host.reader().view();
    const note = typeof args.note === "string" && args.note.trim() !== "" ? args.note.trim() : null;
    const made = await condenseSource(view, {
      ref: typeof args.source === "string" ? args.source : "",
      note,
      focus: typeof args.focus === "string" ? args.focus : "",
      signal: round.controller.signal,
      summarize: async (instructions, text, signal) => {
        const reply = await this.summarizer(this.text(RUNTIME_TEXT.condenseSystem), `${instructions}\n\n${text}`, AbortSignal.any([round.controller.signal, signal]));
        return reply.status === "answered" && reply.text.trim() !== "" ? { text: reply.text.trim() } : { failed: reply.reason ?? this.text(MAIN_TEXT.none) };
      },
    });
    if (!("path" in made)) return made;
    const out = await propose(view, this.host.writer(role as RoleId), { kind: "ws_write", path: made.path, text: made.text });
    return out.error ? out : { text: JSON.stringify({ note: made.path, chars: { source: made.chars, note: made.text.length }, ...(JSON.parse(out.text) as object) }) };
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

  /**
   * `run_role`: each of the stage's open requests of the role that hasn't answered and has no run
   * under way runs, with the main agent's task. Once every one has answered, each runs afresh within
   * its role's fresh runs (Fresh runs per request): what its last run staged goes, and its revisions
   * start again; past them, the refusal says what's left.
   */
  private async runRole(round: Round, args: JsonObject): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const role = typeof args.role === "string" ? args.role : "";
    if (!(ROLE_IDS as readonly string[]).includes(role)) return this.refuse(MAIN_TEXT.refusedRole, { role, roles: ROLE_IDS.join(", ") });
    const open = round.requests.filter((r) => r.role === role && !r.done);
    if (open.length === 0) return this.notNow(role as RoleId, round.stage);
    // A run that failed may run again, prompt-only too. A request runs once at a time: one whose run
    // another call of this answer started isn't run again.
    const task = typeof args.task === "string" ? args.task : "";
    const due = open.filter((r) => !r.busy && (r.current === null || !r.current.result.ok));
    if (due.length === 0) {
      if (open.some((r) => r.busy)) return this.refuse(MAIN_TEXT.refusedRunning, { role });
      const budget = roleBudget(this.host.settings.agents, role as RoleId);
      const fresh = open.filter((r) => r.reruns < budget.reruns);
      if (fresh.length === 0) {
        const agents = open.map((r) => {
          const left = Math.max(0, budget.revisions - (r.current?.revisions.length ?? 0));
          return this.text(MAIN_TEXT.runLeft, { agent: r.handle ?? "", count: String(left), revisions: nounFor(left, "revision", "revisions") });
        });
        return this.refuse(MAIN_TEXT.refusedRan, { role, limit: String(budget.reruns), runs: nounFor(budget.reruns, "run", "runs"), agents: agents.join("; ") });
      }
      for (const r of fresh) r.reruns += 1;
      await Promise.all(fresh.map((r) => this.attempt(round, r, task, [], args.prompt_only === true)));
      return { text: fresh.map((r) => this.ran(r)).join("\n") };
    }
    await Promise.all(due.map((r) => this.attempt(round, r, task, [], args.prompt_only === true)));
    return { text: due.map((r) => this.ran(r)).join("\n") };
  }

  /** `revise`: the run runs again with its task and every revision sent it, within its role's revision cap; its new answer stands for the old. */
  private async revise(round: Round, args: JsonObject): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const agent = typeof args.agentId === "string" ? args.agentId : "";
    const r = round.requests.find((q) => q.handle === agent && !q.done);
    if (!r?.current) return this.refuse(MAIN_TEXT.refusedAgent, { agent, agents: round.requests.flatMap((q) => (q.handle && !q.done ? [q.handle] : [])).join(", ") || this.text(MAIN_TEXT.none) });
    // A request runs once at a time: a revision of one whose run another call of this answer started is refused.
    if (r.busy) return this.refuse(MAIN_TEXT.refusedRunning, { role: r.role });
    const budget = roleBudget(this.host.settings.agents, r.role);
    const limit = budget.revisions;
    if (r.current.revisions.length >= limit) {
      // What's left: a fresh run, within its role's fresh runs, or commit.
      const reruns = Math.max(0, budget.reruns - r.reruns);
      const fresh = reruns > 0 ? this.text(MAIN_TEXT.freshLeft, { count: String(reruns), runs: nounFor(reruns, "run", "runs") }) : this.text(MAIN_TEXT.freshNone);
      return this.refuse(MAIN_TEXT.refusedRevisions, { agent, limit: String(limit), revisions: nounFor(limit, "revision", "revisions"), fresh });
    }
    await this.attempt(round, r, r.current.task, [...r.current.revisions, typeof args.message === "string" ? args.message : ""], r.current.promptOnly);
    return { text: this.ran(r) };
  }

  /**
   * One run of a request's role, the only one under way for the request (`Request.busy`). The run it
   * replaces no longer stands as it starts: what that one staged goes first, so this one reads the
   * turn without it and stages afresh what it still wants. One that ends after its request was
   * settled (its time ran out, the main agent failed, or a commit of the same answer went on without
   * it) lands nothing it staged. A decision's run records its choosers' learnings into its own list
   * (`Run.learned`), so a revision or a run again hands the turn only those of the answer that
   * stands. What a run that answered left the engine (`runYield`) goes to Diagnostics and the host
   * log too.
   */
  private async attempt(round: Round, r: Request, task: string, revisions: string[], promptOnly: boolean): Promise<void> {
    const brief = this.briefFor(task, revisions);
    const learned: LedgerEvent[][] = [];
    const heard = (r.task as Partial<ChooseTask>).heard;
    const own = heard ? { ...(r.task as ChooseTask), heard: { ...heard, learned: (events: LedgerEvent[]) => learned.push(events) } } : r.task;
    r.busy = true;
    if (r.current) this.host.drop(r.current.agentId, "replaced");
    const running = this.host.run({ role: r.role, run: r.run, task: own, signal: AbortSignal.any([r.signal, round.controller.signal]), brief, promptOnly });
    round.running.add(running);
    try {
      const { agentId, result } = await running;
      if (r.done) this.host.drop(agentId, "unused");
      const writes = this.host.writes(agentId);
      r.current = { agentId, result, task, revisions, promptOnly, learned, writes };
      r.handle ??= agentId;
      if (result.ok) recordYield(this.host.rt, this.host.at(), DIAG_PHASE[round.stage], r.role, runYield(this.texts, r.kind, result.out, writes));
    } finally {
      r.busy = false;
      round.running.delete(running);
    }
  }

  /**
   * `commit`: once the runs under way are in, those the answer's other calls started meanwhile too,
   * the stage's requests get what answered, the rest go on without their role, and the send ends.
   */
  private async commit(round: Round): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    while (round.running.size > 0) await Promise.allSettled([...round.running]);
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

  /** `summarize`: the session compacts now (once a turn, a second call in the same answer too), all but its latest turns into one summary its later stages read; a summary made ahead for the same session is the one it takes. */
  private async summarize(round: Round): Promise<ToolOutcome> {
    if (round.committed) return this.refuse(MAIN_TEXT.refusedCommitted);
    const session = this.session;
    if (this.summarized || !session) return this.refuse(MAIN_TEXT.summarizeAgain);
    this.summarized = true;
    const { compaction } = this.host.settings.agents;
    const made = await compact(this.host.rt, {
      userId: this.host.userId,
      holder: this.host.holder,
      session,
      keep: compaction.keepTurns,
      limit: compaction.summaryTokens,
      texts: this.texts,
      summarize: (fold) => {
        const call = this.foldCall(fold);
        return this.host.rt.compactions.run(call.key, () => this.fold(call, round.controller.signal, true)).result;
      },
    });
    if (made === null || "failed" in made) this.summarized = false;
    if (made === null) return this.refuse(MAIN_TEXT.summarizeNothing, { turns: String(session.segments.length), keep: String(compaction.keepTurns) });
    if ("failed" in made) {
      this.unlanded(made);
      return this.refuse(MAIN_TEXT.summarizeFailed, { reason: made.failed });
    }
    this.rebase = made.rebase;
    this.session = made.session;
    return { text: this.text(MAIN_TEXT.summarized, { summary: made.summary, folded: String(made.folded), kept: String(made.kept) }) };
  }
}
