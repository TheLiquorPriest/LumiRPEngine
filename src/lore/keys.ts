// Keys matched in a chat's messages as Lumiverse matches a book entry's plain keys (plan §9.2), so a
// world entry comes up in the lore map exactly when a book entry with the same keys would activate.
// Carried from Lumiverse's matcher (`src/services/world-info-matcher.service.ts` at a70f4ed2): a key
// is found anywhere in one message's text, case folded code point by code point unless matching is
// case sensitive; with whole words, the match must start and end at a word's edge, where a word is
// made of ASCII letters, digits and `_`, judged on the text as written. An empty key never matches,
// and a key is never trimmed.

/** How keys are matched for every entry: the user's World Info settings `forceCaseSensitive` and `forceMatchWholeWords`. */
export interface KeyMatching {
  caseSensitive: boolean;
  wholeWords: boolean;
}

/** Lumiverse's own defaults for those settings (`world-info-activation.service.ts:51-59`). */
export const LUMIVERSE_KEY_MATCHING: Readonly<KeyMatching> = Object.freeze({ caseSensitive: false, wholeWords: false });

/** Lumiverse's `isWordChar`. */
function isWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** Lumiverse's `verifyWordBoundary`: `first` and `last` are the places of the match's first and last characters in `text`. */
function atWordEdges(text: string, first: number, last: number): boolean {
  const before = first > 0 && isWordChar(text.charCodeAt(first - 1));
  const after = last + 1 < text.length && isWordChar(text.charCodeAt(last + 1));
  return isWordChar(text.charCodeAt(first)) !== before && isWordChar(text.charCodeAt(last)) !== after;
}

/**
 * Lumiverse's `foldWithOriginalOffsets`: the text lower-cased one code point at a time, with where each folded character came from
 * (null where each comes from its own place).
 */
interface Folded {
  text: string;
  start: number[] | null;
  end: number[] | null;
}

/**
 * Lumiverse's `foldWithOriginalOffsets`. Where no character's lower case is longer than it, none is half of a pair and none is a capital
 * sigma (the one whose lower case depends on what stands beside it), the text lower-cased whole is the same, each character in its place.
 */
function fold(value: string): Folded {
  const whole = value.toLowerCase();
  if (whole.length === value.length && !/[\uD800-\uDFFF\u03A3]/.test(value)) return { text: whole, start: null, end: null };
  let text = "";
  const start: number[] = [];
  const end: number[] = [];
  for (let at = 0; at < value.length; ) {
    const width = (value.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
    const lower = value.slice(at, at + width).toLowerCase();
    text += lower;
    for (let i = 0; i < lower.length; i++) {
      start.push(at);
      end.push(at + width);
    }
    at += width;
  }
  return { text, start, end };
}

/** What separates two messages in the text keys are looked for in: no key holds it, and it is no word character, so no match crosses it and every message's edges read as they do alone. */
const BETWEEN = "\u0000";

/**
 * Which keys come up in `messages`, each message's text as Lumiverse scans it: the messages are
 * folded once, and each key asked about is looked for in all of them.
 */
export function keysIn(messages: readonly string[], how: KeyMatching): (key: string) => boolean {
  const raw = messages.join(BETWEEN);
  const folded = how.caseSensitive ? null : fold(raw);
  return (key) => {
    if (key === "" || key.includes(BETWEEN)) return false;
    const needle = folded === null ? key : fold(key).text;
    const hay = folded === null ? raw : folded.text;
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      if (!how.wholeWords) return true;
      const first = folded === null ? at : (folded.start?.[at] ?? at);
      const last = folded === null ? at + needle.length - 1 : (folded.end?.[at + needle.length - 1] ?? at + needle.length) - 1;
      if (atWordEdges(raw, first, last)) return true;
    }
    return false;
  };
}

/**
 * Which of `keys` come up in one message's text, as Lumiverse's matcher goes (a match never crosses from one message to another): the
 * needles are made once, in one trie whose failure links let one pass over a text find them all, and each text is folded and gone over
 * once, however many keys there are. A key is found where `keysIn` finds it; each found is given once.
 */
export function keyMatcher(how: KeyMatching, keys: Iterable<string>): (text: string) => string[] {
  // The needles, each with the keys that read as it.
  const needles = new Map<string, string[]>();
  for (const key of keys) {
    if (key === "" || key.includes(BETWEEN)) continue;
    const needle = how.caseSensitive ? key : fold(key).text;
    const same = needles.get(needle);
    if (same === undefined) needles.set(needle, [key]);
    else if (!same.includes(key)) same.push(key);
  }
  if (needles.size === 0) return () => [];
  const next: Map<number, number>[] = [new Map()];
  const ends: string[][] = [[]];
  for (const needle of needles.keys()) {
    let node = 0;
    for (let i = 0; i < needle.length; i++) {
      const code = needle.charCodeAt(i);
      let to = next[node]?.get(code);
      if (to === undefined) {
        to = next.length;
        next.push(new Map());
        ends.push([]);
        next[node]?.set(code, to);
      }
      node = to;
    }
    ends[node]?.push(needle);
  }
  const fail: number[] = new Array<number>(next.length).fill(0);
  const queue: number[] = [...(next[0]?.values() ?? [])];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] ?? 0;
    for (const [code, child] of next[node] ?? []) {
      let back = fail[node] ?? 0;
      while (back !== 0 && next[back]?.get(code) === undefined) back = fail[back] ?? 0;
      const to = next[back]?.get(code);
      fail[child] = to !== undefined && to !== child ? to : 0;
      ends[child]?.push(...(ends[fail[child] ?? 0] ?? []));
      queue.push(child);
    }
  }
  return (raw) => {
    const found: string[] = [];
    const folded = how.caseSensitive ? null : fold(raw);
    const hay = folded === null ? raw : folded.text;
    const done = new Set<string>();
    let node = 0;
    for (let at = 0; at < hay.length; at++) {
      const code = hay.charCodeAt(at);
      while (node !== 0 && next[node]?.get(code) === undefined) node = fail[node] ?? 0;
      node = next[node]?.get(code) ?? 0;
      for (const needle of ends[node] ?? []) {
        if (done.has(needle)) continue;
        if (how.wholeWords) {
          const from = at - needle.length + 1;
          const first = folded === null ? from : (folded.start?.[from] ?? from);
          const last = folded === null ? at : (folded.end?.[at] ?? at + 1) - 1;
          if (!atWordEdges(raw, first, last)) continue;
        }
        done.add(needle);
        found.push(...(needles.get(needle) ?? []));
      }
    }
    return found;
  };
}

/**
 * A name as the lore matches names it does not read as keys (a binding's record, an overlay's entry
 * given by its title): case folded, runs of white space made one space, trimmed.
 */
export function foldName(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
