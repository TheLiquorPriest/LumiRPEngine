// The agent turn loop's orchestrator (INC2-SPEC lane T1; AGENT-LOOP-PLAN §4, §5, §7): a chat whose
// Engine switch is on agents (GM → This chat) plays each turn through its roles. The turn is
// classic's own flow, step for step: every model call classic makes goes through a seam, a
// `TurnCalls`, that is classic's call itself on a classic chat (`CLASSIC_CALLS`) and the call's
// role on an agent chat. So the gates, the bridge, the plan, the read's filters and delivery are
// classic's, in classic's order, and the fixed pipeline's roles in prompt-only mode
// (`roles/classic.ts`) make exactly classic's calls and record exactly classic's events.
//
// What an agent turn adds:
// - Its roles' context (C10): the turn's budget, its signal, a reader and the turn's writer on the
//   head before the plan, the planned head after it, and the read's head after the reply.
// - A role that fails does as its settings say (`onFail`): `prompt_only` runs it once more as its
//   classic call and then goes on without it; `skip` goes on; `stop` stops the turn, its failure the
//   engine-failed card's (`Diagnostics.fatal`: only those stop an agent turn), and after the reply
//   stops the read as its Cancel does (`roleStopped`), which leaves Retry read. A role that fails
//   lands nothing it staged, whatever its `onFail`. Before the reply a stop ends the run at once: no
//   later role runs and no gate shows. One whose phase's time ran out failed as classic's call does
//   then: it answered nothing.
// - Every read of a reply on an agent chat is the roles', in a run of its own where the read has
//   none of its turn's: a Re-narrate's and a Continue's (`beginReply`), a Retry read's and a Re-read
//   edit's (`beginRead`). No turn mixes classic's steps with the roles.
// - What its roles staged lands at three points, each operation re-validated in the fixed order
//   (`commitStaged`): the pre phase's after the plan's events, inside the plan; the plan phase's on
//   the planned turn (`appendPlanned`); the post phase's in the read, ahead of the minds. One that
//   asks first goes to the turn's review card (`review.ts`); at a gate the turn waits on the card.
// - A wait (Ask first, a suggested check, the intent and outline gates, the review gate) keeps the
//   run whole for its resume: what its roles staged, committed and set aside for the card, the
//   learned-area changes it made, and its calls still under way (a mind's among them). The resume, a
//   run of the same turn, takes it (`begin`), so no agent is called again; what it committed after
//   its plan lands again in the plan the resume replays (`recommit`). With the outline gate on, the
//   review gate waits after it.
// - Its narrator-facing lines are recorded as output events (C11) in the prose phase, which
//   delivery reads and a Re-narrate copies.
// - Its record says which role wrote which events (`Rec.agents`), and its session holds the turn.
// - Memory placed before the next turn (`pipeline.memory`) runs first in the next turn's pre phase,
//   on the reply it remembers, and is recorded there; on a classic turn, by classic's own call.
//
// With Settings → Agents → Pipeline set to a main agent (`pipeline.mode: main`, C14), every one of
// those calls is a request the turn's main agent works instead (`main-agent.ts`): the engine opens
// the turn's stages in C14's order, with the decisions after the gates and the stage's requests
// together (`ordered`, `stage`), and the main agent runs the roles it chooses, each once as below,
// with its task for it (`TurnAgentCtx.brief`) and never by its `onFail`. Its failure stops the turn.

import { ROLE_LABEL, type RoleId, type RoleSettings } from "../../shared/agent-roles";
import type { AgentKnowledge } from "../../shared/agent-tools";
import type { DiagPhase } from "../../shared/diagnostics";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import { MAIN_TEXT, type MainRequestKind } from "../../shared/main-agent-prompts";
import type { GenerationKind, LedgerEvent, PackEvent, Rec, RecAgent, RecSession } from "../../shared/ledger";
import type { ExtractionLearning, UserSettings } from "../../shared/settings";
import { firedTimeout } from "../../shared/timeouts";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord, ownMessage } from "../../engine/ledger/path";
import type { WorldState } from "../../engine/state";
import type { StepPurpose, WorldDoc } from "../../shared/world";
import { outLines, outScene } from "../../engine/outputs";
import { Working } from "../../engine/working";
import type { StoredChip } from "../chips";
import type { LearnedFile } from "../chat-agent-meta";
import type { DiagAt } from "../diagnostics";
import { EngineFailure, type RunOutcome, type TurnContext } from "../ledger-io";
import type { Judgement } from "../../engine/adjudication";
import type { RunMindsResult } from "../minds";
import type { Runtime } from "../runtime";
import type { SkipRun } from "../skip";
import type { PlanProse, TurnCommit } from "../turn-model";
import type { TieOdds } from "../turn-steps";
import type { GenerateAs } from "../../shared/protocol";
import { counted } from "../../shared/words";
import { isMainMessage, MAIN_BY, rolledBack } from "./compaction";
import { type MainHost, MainTurn } from "./main-agent";
import { agentRoles } from "./roles/index";
import type { Review, StoredReviewItem } from "./review";
import { AgentTurn } from "./runtime";
import type { ToolReader } from "./tools/read-view";
import { contextOf, type ToolWriter, withLearned } from "./tools/writer";
import type { ChatHead } from "./tools/workspace";
import { recordSessionOf, segmentOf, sessionAt, type SessionMessage } from "./sessions";
import type { ChoicesTask, ChooseTask, DirectorProse, EffectsTask, ExtractTask, InterpretOutcome, InterpretTask, JudgeTask, KnowledgeTask, MemoryTask, MindsTask, ProseTask, PuzzleTask, RoleResult, RoleRun, SceneOut, SceneTask, SkipPlanTask, SkipTask, TurnAgentCtx, TurnBrief, TurnRoles } from "./turn-ctx";
import { type CommitCtx, commitOrder, commitStaged, opTier, type StagedOp, type StagePhase, TurnDraft, turnReader, turnWriter } from "./turn-writer";
import type { ExtractRead } from "../steps";
import { renderPrompt } from "../prompts";
import { emptyUsage } from "./usage";

/**
 * Every model call of a turn, at the seam classic makes it (classic-turn-map §10): each takes its
 * task, whose `classic` is classic's own call, and the signal classic gives that call.
 */
