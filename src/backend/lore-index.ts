// AI lore indexing (DESIGN §4.2, §9.7): "Index a World Info book" and "Index this text" ask the
// helper for lore entries (a title, the other names its subject goes by, topics, links to the
// world's entities and places, and extra lookup terms) in batches bounded like Import from lore's.
// Each proposal is checked (ids, lengths, links) and deduplicated against the world's lore and the
// job's other proposals. It carries its source: a book entry keeps the book's own text and the hash
// of it; an entry from pasted text holds the helper's words and an AI source, pending until the
// author accepts it in the review. Accepted proposals go to the draft, their terms and topics into
// the lookup table.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import { bookTextHash, loreSourceOf, loreTerm, topicIdOf } from "../shared/lore";
import { neutralizeMacros } from "../shared/macros";
import type { JobProposal } from "../shared/protocol";
import type { LoreSource, WorldDoc } from "../shared/world";
import { PROPOSALS_MAX, PROPOSALS_PER_CALL, worldSummary, type DropCounts } from "./proposals";

/** A book entry to index from, or the pasted text a job splits into calls. */
export type IndexMode = "book" | "text";

/** Characters of pasted text per call; the calls per job are Import's. */
export const INDEX_TEXT_CHUNK = 6000;
/** The most an entry the helper writes from pasted text keeps. */
const CONTENT_MAX = 4000;
/** Bounds per proposed entry: a title, an alias or a term in characters, then each list's length. */
const NAME_MAX = 80;
const ALIASES_MAX = 12;
const TOPICS_MAX = 8;
const LINKS_MAX = 16;
const TERMS_MAX = 24;
/** Existing titles the prompt lists, so the helper doesn't propose them again. */
const KNOWN_TITLES = 60;

const OUTPUT: Record<IndexMode, string> = {
  book: '{"entries":[{"key":string,"title":string,"aliases":[string],"topics":[string],"links":[string],"terms":[string],"confidence":number,"note"?:string,"source":string}]}',
  text: '{"entries":[{"key":string,"title":string,"content":string,"aliases":[string],"topics":[string],"links":[string],"terms":[string],"confidence":number,"note"?:string}]}',
};

export function indexSystem(mode: IndexMode, world: WorldDoc): string {
  const known = Object.values(world.lore)
    .slice(0, KNOWN_TITLES)
    .map((l) => l.title)
    .join("; ");
  const rules = [
    mode === "book" ? "One entry per book entry; never merge or split them." : "One entry per subject the text describes: a place, a person, a group, an object, an event or a custom.",
    "Index only what the text states; never invent facts, names or numbers.",
    "title: what the entry is about, in at most eight words.",
    'aliases: other names, nicknames and short forms the text uses for the same subject ("the old lighthouse"); none when it has none.',
    'topics: one to three broad subjects it belongs under ("Harbor law", "The Okafor family"); reuse the same topic across entries.',
    "links: ids from the world's entities and places above that the entry is about; never any other id.",
    "terms: other words someone might look it up by (abbreviations, spellings), lowercase; optional.",
    mode === "book" ? '"source" is the id after "source:" in the heading of the entry; leave out content: the entry keeps the book\'s own text.' : "content: the text's own words about the subject, at most 1,200 characters.",
    `At most ${PROPOSALS_PER_CALL} entries. key is lowercase snake_case and stable.`,
    "confidence is 0..1: 0.9+ only when the text states it outright; add a short note when you are unsure.",
  ].join("\n- ");
  return `You index the lore of a roleplay world for a simulation engine's lookups.\n${worldSummary(world)}\nLore the world already has (don't propose it again): ${known || "none"}.\nRules:\n- ${rules}\nOutput JSON only: ${OUTPUT[mode]}.`;
}

/** Added to the request for the one retry, when a reply had nothing usable (`indexReplyProblem`). */
export function indexRetry(mode: IndexMode): string {
  return `Your last reply had no usable entries (it was empty, not valid JSON, or not in this shape). Reply with JSON only, in this shape: ${OUTPUT[mode]}. Each ${mode === "book" ? "entry" : "passage"} above describes something; index what it states.`;
}

