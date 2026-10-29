// What a turn's agent roles run with, and the contract between them and the orchestrator (INC2-SPEC
// C9, C10). Each role is a `RoleRun`: given its task and the turn's context, it answers with
// classic's own data type, so everything around it (the gates, the bridge, the plan, the read's
// filters, delivery) consumes it unchanged.
//
// A task carries what an agent working it reads, and `classic`: the classic step's own call, with
// its prompt and contract, which is the role's prompt-only mode (AGENT-LOOP-PLAN §8). The fixed
// pipeline's roles in prompt-only mode therefore make exactly the calls a classic turn makes, in the
// same order, on the same budget (`roles/classic.ts`); agent-backed roles (lane T2) work the task
// with tools through `reader` and `writer` instead, falling back on `classic` as their settings say.
//
// `writer` is the turn's own (`turn-writer.ts`): it stages into the turn's draft and never writes
// the ledger, since the turn runs inside the chat's queued ledger operation, which a write through
// the queue would wait behind for ever (classic-turn-map §10, "Deadlock").

import type { RoleId, RoleSettings } from "../../shared/agent-roles";
import type { AgentKnowledge } from "../../shared/agent-tools";
import { roleBudget } from "../../shared/agent-settings";
import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { PromptTexts } from "../../shared/prompts";
import type { LedgerEvent } from "../../shared/ledger";
import type { WorldCurrency, WorldDoc } from "../../shared/world";
import type { Judgement } from "../../engine/adjudication";
import type { PlaceChoice } from "../../engine/place-names";
import type { WorldState } from "../../engine/state";
import type { CatalogEntry } from "../interpret-context";
import type { PostMindsInput, PostOpening, PreMindsInput, RunMindsResult } from "../minds";
import type { Runtime } from "../runtime";
import type { BeatMinds, SkipInput, SkipRun } from "../skip";
import type { SkipPlanInput } from "../skip-plan";
import type { ExtractRead, InterpretContext, InterpretRead } from "../steps";
import type { JudgeAsk, Tie, TieOdds } from "../turn-steps";
import type { PlanProse } from "../turn-model";
import type { TaskReads } from "./brief";
import { type AgentHandle, type AgentSpec, type AgentTurn, startAgent } from "./runtime";
import type { ToolReader } from "./tools/read-view";
import type { ToolWriter } from "./tools/writer";
import type { AgentUsage } from "./usage";

/** C10: what one role's run gets of its turn. */
export interface TurnAgentCtx {
  /** The turn's agents together: their tokens, tool rounds and time against the turn's budget (Settings → Agents → Budgets). */
  turn: AgentTurn;
  /** Ends when the turn is cancelled, its phase's time runs out, or the orchestrator stops the role. */
  signal: AbortSignal;
  userId: UserId;
  chatId: ChatId;
  generationId: string;
  /** Reads the head before the plan and the planned head after it, as the role's knowledge has it; never through the ledger's queue. */
  reader: ToolReader;
  /** The turn's writer (`turnWriter`): stages into this turn's draft; never `rt.ledger.write`. */
  writer: ToolWriter;
  role: RoleId;
  agentId: string;
  settings: RoleSettings;
  /**
   * What the main agent told this run (`pipeline.mode: main`, C14): its task, then each revision it
   * sent, framed by the Main agent page's texts, as each task of the run may be told it (`TurnBrief`);
   * an agent-backed role puts it after its own instructions. Null on the fixed pipeline, and for
   * another role's run inside this one's (`roleCtx`); ignored by a prompt-only run, which is
   * classic's own call.
   */
  brief: TurnBrief | null;
  /** The texts its role's agents are told in place of the user's own (Test's, with the text it checks in place); absent in play. */
  texts?: PromptTexts;
  /**
   * The same run's reader and writer as `knowledge` reads and checks, for a task its role works with
   * less than the role reads with (the director's brief and outline, as the player character): the
   * same turn, its head and draft, its agent id and its tier.
   */
  readAs(knowledge: AgentKnowledge): { reader: ToolReader; writer: ToolWriter };
}

