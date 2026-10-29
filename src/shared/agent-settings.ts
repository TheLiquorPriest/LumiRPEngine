// Settings → Agents (AGENT-LOOP-PLAN §15; INC1-SPEC R1, R6a; INC2-SPEC C12): what the agent runtime
// runs under, kept in `UserSettings.agents`, apart from the classic steps' settings, so no classic
// turn reads any of it. Every limit the runtime keeps is a setting here, with its default and the
// words its page shows (`BUDGET_DEFS`, `TURN_DEFS`, `LOOP_DEFS`, `GM_OPS_DEF`, `KEPT_DEFS`, `COMPACTION_DEFS`, `MAIN_DEFS`, `OUTPUT_CHARS_DEF`), and so is
// everything the GM assistant runs with (`assistant`: Settings → Agents → Assistant) and everything
// an agent turn runs with (`pipeline`, `roles`, `main`, `gmOpsPerTurn`, `kept`, `compaction`, `recording`,
// `review` and `vsClassic`); the values that stay fixed are §16's: the effort levels, "set by the model" as
// the host's `{source: "custom", effort: "auto"}`, and Anthropic's 4 cache breakpoints per request,
// which the host adapter keeps (`backend/spindle-host.ts`).

import type { AgentKnowledge, ToolFamily } from "./agent-tools";
import { AGENT_KNOWLEDGE, TOOL_FAMILY_LABEL } from "./agent-tools";
import { defaultRoleSettings, ROLE_IDS, ROLE_KNOWLEDGE, ROLE_LABEL, ROLE_ON_FAIL, ROLE_TIERS, type RoleId, type RoleSettings } from "./agent-roles";
import { hasOwn, isRecord, safeKey } from "./json";
import type { Limit } from "./minds";
import { limitIn } from "./minds";
import { HELPER_MAX_TOKENS } from "./settings";

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

