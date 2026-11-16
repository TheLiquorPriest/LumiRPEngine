// What today's settings store reads of Settings → Agents (AGENT-LOOP-PLAN §15; INC1-SPEC R1, R6a;
// INC2-SPEC C12): what the agent runtime runs under, kept in `UserSettings.agents`. Today's code,
// carried for the migration (PlanSwap-15 item 3; READINGS R-85): the settings, their defaults and
// their reader, so the file's agents part reads as it always read. What stays with the agents engine,
// which PlanSwap-10 removes: the page's words (each limit's label and what it limits and does when
// reached; here a limit keeps only the least it takes and whether it may be "none"), the budgets the
// runtime works out from these, and the acceptance runs' views.

import { hasOwn, isRecord, safeKey } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import { limitIn } from "../../shared/minds";
import { HELPER_MAX_TOKENS } from "../../shared/settings";
import { TIMELAPSE_REACH_MINUTES } from "../../shared/time-reach";
import { KEPT_FOLDS_DEFAULT } from "../../engine/ledger/fold";
import { type ContextSettings, contextSettingsOf, defaultContextSettings } from "./agent-context";
import { CURATOR_GATES, type CuratorGate, defaultStages, MAIN_STAGES, type MainStages, roleRunOf, STAGE_MODES } from "./agent-pipeline";
import { defaultRoleSettings, ROLE_IDS, ROLE_ON_FAIL, ROLE_TIERS, type RoleId, type RoleSettings, TOOL_FAMILIES, type ToolFamily } from "./agent-roles";

/**
 * How hard an agent's model reasons (§8): off, an effort, `model` ("set by the model", for alias
 * models such as `argon-4-high`, which choose their own), or `inherit`: the connection's reasoning
 * binding, else the user's Lumiverse setting.
 */
export type AgentEffort = "off" | "low" | "medium" | "high" | "model" | "inherit";
export const AGENT_EFFORTS: readonly AgentEffort[] = ["off", "low", "medium", "high", "model", "inherit"];

/**
 * One agent's budget (a role's handle, for the turn it lives in): each call, everything its calls
 * send and write, its rounds of tool calls, its time, the messages it may be sent after its first
 * answer, and how many of its tool calls run at once. "none" is no limit.
 */
export interface AgentBudget {
  /** The prompt one call may send, in tokens, as estimated before it is sent. */
  callTokensIn: Limit;
  /** What one call may write (`max_tokens`), its reasoning included. */
  callTokensOut: number;
  /** How long one call may take, in milliseconds. */
  callMs: Limit;
  /** Tool calls one answer may make; those past it are refused. */
  callTools: Limit;
  /** Tokens the agent's calls send in all. */
  tokensIn: Limit;
  /** Tokens they write in all. */
  tokensOut: Limit;
  /** Rounds of tool calls: answers that call tools. */
  toolTurns: Limit;
  /** How long the agent may work from its first message, in milliseconds. */
  wallMs: Limit;
  /** Messages it may be sent after its first answer (§2's revision cap). */
  revisions: number;
  /** Fresh runs the main agent's run_role may start of a request whose run answered (a turn role's only): each drops what the run before it staged, and its revisions start again. */
  reruns: number;
  /** Its tool calls run at once, at most. */
  concurrency: number;
}

/** Every agent of one turn together: the turn's tokens, rounds of tool calls and time. */
export interface TurnBudget {
  tokensIn: Limit;
  tokensOut: Limit;
  toolTurns: Limit;
  wallMs: Limit;
}

/** A connection's throttle: requests sent and tokens sent and written, per minute, and its calls under way at once, agent and prompt-only calls alike. "none" is off. */
export interface ConnectionThrottle {
  /** The connection's id. */
  id: string;
  requestsPerMinute: Limit;
  tokensPerMinute: Limit;
  /** Its agent turns' calls under way at once, agents' and prompt-only roles' through one gate; a call past it waits for one to end. */
  atOnce: Limit;
}

/**
 * A connection under Acceptance runs (§12): with `only`, refused unless an acceptance run is open;
 * while one is, what it may send and write in that run. Every call reserves its estimated prompt
 * plus its `max_tokens` before it is sent, and one that would pass a ceiling isn't sent.
 */
export interface AcceptanceConnection {
  /** The connection's id. */
  id: string;
  only: boolean;
  tokensIn: Limit;
  tokensOut: Limit;
}

/** A role's own caching (§8): on or off, and the nonce Bust changes; absent, a role follows `caching`. */
export interface RoleCaching {
  on: boolean;
  nonce: string;
}

/** How the GM assistant's changes land: each proposal waits for your Apply or No (`ask`), or applies as soon as it has answered, with an Undo chip (`at_once`). */
export type AssistantApply = "ask" | "at_once";
export const ASSISTANT_APPLY: readonly AssistantApply[] = ["ask", "at_once"];

/**
 * The GM assistant (GM → Assistant; Settings → Agents → Assistant), which works outside the story
 * and reads everything: the connection and model it runs on (null: your default connection, and that
 * connection's model), its effort, how its changes land, how much of its thread goes with each
 * message, and its budget. An earlier build's `knowledge` is read and ignored.
 */
export interface AssistantSettings {
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  apply: AssistantApply;
  /** The thread's past messages sent with each message, newest first, in tokens; the older ones are left out, with a note (`gm.history_note`) saying how many. */
  historyTokens: number;
  /** Its own limits over `AgentSettings.budget`: each one set here stands in for that one; the rest are every agent's. */
  budget: Partial<AgentBudget>;
}

