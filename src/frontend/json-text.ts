// JSON text as an editor needs it: the value, the line each value starts on (so a problem at a
// JSON path can be shown on its line), and for text that isn't JSON, where it goes wrong. Reads
// what `JSON.parse` reads; its error messages differ from browser to browser and some give no
// position, so this one says where.

import type { JsonValue } from "../shared/json";
import type { JsonPath } from "../shared/schema-check";

export type JsonText = { ok: true; value: JsonValue; lines: Map<string, number> } | { ok: false; message: string; line: number; column: number };

/** The key `lines` uses for a path. */
export function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

/** The line a path's value starts on, or the nearest enclosing value's (a missing field shows on its object). */
export function lineAt(lines: ReadonlyMap<string, number>, path: JsonPath): number {
  for (let n = path.length; n >= 0; n--) {
    const line = lines.get(pathKey(path.slice(0, n)));
    if (line !== undefined) return line;
  }
  return 1;
}

class Stop {
  constructor(
    readonly message: string,
    readonly at: number,
  ) {}
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseJsonText(text: string): JsonText {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineOf = (at: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const lines = new Map<string, number>();
  let i = 0;
  const space = (): void => {
    while (i < text.length && (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t")) i++;
  };
  const str = (): string => {
    const start = i;
    i++;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") i++;
      else if (c === '"') break;
      else if (c === "\n") throw new Stop("this text needs a closing quote before the line ends", start);
    }
    if (i >= text.length) throw new Stop("this text needs a closing quote", start);
    i++;
    try {
      return JSON.parse(text.slice(start, i)) as string;
    } catch {
      throw new Stop("this text has a bad escape (a \\ followed by something JSON doesn't know)", start);
    }
  };
  const value = (path: JsonPath): JsonValue => {
    space();
    if (!lines.has(pathKey(path))) lines.set(pathKey(path), lineOf(i));
    const c = text[i];
    if (c === "{") {
      i++;
      const entries: [string, JsonValue][] = [];
      space();
      if (text[i] === "}") {
        i++;
        return {};
      }
      for (;;) {
        space();
        if (text[i] !== '"') throw new Stop(text[i] === "}" ? "a comma before } has nothing after it" : "expected a key in double quotes", i);
        const keyAt = i;
        const key = str();
        lines.set(pathKey([...path, key]), lineOf(keyAt));
        space();
        if (text[i] !== ":") throw new Stop(`expected : after "${key}"`, i);
        i++;
        entries.push([key, value([...path, key])]);
        space();
        if (text[i] === ",") i++;
        else if (text[i] === "}") {
          i++;
          // Own properties only, whatever the keys ("__proto__" included).
          return Object.fromEntries(entries);
        } else throw new Stop("expected , or } after a value", i);
      }
    }
    if (c === "[") {
      i++;
      const items: JsonValue[] = [];
      space();
      if (text[i] === "]") {
        i++;
        return items;
      }
      for (;;) {
        space();
        if (text[i] === "]") throw new Stop("a comma before ] has nothing after it", i);
        items.push(value([...path, items.length]));
        space();
        if (text[i] === ",") i++;
        else if (text[i] === "]") {
          i++;
          return items;
        } else throw new Stop("expected , or ] after a value", i);
      }
    }
    if (c === '"') return str();
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    throw new Stop(c === undefined ? "the text ends before the value does" : c === "'" ? "use double quotes" : `unexpected ${JSON.stringify(c)}`, i);
  };
  try {
    const parsed = value([]);
    space();
    if (i < text.length) throw new Stop("there's more after the end of the value", i);
    return { ok: true, value: parsed, lines };
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    const line = lineOf(error.at);
    return { ok: false, message: error.message, line, column: error.at - (starts[line - 1] ?? 0) + 1 };
  }
}
