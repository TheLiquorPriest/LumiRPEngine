// Settings → Speed: every setting that decides how long a turn takes, in one place, and three
// presets over them. Each row is one setting, by its path in `UserSettings`, with the page it lives
// on; the Speed page edits it in place (the A7 kit: Changed, Default, Reset). A preset is a few of
// those rows set at once: Thorough is the shipped defaults, Balanced keeps a quiet scene's work,
// reviews only what changed and runs more calls at once, and Fast also lets the intent and prepare
// stages run on their own and skips the Curator on quiet turns. Picking one lists what it changes
// before it applies; "Back to Thorough" puts back only the rows a preset sets. Pure: rows read and
// patch settings as JSON, so a key another part of Settings adds needs no type here.

import { defaultAgentSettings } from "./agent-settings";
import type { TurnPhaseName } from "./diagnostics";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "./json";
import { defaultMindsSettings } from "./minds";
import { GM_PAGE_DEFAULTS, PERF_DEFAULTS } from "./settings";

/** The Speed page's groups, in its order. */
export const SPEED_GROUPS = ["before", "remember", "reuse", "calls", "pages"] as const;
export type SpeedGroup = (typeof SPEED_GROUPS)[number];

export const SPEED_GROUP_LABEL: Readonly<Record<SpeedGroup, string>> = Object.freeze({
  before: "Before the reply",
  remember: "Remembering past turns",
  reuse: "Reusing work",
  calls: "Calls",
  pages: "Pages",
});

/** Where a row's setting lives: its page's name, and the Settings route that opens it there. */
export interface SpeedPage {
  label: string;
  route: { page: string; sub?: string; at?: string };
}

/** How a row's value is set: a switch, one of a few choices, a whole number, or a limit that may be lifted ("none"). */
export type SpeedControl =
  | { kind: "switch" }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  | { kind: "number"; min: number; max?: number; step: number; unit: string }
  | { kind: "limit"; min: number; step: number; unit: string; onValue: number; none: string };

/** One speed setting: its id, its path in the settings, its name and help, its group, the page it lives on, and how it is set. `fix` is what "Where the last turn's time went" calls it when it points there. */
export interface SpeedRow {
  id: string;
  path: readonly string[];
  label: string;
  help: string;
  group: SpeedGroup;
  page: SpeedPage;
  control: SpeedControl;
  fix: string;
}

const MAIN_STAGES_PAGE: SpeedPage = { label: "Settings → Main agent → Stages", route: { page: "main", at: "stages" } };
const FINAL_REVIEW_PAGE: SpeedPage = { label: "Settings → Main agent → Final review", route: { page: "main", at: "review" } };
const SESSION_PAGE: SpeedPage = { label: "Settings → Main agent → Session", route: { page: "main", at: "session" } };
const PIPELINE_PAGE: SpeedPage = { label: "Settings → Agents → Pipeline", route: { page: "agents", sub: "pipeline" } };
const CACHING_PAGE: SpeedPage = { label: "Settings → Agents → Caching", route: { page: "agents", sub: "caching" } };
const THROTTLES_PAGE: SpeedPage = { label: "Settings → Agents → Throttles", route: { page: "agents", sub: "throttles" } };
const BUDGETS_PAGE: SpeedPage = { label: "Settings → Agents → Budgets", route: { page: "agents", sub: "budgets" } };
const MINDS_PAGE: SpeedPage = { label: "Settings → Minds", route: { page: "minds" } };
const SPEED_PAGE: SpeedPage = { label: "Settings → Speed", route: { page: "speed" } };
const CURATOR_PAGE: SpeedPage = { label: "Settings → Roles → Curator → When it runs", route: { page: "roles", sub: "curator", at: "when" } };

const STAGE_CHOICE: SpeedControl = {
  kind: "choice",
  options: [
    { value: "main", label: "The main agent decides" },
    { value: "auto", label: "Runs on its own" },
  ],
};

