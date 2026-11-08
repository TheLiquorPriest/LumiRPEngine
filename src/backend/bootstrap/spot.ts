// The spot-check cards (DEPTH-PLAN §8.6): after each chapter, a card the user marks right or wrong,
// with a word on what's wrong. It holds a sample of the chapter's beats beside the prose they came
// from (with the message, to jump to), every beat the historian, the agents or the author flagged as
// uncertain, one character's new memories beside what it lived, a notebook excerpt with what it
// cites, and every contradiction the import found. The sample is random, seeded by the card, so the
// same chapter shows the same sample on a reload; picking it is bookkeeping, never a judgment. Beside
// its items, unmarked, it lists the model answers the run's parsers didn't keep whole since the card
// before, each field by its path (the raw-against-saved audit; the answer stays in its job's record).

import type { EntityId, MessageId } from "../../shared/ids";
import type { SpotCheckCard, SpotItem, SpotMisread } from "../../shared/bootstrap";
import { reachOf } from "../../shared/character-engine";
import type { Beat } from "../../shared/story";
import { isRecord } from "../../shared/json";
import { blobHash } from "../../shared/stores";
import type { ImportedEntry } from "./import";
import type { AuthorOut, ReconcileOut, StageOut } from "./run";

export function isCard(raw: unknown): raw is SpotCheckCard {
  return typeof raw === "object" && raw !== null && "items" in raw && Array.isArray(raw.items) && "chapter" in raw && typeof raw.chapter === "number" && "id" in raw && typeof raw.id === "string";
}

/** A small seeded generator (mulberry32): the same card draws the same sample. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Prose around the words a beat cites, else the message's opening: enough to judge the beat by. */
function excerpt(prose: string, quotes: string): string {
  const LIMIT = 1600;
  if (prose.length <= LIMIT) return prose;
  const probe = quotes.slice(0, 40);
  const at = probe !== "" ? prose.indexOf(probe) : -1;
  if (at < 0) return `${prose.slice(0, LIMIT)}…`;
  const from = Math.max(0, at - LIMIT / 2);
  return `${from > 0 ? "…" : ""}${prose.slice(from, from + LIMIT)}…`;
}

export interface SpotInput {
  id: string;
  chapter: number;
  now: number;
  sample: number;
  seed: number;
  beats: readonly Beat[];
  blobs: Readonly<Record<string, string>>;
  /** What the historian flagged: beat ids, or words naming them. */
  uncertain: readonly string[];
  prose: ReadonlyMap<MessageId, { text: string; index: number }>;
  /** Each character's catch-ups in the chapter. */
  minds: readonly { who: EntityId; name: string; out: StageOut }[];
  /** The points of view each beat's partial reach got, by beat. */
  povs: Readonly<Record<string, Readonly<Record<EntityId, string>>>>;
  notebook: AuthorOut | null;
  contradictions: ReconcileOut["contradictions"];
  entries: readonly ImportedEntry[];
  /** The answers the run's parsers didn't keep whole since the card before. */
  misread?: readonly SpotMisread[];
}

/** A mind write's path and text, and the beats it says it lived, from a stage's events. */
function memoriesOf(who: EntityId, out: StageOut): { path: string; text: string; lived: string[] }[] {
  const lived = new Map<string, string[]>();
  for (const e of out.events) {
    if (e.type !== "minds.v2.write" || !("data" in e) || !isRecord(e.data)) continue;
    const path = typeof e.data.path === "string" ? e.data.path : "";
    if (Array.isArray(e.data.lived)) lived.set(path, e.data.lived.filter((x): x is string => typeof x === "string"));
  }
  const found: { path: string; text: string; lived: string[] }[] = [];
  for (const e of out.events) {
    if (e.type !== "engine.ws.write" || !("data" in e) || !isRecord(e.data)) continue;
    const path = typeof e.data.path === "string" ? e.data.path : "";
    const hash = typeof e.data.blob === "string" ? e.data.blob : typeof e.data.hash === "string" ? e.data.hash : "";
    if (!path.includes("/memories/") || !path.includes(who)) continue;
    const text = out.blobs[hash] ?? "";
    if (text === "") continue;
    const rel = path.slice(path.indexOf(who) + who.length + 1);
    found.push({ path: rel, text, lived: lived.get(rel) ?? lived.get(path) ?? [] });
  }
  return found;
}