export interface TurnCalls {
  interpret(task: InterpretTask, signal: AbortSignal): Promise<InterpretOutcome>;
  judge(task: JudgeTask, signal: AbortSignal): Promise<Judgement | null>;
  puzzle(task: PuzzleTask, signal: AbortSignal): Promise<number | null>;
  decisions(task: ChooseTask, signal: AbortSignal): Promise<TieOdds | null>;
  minds(task: MindsTask, signal: AbortSignal): Promise<RunMindsResult>;
  skipPlan(task: SkipPlanTask, signal: AbortSignal): Promise<LedgerEvent | null>;
  skip(task: SkipTask, signal: AbortSignal): Promise<SkipRun | null>;
  prose(task: ProseTask, signal: AbortSignal): Promise<DirectorProse>;
  extract(task: ExtractTask, signal: AbortSignal): Promise<ExtractRead>;
  effects(task: EffectsTask, signal: AbortSignal): Promise<JsonObject[]>;
  /** The knowledge step after the read (an agent chat's own call; a classic chat's is inside `memory`, its whole post phase). */
  knowledge(task: KnowledgeTask, signal: AbortSignal): Promise<RunMindsResult>;
  offscreen(task: ChooseTask, signal: AbortSignal): Promise<TieOdds | null>;
  choices(task: ChoicesTask, signal: AbortSignal): Promise<string[]>;
  memory(task: MemoryTask, signal: AbortSignal): Promise<RunMindsResult>;
}

/** A classic chat's calls: each classic's own. */
export const CLASSIC_CALLS: TurnCalls = {
  interpret: (task, signal) => task.classic(signal),
  judge: (task, signal) => task.classic(signal),
  puzzle: (task, signal) => task.classic(signal),
  decisions: (task, signal) => task.classic(signal),
  minds: (task, signal) => task.classic(signal),
  skipPlan: (task, signal) => task.classic(signal),
  skip: (task, signal) => task.classic(signal),
  prose: async (task, signal) => ({ prose: await task.classic(signal) }),
  extract: (task, signal) => task.classic(signal),
  effects: (task, signal) => task.classic(signal),
  knowledge: (task, signal) => task.classic(signal),
  offscreen: (task, signal) => task.classic(signal),
  choices: (task, signal) => task.classic(signal),
  memory: (task, signal) => task.classic(signal),
};

const NO_MINDS: RunMindsResult = { events: [], traces: [] };

/**
 * The steps a role's task makes as its classic call (`StepPurpose`), by request: under `stop`, before
 * the reply, one of them that fails as a classic turn would stop on (failed, cut off or empty) fails
 * the role, so a prompt-only role stops as classic does. The intent's read says so itself, and minds
 * that don't answer are the turn's to word (`Runtime.mindsMissed`).
 */
const CLASSIC_PURPOSES: Partial<Record<MainRequestKind, readonly StepPurpose[]>> = {
  judge: ["judge"],
  puzzle: ["puzzle.answer"],
  decisions: ["npc.choose"],
  prose: ["brief", "outline"],
  skipPlan: ["skip"],
  skip: ["skip"],
  memory: ["memory", "consolidate"],
};

/** One agent turn while it runs: from its pre phase through its reply's commit. */
interface AgentRun {
  chatId: ChatId;
  userId: UserId;
  generationId: string;
  at: DiagAt;
  /** The user's settings as the turn read them, with the learned modes its commits ask. */
  settings: UserSettings;
  learning: ExtractionLearning;
  /** The connection a change's learned mode counts on where its role names none: the user's default, the key the review card counts its outcomes under. */
  active: string;
  /** The chat's learned area as the turn read it, which its roles' learned-area changes are checked on. */
  learned: Readonly<Record<string, LearnedFile>>;
  /** The learned-area changes its commits made, by path (null: taken out), which land in the chat's metadata when it closes. */
  landing: Record<string, LearnedFile | null>;
  turn: AgentTurn;
  draft: TurnDraft;
  /** Stops every role of the turn: Cancel, or the turn's run ending. */
  stop: AbortController;
  phase: StagePhase;
  /** What its roles read and write against now (`TurnBase`). */
  head: ChatHead | null;
  /** Holds the workspace bodies its roles stage until the turn closes or is dropped. */
  holder: string;
  agents: number;
  /** The player's words the turn answers. */
  text: string;
  /** Each role run, for the turn's session: how it ran and whether it answered. */
  ran: { role: RoleId; via: "agent" | "prompt_only"; ok: boolean }[];
  /** What its commits applied, by operation, and set aside for its review card. */
  committed: { op: StagedOp; events: LedgerEvent[] }[];
  confirm: StagedOp[];
  /** Let through at the turn's review gate: committed first in the plan its resume replays. */
  approved: StagedOp[];
  /** The reply's own confirm proposals the card lists, by their chips. */
  read: StoredReviewItem[];
  scene: SceneOut | null;
  /** Memory placed before the next turn: the read skipped the minds' post phase, so the record says so. */
  memoryLater: boolean;
  /** The main agent working the turn (`pipeline.mode: main`); null on the fixed pipeline. */
  main: MainTurn | null;
  /** A read outside its turn (`beginRead`: a Retry read, a Re-read edit): it remembers in the read, whatever `pipeline.memory` says, and its reply owes the next turn no memory once it lands. */
  retry: boolean;
  /** Stops the run's read as its Cancel stops it, saying why (`roleStopped`): a generation's (a turn's, a Re-narrate's, a Continue's) through the chat's Cancel, a Retry read's and a Re-read edit's through their own signal. */
  cancelRead(why: string): void;
  /** The parent path the plan starts from: a gate's resume takes the run only for the same turn. */
  parentPath: string;
  /** What it committed after its plan before a gate (the plan phase's), committed again, re-validated, in the plan its resume replays. */
  recommit: StagedOp[];
  /** At its review gate: the narrator-facing lines its plan recorded, which the resume records again. */
  held: PackEvent[] | null;
}

export class Orchestrator {
  /** The fixed pipeline's roles (lane T2's: each its agent's, or its classic call's while prompt-only); tests set their own. */
  roles: TurnRoles;
  private readonly runs = new Map<string, AgentRun>();
  /** By chat: the run of a turn that waits on the player at a gate, kept whole for its resume. */
  private readonly waiting = new Map<ChatId, AgentRun>();

  constructor(
    private readonly rt: Runtime,
    private readonly review: Review,
  ) {
    this.roles = agentRoles(rt);
  }

  /**
   * The turn's pre phase starts: on a chat whose Engine switch is on agents it is an agent turn from
   * now on, on the head the plan starts from; on any other its calls are classic's. The resume of a
   * turn that waited at a gate takes the run it left (`park`), when it is the same turn: the same
   * words on the same chain. A Re-run or a Retry of the same generation starts afresh, nothing of the
   * earlier run's draft kept. With the pipeline set to a main agent, the turn's main agent starts
   * too, from the chain before the turn.
   */
  async begin(input: { chatId: ChatId; userId: UserId; generationId: string; core: LedgerCore; observed: ChainMessage[]; text: string }): Promise<boolean> {
    this.drop(input.generationId);
    const parked = this.waiting.get(input.chatId);
    this.waiting.delete(input.chatId);
    if ((await this.rt.chatKnowledge.engine(input.chatId, input.userId)) !== "agents") {
      if (parked) this.release(parked);
      return false;
    }
    const run = await this.rt.runOf(input.chatId, input.userId);
    const from = input.core.planState(input.generationId, input.observed);
    const head = run && from ? { run, core: input.core, observed: input.observed, world: from.world, state: from.state } : null;
    const parentPath = from?.parentPath ?? "";
    if (parked && parked.text === input.text && parked.parentPath === parentPath) {
      this.resumed(parked, input.generationId, head);
      return true;
    }
    if (parked) this.release(parked);
    const s = await this.newRun({ chatId: input.chatId, userId: input.userId, key: input.generationId, phase: "pre", head, text: input.text, parentPath, retry: false, cancelRead: (why) => void this.rt.ledger.cancel(input.chatId, input.userId, why) });
    if (s.settings.agents.pipeline.mode === "main") {
      // The turn's session and digest read the chain before it: up to the reply a swipe or Regenerate replaces.
      const target = input.core.journal.pending[input.generationId]?.messageId;
      const index = target ? input.observed.findIndex((m) => m.id === target) : -1;
      s.main = new MainTurn(this.mainHost(s), { text: input.text, core: input.core, observed: index < 0 ? input.observed : input.observed.slice(0, index) });
    }
    return true;
  }

