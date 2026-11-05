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
 * An agent call's tokens: `in` (of which `cachedIn` the provider read from its cache, and `cacheWrite`
 * it wrote to it) and `out` (of which `reasoningOut` reasoning). `estimated` names the counts the
 * provider didn't report, which hold the agent runtime's estimate; absent when every count is the
 * provider's. `cacheWrite` is never an estimate: absent when the provider doesn't say, so a call that
 * wrote nothing tells apart from one whose provider doesn't report writes.
 */
export interface DiagUsage {
  in: number;
  cachedIn: number;
  cacheWrite?: number;
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
  /** The tools the call was offered: how many, and about how many tokens their definitions took (Settings → Speed shows it beside the cached share). */
  offered?: DiagOffered;
  /**
   * The blob hash (`shared/stores.ts`) of the call's text, its messages and its answer, read only
   * through `lre.diag`'s `text`; gone once transcript retention (Settings → Agents → Retention) passes.
   */
  text?: string;
}

/** The tools an agent call was offered: how many, and their definitions' tokens, as estimated. */
export interface DiagOffered {
  tools: number;
  tokens: number;
}

/** One step of a slow request's time (a GM view's read, decode, render, build and encode), in ms. */
export interface DiagStep {
  name: string;
  ms: number;
}

export interface DiagRecord {
  /** Increasing per chat. */
  seq: number;
  /** `phase`: one part of a turn's time (`TURN_PHASES`), its name the record's step and its cause the reason. */
  kind: "step" | "error" | "sections" | "slow" | "turn" | "agent" | "phase";
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
  /** Slow records: where the request's time went, step by step, in order. */
  steps?: DiagStep[];
  /** An agent turn's own failure (INC2-SPEC lane T1): the one kind of record that stops an agent turn, as its roles' failures follow their own settings instead. */
  fatal?: true;
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

// ---------------------------------------------------------------- where a turn's time went

/**
 * The parts of a turn's time, in the turn's order (Settings → Speed, GM → Live and Diagnostics show
 * them as "Where the last turn's time went"). Each is recorded as it ends (`Diagnostics.phase`), with
 * its time and, where it says why, its cause: `wait` the time the turn waited for the chat (another
 * write or turn holding it), `setup` reading the chat and settings up to the first model call,
 * `compaction` the main session's summary of earlier turns on the turn's path (cause `ready` when it
 * was made ahead), `digest` what changed since the main agent's last turn, `stage.<stage>` the main
 * agent's sends in each stage, `plan` the engine's plan, `brief` the narrator's brief and outline,
 * `final_review` the final review, `reply` the narrator's reply, `read` the reply's read, and `memory`
 * the minds' memory.
 */
export const TURN_PHASES = ["wait", "setup", "compaction", "digest", "stage.intent", "stage.prepare", "stage.beats", "stage.read", "stage.memory", "plan", "brief", "final_review", "reply", "read", "memory"] as const;
export type TurnPhaseName = (typeof TURN_PHASES)[number];

/** Each part of a turn's time, as "Where the last turn's time went" names it. */
export const TURN_PHASE_LABEL: Readonly<Record<TurnPhaseName, string>> = Object.freeze({
  wait: "Waiting for the chat",
  setup: "Setup",
  compaction: "Summarizing earlier turns",
  digest: "What changed since the last turn",
  "stage.intent": "Main agent: the intent",
  "stage.prepare": "Main agent: scene, minds and decisions",
  "stage.beats": "Main agent: the beats",
  "stage.read": "Main agent: the read",
  "stage.memory": "Main agent: the memory",
  plan: "The plan",
  brief: "The narrator's brief",
  final_review: "The final review",
  reply: "The reply",
  read: "The reply's read",
  memory: "Memory",
});

/** Whether a record's step names a part of a turn's time. */
export function isTurnPhase(name: string): name is TurnPhaseName {
  return (TURN_PHASES as readonly string[]).includes(name);
}

/** One agent call inside a part of the turn's time: its role, model, time, the tools it was offered and the share of its prompt read from the provider's cache. */
export interface TimelineCall {
  role: string;
  model: string;
  ms: number;
  offered: DiagOffered | null;
  /** `cachedIn / in`, 0 to 1; null when the call has no counts. */
  cached: number | null;
}

/** One row of "Where the last turn's time went": a part of the turn, its time and cause, the calls made inside it, and whether it was the slowest. */
export interface TimelineRow {
  name: TurnPhaseName;
  label: string;
  ms: number;
  cause: string | null;
  start: number;
  calls: TimelineCall[];
  slowest: boolean;
}

/** A turn's time, part by part: its turn id, when it started, its rows in order and their time in all. */
export interface TurnTimeline {
  turn: string;
  start: number;
  ms: number;
  rows: TimelineRow[];
}

/**
 * Where a turn's time went (Settings → Speed, GM → Live, Diagnostics): `turn`'s phase records (the
 * latest turn that has any when `turn` is absent), in the order they started, each with the agent
 * calls that ended inside it, the slowest marked. Null when no turn has phase records yet.
 */
export function turnTimeline(records: readonly DiagRecord[], turn?: string): TurnTimeline | null {
  const phases = records.filter((r) => r.kind === "phase" && r.turn !== null && isTurnPhase(r.step));
  const id = turn ?? phases.reduce<DiagRecord | null>((latest, r) => (latest === null || r.start > latest.start || (r.start === latest.start && r.seq > latest.seq) ? r : latest), null)?.turn;
  if (id === undefined || id === null) return null;
  const own = phases.filter((r) => r.turn === id).sort((a, b) => a.start - b.start || a.seq - b.seq);
  if (own.length === 0) return null;
  const agents = records.filter((r) => r.kind === "agent" && r.turn === id && r.agent);
  const slowest = own.reduce((max, r) => (r.ms > max.ms ? r : max), own[0] as DiagRecord);
  const rows = own.map((r): TimelineRow => {
    const calls = agents
      .filter((a) => a.end > r.start && a.end <= r.end)
      .map((a): TimelineCall => {
        const call = a.agent as DiagAgentCall;
        const u = call.usage;
        return { role: call.role, model: call.model, ms: call.ms, offered: call.offered ?? null, cached: u && u.in > 0 ? Math.min(1, u.cachedIn / u.in) : null };
      });
    return { name: r.step as TurnPhaseName, label: TURN_PHASE_LABEL[r.step as TurnPhaseName], ms: r.ms, cause: r.reason ?? null, start: r.start, calls, slowest: r === slowest && r.ms > 0 };
  });
  const start = Math.min(...own.map((r) => r.start));
  const end = Math.max(...own.map((r) => r.end));
  return { turn: id, start, ms: end - start, rows };
}

/** A part's time in words, as the timeline says it: "7 min 46 s", "14.2 s", "350 ms". */
export function phaseTimeText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

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
  /** While an agent turn runs, one row per agent at work (the live trace, AGENT-LOOP-PLAN §9); absent when none is. */
  agents?: ActivityAgent[];
}