/** A connection's throttle, per minute: requests sent, and tokens sent and written. "none" is off. */
export interface ConnectionThrottle {
  /** The connection's id. */
  id: string;
  requestsPerMinute: Limit;
  tokensPerMinute: Limit;
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
 * The GM assistant (GM → Assistant; Settings → Agents → Assistant): the connection and model it runs
 * on (null: your default connection, and that connection's model), its effort, whose knowledge its
 * tools read the world with, how its changes land, how much of its thread goes with each message,
 * and its budget.
 */
export interface AssistantSettings {
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  knowledge: AgentKnowledge;
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
}

/** The main session's compaction (Settings → Agents → Compaction): once it passes `atTokens`, all but the last `keepTurns` turns are summarized; `summarizeTool` gives the main agent its summarize tool. */
export interface CompactionSettings {
  atTokens: number;
  keepTurns: number;
  summarizeTool: boolean;
}

/** What an agent turn records for the narrator (Settings → Agents → Recording): each output event's text, in characters at most. */
export interface RecordingSettings {
  outputChars: number;
}

export interface ReviewSettings {
  placement: ReviewPlacement;
}

/**
 * What the engine keeps in memory for agent turns, each the most it holds at once (Settings → Agents
 * → Budgets): turns under way (a turn that went stale unheard is let go with the oldest), a user's
 * turns waiting at a gate, each with its whole run for the resume (one let go resumes afresh; a
 * review gate's still replays its plan, but its record keeps neither what the run committed nor its
 * lines for the narrator), and chats whose review cards a page listens to (one let go hears the
 * cards again when it next asks for them).
 */
export interface KeptSettings {
  runs: number;
  gates: number;
  watchers: number;
}

/**
 * The main agent (Settings → Agents → Main agent; INC2-SPEC C14), while the pipeline has one decide:
 * the connection and model it runs on (null: your default connection, and that connection's model),
 * its effort, whose knowledge its tools and the engine's messages to it read with, its tool families
 * (read only: it changes nothing itself), its own limits over `budget` for each stage it works, and
 * its turn task's parts in tokens at most: the digest of what changed since its last turn, and its
 * pinned files where `.pins.json` sets no budget for it, which is every role's pins budget too.
 */
export interface MainAgentSettings {
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  knowledge: AgentKnowledge;
  families: ToolFamily[];
  budget: Partial<AgentBudget>;
  digestTokens: number;
  pinsTokens: number;
}

export interface AgentSettings {
  /**
   * "Thinking in agent tool loops" (§2, decided A): while off, every call that offers tools goes
   * with reasoning off, whatever the role's effort, since Lumiverse doesn't yet pass back the
   * thinking blocks a reasoning model must be sent again after a tool call. Calls without tools
   * keep the role's effort.
   */
  thinkingInToolLoops: boolean;
  /** Each agent's budget, unless its role sets its own (Settings → Agents → Roles, Increment 2). */
  budget: AgentBudget;
  /** Every agent of a turn together. */
  turn: TurnBudget;
  /** The loop detector: the same tool call with the same arguments this many times in a row stops the agent. */
  loopRepeats: number;
  /** A tool result longer than this, in characters, reaches the model clipped; the rest waits in scratch for `scratch_read`. */
  clipChars: number;
  /** Per connection; a connection not listed has none. */
  throttles: ConnectionThrottle[];
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
  /** The main agent, while `pipeline.mode` is `main` (Settings → Agents → Main agent). */
  main: MainAgentSettings;
  /** The GM's edits a turn's agents may stage in all, per turn (Settings → Agents → Budgets). */
  gmOpsPerTurn: number;
  /** What the engine keeps in memory for agent turns (Settings → Agents → Budgets). */
  kept: KeptSettings;
  compaction: CompactionSettings;
  recording: RecordingSettings;
  /** Where an agent turn's changes that ask first wait (Settings → Agents → Review card). */
  review: ReviewSettings;
  /** The acceptance comparison's target (Settings → Agents → Acceptance runs; INC2-ACCEPTANCE): per role, an agent turn's tokens at most this many times the classic turn's of the same scenario. Nothing in the engine enforces it: the comparison reads both turns' tokens from Diagnostics. */
  vsClassic: number;
}

/**
 * What a connection added to Acceptance runs starts with (AGENT-LOOP-PLAN §12, decided E): kept for
 * acceptance runs, with Increment 1's ceilings. No connection is guarded until the user adds one.
 */
export const DEFAULT_ACCEPTANCE: Readonly<Omit<AcceptanceConnection, "id">> = Object.freeze({ only: true, tokensIn: 300_000, tokensOut: 30_000 });

/** A new user's agent settings: §15's defaults. */
export function defaultAgentSettings(): AgentSettings {
  return {
    thinkingInToolLoops: false,
    budget: { callTokensIn: "none", callTokensOut: HELPER_MAX_TOKENS, callMs: "none", callTools: "none", tokensIn: "none", tokensOut: "none", toolTurns: 10, wallMs: "none", revisions: 2, concurrency: 4 },
    turn: { tokensIn: 100_000, tokensOut: 10_000, toolTurns: "none", wallMs: "none" },
    loopRepeats: 3,
    clipChars: 4000,
    throttles: [],
    caching: { on: true, nonce: "", roles: {} },
    acceptance: { connections: [], estimateFactor: 2 },
    // The assistant reads what everyone in the world knows, secrets marked, and its changes wait for your Apply.
    assistant: { connectionId: null, model: null, effort: "inherit", knowledge: "everyone", apply: "ask", historyTokens: 20_000, budget: {} },
    pipeline: { mode: "fixed", memory: "after_reply" },
    roles: defaultRoleSettings(),
    // The main agent reads what everyone in the world knows, secrets marked, and the workspace; its digest and pins, 2,000 tokens each (§15).
    main: { connectionId: null, model: null, effort: "inherit", knowledge: "everyone", families: ["workspace"], budget: {}, digestTokens: 2000, pinsTokens: 2000 },
    gmOpsPerTurn: 10,
    kept: { runs: 64, gates: 256, watchers: 256 },
    compaction: { atTokens: 32_000, keepTurns: 3, summarizeTool: true },
    recording: { outputChars: 2000 },
    review: { placement: "chips" },
    vsClassic: 2,
  };
}

/** The GM assistant's budget: every agent's, with the limits it sets of its own standing in. */
export function assistantBudget(settings: Readonly<AgentSettings>): AgentBudget {
  return { ...settings.budget, ...settings.assistant.budget };
}

/** A turn role's budget: every agent's, with the limits its role sets of its own standing in. */
export function roleBudget(settings: Readonly<AgentSettings>, role: RoleId): AgentBudget {
  return { ...settings.budget, ...settings.roles[role].budget };
}

/** The main agent's budget for each stage it works: every agent's, with the limits it sets of its own standing in. */
export function mainBudget(settings: Readonly<AgentSettings>): AgentBudget {
  return { ...settings.budget, ...settings.main.budget };
}

/** The main agent's role, as the runtime, Diagnostics and the caching settings name it. */
export const MAIN_AGENT_ROLE = "main";

/** Roles the runtime runs, by id, as Settings → Agents names them (each role's own settings are keyed by its id). */
export const AGENT_ROLES: readonly { id: string; label: string }[] = [
  { id: "assistant", label: "GM assistant" },
  { id: MAIN_AGENT_ROLE, label: "Main agent" },
];

/** An agent's name, by its role, as Settings → Agents names it: a turn role's label, the GM assistant's or the main agent's; else the role's id. What the drawer's live trace shows of it. */
export function agentLabel(role: string): string {
  return hasOwn(ROLE_LABEL, role) ? ROLE_LABEL[role as RoleId] : (AGENT_ROLES.find((r) => r.id === role)?.label ?? role);
}

// ---------------------------------------------------------------- the page's words

/** How a limit is set: tokens, milliseconds (shown in seconds), a count, or characters. */
export type AgentLimitUnit = "tokens" | "ms" | "count" | "chars";

export interface AgentLimitDef {
  /** Its name on the page, and in a refusal. */
  label: string;
  /** What it limits. */
  limits: string;
  /** What happens when it's reached. */
  fires: string;
  unit: AgentLimitUnit;
  /** The smallest number it takes: what keeps it meaningful (§16.9). */
  min: number;
  /** Whether it may be "none", and what that means. */
  none: string | null;
  /** Its "none" leans on a turn's own bounds, which an agent outside a turn (the GM assistant) has none of: there it is no limit at all. */
  turnBound?: true;
}

export const BUDGET_DEFS: Readonly<Record<keyof AgentBudget, AgentLimitDef>> = {
  callTokensIn: { label: "Prompt per call", limits: "The tokens one call may send, as estimated before it goes.", fires: "The call isn't sent, and the agent stops with what it has.", unit: "tokens", min: 1, none: "a call sends what it holds" },
  callTokensOut: { label: "Answer per call", limits: "The tokens one call may write (max tokens), its reasoning included.", fires: "The answer is cut off there; a call never asks for more than the agent's or the turn's tokens left.", unit: "tokens", min: 1, none: null },
  callMs: { label: "Time per call", limits: "How long one call may take.", fires: "The call is stopped, and the agent with it.", unit: "ms", min: 1000, none: "the turn's timeouts bound it", turnBound: true },
  callTools: { label: "Tool calls per answer", limits: "How many tools one answer may call.", fires: "The calls past it aren't run; the model is told so.", unit: "count", min: 1, none: "an answer may call any number" },
  tokensIn: { label: "Prompt tokens per agent", limits: "The tokens one agent's calls send in all.", fires: "Its next call isn't sent, and it stops with what it has.", unit: "tokens", min: 1, none: "agents share the turn's tokens", turnBound: true },
  tokensOut: { label: "Answer tokens per agent", limits: "The tokens one agent's calls write in all.", fires: "Its next call isn't sent, and it stops with what it has.", unit: "tokens", min: 1, none: "agents share the turn's tokens", turnBound: true },
  toolTurns: { label: "Tool rounds per agent", limits: "How many of one agent's answers may call tools.", fires: "The calls past it aren't run, and the agent stops.", unit: "count", min: 0, none: "as many rounds as the tokens allow" },
  wallMs: { label: "Time per agent", limits: "How long one agent may work, from its first message.", fires: "Its call is stopped, and it stops with what it has.", unit: "ms", min: 1000, none: "the turn's timeouts bound it", turnBound: true },
  revisions: { label: "Revisions per agent", limits: "How many more messages an agent may be sent after its first answer.", fires: "The message isn't sent; the agent's last answer stands.", unit: "count", min: 0, none: null },
  concurrency: { label: "Tool calls at once", limits: "How many of one answer's tool calls run at the same time.", fires: "The rest wait their turn.", unit: "count", min: 1, none: null },
};

export const TURN_DEFS: Readonly<Record<keyof TurnBudget, AgentLimitDef>> = {
  tokensIn: { label: "Prompt tokens per turn", limits: "The tokens every agent of a turn sends together.", fires: "No further call goes out that turn; each agent stops with what it has.", unit: "tokens", min: 1, none: "no limit for the turn" },
  tokensOut: { label: "Answer tokens per turn", limits: "The tokens every agent of a turn writes together.", fires: "No further call goes out that turn; each agent stops with what it has.", unit: "tokens", min: 1, none: "no limit for the turn" },
  toolTurns: { label: "Tool rounds per turn", limits: "The rounds of tool calls every agent of a turn makes together.", fires: "No further tool call runs that turn.", unit: "count", min: 0, none: "each agent's own rounds bound them" },
  wallMs: { label: "Agent time per turn", limits: "How long a turn's agents may work, from the turn's start.", fires: "Every call still running is stopped.", unit: "ms", min: 1000, none: "the turn's timeouts bound it" },
};

export const LOOP_DEFS: Readonly<Record<"loopRepeats" | "clipChars", AgentLimitDef>> = {
  loopRepeats: { label: "Loop detector", limits: "The same tool call, with the same arguments, this many times in a row.", fires: "That call isn't run, and the agent stops.", unit: "count", min: 2, none: null },
  clipChars: { label: "Tool results clipped past", limits: "How much of one tool result reaches the model at once.", fires: "The rest goes to scratch, which the model reads with scratch_read.", unit: "chars", min: 1, none: null },
};

/** Settings → Agents → Assistant's words for whose knowledge the assistant reads the world with. */
export const ASSISTANT_KNOWLEDGE_LABELS: Readonly<Record<AgentKnowledge, string>> = { pov: "Your character's", everyone: "Everyone's, secrets marked", gm: "The GM's" };

/** And for how its changes land. */
export const ASSISTANT_APPLY_LABELS: Readonly<Record<AssistantApply, string>> = { ask: "Each waits for your Apply", at_once: "At once, with an Undo chip" };

export const HISTORY_TOKENS_DEF: AgentLimitDef = { label: "History tokens", limits: "How much of the conversation goes with each message you send, the newest messages first.", fires: "The older messages are left out, and the assistant is told how many.", unit: "tokens", min: 0, none: null };

/** Settings → Agents → Budgets: the GM's edits an agent turn may stage. */
export const GM_OPS_DEF: AgentLimitDef = { label: "GM edits per turn", limits: "How many of the GM's edits (a spawn, a removal, any field, a stage, the clock) a turn's agents may stage together.", fires: "The edits past it are refused, and the agent that asked is told so.", unit: "count", min: 0, none: null };

/** Settings → Agents → Budgets: what the engine keeps in memory for agent turns, at least one of each, so a turn can run, wait at its gate and be heard. */
export const KEPT_DEFS: Readonly<Record<keyof KeptSettings, AgentLimitDef>> = {
  runs: { label: "Agent turns under way", limits: "How many agent turns, across your chats, the engine keeps running at once.", fires: "The oldest is let go when another starts: a turn that went stale with no end heard.", unit: "count", min: 1, none: null },
  gates: { label: "Turns waiting at a gate", limits: "How many agent turns, across your chats, may wait at a gate (the intent or outline gate, a question asked first, the review card) with everything their agents had done kept for the resume.", fires: "The oldest waiting turn is let go: it resumes afresh, its agents asked again where the turn still needs them; a review gate's still plays its plan and lands what you let through, but its record no longer says which role wrote what it committed before the gate, nor keeps the lines its roles had for the narrator.", unit: "count", min: 1, none: null },
  watchers: { label: "Chats whose review cards are watched", limits: "How many chats' review cards the pages that show them hear about as they change.", fires: "The chat watched longest ago stops hearing, until a page asks for its cards again.", unit: "count", min: 1, none: null },
};

/** Settings → Agents → Compaction: when the main session is summarized, and how much of it stays whole. */
export const COMPACTION_DEFS: Readonly<Record<"atTokens" | "keepTurns", AgentLimitDef>> = {
  atTokens: { label: "Compact the session past", limits: "How long the main agent's session may grow before everything but its latest turns is summarized.", fires: "The older turns become one summary, kept with the span it replaced for a rollback.", unit: "tokens", min: 1, none: null },
  keepTurns: { label: "Recent turns kept whole", limits: "How many of the latest turns a compaction leaves as they were.", fires: "Older turns are summarized.", unit: "count", min: 0, none: null },
};

/** Settings → Agents → Main agent: how much of its turn task the digest and its pinned files may take. */
export const MAIN_DEFS: Readonly<Record<"digestTokens" | "pinsTokens", AgentLimitDef>> = {
  digestTokens: { label: "Turn digest", limits: "How much of the main agent's turn task the digest of what changed since its last turn may take: the newest replies first.", fires: "Older replies are left out, and the digest says how many.", unit: "tokens", min: 0, none: null },
  pinsTokens: { label: "Pinned files, per role", limits: "How much of an agent's prompt its pinned files may take, where .pins.json sets no budget for it: the main agent's, and every role's.", fires: "A file past it comes as its headings, which workspace_read reads whole.", unit: "tokens", min: 0, none: null },
};

/** Settings → Agents → Recording: each line an agent turn records for the narrator. */
export const OUTPUT_CHARS_DEF: AgentLimitDef = { label: "Narrator-facing output, each", limits: "How long each text an agent turn records for the narrator may be: an outcome, montage or outline line, the brief, a scene note.", fires: "A longer text is cut to it, ending in “…”; the cut is noted in your diagnostics.log, not on the Diagnostics page.", unit: "chars", min: 1, none: null };

/** Settings → Agents → Pipeline's words for each choice. */
export const PIPELINE_MODE_LABELS: Readonly<Record<PipelineMode, string>> = { fixed: "A fixed pipeline, in classic's order", main: "A main agent decides" };
export const MEMORY_PLACEMENT_LABELS: Readonly<Record<MemoryPlacement, string>> = { after_reply: "After the reply", before_next: "Before the next turn" };

/** Settings → Agents → Review card's words for where an agent turn's changes that ask first wait. */
export const REVIEW_PLACEMENT_LABELS: Readonly<Record<ReviewPlacement, string>> = { chips: "On the review card after the reply", gate: "On the review card before the reply" };

// ---------------------------------------------------------------- reading stored settings

const whole = (v: unknown, lo: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= Number.MAX_SAFE_INTEGER ? v : undefined);
const limit = (v: unknown, def: AgentLimitDef, fallback: Limit): Limit => (v === "none" && def.none === null ? fallback : limitIn(v, def.min, Number.MAX_SAFE_INTEGER, fallback));
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
    const value = v[key] === "none" ? (def.none === null ? undefined : "none") : whole(v[key], def.min);
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
    knowledge: oneOf(a.knowledge, AGENT_KNOWLEDGE, d.knowledge),
    apply: oneOf(a.apply, ASSISTANT_APPLY, d.apply),
    historyTokens: whole(a.historyTokens, HISTORY_TOKENS_DEF.min) ?? d.historyTokens,
    budget: ownBudgetOf(a.budget, d.budget),
  };
}