function isIndexReply(raw: JsonValue | null): raw is JsonObject & { entries: JsonValue[] } {
  return isRecord(raw) && Array.isArray(raw.entries);
}

/** Parses a reply into raw lore proposals (shape only; `checkIndexProposals` validates them). A malformed entry is skipped on its own. */
export function readIndexProposals(raw: JsonValue | null, source: string): JobProposal[] {
  const list = isIndexReply(raw) ? raw.entries.slice(0, PROPOSALS_PER_CALL) : [];
  return list.flatMap((e, i): JobProposal[] => {
    if (!isRecord(e)) return [];
    const key = [e.key, e.title, e.source].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? "";
    if (key === "") return [];
    return [{ id: `${source}:${i}`, collection: "lore", key, value: JSON.parse(JSON.stringify(e)) as JsonValue, source: typeof e.source === "string" ? e.source : source, confidence: typeof e.confidence === "number" ? Math.min(1, Math.max(0, e.confidence)) : 0.5, ...(typeof e.note === "string" ? { note: e.note } : {}) }];
  });
}

/** Why a helper reply can't be indexed, or null when it can: empty or not JSON, another shape, an empty list (the lore always has text), or no readable entry. */
export function indexReplyProblem(raw: JsonValue | null): string | null {
  if (raw === null) return "empty or not JSON";
  if (!isIndexReply(raw)) return "JSON in another shape";
  if (raw.entries.length === 0) return "an empty list for lore with text";
  return readIndexProposals(raw, "check").length === 0 ? `none of its ${raw.entries.length} entr${raw.entries.length === 1 ? "y" : "ies"} readable` : null;
}

/**
 * Pasted text split for the helper: paragraphs packed into chunks of at most `size` characters; a
 * paragraph longer than that is cut at the last space before the limit.
 */
export function textChunks(text: string, size = INDEX_TEXT_CHUNK): string[] {
  const out: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\s*\n/)) {
    let rest = paragraph.trim();
    while (rest !== "") {
      const joined = current === "" ? rest : `${current}\n\n${rest}`;
      if (joined.length <= size) {
        current = joined;
        rest = "";
      } else if (current !== "") {
        out.push(current);
        current = "";
      } else {
        const space = rest.lastIndexOf(" ", size);
        const cut = space > size / 2 ? space : size;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
    }
  }
  if (current !== "") out.push(current);
  return out;
}

/** The book an index job reads: each entry's title, text and World Info keys, by entry id. */
export interface IndexBook {
  bookId: string;
  entries: Map<string, { title: string; content: string; keys: readonly string[] }>;
}