/** How an agent turn is run (Settings → Agents → Pipeline): §5's roles in classic's order (`fixed`), or a main agent per chat deciding (`main`). */
export type PipelineMode = "fixed" | "main";
export const PIPELINE_MODES: readonly PipelineMode[] = ["fixed", "main"];

/** When the minds' memory and consolidation run in an agent turn: after its reply, inside the read, as classic does (`after_reply`), or first in the next turn's pre phase (`before_next`), whose pre events they then are. */
export type MemoryPlacement = "after_reply" | "before_next";
export const MEMORY_PLACEMENTS: readonly MemoryPlacement[] = ["after_reply", "before_next"];

/** Where an agent turn's changes that ask first wait (C13; Settings → Agents → Review card): on the review card after the reply, the narrator untold until you apply them (`chips`), or on the card before the reply, the turn waiting as at the outline gate (`gate`). */
export type ReviewPlacement = "chips" | "gate";
export const REVIEW_PLACEMENTS: readonly ReviewPlacement[] = ["chips", "gate"];

export interface PipelineSettings {
  mode: PipelineMode;
  memory: MemoryPlacement;
  /**
   * The Curator on agent chats (ITEMS-SPEC §7.1, I9): it keeps things, places, walk-on people and
   * purchases true to the reply, and the read proposes none of those; off, the read does, as classic's.
   */
  curator: boolean;
  /** The Curator's quiet-turn gate (Settings → Agents → Roles → Curator → When it runs): `shadow` records what it would decide; `on` lets a quiet reply skip the Curator, the read's held changes landing instead. */
  curatorGate: CuratorGate;
}

/** When the compaction the next turn needs is made (Settings → Agents → Main agent → Session): during the turn before, in the background, so the next turn finds it made (`ahead`), or as that turn starts, before its first stage (`before_turn`). */
export type CompactionWhen = "ahead" | "before_turn";
export const COMPACTION_WHEN: readonly CompactionWhen[] = ["ahead", "before_turn"];

/** The compaction's effort: one of an agent's efforts, or the main agent's own (`main`). */
export type CompactionEffort = AgentEffort | "main";
export const COMPACTION_EFFORTS: readonly CompactionEffort[] = ["main", ...AGENT_EFFORTS];

/**
 * The main session's compaction (Settings → Agents → Compaction; Main agent → Session): once it
 * passes `atTokens`, all but the last `keepTurns` turns are summarized; `summarizeTool` gives the
 * main agent its summarize tool. `when` says when the summary is made; it is written on
 * `connectionId` and `model` (null: the main agent's) with `effort`, at most `summaryTokens` long.
 */
export interface CompactionSettings {
  atTokens: number;
  keepTurns: number;
  summarizeTool: boolean;
  when: CompactionWhen;
  connectionId: string | null;
  model: string | null;
  effort: CompactionEffort;
  summaryTokens: number;
}

/** What an agent turn records for the narrator (Settings → Agents → Recording): each output event's text, in characters at most. */
export interface RecordingSettings {
  outputChars: number;
}

export interface ReviewSettings {
  placement: ReviewPlacement;
}

/**
 * What one call of a harness tool may span at most (`docs/harness-tools.md`). A setting, so a world
 * that needs more room can be given it; a call past it is refused with the bound in its reason.
 */
export interface HarnessLimits {
  /** The farthest one `time_pass` moves the clock, in minutes; never past the engine's own reach for a timelapse. */
  timePassMinutes: number;
}

/**
 * Whether a harness chat is played with Sovereign Hand (Lumiverse's own name for it): the player's
 * messages are directions to the author, not what their character says and does. `follow`: as
 * Lumiverse's own Sovereign Hand switch is; `on` and `off` whatever it is.
 */
export type SovereignHand = "follow" | "on" | "off";
export const SOVEREIGN_HANDS: readonly SovereignHand[] = ["follow", "on", "off"];

/** With Sovereign Hand on, what the author is given of the player's newest message: it, as the direction for the reply (`direction`), or nothing, where the preset carries it (`leave_out`). */
export type NewestMessage = "direction" | "leave_out";
export const NEWEST_MESSAGES: readonly NewestMessage[] = ["direction", "leave_out"];

/** What the engine still does by itself on a turn the harness plays (HARNESS-SLICE3): there the author decides the turn through tools, and only its consequences stay the engine's. */
export interface HarnessSettings {
  /**
   * When a turn ends and no agent of it said how much time it took (`time_pass`, a clock set), its
   * last commit applies the scene's default tick, as a classic turn's plan does, and the turn's
   * record says so. Off: such a turn takes no time. A turn whose author said no time passed takes
   * none either way.
   */
  defaultTick: boolean;
  /**
   * How long the start of a turn waits for the turn before it to finish being recorded, in
   * milliseconds, so its author reads the world whole. A turn's tail never holds the player: when
   * the wait runs out the turn goes on, and its author is told the last turn's changes may not all
   * be in. LumiAH bounds every answer of the engine's too (its "Wait for the extension", ten
   * seconds as shipped), so a wait longer than that is cut there.
   */
  commitWaitMs: number;
  /**
   * How many runs that are over the engine keeps track of at once: each turn that committed or was
   * let go, each job's run and the turn it belongs to, and who the agents of each were (the person
   * a character's agent thinks for, who started what). Bookkeeping, not a limit on any agent: a run
   * older than that is forgotten, and a call that still comes from it is answered that no turn is
   * open. The engine's tables hold every user's runs together, so the number in force is that of
   * the user whose run it last heard begin.
   */
  runsRemembered: number;
  /** Whether the user's chats on the harness are played with Sovereign Hand (`SovereignHand`). The chat's claim passes it to LumiAH, which gives the author the direction. */
  sovereignHand: SovereignHand;
  /** With Sovereign Hand on, what the author is given of the player's newest message (`NewestMessage`). */
  newestMessage: NewestMessage;
}

