// The settings registry (plan §5.4 "Config", §14, Appendix D.1): every value RPE and RPH read is a
// setting, declared once by the area that reads it, in that area's own list: its key as a config file
// writes it, its default, what it takes, the levels it is read from, whether it is set per connection,
// when a change to it takes effect, what the Settings page calls it, one line on what it does, and its
// row of Appendix D.1 where it has one. The app gathers every area's list into one registry
// (`App.settings`); the readers read each value through it (`config-read.ts`), and the Settings routes
// show and write every setting from it, so a setting added to a list is read, shown and written with
// nothing else changed.
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

export type { SettingDef, SettingTakes } from "rp-harness/contract";
export { mergedConfig } from "rp-harness/helpers";

/** Where a per-connection setting's key names the connection, by its name or its id. */
export const CONNECTION_PART = "<connection>";

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
 * taken too, for every name at once (`instructions: [STYLE]`). `records`: a list of records, each a
 * mapping holding every field, shown as a table and written whole (`pins:`).
 */
export type RpeTakes = { readonly type: "table"; readonly of: SettingTakes; readonly whole?: true } | { readonly type: "records"; readonly fields: readonly RecordField[] };

/** What a level may set a setting to: one of RPH's shapes, or one of RPE's own. */
export type Takes = SettingTakes | RpeTakes;

/** When a change to a setting is in force: at its next use, from the next turn (or job), or from RPE's next start. */
export type Effect = "use" | "turn" | "start";

/** Each moment as the Settings page and the docs word it. */
export const EFFECT_WORDS: Readonly<Record<Effect, string>> = Object.freeze({ use: "at its next use", turn: "from the next turn", start: "from RPE's next start" });

/** A setting as any list declares it, RPH's or RPE's: what the readers and the checks need. */
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
   * farther first (`off:`, `layered:`, `instructions:`, `pins:`, as the files layer reads them).
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
  "progress.silence": "Thinking block in the chat",
  "rules.judge": "The model that answers a `question:` rule",
  "compaction.reserve": "Compaction starts",
  "compaction.keepTurns": "Compaction starts",
  "compaction.records": "Carried records before folding (records mode)",
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

// ---------------------------------------------------------------- keys and paths

/** A setting's key with a connection's name or id in place of `<connection>`; the key itself for one that is not per connection. */
export function keyFor(def: Declared, connection?: string): string {
  return def.perConnection && connection !== undefined ? def.key.replace(CONNECTION_PART, connection) : def.key;
}

/** A setting's key as the path of mappings a config file holds it at. A connection's name stays whole, dots and all. */
export function pathOf(def: Declared, connection?: string): string[] {
  return def.key.split(".").map((part) => (part === CONNECTION_PART && connection !== undefined ? connection : part));
}

/** The keys before and after `<connection>` in a per-connection setting's key. */
function aroundConnection(def: Declared): { before: string[]; after: string[] } {
  const parts = def.key.split(".");
  const at = parts.indexOf(CONNECTION_PART);
  return { before: parts.slice(0, at), after: parts.slice(at + 1) };
}

/** The setting a key as a file writes it names, and the connection it names; null for a key no setting of `defs` has. */
export function settingOfKey<D extends Declared>(defs: readonly D[], key: string): { def: D; connection?: string } | null {
  for (const def of defs) {
    if (!def.perConnection) {
      if (def.key === key) return { def };
      continue;
    }
    const { before, after } = aroundConnection(def);
    const head = before.length === 0 ? "" : `${before.join(".")}.`;
    const tail = after.length === 0 ? "" : `.${after.join(".")}`;
    if (key.length > head.length + tail.length && key.startsWith(head) && key.endsWith(tail)) return { def, connection: key.slice(head.length, key.length - tail.length) };
  }
  return null;
}

/** The connections a config names for a per-connection setting, by the names or ids it writes. */
export function connectionsNamed(config: Mapping, def: Declared): string[] {
  let at: JsonValue | undefined = config;
  for (const part of aroundConnection(def).before) at = isMapping(at) ? at[part] : undefined;
  return isMapping(at) ? Object.keys(at) : [];
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
      ? t.most === undefined
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