  /**
   * A parked run taken by its turn's resume, under the resume's generation: from the pre phase on the
   * head the plan starts from, with everything it kept. What it committed before the plan is in the
   * plan the resume replays; what it committed after the plan is committed again there (`recommit`),
   * and what a review gate let through comes back from the card (`resume`). A stop that came while it
   * waited is the resume's own, which fails it at once.
   */
  private resumed(s: AgentRun, generationId: string, head: ChatHead | null): void {
    const stop = this.rt.diag.stopped(s.at);
    // The waiting run's policy goes with its old id; the resume's takes its place.
    this.rt.diag.agentTurnDone(s.at);
    s.generationId = generationId;
    s.at = { ...s.at, turn: generationId };
    this.rt.diag.agentTurn(s.at);
    if (stop) this.rt.diag.fatal(s.at, "pre", stop.step, stop.reason);
    s.phase = "pre";
    s.head = head;
    s.recommit = [...s.recommit, ...s.committed.filter((c) => c.op.phase === "plan" && c.op.approved !== true).map((c) => c.op)];
    s.committed = s.committed.filter((c) => c.op.phase !== "plan" && c.op.approved !== true);
    s.approved = [];
    // Past the user's turns under way, their oldest goes; another user's runs are theirs to bound.
    const own = [...this.runs.values()].filter((r) => r.userId === s.userId);
    for (const r of own.slice(0, Math.max(0, own.length - s.settings.agents.kept.runs + 1))) this.drop(r.generationId);
    this.runs.set(generationId, s);
  }

  /**
   * A Retry read or a Re-read edit of `messageId`'s reply on a chat whose Engine is on agents: the
   * read again on the chat's roles, in a run of its own under `key`, from the post phase on the
   * reply's read (`world`, `state`). Its roles run as the fixed pipeline runs them, each by its own
   * settings, on the main agent's pipeline too: the main agent works a turn's stages, and these are
   * the read alone. A role that stops it under `stop` aborts the signal this answers, and the read
   * lands nothing (`readStopped`); one that lands closes the run (`readClosed`). Null on any other
   * chat, whose read is classic's.
   */
  async beginRead(input: { chatId: ChatId; userId: UserId; key: string; core: LedgerCore; observed: ChainMessage[]; messageId: MessageId; world: WorldDoc; state: WorldState }): Promise<AbortSignal | null> {
    this.drop(input.key);
    if ((await this.rt.chatKnowledge.engine(input.chatId, input.userId)) !== "agents") return null;
    const run = await this.rt.runOf(input.chatId, input.userId);
    const index = input.observed.findIndex((m) => m.id === input.messageId);
    const said = ownMessage(input.observed.slice(0, Math.max(index, 0)));
    const stopped = new AbortController();
    const head = run ? { run, core: input.core, observed: input.observed, world: input.world, state: input.state } : null;
    await this.newRun({ chatId: input.chatId, userId: input.userId, key: input.key, phase: "post", head, text: said ? (said.swipes[said.swipeId] ?? "") : "", parentPath: "", retry: true, cancelRead: (why) => stopped.abort(new Error(why)) });
    return stopped.signal;
  }

  /**
   * The read of a reply whose generation has no run (a Re-narrate, which makes no call before its
   * reply, and a Continue), on a chat whose Engine is on agents: the read on the chat's roles, in a
   * run under the generation's id, from the post phase on the read (`world`, `state`), which the
   * chat's Cancel stops as it stops a turn's read. A Re-narrate is a turn: with the pipeline set to
   * a main agent, its main agent works its read and memory, from the chain before its reply. A
   * Continue's is the read alone, as a Retry read's is. False on any other chat, whose read is
   * classic's.
   */
  async beginReply(input: { chatId: ChatId; userId: UserId; generationId: string; kind: GenerationKind; core: LedgerCore; observed: ChainMessage[]; messageId: MessageId; world: WorldDoc; state: WorldState }): Promise<boolean> {
    this.drop(input.generationId);
    if ((await this.rt.chatKnowledge.engine(input.chatId, input.userId)) !== "agents") return false;
    const run = await this.rt.runOf(input.chatId, input.userId);
    const index = input.observed.findIndex((m) => m.id === input.messageId);
    const before = index < 0 ? input.observed : input.observed.slice(0, index);
    const said = ownMessage(before);
    const text = said ? (said.swipes[said.swipeId] ?? "") : "";
    const head = run ? { run, core: input.core, observed: input.observed, world: input.world, state: input.state } : null;
    const s = await this.newRun({ chatId: input.chatId, userId: input.userId, key: input.generationId, phase: "post", head, text, parentPath: "", retry: false, cancelRead: (why) => void this.rt.ledger.cancel(input.chatId, input.userId, why) });
    if (input.kind !== "continue" && s.settings.agents.pipeline.mode === "main") s.main = new MainTurn(this.mainHost(s), { text, core: input.core, observed: before });
    return true;
  }