/** What a final review that fails does (Settings → Agents → Main agent → Final review): the narrator gets the sections as the engine made them, with a Diagnostics record (`send`), or the turn stops with the engine-failed card and its Retry (`stop`). */
export type FinalReviewOnFail = "send" | "stop";
export const FINAL_REVIEW_ON_FAIL: readonly FinalReviewOnFail[] = ["send", "stop"];

/** What the final review is sent: every part of the narrator's prompt (`all`), or, while Smart persistence is on, only the parts that changed since the last turn, the last turn's edits made again on the rest (`changed`). */
export type FinalReviewScope = "all" | "changed";
export const FINAL_REVIEW_SCOPES: readonly FinalReviewScope[] = ["all", "changed"];

/**
 * The final review (DESIGN §4.6; Settings → Agents → Main agent → Final review): while on, before
 * every reply of an agent chat the main agent reviews the narrator's prompt and may revise it, in
 * either pipeline; what a review that fails does; what it is sent; and its own limits over the main
 * agent's budget for a stage. Its time is Settings → Timeouts → Final review.
 */
export interface FinalReviewSettings {
  on: boolean;
  onFail: FinalReviewOnFail;
  scope: FinalReviewScope;
  budget: Partial<AgentBudget>;
}

/**
 * Smart persistence (Settings → Agents → Pipeline; opt-in, for every agent chat): while a scene is
 * unchanged since the last turn (`SceneBasis`), for at most `turns` turns in a row and `minutes` of
 * the world's time since its roles last ran afresh, the in-scene Live minds and the scene role's lore
 * and notes are kept instead of asked again, recorded as this turn's, the narrator told they are
 * unchanged.
 */
export interface PersistSettings {
  on: boolean;
  turns: number;
  minutes: number;
}

/**
 * What the engine keeps in memory, each the most it holds at once (Settings → Agents → Budgets):
 * turns under way (a turn that went stale unheard is let go with the oldest), a user's turns waiting
 * at a gate, each with its whole run for the resume (one let go resumes afresh; a review gate's still
 * replays its plan, but its record keeps neither what the run committed nor its lines for the
 * narrator), chats whose review cards a page listens to (one let go hears the cards again when it
 * next asks for them), chats whose latest agent run GM → Live keeps, each with everything its agents
 * did and the pages that watch it (one let go shows nothing until its next run; its turn's transcript
 * stays in GM → Workspace), the characters of the agents' stored texts kept once read (`texts`: the
 * main session's turns, the GM assistant's thread, workspace files; one let go is read from storage
 * again), the messages of the user's chats kept worked out (`folds`: the fold's steps, each with
 * what it did to the world; one let go is worked out again from the nearest state kept or stored),
 * and how long a chat read for the agents outside a turn and the story's pages is kept while nothing
 * in it changes (`chatMs`, in ms: `backend/chat-read.ts`; 0 keeps none, every read asks the host).
 */
export interface KeptSettings {
  runs: number;
  gates: number;
  watchers: number;
  live: number;
  texts: number;
  folds: number;
  chatMs: number;
}

/** What the main session keeps of each past turn (Settings → Agents → Main agent → Session): receipts of its long messages and results (`receipts`), or its messages whole (`whole`). Either way the full messages stay with the turn, which `past_turn` reads. */
export type SessionKeeps = "receipts" | "whole";
export const SESSION_KEEPS: readonly SessionKeeps[] = ["receipts", "whole"];

/**
 * The main agent (Settings → Agents → Main agent; INC2-SPEC C14), while the pipeline has one decide:
 * the connection and model it runs on (null: your default connection, and that connection's model),
 * its effort, its tool families (read only: it changes nothing itself; they read everything, secrets
 * marked, as every turn agent's do), its own limits over `budget` for each stage it works, and its
 * turn task's parts in tokens at most: the digest of what changed since its last turn, and its pinned
 * files where `.pins.json` sets no budget for it, which is every role's pins budget too. Its session
 * keeps each past turn as `sessionKeeps` says, a receipt keeping `receiptChars` of each answer.
 */
export interface MainAgentSettings {
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  families: ToolFamily[];
  budget: Partial<AgentBudget>;
  digestTokens: number;
  pinsTokens: number;
  /** How each stage runs (Settings → Agents → Main agent → Stages): the main agent decides it, or its roles run on their own and the next send says what ran. */
  stages: MainStages;
  sessionKeeps: SessionKeeps;
  receiptChars: number;
}

