// What today's build held of a chat turn by turn, for the chats a run imports: each imported turn
// with the record today's build kept for its swipe (`imported_record`, beside the turn), ancestors
// first; and the chat's area as each turn left it (STANDALONE-PLAN §15.2: the mind files "per turn",
// the Author's notes "versioned by turn"). A turn the harness engine played names its generations in
// its record (`RecHarness.turns`, the reply's and then each Continue's), and LumiAH kept the chat's
// area as each generation left it (`chats/<chat>/area/<generation>.json`, `root` before any turn;
// `H/core/paths.ts:21`), a head naming an index blob that names each file's body
// (`H/core/workspace.ts:41-53`). A turn's files are the area of its latest generation; a turn no
// generation played holds the files of the turn before it.

import type { Database } from "bun:sqlite";
import { recHarnessOf } from "../backend/harness/record";
import { isRecord } from "../shared/json";
import type { Rec } from "../shared/ledger";
import type { TurnRow, UserStore } from "../store";
import { areaFiles, areaHead } from "./inside";
import type { Item } from "./report";
import type { Today } from "./today";

/** An id as one part of a LumiAH document's path (`docKey`, `H/core/paths.ts:12`). */
export function docKey(id: string): string {
  return encodeURIComponent(id).replace(/\./g, "%2E");
}

/** The area documents of a chat's own area, by the chat's and the generation's keys (`root`: before any turn). */
export const AREA_DOC = /^harness\/docs\/chats\/([^/]+)\/area\/([^/]+)\.json$/;

/** Where LumiAH kept a chat's area as a generation left it. */
export function areaDoc(chat: string, generation: string): string {
  return `harness/docs/chats/${docKey(chat)}/area/${docKey(generation)}.json`;
}

/** The area documents `items` carry or attach: a chat's documents LumiAH was told to forget, or kept for a chat gone from Lumiverse, are archived and never read. */
export function carriedAreas(items: readonly Item[]): Set<string> {
  return new Set(items.filter((i) => i.where === "user storage" && (i.fate === "carried" || i.fate === "attached") && AREA_DOC.test(i.path)).map((i) => i.path));
}

/** One file of an area: its path there, the SHA-256 of its text as LumiAH names its body, and the text. */
export interface AreaFile {
  path: string;
  hash: string;
  text: string;
}

function json(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const blob = (hash: string): string => `harness/blobs/${hash.slice(0, 2)}/${hash}`;

/** An area as its head holds it: when it was written and each file; null where it doesn't read, or names an index today's clean-up removed. A body that is gone is left out. */
export async function areaOf(today: Today, doc: string): Promise<{ at: number; files: AreaFile[] } | null> {
  const text = await today.userView.read(doc);
  const head = areaHead(text);
  if (head === undefined) return null;
  const raw = json(text);
  const at = isRecord(raw) && typeof raw.at === "number" ? raw.at : 0;
  if (head === null) return { at, files: [] };
  const index = areaFiles(await today.userView.read(blob(head)));
  if (index === null) return null;
  const files: AreaFile[] = [];
  for (const f of index) {
    const body = await today.userView.read(blob(f.hash));
    if (body !== null) files.push({ path: f.path, hash: f.hash, text: body });
  }
  return { at, files };
}

/** A turn the run imported, with today's record of its swipe. */
export interface ImportedTurn {
  turn: TurnRow;
  message: string;
  swipe: number;
  record: Rec;
}

/** The latest generation that played a record: the one whose area holds what its swipe left; null for a reply no turn of the harness engine played. */
export function generationOf(record: Rec): string | null {
  return recHarnessOf(record)?.turns.at(-1) ?? null;
}

/** Today's record of an imported turn's swipe, as the import kept it beside the turn; null for a turn that holds none. */
function recordOf(db: Database, user: string, turn: string): Rec | null {
  const row = db.query<{ record: string }, [string, string]>("SELECT record FROM imported_record WHERE user = ? AND turn = ?").get(user, turn);
  return row === null ? null : (JSON.parse(row.record) as Rec);
}

/** The turns the store holds of a chat's import, each with today's record of its swipe, ancestors first. */
export function importedTurns(db: Database, s: UserStore, chat: string): ImportedTurn[] {
  const rows = db.query<{ turn: string; message: string; swipe: number; record: string }, [string, string]>("SELECT turn, message, swipe, record FROM imported_record WHERE user = ? AND chat = ?").all(s.id, chat);
  const out = rows.flatMap((r) => {
    const turn = s.turn(r.turn);
    return turn === null ? [] : [{ turn, message: r.message, swipe: r.swipe, record: JSON.parse(r.record) as Rec }];
  });
  return out.sort((a, b) => a.turn.depth - b.turn.depth || a.turn.created - b.turn.created || a.swipe - b.swipe);
}

/** A file a turn changed: its text as the turn left it, or null where the turn removed it. */
export interface AreaChange {
  path: string;
  now: AreaFile | null;
}

/**
 * The chat's area at each imported turn, each area read once: a turn's own where a generation played
 * it and its document is carried and reads; else that of the nearest turn before it on its path that
 * has one; none before the first. Only documents `carried` names are read.
 */
export class TurnAreas {
  private readonly own = new Map<string, Map<string, AreaFile> | null>();
  /** The area documents an imported turn's own area was read from. */
  readonly tied = new Set<string>();

  constructor(
    private readonly today: Today,
    private readonly db: Database,
    private readonly s: UserStore,
    private readonly carried: ReadonlySet<string>,
  ) {}

  /** A turn's own area, by path: what its latest generation left; null where no generation played it, or its document isn't carried or doesn't read. */
  async ownArea(turn: TurnRow): Promise<Map<string, AreaFile> | null> {
    if (this.own.has(turn.id)) return this.own.get(turn.id) ?? null;
    const record = recordOf(this.db, this.s.id, turn.id);
    const generation = record === null ? null : generationOf(record);
    const doc = generation === null ? null : areaDoc(turn.chat, generation);
    const area = doc === null || !this.carried.has(doc) ? null : await areaOf(this.today, doc);
    const files = area === null ? null : new Map(area.files.map((f) => [f.path, f]));
    if (files !== null && doc !== null) this.tied.add(doc);
    this.own.set(turn.id, files);
    return files;
  }

  /** The files a turn's path held before it: the own area of the nearest turn before it that has one; none before the first. */
  async before(turn: TurnRow): Promise<Map<string, AreaFile>> {
    const seen = new Set<string>();
    for (let at = turn.parent; at !== null && !seen.has(at); ) {
      seen.add(at);
      const earlier = this.s.turn(at);
      if (earlier === null) break;
      const files = await this.ownArea(earlier);
      if (files !== null) return files;
      at = earlier.parent;
    }
    return new Map();
  }

  /** What a turn changed of the files `which` names, against the turn before it on its path; null where it has no area of its own. */
  async changesAt(turn: TurnRow, which: (path: string) => boolean): Promise<AreaChange[] | null> {
    const now = await this.ownArea(turn);
    if (now === null) return null;
    const was = await this.before(turn);
    const out: AreaChange[] = [];
    for (const [path, file] of now) if (which(path) && was.get(path)?.hash !== file.hash) out.push({ path, now: file });
    for (const path of was.keys()) if (which(path) && !now.has(path)) out.push({ path, now: null });
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}