export function buildSpotCard(i: SpotInput): SpotCheckCard {
  const rnd = random(i.seed);
  const items: SpotItem[] = [];
  const flagged = new Set(i.beats.filter((b) => b.uncertain !== undefined || i.uncertain.includes(b.id) || i.uncertain.some((u) => u.includes(b.id))).map((b) => b.id));
  const pool = i.beats.filter((b) => !flagged.has(b.id) && "bootstrap" in b.by);
  const picked = new Set<string>();
  while (picked.size < Math.min(i.sample, pool.length)) picked.add((pool[Math.floor(rnd() * pool.length)] as Beat).id);
  for (const b of i.beats) {
    if (!picked.has(b.id) && !flagged.has(b.id)) continue;
    const src = "bootstrap" in b.by ? b.by.bootstrap.message : null;
    const prose = src ? i.prose.get(src) : undefined;
    const quotes = b.quotes !== undefined ? (i.blobs[b.quotes] ?? "") : "";
    items.push({ id: `beat:${b.id}`, kind: "beat", mark: null, flagged: flagged.has(b.id), beat: b.id, what: i.blobs[b.what] ?? "", quotes, message: src ?? "", index: prose?.index ?? -1, prose: prose ? excerpt(prose.text, quotes) : "" });
  }
  // One character's new memories, beside what it lived: the one who wrote the most this chapter, ties by the draw.
  const writers = new Map<EntityId, { name: string; memories: { path: string; text: string; lived: string[] }[] }>();
  for (const m of i.minds) {
    const w = writers.get(m.who) ?? { name: m.name, memories: [] };
    w.memories.push(...memoriesOf(m.who, m.out));
    writers.set(m.who, w);
  }
  const ranked = [...writers.entries()].filter(([, w]) => w.memories.length > 0).sort((a, b) => b[1].memories.length - a[1].memories.length || (rnd() < 0.5 ? -1 : 1));
  const chosen = ranked[0];
  if (chosen) {
    const [who, w] = chosen;
    const byId = new Map(i.beats.map((b) => [b.id, b]));
    for (const mem of w.memories.slice(0, 3)) {
      items.push({
        id: `memory:${who}:${mem.path}`,
        kind: "memory",
        mark: null,
        flagged: false,
        who,
        name: w.name,
        path: mem.path,
        text: mem.text,
        lived: mem.lived.flatMap((id) => {
          const b = byId.get(id);
          if (!b) return [];
          // What it lived of the beat, as its catch-up had it (`reachOf`): its own point of view where one was written, its deed for its own act, a message's words.
          const pov = i.povs[id]?.[who];
          const mine = pov !== undefined ? blobHash(pov) : undefined;
          const reach = reachOf(mine !== undefined ? { ...b, exposure: b.exposure.map((x) => (x.who === who ? { ...x, pov: mine } : x)) } : b, who);
          return [{ beat: id, text: reach === null ? "" : reach.text === mine ? (pov ?? "") : (i.blobs[reach.text] ?? "") }];
        }),
      });
    }
  }
  // A notebook excerpt from the chapter's revision, with what it cites.
  const note = i.notebook?.events.find((e) => "data" in e && isRecord(e.data) && typeof e.data.path === "string" && e.data.path.startsWith("notebook/"));
  if (note && "data" in note && isRecord(note.data)) {
    const path = String(note.data.path);
    const hash = typeof note.data.blob === "string" ? note.data.blob : typeof note.data.hash === "string" ? note.data.hash : "";
    const body = i.notebook?.blobs[hash] ?? "";
    if (body !== "") items.push({ id: `notebook:${path}`, kind: "notebook", mark: null, flagged: false, path, excerpt: body.length > 1600 ? `${body.slice(0, 1600)}…` : body, cites: [...new Set(body.match(/\bb_[0-9a-z]+\b/g) ?? [])].slice(0, 12) });
  }
  // Every contradiction the import found.
  const entries = new Map(i.entries.map((e) => [e.id, e]));
  for (const c of i.contradictions) {
    const e = entries.get(c.entry);
    items.push({ id: `contradiction:${c.entry}:${c.against}`, kind: "contradiction", mark: null, flagged: true, entry: c.entry, source: e?.source ?? "world_info", title: e?.title ?? c.entry, text: e?.text ?? "", against: c.against, why: c.why });
  }
  return { id: i.id, chapter: i.chapter, createdAt: i.now, items, ...(i.misread && i.misread.length > 0 ? { misread: [...i.misread] } : {}) };
}
