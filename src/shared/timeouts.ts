// Timeouts (DESIGN §5.6, Settings → Timeouts): every wall clock LumiRPEngine keeps is the user's to
// set, with no ceiling. A value is milliseconds, or "none" for no limit wherever no limit can't break
// what it guards; the smallest number each takes is the least that still works (0 where 0 means "no
// time for it"). A limit that runs out aborts with `TimeoutFired`, which names its setting, so the
// diagnostics and the messages say what ran out and what to raise.
//
// Lumiverse's own limits on what it waits for from an extension are kept apart, in `HOST_LIMITS`: the
// one table to change when Lumiverse changes them. A setting that runs inside one shows it beside the
// setting, and the engine never asks Lumiverse for more than it allows.

import type { JsonObject } from "./json";
import { isRecord } from "./json";
import type { Limit } from "./minds";
import { limitOf } from "./minds";

/** The longest a JavaScript timer can wait (2^31 − 1 ms, about 24.8 days): a longer one fires at once, so a longer limit runs as no limit. */
export const TIMER_MAX_MS = 2_147_483_647;

// ---------------------------------------------------------------- Lumiverse's limits

/** A wait Lumiverse imposes on an extension. */
export interface HostLimit {
  /** What Lumiverse waits for. */
  what: string;
  /** The longest it waits. */
  maxMs: number;
  /** The shortest an extension may ask for; absent where an extension can't ask (the wait is fixed). */
  minMs?: number;
  /** What to ask Lumiverse for when the setting is "none", where that differs from `maxMs` (a heartbeat of 0: no check). */
  noneMs?: number;
  /** Where Lumiverse sets it (staging 7524546f). */
  source: string;
  /** What happens when it runs out. */
  effect: string;
}

/** Lumiverse's limits on the waits LumiRPEngine meets, as Lumiverse staging sets them. */
export const HOST_LIMITS = {
  contextHandler: {
    what: "A context handler, per call",
    minMs: 1_000,
    maxMs: 120_000,
    source: "src/spindle/worker-host.ts:4498-4500 (the clamp), src/spindle/context-handler.ts:64-78 (the timer)",
    effect: "Lumiverse aborts the handler; a required one stops the generation, any other is skipped and the generation goes on without it.",
  },
  decision: {
    what: "A Decision call (decisions.evaluate)",
    maxMs: 30_000,
    source: "src/services/decisions.service.ts:47",
    effect: "The call fails with “Decision evaluation timed out after 30 seconds”; the step falls back to the helper.",
  },
  processStartup: {
    what: "A background process's start-up",
    minMs: 1_000,
    maxMs: 120_000,
    source: "src/spindle/worker-host-process-api.ts:768",
    effect: "Lumiverse stops the process as timed out; its job fails.",
  },
  processHeartbeat: {
    what: "The gap between a background process's heartbeats",
    minMs: 1_000,
    maxMs: 120_000,
    noneMs: 0,
    source: "src/spindle/worker-host-process-api.ts:769 (the clamp), 273-286 (the watchdog; 0 checks nothing)",
    effect: "Lumiverse terminates the process (“Backend process heartbeat timed out”); its job fails.",
  },
  sharedRpc: {
    what: "Another extension's read of LumiRPEngine's shared endpoint (LumiRPEngine Studio)",
    maxMs: 10_000,
    source: "src/spindle/worker-host.ts:971, 1715-1719",
    effect: "The reader's request fails as timed out.",
  },
  socketIdle: {
    what: "An idle event socket (the command line and MCP server)",
    maxMs: 120_000,
    source: "Bun's WebSocket idle timeout: src/app.ts:7 takes hono/bun's `websocket`, and src/main.ts:293-309 sets only the HTTP idleTimeout",
    effect: "Lumiverse closes the socket; the client pings every 45 s to keep it open.",
  },
} as const satisfies Record<string, HostLimit>;

export type HostLimitKey = keyof typeof HOST_LIMITS;

/** What to ask Lumiverse for: the setting within the host's range, "none" its longest (or what it reads as no limit). */
export function hostBound(host: HostLimit, limit: Limit): number {
  if (limit === "none") return host.noneMs ?? host.maxMs;
  return Math.min(host.maxMs, Math.max(host.minMs ?? 0, limit));
}

// ---------------------------------------------------------------- the settings

