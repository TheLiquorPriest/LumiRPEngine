// Settings → Agents (AGENT-LOOP-PLAN §15; INC1-SPEC R1, R6a): what the agent runtime runs under, kept
// in `UserSettings.agents`, apart from the classic steps' settings, so no classic turn reads any of it.
// Every limit the runtime keeps is a setting here, with its default and the words its page shows
// (`BUDGET_DEFS`, `TURN_DEFS`, `LOOP_DEFS`), and so is everything the GM assistant runs with
// (`assistant`: Settings → Agents → Assistant); the values that stay fixed are §16's: the effort
// levels, "set by the model" as the host's `{source: "custom", effort: "auto"}`, and Anthropic's 4
// cache breakpoints per request, which the host adapter keeps (`backend/spindle-host.ts`).

import type { AgentKnowledge } from "./agent-tools";
import { AGENT_KNOWLEDGE } from "./agent-tools";
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
  };
}

/** The GM assistant's budget: every agent's, with the limits it sets of its own standing in. */
export function assistantBudget(settings: Readonly<AgentSettings>): AgentBudget {
  return { ...settings.budget, ...settings.assistant.budget };
}

/** Roles the runtime runs, by id, as Settings → Agents names them (each role's own settings are keyed by its id). */
export const AGENT_ROLES: readonly { id: string; label: string }[] = [{ id: "assistant", label: "GM assistant" }];

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
