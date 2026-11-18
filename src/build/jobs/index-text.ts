// Index this text (DESIGN §4.2, §9.7; PlanChatUI-B5): the job's agent is given the pasted text and proposes lore entries in its own words
// (a title, the other names its subject goes by, topics, links to the world's entities and places, and extra lookup terms) through
// `world_propose`. Each proposal is checked (ids, lengths, links) and deduplicated against the draft's lore and the job's other
// proposals. It holds the agent's words and an AI source, pending until he accepts it in the review; accepted ones go to the draft on his
// Apply, their terms and topics into the lookup table. Moved from the previous extension's `lore-index.ts`; its prompt is the agent's
// definition and brief now.

import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord, safeKey } from "../../shared/json";
import type { JobProposal } from "../../shared/jobs";
import { loreTerm, topicIdOf } from "../../shared/lore";
import { neutralizeMacros } from "../../shared/macros";
import type { WorldDoc } from "../../shared/world";
import { addDrop, type DropCounts } from "./checks";
import { say } from "../../engine/lines";

/** The most an entry written from pasted text keeps. */
const CONTENT_MAX = 4000;
/** Bounds per proposed entry: a title, an alias or a term in characters, then each list's length. */
const NAME_MAX = 80;
const ALIASES_MAX = 12;
const TOPICS_MAX = 8;
const LINKS_MAX = 16;
const TERMS_MAX = 24;

/** Reads a `world_propose` call's `entries` as raw lore proposals (shape only; `checkIndexProposals` validates them). A malformed entry is skipped on its own. */
export function readIndexProposals(raw: JsonValue | undefined, source: string): JobProposal[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.flatMap((e, i): JobProposal[] => {
    if (!isRecord(e)) return [];
    const key = [e.key, e.title, e.source].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? "";
    if (key === "") return [];
    return [{ id: `${source}:${i}`, collection: "lore", key, value: JSON.parse(JSON.stringify(e)) as JsonValue, source: typeof e.source === "string" ? e.source : source, confidence: typeof e.confidence === "number" ? Math.min(1, Math.max(0, e.confidence)) : 0.5, ...(typeof e.note === "string" ? { note: e.note } : {}) }];
  });
}

/**
 * Pasted text as the job keeps it: whole up to `max` characters (`build.index.chars`); a longer text is read to its last paragraph that
 * fits (cut at a space where even the first does not), and `cut` says how many characters were not read.
 */
export function keptText(text: string, max: number): { text: string; cut: number } {
  const whole = text.trim();
  if (whole.length <= max) return { text: whole, cut: 0 };
  const end = whole.lastIndexOf("\n\n", max);
  const space = whole.lastIndexOf(" ", max);
  const at = end > 0 ? end : space > 0 ? space : max;
  const kept = whole.slice(0, at).trim();
  return { text: kept, cut: whole.length - kept.length };
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
 * Validates and normalizes lore proposals against the draft, then dedupes them, at most `max` kept. A proposal needs its own text; the
 * later per title stands. A title the draft's lore already has is dropped. Links to anything but the world's entities and places are
 * dropped with a note. Keys are snake case and never replace an existing entry: a taken one gets a number.
 */
export function checkIndexProposals(world: WorldDoc, raw: readonly JobProposal[], max: number, drops: DropCounts = new Map()): JobProposal[] {
  const drop = (why: string, fields?: Record<string, string | number>): void => addDrop(drops, why, fields);
  // One proposal per title: the later stands, so the agent's fix replaces what it fixed.
  const chosen = new Map<string, JobProposal>();
  for (const p of raw) {
    const v = isRecord(p.value) ? p.value : {};
    const group = typeof v.title === "string" ? loreTerm(v.title) : p.key;
    if (chosen.has(group)) drop("replaced_title");
    chosen.delete(group);
    chosen.set(group, p);
  }
  const titles = new Set(Object.values(world.lore).map((l) => loreTerm(l.title)));
  const taken = new Set(Object.keys(world.lore));
  const out: JobProposal[] = [];
  for (const p of chosen.values()) {
    if (out.length >= max) {
      drop("past_limit", { max });
      continue;
    }
    const v = isRecord(p.value) ? p.value : {};
    const title = names([v.title], NAME_MAX, 1)[0] ?? "";
    if (title === "") {
      drop("no_title");
      continue;
    }
    if (titles.has(loreTerm(title))) {
      drop("existing_title");
      continue;
    }
    const content = typeof v.content === "string" ? v.content.trim().slice(0, CONTENT_MAX) : "";
    if (content.trim() === "") {
      drop("no_text");
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
      } else notes.push(say("build_dropped_unknown_link_link", { link }));
    }
    const terms = [...new Set([title, ...aliases, ...names(v.terms, NAME_MAX, TERMS_MAX)].map(loreTerm))].filter((t) => safeKey(t)).slice(0, TERMS_MAX);
    const filed = [...new Map(topics.map((label) => [topicIdOf(label), label])).entries()].filter(([id]) => safeKey(id)).map(([id, label]) => ({ id, label }));
    const value: JsonObject = { id: key, title, content, keys: [], links, ...(aliases.length > 0 ? { aliases } : {}), ...(topics.length > 0 ? { topics } : {}), source: { kind: "ai", status: "pending" } };
    const { note: _said, ...rest } = p;
    out.push({ ...rest, key, value, pack: "lore", index: { terms, topics: filed }, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) });
  }
  return out;
}
