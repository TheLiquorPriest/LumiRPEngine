// A setting as the code that reads it declares it (plan §5.4 "Config", §14, Appendix D.1): its key as
// a config file writes it, its default, what it takes, and whether it is set per connection. A reader
// takes each of its values through its list, and the Settings routes show and write every setting
// from the same lists, so a setting added to a list is read, shown and written with nothing else
// changed.
//
// The config files of a chat's levels (`RPE-global.yml` as shipped and the user's own, the chat's
// `RPE.yml`) are read farthest first and merged mapping by mapping, the nearer level's value over the
// farther one's. A value a setting does not take is passed over, and its default holds.

import type { JsonValue, LayerLevel } from "rp-harness/contract";

/** Where a per-connection setting's key names the connection, by its name or its id. */
export const CONNECTION_PART = "<connection>";

/** What a level may set a setting to. */
export type SettingTakes =
  /** A whole number, at least `least`, and at most `most` where it has one. */
  | { type: "whole"; least: number; most?: number }
  /** A number, at least `least`, and at most `most` where it has one. */
  | { type: "number"; least: number; most?: number }
  | { type: "oneOf"; values: readonly string[] }
  | { type: "yesNo" }
  /** A line of text that is not blank, read without the space at its ends. */
  | { type: "text" }
  /** A list of names; as read, an item that is no text is passed over, and written, refused. */
  | { type: "texts" };

export interface SettingDef {
  /** The key as a config file writes it, dotted; `<connection>` where a per-connection setting names its connection. */
  readonly key: string;
  /** What holds where no level sets it: null for nothing, whose meaning `none` gives. */
  readonly default: JsonValue;
  readonly takes: SettingTakes;
  /** What no value means, in a page's words, where the default is null or `~` may be set. */
  readonly none?: string;
  /** A level may set `~` (null), which means what `none` says: a limit lifted, a window that keeps every message. */
  readonly orNone?: true;
  /** Set for one connection at a time, named by its name or its id where the key has `<connection>`. */
  readonly perConnection: boolean;
  /** The key above it may hold this value in place of a mapping (`hold: true` for `hold: { on: true }`), the mapping's other keys then at their defaults. */
  readonly short?: true;
  /** The levels it is read from; absent, every level that has a config file. */
  readonly levels?: readonly LayerLevel[];
}

export type Mapping = { [key: string]: JsonValue };

export function isMapping(value: unknown): value is Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Two configs as one: the nearer one's values over the farther one's, mapping by mapping. */
export function mergedConfig(far: Mapping, near: Mapping): Mapping {
  const out: Mapping = { ...far };
  for (const [key, value] of Object.entries(near)) {
    const before = out[key];
    out[key] = isMapping(before) && isMapping(value) ? mergedConfig(before, value) : value;
  }
  return out;
}

/** A setting's key with a connection's name or id in place of `<connection>`; the key itself for one that is not per connection. */
export function keyFor(def: SettingDef, connection?: string): string {
  return def.perConnection && connection !== undefined ? def.key.replace(CONNECTION_PART, connection) : def.key;
}

/** A setting's key as the path of mappings a config file holds it at. A connection's name stays whole, dots and all. */
export function pathOf(def: SettingDef, connection?: string): string[] {
  return def.key.split(".").map((part) => (part === CONNECTION_PART && connection !== undefined ? connection : part));
}

/** The keys before and after `<connection>` in a per-connection setting's key. */
function aroundConnection(def: SettingDef): { before: string[]; after: string[] } {
  const parts = def.key.split(".");
  const at = parts.indexOf(CONNECTION_PART);
  return { before: parts.slice(0, at), after: parts.slice(at + 1) };
}

/** The setting a key as a file writes it names, and the connection it names; null for a key no setting of `defs` has. */
export function settingOfKey(defs: readonly SettingDef[], key: string): { def: SettingDef; connection?: string } | null {
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
export function connectionsNamed(config: Mapping, def: SettingDef): string[] {
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

/** What a setting takes, in a page's words: "a whole number, at least 1, or ~ for no limit". */
export function takesWords(def: SettingDef): string {
  const t = def.takes;
  const what =
    t.type === "whole"
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
  return def.orNone === true ? `${what}, or ~ for ${def.none ?? "none"}` : what;
}

/**
 * A value a setting takes, as its reader uses it; or the reason, in RPE's words, that it takes no
 * such value. `writing`: a value about to be written, where a list must hold names alone.
 */
export function takenValue(def: SettingDef, value: JsonValue, key: string = def.key, writing = false): { ok: true; value: JsonValue } | { ok: false; why: string } {
  const no = { ok: false as const, why: `${key} takes ${takesWords(def)}, not ${JSON.stringify(value)}.` };
  if (value === null) return def.orNone === true ? { ok: true, value: null } : no;
  const t = def.takes;
  switch (t.type) {
    case "whole":
      return typeof value === "number" && Number.isInteger(value) && value >= t.least && (t.most === undefined || value <= t.most) ? { ok: true, value } : no;
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= t.least && (t.most === undefined || value <= t.most) ? { ok: true, value } : no;
    case "oneOf":
      return typeof value === "string" && t.values.includes(value) ? { ok: true, value } : no;
    case "yesNo":
      return typeof value === "boolean" ? { ok: true, value } : no;
    case "text":
      return typeof value === "string" && value.trim() !== "" ? { ok: true, value: value.trim() } : no;
    case "texts": {
      if (!Array.isArray(value)) return no;
      const names = value.filter((item): item is string => typeof item === "string");
      return writing && (names.length !== value.length || names.some((name) => name.trim() === "")) ? no : { ok: true, value: names };
    }
  }
}

/** A setting's value in a config: the value set, where it is one the setting takes; else its default, and what was set and why it was passed over. */
export interface SettingRead {
  value: JsonValue;
  /** What a level set that the setting does not take, and why; null where nothing was passed over. */
  passed: { value: JsonValue; why: string } | null;
}

export function settingIn(config: Mapping, def: SettingDef, connection?: string): SettingRead {
  const set = valueAt(config, pathOf(def, connection), def.short === true);
  if (set === undefined) return { value: def.default, passed: null };
  const taken = takenValue(def, set, keyFor(def, connection));
  return taken.ok ? { value: taken.value, passed: null } : { value: def.default, passed: { value: set, why: taken.why } };
}

/** A group of settings whose values are numbers, none of which takes `~`, by the name its reader takes each under. */
export type NumberSettings<K extends string> = Readonly<Record<K, SettingDef & { readonly takes: { readonly type: "whole" | "number" } }>>;

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
