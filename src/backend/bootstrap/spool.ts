// The survey and the spool (DEPTH-PLAN §8.1 step 1, §8.5). The survey reads the chat's active path
// once and spools it: per message its shown text (the message cache keeps no reasoning), its swipe's
// identity and basis on the chain, its story time where LRE's ledger has one, and its length; then
// cuts it into chunks of whole messages under the token bound, a file per chunk. Every job reads its
// chunk from the spool, never the whole chat. Chunk boundaries are kept across surveys (a rerun, a
// resume, messages sent meanwhile), so a chunk keeps its number and, while its messages and their
// swipes are unchanged, its key: the key every job of the chunk is made from (§8.4).

import type { MessageId } from "../../shared/ids";
import type { Basis } from "../../shared/layer";
import { hashParts } from "../../shared/hash";
import { tokensOf } from "../book";
import type { BootstrapFiles } from "./files";

/** One message of the active path as the bootstrap reads it. */
export interface SpoolRow {
  id: MessageId;
  /** Its place on the active path, 0-based. */
  index: number;
  isUser: boolean;
  name: string;
  /** The shown swipe's text. */
  text: string;
  /** Its basis on the chain: the message, its swipe's identity and the path before it. */
  basis: Basis;
  /** The story minute after its turn, where the chat's ledger has one; null otherwise. */
  clock: number | null;
  tokens: number;
  /** How many swipes the message has, and which one is shown: the player's choices, for the author's read of what he wants. */
  swipes?: number;
  swipe?: number;
}

/** A chunk as the manifest lists it; its rows are in its own file. */
export interface ChunkInfo {
  n: number;
  /** The chunk's identity: its messages and their swipes, in order. */
  key: string;
  first: MessageId;
  last: MessageId;
  firstIndex: number;
  lastIndex: number;
  /** The basis of its last message: what a job that read the whole chunk is anchored at. */
  basis: Basis;
  messages: number;
  tokens: number;
  words: number;
}

export interface SpoolManifest {
  version: 1;
  surveyedAt: number;
  /** The token bound the chunks were cut under. */
  bound: number;
  chunks: ChunkInfo[];
  totals: { messages: number; tokens: number; words: number; user: number; assistant: number };
}

export function isManifest(raw: unknown): raw is SpoolManifest {
  return typeof raw === "object" && raw !== null && "version" in raw && raw.version === 1 && "chunks" in raw && Array.isArray(raw.chunks);
}

function isRows(raw: unknown): raw is SpoolRow[] {
  return Array.isArray(raw) && raw.every((r: unknown) => typeof r === "object" && r !== null && "id" in r && typeof r.id === "string" && "text" in r && typeof r.text === "string");
}

export const MANIFEST = "manifest.json";

export function chunkFile(n: number): string {
  return `spool/${String(n).padStart(5, "0")}.json`;
}

const WORD = /\S+/g;

/** What a survey reads: the chain as the chat shows it, one entry per message in order. */
export interface SurveyMessage {
  id: MessageId;
  isUser: boolean;
  name: string;
  text: string;
  basis: Basis;
  clock: number | null;
  swipes?: number;
  swipe?: number;
}

/**
 * Cuts rows into chunks of whole messages under `bound` tokens. A message longer than the bound is a
 * chunk of its own; a chunk never ends on a player's message whose reply would start the next one,
 * so an exchange stays together (unless the pair alone is over the bound).
 */
export function cutChunks(rows: readonly SpoolRow[], bound: number): SpoolRow[][] {
  const out: SpoolRow[][] = [];
  let cur: SpoolRow[] = [];
  let size = 0;
  for (const row of rows) {
    if (cur.length > 0 && size + row.tokens > bound) {
      const last = cur.at(-1);
      // Carry a trailing player message over to the reply it waits for.
      const carry = last && last.isUser && !row.isUser && cur.length > 1 ? cur.pop() : undefined;
      out.push(cur);
      cur = carry ? [carry] : [];
      size = carry ? carry.tokens : 0;
    }
    cur.push(row);
    size += row.tokens;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function info(n: number, rows: readonly SpoolRow[]): ChunkInfo {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) throw new Error("an empty chunk");
  return {
    n,
    key: hashParts("bootstrap.chunk", ...rows.flatMap((r) => [r.id, r.basis.swipe])),
    first: first.id,
    last: last.id,
    firstIndex: first.index,
    lastIndex: last.index,
    basis: last.basis,
    messages: rows.length,
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
    words: rows.reduce((s, r) => s + (r.text.match(WORD)?.length ?? 0), 0),
  };
}

/**
 * Chunks the path, keeping the earlier survey's boundaries: each earlier chunk whose messages are
 * still the next ones on the path, in order, stays as it was (its key follows their swipes); from the
 * first that isn't, the rest is cut afresh.
 */
export function planChunks(rows: readonly SpoolRow[], bound: number, previous: SpoolManifest | null): SpoolRow[][] {
  const out: SpoolRow[][] = [];
  let at = 0;
  for (const chunk of previous?.chunks ?? []) {
    const end = at + chunk.messages;
    const slice = rows.slice(at, end);
    if (slice.length !== chunk.messages || slice[0]?.id !== chunk.first || slice.at(-1)?.id !== chunk.last) break;
    out.push(slice);
    at = end;
  }
  return [...out, ...cutChunks(rows.slice(at), bound)];
}

/**
 * Surveys the path and writes the spool: the manifest, and each chunk's rows where they changed. The
 * messages are dropped once spooled; the manifest comes back.
 */
export async function survey(files: BootstrapFiles, messages: readonly SurveyMessage[], bound: number, now: number): Promise<SpoolManifest> {
  const previous = await files.read(MANIFEST, isManifest);
  const rows: SpoolRow[] = messages.map((m, index) => ({ id: m.id, index, isUser: m.isUser, name: m.name, text: m.text, basis: m.basis, clock: m.clock, tokens: tokensOf(m.text), ...(m.swipes !== undefined && m.swipes > 1 ? { swipes: m.swipes, swipe: m.swipe ?? 0 } : {}) }));
  const planned = planChunks(rows, Math.max(1000, bound), previous);
  const chunks = planned.map((r, n) => info(n, r));
  const before = new Map((previous?.chunks ?? []).map((c) => [c.n, c.key]));
  for (const [n, chunk] of chunks.entries()) {
    const rowsOf = planned[n];
    if (!rowsOf) continue;
    if (before.get(n) === chunk.key && (await files.read(chunkFile(n), isRows)) !== null) continue;
    await files.write(chunkFile(n), rowsOf);
  }
  // A shorter path leaves no stale chunk file behind.
  for (let n = chunks.length; n < (previous?.chunks.length ?? 0); n++) await files.remove(chunkFile(n));
  const manifest: SpoolManifest = {
    version: 1,
    surveyedAt: now,
    bound,
    chunks,
    totals: {
      messages: rows.length,
      tokens: rows.reduce((s, r) => s + r.tokens, 0),
      words: chunks.reduce((s, c) => s + c.words, 0),
      user: rows.filter((r) => r.isUser).length,
      assistant: rows.filter((r) => !r.isUser).length,
    },
  };
  await files.write(MANIFEST, manifest);
  return manifest;
}

/** One chunk's rows from the spool; null when its file is gone (the next survey writes it again). */
export async function readChunk(files: BootstrapFiles, n: number): Promise<SpoolRow[] | null> {
  return files.read(chunkFile(n), isRows);
}