export interface AgentSettings {
  /**
   * "Thinking in agent tool loops" (§2, decided A): while off, every call that offers tools goes
   * with reasoning off, whatever the role's effort, since Lumiverse doesn't yet pass back the
   * thinking blocks a reasoning model must be sent again after a tool call. Calls without tools
   * keep the role's effort.
   */
  thinkingInToolLoops: boolean;
  /**
   * Streaming (Settings → Agents → Streaming): every agent call takes its answer as Lumiverse
   * streams it (`generate.quietStream`), so the provider's connection carries a long answer as it
   * is written, never idle until it is whole, which a gateway or proxy between may cut; the answer
   * reads the same, and each time limit still counts the whole call. Off, each call waits for its
   * answer whole (`generate.quiet`).
   */
  stream: boolean;
  /** Each agent's budget, unless its role sets its own (Settings → Agents → Roles, Increment 2). */
  budget: AgentBudget;
  /** Every agent of a turn together. */
  turn: TurnBudget;
  /** The loop detector: the same tool call with the same arguments this many times in a row stops the agent. */
  loopRepeats: number;
  /** How much of one answer of the engine's own tools an agent is shown whole, in characters: on the harness the world tools' answers (a longer value as an outline, a list cut to half of it); on the agents engine any tool result, clipped past it with the rest in scratch for `scratch_read`. LumiAH's own clip is LumiAH's setting. */
  clipChars: number;
  /** Per connection; a connection not listed has none. */
  throttles: ConnectionThrottle[];
  /** Calls under way at once on every connection whose throttle sets none of its own (Settings → Speed → Calls, Settings → Agents → Throttles). */
  callsAtOnce: Limit;
  /**
   * Caching (§8): explicit cache breakpoints where the provider takes them, on for every role unless
   * its own says otherwise. `nonce`, changed by Bust, heads every role's prompt that has none of
   * its own, so the provider's cached prefix no longer matches; empty sends none.
   */
  caching: { on: boolean; nonce: string; roles: Record<string, RoleCaching> };
  /** Acceptance runs (§12): the connections they guard, and the estimate factor for a model not yet seen. */
  acceptance: { connections: AcceptanceConnection[]; estimateFactor: number };
  /** The GM assistant (Settings → Agents → Assistant). */
  assistant: AssistantSettings;
  /** How an agent turn is run, and where its memory goes (Settings → Agents → Pipeline). */
  pipeline: PipelineSettings;
  /** Each role of an agent turn (Settings → Agents → Roles). */
  roles: Record<RoleId, RoleSettings>;
  /** The main agent (Settings → Agents → Main agent): it decides each turn while `pipeline.mode` is `main`, and works every agent turn's final review in either pipeline. */
  main: MainAgentSettings;
  /** What each role starts with and how the main agent is to brief it (Settings → Agents → Context). */
  context: ContextSettings;
  /** The final review of the narrator's prompt before each reply (Settings → Agents → Main agent → Final review). */
  finalReview: FinalReviewSettings;
  /** Smart persistence (Settings → Agents → Pipeline): a quiet scene's minds and scene notes kept from the last turn. */
  persist: PersistSettings;
  /** The GM's edits a turn's agents may stage in all, per turn (Settings → Agents → Budgets). */
  gmOpsPerTurn: number;
  /** The changes to things and places the Curator may stage in a turn (Settings → Agents → Roles, Curator ops per turn). */
  curatorOps: number;
  /** What the engine keeps in memory for agent turns (Settings → Agents → Budgets). */
  kept: KeptSettings;
  compaction: CompactionSettings;
  recording: RecordingSettings;
  /** Where an agent turn's changes that ask first wait (Settings → Agents → Review card). */
  review: ReviewSettings;
  /** The acceptance comparison's target (Settings → Agents → Acceptance runs; INC2-ACCEPTANCE): per role, an agent turn's tokens at most this many times the classic turn's of the same scenario. Nothing in the engine enforces it: the comparison reads both turns' tokens from Diagnostics. */
  vsClassic: number;
  /** How much of each agent's prompt its system files may take together (Settings → Agents → System instructions): AGENTS.md and roles/<role>.md, the global workspace's and the chat's, in tokens. */
  systemTokens: number;
  /** What the engine still does by itself on a turn the harness plays (GM → This chat → Engine: Harness; HARNESS-SLICE3). */
  harness: HarnessSettings;
  /** How far one call of a harness tool may span at most, on a chat the harness plays: one `time_pass`'s time. */
  harnessLimits: HarnessLimits;
}

/** A new user's agent settings: §15's defaults. */
export function defaultAgentSettings(): AgentSettings {
  return {
    thinkingInToolLoops: false,
    stream: true,
    budget: { callTokensIn: "none", callTokensOut: HELPER_MAX_TOKENS, callMs: "none", callTools: "none", tokensIn: "none", tokensOut: "none", toolTurns: 10, wallMs: "none", revisions: 2, reruns: 1, concurrency: 4 },
    // No turn-wide limit: a fixed pipeline on a long chat sends well past any number that fits a short one, and each agent's own limits stand.
    turn: { tokensIn: "none", tokensOut: "none", toolTurns: "none", wallMs: "none" },
    loopRepeats: 3,
    // 8,000 characters: one long lore entry or a world document's larger part is 6,000 to 12,000, and every outline or cut list here costs the agent another round to read on.
    clipChars: 8000,
    throttles: [],
    callsAtOnce: "none",
    caching: { on: true, nonce: "", roles: {} },
    acceptance: { connections: [], estimateFactor: 2 },
    // The assistant reads everything, outside the story, and its changes wait for your Apply.
    assistant: { connectionId: null, model: null, effort: "inherit", apply: "ask", historyTokens: 20_000, budget: {} },
    pipeline: { mode: "fixed", memory: "after_reply", curator: true, curatorGate: "shadow" },
    roles: defaultRoleSettings(),
    // The main agent reads the workspace, everything secrets marked as every turn agent does; its digest and pins, 2,000 tokens each (§15). Past turns stay as receipts, each answer's first 600 characters.
    main: { connectionId: null, model: null, effort: "inherit", families: ["workspace"], budget: {}, digestTokens: 2000, pinsTokens: 2000, stages: defaultStages(), sessionKeeps: "receipts", receiptChars: 600 },
    context: defaultContextSettings(),
    // The final review is on, sees every part, and a review that fails sends the sections unrevised; its budget is the main agent's.
    finalReview: { on: true, onFail: "send", scope: "all", budget: {} },
    // Opt-in: every role runs every turn it is asked until you turn it on (B decision 6).
    persist: { on: false, turns: 3, minutes: 30 },
    gmOpsPerTurn: 10,
    curatorOps: 24,
    // A change of the chat ends a kept read at once: five minutes is a backstop for one the host tells of no way.
    kept: { runs: 64, gates: 256, watchers: 256, live: 16, texts: 4_000_000, folds: KEPT_FOLDS_DEFAULT, chatMs: 5 * 60_000 },
    // The summary is made ahead, on the main agent's route, 16,000 tokens at most (Build C).
    compaction: { atTokens: 32_000, keepTurns: 3, summarizeTool: true, when: "ahead", connectionId: null, model: null, effort: "main", summaryTokens: 16_000 },
    recording: { outputChars: 2000 },
    review: { placement: "chips" },
    vsClassic: 2,
    // Room for a page or two of instructions at each level; files that aren't there cost nothing.
    systemTokens: 8000,
    // A turn takes its scene's time unless its author said otherwise, as every other engine's turn does. Recording a turn takes well under a second: five is room for a slow host, inside LumiAH's own ten for any one answer of the engine's. A run remembered is a few short strings: a thousand of them is weeks of play in a megabyte, and far more than any late call needs. Sovereign Hand is the player's switch in Lumiverse until they set it here, and the author is given the direction they wrote unless their preset carries it.
    harness: { defaultTick: true, commitWaitMs: 5000, runsRemembered: 1024, sovereignHand: "follow", newestMessage: "direction" },
    // One call may pass as far as a timelapse reaches: the author passes a span in steps only where the world's own work in it is too much at once.
    harnessLimits: { timePassMinutes: TIMELAPSE_REACH_MINUTES },
  };
}