/** Every tool family, by id. */
const FAMILIES = Object.keys(TOOL_FAMILY_LABEL) as ToolFamily[];

/** The main agent's settings as stored: each field checked, else `d`'s; a connection or model cleared with null is your default's. */
function mainOf(v: unknown, d: Readonly<MainAgentSettings>): MainAgentSettings {
  const m = isRecord(v) ? v : {};
  return {
    connectionId: m.connectionId === null ? null : safeKey(m.connectionId) ? m.connectionId : d.connectionId,
    model: m.model === null ? null : safeKey(m.model) ? m.model : d.model,
    effort: oneOf(m.effort, AGENT_EFFORTS, d.effort),
    knowledge: oneOf(m.knowledge, AGENT_KNOWLEDGE, d.knowledge),
    families: Array.isArray(m.families) ? [...new Set(m.families.filter((f): f is ToolFamily => typeof f === "string" && (FAMILIES as readonly string[]).includes(f)))] : [...d.families],
    budget: ownBudgetOf(m.budget, d.budget),
    digestTokens: whole(m.digestTokens, MAIN_DEFS.digestTokens.min) ?? d.digestTokens,
    pinsTokens: whole(m.pinsTokens, MAIN_DEFS.pinsTokens.min) ?? d.pinsTokens,
  };
}

