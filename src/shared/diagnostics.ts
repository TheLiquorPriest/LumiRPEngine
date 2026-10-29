// Diagnostics (DESIGN §6.9): what the engine did each turn, step by step, with its model calls, its
// failures and why, the sections each engine run wrote, slow requests and each agent's calls; and the
// in-flight activity line. The records are GM-level (a step's reason may name what the player hasn't
// met): they are read only on request (`lre.diag`), never pushed. The activity line is player-safe: a
// step's label, no names.

import type { ChatId } from "./ids";
import { isRecord } from "./json";
import { formatMs, HOST_LIMITS } from "./timeouts";

export type DiagLevel = "debug" | "info" | "warn" | "error";

/** Where in a turn a record falls. `request` is a frontend request (a view or an edit). */
export type DiagPhase = "pre" | "plan" | "prose" | "sections" | "reply" | "read" | "memory" | "skip" | "request";

export const DIAG_PHASES: readonly DiagPhase[] = ["pre", "plan", "prose", "sections", "reply", "read", "memory", "skip", "request"];

export type DiagStatus = "ok" | "skipped" | "failed";

/** One model call made inside a step. */
export interface DiagCall {
  purpose: string;
  via: "helper" | "decision";
  /** The connection's id, or "active" for the user's active connection. */
  connection: string;
  /** The model asked for, or the one the host reported; "default" when neither is known. */
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** The provider's `finish_reason` ("stop", "length", …); "" when it gave none. */
  finishReason: string;
  maxTokens: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  lookup?: boolean;
  /** This attempt failed transiently and the call was made again. */
  retried?: boolean;
  /** How many attempts of the call came before this one. */
  retries?: number;
  /** A call the engine run goes on without (the skip plan, #53): its failure is shown, never the turn's. */
  spared?: boolean;
}

export interface DiagSection {
  slot: string;
  outlet: string | null;
  filled: boolean;
}

/** A count of an agent call's usage, by name. */
export type DiagUsageField = "in" | "cachedIn" | "out" | "reasoningOut";

export const DIAG_USAGE_FIELDS: readonly DiagUsageField[] = ["in", "cachedIn", "out", "reasoningOut"];

/**
 * An agent call's tokens: `in` (of which `cachedIn` the provider read from its cache) and `out` (of
 * which `reasoningOut` reasoning). `estimated` names the counts the provider didn't report, which
 * hold the agent runtime's estimate; absent when every count is the provider's.
 */
export interface DiagUsage {
  in: number;
  cachedIn: number;
  out: number;
  reasoningOut: number;
  estimated?: DiagUsageField[];
}

/** How an agent call ended: answered, failed, cancelled by the user, or refused by the provider. */
export type DiagAgentOutcome = "ok" | "failed" | "cancelled" | "refused";

export const DIAG_AGENT_OUTCOMES: readonly DiagAgentOutcome[] = ["ok", "failed", "cancelled", "refused"];

/** One call an agent made (AGENT-LOOP-PLAN §3.5): who asked, on what, what it cost and how it ended. */
export interface DiagAgentCall {
  /** The agent's role ("gm", "director"). */
  role: string;
  /** The connection's id, or "active" for the user's active connection. */
  connection: string;
  model: string;
  /** Null when the call ended before any count, the provider's or an estimate, came back. */
  usage: DiagUsage | null;
  ms: number;
  outcome: DiagAgentOutcome;
  error?: string;
  /** The tools the answer called, by name, in order; their arguments and results are in the text. */
  tools?: string[];
  /**
   * The blob hash (`shared/stores.ts`) of the call's text, its messages and its answer, read only
   * through `lre.diag`'s `text`; gone once transcript retention (Settings → Agents → Retention) passes.
   */
  text?: string;
}

export interface DiagRecord {
  /** Increasing per chat. */
  seq: number;
  kind: "step" | "error" | "sections" | "slow" | "turn" | "agent";
  level: DiagLevel;
  /** The generation the record belongs to; null outside a turn. */
  turn: string | null;
  phase: DiagPhase | null;
  /** The step, the request type, or where an error was caught. */
  step: string;
  status: DiagStatus;
  /** Epoch ms. */
  start: number;
  end: number;
  ms: number;
  reason?: string;
  /** What the player can do about a failure. */
  fix?: string;
  calls?: DiagCall[];
  /** Section records: the generation path and each section with its outlet and whether it got text. */
  path?: string;
  sections?: DiagSection[];
  /** Agent records: the call. */
  agent?: DiagAgentCall;
}

/** Records kept per chat unless Settings → Diagnostics says otherwise; the oldest go first. */
export const DIAG_RING = 400;

/** Settings → Diagnostics (AGENT-LOOP-PLAN §15). */
export interface DiagnosticsSettings {
  /** Records kept per chat, the oldest going first: agent calls fill them faster than helper steps. */
  recordsPerChat: number;
}

export const DIAGNOSTICS_DEFAULTS: Readonly<DiagnosticsSettings> = Object.freeze({ recordsPerChat: DIAG_RING });