  /**
   * A run under `key` on the chat's roles, from `phase` on `head`, with the user's settings as they
   * stand, the turn's agent budget and nothing yet staged; its Diagnostics place an agent turn's, which
   * only its fatal records stop.
   */
  private async newRun(input: { chatId: ChatId; userId: UserId; key: string; phase: StagePhase; head: ChatHead | null; text: string; parentPath: string; retry: boolean; cancelRead(why: string): void }): Promise<AgentRun> {
    const settings = await this.rt.settings.get(input.userId);
    const learning = await this.rt.settings.learningOf(input.userId);
    const active = await this.rt.activeConnectionId(input.userId);
    const { learned } = await this.rt.chatAgents.get(input.chatId, input.userId);
    const at: DiagAt = { chatId: input.chatId, userId: input.userId, turn: input.key };
    this.rt.diag.agentTurn(at);
    // A run whose turn went stale with no end heard (`dropIfStale`) is let go with the user's oldest,
    // past their Settings → Agents → Budgets' turns under way; another user's runs are theirs to bound.
    const own = [...this.runs.values()].filter((r) => r.userId === input.userId);
    for (const r of own.slice(0, Math.max(0, own.length - settings.agents.kept.runs + 1))) this.drop(r.generationId);
    const s: AgentRun = {
      chatId: input.chatId,
      userId: input.userId,
      generationId: input.key,
      at,
      settings,
      learning,
      active,
      learned,
      landing: {},
      // Each agent at work shows as a row of the drawer's live trace: its label and tokens, nothing it reads or calls.
      turn: new AgentTurn(settings.agents.turn, undefined, (agent, spent) => this.rt.diag.agentAtWork(input.chatId, input.userId, agent, spent)),
      draft: new TurnDraft(input.key),
      stop: new AbortController(),
      phase: input.phase,
      head: input.head,
      holder: `turn:${input.key}`,
      agents: 0,
      text: input.text,
      ran: [],
      committed: [],
      confirm: [],
      approved: [],
      read: [],
      scene: null,
      memoryLater: false,
      main: null,
      retry: input.retry,
      cancelRead: input.cancelRead,
      parentPath: input.parentPath,
      recommit: [],
      held: null,
    };
    this.runs.set(input.key, s);
    return s;
  }

  isAgent(generationId: string): boolean {
    return this.runs.has(generationId);
  }

  /** Whether the engine keeps C14's order for the turn (its main agent's): the decisions after the gates, each stage's requests together. */
  ordered(generationId: string): boolean {
    return this.runs.get(generationId)?.main != null;
  }

  /** The engine let the turn play once its gates passed: the main agent's stage 3 opens. */
  played(generationId: string): void {
    this.runs.get(generationId)?.main?.open("prepare");
  }

  /** The turn's calls: its roles' on an agent turn, else classic's. */
  calls(generationId: string): TurnCalls {
    const s = this.runs.get(generationId);
    return s ? this.agentCalls(s) : CLASSIC_CALLS;
  }

  /** The turn moves on: its roles read and write against `head` from now on (the planned head, then the reply's read), and its main agent's next stage opens. */
  phase(generationId: string, phase: StagePhase, head: ChatHead): void {
    const s = this.runs.get(generationId);
    if (!s) return;
    s.phase = phase;
    s.head = head;
    s.main?.open(phase === "post" ? "read" : "beats");
  }

  // ---------------------------------------------------------------- the pre phase

  /**
   * Memory placed before the next turn (`pipeline.memory: before_next`): whether the reply before
   * this turn left its minds' memory to it, whichever engine plays the turn. The turn remembers that
   * reply first, on that reply's own read (its memory role on an agent turn, classic's own call on a
   * classic one), its events leading this turn's plan.
   */
  memoryOwed(core: LedgerCore, reply: ChainMessage | undefined): boolean {
    return reply !== undefined && activeRecord(reply, core.journal.tombstones)?.memoryNext === true;
  }

  /** The scene role, once the turn is set to play: its lore and notes are recorded for the narrator with the turn's other lines. */
  async scene(generationId: string, task: SceneTask, signal: AbortSignal): Promise<void> {
    const s = this.runs.get(generationId);
    if (!s) return;
    if (s.main) {
      const got = await s.main.request("scene", this.roles.scene, task, signal);
      s.scene = "out" in got && (got.out.lore.length > 0 || got.out.notes.length > 0) ? got.out : null;
      return;
    }
    const out = await this.play(s, "scene", "scene", "pre", this.roles.scene, task, signal);
    s.scene = out.ok && (out.out.lore.length > 0 || out.out.notes.length > 0) ? out.out : null;
  }

  /**
   * A review gate's resume (`passReview`): what its card let through commits first in the plan it
   * replays, re-validated there, after what the run it took had committed before the plan.
   */
  async resume(generationId: string, text: string): Promise<void> {
    const s = this.runs.get(generationId);
    if (!s) return;
    const gated = await this.review.gated(s.chatId, s.userId, text);
    s.approved = (gated?.approved ?? []).flatMap((item, i): StagedOp[] => (item.op && item.knowledge ? [{ seq: -1000 + i, phase: "pre", role: roleOf(item.role), agentId: item.agentId ?? item.role, key: item.key, op: item.op, changeType: item.changeType as StagedOp["changeType"], mode: "auto", tier: opTier(item.op), knowledge: item.knowledge, connectionId: item.connection ?? null, lines: item.lines, events: [], approved: true }] : []));
  }

  /**
   * The pre phase's commit, which the plan runs after its own events (`TurnBridge.setCommit`); null
   * on a classic turn. It finds the run by its key as it runs, so what keeps it holds no run.
   */
  preCommit(generationId: string): TurnCommit | null {
    if (!this.runs.has(generationId)) return null;
    return (w) => {
      const s = this.runs.get(generationId);
      if (s) this.commit(s, [...s.approved, ...s.draft.take("pre")], w);
    };
  }

  // ---------------------------------------------------------------- the prose phase

  /**
   * The prose phase's end on an agent turn: what its roles staged since the plan lands on the planned
   * turn, after what the run committed there before a gate it waited at (`recommit`), then its
   * narrator-facing lines are recorded (C11), each text no longer than Settings → Agents → Recording
   * lets it be; a review gate's resume records the lines the gate held. Answers why the turn waits
   * when its review gate holds it. With the outline gate about to show (`outline`), the review gate
   * waits after it, on the outline's resume (AGENT-LOOP-PLAN §7: the outline, then the commit and its
   * review).
   */
  async planned(generationId: string, input: { core: LedgerCore; observed: ChainMessage[]; lines: { outcome: readonly string[]; montage: readonly string[]; outline: readonly string[]; brief: string | null } | null; replaying: boolean; outline: boolean; anchor: MessageId | null; as: GenerateAs }): Promise<string | null> {
    const s = this.runs.get(generationId);
    if (!s) return null;
    const ops = commitOrder([...s.recommit, ...s.draft.take("plan")]);
    s.recommit = [];
    const head = s.head;
    if (ops.length > 0 && head) {
      const w = new Working(this.rt.registry, head.world, head.state);
      this.commit(s, ops, w);
      if (w.events.length > 0) input.core.appendPlanned(generationId, w.events, input.observed);
    }
    const outputs = input.replaying ? (s.held ?? []) : input.lines ? this.outputs(s, input.lines) : [];
    if (outputs.length > 0) input.core.appendPlanned(generationId, outputs, input.observed);
    // The review gate: the turn waits after its plan on the card for what its roles asked to change first.
    if (s.settings.agents.review.placement !== "gate" || s.confirm.length === 0 || input.anchor === null || input.outline) return null;
    const items = s.confirm.map((op) => itemOf(op));
    s.confirm = [];
    await this.review.make({ chatId: s.chatId, userId: s.userId, turn: `${input.anchor}:gate`, messageId: input.anchor, placement: "gate", text: s.text, items, as: input.as });
    s.held = outputs;
    return `waiting for you to review ${items.length === 1 ? "a change" : `${items.length} changes`} the turn asked to make`;
  }