/** Every speed setting, in the page's order. */
export const SPEED_ROWS: readonly SpeedRow[] = Object.freeze([
  { id: "stage.intent", path: ["agents", "main", "stages", "intent"], label: "Stage 1: the intent", help: "On its own, the intent role reads the message with no main-agent send first; the next send says what ran.", group: "before", page: MAIN_STAGES_PAGE, control: STAGE_CHOICE, fix: "Run stage 1 on its own" },
  { id: "stage.prepare", path: ["agents", "main", "stages", "prepare"], label: "Stage 3: scene, minds and decisions", help: "On its own, the scene, the minds and the director's decisions start at once, with no main-agent send first.", group: "before", page: MAIN_STAGES_PAGE, control: STAGE_CHOICE, fix: "Run stage 3 on its own" },
  { id: "stage.beats", path: ["agents", "main", "stages", "beats"], label: "Stage 5: the beats", help: "On its own, the director's brief and outline are written with no main-agent send first.", group: "before", page: MAIN_STAGES_PAGE, control: STAGE_CHOICE, fix: "Run stage 5 on its own" },
  { id: "review.on", path: ["agents", "finalReview", "on"], label: "Final review", help: "Before each reply the main agent reviews the narrator's prompt and may revise it. Off, the narrator gets the prompt as the engine made it.", group: "before", page: FINAL_REVIEW_PAGE, control: { kind: "switch" }, fix: "Turn the final review off" },
  {
    id: "review.scope",
    path: ["agents", "finalReview", "scope"],
    label: "What the final review is sent",
    help: "While Smart persistence is on, only the parts that changed since the last turn, the last turn's edits made again on the rest.",
    group: "before",
    page: FINAL_REVIEW_PAGE,
    control: {
      kind: "choice",
      options: [
        { value: "all", label: "Every part" },
        { value: "changed", label: "Only what changed" },
      ],
    },
    fix: "Review only what changed",
  },
  {
    id: "compaction.when",
    path: ["agents", "compaction", "when"],
    label: "When earlier turns are summarized",
    help: "Ahead of time, the summary the next turn needs is written while this turn ends, and the next turn starts with it ready. As the turn starts, the turn waits for it.",
    group: "remember",
    page: SESSION_PAGE,
    control: {
      kind: "choice",
      options: [
        { value: "ahead", label: "Ahead of time" },
        { value: "before_turn", label: "As the turn starts" },
      ],
    },
    fix: "Summarize ahead of time",
  },
  { id: "compaction.summaryTokens", path: ["agents", "compaction", "summaryTokens"], label: "Summary length", help: "The most the summary of earlier turns may be, in tokens. A summary cut off at it is never kept.", group: "remember", page: SESSION_PAGE, control: { kind: "number", min: 1000, step: 1000, unit: "tokens" }, fix: "Write a shorter summary" },
  { id: "compaction.atTokens", path: ["agents", "compaction", "atTokens"], label: "Summarize the session past", help: "How long the main agent's session may grow before everything but its latest turns is summarized.", group: "remember", page: SESSION_PAGE, control: { kind: "number", min: 1, step: 1000, unit: "tokens" }, fix: "Summarize less often" },
  { id: "compaction.keepTurns", path: ["agents", "compaction", "keepTurns"], label: "Recent turns kept whole", help: "How many of the latest turns a summary leaves as they were.", group: "remember", page: SESSION_PAGE, control: { kind: "number", min: 0, step: 1, unit: "turns" }, fix: "Keep fewer turns whole" },
  {
    id: "session.keeps",
    path: ["agents", "main", "sessionKeeps"],
    label: "What past turns keep",
    help: "Receipts keep each past turn's long messages as their ids, sizes and first lines, which a tool reads whole on request; whole keeps every message as it was sent.",
    group: "remember",
    page: SESSION_PAGE,
    control: {
      kind: "choice",
      options: [
        { value: "receipts", label: "Receipts" },
        { value: "whole", label: "Whole messages" },
      ],
    },
    fix: "Keep receipts of past turns",
  },
  { id: "session.receiptChars", path: ["agents", "main", "receiptChars"], label: "A receipt's first characters", help: "How much of a long result a past turn's receipt keeps in its session.", group: "remember", page: SESSION_PAGE, control: { kind: "number", min: 0, step: 100, unit: "characters" }, fix: "Keep shorter receipts" },
  { id: "persist.on", path: ["agents", "persist", "on"], label: "Smart persistence", help: "While a scene is unchanged since the last turn, its Live minds and the scene role's lore and notes are kept instead of asked again.", group: "reuse", page: PIPELINE_PAGE, control: { kind: "switch" }, fix: "Turn on Smart persistence" },
  { id: "persist.turns", path: ["agents", "persist", "turns"], label: "Turns kept in a row", help: "How many turns in a row a quiet scene's work may be kept before it is asked afresh.", group: "reuse", page: PIPELINE_PAGE, control: { kind: "number", min: 1, step: 1, unit: "turns" }, fix: "Keep a quiet scene longer" },
  { id: "persist.minutes", path: ["agents", "persist", "minutes"], label: "World minutes kept", help: "How much of the world's time may pass in a quiet scene before its work is asked afresh.", group: "reuse", page: PIPELINE_PAGE, control: { kind: "number", min: 1, step: 5, unit: "minutes" }, fix: "Keep a quiet scene longer" },
  { id: "perf.reuseViews", path: ["perf", "reuseViews"], label: "Reuse built views", help: "A view built for the chat as it stands (the GM page's parts, the state they read) is shared by every request until the chat changes, instead of built again for each.", group: "reuse", page: SPEED_PAGE, control: { kind: "switch" }, fix: "Reuse built views" },
  { id: "caching.on", path: ["agents", "caching", "on"], label: "Prompt caching", help: "Each agent's unchanged opening is read from the provider's cache, which is faster and costs less.", group: "reuse", page: CACHING_PAGE, control: { kind: "switch" }, fix: "Turn prompt caching on" },
  { id: "calls.atOnce", path: ["agents", "callsAtOnce"], label: "Calls at once", help: "How many of a turn's calls may be under way on one connection at once, on every connection whose throttle sets none of its own. A call past it waits; nothing is refused.", group: "calls", page: THROTTLES_PAGE, control: { kind: "limit", min: 1, step: 1, unit: "calls", onValue: 4, none: "No limit" }, fix: "Allow more calls at once" },
  { id: "knowledge.atOnce", path: ["minds", "knowledge", "callsAtOnce"], label: "Knowledge calls at once", help: "How many of the knowledge step's calls go out together; their answers are checked in the order they come back.", group: "calls", page: MINDS_PAGE, control: { kind: "number", min: 1, max: 8, step: 1, unit: "calls" }, fix: "Ask knowledge calls at once" },
  { id: "tools.atOnce", path: ["agents", "budget", "concurrency"], label: "Tool calls at once", help: "How many of one answer's tool calls run at the same time.", group: "calls", page: BUDGETS_PAGE, control: { kind: "number", min: 1, step: 1, unit: "calls" }, fix: "Run more tool calls at once" },
  {
    id: "curator.gate",
    path: ["agents", "pipeline", "curatorGate"],
    label: "Skip the Curator on quiet turns",
    help: "On, a turn whose reply names no thing, walk-on, hand-over, placement or purchase skips the Curator. Shadow only records what it would have decided.",
    group: "calls",
    page: CURATOR_PAGE,
    control: {
      kind: "choice",
      options: [
        { value: "off", label: "Off" },
        { value: "shadow", label: "Shadow" },
        { value: "on", label: "On" },
      ],
    },
    fix: "Skip the Curator on quiet turns",
  },
  {
    id: "memory.when",
    path: ["agents", "pipeline", "memory"],
    label: "When memory runs",
    help: "After the reply, the minds' memory runs inside its read; before the next turn, it runs first in that turn instead.",
    group: "calls",
    page: PIPELINE_PAGE,
    control: {
      kind: "choice",
      options: [
        { value: "after_reply", label: "After the reply" },
        { value: "before_next", label: "Before the next turn" },
      ],
    },
    fix: "Run memory before the next turn",
  },
  {
    id: "gm.duringTurn",
    path: ["gm", "duringTurn"],
    label: "GM page while a turn runs",
    help: "Held, the GM page shows the chat as it was before the turn until you press Refresh, so it isn't built again with every change; live, it follows every change.",
    group: "pages",
    page: SPEED_PAGE,
    control: {
      kind: "choice",
      options: [
        { value: "hold", label: "Held" },
        { value: "live", label: "Live" },
      ],
    },
    fix: "Hold the GM page while a turn runs",
  },
] satisfies SpeedRow[]);