/** The main agent's words for a run, as a task of it reading with `reads` may be told them: the lines that name nothing that knowledge doesn't reach (`screenBrief`). */
export interface TurnBrief {
  for(reads: TaskReads): string;
}

/**
 * C9: how a role's run ended: its answer, as classic's type, with what it spent and whether it came
 * from an agent or the one prompt-only call; or why it failed. A failure may say how it was run, so
 * the orchestrator never runs a role that failed prompt-only the same way again.
 */
export type RoleResult<O> = { ok: true; out: O; usage: AgentUsage; via: "agent" | "prompt_only" } | { ok: false; code: string; reason: string; usage: AgentUsage; via?: "agent" | "prompt_only" };

export interface RoleRun<I, O> {
  (input: I, ctx: TurnAgentCtx): Promise<RoleResult<O>>;
}

/** A role's task: the classic step's own call, the role's prompt-only mode, on the signal it is given. */
export interface RoleTask<C> {
  classic(signal: AbortSignal): Promise<C>;
}

// ---------------------------------------------------------------- the tasks, by role

/** What classic's `interpret` call came back with: the read, or none; `failed` when its call failed (none left in the budget is no failure). */
export interface InterpretOutcome {
  read: InterpretRead | null;
  failed: boolean;
}

/** intent: read the player's message into actions, from the catalog the player character may play now. Its answer goes through classic's post-processing (claims, Try, payees, leaks, unfit). */
export interface InterpretTask extends RoleTask<InterpretOutcome> {
  text: string;
  world: WorldDoc;
  state: WorldState;
  catalog: readonly CatalogEntry[];
  /** What classic's call reads besides the catalog: the world's name and money, the player character, and the scene as it knows it. */
  context: InterpretContext;
  /** The world's or the user's own words for the interpret step, filled in, which lead it; null for none. */
  instructions: string | null;
}

/** intent: rate the approach the player described for the check `action` would roll. */
export interface JudgeTask extends RoleTask<Judgement | null> {
  text: string;
  action: string;
  world: WorldDoc;
  state: WorldState;
  /** What classic's call asks: the action in words, the player's words, the scale, the scene as the player may know it, and the story's odds when it decides. */
  ask: JudgeAsk;
  /** The world's or the user's own words for the judge step; null for the shipped question. */
  template: string | null;
}

/** intent: the probability that the player's answer to a puzzle is right (`params.decision`). */
export interface PuzzleTask extends RoleTask<number | null> {
  answer: string;
  question: string;
  world: WorldDoc;
  state: WorldState;
  /** The answers the puzzle accepts: a secret, which only this call is told. */
  accepted: readonly string[];
  /** The world's or the user's own words for the puzzle step; null for the shipped question. */
  template: string | null;
}

/** director: the odds for each open tie, the people present's before the plan or the off-screen ones after the reply. */
export interface ChooseTask extends RoleTask<TieOdds | null> {
  phase: "pre" | "post";
  ties: readonly Tie[];
  world: WorldDoc;
  state: WorldState;
  /** What is known of a tie, as classic's question gives it: who, where, when, and its options. */
  describe(tie: Tie): JsonValue;
  /** The world's or the user's own words for the npc.choose step; null for the shipped question. */
  template: string | null;
  /** Whether the chat tracks knowledge (`knowledgeOn`): each decision then reads its chooser's holdings. */
  knowing: boolean;
  /**
   * Before the plan: the player's message, which everyone with the player character heard, and the
   * hand that takes what the people a decision turns on learned from it before they decide
   * (`learned`): the turn records it ahead of its decisions. `connection`: the one the turn's helper
   * calls run on, which their learning counts on where the knowledge step's own route names none, as
   * the read's does. Null after the reply.
   */
  heard: { messageId: MessageId; text: string; connection: string | null; learned(events: readonly LedgerEvent[]): void } | null;
}

