// How the door's searches read words: a text's words are runs of letters and digits in lower case, and a text is found when every word
// asked for begins one of its words, in any letter case (a chat's messages, Lumiverse's memory).

/** A text's words as the search reads them: runs of letters and digits, in lower case, each with where it starts. */
export function wordsOf(text: string): { word: string; at: number }[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ word: m[0].toLowerCase(), at: m.index }));
}

/** Where the first word of the text that a wanted word begins sits; null unless every wanted word begins one of its words. */
export function matchAt(text: string, wanted: readonly string[]): number | null {
  const words = wordsOf(text);
  let first: number | null = null;
  for (const w of wanted) {
    const found = words.find((x) => x.word.startsWith(w));
    if (found === undefined) return null;
    first = first === null ? found.at : Math.min(first, found.at);
  }
  return first;
}

/** About `chars` characters of the text around `at`, on one line, with "…" where it was cut. */
export function snippetOf(text: string, at: number, chars: number): string {
  const start = Math.max(0, Math.min(at - Math.floor(chars / 4), text.length - chars));
  const end = Math.min(text.length, start + chars);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}