// ---------------------------------------------------------------- how each limit is read

/** How a limit is read: the least it takes (what keeps it meaningful, §16.9) and whether it may be "none". */
interface AgentLimitDef {
  min: number;
  none: boolean;
}

const BUDGET_DEFS: Readonly<Record<keyof AgentBudget, AgentLimitDef>> = {
  callTokensIn: { min: 1, none: true },
  callTokensOut: { min: 1, none: false },
  callMs: { min: 1000, none: true },
  callTools: { min: 1, none: true },
  tokensIn: { min: 1, none: true },
  tokensOut: { min: 1, none: true },
  toolTurns: { min: 0, none: true },
  wallMs: { min: 1000, none: true },
  revisions: { min: 0, none: false },
  reruns: { min: 0, none: false },
  concurrency: { min: 1, none: false },
};
const TURN_DEFS: Readonly<Record<keyof TurnBudget, AgentLimitDef>> = {
  tokensIn: { min: 1, none: true },
  tokensOut: { min: 1, none: true },
  toolTurns: { min: 0, none: true },
  wallMs: { min: 1000, none: true },
};
const LOOP_DEFS: Readonly<Record<"loopRepeats" | "clipChars", AgentLimitDef>> = {
  loopRepeats: { min: 2, none: false },
  clipChars: { min: 1, none: false },
};
const KEPT_DEFS: Readonly<Record<keyof KeptSettings, AgentLimitDef>> = {
  runs: { min: 1, none: false },
  gates: { min: 1, none: false },
  watchers: { min: 1, none: false },
  live: { min: 1, none: false },
  texts: { min: 0, none: false },
  folds: { min: 1, none: false },
  chatMs: { min: 0, none: false },
};
const COMPACTION_DEFS: Readonly<Record<"atTokens" | "keepTurns" | "summaryTokens", AgentLimitDef>> = {
  atTokens: { min: 1, none: false },
  keepTurns: { min: 0, none: false },
  summaryTokens: { min: 500, none: false },
};
const MAIN_DEFS: Readonly<Record<"digestTokens" | "pinsTokens" | "receiptChars", AgentLimitDef>> = {
  digestTokens: { min: 0, none: false },
  pinsTokens: { min: 0, none: false },
  receiptChars: { min: 0, none: false },
};
const PERSIST_DEFS: Readonly<Record<"turns" | "minutes", AgentLimitDef>> = {
  turns: { min: 1, none: false },
  minutes: { min: 1, none: false },
};
const HISTORY_TOKENS_DEF: AgentLimitDef = { min: 0, none: false };
const GM_OPS_DEF: AgentLimitDef = { min: 0, none: false };
const CURATOR_OPS_DEF: AgentLimitDef = { min: 0, none: false };
const OUTPUT_CHARS_DEF: AgentLimitDef = { min: 1, none: false };
const SYSTEM_TOKENS_DEF: AgentLimitDef = { min: 0, none: false };
const HARNESS_COMMIT_WAIT_DEF: AgentLimitDef = { min: 0, none: false };
const HARNESS_REMEMBERED_DEF: AgentLimitDef = { min: 16, none: false };
const HARNESS_TIME_PASS_DEF: AgentLimitDef = { min: 1, none: false };
const AT_ONCE_DEF: AgentLimitDef = { min: 1, none: false };

// ---------------------------------------------------------------- reading stored settings

const whole = (v: unknown, lo: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= Number.MAX_SAFE_INTEGER ? v : undefined);
const limit = (v: unknown, def: AgentLimitDef, fallback: Limit): Limit => (v === "none" && !def.none ? fallback : limitIn(v, def.min, Number.MAX_SAFE_INTEGER, fallback));
/** A cache nonce as stored: empty (none sent), or a key no longer than any other the settings hold. */
const cacheNonce = (v: unknown, fallback: string): string => (v === "" || safeKey(v) ? v : fallback);

