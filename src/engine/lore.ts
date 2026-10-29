// Lore retrieval for RPEngine's own helpers (DESIGN §4.2, §5.4): a deterministic search over the
// world's lore and its lookup table, `get` and `list`. It reads the folded state and the world
// only, and never calls a model. Visibility is enforced here, so no caller can widen it:
//   - a secret entry whose gate doesn't hold reaches only the helpers in its audience, and never a
//     step whose output reaches the narrator or the player (`PROSE_STEPS`, an `effects` template),
//     whatever its audience says (the secrecy batching rule); once its gate holds it reads as public.
//     An entry is secret unless `secret` is `false` or absent (`loreIsSecret`), so a malformed
//     value keeps it hidden. A secret mark in a World Info entry (`shared/secret-marks.ts`) is such
//     a secret, read live as an entry of its own with its holders and no gate or audience, so it
//     reaches its holders' minds, the GM, and no helper;
//   - read as a character (a mind), a secret entry is read only when it is their own (`loreHeldBy`),
//     whether or not its gate holds: the POV uncovering a secret tells nobody else of it;
//   - a `known_by` entry is read only once the POV knows every person and place it links; one with
//     no links, a link to anything else, or a visibility this reader doesn't know stays hidden;
//   - an AI-written entry still waiting for review is read by nobody but the GM;
//   - the GM reads everything.
// Ranking, best first: exact hits on lookup-table terms, aliases, keywords and titles; then links
// to what the step is about; then topic matches; then the query's words in the entry; then the
// author's priority. Ties go by id, so the same inputs always give the same hits in the same order.