export const TIMEOUT_KEYS = ["engineRunMs", "preLookupMs", "postReplyMs", "postLookupMs", "guardMs", "skipPlanMs", "requestMs", "caveatsMs", "mindsRunMs", "jobCallMs", "tokenCountMs", "laneStartupMs", "laneHeartbeatMs", "mcpReconnectMs"] as const;

export type TimeoutKey = (typeof TIMEOUT_KEYS)[number];

/** Every timeout, in milliseconds or "none" (`UserSettings.timeouts`). */
export type TimeoutSettings = Record<TimeoutKey, Limit>;

export type TimeoutGroup = "turn" | "app" | "work";

export interface TimeoutDef {
  /** Its name on the page, and in what a fired one says. */
  label: string;
  group: TimeoutGroup;
  /** What it limits. */
  limits: string;
  /** What happens when it runs out. */
  fires: string;
  defaultMs: Limit;
  /** The smallest number it takes. */
  minMs: number;
  /** What 0 means, where it takes 0. */
  zero?: string;
  /** Whether it may be "none", and what that means. */
  none: string | null;
  /** The Lumiverse limit it runs inside, if any. */
  host?: HostLimitKey;
}

const MIN = 60_000;

export const TIMEOUTS: Readonly<Record<TimeoutKey, TimeoutDef>> = {
  engineRunMs: {
    label: "Engine run",
    group: "turn",
    limits: "Everything the engine does before the reply is generated: reading your action, people's choices, judging your approach, puzzle answers, the minds, the plan, the brief and the outline.",
    fires: "The engine run stops: no reply is generated, and the chat says which step ran out, with a Retry.",
    defaultMs: 5 * MIN,
    minMs: 1_000,
    none: "the run takes as long as it needs",
  },
  preLookupMs: {
    label: "Lore lookups before the reply",
    group: "turn",
    limits: "How long after the engine run starts a helper may still ask for lore; a lookup also starts only while a third of the run's time is left.",
    fires: "Helpers answer with the lore they already have.",
    defaultMs: 2 * MIN,
    minMs: 0,
    zero: "no lookups",
    none: "lookups may start until the run's last third",
  },
  postReplyMs: {
    label: "Reading the reply",
    group: "turn",
    limits: "Everything the engine asks a model after the reply: what changed, the contradiction check, people elsewhere, suggested choices, memory.",
    fires: "The reads still waiting are skipped; the reply stands, and Re-read tries again.",
    defaultMs: 5 * MIN,
    minMs: 0,
    zero: "no model calls after the reply",
    none: "the reads take as long as they need",
  },
  postLookupMs: {
    label: "Lore lookups after the reply",
    group: "turn",
    limits: "How long after the reply's reading starts a helper may still ask for lore; a lookup also starts only while a third of the reading's time is left.",
    fires: "Helpers answer with the lore they already have.",
    defaultMs: 2 * MIN,
    minMs: 0,
    zero: "no lookups",
    none: "lookups may start until the reading's last third",
  },
  guardMs: {
    label: "Generation guard",
    group: "turn",
    limits: "Lumiverse's wait for the engine's check, as a generation starts, that the engine's lore entries are fresh. The check itself is instant; this matters only while the engine is busy.",
    fires: "Lumiverse stops the generation, so nothing goes out with stale entries.",
    defaultMs: 2 * MIN,
    minMs: 1_000,
    none: "as long as Lumiverse waits",
    host: "contextHandler",
  },
  skipPlanMs: {
    label: "Time skip plan",
    group: "turn",
    limits: "The one call, as a time skip starts, that plans how the people whose skip is planned by the model spend it.",
    fires: "Nobody is planned: they stay where they are, the GM gets a note, and the skip still runs.",
    defaultMs: 2 * MIN,
    minMs: 1_000,
    none: "the call takes as long as the engine run allows",
  },
  requestMs: {
    label: "Engine requests",
    group: "app",
    limits: "How long this tab waits for the engine to answer a request: a view, an edit, a setting.",
    fires: "The tab says the engine didn't answer; the engine may still finish the request.",
    defaultMs: 5 * MIN,
    minMs: 1_000,
    none: "the tab waits as long as it takes",
  },
  caveatsMs: {
    label: "Preset check",
    group: "app",
    limits: "How long Settings → Caveats waits for its test prompt of the chat before saying the check is still running.",
    fires: "Caveats says the check is still running; it finishes in the background for the next look.",
    defaultMs: MIN,
    minMs: 0,
    zero: "always answer at once",
    none: "wait for the check (Engine requests still bounds the tab's wait)",
  },
  mcpReconnectMs: {
    label: "MCP server reconnect",
    group: "work",
    limits: "How long Reconnect in Lumiverse waits for a server Lumiverse runs to come back with this build's tools, after it is asked to exit.",
    fires: "The server's line says it isn't back, with how to disconnect and connect it in Lumiverse's Settings → MCP Servers.",
    defaultMs: MIN,
    minMs: 1_000,
    none: "the line waits until the server is back",
  },
  mindsRunMs: {
    label: "Minds run on demand",
    group: "work",
    limits: "A minds run started from GM → Minds, from start to end.",
    fires: "The run stops; the minds it finished are kept.",
    defaultMs: 10 * MIN,
    minMs: 1_000,
    none: "the run goes on until it ends or you cancel it",
  },
  jobCallMs: {
    label: "Import and Refine calls",
    group: "work",
    limits: "Each model call of an Import, a Refine, a lore index, a map description or a routine proposal in Build.",
    fires: "That call counts as failed; the job goes on with what the other calls proposed.",
    defaultMs: 10 * MIN,
    minMs: 1_000,
    none: "a call takes as long as it needs (Cancel still stops the job)",
  },
  tokenCountMs: {
    label: "Token counts",
    group: "work",
    limits: "How long Lumiverse's tokenizer may take to count a section before the engine's estimate stands in for it.",
    fires: "The section is priced by the engine's estimate, which stays above the real count.",
    defaultMs: 30_000,
    minMs: 0,
    zero: "always the estimate",
    none: "wait for every count",
  },
  laneStartupMs: {
    label: "Background lane start-up",
    group: "work",
    limits: "How long Playtest and Check world's background process may take to start.",
    fires: "Lumiverse stops the process and the job fails.",
    defaultMs: MIN,
    minMs: 1_000,
    none: "as long as Lumiverse waits",
    host: "processStartup",
  },
  laneHeartbeatMs: {
    label: "Background lane heartbeat",
    group: "work",
    limits: "The longest gap between the background process's heartbeats; it beats after each simulated day or turn.",
    fires: "Lumiverse terminates the process and the job fails.",
    defaultMs: MIN,
    minMs: 1_000,
    none: "Lumiverse checks no heartbeat",
    host: "processHeartbeat",
  },
};