function budgetOf(v: unknown, d: Readonly<AgentBudget>): AgentBudget {
  const b = isRecord(v) ? v : {};
  return {
    callTokensIn: limit(b.callTokensIn, BUDGET_DEFS.callTokensIn, d.callTokensIn),
    callTokensOut: whole(b.callTokensOut, BUDGET_DEFS.callTokensOut.min) ?? d.callTokensOut,
    callMs: limit(b.callMs, BUDGET_DEFS.callMs, d.callMs),
    callTools: limit(b.callTools, BUDGET_DEFS.callTools, d.callTools),
    tokensIn: limit(b.tokensIn, BUDGET_DEFS.tokensIn, d.tokensIn),
    tokensOut: limit(b.tokensOut, BUDGET_DEFS.tokensOut, d.tokensOut),
    toolTurns: limit(b.toolTurns, BUDGET_DEFS.toolTurns, d.toolTurns),
    wallMs: limit(b.wallMs, BUDGET_DEFS.wallMs, d.wallMs),
    revisions: whole(b.revisions, BUDGET_DEFS.revisions.min) ?? d.revisions,
    reruns: whole(b.reruns, BUDGET_DEFS.reruns.min) ?? d.reruns,
    concurrency: whole(b.concurrency, BUDGET_DEFS.concurrency.min) ?? d.concurrency,
  };
}

function turnOf(v: unknown, d: Readonly<TurnBudget>): TurnBudget {
  const t = isRecord(v) ? v : {};
  return { tokensIn: limit(t.tokensIn, TURN_DEFS.tokensIn, d.tokensIn), tokensOut: limit(t.tokensOut, TURN_DEFS.tokensOut, d.tokensOut), toolTurns: limit(t.toolTurns, TURN_DEFS.toolTurns, d.toolTurns), wallMs: limit(t.wallMs, TURN_DEFS.wallMs, d.wallMs) };
}

/** A word of `list` as stored, else `fallback`. */
function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * The assistant's own budget limits as stored: each one its definition takes ("none" only where that
 * means something); one that isn't is left out, so every agent's limit stands for it.
 */
function ownBudgetOf(v: unknown, d: Readonly<Partial<AgentBudget>>): Partial<AgentBudget> {
  if (!isRecord(v)) return { ...d };
  const out: Partial<Record<keyof AgentBudget, Limit>> = {};
  for (const key of Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[]) {
    if (!hasOwn(v, key)) continue;
    const def = BUDGET_DEFS[key];
    const value = v[key] === "none" ? (def.none ? "none" : undefined) : whole(v[key], def.min);
    if (value !== undefined) out[key] = value;
  }
  // A limit that takes no "none" holds a number here: the check above keeps it so.
  return out as Partial<AgentBudget>;
}

function assistantOf(v: unknown, d: Readonly<AssistantSettings>): AssistantSettings {
  const a = isRecord(v) ? v : {};
  return {
    connectionId: safeKey(a.connectionId) ? a.connectionId : d.connectionId,
    model: safeKey(a.model) ? a.model : d.model,
    effort: oneOf(a.effort, AGENT_EFFORTS, d.effort),
    apply: oneOf(a.apply, ASSISTANT_APPLY, d.apply),
    historyTokens: whole(a.historyTokens, HISTORY_TOKENS_DEF.min) ?? d.historyTokens,
    budget: ownBudgetOf(a.budget, d.budget),
  };
}

/** Every tool family, by id. */
const FAMILIES: readonly ToolFamily[] = TOOL_FAMILIES;

/** The main agent's settings as stored: each field checked, else `d`'s; a connection or model cleared with null is your default's. */
function mainOf(v: unknown, d: Readonly<MainAgentSettings>): MainAgentSettings {
  const m = isRecord(v) ? v : {};
  return {
    connectionId: m.connectionId === null ? null : safeKey(m.connectionId) ? m.connectionId : d.connectionId,
    model: m.model === null ? null : safeKey(m.model) ? m.model : d.model,
    effort: oneOf(m.effort, AGENT_EFFORTS, d.effort),
    families: Array.isArray(m.families) ? [...new Set(m.families.filter((f): f is ToolFamily => typeof f === "string" && (FAMILIES as readonly string[]).includes(f)))] : [...d.families],
    budget: ownBudgetOf(m.budget, d.budget),
    digestTokens: whole(m.digestTokens, MAIN_DEFS.digestTokens.min) ?? d.digestTokens,
    pinsTokens: whole(m.pinsTokens, MAIN_DEFS.pinsTokens.min) ?? d.pinsTokens,
    stages: stagesOf(m.stages, d.stages),
    sessionKeeps: oneOf(m.sessionKeeps, SESSION_KEEPS, d.sessionKeeps),
    receiptChars: whole(m.receiptChars, MAIN_DEFS.receiptChars.min) ?? d.receiptChars,
  };
}

/** The compaction's settings as stored: each field checked, else `d`'s; a connection or model cleared with null is the main agent's. */
function compactionOf(v: unknown, d: Readonly<CompactionSettings>): CompactionSettings {
  const c = isRecord(v) ? v : {};
  return {
    atTokens: whole(c.atTokens, COMPACTION_DEFS.atTokens.min) ?? d.atTokens,
    keepTurns: whole(c.keepTurns, COMPACTION_DEFS.keepTurns.min) ?? d.keepTurns,
    summarizeTool: typeof c.summarizeTool === "boolean" ? c.summarizeTool : d.summarizeTool,
    when: oneOf(c.when, COMPACTION_WHEN, d.when),
    connectionId: c.connectionId === null ? null : safeKey(c.connectionId) ? c.connectionId : d.connectionId,
    model: c.model === null ? null : safeKey(c.model) ? c.model : d.model,
    effort: oneOf(c.effort, COMPACTION_EFFORTS, d.effort),
    summaryTokens: whole(c.summaryTokens, COMPACTION_DEFS.summaryTokens.min) ?? d.summaryTokens,
  };
}

