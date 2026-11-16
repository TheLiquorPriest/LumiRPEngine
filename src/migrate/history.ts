// What today's build held of a chat turn by turn, for the chats a run imports: each imported turn
// with the record today's build kept for its swipe (`imported_record`, beside the turn), ancestors
// first; and the chat's area as each turn left it (STANDALONE-PLAN §15.2: the mind files "per turn",
// the Author's notes "versioned by turn"). A turn the harness engine played names its generations in
// its record (`RecHarness.turns`, the reply's and then each Continue's) and holds LumiAH's record of
// the last one that recorded (`RecHarness.record`). LumiAH kept the chat's area as each generation
// left it (`chats/<chat>/area/<generation>.json`, `root` before any turn; `H/core/paths.ts:21`), a
// head naming an index blob that names each file's body (`H/core/workspace.ts:41-53`), and reads a
// turn's area as `Areas.at` does (`H/core/areas.ts:106-109`): that record's generation's document,
// else the index the record names. A turn no generation played holds the files of the turn before it.

import type { Database } from "bun:sqlite";
import { recHarnessOf } from "./today/harness-record";
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

/** The chat an id in a LumiAH document's path names (`docKey` undone); null where it doesn't decode. */
export function chatOfKey(key: string): string | null {
  try {
    return decodeURIComponent(key);
  } catch {
    return null;
  }
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

/** One file of an area: its path there, the SHA-256 of its text as LumiAH names its body, the text, and the definitions it is pinned for. */
export interface AreaFile {
  path: string;
  hash: string;
  text: string;
  pins: string[];
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

/** An area as it was read: its head (null: it held no file) and each file. */
export interface Area {
  head: string | null;
  files: AreaFile[];
}

/** The files the index `head` names, each with its text: none where the area holds none (null); null where the index is gone or doesn't read. A body that is gone is left out. */
async function indexFiles(today: Today, head: string | null): Promise<AreaFile[] | null> {
  if (head === null) return [];
  const index = areaFiles(await today.userView.read(blob(head)));
  if (index === null) return null;
  const files: AreaFile[] = [];
  for (const f of index) {
    const body = await today.userView.read(blob(f.hash));
    if (body !== null) files.push({ path: f.path, hash: f.hash, text: body, pins: f.pins });
  }
  return files;
}

/** An area as its head holds it: when it was written, its head and each file; null where it doesn't read, or names an index today's clean-up removed. A body that is gone is left out. */
export async function areaOf(today: Today, doc: string): Promise<(Area & { at: number }) | null> {
  const text = await today.userView.read(doc);
  const head = areaHead(text);
  if (head === undefined) return null;
  const raw = json(text);
  const files = await indexFiles(today, head);
  return files === null ? null : { at: isRecord(raw) && typeof raw.at === "number" ? raw.at : 0, head, files };
}

/** A turn the run imported, with today's record of its swipe. */
export interface ImportedTurn {
  turn: TurnRow;
  message: string;
  swipe: number;
  record: Rec;
}

/**
 * Where LumiAH kept the area a record's swipe left: the generation whose record it holds (a
 * Continue's, where the Continue recorded; else the reply's), whose document holds the area as it
 * ended, and the index that record names, the area's head as the turn ended (`TurnRecord.workspace`,
 * `H/core/turn.ts:926-946`). LumiAH writes a generation's document only at its first file change
 * (`H/core/workspace.ts:313-330`), so a Continue that wrote no file has none, and its record's index
 * is the area it ended with. Every generation the record names, too. Null for a reply no turn of the
 * harness engine played.
 */
export function areaSource(record: Rec): { generation: string; index: string | null; generations: readonly string[] } | null {
  const harness = recHarnessOf(record);
  if (harness === null) return null;
  const own = harness.record;
  const generation = typeof own?.generationId === "string" && own.generationId !== "" ? own.generationId : (harness.turns.at(-1) ?? "");
  const index = typeof own?.workspace === "string" && own.workspace !== "" ? own.workspace : null;
  return { generation, index, generations: harness.turns };
}

/** Today's record of an imported turn's swipe, as the import kept it beside the turn; null for a turn that holds none. */
export function recordOf(db: Database, user: string, turn: string): Rec | null {
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

/** A turn of a reply on a chat's path, its own or one it shares with the chat it was branched from, with its reply's number on that path (the chat's first message counting as 0). */
export interface PathTurn extends ImportedTurn {
  at: number;
}

/**
 * Every imported turn of the replies on a chat's path, every swipe of each: its own, and for a branch
 * those it shares with the chat it was made from, which hold its history as today's branch held it
 * (`H/core/areas.ts:18-19`). Each with today's record of its swipe, in the path's order.
 */
export function pathTurns(db: Database, s: UserStore, chat: string): PathTurn[] {
  if (s.chat(chat) === null) return [];
  const record = db.query<{ message: string; swipe: number; record: string }, [string, string]>("SELECT message, swipe, record FROM imported_record WHERE user = ? AND turn = ?");
  return s.path(chat).flatMap((entry, at) =>
    entry.user
      ? []
      : s.swipes(chat, entry.message).flatMap((turn) => {
          const r = record.get(s.id, turn.id);
          return r === null ? [] : [{ turn, message: r.message, swipe: r.swipe, record: JSON.parse(r.record) as Rec, at }];
        }),
  );
}

/** A file a turn changed: its text as the turn left it, or null where the turn removed it, and as the turn before it left it (null: it was not there). */
export interface AreaChange {
  path: string;
  now: AreaFile | null;
  was: AreaFile | null;
}

/**
 * The chat's area at each imported turn, each area read once: a turn's own where a generation played
 * it, as LumiAH reads it (its record's generation's document where it is carried; the index its record
 * names where LumiAH wrote no document for that generation); else that of the nearest turn before it
 * on its path that has one; none before the first. Only documents `items` carry or attach are read,
 * and no index stands in for a document they archive.
 */
export class TurnAreas {
  private readonly own = new Map<string, Map<string, AreaFile> | null>();
  private readonly docs = new Map<string, Promise<(Area & { at: number }) | null>>();
  /** The area documents `items` carry or attach. */
  readonly carried: ReadonlySet<string>;
  /** Every area document found, whatever its fate: what the rehearsal counts versions in. */
  readonly found: ReadonlySet<string>;
  /** The area documents that hold the very area an imported turn ended with: its own generation's, and a reply's a Continue changed nothing of. */
  readonly tied = new Set<string>();

  constructor(
    private readonly today: Today,
    private readonly db: Database,
    private readonly s: UserStore,
    items: readonly Item[],
  ) {
    this.carried = carriedAreas(items);
    this.found = new Set(items.filter((i) => i.where === "user storage" && AREA_DOC.test(i.path)).map((i) => i.path));
  }

  /** An area document as its head holds it, read once. */
  doc(path: string): Promise<(Area & { at: number }) | null> {
    let area = this.docs.get(path);
    if (area === undefined) {
      area = areaOf(this.today, path);
      this.docs.set(path, area);
    }
    return area;
  }

  /** Each file an area document's index names, by path and the hash of its body, whether its body is still there or not; null where the document or its index doesn't read. As the rehearsal counts them. */
  async index(path: string): Promise<{ path: string; hash: string }[] | null> {
    const head = areaHead(await this.today.userView.read(path));
    if (head === undefined) return null;
    return head === null ? [] : areaFiles(await this.today.userView.read(blob(head)));
  }

  /** A turn's own area, by path: what it ended with; null where no generation played it, or its area isn't carried or doesn't read. */
  async ownArea(turn: TurnRow): Promise<Map<string, AreaFile> | null> {
    if (this.own.has(turn.id)) return this.own.get(turn.id) ?? null;
    const record = recordOf(this.db, this.s.id, turn.id);
    const source = record === null ? null : areaSource(record);
    let area: Area | null = null;
    if (source !== null) {
      const doc = areaDoc(turn.chat, source.generation);
      if (this.carried.has(doc)) area = await this.doc(doc);
      else if (!this.found.has(doc) && source.index !== null) {
        const files = await indexFiles(this.today, source.index);
        area = files === null ? null : { head: source.index, files };
      }
      if (area !== null) {
        for (const generation of new Set([...source.generations, source.generation])) {
          const other = areaDoc(turn.chat, generation);
          if (this.carried.has(other) && (await this.doc(other))?.head === area.head) this.tied.add(other);
        }
      }
    }
    const files = area === null ? null : new Map(area.files.map((f) => [f.path, f]));
    this.own.set(turn.id, files);
    return files;
  }

  /**
   * The chat's area as the reply it shows left it: the own area of the last turn on its path that has
   * one, walked back from its head, as LumiAH's chat area follows the story path (`H/core/areas.ts:6-17`);
   * null where none has.
   */
  async latest(chat: string): Promise<Map<string, AreaFile> | null> {
    const path = this.s.path(chat);
    for (let i = path.length - 1; i >= 0; i--) {
      const id = path[i]?.turn ?? null;
      const turn = id === null ? null : this.s.turn(id);
      const files = turn === null ? null : await this.ownArea(turn);
      if (files !== null) return files;
    }
    return null;
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
    for (const [path, file] of now) if (which(path) && was.get(path)?.hash !== file.hash) out.push({ path, now: file, was: was.get(path) ?? null });
    for (const [path, file] of was) if (which(path) && !now.has(path)) out.push({ path, now: null, was: file });
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}