/** A new user's timeouts. */
export function defaultTimeouts(): TimeoutSettings {
  return Object.fromEntries(TIMEOUT_KEYS.map((k) => [k, TIMEOUTS[k].defaultMs])) as TimeoutSettings;
}

/** One stored value: a whole number of ms at or above the setting's least, or "none" where allowed; anything else is `fallback`. */
function limitRead(v: unknown, def: TimeoutDef, fallback: Limit): Limit {
  if (v === "none") return def.none !== null ? "none" : fallback;
  return typeof v === "number" && Number.isInteger(v) && v >= def.minMs && v <= Number.MAX_SAFE_INTEGER ? v : fallback;
}

/** The stored timeouts, each checked; a missing or malformed one is `d`'s. */
export function timeoutsOf(v: unknown, d: Readonly<TimeoutSettings>): TimeoutSettings {
  const raw = isRecord(v) ? v : {};
  return Object.fromEntries(TIMEOUT_KEYS.map((k) => [k, limitRead(raw[k], TIMEOUTS[k], d[k])])) as TimeoutSettings;
}

/**
 * The time limits an older settings file kept in its model-use budgets (`modelUse.budgets.pre|post.ms`
 * and their `lookup.ms`), as timeouts for a file that has none yet: each value still at an old
 * preset's default, or at the most the old Settings allowed, is taken as one the user never chose and
 * becomes the new default when that is longer; any other value is the user's and stays, uncapped. The
 * old fields are dropped. A file that already has timeouts, or has no model-use budgets, comes back as it is.
 */