/**
 * One role at work in the chat's turn, as the drawer's live trace shows it: its id (the role's, the
 * handle the row is kept by), its label as Settings → Agents names it, and the tokens all its agents
 * have sent and written this turn. One row per role, never one per agent, whose count would tell how
 * many people it works for; and nothing else: what it reads and the tools it calls can name what the
 * player hasn't met. Its Cancel is the line's own (`lre.cancel`), which stops every agent of the turn (§10).
 */
export interface ActivityAgent {
  id: string;
  label: string;
  tokens: { in: number; out: number };
}

/** What the chat, Settings and Diagnostics say when this Lumiverse can't stop a generation for the engine run (DESIGN §5.1). */
export const CANNOT_STOP = "This Lumiverse can't stop generation; engine state may be missing.";

/** Why the engine refused a stopped reply for an earlier message: Lumiverse starts only the last reply again (DESIGN §5.1). */
export const NOT_LAST_REPLY = "Lumiverse can only start the last reply again, so the engine can't prepare an earlier message's reply here. Use Edit and Send as a branch, or regenerate the last reply.";

/** Why an engine run failed as it started: what the turn runs on (DESIGN §5.1: the user's settings and the chat's own choices, `TurnFrame`) couldn't be read; the failure's own message follows it. */
export const FRAME_UNREAD = "your settings and this chat's choices couldn't be read for the turn";

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
  /** The main agent's final review of the narrator's prompt (DESIGN §4.6), after the sections are made. */
  "final review": "Reviewing the prompt…",
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
  /** The main agent working a stage of an agent turn (`pipeline.mode: main`): its label is all the line shows of it. */
  main: "The main agent is working…",
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