/** A row by its id. */
export function speedRow(id: string): SpeedRow | undefined {
  return SPEED_ROWS.find((r) => r.id === id);
}

/** The row each part of a turn's time points to, when one decides it: what "Where the last turn's time went" links its slowest part to. */
export const PHASE_CONTROL: Readonly<Partial<Record<TurnPhaseName, string>>> = Object.freeze({
  wait: "perf.reuseViews",
  setup: "perf.reuseViews",
  compaction: "compaction.when",
  "stage.intent": "stage.intent",
  "stage.prepare": "stage.prepare",
  "stage.beats": "stage.beats",
  "stage.read": "curator.gate",
  "stage.memory": "memory.when",
  plan: "persist.on",
  brief: "stage.beats",
  final_review: "review.scope",
  read: "curator.gate",
  memory: "memory.when",
});

// ---------------------------------------------------------------- the presets

export const SPEED_PRESETS = ["thorough", "balanced", "fast"] as const;
export type SpeedPresetId = (typeof SPEED_PRESETS)[number];

/** Each preset's name and what it is for. */
export const SPEED_PRESET_WORDS: Readonly<Record<SpeedPresetId, { label: string; summary: string }>> = Object.freeze({
  thorough: { label: "Thorough", summary: "The shipped settings: every role asked every turn, the whole prompt reviewed, one call after another." },
  balanced: { label: "Balanced", summary: "A quiet scene's work kept for 3 turns or 30 minutes, only what changed reviewed, 4 calls at once, knowledge 2 at once." },
  fast: { label: "Fast", summary: "Balanced, plus the intent and prepare stages on their own, knowledge 3 at once, and the Curator skipped on quiet turns." },
});