/** minds: each mind the scene, the ladder and the cadence call thinks, before the plan. */
export interface MindsTask extends RoleTask<RunMindsResult> {
  input: Omit<PreMindsInput, "signal">;
}

/**
 * memory: their memory of what was written, and consolidation, after the reply or first in the next
 * turn. An agent turn's reads the post phase's opening (`postOpening`), which its reply's turn
 * recorded; a classic turn's is its whole post phase, so it has none.
 */
export interface MemoryTask extends RoleTask<RunMindsResult> {
  input: Omit<PostMindsInput, "signal">;
  opening: PostOpening | null;
}

/** knowledge: what each person present or told learned, inferred, doubted or forgot after the reply (the knowledge step's output, checked by its checks), on the post phase's opening. */
export interface KnowledgeTask extends RoleTask<RunMindsResult> {
  input: Omit<PostMindsInput, "signal">;
  opening: PostOpening;
}

/** skip: a timelapse's skip plan (`castlife.skip_plan`), from the state the span starts at. */
export interface SkipPlanTask extends RoleTask<LedgerEvent | null> {
  world: WorldDoc;
  state: WorldState;
  input: Omit<SkipPlanInput, "signal">;
  /** The plan's own log lines, as classic's go. */
  log: (message: string) => void;
}

/** skip: a time skip's beats, with the minds at them (`SkipRecord`). */
export interface SkipTask extends RoleTask<SkipRun | null> {
  world: WorldDoc;
  state: WorldState;
  input: Omit<SkipInput, "signal">;
  /** The minds at its beats, as the turn runs and counts them (`BeatMinds`). */
  minds: BeatMinds;
}

/** scene: the live lore and the notes the narrator should have for this turn's scene. */
export interface SceneTask extends RoleTask<SceneOut> {
  text: string;
  world: WorldDoc;
  state: WorldState;
}

/** What the scene gives the narrator: live lore ids, and notes, with the knowledge they were written with (its role's; a scene told only its task, the player character's), which the narrator's sections hold them to. */
export interface SceneOut {
  lore: string[];
  notes: string[];
  knowledge: AgentKnowledge;
}

/** What one prose step would write this turn, as classic writes it. */
export interface ProseAsk {
  /** The world's or the user's own words for the step (each of its runs', in order), filled in; null for the shipped. */
  template: string | null;
  /** The facts it reads, as classic fills them (`safeVars`). */
  vars: Readonly<Record<string, string>>;
  /** Whether a line it writes is withheld whole: it carries an unrevealed secret, or names someone or something hidden that it wasn't told. */
  withheld(line: string): boolean;
}

/** director: the brief and the prose outline for the planned turn, from the plan's own lines. */
export interface ProseTask extends RoleTask<PlanProse> {
  /** The engine's lines for the planned turn, as classic tells them (its Outcome, Montage and beats). */
  lines: { outcome: readonly string[]; montage: readonly string[]; beats: readonly string[] };
  world: WorldDoc;
  state: WorldState;
  /** What the brief and the outline steps would write this turn: each null when it doesn't run. */
  brief: ProseAsk | null;
  outline: ProseAsk | null;
}

/** What the director gives the narrator for a planned turn: its prose, and lines of its own where it rewrote the engine's (none: the engine's stand). */
export interface DirectorProse {
  prose: PlanProse;
  lines?: { outcome?: string[]; montage?: string[]; outline?: string[] };
}

/** What classic's `extract` reads of the reply's turn, besides the reply. */
export interface ExtractInput {
  /** The world as the player character may know it (`povWorld`). */
  world: WorldDoc;
  /** The state before the reply, as extract is told it (`prefixSummary`). */
  prefix: JsonValue;
  /** The minutes the turn already applied: narrated time counts only beyond them. */
  appliedMinutes: number;
  /** The change types it may propose. */
  channels: string[];
  /** The world's or the user's own words for the extract step, filled in, which lead it; null for none. */
  instructions: string | null;
  /** The usual routines of the people with the player character, as it may know them. */
  usual: readonly string[];
  /** The player's message the reply answers. */
  said: string;
  /** The places it is offered by name. */
  places: readonly PlaceChoice[];
  /** The kinds a newcomer may be. */
  personKinds: readonly string[];
}