/** Strings from a list, macro-free and trimmed, each at most `max` characters, without repeats (case aside), at most `count`. */
function names(v: unknown, max: number, count: number): string[] {
  const out: string[] = [];
  for (const s of Array.isArray(v) ? v : []) {
    if (typeof s !== "string") continue;
    const name = neutralizeMacros(s).replace(/\s+/g, " ").trim().slice(0, max);
    if (name !== "" && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, count);
}

/**
 * Validates and normalizes lore proposals against the world, then dedupes them. A book proposal
 * must cite an entry of the book that the world's lore doesn't already hold, and keeps that
 * entry's text and keys; the most confident proposal per book entry wins. A text proposal needs
 * its own text. A title the world's lore (or an earlier proposal) already has is dropped. Links to
 * anything but the world's entities and places are dropped with a note. Keys are snake case and
 * never replace an existing entry: a taken one gets a number.
 */
export function checkIndexProposals(world: WorldDoc, raw: readonly JobProposal[], book: IndexBook | null, drops: DropCounts = new Map()): JobProposal[] {
  const drop = (why: string): void => {
    drops.set(why, (drops.get(why) ?? 0) + 1);
  };
  const indexed = new Set(
    Object.values(world.lore).flatMap((l) => {
      const s = loreSourceOf(l.source);
      return s.kind === "book" ? [`${s.bookId}/${s.entryId}`] : [];
    }),
  );
  const byTitle = new Map<string, string>();
  for (const [id, e] of book?.entries ?? []) if (e.title !== "") byTitle.set(e.title.toLowerCase(), id);
  // One proposal per book entry (or per title, for text): the most confident.
  const chosen = new Map<string, { p: JobProposal; entryId: string | null }>();
  for (const p of raw) {
    const v = isRecord(p.value) ? p.value : {};
    let entryId: string | null = null;
    if (book) {
      const cited = p.source.trim();
      entryId = book.entries.has(cited) ? cited : (byTitle.get(cited.toLowerCase()) ?? null);
      if (entryId === null) {
        drop("cited no entry of the book");
        continue;
      }
      if (indexed.has(`${book.bookId}/${entryId}`)) {
        drop("were already in the world's lore");
        continue;
      }
    }
    const group = entryId ?? (typeof v.title === "string" ? loreTerm(v.title) : p.key);
    const prior = chosen.get(group);
    if (prior) drop("repeated another proposal");
    if (!prior || p.confidence > prior.p.confidence) chosen.set(group, { p, entryId });
  }
  const titles = new Set(Object.values(world.lore).map((l) => loreTerm(l.title)));
  const taken = new Set(Object.keys(world.lore));
  const out: JobProposal[] = [];
  for (const { p, entryId } of chosen.values()) {
    if (out.length >= PROPOSALS_MAX) {
      drop(`were past the ${PROPOSALS_MAX}-proposal limit`);
      continue;
    }
    const v = isRecord(p.value) ? p.value : {};
    const from = book && entryId !== null ? book.entries.get(entryId) : undefined;
    const title = names([v.title], NAME_MAX, 1)[0] ?? names([from?.title ?? ""], NAME_MAX, 1)[0] ?? "";
    if (title === "") {
      drop("had no title");
      continue;
    }
    if (titles.has(loreTerm(title))) {
      drop("repeated an existing entry's title");
      continue;
    }
    const content = from ? from.content : typeof v.content === "string" ? v.content.trim().slice(0, CONTENT_MAX) : "";
    if (content.trim() === "") {
      drop("had no text");
      continue;
    }
    titles.add(loreTerm(title));
    const base = topicIdOf(p.key) || topicIdOf(title) || "lore";
    let key = base;
    for (let n = 2; taken.has(key) || !safeKey(key); n++) key = `${base}_${n}`;
    taken.add(key);
    const notes: string[] = p.note ? [p.note] : [];
    const aliases = names(v.aliases, NAME_MAX, ALIASES_MAX).filter((a) => loreTerm(a) !== loreTerm(title));
    const topics = names(v.topics, NAME_MAX, TOPICS_MAX);
    const links: string[] = [];
    for (const link of names(v.links, 200, LINKS_MAX * 2)) {
      if (hasOwn(world.entities, link) || hasOwn(world.places, link)) {
        if (links.length < LINKS_MAX) links.push(link);
      } else notes.push(`dropped unknown link ${link}`);
    }
    const terms = [...new Set([title, ...aliases, ...names(v.terms, NAME_MAX, TERMS_MAX)].map(loreTerm))].filter((t) => safeKey(t)).slice(0, TERMS_MAX);
    const filed = [...new Map(topics.map((label) => [topicIdOf(label), label])).entries()].filter(([id]) => safeKey(id)).map(([id, label]) => ({ id, label }));
    const source: LoreSource = book && entryId !== null ? { kind: "book", bookId: book.bookId, entryId, hash: bookTextHash(content) } : { kind: "ai", status: "pending" };
    const value: JsonObject = { id: key, title, content, keys: from ? names(from.keys, NAME_MAX, ALIASES_MAX) : [], links, ...(aliases.length > 0 ? { aliases } : {}), ...(topics.length > 0 ? { topics } : {}), source };
    const { note: _said, ...rest } = p;
    out.push({ ...rest, key, value, pack: "lore", index: { terms, topics: filed }, ...(book && entryId !== null && from ? { sourceNames: { [`${book.bookId}/${entryId}`]: from.title || entryId } } : {}), ...(notes.length > 0 ? { note: notes.join("; ") } : {}) });
  }
  return out;
}