const BALANCED: Readonly<Record<string, JsonValue>> = Object.freeze({
  "persist.on": true,
  "persist.turns": 3,
  "persist.minutes": 30,
  "review.scope": "changed",
  "calls.atOnce": 4,
  "knowledge.atOnce": 2,
});

/** What each preset sets, by row id; a row a preset leaves out is the default's. Thorough sets none: it is the defaults. */
export const SPEED_PRESET_VALUES: Readonly<Record<SpeedPresetId, Readonly<Record<string, JsonValue>>>> = Object.freeze({
  thorough: Object.freeze({}),
  balanced: BALANCED,
  fast: Object.freeze({ ...BALANCED, "stage.intent": "auto", "stage.prepare": "auto", "knowledge.atOnce": 3, "curator.gate": "on" }),
});

/** Every row some preset sets: the ones "Back to Thorough" puts back. */
export const PRESET_ROWS: readonly string[] = Object.freeze([...new Set(Object.values(SPEED_PRESET_VALUES).flatMap((values) => Object.keys(values)))]);

/** The shipped values of the settings Speed shows: what Thorough is, and what a row's Default goes back to. */
export function speedDefaults(): JsonObject {
  return JSON.parse(JSON.stringify({ agents: defaultAgentSettings(), minds: defaultMindsSettings(), gm: GM_PAGE_DEFAULTS, perf: PERF_DEFAULTS })) as JsonObject;
}

const DEFAULTS = speedDefaults();

/** The value at `path` in `settings`, or undefined where it has none. */
export function valueAt(settings: unknown, path: readonly string[]): JsonValue | undefined {
  let at: unknown = settings;
  for (const key of path) {
    if (!isRecord(at) || !hasOwn(at, key)) return undefined;
    at = at[key];
  }
  return at as JsonValue | undefined;
}

