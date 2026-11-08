// LumiBooks as the bootstrap's starting evidence (DEPTH-PLAN Round 2 item 1). The chat's LumiBooks
// book is found the way the import finds it (`import.ts`): LumiBooks' shelf marked with the chat
// (`lumibooks_chat_id`) or named by it (`lumibooks_book_id`), and its summaries lorebook, which keeps
// a hash of every message it summarized (`lumibooks_summary`, `sha256(JSON.stringify([role,
// content]))`, role `user` or `assistant`). Its entries are read as the tree LumiBooks keeps
// (volumes, arcs and chapters, each with the messages it spans), each message's coverage is checked
// against its hash, and every entry lands, with no model call, as an imported record (`story.record`)
// at the last message it spans. Its format is evidence only: canon going forward is LRE's beats,
// minds and notebook. A node read deeply has its record replaced by beats (`deep`); a stretch the run
// read past is `read`.

import type { ChatId, EntityId, MessageId, UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";
import type { JsonObject } from "../../shared/json";
import type { Basis, LayerDraft, LayerSummary } from "../../shared/layer";
import type { LbActionEstimate, LbCast, LbCoverage, LbLevel, LbNode, LbTree } from "../../shared/bootstrap";
import { STORY_BEAT } from "../../shared/story";
import { recordEvent, STORY_RECORD, type StoryRecord } from "../../shared/story-record";
import { blobHash } from "../../shared/stores";
import { hashParts } from "../../shared/hash";
import { layerEntryId } from "../../engine/ledger/layer";
import type { HostPort } from "../host";

/** One LumiBooks entry as the bootstrap reads it. */
export interface LbRecord {
  /** The entry's id in its book (`uid` in an export). */
  id: string;
  level: LbLevel;
  title: string;
  /** The messages it spans, by index from 0, inclusive. */
  range: [number, number];
  text: string;
  keys: string[];
  /** LumiBooks rolled it into an entry of a higher tier (`supersededByEntryId`); it stays in the tree, under that entry. */
  superseded: boolean;
  /** The ids of the messages it spans, where LumiBooks kept them (its shelf does; its summaries lorebook keeps hashes instead). */
  msgIds: string[];
}

/** LumiBooks' hash of one message, by its index from 0. */
export interface LbHash {
  index: number;
  hash: string;
}

export interface LbBook {
  id: string;
  name: string;
  records: LbRecord[];
  hashes: LbHash[];
}

/** A message as its hash is taken: who wrote it and its text. */
export interface LbMessage {
  id: MessageId;
  isUser: boolean;
  content: string;
}

export type MessageCover = "covered" | "changed" | "uncovered";

/** The hashing LumiBooks names in its summaries lorebook; any other is not read. */
const ALGORITHM = "sha256-role-content-v1";
const RANK: Readonly<Record<LbLevel, number>> = { chapter: 1, arc: 2, volume: 3 };
/** The chat's numbers in an entry's comment (`#4 - The Long Road (msgs 31-40)`), from 1: only where the entry keeps no indices. */
const MSGS = /\bmsgs?\s+(\d+)\s*[-–]\s*(\d+)/i;
const SHA256 = /^[0-9a-f]{64}$/;
/** Keys a record keeps, of the many an entry may have. */
const MOST_KEYS = 30;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function words(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && k.trim() !== "") : [];
}

