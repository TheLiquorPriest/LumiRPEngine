// The texts an agent looks things up in, bundled into dist/lumirpengine.js as strings: the agent
// guide (docs/AGENT-GUIDE.md) and the engine's docs. A lookup ranks sections by BM25 (titles count
// three times their words, stopwords dropped, words lightly stemmed, ids such as `due_day` kept
// whole), with long sections cut into parts first, so a match deep in DESIGN.md comes back as the
// paragraphs around it, not as the section's start.

import guideText from "../../docs/AGENT-GUIDE.md" with { type: "text" };
import depthText from "../../docs/DEPTH.md" with { type: "text" };
import designText from "../../docs/DESIGN.md" with { type: "text" };
import expressionsText from "../../docs/EXPRESSIONS.md" with { type: "text" };
import loopbackText from "../../docs/LOOPBACK.md" with { type: "text" };
import mcpText from "../../docs/MCP.md" with { type: "text" };
import presetsText from "../../docs/PRESETS.md" with { type: "text" };
import recipesText from "../../docs/RECIPES.md" with { type: "text" };
import referenceText from "../../docs/REFERENCE.md" with { type: "text" };
import userGuideText from "../../docs/USER-GUIDE.md" with { type: "text" };
import { hasOwn } from "../shared/json";
import { ANSWER_LIMIT, BODY_LIMIT, count } from "../shared/tool-read";

export const GUIDE = guideText;

/** The docs `lre_docs` searches, by the name it takes. */
export const DOCS: Readonly<Record<string, { file: string; text: string }>> = {
  reference: { file: "REFERENCE.md", text: referenceText },
  expressions: { file: "EXPRESSIONS.md", text: expressionsText },
  recipes: { file: "RECIPES.md", text: recipesText },
  design: { file: "DESIGN.md", text: designText },
  "user-guide": { file: "USER-GUIDE.md", text: userGuideText },
  presets: { file: "PRESETS.md", text: presetsText },
  depth: { file: "DEPTH.md", text: depthText },
  loopback: { file: "LOOPBACK.md", text: loopbackText },
  "agent-guide": { file: "AGENT-GUIDE.md", text: guideText },
  mcp: { file: "MCP.md", text: mcpText },
};

export interface Section {
  /** The heading trail: "Economy pack (`economy`) › Kinds › `account`: Account". */
  title: string;
  /** The heading's own depth (1 for `#`). */
  depth: number;
  body: string;
}

/** A section longer than this is looked up in parts of about this size, cut at paragraph breaks. */
const PART = 4000;

/** Splits markdown at its headings (outside code fences) into sections with their heading trail. */
export function sectionsOf(markdown: string): Section[] {
  const out: Section[] = [];
  const trail: string[] = [];
  let depth = 0;
  let body: string[] = [];
  let fenced = false;
  const flush = (): void => {
    const text = body.join("\n").trim();
    if (trail.length > 0 && text !== "") out.push({ title: trail.filter((t) => t !== "").join(" › "), depth, body: text });
    body = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      depth = (heading[1] ?? "#").length;
      trail.length = depth - 1;
      for (let i = 0; i < depth - 1; i++) trail[i] ??= "";
      trail[depth - 1] = (heading[2] ?? "").trim();
    } else body.push(line);
  }
  flush();
  return out;
}

/** A long section as parts of about PART characters, each cut where a paragraph ends outside a code fence. */
function partsOf(section: Section): Section[] {
  if (section.body.length <= PART) return [section];
  const parts: Section[] = [];
  let lines: string[] = [];
  let size = 0;
  let fenced = false;
  const flush = (): void => {
    const text = lines.join("\n").trim();
    if (text !== "") parts.push({ title: `${section.title} (part ${parts.length + 1})`, depth: section.depth, body: text });
    lines = [];
    size = 0;
  };
  for (const line of section.body.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "" && size >= PART) flush();
    lines.push(line);
    size += line.length + 1;
  }
  flush();
  return parts;
}