import type { EntityId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import { loreIsSecret, loreSourceOf, PROSE_STEPS, topicIdOf } from "../shared/lore";
import { publicText } from "../shared/secret-marks";
import type { LoreEntryDef, LoreKeep, StepPurpose, WorldDoc } from "../shared/world";
import { cuesOf } from "./cues";
import { namesHidden, playerKnows } from "./player-events";
import type { Registry } from "./registry-impl";
import type { WorldState } from "./state";
import { canSeePlace, loreGateReader, namesAny } from "./visibility";

/** Who reads: a helper step, or the GM, who reads everything. */
export type LorePurpose = StepPurpose | "gm";

/** What a search reads: the world, the folded state, and a token counter for snippets. */
export interface LoreReader {
  reg: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  /** A text's token cost: the host tokenizer's count when the caller has one, else the engine's estimate. */
  tokens(text: string): number;
}

export interface LoreQuery {
  /** Free text: table terms, aliases, keywords, titles and topic labels found in it are exact hits, and its words score entries' text. */
  query?: string;
  /** Exact terms (names the caller already has); each matches a table term, alias, keyword or title as a whole. */
  terms?: readonly string[];
  /** Entity and place ids the step is about. */
  links?: readonly string[];
  /** Topic ids or labels. */
  topics?: readonly string[];
  purpose: LorePurpose;
  /** An `effects` template's proposals become chips, so it reads no secret whatever its purpose. */
  effects?: boolean;
  /**
   * Activation only (the lore a turn activates for a mind, DESIGN §24.5): an entry counts only when
   * the query names it, by a lookup-table term, an alias, a keyword or its title said whole, as World
   * Info activates by its keys. Links, topics and the words an entry shares with the query count for
   * nothing, neither to find an entry nor to rank it.
   */
  exact?: boolean;
  /** Hits at most; absent, every match the token budget has room for. */
  limit?: number;
  /** Tokens all the hits' snippets may take together. */
  tokenBudget: number;
  /** Entries the caller already has: they still count as matched, but get no snippet. */
  skip?: ReadonlySet<string>;
  /**
   * Read as this character (a mind, DESIGN §24.5): `known_by` entries by what they know rather than
   * the POV, and of the secret entries only their own (`loreHeldBy`), gate or no gate, whatever their
   * audience says.
   */
  as?: EntityId;
}

export interface LoreHit {
  id: string;
  title: string;
  /** `Title: text`, cut at a word to fit the budget. */
  snippet: string;
  tokens: number;
  cut: boolean;
  /** A secret whose gate doesn't hold yet: its text must stay out of anything the player sees. */
  secret: boolean;
  /** What matched: `term:<term>`, `link:<id>`, `topic:<id>`, `words`. */
  why: string[];
}

export interface LoreResult {
  hits: LoreHit[];
  /** Readable entries that matched, before the limit, the budget and `skip`. */
  matched: number;
  /** Of `matched`, the secrets whose gate doesn't hold: the player's trace leaves them out. */
  secret: number;
}

/** Terms and words shorter than this match nothing ("a", "it"). */
const MIN_TERM = 3;
/** A cut snippet keeps at least this many words of the entry's text after its title. */
const MIN_WORDS = 4;
/** A word repeated in an entry counts at most this often: one long entry can't outrank every other on one word. */
const WORD_CAP = 3;
const STOP_WORDS: Record<string, true> = Object.fromEntries(
  "the and for with that this from into onto have has had was were are you your yours my mine our ours his her hers their theirs them they she him its not but all any can will would could should about then than there here what when where which who whom how why just very some more most other out over under again also like get got one two too off own same such only each both few nor yet".split(" ").map((w) => [w, true] as const),
);

/** Text as lookups read it: lowercase letters and digits, anything else one space, padded so a match falls on whole words. */
function plain(text: string): string {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return words === "" ? "" : ` ${words} `;
}

/** The words a query scores entries by: no stop words, no short ones, a plural's final `s` dropped. The story pack matches a puzzle's name by them too. */
export function wordsOf(text: string): string[] {
  return plain(text)
    .trim()
    .split(" ")
    .filter((w) => w.length >= MIN_TERM && !hasOwn(STOP_WORDS, w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Whether a secret entry is `who`'s own (DESIGN §24.5): its `holders` name them, or one of their cues
 * stands for it (the mapping Stance's cues use, `engine/cues.ts`). Linking them doesn't make it theirs:
 * an entry's links are what it is about.
 */
export function loreHeldBy(world: WorldDoc, entry: LoreEntryDef, who: EntityId): boolean {
  return listOf(entry.holders).includes(who) || cuesOf(world, who).some((c) => c.secret.kind === "lore" && c.secret.id === entry.id);
}

/**
 * Whether `purpose` may read the entry now (see the header), or, with `as`, the character `as` (a
 * mind). `open` reads gates against this state; pass one reader when checking many entries.
 */
export function loreReadable(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, entry: LoreEntryDef, purpose: LorePurpose, effects = false, open = loreGateReader(reg, world, state), as?: EntityId): boolean {
  if (purpose === "gm") return true;
  const source = loreSourceOf(entry.source);
  if (source.kind === "ai" && source.status === "pending") return false;
  if (as !== undefined && loreIsSecret(entry)) return loreHeldBy(world, entry, as);
  if (loreIsSecret(entry) && !open(entry)) return !effects && !PROSE_STEPS.includes(purpose) && listOf(entry.audience).includes(purpose);
  const v: unknown = entry.visibility;
  if (v === undefined || v === "public") return true;
  if (v !== "known_by") return false;
  const reader = as ?? world.pov;
  const links = listOf(entry.links);
  return links.length > 0 && links.every((id) => (hasOwn(state.entities, id) ? playerKnows(reg, world, state, reader, id) : hasOwn(world.places, id) && canSeePlace(reg, world, state, reader, id)));
}

/** The ids of every entry `purpose` may read now, in id order. */
export function readableLore(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, purpose: LorePurpose, effects = false): string[] {
  const open = loreGateReader(reg, world, state);
  return Object.keys(world.lore)
    .filter((id) => {
      const entry = world.lore[id];
      return entry !== undefined && hasOwn(world.lore, id) && loreReadable(reg, world, state, entry, purpose, effects, open);
    })
    .sort();
}

/** Whether `purpose` may read a secret entry whose gate doesn't hold yet. */
export function readsSecrets(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, purpose: LorePurpose, effects = false): boolean {
  const open = loreGateReader(reg, world, state);
  return Object.values(world.lore).some((entry) => loreIsSecret(entry) && !open(entry) && loreReadable(reg, world, state, entry, purpose, effects, open));
}

/**
 * What leads to a secret entry whose gate doesn't hold yet: its id, title, aliases and keys, the
 * lookup-table terms that lead to it, and the topics it is filed under (by the table, with their
 * ids, or by the entry). Names shorter than lookups match are left out.
 */
export function secretLoreNames(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  const open = loreGateReader(reg, world, state);
  const secret = Object.entries(world.lore).filter(([, entry]) => loreIsSecret(entry) && !open(entry));
  const ids = new Set(secret.map(([id]) => id));
  const names = new Set<string>();
  const add = (name: unknown): void => {
    if (typeof name === "string" && name.trim().length >= MIN_TERM) names.add(name.trim());
  };
  for (const [id, entry] of secret) for (const name of [id, entry.title, ...listOf(entry.aliases), ...listOf(entry.keys), ...listOf(entry.topics)]) add(name);
  for (const [term, leads] of Object.entries(world.loreIndex.terms)) if (listOf(leads).some((id) => ids.has(id))) add(term);
  for (const [id, topic] of Object.entries(world.loreIndex.topics)) {
    if (!isRecord(topic) || !listOf(topic.entries).some((entry) => ids.has(entry))) continue;
    add(id);
    add(topic.label);
  }
  return [...names];
}

/**
 * Whether words no name of the world vouches for (a pick as a model's read wrote it, the player's
 * words for an action as it gave them, a helper's suggestion) name anything hidden (DESIGN §7): what
 * `namesHidden` finds, or anything else that leads to a secret entry whose gate doesn't hold
 * (`secretLoreNames`), by all its words in order. Words `heard` says too don't count, since whoever
 * reads the text has seen them said: the player's own message for what the player reads, nothing
 * for what the narrator is told.
 */
export function namesHiddenOrSecretLore(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, text: string, heard = ""): boolean {
  return namesHidden(reg, world, state, text, heard) || namesAny(text, [], secretLoreNames(reg, world, state), heard);
}

/**
 * An entry as `Title: text`, cut at a word to fit `budget` tokens by `tokens`; null when not even its
 * title and a few words fit. World lore and pinned book entries (DESIGN §24.5) are cut alike. With
 * `keep` "end" the cut keeps the text's end (`Title: …words`), so a timeline written oldest first
 * keeps its newest events. A secret mark still in the text is left out (`applyMarks` "omit"): the
 * text goes to a model, and a mark given on as written would reach it as plain text.
 */
export function loreSnippet(tokens: (text: string) => number, entry: { readonly title?: unknown; readonly content?: unknown }, budget: number, keep: LoreKeep = "start"): { text: string; tokens: number; cut: boolean } | null {
  const title = (typeof entry.title === "string" ? entry.title : "").replace(/\s+/g, " ").trim();
  const body = publicText(typeof entry.content === "string" ? entry.content : "").replace(/\s+/g, " ").trim();
  const whole = title === "" ? body : `${title}: ${body}`;
  const cost = tokens(whole);
  if (cost <= budget) return { text: whole, tokens: cost, cut: false };
  if (keep === "end") {
    const words = body === "" ? [] : body.split(" ");
    const lead = title === "" ? "…" : `${title}: …`;
    const kept = (n: number): string => `${lead}${words.slice(words.length - n).join(" ")}`;
    let lo = MIN_WORDS;
    if (lo >= words.length || tokens(kept(lo)) > budget) return null;
    let hi = words.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (tokens(kept(mid)) <= budget) lo = mid;
      else hi = mid - 1;
    }
    const text = kept(lo);
    return { text, tokens: tokens(text), cut: true };
  }
  const head = title === "" ? 0 : title.split(" ").length;
  const words = whole.split(" ");
  const fits = (n: number): boolean => tokens(`${words.slice(0, n).join(" ")}…`) <= budget;
  let lo = head + MIN_WORDS;
  if (lo >= words.length || !fits(lo)) return null;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  const text = `${words.slice(0, lo).join(" ")}…`;
  return { text, tokens: tokens(text), cut: true };
}

/** The entries the lookup table files under a topic id, in its order, then those naming the topic, by id. */
function topicMembers(world: WorldDoc, topic: string): string[] {
  const filed = hasOwn(world.loreIndex.topics, topic) ? listOf(world.loreIndex.topics[topic]?.entries) : [];
  const named = Object.keys(world.lore)
    .filter((id) => listOf(world.lore[id]?.topics).some((label) => topicIdOf(label) === topic))
    .sort();
  return [...new Set([...filed, ...named])].filter((id) => hasOwn(world.lore, id));
}

/** `lore.search`: the entries `q.purpose` may read that match the query, ranked, with snippets within the budget. */
export function loreSearch(r: LoreReader, q: LoreQuery): LoreResult {
  const { reg, world, state } = r;
  const open = loreGateReader(reg, world, state);
  const text = plain(q.query ?? "");
  const exact = new Set((q.terms ?? []).map(plain).filter((t) => t.trim().length >= MIN_TERM));
  const said = (name: unknown): string | null => {
    if (typeof name !== "string") return null;
    const p = plain(name);
    return p.trim().length >= MIN_TERM && (exact.has(p) || (text !== "" && text.includes(p))) ? p.trim() : null;
  };
  // Table terms said, by the entries they lead to.
  const tableTerms = new Map<string, string[]>();
  for (const [term, ids] of Object.entries(world.loreIndex.terms)) {
    const hit = said(term);
    if (hit) for (const id of listOf(ids)) tableTerms.set(id, [...(tableTerms.get(id) ?? []), hit]);
  }
  // Topics asked for by id or label, or whose label the query says; activation reads names alone.
  const topics = new Set((q.topics ?? []).map(topicIdOf).filter((t) => t !== ""));
  if (!q.exact) {
    for (const [id, topic] of Object.entries(world.loreIndex.topics)) if (isRecord(topic) && said(topic.label)) topics.add(id);
    for (const entry of Object.values(world.lore)) for (const label of listOf(entry.topics)) if (said(label)) topics.add(topicIdOf(label));
  }
  const members = new Map([...topics].map((t) => [t, new Set(topicMembers(world, t))]));
  const links = new Set(q.exact ? [] : (q.links ?? []));
  const words = q.exact ? [] : [...new Set(wordsOf(q.query ?? ""))];
  const ranked: { id: string; entry: LoreEntryDef; key: number[]; why: string[] }[] = [];
  for (const [id, entry] of Object.entries(world.lore)) {
    if (!loreReadable(reg, world, state, entry, q.purpose, q.effects === true, open, q.as)) continue;
    const terms = new Set(tableTerms.get(id) ?? []);
    for (const name of [entry.title, ...listOf(entry.aliases), ...listOf(entry.keys)]) {
      const hit = said(name);
      if (hit) terms.add(hit);
    }
    const linked = listOf(entry.links).filter((l) => links.has(l));
    const inTopics = [...topics].filter((t) => members.get(t)?.has(id) === true).sort();
    let tf = 0;
    if (words.length > 0) {
      const counts = new Map<string, number>();
      for (const w of wordsOf([entry.title, ...listOf(entry.aliases), ...listOf(entry.keys), entry.content].join(" "))) counts.set(w, (counts.get(w) ?? 0) + 1);
      for (const w of words) tf += Math.min(WORD_CAP, counts.get(w) ?? 0);
    }
    if (q.exact ? terms.size === 0 : terms.size + linked.length + inTopics.length + tf === 0) continue;
    const priority = typeof entry.priority === "number" && Number.isFinite(entry.priority) ? entry.priority : 0;
    const why = [...[...terms].sort().map((t) => `term:${t}`), ...linked.map((l) => `link:${l}`), ...inTopics.map((t) => `topic:${t}`), ...(tf > 0 ? ["words"] : [])];
    ranked.push({ id, entry, key: [terms.size, linked.length, inTopics.length, tf, priority], why });
  }
  ranked.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const d = (b.key[i] ?? 0) - (a.key[i] ?? 0);
      if (d !== 0) return d;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Entries sharing a group are alternatives: the best of them stands for the group.
  const groups = new Set<string>();
  const best = ranked.filter(({ entry }) => {
    const g = typeof entry.group === "string" ? entry.group.trim() : "";
    if (g === "") return true;
    if (groups.has(g)) return false;
    groups.add(g);
    return true;
  });
  const hits: LoreHit[] = [];
  let left = Math.max(0, Math.floor(q.tokenBudget));
  for (const { id, entry, why } of best) {
    if (q.limit !== undefined && hits.length >= q.limit) break;
    if (q.skip?.has(id)) continue;
    const snippet = loreSnippet((text) => r.tokens(text), entry, left);
    if (!snippet) break;
    left -= snippet.tokens;
    hits.push({ id, title: typeof entry.title === "string" ? entry.title : id, snippet: snippet.text, tokens: snippet.tokens, cut: snippet.cut, secret: loreIsSecret(entry) && !open(entry), why });
  }
  return { hits, matched: best.length, secret: best.filter(({ entry }) => loreIsSecret(entry) && !open(entry)).length };
}

/** `lore.get`: one entry `purpose` may read, cut to the budget; null when it can't read it, or it doesn't exist or fit. */
export function loreGet(r: LoreReader, id: string, purpose: LorePurpose, tokenBudget: number, effects = false): LoreHit | null {
  const entry = hasOwn(r.world.lore, id) ? r.world.lore[id] : undefined;
  const open = loreGateReader(r.reg, r.world, r.state);
  if (!entry || !loreReadable(r.reg, r.world, r.state, entry, purpose, effects, open)) return null;
  const snippet = loreSnippet((text) => r.tokens(text), entry, Math.max(0, Math.floor(tokenBudget)));
  if (!snippet) return null;
  return { id, title: typeof entry.title === "string" ? entry.title : id, snippet: snippet.text, tokens: snippet.tokens, cut: snippet.cut, secret: loreIsSecret(entry) && !open(entry), why: [] };
}

/** `lore.list`: the entries `purpose` may read under a topic (by id or label): the table's order, then those naming it, by id. */
export function loreList(r: LoreReader, topic: string, purpose: LorePurpose, effects = false): { id: string; title: string }[] {
  const open = loreGateReader(r.reg, r.world, r.state);
  const out: { id: string; title: string }[] = [];
  for (const id of topicMembers(r.world, topicIdOf(topic))) {
    const entry = r.world.lore[id];
    if (entry && loreReadable(r.reg, r.world, r.state, entry, purpose, effects, open)) out.push({ id, title: typeof entry.title === "string" ? entry.title : id });
  }
  return out;
}
