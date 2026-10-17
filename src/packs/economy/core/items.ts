// What a purchase names (DESIGN §9.5): an item's words as purchases compare them. Pure string work,
// shared by catalog pricing (`matchCatalog`) and the read that tells a narrated purchase from the
// turn's own Buy (`boughtAlong` in the backend).

/** Words that don't name the thing bought: articles and possessives, and the containers and measures it comes in ("a box of matches" is matches, "a round of beers" is beer). */
const FILLER: Readonly<Record<string, true>> = {
  a: true, an: true, the: true, of: true, some: true, my: true, your: true, his: true, her: true, their: true, our: true, this: true, that: true, these: true, those: true,
  and: true, or: true, for: true, to: true, from: true, at: true, with: true, in: true, on: true, by: true, per: true, as: true,
  round: true, pack: true, bottle: true, glass: true, cup: true, table: true, everyone: true,
};

/** Words that start a trailing phrase about where, how, when or who a thing is for ("sandwich for lunch", "beer at a bar", "pizza by the slice"). */
const TRAILING: Readonly<Record<string, true>> = { for: true, to: true, from: true, at: true, with: true, in: true, on: true, by: true, per: true, as: true };

/**
 * A word's comparison form: lowercase singular, simply ("coffees" coffee, "lunches" lunch,
 * "glasses" glass, "potatoes" potato), with -y and -ie endings made one ("battery" and "batteries",
 * "cookie" and "cookies" compare equal). A hyphenated word keeps its hyphens and stems its last part.
 */
export function stem(word: string): string {
  const parts = word.split("-");
  const w = parts.pop() ?? "";
  let s = w;
  if (w.length > 3 && !/(?:ss|us|is)$/.test(w)) {
    if (w.length > 4 && w.endsWith("ies")) s = `${w.slice(0, -3)}i`;
    else if (/(?:s|x|z|ch|sh)es$/.test(w) || (w.length > 5 && w.endsWith("oes"))) s = w.slice(0, -2);
    else if (w.endsWith("s")) s = w.slice(0, -1);
    if (s.length > 3 && /(?:ie|y)$/.test(s)) s = s.replace(/(?:ie|y)$/, "i");
  }
  return [...parts, s].join("-");
}

/** Lowercase words of a phrase; a hyphenated word ("fast-food", "flip-flops") is one word. */
function tokens(text: string): string[] {
  return text.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

/** Stemmed words without filler, each hyphenated word also as its parts (so "fast food" meets "fast-food"). */
function wordsOf(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of list) {
    if (FILLER[t]) continue;
    out.push(stem(t));
    if (t.includes("-")) for (const part of t.split("-")) if (part !== "" && !FILLER[part]) out.push(stem(part));
  }
  return out;
}

export interface ItemName {
  /** The main noun: the last word of the name's noun phrase, stemmed. */
  head: string;
  /** The noun phrase's words and its qualifiers' ("Milk, whole" is milk with whole), stemmed, without filler. */
  words: Set<string>;
  /** A trailing phrase cut from the noun ("for Danny" in "coffee for Danny"): its first word and its words. */
  trailing: { word: string; words: string[] } | null;
}

/**
 * A purchase's item as purchases compare it. Lowercase; a catalog name's "Noun, qualifier" (or
 * "Noun (qualifier)") read as the noun, its qualifier's words kept; a trailing "for/to/from/at/with/
 * in/on/by/per/as …" phrase cut from the noun ("sandwich for lunch" is a sandwich); filler dropped;
 * plurals made singular. The head noun is the noun's last word that isn't a number. Null when
 * nothing names a thing.
 */
export function itemName(text: string): ItemName | null {
  const lower = text.toLowerCase();
  const cut = lower.search(/[,(]/);
  const base = tokens(cut < 0 ? lower : lower.slice(0, cut));
  const qualifier = cut < 0 ? [] : tokens(lower.slice(cut + 1));
  const at = base.findIndex((w, i) => i > 0 && TRAILING[w] === true);
  const noun = (at < 0 ? base : base.slice(0, at)).filter((t) => !FILLER[t]);
  const head = noun.findLast((t) => /[a-z]/.test(t));
  if (head === undefined) return null;
  const trailing = at < 0 ? null : { word: base[at] ?? "", words: wordsOf(base.slice(at + 1)) };
  return { head: stem(head), words: new Set([...wordsOf(noun), ...wordsOf(qualifier)]), trailing };
}

export interface CatalogName {
  /** The nouns the row names: its noun phrase's head, and the heads of alternatives at least as long as the last ("Pastry or muffin": pastry and muffin; "Vegetable or canola oil": oil). */
  heads: Set<string>;
  /** The head of the noun phrase as a whole (its last alternative's). */
  main: string;
  /** The noun phrase's other words: what kind of the thing the row is ("Vegetable or canola oil": vegetable, canola; "Drip coffee, 12 oz": drip). */
  qualifiers: Set<string>;
  /** Every word of the row's id and name, stemmed, without filler. */
  words: Set<string>;
}

/**
 * A catalog row as purchases match it. The noun phrase (before a comma or parenthesis, without a
 * trailing phrase) may list alternatives with "or". An alternative shorter than the last one
 * shares the last one's head ("Bar or club cover charge" is a charge, not a bar); one as long or
 * longer names its own thing ("Light jacket or windbreaker" is both).
 */
export function catalogName(id: string, name: string): CatalogName {
  const lower = name.toLowerCase();
  const cut = lower.search(/[,(]/);
  const base = tokens(cut < 0 ? lower : lower.slice(0, cut));
  const at = base.findIndex((w, i) => i > 0 && TRAILING[w] === true);
  const noun = at < 0 ? base : base.slice(0, at);
  const alternatives: string[][] = [[]];
  for (const t of noun) {
    if (t === "or") alternatives.push([]);
    else if (!FILLER[t]) alternatives.at(-1)?.push(t);
  }
  const named = alternatives.filter((a) => a.length > 0);
  const last = named.at(-1) ?? [];
  const heads = new Set<string>();
  for (const alt of named) {
    const word = alt.at(-1);
    if (word === undefined || (alt !== last && alt.length < last.length)) continue;
    heads.add(stem(word));
    if (word.includes("-")) heads.add(stem(word.split("-").at(-1) ?? word));
  }
  const words = new Set([...wordsOf(tokens(lower)), ...wordsOf(id.split("_"))]);
  const qualifiers = new Set(named.flat().filter((w) => !/^\d/.test(w)).map((w) => stem(w)).filter((w) => !heads.has(w)));
  return { heads, main: stem(last.at(-1) ?? ""), qualifiers, words };
}