/** Each stage's mode as stored, else `d`'s. */
function stagesOf(v: unknown, d: Readonly<MainStages>): MainStages {
  const raw = isRecord(v) ? v : {};
  const out = { ...d };
  for (const stage of MAIN_STAGES) out[stage] = oneOf(raw[stage], STAGE_MODES, d[stage]);
  return out;
}

/** The final review's settings as stored: each field checked, else `d`'s. */
function finalReviewOf(v: unknown, d: Readonly<FinalReviewSettings>): FinalReviewSettings {
  const r = isRecord(v) ? v : {};
  return { on: typeof r.on === "boolean" ? r.on : d.on, onFail: oneOf(r.onFail, FINAL_REVIEW_ON_FAIL, d.onFail), scope: oneOf(r.scope, FINAL_REVIEW_SCOPES, d.scope), budget: ownBudgetOf(r.budget, d.budget) };
}

/** A role's settings as stored: each field checked, else `d`'s; a connection or model cleared with null follows its classic step's; a run the pipeline map doesn't let it take reads as the run every role takes. */
function roleOf(id: RoleId, v: unknown, d: Readonly<RoleSettings>): RoleSettings {
  const r = isRecord(v) ? v : {};
  const families = Array.isArray(r.families) ? [...new Set(r.families.filter((f): f is ToolFamily => typeof f === "string" && (FAMILIES as readonly string[]).includes(f)))] : [...d.families];
  return {
    connectionId: r.connectionId === null ? null : safeKey(r.connectionId) ? r.connectionId : d.connectionId,
    model: r.model === null ? null : safeKey(r.model) ? r.model : d.model,
    effort: oneOf(r.effort, AGENT_EFFORTS, d.effort),
    families,
    tier: oneOf(r.tier, ROLE_TIERS, d.tier),
    promptOnly: typeof r.promptOnly === "boolean" ? r.promptOnly : d.promptOnly,
    onFail: oneOf(r.onFail, ROLE_ON_FAIL, d.onFail),
    run: roleRunOf(id, r.run, d.run),
    budget: ownBudgetOf(r.budget, d.budget),
  };
}

/** Every role's settings as stored: each role's own, else `d`'s. */
function rolesOf(v: unknown, d: Readonly<Record<RoleId, RoleSettings>>): Record<RoleId, RoleSettings> {
  const raw = isRecord(v) ? v : {};
  const out = {} as Record<RoleId, RoleSettings>;
  for (const id of ROLE_IDS) out[id] = roleOf(id, hasOwn(raw, id) ? raw[id] : undefined, d[id]);
  return out;
}