/** `UserSettings.diagnostics` as stored: a whole number of records from 1, with no ceiling, else `base`'s. */
export function diagnosticsSettingsOf(raw: unknown, base: Readonly<DiagnosticsSettings> = DIAGNOSTICS_DEFAULTS): DiagnosticsSettings {
  const n = isRecord(raw) ? raw.recordsPerChat : undefined;
  return { recordsPerChat: typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : base.recordsPerChat };
}

/** A request (a view or an edit) slower than this is recorded. */
export const SLOW_MS = 1000;

/** The in-flight line: what the engine is doing for the chat now, or what failed last. */
export interface Activity {
  chatId: ChatId;
  turn: string | null;
  state: "running" | "failed";
  /** "Planning…", "Asking 3 minds…"; for a failure, the step that failed. */
  label: string;
  /** Epoch ms the turn's work started (running) or the failure happened. */
  since: number;
  /** A running line whose engine run or reply read Cancel can stop now (DESIGN §5.1); absent while it only waits for the reply or for Send. */
  cancellable?: boolean;
}

/** What the chat, Settings and Diagnostics say when this Lumiverse can't stop a generation for the engine run (DESIGN §5.1). */
export const CANNOT_STOP = "This Lumiverse can't stop generation; engine state may be missing.";

/** Why the engine refused a stopped reply for an earlier message: Lumiverse starts only the last reply again (DESIGN §5.1). */
export const NOT_LAST_REPLY = "Lumiverse can only start the last reply again, so the engine can't prepare an earlier message's reply here. Use Edit and Send as a branch, or regenerate the last reply.";

/** A phase's or a model call's in-flight label, by phase or step purpose. */
export const STEP_LABEL: Record<string, string> = {
  engine: "Running the engine…",
  pre: "Planning…",
  interpret: "Reading your action…",
  judge: "Judging the approach…",
  "puzzle.answer": "Judging the answer…",
  "npc.choose": "Choosing what people do…",
  mind: "Asking minds…",
  skip: "Running the time skip…",
  plan: "Planning…",
  prose: "Writing the outline…",
  brief: "Writing the outline…",
  outline: "Writing the outline…",
  sections: "Filling the prompt…",
  book: "Waiting for another chat of this world…",
  clear: "Clearing an earlier turn's sections…",
  restart: "Ready; reopen the chat to continue",
  elsewhere: "Already started in another window",
  ready: "Ready: press Send for the reply",
  reply: "Waiting for the reply…",
  read: "Reading the reply…",
  extract: "Reading the reply…",
  choices: "Writing choices…",
  memory: "Updating memory…",
  consolidate: "Updating memory…",
  knowledge: "Working out who knows what…",
  minds: "Updating the characters' memories…",
  /** The GM assistant answering in GM → Assistant, outside any turn: its label is all the line shows of it. */
  assistant: "Asking the GM assistant…",
};

/** The line while `count` calls for `purpose` are under way: minds are counted ("Asking 3 minds…"). */
export function callLabel(purpose: string, count: number): string {
  if (purpose === "mind") return `Asking ${count} mind${count === 1 ? "" : "s"}…`;
  return STEP_LABEL[purpose] ?? "Asking the model…";
}

/** What the player can do about a failed step or call, from what went wrong. */
export function suggestFix(reason: string, call?: Pick<DiagCall, "finishReason" | "maxTokens" | "purpose"> | null): string | undefined {
  const r = reason.toLowerCase();
  if (call?.finishReason === "length" || /cut off|max.?tokens|finish_reason length/.test(r))
    return `The model's answer was cut off at ${call?.maxTokens ?? "its"} max tokens: raise Max tokens for ${call?.purpose ?? "this step"} in Settings → Steps and connections (a reasoning model spends tokens thinking first).`;
  if (/decision evaluation timed out/.test(r)) return `Lumiverse stops a Decision call at ${formatMs(HOST_LIMITS.decision.maxMs)}, its own limit and not a setting; the step used the helper instead. A faster Decision connection avoids it.`;
  if (/abort|timed? ?out|timeout|wall clock|ran out after/.test(r)) return "The step ran out of time: raise its limit in Settings → Timeouts (Engine run before the reply, Reading the reply after it), or pick a faster model in Settings → Helper model.";
  if (/401|403|unauthori[sz]ed|api key|forbidden/.test(r)) return "The connection refused the call: check its API key in Lumiverse's connections, or route the step to another in Settings → Steps and connections.";
  if (/429|rate.?limit/.test(r)) return "The provider is rate-limiting: wait, lower Model use in Settings, or route steps to another connection.";
  if (/empty|no answer|nothing/.test(r)) return "The model answered nothing usable: check the step's connection and model in Settings → Steps and connections, and its Max tokens.";
  if (/json/.test(r)) return "The model didn't answer in JSON: pick a model that follows instructions for this step in Settings → Steps and connections.";
  if (/outlet|no section|unfilled/.test(r)) return "Nothing reached the reply's prompt: check that your preset's {{outlet::lre_…}} blocks are enabled in Settings → Preset.";
  if (/not loaded|unavailable|no world/.test(r)) return "The chat's world revision isn't loaded: reopen the chat; if it stays, check the world in Build.";
  return undefined;
}