  /** The turn's narrator-facing lines as output events: each text cut to the recording limit, a cut one logged. */
  private outputs(s: AgentRun, lines: { outcome: readonly string[]; montage: readonly string[]; outline: readonly string[]; brief: string | null }): PackEvent[] {
    const limit = s.settings.agents.recording.outputChars;
    let cut = 0;
    const fit = (text: string): string => {
      if (text.length <= limit) return text;
      cut++;
      return `${text.slice(0, Math.max(0, limit - 1))}…`;
    };
    const events: PackEvent[] = [];
    for (const kind of ["outcome", "montage", "outline"] as const) if (lines[kind].length > 0) events.push(outLines(kind, lines[kind].map(fit)));
    if (lines.brief) events.push(outLines("brief", [fit(lines.brief)]));
    if (s.scene) events.push(outScene(s.scene.lore, s.scene.notes.map(fit), s.scene.knowledge));
    // An agent turn records the outcome even when it has none, so its narrator is told the turn's own lines and never another's.
    if (events.length === 0) events.push(outLines("outcome", []));
    if (cut > 0) this.rt.host.log("info", `[LumiRPEngine] turn ${s.generationId.slice(0, 8)}: ${counted(cut, "narrator line", "narrator lines")} cut to ${counted(limit, "character", "characters")} (Settings → Agents → Recording)`, s.userId);
    return events;
  }

  // ---------------------------------------------------------------- the reply's read

  /** Whether the read leaves the minds' memory to the next turn (`pipeline.memory: before_next`); a Retry read's and a Re-read edit's never do: they remember in the read, and their reply owes the next turn none once they land. */
  memoryLater(generationId: string): boolean {
    const s = this.runs.get(generationId);
    if (!s || s.retry || s.settings.agents.pipeline.memory !== "before_next") return false;
    s.memoryLater = true;
    return true;
  }

  /** The read's commit of what its roles staged after the reply, ahead of the minds; none on a classic turn. It finds the run by its key as it runs, so the prepared read holds no run. */
  postCommit(generationId: string): TurnCommit | undefined {
    if (!this.runs.has(generationId)) return undefined;
    return (w) => {
      const s = this.runs.get(generationId);
      if (s) this.commit(s, s.draft.take("post"), w);
    };
  }

  /**
   * The reply's confirm chips on an agent turn: each that Apply and No answer whole joins the turn's
   * review card, its chip kept for the card's Apply and No and hidden from the chips area
   * (`payload.review`); the rest stay as they are.
   */
  readConfirm(generationId: string, chips: StoredChip[]): StoredChip[] {
    const s = this.runs.get(generationId);
    if (!s) return chips;
    return chips.map((chip) => {
      if (chip.kind !== "confirm" || !chip.actions.some((a) => a.id === "confirm") || chip.actions.some((a) => a.input !== undefined)) return chip;
      s.read.push({ key: chip.id, source: "read", role: "read", changeType: typeof chip.payload.type === "string" ? chip.payload.type : "move", lines: [chip.label], status: "open", chipId: chip.id });
      return { ...chip, payload: { ...chip.payload, review: true } };
    });
  }

  /** The read was cancelled, by its Cancel or a role under `stop`: the run ends with it, and what it staged and offered goes, so nothing of the read lands. */
  readStopped(generationId: string): void {
    this.drop(generationId);
  }

  // ---------------------------------------------------------------- the turn's close

  /** Before its commit: a read that left the minds' memory to the next turn says so in the record, unless the read was cancelled. */
  beforeCommit(input: TurnContext): void {
    const s = this.runs.get(input.generationId);
    const p = input.core.journal.pending[input.generationId];
    if (s?.memoryLater && p && input.kind !== "continue" && !input.signal.aborted) p.memoryNext = true;
  }

  /**
   * The turn committed: its record says which role wrote which events, its review card is made for
   * what still asks first, and its session holds the turn; a Continue's holds its reply as continued
   * (`continued`). Then it is done.
   */
  async closed(input: TurnContext): Promise<void> {
    const s = this.runs.get(input.generationId);
    if (!s) return;
    this.runs.delete(input.generationId);
    try {
      await this.landed(s, input);
      await this.session(s, input, input.kind === "continue");
    } finally {
      s.stop.abort();
      this.rt.blobs.release(s.userId, s.holder);
    }
  }

  /**
   * A Retry read's or a Re-read edit's read landed on its reply (`beginRead`): as a turn closes. A
   * Re-read edit's segment of the session is its reply's, as a turn's is; a Retry read's turn keeps
   * its own. Then its run is done.
   */
  async readClosed(key: string, at: Pick<TurnContext, "core" | "observed" | "messageId" | "swipeId">, kind: "reread" | "retry_read"): Promise<void> {
    const s = this.runs.get(key);
    if (!s) return;
    this.runs.delete(key);
    try {
      await this.landed(s, at);
      if (kind === "reread") await this.session(s, { ...at, generationId: key, content: at.observed.find((m) => m.id === at.messageId)?.swipes[at.swipeId] ?? "" }, false);
    } finally {
      s.stop.abort();
      this.rt.blobs.release(s.userId, s.holder);
      this.rt.diag.agentTurnDone(s.at);
    }
  }

  /**
   * What a run leaves once its read is on the reply's record: which role wrote which events
   * (`Rec.agents`, after those the record names already: a Re-narrate's copied plan, a Continue's
   * turn), what its roles changed in the learned area, made now in the chat's metadata (no record
   * holds it), and its review card for what still asks first.
   */
  private async landed(s: AgentRun, at: Pick<TurnContext, "core" | "observed" | "messageId" | "swipeId">): Promise<void> {
    const reply = at.core.chain(at.observed).find((m) => m.id === at.messageId);
    const rec = reply ? activeRecord(reply, at.core.journal.tombstones) : null;
    if (rec && s.committed.length > 0) {
      const agents = s.committed.flatMap(({ op, events }): RecAgent[] => {
        const place = placeOf(rec, events);
        return place ? [{ role: op.role, key: op.key, ...place }] : [];
      });
      const refused = agents.length > 0 ? at.core.recordAgents(at.messageId, at.swipeId, [...(rec.agents ?? []), ...agents], at.observed) : null;
      if (refused) this.rt.host.log("warn", `[LumiRPEngine] chat ${s.chatId}: the turn's record doesn't say which role wrote its events (${refused})`, s.userId);
    }
    if (Object.keys(s.landing).length > 0) await this.rt.chatAgents.setLearned(s.chatId, s.userId, s.landing).catch((error: unknown) => this.rt.host.log("warn", `[LumiRPEngine] chat ${s.chatId}: the turn's changes to the learned area weren't made (${error instanceof Error ? error.message : String(error)})`, s.userId));
    const items = [...s.confirm.map((op) => itemOf(op)), ...s.read];
    await this.review.make({ chatId: s.chatId, userId: s.userId, turn: `${at.messageId}:${at.swipeId}`, messageId: at.messageId, swipeId: at.swipeId, placement: "chips", text: s.text, items });
  }