/** A per-connection list as stored: entries with a safe id, the first of each id; a list that isn't one keeps `d`. */
function listOf<T extends { id: string }>(v: unknown, d: readonly T[], entry: (raw: Record<string, unknown>, id: string) => T): T[] {
  if (!Array.isArray(v)) return d.map((x) => ({ ...x }));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const raw of v) {
    if (!isRecord(raw) || !safeKey(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    out.push(entry(raw, raw.id));
  }
  return out;
}

/** The least a throttle takes, per minute: below it, nothing could ever be sent (§16.9). */
export const THROTTLE_MIN = 1;
/** The least a ceiling takes: 0 lets the connection send nothing in a run. */
export const CEILING_MIN = 0;
/** The least estimate factor: below 1 a reservation would hold less than the estimate itself. */
export const ESTIMATE_FACTOR_MIN = 1;

/** The connections acceptance runs guard, as stored (the settings or the runs' own file): each checked, the first of each id; a value that isn't a list keeps `d`. */
export function acceptanceConnectionsOf(v: unknown, d: readonly AcceptanceConnection[] = []): AcceptanceConnection[] {
  return listOf(v, d, (c, id) => ({ id, only: typeof c.only === "boolean" ? c.only : true, tokensIn: limitIn(c.tokensIn, CEILING_MIN, Number.MAX_SAFE_INTEGER, "none"), tokensOut: limitIn(c.tokensOut, CEILING_MIN, Number.MAX_SAFE_INTEGER, "none") }));
}

/** `UserSettings.agents` as the runtime reads it: each field checked, else `d`'s. */
export function agentSettingsOf(raw: unknown, d: Readonly<AgentSettings> = defaultAgentSettings()): AgentSettings {
  const a = isRecord(raw) ? raw : {};
  const caching = isRecord(a.caching) ? a.caching : {};
  const rawRoles = isRecord(caching.roles) ? caching.roles : null;
  const roles: Record<string, RoleCaching> = {};
  if (rawRoles) {
    for (const [role, value] of Object.entries(rawRoles)) if (safeKey(role) && isRecord(value) && typeof value.on === "boolean") roles[role] = { on: value.on, nonce: cacheNonce(value.nonce, "") };
  } else for (const [role, value] of Object.entries(d.caching.roles)) roles[role] = { ...value };
  const acceptance = isRecord(a.acceptance) ? a.acceptance : {};
  const factor = acceptance.estimateFactor;
  const pipeline = isRecord(a.pipeline) ? a.pipeline : {};
  const recording = isRecord(a.recording) ? a.recording : {};
  const review = isRecord(a.review) ? a.review : {};
  const kept = isRecord(a.kept) ? a.kept : {};
  const persist = isRecord(a.persist) ? a.persist : {};
  const harness = isRecord(a.harness) ? a.harness : {};
  const limits = isRecord(a.harnessLimits) ? a.harnessLimits : {};
  return {
    thinkingInToolLoops: typeof a.thinkingInToolLoops === "boolean" ? a.thinkingInToolLoops : d.thinkingInToolLoops,
    stream: typeof a.stream === "boolean" ? a.stream : d.stream,
    budget: budgetOf(a.budget, d.budget),
    turn: turnOf(a.turn, d.turn),
    loopRepeats: whole(a.loopRepeats, LOOP_DEFS.loopRepeats.min) ?? d.loopRepeats,
    clipChars: whole(a.clipChars, LOOP_DEFS.clipChars.min) ?? d.clipChars,
    throttles: listOf(a.throttles, d.throttles, (t, id) => ({ id, requestsPerMinute: limitIn(t.requestsPerMinute, THROTTLE_MIN, Number.MAX_SAFE_INTEGER, "none"), tokensPerMinute: limitIn(t.tokensPerMinute, THROTTLE_MIN, Number.MAX_SAFE_INTEGER, "none"), atOnce: limitIn(t.atOnce, AT_ONCE_DEF.min, Number.MAX_SAFE_INTEGER, "none") })),
    callsAtOnce: limitIn(a.callsAtOnce, AT_ONCE_DEF.min, Number.MAX_SAFE_INTEGER, d.callsAtOnce),
    caching: { on: typeof caching.on === "boolean" ? caching.on : d.caching.on, nonce: cacheNonce(caching.nonce, d.caching.nonce), roles },
    acceptance: {
      connections: acceptanceConnectionsOf(acceptance.connections, d.acceptance.connections),
      estimateFactor: typeof factor === "number" && Number.isFinite(factor) && factor >= ESTIMATE_FACTOR_MIN ? factor : d.acceptance.estimateFactor,
    },
    assistant: assistantOf(a.assistant, d.assistant),
    pipeline: { mode: oneOf(pipeline.mode, PIPELINE_MODES, d.pipeline.mode), memory: oneOf(pipeline.memory, MEMORY_PLACEMENTS, d.pipeline.memory), curator: typeof pipeline.curator === "boolean" ? pipeline.curator : d.pipeline.curator, curatorGate: oneOf(pipeline.curatorGate, CURATOR_GATES, d.pipeline.curatorGate) },
    roles: rolesOf(a.roles, d.roles),
    main: mainOf(a.main, d.main),
    context: contextSettingsOf(a.context, d.context),
    finalReview: finalReviewOf(a.finalReview, d.finalReview),
    persist: { on: typeof persist.on === "boolean" ? persist.on : d.persist.on, turns: whole(persist.turns, PERSIST_DEFS.turns.min) ?? d.persist.turns, minutes: whole(persist.minutes, PERSIST_DEFS.minutes.min) ?? d.persist.minutes },
    gmOpsPerTurn: whole(a.gmOpsPerTurn, GM_OPS_DEF.min) ?? d.gmOpsPerTurn,
    curatorOps: whole(a.curatorOps, CURATOR_OPS_DEF.min) ?? d.curatorOps,
    kept: { runs: whole(kept.runs, KEPT_DEFS.runs.min) ?? d.kept.runs, gates: whole(kept.gates, KEPT_DEFS.gates.min) ?? d.kept.gates, watchers: whole(kept.watchers, KEPT_DEFS.watchers.min) ?? d.kept.watchers, live: whole(kept.live, KEPT_DEFS.live.min) ?? d.kept.live, texts: whole(kept.texts, KEPT_DEFS.texts.min) ?? d.kept.texts, folds: whole(kept.folds, KEPT_DEFS.folds.min) ?? d.kept.folds, chatMs: whole(kept.chatMs, KEPT_DEFS.chatMs.min) ?? d.kept.chatMs },
    compaction: compactionOf(a.compaction, d.compaction),
    recording: { outputChars: whole(recording.outputChars, OUTPUT_CHARS_DEF.min) ?? d.recording.outputChars },
    review: { placement: oneOf(review.placement, REVIEW_PLACEMENTS, d.review.placement) },
    // A ratio, so any amount above none: under 1, an agent turn must spend less than classic's.
    vsClassic: typeof a.vsClassic === "number" && Number.isFinite(a.vsClassic) && a.vsClassic > 0 ? a.vsClassic : d.vsClassic,
    systemTokens: whole(a.systemTokens, SYSTEM_TOKENS_DEF.min) ?? d.systemTokens,
    harness: {
      defaultTick: typeof harness.defaultTick === "boolean" ? harness.defaultTick : d.harness.defaultTick,
      commitWaitMs: whole(harness.commitWaitMs, HARNESS_COMMIT_WAIT_DEF.min) ?? d.harness.commitWaitMs,
      runsRemembered: whole(harness.runsRemembered, HARNESS_REMEMBERED_DEF.min) ?? d.harness.runsRemembered,
      sovereignHand: oneOf(harness.sovereignHand, SOVEREIGN_HANDS, d.harness.sovereignHand),
      newestMessage: oneOf(harness.newestMessage, NEWEST_MESSAGES, d.harness.newestMessage),
    },
    harnessLimits: { timePassMinutes: Math.min(whole(limits.timePassMinutes, HARNESS_TIME_PASS_DEF.min) ?? d.harnessLimits.timePassMinutes, TIMELAPSE_REACH_MINUTES) },
  };
}