/** Words that say nothing of what a section is about: a lookup leaves them out. */
const STOPWORDS: Readonly<Record<string, true>> = Object.fromEntries(
  "a about after all an and any are as at be been before being but by can could did do does doing each for from had has have how i if in into is it its me my no nor not of on once only or other our out over own so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your".split(" ").map((w) => [w, true]),
);

/** A term: a word, or an id (`due_day`, `economy.people_money`, `lre_gm`) whole. */
const TERM = /[a-z0-9]+(?:[._][a-z0-9]+)*/g;

/** A word's light stem: plurals, -ing and -ed taken off, so "bills", "billing" and "billed" are "bill". */
export function stem(word: string): string {
  if (word.length <= 3 || /[^a-z]/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ss|x|ch|sh|z)es$/.test(word)) return word.slice(0, -2);
  for (const suffix of ["ing", "ed"]) {
    const base = word.slice(0, -suffix.length);
    // A base with a vowel, so "string" and "speed" stay whole; a doubled last consonant goes ("stopped" is "stop"), but not ll, ss or ff ("billed" is "bill"), nor in a short base ("added" is "add").
    if (word.endsWith(suffix) && !word.endsWith("eed") && base.length >= 3 && /[aeiouy]/.test(base)) return base.length > 3 && /([bdgmnprt])\1$/.test(base) ? base.slice(0, -1) : base;
  }
  return word.endsWith("s") && !/(?:ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
}

/** A text's terms, in order: lowercased, stopwords and one-letter words left out, words stemmed and ids whole. */
export function termsOf(text: string): string[] {
  const out: string[] = [];
  for (const [term] of text.toLowerCase().matchAll(TERM)) {
    if (term.length < 2 || hasOwn(STOPWORDS, term)) continue;
    out.push(/[._]/.test(term) ? term : stem(term));
  }
  return out;
}

/** How much a word of a section's heading trail counts, against one of its body. */
const TITLE_WEIGHT = 3;
/** BM25's saturation and length normalization, at their usual values. */
const K1 = 1.2;
const B = 0.75;

interface Index {
  /** Per section, each term's weighted count and the section's weighted length. */
  docs: { tf: Map<string, number>; length: number }[];
  /** How many sections hold each term. */
  df: Map<string, number>;
  average: number;
}

/** Each corpus's index, made on its first lookup. */
const indexes = new WeakMap<readonly Section[], Index>();

function indexOf(sections: readonly Section[]): Index {
  const known = indexes.get(sections);
  if (known) return known;
  const df = new Map<string, number>();
  let total = 0;
  const docs = sections.map((s) => {
    const tf = new Map<string, number>();
    const title = termsOf(s.title);
    const body = termsOf(s.body);
    for (const t of title) tf.set(t, (tf.get(t) ?? 0) + TITLE_WEIGHT);
    for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const length = TITLE_WEIGHT * title.length + body.length;
    total += length;
    return { tf, length };
  });
  const index: Index = { docs, df, average: docs.length > 0 ? total / docs.length : 0 };
  indexes.set(sections, index);
  return index;
}