  /**
   * The turn's segment of the chat's session: on the fixed pipeline a digest, the player's words and
   * the reply with what each role did and what landed; with a main agent, its own messages for the
   * turn. It carries the compaction or rollback the turn made, or on the fixed pipeline the rollback
   * GM → Workspace asked for, which no model call needs. A Continue's (`continued`) takes its reply's
   * segment's place with the reply as continued, and carries neither.
   */
  private async session(s: AgentRun, at: Pick<TurnContext, "core" | "observed" | "messageId" | "swipeId" | "generationId" | "content">, continued: boolean): Promise<void> {
    const reply = at.observed.find((m) => m.id === at.messageId);
    const content = reply?.swipes[at.swipeId] ?? at.content;
    const engine = { roles: s.ran.map((r) => ({ role: r.role, via: r.via, ok: r.ok })), committed: s.committed.map(({ op }) => ({ role: op.role, key: op.key, type: op.changeType })) };
    const digest: SessionMessage[] = [...(s.text.trim() !== "" ? [{ role: "user", content: s.text }] : []), { role: "assistant", content, engine }];
    const holder = `session:${at.generationId}`;
    try {
      let parts: RecSession;
      if (continued) parts = { segment: await this.rt.sessions.segment(s.userId, holder, await this.continued(s, at, content, digest)) };
      else {
        const chain = at.core.chain(at.observed);
        const index = chain.findIndex((m) => m.id === at.messageId);
        const rebase = s.main ? await s.main.rebased() : await rolledBack(this.rt, { chatId: s.chatId, userId: s.userId, holder: s.holder, at: sessionAt(index < 0 ? chain : chain.slice(0, index), at.core.journal.tombstones) });
        const segment = await this.rt.sessions.segment(s.userId, holder, s.main?.segment(content) ?? digest);
        parts = { segment, ...(rebase ? { summary: rebase.summary, archived: rebase.archived } : {}) };
      }
      const refused = this.rt.sessions.recordIn(at.core, at.observed, s.userId, holder, { messageId: at.messageId, swipeId: at.swipeId }, parts);
      if (refused) this.rt.host.log("warn", `[LumiRPEngine] chat ${s.chatId}: the turn's session wasn't kept (${refused})`, s.userId);
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] chat ${s.chatId}: the turn's session wasn't kept (${error instanceof Error ? error.message : String(error)})`, s.userId);
    }
  }

  /**
   * A Continue's segment of the session: its reply's own, with the reply as the Continue left it in
   * place of the reply as it was, so the reply keeps one segment. In a digest, its reply, with what
   * this read's roles did and landed after what its turn's did; after the main agent's own messages,
   * the engine's note of the reply (`main.engine.reply`), in place of the one that ended them. A
   * reply whose turn kept no segment gets this read's digest (`digest`).
   */
  private async continued(s: AgentRun, at: Pick<TurnContext, "core" | "observed" | "messageId">, content: string, digest: SessionMessage[]): Promise<SessionMessage[]> {
    const reply = at.core.chain(at.observed).find((m) => m.id === at.messageId);
    const hash = reply ? recordSessionOf(activeRecord(reply, at.core.journal.tombstones)).segment : undefined;
    const kept = hash ? segmentOf(await this.rt.blobs.getJson(s.userId, hash)) : null;
    if (!kept) return digest;
    if (kept.some(isMainMessage)) {
      const note = renderPrompt(MAIN_TEXT.engineReply, s.settings.prompts.texts, { reply: content });
      const last = kept.at(-1);
      // The reply is the player's to read: the note is read with the player character's knowledge.
      return last && isMainMessage(last) && last.role === "user" ? [...kept.slice(0, -1), { ...last, content: note }] : [...kept, { role: "user", content: note, by: MAIN_BY, knowledge: "pov" }];
    }
    const answer = kept.findLastIndex((m) => m.role === "assistant");
    const was = kept[answer];
    if (!was) return digest;
    const done = (m: SessionMessage | undefined, part: "roles" | "committed"): JsonValue[] => {
      const engine = m?.engine;
      const list = isRecord(engine) ? engine[part] : undefined;
      return Array.isArray(list) ? list : [];
    };
    const now = digest.at(-1);
    return kept.map((m, i) => (i === answer ? { ...m, content, engine: { roles: [...done(was, "roles"), ...done(now, "roles")], committed: [...done(was, "committed"), ...done(now, "committed")] } } : m));
  }

  /**
   * The engine run ended: a run that prepared its turn goes on to its reply; one that waits at a gate
   * is kept whole for its resume (`park`); a cancelled or failed one drops everything its roles
   * staged, with the run its turn left at a gate and any gate card waiting on it.
   */
  async ran(input: { chatId: ChatId; userId: UserId; turn: string; outcome: RunOutcome }): Promise<void> {
    if (input.outcome === "prepared") return;
    if (input.outcome === "waiting") {
      this.park(input.chatId, input.turn);
      return;
    }
    this.drop(input.turn);
    // A gate's turn cancelled or failed: its card goes, and the plan it held is never replayed.
    const parked = this.waiting.get(input.chatId);
    this.waiting.delete(input.chatId);
    if (parked) {
      this.release(parked);
      this.rt.bridgeOf(input.chatId)?.dropOutline(parked.text);
    }
    await this.review.dropGates(input.chatId, input.userId);
  }

  /** A generation took the prepared turn: the run is the generation's now, and a gate held for it is done. */
  async adopted(chatId: ChatId, userId: UserId, from: string, to: string): Promise<void> {
    const s = this.runs.get(from);
    if (s) {
      this.runs.delete(from);
      s.generationId = to;
      s.at = { ...s.at, turn: to };
      this.runs.set(to, s);
    }
    this.dropWaiting(chatId);
    await this.review.dropGates(chatId, userId);
  }

  /**
   * A run whose turn waits on the player at a gate, kept by its chat for the resume, nothing of it
   * stopped: its roles' calls under way go on (a mind's answer counts for the resume). The newest is
   * kept last, so the user's oldest go first past their Settings → Agents → Budgets' turns waiting
   * at a gate.
   */
  private park(chatId: ChatId, generationId: string): void {
    const s = this.runs.get(generationId);
    if (!s) return;
    this.runs.delete(generationId);
    this.dropWaiting(chatId);
    this.waiting.set(chatId, s);
    const theirs = [...this.waiting.values()].filter((w) => w.userId === s.userId);
    for (const oldest of theirs.slice(0, Math.max(0, theirs.length - s.settings.agents.kept.gates))) this.dropWaiting(oldest.chatId);
  }

  /** Whether an agent turn of the chat waits on the player at a gate, its run kept for the resume. */
  waits(chatId: ChatId): boolean {
    return this.waiting.has(chatId);
  }

  /** The chat's turn that waited at a gate won't resume (a gate's Cancel, or another turn took its place): its run goes, with what its roles staged. */
  dropWaiting(chatId: ChatId): void {
    const parked = this.waiting.get(chatId);
    if (!parked) return;
    this.waiting.delete(chatId);
    this.release(parked);
  }

  private drop(generationId: string): void {
    const s = this.runs.get(generationId);
    if (!s) return;
    this.runs.delete(generationId);
    this.release(s);
  }

  /** A run let go: its roles stop, what they staged goes, and the bodies it held are released. */
  private release(s: AgentRun): void {
    s.stop.abort();
    s.draft.clear();
    this.rt.blobs.release(s.userId, s.holder);
    this.rt.diag.agentTurnDone(s.at);
  }

  // ---------------------------------------------------------------- roles

  private agentCalls(s: AgentRun): TurnCalls {
    const r = this.roles;
    // With a main agent, a call is its request (`kind`), and the flow gets the answer it committed, or the call's none.
    const or = async <T, O>(kind: MainRequestKind, role: RoleId, phase: DiagPhase, run: RoleRun<T, O>, task: T, signal: AbortSignal, none: O): Promise<O> => {
      if (s.main) {
        const got = await s.main.request(kind, run, task, signal);
        return "out" in got ? got.out : none;
      }
      const out = await this.play(s, kind, role, phase, run, task, signal);
      return out.ok ? out.out : none;
    };
    return {
      interpret: async (task, signal) => {
        if (s.main) {
          const got = await s.main.request("interpret", r.intent.interpret, task, signal);
          return "out" in got ? { read: got.out, failed: false } : { read: null, failed: got.failed };
        }
        const out = await this.play(s, "interpret", "intent", "pre", r.intent.interpret, task, signal);
        return out.ok ? { read: out.out, failed: false } : { read: null, failed: true };
      },
      judge: (task, signal) => or("judge", "intent", "pre", r.intent.judge, task, signal, null),
      puzzle: (task, signal) => or("puzzle", "intent", "pre", r.intent.puzzle, task, signal, null),
      decisions: (task, signal) => or("decisions", "director", "pre", r.director.decisions, task, signal, null),
      minds: (task, signal) => or("minds", "minds", "pre", r.minds, task, signal, NO_MINDS),
      skipPlan: (task, signal) => or("skipPlan", "skip", "skip", r.skip.plan, task, signal, null),
      skip: (task, signal) => or("skip", "skip", "skip", r.skip.beats, task, signal, null),
      prose: (task, signal) => or<ProseTask, DirectorProse>("prose", "director", "prose", r.director.prose, task, signal, { prose: { brief: null, outline: [] } satisfies PlanProse }),
      extract: (task, signal) => or("extract", "read", "read", r.read.extract, task, signal, { proposals: [], where: null }),
      effects: (task, signal) => or("effects", "world", "read", r.world.effects, task, signal, []),
      knowledge: (task, signal) => or("knowledge", "knowledge", "read", r.knowledge, task, signal, NO_MINDS),
      offscreen: (task, signal) => or("offscreen", "director", "read", r.director.offscreen, task, signal, null),
      choices: (task, signal) => or("choices", "director", "read", r.director.choices, task, signal, []),
      memory: (task, signal) => or("memory", "memory", "memory", r.memory, task, signal, NO_MINDS),
    };
  }

  /**
   * Runs one role on its task (C9) and does as its `onFail` says when it fails: `prompt_only` runs
   * it once more as its classic call (never again when that is how it failed), `skip` goes on, and
   * `stop` stops the turn. A run that fails lands nothing it staged, whatever its `onFail`, so its
   * classic call never lands a change beside it. Under `stop` before the reply, a run whose task's
   * own classic steps failed as a classic turn would stop on (`CLASSIC_PURPOSES`) failed too, so a
   * prompt-only role stops as classic does; and once a role has stopped the turn, no later role runs.
   * A cancelled turn's role throws as classic's call would.
   */
  private async play<T, O>(s: AgentRun, kind: MainRequestKind, role: RoleId, phase: DiagPhase, run: RoleRun<T, O>, task: T, signal: AbortSignal): Promise<{ ok: true; out: O } | { ok: false }> {
    this.goingOn(s);
    const settings = s.settings.agents.roles[role];
    const watched = settings.onFail === "stop" && s.phase !== "post" ? CLASSIC_PURPOSES[kind] : undefined;
    const mark = this.rt.diag.callMark();
    let { agentId, result } = await this.runOnce(s, role, settings, run, task, signal, null);
    if (!result.ok) s.draft.drop(agentId);
    if (!result.ok && settings.onFail === "prompt_only" && !settings.promptOnly && result.via !== "prompt_only") {
      ({ agentId, result } = await this.runOnce(s, role, { ...settings, promptOnly: true }, run, task, signal, null));
      if (!result.ok) s.draft.drop(agentId);
    }
    const via = result.via ?? (settings.promptOnly ? "prompt_only" : "agent");
    const classic = result.ok && watched ? this.rt.diag.failedSince(s.at, mark, watched) : null;
    s.ran.push({ role, via, ok: result.ok && !classic });
    if (classic) {
      // Its classic call failed as a classic turn stops on: the turn stops on that, as classic says it.
      s.draft.drop(agentId);
      this.rt.diag.fatal(s.at, phase, classic.step, classic.reason);
      return { ok: false };
    }
    if (result.ok) return { ok: true, out: result.out };
    if (settings.onFail === "stop") this.roleStopped(s.at, phase, role, result.reason);
    else this.rt.host.log("warn", `[LumiRPEngine] turn ${s.generationId.slice(0, 8)}: the ${ROLE_LABEL[role]} role failed (${result.code}: ${result.reason}); the turn goes on without it`, s.userId);
    return { ok: false };
  }

  /** Before the reply, a turn a role stopped (or its main agent's failure) goes no further: the engine run fails here, with the engine-failed card naming what stopped it. */
  private goingOn(s: AgentRun): void {
    if (s.phase === "post") return;
    const stop = this.rt.diag.stopped(s.at);
    if (stop) throw new EngineFailure(stop.step, stop.reason);
  }

  /**
   * A role failed under `stop` (C9's `onFail`): the turn's own failure in Diagnostics (`fatal`),
   * which before the reply stops the turn with the engine-failed card. After the reply the read
   * stops as its Cancel stops it (`cancelRead`): the reply stands unread with Retry read, and nothing
   * the read prepared lands. A Retry read's run stops so too.
   */
  roleStopped(at: DiagAt, phase: DiagPhase, role: RoleId, reason: string): void {
    this.rt.diag.fatal(at, phase, ROLE_LABEL[role], reason);
    const s = at.turn === null ? undefined : this.runs.get(at.turn);
    if (s?.phase === "post") s.cancelRead(`the ${ROLE_LABEL[role]} role failed: ${reason}`);
  }

  /** One run of a role on its task as `settings` say, with what the main agent told it (`brief`): its answer, or why it failed; a cancelled turn's role throws as classic's call would. */
  private async runOnce<T, O>(s: AgentRun, role: RoleId, settings: RoleSettings, run: RoleRun<T, O>, task: T, signal: AbortSignal, brief: TurnBrief | null): Promise<{ agentId: string; result: RoleResult<O> }> {
    const ctx = this.ctx(s, role, settings, signal, brief);
    try {
      return { agentId: ctx.agentId, result: await run(task, ctx) };
    } catch (error) {
      // One whose phase's time ran out (Settings → Timeouts) failed, as classic's call answers nothing then.
      const fired = firedTimeout(ctx.signal);
      if (ctx.signal.aborted && !fired) throw error;
      return { agentId: ctx.agentId, result: { ok: false, code: fired ? "timeout" : "error", reason: fired ? fired.message : error instanceof Error ? error.message : String(error), usage: emptyUsage() } };
    }
  }

  /** A role's context (C10): its own agent id, a reader with its knowledge, the turn's writer for its phase, and what the main agent told it. */
  private ctx(s: AgentRun, role: RoleId, settings: RoleSettings, signal: AbortSignal, brief: TurnBrief | null): TurnAgentCtx {
    const knowledge = settings.knowledge === "own" ? null : settings.knowledge;
    const both = AbortSignal.any([signal, s.stop.signal]);
    const base = (): ChatHead | null => s.head;
    const agentId = `${role}:${s.generationId.slice(0, 8)}:${++s.agents}`;
    // Its reader and writer as a knowledge reads and checks: its role's, or a narrower one for a task (`readAs`).
    const io = (as: AgentKnowledge | null): { reader: ToolReader; writer: ToolWriter } => {
      const reader = turnReader(this.rt, base, { userId: s.userId, chatId: s.chatId, knowledge: as });
      return { reader, writer: turnWriter(this.rt, s.draft, { userId: s.userId, chatId: s.chatId, role, agentId, tier: settings.tier, knowledge: as, connectionId: settings.connectionId, phase: s.phase, base, learned: () => withLearned(s.learned, s.landing), reader, gmOps: s.settings.agents.gmOpsPerTurn, holder: s.holder, signal: both }) };
    };
    const { reader, writer } = io(knowledge);
    return { turn: s.turn, signal: both, userId: s.userId, chatId: s.chatId, generationId: s.generationId, reader, writer, role, agentId, settings, brief, readAs: io };
  }

  /** What the turn's main agent runs with (`MainHost`): the run's own state, as it stands when asked. */
  private mainHost(s: AgentRun): MainHost {
    return {
      rt: this.rt,
      chatId: s.chatId,
      userId: s.userId,
      settings: s.settings,
      turn: s.turn,
      stop: s.stop.signal,
      holder: s.holder,
      at: () => s.at,
      phase: () => s.phase,
      head: () => s.head,
      reader: (knowledge: AgentKnowledge) => turnReader(this.rt, () => s.head, { userId: s.userId, chatId: s.chatId, knowledge }),
      run: async ({ role, run, task, signal, brief, promptOnly }) => {
        const settings = s.settings.agents.roles[role];
        const as = promptOnly ? { ...settings, promptOnly: true } : settings;
        const done = await this.runOnce(s, role, as, run, task, signal, brief);
        const via = done.result.via ?? (as.promptOnly ? "prompt_only" : "agent");
        s.ran.push({ role, via, ok: done.result.ok });
        // A run that failed lands nothing it staged: the main agent's commit goes on without its role.
        if (!done.result.ok) s.draft.drop(done.agentId);
        return { agentId: done.agentId, result: { ...done.result, via } };
      },
      drop: (agentId) => s.draft.drop(agentId),
      intent: (): JsonValue => {
        const read = this.rt.bridgeOf(s.chatId)?.intentOf(s.text);
        return read ? { action: read.action, params: read.params } : null;
      },
    };
  }

  /** Commits staged operations onto `w`, in the fixed order, each re-validated on what the ones before it left (`commitStaged`). */
  private commit(s: AgentRun, ops: StagedOp[], w: Working): void {
    const head = s.head;
    if (ops.length === 0 || !head) return;
    const learned = withLearned(s.learned, s.landing);
    const commit: CommitCtx = { ctx: (knowledge) => contextOf(this.rt, { knowledge }, head, s.settings, s.learning, learned, s.active), reader: turnReader(this.rt, () => head, { userId: s.userId, chatId: s.chatId, knowledge: "gm" }), userId: s.userId, chatId: s.chatId, signal: s.stop.signal };
    const out = commitStaged(this.rt, commit, ops, w);
    // What landed, or went to the review card, of the GM's edits counts toward the turn's cap in its later phases.
    s.draft.landed([...out.committed.map((c) => c.op), ...out.confirm].filter((op) => op.tier === "gm").length);
    s.committed.push(...out.committed);
    Object.assign(s.landing, out.learned);
    s.confirm.push(...out.confirm);
    for (const { op, refusal } of out.refused) this.rt.host.log("info", `[LumiRPEngine] turn ${s.generationId.slice(0, 8)}: the ${ROLE_LABEL[op.role]} role's change ${op.key.slice(0, 12)} didn't land (${refusal.code}: ${refusal.reason})`, s.userId);
  }
}

/** A role id as a review item names it; one the card names that is no role is the read's. */
function roleOf(name: string): RoleId {
  return name in ROLE_LABEL ? (name as RoleId) : "read";
}

/** A staged operation as an item of its turn's review card: worded as the player character may read it. */
function itemOf(op: StagedOp): StoredReviewItem {
  return { key: op.key, source: "agent", role: op.role, changeType: op.changeType, lines: op.cardLines ?? [], status: "open", op: op.op, agentId: op.agentId, knowledge: op.knowledge, connection: op.connectionId };
}

/** Where `slice` sits in `events`, by value: the first run of events that equals it, or null. */
function rangeOf(events: readonly LedgerEvent[], slice: readonly LedgerEvent[]): number | null {
  if (slice.length === 0) return null;
  const want = slice.map((e) => JSON.stringify(e));
  for (let i = 0; i + want.length <= events.length; i++) if (want.every((w, j) => JSON.stringify(events[i + j]) === w)) return i;
  return null;
}

/**
 * Where an operation's events sit in `rec`, by value, as `Rec.agents` names them: in its events, else
 * in the latest of its reads after them (a Continue's `cont` entry, by its `seq`); null when nowhere.
 */
function placeOf(rec: Rec, events: readonly LedgerEvent[]): Pick<RecAgent, "from" | "to" | "seq"> | null {
  const from = rangeOf(rec.events, events);
  if (from !== null) return { from, to: from + events.length };
  for (const entry of [...rec.post].reverse()) {
    if (entry.kind !== "cont" && entry.kind !== "narr") continue;
    const at = rangeOf(entry.events, events);
    if (at !== null) return { seq: entry.seq, from: at, to: at + events.length };
  }
  return null;
}
