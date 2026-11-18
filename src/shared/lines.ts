// The words of the lines the chat's history and the narrator's notices are made of (an event's line, a bill, a payday, a fight's
// start), which come from shipped files (`guidance/.prompts/history-*.md`, one per family of lines, each `format: lines`, one `name: text`
// template per line), never from code: code gives the values a line is filled with and the name of the line. The engine is pure, so the
// files are read where the application lays out its texts and handed in here as a source of lines (`useLines`); a caller that has the
// chat's own copy of the files (each the one nearer the chat than the shipped one) wraps its work in `withLines`, so the lines it words
// are the chat's. A line the files do not have, or the user deleted, is a line that is not said: `say` gives the empty text and the callers
// say nothing in its place. A thread that was given no lines at all is another matter: it has no words, not a line the user switched off,
// so `say` there throws, naming the line it was asked for (a page, which has no lines and says its own words, is the one place that stays silent).

import type { JsonValue } from "./json";
import type { ParamDef } from "./world";

/** What a line is filled from: values only, and a field given as undefined is absent. */
export type LineFields = { readonly [name: string]: JsonValue | undefined };

/** A `format: lines` part as the application's guidance reader gives it. */
export interface LineSource {
  /** One line filled in; undefined when the file holds no line of that name. */
  line(name: string, fields?: LineFields): string | undefined;
}

/** The source the application's lines come from: undefined until a thread is given one (`useLines`), null when none is in force (every part switched off). */
let installed: LineSource | null | undefined;
/** The chat's own source while `withLines` runs (null there: the chat's copy is off, and nothing is said); undefined outside it. */
let current: LineSource | null | undefined;

/** The source the application's lines come from, until another is given (null: none in force, and nothing is said). */
export function useLines(source: LineSource | null): void {
  installed = source;
  current = undefined;
}

/** Runs `work` (synchronously) with `source` as the lines' source, as the chat's own copy of the file reads; the one in use comes back after. */
export function withLines<T>(source: LineSource | null, work: () => T): T {
  const before = current;
  current = source;
  try {
    return work();
  } finally {
    current = before;
  }
}

/** What says a line: `say` says the lines in force; a page, which has no lines, says its own. */
export type Voice = (name: string, fields?: LineFields) => string;

/**
 * The line `name` filled with `fields`; the empty text where the lines in force have none (a line the user deleted says nothing). Where no lines
 * were ever given to this thread it throws, naming the line: a thread with no words must not pass for one whose user switched them off. A page
 * (a browser) has no lines and says its own words, so there the empty text stays.
 */
export function say(name: string, fields?: LineFields): string {
  const source = current === undefined ? installed : current;
  if (source === undefined) return unloaded(name);
  return source?.line(name, fields) ?? "";
}

/** What a process that is built without lines throws, in its own words, where `say` finds none (`withoutLines`); null: the default. */
let missing: ((name: string) => Error) | null = null;

/**
 * For a process that ships no lines on purpose (the outside command line, which is not in this build): what `say` throws there is this error, in that
 * process's own words, instead of the default, which names the line for a developer. It still throws: such a process must not say empty words.
 */
export function withoutLines(error: (name: string) => Error): void {
  missing = error;
}

function unloaded(name: string): string {
  if (typeof document !== "undefined") return "";
  throw missing?.(name) ?? new Error(`RPE has no words loaded on this thread, so it cannot say the line "${name}": the lines of guidance/.prompts/history-*.md were never given to it.`);
}

/** Words joined as a list is read ("a", "a and b", "a, b and c"): the one connecting word is the line `list_and`'s, the commas are the code's. */
export function listOf(words: readonly string[]): string {
  const last = words[words.length - 1] ?? "";
  return words.length <= 1 ? last : say("list_and", { head: words.slice(0, -1).join(", "), last });
}

/** Words joined as a choice is read ("a", "a or b", "a, b or c"): the connecting word is the line `list_or`'s. */
export function orOf(words: readonly string[]): string {
  const last = words[words.length - 1] ?? "";
  return words.length <= 1 ? last : say("list_or", { head: words.slice(0, -1).join(", "), last });
}

/** A param (of an action) whose label is the line `line`'s, read each time it is asked for; no line, or an empty one, is no label. */
export function wordedParam<T extends ParamDef>(def: T, line: string): T {
  Object.defineProperty(def, "label", { enumerable: true, configurable: true, get: () => say(line) || undefined });
  return def;
}

/** The line `word_<table>_<key>`: the word a table of words (one line a key) gives for `key`, whose characters outside letters, digits, `_` and `-` read as `_`. */
export function wordOf(table: string, key: string): string {
  return say(`word_${table}_${key.replace(/[^A-Za-z0-9_-]/g, "_")}`);
}

/** A record over `keys` whose every value is the line `word_<table>_<key>`'s, read each time it is asked for (so it is the lines in force then). */
export function wordTable<K extends string>(table: string, keys: readonly K[]): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const key of keys) Object.defineProperty(out, key, { enumerable: true, get: () => wordOf(table, key) });
  return out;
}