/** A role's settings as stored: each field checked, else `d`'s; a connection or model cleared with null follows its classic step's. */
function roleOf(v: unknown, d: Readonly<RoleSettings>): RoleSettings {
  const r = isRecord(v) ? v : {};
  const families = Array.isArray(r.families) ? [...new Set(r.families.filter((f): f is ToolFamily => typeof f === "string" && (FAMILIES as readonly string[]).includes(f)))] : [...d.families];
  return {
    connectionId: r.connectionId === null ? null : safeKey(r.connectionId) ? r.connectionId : d.connectionId,
    model: r.model === null ? null : safeKey(r.model) ? r.model : d.model,
    effort: oneOf(r.effort, AGENT_EFFORTS, d.effort),
    knowledge: oneOf(r.knowledge, ROLE_KNOWLEDGE, d.knowledge),
    families,
    tier: oneOf(r.tier, ROLE_TIERS, d.tier),
    promptOnly: typeof r.promptOnly === "boolean" ? r.promptOnly : d.promptOnly,
    onFail: oneOf(r.onFail, ROLE_ON_FAIL, d.onFail),
    budget: ownBudgetOf(r.budget, d.budget),
  };
}

/** Every role's settings as stored: each role's own, else `d`'s. */
function rolesOf(v: unknown, d: Readonly<Record<RoleId, RoleSettings>>): Record<RoleId, RoleSettings> {
  const raw = isRecord(v) ? v : {};
  const out = {} as Record<RoleId, RoleSettings>;
  for (const id of ROLE_IDS) out[id] = roleOf(hasOwn(raw, id) ? raw[id] : undefined, d[id]);
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
  const compaction = isRecord(a.compaction) ? a.compaction : {};
  const recording = isRecord(a.recording) ? a.recording : {};
  const review = isRecord(a.review) ? a.review : {};
  const kept = isRecord(a.kept) ? a.kept : {};
  return {
    thinkingInToolLoops: typeof a.thinkingInToolLoops === "boolean" ? a.thinkingInToolLoops : d.thinkingInToolLoops,
    budget: budgetOf(a.budget, d.budget),
    turn: turnOf(a.turn, d.turn),
    loopRepeats: whole(a.loopRepeats, LOOP_DEFS.loopRepeats.min) ?? d.loopRepeats,
    clipChars: whole(a.clipChars, LOOP_DEFS.clipChars.min) ?? d.clipChars,
    throttles: listOf(a.throttles, d.throttles, (t, id) => ({ id, requestsPerMinute: limitIn(t.requestsPerMinute, THROTTLE_MIN, Number.MAX_SAFE_INTEGER, "none"), tokensPerMinute: limitIn(t.tokensPerMinute, THROTTLE_MIN, Number.MAX_SAFE_INTEGER, "none") })),
    caching: { on: typeof caching.on === "boolean" ? caching.on : d.caching.on, nonce: cacheNonce(caching.nonce, d.caching.nonce), roles },
    acceptance: {
      connections: acceptanceConnectionsOf(acceptance.connections, d.acceptance.connections),
      estimateFactor: typeof factor === "number" && Number.isFinite(factor) && factor >= ESTIMATE_FACTOR_MIN ? factor : d.acceptance.estimateFactor,
    },
    assistant: assistantOf(a.assistant, d.assistant),
    pipeline: { mode: oneOf(pipeline.mode, PIPELINE_MODES, d.pipeline.mode), memory: oneOf(pipeline.memory, MEMORY_PLACEMENTS, d.pipeline.memory) },
    roles: rolesOf(a.roles, d.roles),
    main: mainOf(a.main, d.main),
    gmOpsPerTurn: whole(a.gmOpsPerTurn, GM_OPS_DEF.min) ?? d.gmOpsPerTurn,
    kept: { runs: whole(kept.runs, KEPT_DEFS.runs.min) ?? d.kept.runs, gates: whole(kept.gates, KEPT_DEFS.gates.min) ?? d.kept.gates, watchers: whole(kept.watchers, KEPT_DEFS.watchers.min) ?? d.kept.watchers },
    compaction: { atTokens: whole(compaction.atTokens, COMPACTION_DEFS.atTokens.min) ?? d.compaction.atTokens, keepTurns: whole(compaction.keepTurns, COMPACTION_DEFS.keepTurns.min) ?? d.compaction.keepTurns, summarizeTool: typeof compaction.summarizeTool === "boolean" ? compaction.summarizeTool : d.compaction.summarizeTool },
    recording: { outputChars: whole(recording.outputChars, OUTPUT_CHARS_DEF.min) ?? d.recording.outputChars },
    review: { placement: oneOf(review.placement, REVIEW_PLACEMENTS, d.review.placement) },
    // A ratio, so any amount above none: under 1, an agent turn must spend less than classic's.
    vsClassic: typeof a.vsClassic === "number" && Number.isFinite(a.vsClassic) && a.vsClassic > 0 ? a.vsClassic : d.vsClassic,
  };
}

