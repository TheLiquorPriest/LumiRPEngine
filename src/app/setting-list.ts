// The settings registry (plan §5.4 "Config", §14, Appendix D.1): every value RPE and RPH read is a
// setting, declared once by the area that reads it, in that area's own list: its key as a config file
// writes it, its default, what it takes, the levels it is read from, whether it is set per connection
// or per agent definition, when a change to it takes effect, what the Settings page calls it, one line
// on what it does, the advice the page gives beside a value past what is usual, and its row of
// Appendix D.1 where it has one. The app gathers every area's list into one registry (`App.settings`);
// the readers read each value through it (`config-read.ts`), and the Settings routes show and write
// every setting from it, so a setting added to a list is read, shown and written with nothing else
// changed. The page finds each in a section and a group of plain words (`groupOf`), and shows a
// number with the unit its key ends with (`unitOf`).
//
// No hard cap (plan §2.1 point 5): what a setting takes is bounded only where a value beyond the bound
// has no meaning at all (a count below zero); every other bound is advice, a line the page shows
// beside the control while the value passes it, and the value is taken.
//
// RPH's own list and the declaration it uses (`SettingDef`, `SettingTakes`) are RPH's
// (`rp-harness/helpers`, `rp-harness/contract`). A key RPH declares is listed from RPH's list alone,
// with RPH's default, and never declared again here (`harnessSettings`). RPE adds two shapes of its
// own beside RPH's (`Takes`): a table of names to values, and a list of records with named fields.
//
// The config files of a chat's levels are merged by RPH's merge of levels (`mergedConfig`), so RPE
// reads every level exactly as RPH reads it, and every value of a shape RPH declares is checked by
// RPH's one check (`checkSettingValue`).