/** A row's shipped value: undefined while the setting isn't one this build's settings have. */
export function rowDefault(row: SpeedRow): JsonValue | undefined {
  return valueAt(DEFAULTS, row.path);
}

/** A row's value in `settings` (its default where the settings have none). */
export function rowValue(settings: unknown, row: SpeedRow): JsonValue | undefined {
  return valueAt(settings, row.path) ?? rowDefault(row);
}

/** Whether a row's setting differs from its default. */
export function rowChanged(settings: unknown, row: SpeedRow): boolean {
  return JSON.stringify(rowValue(settings, row)) !== JSON.stringify(rowDefault(row));
}

/** A merge patch that sets `path` to `value` (null puts back the default). */
export function patchAt(path: readonly string[], value: JsonValue | null): JsonObject {
  let out: JsonValue | null = value;
  for (const key of [...path].reverse()) out = { [key]: out };
  return out as JsonObject;
}

/** One patch made of several, merged key by key. */
function merged(patches: readonly JsonObject[]): JsonObject {
  const out: JsonObject = {};
  const into = (target: JsonObject, patch: JsonObject): void => {
    for (const [key, value] of Object.entries(patch)) {
      const known = target[key];
      if (isRecord(value) && isRecord(known)) into(known, value);
      else target[key] = isRecord(value) ? JSON.parse(JSON.stringify(value)) : value;
    }
  };
  for (const patch of patches) into(out, patch);
  return out;
}

/** One row a preset would change: from what it is now to what the preset makes it. */
export interface SpeedChange {
  row: SpeedRow;
  from: JsonValue | undefined;
  to: JsonValue | undefined;
}

/** The value a preset gives a row it sets, else the default; undefined for a row no preset sets. */
function presetValue(id: SpeedPresetId, rowId: string): JsonValue | undefined {
  const values = SPEED_PRESET_VALUES[id];
  if (hasOwn(values, rowId)) return values[rowId];
  const row = speedRow(rowId);
  return row ? rowDefault(row) : undefined;
}

/**
 * What picking preset `id` changes in `settings`: each row some preset sets whose value now differs
 * from the preset's (Thorough's are the defaults), with its patch. Rows no preset sets, rows whose
 * setting this build's settings don't have (the page leaves them out, and the store would keep none
 * of it), and every other setting, are left as they are. Empty when the settings are the preset already.
 */
export function presetChanges(settings: unknown, id: SpeedPresetId): { changes: SpeedChange[]; patch: JsonObject } {
  const changes: SpeedChange[] = [];
  const patches: JsonObject[] = [];
  for (const rowId of PRESET_ROWS) {
    const row = speedRow(rowId);
    if (!row || rowDefault(row) === undefined) continue;
    const to = presetValue(id, rowId);
    const from = rowValue(settings, row);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ row, from, to });
    // Back to a default is a reset: the setting follows its default from then on.
    patches.push(patchAt(row.path, JSON.stringify(to) === JSON.stringify(rowDefault(row)) ? null : (to ?? null)));
  }
  return { changes, patch: merged(patches) };
}

/** Which preset the settings are now, by the rows presets set: the first whose values all hold, else null (your own mix). */
export function currentSpeedPreset(settings: unknown): SpeedPresetId | null {
  return SPEED_PRESETS.find((id) => presetChanges(settings, id).changes.length === 0) ?? null;
}

/** How many of Speed's rows differ from their defaults: what Settings home and the Agents hub's card badge. */
export function speedChanged(settings: unknown): number {
  return SPEED_ROWS.filter((row) => rowChanged(settings, row)).length;
}

/** A row's value in words, as the page and a preset's list of changes say it. */
export function speedValueText(row: SpeedRow, value: JsonValue | undefined): string {
  const c = row.control;
  if (value === undefined) return "—";
  if (c.kind === "switch") return value === true ? "On" : "Off";
  if (c.kind === "choice") return c.options.find((o) => o.value === value)?.label ?? String(value);
  if (c.kind === "limit" && value === "none") return c.none;
  return typeof value === "number" ? `${value.toLocaleString("en-US")} ${c.unit}` : String(value);
}