/** The sections that best match the query by BM25, best first (ties in the corpus's order), each clipped, within `budget` characters in all. */
export function lookup(sections: readonly Section[], query: string, limit = 5, budget = BODY_LIMIT): string {
  const words = [...new Set(termsOf(query))];
  if (words.length === 0) return "Give a few words to look up (two letters or more each, not only words such as \"the\" or \"how\").";
  const { docs, df, average } = indexOf(sections);
  const idf = words.map((w) => {
    const n = df.get(w) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  });
  const scored = docs
    .map((d, i) => {
      let score = 0;
      words.forEach((w, k) => {
        const tf = d.tf.get(w) ?? 0;
        if (tf > 0) score += ((idf[k] ?? 0) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / (average || 1)));
      });
      return { i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .flatMap(({ i }) => sections[i] ?? []);
  if (scored.length === 0) return `Nothing matches "${query}". Try other words, or a kind, field, effect or function name.`;
  const each = Math.floor(budget / scored.length);
  return scored.map((s) => `## ${s.title}\n${s.body.length > each ? `${s.body.slice(0, each)}\n…` : s.body}`).join("\n\n");
}

const guideSections = sectionsOf(guideText);

/** A section with its subsections, as the markdown a topic answers with. */
function render(parts: readonly Section[]): string {
  return parts.map((s) => `${"#".repeat(s.depth)} ${s.title.split(" › ").at(-1) ?? s.title}\n\n${s.body}`).join("\n\n");
}

/** The guide's top-level sections (its title's, then each `##` with what is under it), in order. */
const guideBlocks: { title: string; text: string }[] = [];
{
  let open: Section[] = [];
  const close = (): void => {
    const head = open[0];
    if (head) guideBlocks.push({ title: head.title.split(" › ").at(-1) ?? head.title, text: render(open) });
    open = [];
  };
  for (const s of guideSections) {
    if (s.depth <= 2) close();
    open.push(s);
  }
  close();
}
const docSections: Record<string, Section[]> = Object.fromEntries(Object.entries(DOCS).map(([name, d]) => [name, sectionsOf(d.text).flatMap(partsOf).map((s) => ({ ...s, title: `${d.file} › ${s.title}` }))]));
/** Every doc's sections, one corpus, so its index is made once. */
const allSections: readonly Section[] = Object.values(docSections).flat();

/**
 * Sections the guide's first answer always holds, whatever their size: how a world is built and
 * worked on, the people and their minds (where secrets leak), and the checks before a commit.
 */
const GUIDE_KEPT: Readonly<Record<string, true>> = { "The world model": true, "How to work on a user's world": true, People: true, "Character minds": true, "Before you commit": true };

/**
 * The agent guide. Without a topic: the whole guide when it fits one answer; else all of it but its
 * largest sections that aren't kept, which are the most particular (Money), named so a second call
 * can read them. A topic that names a heading returns that section with its subsections; any other
 * is looked up.
 */
export function guide(topic?: string): string {
  const wanted = (topic ?? "").trim().toLowerCase();
  if (wanted === "") {
    if (guideText.length <= ANSWER_LIMIT) return guideText;
    const out = new Set<number>();
    // Room for the closing note that names what was left out.
    let size = guideBlocks.reduce((n, b) => n + b.text.length + 2, 400);
    const optional = guideBlocks.flatMap((b, i) => (hasOwn(GUIDE_KEPT, b.title) ? [] : [i]));
    for (const i of optional.sort((a, b) => (guideBlocks[b]?.text.length ?? 0) - (guideBlocks[a]?.text.length ?? 0))) {
      if (size <= ANSWER_LIMIT) break;
      out.add(i);
      size -= (guideBlocks[i]?.text.length ?? 0) + 2;
    }
    const left = guideBlocks.filter((_, i) => out.has(i)).map((b) => `"${b.title}" (${count(b.text.length, "character")})`);
    return `${guideBlocks
      .filter((_, i) => !out.has(i))
      .map((b) => b.text)
      .join("\n\n")}\n\n(Left out so the rest fits one answer; read each with topic when the work needs it: ${left.join(", ")}.)`;
  }
  const at = guideSections.findIndex((s) => (s.title.split(" › ").at(-1) ?? "").toLowerCase() === wanted);
  const head = guideSections[at];
  if (head) {
    const parts = [head];
    for (const s of guideSections.slice(at + 1)) {
      if (s.depth <= head.depth) break;
      parts.push(s);
    }
    const text = render(parts);
    if (text.length <= ANSWER_LIMIT) return text;
  }
  return lookup(guideSections, wanted, 4);
}

/** A lookup in the bundled docs, all of them or the one named. */
export function docs(query: string, doc?: string): string {
  if (doc !== undefined && !hasOwn(docSections, doc)) return `There is no doc "${doc}". The docs: ${Object.keys(DOCS).join(", ")}.`;
  const sections = doc === undefined ? allSections : (docSections[doc] ?? []);
  return lookup(sections, query);
}