/** read: the reply's proposals in extract's contract, and where it leaves the player character. */
export interface ExtractTask extends RoleTask<ExtractRead> {
  reply: string;
  world: WorldDoc;
  state: WorldState;
  input: ExtractInput;
}

/** world: a world `effects` step's proposals for the reply, its author's text the task's instructions. */
export interface EffectsTask extends RoleTask<JsonObject[]> {
  /** The step's text as its author wrote it; empty for a world with no effects step. */
  template: string;
  world: WorldDoc;
  /** The facts it reads, as classic fills them. */
  vars: Readonly<Record<string, string>>;
  currency: WorldCurrency;
}

/** director: suggested next moves for the player, after the reply. */
export interface ChoicesTask extends RoleTask<string[]> {
  reply: string;
  /** The world's or the user's own words for the choices step, filled in; null for the shipped. */
  template: string | null;
  vars: Readonly<Record<string, string>>;
  withheld(line: string): boolean;
}

/**
 * The fixed pipeline's roles, each task a run (C9). The world's own steps are the `world` role's: an
 * `effects` step after the reply here, and the main agent's named subtasks (lane T3).
 */
export interface TurnRoles {
  intent: { interpret: RoleRun<InterpretTask, InterpretRead | null>; judge: RoleRun<JudgeTask, Judgement | null>; puzzle: RoleRun<PuzzleTask, number | null> };
  scene: RoleRun<SceneTask, SceneOut>;
  minds: RoleRun<MindsTask, RunMindsResult>;
  knowledge: RoleRun<KnowledgeTask, RunMindsResult>;
  director: { decisions: RoleRun<ChooseTask, TieOdds | null>; prose: RoleRun<ProseTask, DirectorProse>; choices: RoleRun<ChoicesTask, string[]>; offscreen: RoleRun<ChooseTask, TieOdds | null> };
  read: { extract: RoleRun<ExtractTask, ExtractRead> };
  world: { effects: RoleRun<EffectsTask, JsonObject[]> };
  memory: RoleRun<MemoryTask, RunMindsResult>;
  skip: { plan: RoleRun<SkipPlanTask, LedgerEvent | null>; beats: RoleRun<SkipTask, SkipRun | null> };
}

// ---------------------------------------------------------------- an agent for a role

/** What an agent-backed role says of itself; the rest comes from its role's settings. */
export type RoleAgentSpec = Omit<AgentSpec, "role" | "connectionId" | "model" | "effort" | "budget">;

/**
 * Starts an agent for `ctx`'s role in its turn (R1's runtime): on the role's connection, model and
 * effort, with every agent's budget under the role's own limits (`roleBudget`), its revisions among
 * them, and against the turn's shared budget (`ctx.turn`). Its caching is the role's under every
 * agent's caching (`agents.caching.roles`, else every role's: `roleCaching`), which the provider
 * reads for each call. Settings are the user's as the turn read them.
 */
export function startRoleAgent(rt: Runtime, ctx: TurnAgentCtx, spec: RoleAgentSpec): AgentHandle {
  const settings = rt.settings.known(ctx.userId);
  if (!settings) throw new Error("the user's settings aren't read yet");
  const agents = settings.agents;
  return startAgent(
    { ...spec, role: ctx.role, connectionId: ctx.settings.connectionId, model: ctx.settings.model, effort: ctx.settings.effort, budget: roleBudget(agents, ctx.role) },
    { host: rt.host, userId: ctx.userId, settings: agents, texts: settings.prompts.texts, accounts: rt.agentAccounts, turn: ctx.turn },
  );
}