/** A role's caching: its own when it has some, else every role's. */
export function roleCaching(settings: Readonly<AgentSettings>, role: string): RoleCaching {
  const own = hasOwn(settings.caching.roles, role) ? settings.caching.roles[role] : undefined;
  return own ? { ...own } : { on: settings.caching.on, nonce: settings.caching.nonce };
}

// ---------------------------------------------------------------- acceptance runs

/** What one connection spent in an acceptance run, as the providers reported it (`estimated`: some of it is the runtime's own estimate). */
export interface AcceptanceSpend {
  tokensIn: number;
  cachedIn: number;
  tokensOut: number;
  calls: number;
  /** Calls the run's ceilings or its guard refused. */
  refused: number;
  estimated: boolean;
}

/**
 * An acceptance run (§12), opened and closed by you in Settings → Agents → Acceptance runs: its
 * label, when it opened and closed, and per connection what it spent, what calls in flight hold
 * reserved, and its ceilings now (null: the connection isn't under Acceptance runs).
 */
export interface AcceptanceRunView {
  label: string;
  openedAt: number;
  closedAt: number | null;
  connections: { id: string; spent: AcceptanceSpend; reserved: { tokensIn: number; tokensOut: number }; ceiling: { only: boolean; tokensIn: Limit; tokensOut: Limit } | null }[];
}

/** The open run, if any, and the last one closed: what Settings shows and the drawer's counter reads. */
export interface AcceptanceState {
  run: AcceptanceRunView | null;
  last: AcceptanceRunView | null;
}
