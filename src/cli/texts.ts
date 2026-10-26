// The texts an agent looks things up in, bundled into dist/lumirpengine.js as strings: the agent
// guide (docs/AGENT-GUIDE.md) and the engine's docs. A lookup returns the sections that best match
// a query, headings counting most, with long sections cut into parts first,
// so a match deep in DESIGN.md comes back as the paragraphs around it, not as the section's start.

import guideText from "../../docs/AGENT-GUIDE.md" with { type: "text" };
import designText from "../../docs/DESIGN.md" with { type: "text" };
import expressionsText from "../../docs/EXPRESSIONS.md" with { type: "text" };
import presetsText from "../../docs/PRESETS.md" with { type: "text" };
import recipesText from "../../docs/RECIPES.md" with { type: "text" };
import referenceText from "../../docs/REFERENCE.md" with { type: "text" };
import userGuideText from "../../docs/USER-GUIDE.md" with { type: "text" };
import { hasOwn } from "../shared/json";
import { ANSWER_LIMIT, BODY_LIMIT, count } from "./read";

export const GUIDE = guideText;

/** The docs `lre_docs` searches, by the name it takes. */
export const DOCS: Readonly<Record<string, { file: string; text: string }>> = {
  reference: { file: "REFERENCE.md", text: referenceText },
  expressions: { file: "EXPRESSIONS.md", text: expressionsText },
  recipes: { file: "RECIPES.md", text: recipesText },
  design: { file: "DESIGN.md", text: designText },
  "user-guide": { file: "USER-GUIDE.md", text: userGuideText },
  presets: { file: "PRESETS.md", text: presetsText },
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

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let at = haystack.indexOf(needle); at >= 0 && n < 20; at = haystack.indexOf(needle, at + needle.length)) n++;
  return n;
}

/** The sections that best match the query, each clipped, within `budget` characters in all. */
export function lookup(sections: readonly Section[], query: string, limit = 5, budget = BODY_LIMIT): string {
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9_.]+/).filter((t) => t.length >= 2))];
  if (words.length === 0) return "Give a few words to look up (two letters or more each).";
  const phrase = query.toLowerCase().trim();
  const scored = sections
    .map((s, i) => {
      const title = s.title.toLowerCase();
      const body = s.body.toLowerCase();
      let score = 0;
      for (const w of words) score += 6 * occurrences(title, w) + Math.min(8, occurrences(body, w));
      if (phrase.length > 3 && (title.includes(phrase) || body.includes(phrase))) score += 10;
      // Every word present beats a few words many times.
      if (words.every((w) => title.includes(w) || body.includes(w))) score += 4 * words.length;
      return { s, i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit);
  if (scored.length === 0) return `Nothing matches "${query}". Try other words, or a kind, field, effect or function name.`;
  const each = Math.floor(budget / scored.length);
  return scored.map(({ s }) => `## ${s.title}\n${s.body.length > each ? `${s.body.slice(0, each)}\n…` : s.body}`).join("\n\n");
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
  const sections = doc === undefined ? Object.values(docSections).flat() : (docSections[doc] ?? []);
  return lookup(sections, query);
}
