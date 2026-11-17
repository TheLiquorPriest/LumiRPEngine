// The words of the lines the chat's history and the narrator's notices are made of (an event's line, a bill, a payday, a fight's
// start), which come from a shipped file (`guidance/.prompts/history-lines.md`, `format: lines`, one `name: text` template per
// line), never from code: code gives the values a line is filled with and the name of the line. The engine is pure, so the file is
// read where the application lays out its texts and handed in here as a source of lines (`useLines`); a caller that has the chat's
// own copy of the file (the one nearer the chat than the shipped one) wraps its work in `withLines`, so the lines it words are the
// chat's. A line the file does not have, or the user deleted, is a line that is not said: `say` gives the empty text and the callers
// say nothing in its place.

import type { JsonValue } from "../shared/json";

/** What a line is filled from: values only, and a field given as undefined is absent. */
export type LineFields = { readonly [name: string]: JsonValue | undefined };

/** A `format: lines` part as the application's guidance reader gives it. */
export interface LineSource {
  /** One line filled in; undefined when the file holds no line of that name. */
  line(name: string, fields?: LineFields): string | undefined;
}

let installed: LineSource | null = null;
/** The chat's own source while `withLines` runs (null there: the chat's copy is off, and nothing is said); undefined outside it. */
let current: LineSource | null | undefined;

/** The source the application's lines come from, until another is given (null: none, and nothing is said). */
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

/** The line `name` filled with `fields`; the empty text where there is none. */
export function say(name: string, fields?: LineFields): string {
  return (current === undefined ? installed : current)?.line(name, fields) ?? "";
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