import type { JsonValue, SettingDef, SettingTakes } from "rp-harness/contract";
import { checkSettingValue, SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";

export type { SettingAdvice, SettingDef, SettingTakes } from "rp-harness/contract";
export { mergedConfig } from "rp-harness/helpers";

/** Where a per-connection setting's key names the connection, by its name or its id. */
export const CONNECTION_PART = "<connection>";

/** Where a setting set per agent definition names the definition, by its name (`agents.<definition>.sampling.temperature`). */
export const DEFINITION_PART = "<definition>";

/** Whether a part of a key is where a connection or a definition is named. */
export function isNamedPart(part: string): boolean {
  return part === CONNECTION_PART || part === DEFINITION_PART;
}

/** What a setting is set for one of at a time: a connection, an agent definition; null for neither. */
export type SetFor = "connection" | "definition";

export function setFor(def: Pick<SettingDef, "key" | "perConnection">): SetFor | null {
  if (def.perConnection) return "connection";
  return def.key.split(".").includes(DEFINITION_PART) ? "definition" : null;
}

export type Mapping = { [key: string]: JsonValue };

export function isMapping(value: unknown): value is Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------- the registry's declaration

/** A field of a record a list of records holds: its name, what it takes, and one line on what it is. */
export interface RecordField {
  readonly name: string;
  readonly takes: SettingTakes;
  readonly about: string;
}

/**
 * The shapes RPE's registry declares beyond RPH's `SettingTakes`. `table`: a mapping of names (a
 * situation, an agent) to values that each take `of`; with `whole`, a value that takes `of` alone is
 * taken too, for every name at once (`stack.instructions: [STYLE]`). `records`: a list of records, each a
 * mapping holding every field, shown as a table and written whole (`stack.pins`).
 */
export type RpeTakes = { readonly type: "table"; readonly of: SettingTakes; readonly whole?: true } | { readonly type: "records"; readonly fields: readonly RecordField[] };

/** What a level may set a setting to: one of RPH's shapes, or one of RPE's own. */
export type Takes = SettingTakes | RpeTakes;

/** When a change to a setting is in force: at its next use, from the next turn (or job), or from RPE's next start. */
export type Effect = "use" | "turn" | "start";

/** Each moment as the Settings page and the docs word it. */
export const EFFECT_WORDS: Readonly<Record<Effect, string>> = Object.freeze({ use: "at its next use", turn: "from the next turn", start: "from RPE's next start" });

/** A setting as any list declares it, RPH's or RPE's: RPH's declaration, with RPE's own shapes beside RPH's among what it takes. */
export type Declared = Omit<SettingDef, "takes"> & { readonly takes: Takes };

/** A setting of the registry: declared with its words, when it takes effect and its row of Appendix D.1. */
export interface Setting extends Omit<Declared, "name" | "about"> {
  /** What the Settings page calls it. */
  readonly name: string;
  /** One line on what it does, on the Settings page and in docs/settings.md. Words for the owner, never sent to a model. */
  readonly about: string;
  readonly effect: Effect;
  /** Its row of Appendix D.1, as the row's first column words it; absent for a value beyond D.1, listed for the owner's approval (N-9, N-10). */
  readonly row?: string;
  /**
   * Every level's value applies, not the nearest alone: the value in force is each level's list, the
   * farther first (`stack.off`, `stack.layered`, `stack.instructions`, `stack.pins`, as the files layer reads them).
   */
  readonly joined?: true;
}

/** A group of settings whose values are numbers, none of which takes `~`, by the name its reader takes each under. */
export type NumberSettings<K extends string> = Readonly<Record<K, Setting & { readonly takes: { readonly type: "whole" | "number" } }>>;

/** A setting's row of Appendix D.1 and when it takes effect, for the keys RPH declares: RPH reads its settings at each turn and each job. */
const HARNESS_ROWS: Readonly<Record<string, string>> = Object.freeze({
  "limits.turn.calls": "Calls in a turn across all agents",
  "reply.form": "How a connection marks its reply",
  "reply.heldSentences": "Reply held back when a rule that interrupts covers it",
  "reply.tailSentences": "Sentences shown again to an agent that goes on after a rule stopped it",
  "reply.leadSampling": "The Author's sampling",
  "progress.silenceSeconds": "Thinking block in the chat",
  "rules.judge": "The model that answers a `question:` rule",
  "compaction.reserveTokens": "Compaction starts",
  "compaction.keepTurns": "Compaction starts",
  "compaction.recordsTokens": "Carried records before folding (records mode)",
  "calls.retries": "A model call that failed",
  "calls.silentAfterSeconds": "A model's answer that goes silent",
});

/** The keys of RPH's own list that a row above names. */
export const HARNESS_ROW_KEYS: readonly string[] = Object.keys(HARNESS_ROWS);

/**
 * RPH's settings as the registry lists them: RPH's list as RPH exports it, each with its default,
 * what it takes, its name and its line, and when a change to it is in force (a job's settings when
 * the next job starts, every other at the next turn, since RPH reads its settings as each begins).
 */
export function harnessSettings(list: readonly SettingDef[] = RPH_SETTINGS): Setting[] {
  return list.map((def) => {
    const row = HARNESS_ROWS[def.key];
    return { ...def, name: def.name ?? def.key, about: def.about ?? "", effect: def.key.startsWith("jobs.") ? "use" : "turn", ...(row !== undefined ? { row } : {}) };
  });
}

// ---------------------------------------------------------------- how the page shows it

/** The sections of the Settings page, in order, each with one line on what is in it. */
export const SECTIONS: readonly { readonly title: string; readonly about: string }[] = [
  { title: "Agents", about: "What each agent thinks at and may spend, its tools, and how its sessions are kept and compacted." },
  { title: "Turns and replies", about: "What a turn reads and tells the Author, how the reply is written and shown, and what is kept of a turn." },
  { title: "Connections and model calls", about: "Each connection's own values, how a model call is made, tried again and throttled." },
  { title: "Jobs", about: "Jobs and the bootstrap: how many run, and what they may spend." },
  { title: "Story and characters", about: "The story record, the characters' memories, places, quests and the world state the Author is given." },
  { title: "Lore and secrets", about: "How the lore is searched, indexed and given, and who knows what." },
  { title: "The world and play", about: "The world store, the engine's tools, maps, panels and things." },
  { title: "Build", about: "Build's jobs and the worlds it edits." },
  { title: "Files and storage", about: "The agents' files, which are in force, notes, suggestions and what is kept on disk." },
  { title: "Pages", about: "How these pages wait, read and show." },
  { title: "Lumiverse", about: "The door to Lumiverse: its sign-in, sockets, reads and relay." },
  { title: "Server and service", about: "The server, sign-in and tokens, the database, the command line, the service and updates." },
  { title: "Migration", about: "What the migration from the earlier build carries." },
  { title: "Other", about: "Settings no section names yet." },
];

/** The group of every setting of how a failed model call is made again. */
const RETRY_GROUP = "When a call to the model fails";

/** The group the page shows a key in, and that group's section, by the longest start of the key named here (its first part, or more of it); for a key set per agent, `agents.` and its part after the definition. */
const GROUPS: Readonly<Record<string, readonly [group: string, section: string]>> = {
  "agents.effort": ["Effort and limits, for each agent", "Agents"],
  "agents.limits": ["Effort and limits, for each agent", "Agents"],
  "agents.sampling": ["Sampling, for each agent", "Agents"],
  limits: ["Limits on a turn's work", "Agents"],
  compaction: ["Compaction", "Agents"],
  sessions: ["Sessions", "Agents"],
  tools: ["Tools", "Agents"],
  results: ["Tools", "Agents"],
  mcp: ["MCP servers", "Agents"],
  hooks: ["Hooks", "Agents"],
  rules: ["Rules", "Agents"],
  usage: ["Usage", "Agents"],
  turn: ["The turn", "Turns and replies"],
  history: ["The chat's history", "Turns and replies"],
  briefing: ["What the briefing tells of changes", "Turns and replies"],
  reply: ["The reply", "Turns and replies"],
  progress: ["The reply", "Turns and replies"],
  permissions: ["Write permissions", "Turns and replies"],
  trace: ["What is kept of a turn", "Turns and replies"],
  prompt: ["What is kept of a turn", "Turns and replies"],
  live: ["What you see while a turn runs", "Turns and replies"],
  turns: ["Lists of turns", "Turns and replies"],
  calls: ["Model calls", "Connections and model calls"],
  // What counts as a dead call, then how a failed one is made again: the page reads them in RPH's order, top to bottom.
  "calls.silentAfterSeconds": [RETRY_GROUP, "Connections and model calls"],
  "calls.unansweredAfterSeconds": [RETRY_GROUP, "Connections and model calls"],
  "calls.retries": [RETRY_GROUP, "Connections and model calls"],
  "calls.retryWaitSeconds": [RETRY_GROUP, "Connections and model calls"],
  "calls.retryWaitGrowth": [RETRY_GROUP, "Connections and model calls"],
  "calls.maxRetryWaitSeconds": [RETRY_GROUP, "Connections and model calls"],
  "calls.retryWaitAsAsked": [RETRY_GROUP, "Connections and model calls"],
  "calls.retryOn": [RETRY_GROUP, "Connections and model calls"],
  throttles: ["Calls at once", "Connections and model calls"],
  tokens: ["Counting tokens", "Connections and model calls"],
  embedding: ["Embeddings", "Connections and model calls"],
  web: ["Web search", "Connections and model calls"],
  jobs: ["Jobs", "Jobs"],
  bootstrap: ["Bootstrap", "Jobs"],
  story: ["The story record", "Story and characters"],
  cast: ["Characters and their memories", "Story and characters"],
  places: ["Places", "Story and characters"],
  quests: ["Quests", "Story and characters"],
  worldState: ["The world state in the briefing", "Story and characters"],
  lore: ["Lore", "Lore and secrets"],
  secrets: ["Secrets", "Lore and secrets"],
  store: ["The world store", "The world and play"],
  engine: ["The engine's tools", "The world and play"],
  map: ["Maps", "The world and play"],
  taps: ["Panels", "The world and play"],
  things: ["Things", "The world and play"],
  build: ["Build's jobs", "Build"],
  worlds: ["Worlds", "Build"],
  retention: ["Turn folders", "Files and storage"],
  files: ["The agents' files", "Files and storage"],
  notes: ["Notes", "Files and storage"],
  stack: ["The files in force", "Files and storage"],
  suggestions: ["Suggestions", "Files and storage"],
  storage: ["Storage", "Files and storage"],
  pages: ["The pages", "Pages"],
  lumiverse: ["The door to Lumiverse", "Lumiverse"],
  update: ["Updates", "Server and service"],
  server: ["The server", "Server and service"],
  auth: ["Sign-in and tokens", "Server and service"],
  liveSocket: ["The live socket", "Server and service"],
  database: ["The database", "Server and service"],
  commandLine: ["The command line", "Server and service"],
  service: ["The service", "Server and service"],
  switches: ["Switches", "Server and service"],
  workers: ["Worker threads", "Server and service"],
  backup: ["Backups", "Server and service"],
  migration: ["The migration", "Migration"],
};

/** The group every setting set per connection is shown in, one row for each connection. */
export const EACH_CONNECTION = "For each connection";

/** Every group's title, in the order the page shows the groups of a section: each connection's values first in theirs, then as `GROUPS` lists them. */
const GROUP_ORDER: readonly string[] = [...new Set([EACH_CONNECTION, ...Object.values(GROUPS).map(([group]) => group)])];

/**
 * The section and group a setting is shown in: one set per connection with every other, as one table; one set per agent by its part after
 * the definition; else by the longest start of its key `GROUPS` names. `order` puts the settings in the order of the page's sections and of
 * the groups within each, the registry's order kept within a group.
 */
export function groupOf(def: Pick<SettingDef, "key" | "perConnection">): { section: string; group: string; order: number } {
  const parts = def.key.split(".");
  const first = parts[1] === DEFINITION_PART ? `${parts[0]}.${parts[2]}` : (parts[0] ?? def.key);
  const starts = parts[1] === DEFINITION_PART ? [first] : parts.map((_, n) => parts.slice(0, parts.length - n).join("."));
  const found = starts.map((start) => GROUPS[start]).find((named) => named !== undefined);
  const [group, section] = def.perConnection ? [EACH_CONNECTION, "Connections and model calls"] : found === undefined ? [first, "Other"] : found;
  const groupAt = GROUP_ORDER.indexOf(group);
  return { section, group, order: SECTIONS.findIndex((s) => s.title === section) * (GROUP_ORDER.length + 1) + (groupAt < 0 ? GROUP_ORDER.length : groupAt) };
}

/** The units a number's key may end with (the key convention), and each as the page names it. */
const UNITS: readonly (readonly [suffix: string, unit: string])[] = [
  ["Ms", "ms"],
  ["Seconds", "seconds"],
  ["Minutes", "minutes"],
  ["Hours", "hours"],
  ["Days", "days"],
  ["Bytes", "bytes"],
  ["KiB", "KiB"],
  ["MiB", "MiB"],
  ["Chars", "characters"],
  ["Tokens", "tokens"],
  ["Words", "words"],
  ["Lines", "lines"],
  ["Feet", "feet"],
];

/** The unit a number setting is in, from the end of its key (`pages.probeMs`, `limits.turn.seconds`); null for a count, which its name says, and for anything not a number. */
export function unitOf(def: Pick<Declared, "key" | "takes">): string | null {
  const t = def.takes.type === "table" ? def.takes.of : def.takes;
  if (t.type !== "whole" && t.type !== "number") return null;
  const last = def.key.split(".").at(-1) ?? "";
  return UNITS.find(([suffix]) => last === suffix.toLowerCase() || (last.length > suffix.length && last.endsWith(suffix)))?.[1] ?? null;
}

// ---------------------------------------------------------------- keys and paths

/** A setting's key with a connection's or a definition's name in place of `<connection>` or `<definition>`; the key itself where it names neither, or no name is given. */
export function keyFor(def: Declared, name?: string): string {
  return pathOf(def, name).join(".");
}

/** A setting's key as the path of mappings a config file holds it at. A connection's or a definition's name stays whole, dots and all. */
export function pathOf(def: Declared, name?: string): string[] {
  const named = setFor(def) !== null && name !== undefined;
  return def.key.split(".").map((part) => (named && isNamedPart(part) ? name : part));
}

/** The keys before and after the part that names a connection or a definition, in the key of a setting set for one at a time. */
function aroundName(def: Declared): { before: string[]; after: string[] } {
  const parts = def.key.split(".");
  const at = parts.findIndex(isNamedPart);
  return { before: parts.slice(0, at), after: parts.slice(at + 1) };
}

/** The setting a key as a file writes it names, and the connection or definition it names; null for a key no setting of `defs` has. */
export function settingOfKey<D extends Declared>(defs: readonly D[], key: string): { def: D; name?: string } | null {
  for (const def of defs) {
    if (setFor(def) === null) {
      if (def.key === key) return { def };
      continue;
    }
    const { before, after } = aroundName(def);
    const head = before.length === 0 ? "" : `${before.join(".")}.`;
    const tail = after.length === 0 ? "" : `.${after.join(".")}`;
    if (key.length > head.length + tail.length && key.startsWith(head) && key.endsWith(tail)) return { def, name: key.slice(head.length, key.length - tail.length) };
  }
  return null;
}

/** The connections or definitions a config sets a setting for, by the names (or a connection's ids) it writes. */
export function namesSet(config: Mapping, def: Declared): string[] {
  let at: JsonValue | undefined = config;
  for (const part of aroundName(def).before) at = isMapping(at) ? at[part] : undefined;
  return isMapping(at) ? Object.keys(at).filter((name) => decidesAt(config, pathOf(def, name))) : [];
}

/** What a config holds at `path`: undefined where nothing is set. With `short`, a value that is no mapping just above the last key is that key's. */
export function valueAt(config: Mapping, path: readonly string[], short = false): JsonValue | undefined {
  let at: JsonValue = config;
  for (const [i, part] of path.entries()) {
    if (!isMapping(at)) return short && i === path.length - 1 ? at : undefined;
    const next: JsonValue | undefined = at[part];
    if (next === undefined) return undefined;
    at = next;
  }
  return at;
}

/** Whether a level's config decides what is at `path`: it sets it, or sets a value that is no mapping above it, which leaves the farther levels' out. */
export function decidesAt(config: Mapping, path: readonly string[]): boolean {
  let at: JsonValue = config;
  for (const part of path) {
    if (!isMapping(at)) return true;
    const next: JsonValue | undefined = at[part];
    if (next === undefined) return false;
    at = next;
  }
  return true;
}

// ---------------------------------------------------------------- values

/** One of RPH's shapes, in a page's words. */
function shapeWords(t: SettingTakes): string {
  return t.type === "whole"
    ? t.most === undefined
      ? `a whole number, at least ${t.least}`
      : `a whole number from ${t.least} to ${t.most}`
    : t.type === "number"
      ? t.least === undefined
        ? t.most === undefined
          ? "a number"
          : `a number, at most ${t.most}`
        : t.most === undefined
          ? `a number, at least ${t.least}`
          : `a number from ${t.least} to ${t.most}`
      : t.type === "oneOf"
        ? `one of ${t.values.join(", ")}`
        : t.type === "yesNo"
          ? "true or false"
          : t.type === "text"
            ? "a line of text"
            : "a list of names";
}

/** What a setting takes, in a page's words: "a whole number, at least 1, or ~ for no limit". */
export function takesWords(def: Declared): string {
  const t = def.takes;
  const what =
    t.type === "table"
      ? `a table of names, each to ${shapeWords(t.of)}${t.whole === true ? `, or ${shapeWords(t.of)} for every name` : ""}`
      : t.type === "records"
        ? `a list of records, each with ${t.fields.map((f) => `${f.name} (${shapeWords(f.takes)})`).join(" and ")}`
        : shapeWords(t);
  return def.orNone === true ? `${what}, or ~ for ${def.none ?? "none"}` : what;
}

/** A value as a reason names it. */
function words(value: JsonValue): string {
  return typeof value === "number" && !Number.isFinite(value) ? String(value) : JSON.stringify(value);
}

type Taken = { ok: true; value: JsonValue } | { ok: false; why: string };

/** A value checked by RPH's one check against a setting of one of RPH's shapes, named `key`; a list read with its names alone unless it is being written. */
function takenShape(def: Omit<SettingDef, "key" | "perConnection">, key: string, value: JsonValue, writing: boolean): Taken {
  const check = checkSettingValue({ ...def, key, perConnection: false }, value);
  if (check.ok) return { ok: true, value: check.value };
  return check.kept !== undefined && !writing ? { ok: true, value: check.kept } : { ok: false, why: check.why };
}

/**
 * A value a setting takes, as its reader uses it; or the reason, in RPE's words, that it takes no
 * such value. `writing`: a value about to be written, where a list must hold names alone and every
 * record every field; as read, what does not fit of a list is passed over and the rest read.
 */
export function takenValue(def: Declared, value: JsonValue, key: string = def.key, writing = false): Taken {
  const no: Taken = { ok: false, why: `${key} takes ${takesWords(def)}, not ${words(value)}.` };
  if (value === null) return def.orNone === true ? { ok: true, value: null } : no;
  const t = def.takes;
  if (t.type === "table") {
    if (t.whole === true && !isMapping(value)) return takenShape({ takes: t.of, default: null }, key, value, writing);
    if (!isMapping(value)) return no;
    const out: Mapping = {};
    for (const [name, item] of Object.entries(value)) {
      const taken = takenShape({ takes: t.of, default: null }, `${key}.${name}`, item, writing);
      if (taken.ok) out[name] = taken.value;
      else if (writing) return taken;
    }
    return { ok: true, value: out };
  }
  if (t.type === "records") {
    if (!Array.isArray(value)) return no;
    const out: Mapping[] = [];
    for (const [i, item] of value.entries()) {
      const record: Mapping = {};
      let fits = isMapping(item);
      for (const field of t.fields) {
        if (!fits || !isMapping(item)) break;
        const got = item[field.name];
        const taken = got === undefined ? null : takenShape({ takes: field.takes, default: null }, `${key}[${i + 1}].${field.name}`, got, true);
        if (taken === null || !taken.ok) fits = false;
        else record[field.name] = taken.value;
      }
      if (fits) out.push(record);
      else if (writing) return { ok: false, why: `${key}[${i + 1}] is a record with ${t.fields.map((f) => `${f.name} (${shapeWords(f.takes)})`).join(" and ")}, not ${words(item)}.` };
    }
    return { ok: true, value: out };
  }
  return takenShape({ ...def, takes: t }, key, value, writing);
}

/** A setting's value in a config: the value set, where it is one the setting takes; else its default, and what was set and why it was passed over. */
export interface SettingRead {
  value: JsonValue;
  /** What a level set that the setting does not take, and why; null where nothing was passed over. */
  passed: { value: JsonValue; why: string } | null;
}

export function settingIn(config: Mapping, def: Declared, connection?: string): SettingRead {
  const set = valueAt(config, pathOf(def, connection), def.short === true);
  if (set === undefined) return { value: def.default, passed: null };
  const taken = takenValue(def, set, keyFor(def, connection));
  return taken.ok ? { value: taken.value, passed: null } : { value: def.default, passed: { value: set, why: taken.why } };
}

/**
 * Each setting of a group as a config sets it, by the name the group gives it: the value set where
 * the setting takes it, else its default. `passed` hears of each value passed over, with its key and
 * why, so the reader can say so where it logs.
 */
export function numbersIn<K extends string>(config: Mapping, group: NumberSettings<K>, passed?: (key: string, value: JsonValue, why: string) => void): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const name of Object.keys(group) as K[]) {
    const def = group[name];
    const read = settingIn(config, def);
    if (read.passed !== null) passed?.(def.key, read.passed.value, read.passed.why);
    // A value the setting takes is a number, since it takes no `~`; a default is one too.
    out[name] = read.value as number;
  }
  return out;
}