function index(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function levelOf(tier: unknown, comment: string): LbLevel | null {
  if (typeof tier === "number" && Number.isInteger(tier) && tier >= 1) return tier >= 3 ? "volume" : tier === 2 ? "arc" : "chapter";
  if (/^vol/i.test(comment)) return "volume";
  if (/^arc\b/i.test(comment)) return "arc";
  return /^#\d/.test(comment) ? "chapter" : null;
}

/** The messages an entry spans: the indices its summaries lorebook keeps, else its shelf's first and last, else its comment's numbers. */
function rangeOf(ext: Readonly<Record<string, unknown>>, comment: string): [number, number] | null {
  const summary = isRecord(ext.lumibooks_summary) ? ext.lumibooks_summary : {};
  const indices = Array.isArray(summary.messageIndices) ? summary.messageIndices.flatMap((n) => (index(n) === null ? [] : [n as number])) : [];
  if (indices.length > 0) return [indices.reduce((a, b) => Math.min(a, b)), indices.reduce((a, b) => Math.max(a, b))];
  const own = isRecord(ext.lumibooks) ? ext.lumibooks : {};
  const first = index(own.firstMsgIdx);
  const last = index(own.lastMsgIdx);
  if (first !== null && last !== null && first <= last) return [first, last];
  const m = MSGS.exec(comment);
  if (!m) return null;
  const a = Number(m[1]) - 1;
  const b = Number(m[2]) - 1;
  return a >= 0 && a <= b ? [a, b] : null;
}

/** One entry, as the host lists it (`keys`, `id`) or as LumiBooks exports it (`key`, `uid`); null for an entry that is no part of the tree. */
export function lbRecordOf(raw: unknown, fallbackId: string): LbRecord | null {
  if (!isRecord(raw)) return null;
  const ext = isRecord(raw.extensions) ? raw.extensions : {};
  const comment = str(raw.comment).trim();
  const text = str(raw.content).trim();
  if (text === "") return null;
  const own = isRecord(ext.lumibooks) ? ext.lumibooks : {};
  const summary = isRecord(ext.lumibooks_summary) ? ext.lumibooks_summary : {};
  const level = levelOf(summary.tier ?? own.tier, comment);
  const range = rangeOf(ext, comment);
  if (level === null || range === null) return null;
  const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : typeof raw.uid === "string" || typeof raw.uid === "number" ? String(raw.uid) : fallbackId;
  return { id, level, title: comment || str(own.title).trim() || "(untitled)", range, text, keys: words(raw.keys ?? raw.key).slice(0, MOST_KEYS), superseded: str(own.supersededByEntryId) !== "", msgIds: words(own.msgIds) };
}

/** The per-message hashes a summaries lorebook keeps (its `lumibooks_summary`, top-level in an export, in the book's metadata once imported). */
export function lbHashesOf(meta: unknown): LbHash[] {
  if (!isRecord(meta)) return [];
  const s = isRecord(meta.lumibooks_summary) ? meta.lumibooks_summary : isRecord(meta.extensions) && isRecord(meta.extensions.lumibooks_summary) ? meta.extensions.lumibooks_summary : null;
  if (!s || s.algorithm !== ALGORITHM || !Array.isArray(s.messages)) return [];
  return s.messages.flatMap((m) => (isRecord(m) && index(m.index) !== null && typeof m.hash === "string" && SHA256.test(m.hash) ? [{ index: m.index as number, hash: m.hash }] : []));
}

function parsed(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** A book as LumiBooks exports it (a summaries lorebook, or its shelf as a Lumiverse world book): entries as a list or by uid. */
export function lbBookOfExport(raw: unknown, id: string): LbBook | null {
  if (!isRecord(raw)) return null;
  const list = Array.isArray(raw.entries) ? raw.entries : isRecord(raw.entries) ? Object.values(raw.entries) : [];
  const records = list.flatMap((e, i) => {
    const r = lbRecordOf(e, String(i));
    return r ? [r] : [];
  });
  const hashes = lbHashesOf({ extensions: raw.extensions });
  return { id, name: str(raw.name) || id, records, hashes: hashes.length > 0 ? hashes : lbHashesOf(parsed(raw.metadata)) };
}

/** LumiBooks' hash of a message: `sha256(JSON.stringify([role, content]))`, role `user` or `assistant`, in hex. */
export async function lbMessageHash(isUser: boolean, content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([isUser ? "user" : "assistant", content])));
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Each message's coverage: `covered` where LumiBooks' hash of it matches (or, on a shelf that keeps
 * ids and no hashes, where an entry names it; on a book keeping neither, where an entry spans it),
 * `changed` where its hash no longer matches, `uncovered` where nothing of the book reaches it.
 */
export async function lbCoverOf(book: Pick<LbBook, "records" | "hashes">, messages: readonly LbMessage[]): Promise<MessageCover[]> {
  const hashed = new Map(book.hashes.map((h) => [h.index, h.hash]));
  const named = new Set(book.records.flatMap((r) => r.msgIds));
  const spanned = (i: number): boolean => book.records.some((r) => r.range[0] <= i && i <= r.range[1]);
  const out: MessageCover[] = [];
  for (const [i, m] of messages.entries()) {
    const want = hashed.get(i);
    if (want !== undefined) out.push((await lbMessageHash(m.isUser, m.content)) === want ? "covered" : "changed");
    else if (named.has(m.id)) out.push("covered");
    else out.push(hashed.size === 0 && named.size === 0 && spanned(i) ? "covered" : "uncovered");
  }
  return out;
}

/** The runs of messages whose coverage is one of `which`, by index from 0, inclusive. */
export function lbRuns(cover: readonly MessageCover[], which: ReadonlySet<MessageCover>): [number, number][] {
  const runs: [number, number][] = [];
  for (const [i, c] of cover.entries()) {
    if (!which.has(c)) continue;
    const last = runs.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

/** Each entry's parent in the tree: the narrowest entry of a higher tier spanning all of it. */
export function lbParents(records: readonly LbRecord[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const r of records) {
    let best: LbRecord | null = null;
    for (const q of records) {
      if (RANK[q.level] <= RANK[r.level] || q.range[0] > r.range[0] || q.range[1] < r.range[1]) continue;
      if (!best || q.range[1] - q.range[0] < best.range[1] - best.range[0] || (q.range[1] - q.range[0] === best.range[1] - best.range[0] && RANK[q.level] < RANK[best.level])) best = q;
    }
    if (best) parents.set(r.id, best.id);
  }
  return parents;
}

/** What the user's deepening left on the book's nodes: who caught up on each, and whose full mind each built. */
export interface LbMarks {
  caughtUp: Record<string, EntityId[]>;
  fullMind: Record<string, EntityId[]>;
}

export function isLbMarks(raw: unknown): raw is LbMarks {
  const lists = (v: unknown): boolean => isRecord(v) && Object.values(v).every((l) => Array.isArray(l) && l.every((s) => typeof s === "string"));
  return isRecord(raw) && lists(raw.caughtUp) && lists(raw.fullMind);
}

/** How the chat's layer stands against the book: entries read deeply (their record superseded by beats), and the last message the run's read reached. */
export interface LbProgress {
  deep: ReadonlySet<string>;
  readThrough: number;
}

/** The tree's nodes, each with its coverage and children, in the chat's order. */
export function lbNodes(records: readonly LbRecord[], cover: readonly MessageCover[], marks: LbMarks, progress: LbProgress): LbNode[] {
  const parents = lbParents(records);
  const nodes = new Map<string, LbNode>();
  const ordered = [...records].sort((a, b) => a.range[0] - b.range[0] || RANK[b.level] - RANK[a.level] || a.range[1] - b.range[1]);
  for (const r of ordered) {
    let changed = 0;
    let uncovered = 0;
    for (let i = r.range[0]; i <= r.range[1]; i++) {
      // A message past the chat's end is one the record describes and the chat no longer holds.
      const c = i < cover.length ? cover[i] : "changed";
      if (c === "changed") changed++;
      else if (c === "uncovered") uncovered++;
    }
    const coverage: LbCoverage = progress.deep.has(r.id) ? "deep" : progress.readThrough >= r.range[1] ? "read" : changed > 0 ? "changed" : uncovered > 0 ? "uncovered" : "covered";
    nodes.set(r.id, { id: r.id, level: r.level, title: r.title, range: [...r.range], coverage, changed, caughtUp: [...(marks.caughtUp[r.id] ?? [])], fullMind: [...(marks.fullMind[r.id] ?? [])], children: [] });
  }
  const roots: LbNode[] = [];
  for (const r of ordered) {
    const node = nodes.get(r.id) as LbNode;
    const parent = parents.get(r.id);
    const holder = parent === undefined ? undefined : nodes.get(parent);
    if (holder) holder.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** The job each record lands under: a changed entry lands again under the same job, superseding what it landed before. */
export function lbJob(entry: string): string {
  return `lumibooks:${entry}`;
}

/**
 * The records to land, with no model call: one entry per book entry, at the last message it spans
 * that the chat still holds, citing its range; one whose text, title or range changed supersedes
 * what landed for it before, and what landed for an entry the book no longer has is superseded.
 */
export function lbDrafts(chatId: ChatId, book: Pick<LbBook, "records">, chain: readonly Basis[], landed: readonly LayerSummary[]): { drafts: LayerDraft[]; blobs: Record<string, string> } {
  const blobs: Record<string, string> = {};
  const drafts: LayerDraft[] = [];
  const parents = lbParents(book.records);
  const superseded = new Set(landed.flatMap((s) => s.supersedes ?? []));
  const live = landed.filter((s) => s.kind === STORY_RECORD && !superseded.has(s.id) && typeof s.by?.job === "string" && s.by.job.startsWith("lumibooks:"));
  const kept = new Set<string>();
  for (const r of book.records) {
    const last = Math.min(r.range[1], chain.length - 1);
    if (r.range[0] > last) continue;
    const from = chain[r.range[0]] as Basis;
    const to = chain[last] as Basis;
    const text = blobHash(r.text);
    blobs[text] = r.text;
    const parent = parents.get(r.id);
    const record: StoryRecord = { source: "lumibooks", entry: r.id, level: r.level, title: r.title, range: [r.range[0], last], from: from.message, to: to.message, text, keys: r.keys, ...(parent ? { parent } : {}) };
    const id = layerEntryId("bootstrap", chatId, "lumibooks", r.id, hashParts("lumibooks.record", r.level, r.title, text, String(r.range[0]), String(last), from.message, to.message, parent ?? "", ...r.keys));
    const job = lbJob(r.id);
    kept.add(job);
    const before = live.filter((s) => s.by?.job === job && s.id !== id).map((s) => s.id);
    drafts.push({ id, basis: to, kind: STORY_RECORD, events: [recordEvent(record)], ...(before.length > 0 ? { supersedes: before } : {}), by: { role: "import", job } });
  }
  const gone = live.filter((s) => !kept.has(s.by?.job ?? "")).map((s) => s.id);
  const end = chain.at(-1);
  if (gone.length > 0 && end) drafts.push({ id: layerEntryId("bootstrap", chatId, "lumibooks", "gone", ...gone), basis: end, kind: STORY_RECORD, events: [], supersedes: gone, by: { role: "import", job: "lumibooks" } });
  return { drafts, blobs };
}

/** How the layer stands against the book: records superseded by beats (read deeply), and how far the run's beats reach. */
export function lbProgressOf(landed: readonly LayerSummary[], chain: readonly Basis[]): LbProgress {
  const at = new Map(chain.map((b, i) => [b.message, i]));
  const records = new Map(landed.filter((s) => s.kind === STORY_RECORD && typeof s.by?.job === "string" && s.by.job.startsWith("lumibooks:")).map((s) => [s.id, (s.by?.job ?? "").slice("lumibooks:".length)]));
  const deep = new Set<string>();
  let readThrough = -1;
  for (const s of landed) {
    if (s.kind !== STORY_BEAT) continue;
    for (const id of s.supersedes ?? []) {
      const entry = records.get(id);
      if (entry !== undefined) deep.add(entry);
    }
    if (s.by?.role === "historian") readThrough = Math.max(readThrough, at.get(s.basis.message) ?? -1);
  }
  return { deep, readThrough };
}

// ---------------------------------------------------------------- the chat's book

/** Whether a book is LumiBooks' shelf for this chat: marked with it, or named by it (the codex is lore, never the tree). */
function shelfFor(book: { id: string; metadata: JsonObject }, chatId: ChatId, chat: JsonObject): boolean {
  return book.metadata.lumibooks_chat_id === chatId || book.id === chat.lumibooks_book_id;
}

/**
 * The chat's LumiBooks book: its shelf's entries, and the hashes of its summaries lorebook, the one
 * whose hashes match this chat's messages (where its shelf is gone, the lorebook's entries too); null
 * when the chat has neither.
 */
export async function findLumiBooks(host: Pick<HostPort, "books" | "chats">, chatId: ChatId, userId: UserId, messages: readonly LbMessage[]): Promise<LbBook | null> {
  const chat = await host.chats.chatMetadata(chatId, userId);
  const all = await host.books.list(userId);
  const shelf = all.find((b) => shelfFor(b, chatId, chat));
  let lorebook: LbBook | null = null;
  let best = 0;
  for (const b of all) {
    const hashes = lbHashesOf(b.metadata);
    if (hashes.length === 0 || b.id === shelf?.id) continue;
    const covered = (await lbCoverOf({ records: [], hashes }, messages)).filter((c) => c === "covered").length;
    if (covered <= best) continue;
    best = covered;
    lorebook = { id: b.id, name: b.name, records: [], hashes };
  }
  const recordsOf = async (id: string): Promise<LbRecord[]> => (await host.books.entries(id, userId)).flatMap((e) => lbRecordOf(e, e.id) ?? []);
  if (shelf) return { id: shelf.id, name: shelf.name, records: await recordsOf(shelf.id), hashes: lorebook?.hashes ?? lbHashesOf(shelf.metadata) };
  return lorebook ? { ...lorebook, records: await recordsOf(lorebook.id) } : null;
}

/** The tree the user deepens from (GM → Depth → Bootstrap). */
export function lbTreeOf(chatId: ChatId, book: LbBook | null, cover: readonly MessageCover[], cast: readonly LbCast[], marks: LbMarks, progress: LbProgress): LbTree {
  if (!book) return { chatId, book: null, nodes: [], cast: [...cast], uncovered: lbRuns(cover, new Set(["uncovered"])) };
  return { chatId, book: book.name, nodes: lbNodes(book.records, cover, marks, progress), cast: [...cast], uncovered: lbRuns(cover, new Set(["uncovered"])) };
}

// ---------------------------------------------------------------- estimates

/** First guesses, as the bootstrap's own estimate makes them before anything ran (`estimate.ts`). */
const READ_TPS = 4000;
const WRITE_TPS = 60;
/** What a character's catch-up reads besides the stretch (its core, its mind's files) and writes. */
const CATCHUP_IN = 9000;
const CATCHUP_OUT = 1800;

/** Tokens of text, as the spool counts them. */
function tokensOf(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimate(calls: number, tokensIn: number, tokensOut: number, notes: string[]): LbActionEstimate {
  return { calls, tokens: Math.round(tokensIn + tokensOut), cost: null, ms: Math.round((tokensIn / READ_TPS + tokensOut / WRITE_TPS) * 1000), notes: [...notes, "Money isn't shown until this chat's own runs have priced the connection; the token counts stand."] };
}

/** What a deepening of `range` would take: a catch-up for each of `who` from the node's record; a deep read of its messages in chunks; a character's full mind from every chapter it spans. */
export function lbEstimate(kind: "catchup" | "deep" | "fullmind", range: [number, number], messages: readonly LbMessage[], recordText: string, who: number, chunkTokens: number): LbActionEstimate {
  const stretch = messages.slice(range[0], range[1] + 1).reduce((n, m) => n + tokensOf(m.content), 0);
  const chunks = Math.max(1, Math.ceil(stretch / Math.max(1, chunkTokens)));
  const span = `messages ${range[0] + 1}–${range[1] + 1}`;
  switch (kind) {
    case "catchup":
      return estimate(who, who * (tokensOf(recordText) + CATCHUP_IN), who * CATCHUP_OUT, [`One catch-up per character from the record of ${span}.`]);
    case "deep":
      // The historian and the author per chunk, as the full read does.
      return estimate(chunks * 2, stretch * 2.3 + chunks * 14000, stretch * 0.15 + chunks * 1000, [`A full read of ${span} in ${chunks} chunk${chunks === 1 ? "" : "s"}; its beats replace the record.`]);
    case "fullmind":
      return estimate(chunks, stretch + chunks * CATCHUP_IN, chunks * CATCHUP_OUT, [`The character lives ${span} chunk by chunk (${chunks}).`]);
  }
}