export function migrateTimeouts(raw: JsonObject): JsonObject {
  const mu = raw.modelUse;
  if (raw.timeouts !== undefined || !isRecord(mu) || !isRecord(mu.budgets)) return raw;
  const timeouts: JsonObject = {};
  const budgets: JsonObject = { ...mu.budgets };
  for (const phase of ["pre", "post"] as const) {
    const b = budgets[phase];
    if (!isRecord(b)) continue;
    const keys = LEGACY[phase];
    const { ms, lookup, ...rest } = b;
    const moved = legacyValue(ms, keys.ms, LEGACY_DEFAULTS[phase].ms);
    if (moved !== undefined) timeouts[keys.ms] = moved;
    if (isRecord(lookup)) {
      const { ms: lookupMs, ...lookupRest } = lookup;
      const window = legacyValue(lookupMs, keys.lookup, LEGACY_DEFAULTS[phase].lookup);
      if (window !== undefined) timeouts[keys.lookup] = window;
      budgets[phase] = { ...rest, lookup: lookupRest };
    } else budgets[phase] = { ...rest, ...(lookup !== undefined ? { lookup } : {}) };
  }
  return { ...raw, modelUse: { ...mu, budgets }, timeouts };
}

/** Where each phase's old fields go. */
const LEGACY = { pre: { ms: "engineRunMs", lookup: "preLookupMs" }, post: { ms: "postReplyMs", lookup: "postLookupMs" } } as const;

/** The old presets' wall clocks and lookup windows (Lean, Standard, Full), with the most the old Settings let each be set to. */
const LEGACY_DEFAULTS = {
  pre: { ms: [20_000, 30_000, 60_000, 105_000], lookup: [0, 15_000, 30_000, 120_000] },
  post: { ms: [30_000, 45_000, 60_000, 120_000, 600_000], lookup: [0, 20_000, 30_000, 120_000] },
} as const;

function legacyValue(v: unknown, key: TimeoutKey, olds: readonly number[]): Limit | undefined {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return undefined;
  const fresh = TIMEOUTS[key].defaultMs;
  return olds.includes(v) && limitOf(fresh) > v ? fresh : v;
}

// ---------------------------------------------------------------- running out

/** A duration as the page and the messages say it: "45 s", "1.5 s", "2 min", "1 min 30 s", "1 h 5 min". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "no limit";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < MIN) return `${Number((ms / 1000).toFixed(1))} s`;
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : "", s > 0 && h === 0 ? `${s} s` : ""].filter((p) => p !== "").join(" ");
}

/** A timeout that ran out: the reason a signal aborts with, naming the setting. */
export class TimeoutFired extends Error {
  constructor(
    readonly key: TimeoutKey,
    readonly ms: number,
  ) {
    const where = `Settings → Timeouts → ${TIMEOUTS[key].label}`;
    super(ms === 0 ? `${TIMEOUTS[key].label} is set to 0 (${where}), which leaves no time` : `${TIMEOUTS[key].label} ran out after ${formatMs(ms)} (${where})`);
    this.name = "TimeoutError";
  }

  /** What the user can do about it. */
  get fix(): string {
    return `Raise ${TIMEOUTS[this.key].label} in Settings → Timeouts${TIMEOUTS[this.key].none !== null ? ", or set it to No limit" : ""}.`;
  }
}

/** A time limit as a budget takes one: which setting, and its value. */
export interface Timeout {
  key: TimeoutKey;
  limit: Limit;
}

/** A limit's milliseconds for a timer: null for no limit, or one longer than a timer can wait. */
export function timerMs(limit: Limit): number | null {
  const ms = limitOf(limit);
  return ms >= TIMER_MAX_MS ? null : Math.max(0, ms);
}

/** A signal that aborts with `TimeoutFired` once the limit runs out; null for no limit. */
export function timeoutSignal(key: TimeoutKey, limit: Limit): AbortSignal | null {
  const ms = timerMs(limit);
  if (ms === null) return null;
  if (ms === 0) return AbortSignal.abort(new TimeoutFired(key, 0));
  const controller = new AbortController();
  setTimeout(() => controller.abort(new TimeoutFired(key, ms)), ms);
  return controller.signal;
}

/** `parent`, ended as well when the limit runs out; `parent` alone for no limit. */
export function within(parent: AbortSignal | undefined, key: TimeoutKey, limit: Limit): AbortSignal {
  const own = timeoutSignal(key, limit);
  if (!own) return parent ?? new AbortController().signal;
  return parent ? AbortSignal.any([parent, own]) : own;
}

/** The timeout a signal ended with, if a timeout ended it. */
export function firedTimeout(signal: AbortSignal | null | undefined): TimeoutFired | null {
  return signal?.aborted && signal.reason instanceof TimeoutFired ? signal.reason : null;
}
