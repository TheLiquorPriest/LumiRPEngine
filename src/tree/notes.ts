// Notes follow the turn (plan §5.1). Every note an agent writes in a turn is recorded against it, with
// what the file held before and after (`files.ts`), and which of those writes stand in each chat's notes
// folder is kept (`tree_applied`). Putting a chat's notes at a turn's start takes back, newest first,
// each standing write of a turn that does not stand there, and puts back, oldest first, each write of a
// turn that does. So a swipe or a delete takes a turn's notes away, flipping back to it puts them back,
// and a branch, started from its source's notes, keeps those of the turns up to its branch point.
//
// The user's own edits are kept through all of it: a write is taken back only while its file holds what
// it wrote, and put back only where its file holds what it was written over. A file the user changed in
// between stays as they left it, and is named. The lead dropping a sub-agent's writes takes them back
// the same way, and they are never put back. Notes no agent wrote in a turn (the user's own, those a
// migration carried) are never touched.
//
// Which turns stand at a turn's start is the turn lane's to say: the tree knows no turn tree.

import type { Database } from "bun:sqlite";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readText, writeWhole } from "../app/disk";
import type { TreeChats, TreeWrites } from "./chats";
import { oneFileAtATime, sha256, walk } from "./files";
import { NOTES_FOLDER } from "./layout";
import { type ChatLocation, locate } from "./view";

export interface NotesDeps {
  /** The tree's folder: the global level. */
  files: string;
  /** RPE's database, read at any time. */
  db: Database;
  writes: TreeWrites;
  chats: TreeChats;
}

/** Where a chat's notes are put: at the start of the turn at hand. */
export interface NotesAt {
  /** The turns whose notes stand at the turn's start, oldest first: each turn before it on its path, then the turn itself, whose own notes a continue keeps. */
  turns: readonly string[];
  /** The chat this one was branched from, whose notes it starts with the first time its notes are put at a turn; null for a chat that is no branch. */
  branchOf: string | null;
}

/** What putting the notes somewhere did. */
export interface NotesMoved {
  /** Writes taken back. */
  undone: number;
  /** Writes put back. */
  redone: number;
  /** Note files the user changed since a write that was to be taken back or put back: left as they are. */
  kept: string[];
  /** Files a branch started with from its source's notes. */
  started: number;
}

/** A recorded write, without its texts: they are read only for the writes taken back or put back. */
interface WriteRow {
  id: number;
  turn: string;
  path: string;
  /** The hash of what it left; null for a delete. */
  after: string | null;
  /** Its text after was kept (or it was a delete): it can be put back. */
  whole: number;
  dropped: number;
  /** Stands in the chat's notes folder now. */
  stands: number;
}

const COLUMNS = "w.id, w.turn, w.path, w.after, (w.text IS NOT NULL OR w.after IS NULL) AS whole, w.dropped";

/** What a file holds, by its hash; null for no file. */
function hashOf(text: string | null): string | null {
  return text === null ? null : sha256(text);
}

export class TreeNotes {
  readonly #d: NotesDeps;

  constructor(deps: NotesDeps) {
    this.#d = deps;
  }

  #location(user: string, chat: string): (ChatLocation & { character: string; chat: string }) | null {
    const folders = this.#d.chats.folders(user, chat);
    return folders === null ? null : { files: this.#d.files, character: folders.character, chat: folders.chat };
  }

  /**
   * Puts the chat's notes as they stood at the start of a turn: the writes of `at.turns` stand, no
   * other turn's do. Run before the turn's agents begin; a chat RPE has not placed has no notes to put.
   */
  async follow(user: string, chat: string, at: NotesAt): Promise<NotesMoved> {
    const moved: NotesMoved = { undone: 0, redone: 0, kept: [], started: 0 };
    const loc = this.#location(user, chat);
    if (loc === null) return moved;
    const first = this.#d.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM tree_notes WHERE user = ? AND chat = ?").get(user, chat)?.n === 0;
    if (first && at.branchOf !== null) moved.started = await this.#start(user, loc, at.branchOf, chat);
    const standing = new Set(at.turns);
    const rows = this.#d.db
      .query<WriteRow, [string, string, string]>(
        `SELECT ${COLUMNS}, 1 AS stands FROM tree_applied a JOIN note_version w ON w.id = a.write_id WHERE a.user = ?1 AND a.chat = ?2
         UNION ALL
         SELECT ${COLUMNS}, 0 AS stands FROM note_version w WHERE w.user = ?1 AND w.dropped = 0 AND w.turn IN (SELECT value FROM json_each(?3))
           AND NOT EXISTS (SELECT 1 FROM tree_applied a WHERE a.user = ?1 AND a.chat = ?2 AND a.write_id = w.id)`,
      )
      .all(user, chat, JSON.stringify(at.turns));
    await this.#move(user, chat, loc, rows, (w) => w.dropped === 0 && standing.has(w.turn), moved);
    await this.#d.writes.run(
      (db) => db.run("INSERT INTO tree_notes (user, chat, turn) VALUES (?, ?, ?) ON CONFLICT (user, chat) DO UPDATE SET turn = excluded.turn", [user, chat, at.turns.at(-1) ?? null]),
      "keeping the turn a chat's notes stand at",
    );
    return moved;
  }

  /** Takes back every note an agent (by its handle) wrote in a turn, and keeps them from being put back: the lead dropping a sub-agent's writes. */
  async drop(user: string, chat: string, turn: string, agent: string): Promise<NotesMoved> {
    const moved: NotesMoved = { undone: 0, redone: 0, kept: [], started: 0 };
    const marked = await this.#d.writes.run(
      (db) => db.query<{ id: number }, [string, string, string]>("UPDATE note_version SET dropped = 1 WHERE user = ? AND turn = ? AND dropped = 0 AND json_extract(agent, '$.id') = ? RETURNING id").all(user, turn, agent).length,
      "dropping an agent's notes",
    );
    const loc = this.#location(user, chat);
    if (marked === 0 || loc === null) return moved;
    const rows = this.#d.db.query<WriteRow, [string, string]>(`SELECT ${COLUMNS}, 1 AS stands FROM tree_applied a JOIN note_version w ON w.id = a.write_id WHERE a.user = ? AND a.chat = ?`).all(user, chat);
    await this.#move(user, chat, loc, rows, (w) => w.dropped === 0, moved);
    return moved;
  }

  /** What a write found and what it left. */
  #texts(id: number): { before: string | null; text: string | null } {
    return this.#d.db.query<{ before: string | null; text: string | null }, [number]>("SELECT before, text FROM note_version WHERE id = ?").get(id) ?? { before: null, text: null };
  }

  /** Puts each file the rows name as the writes `stays` keeps would leave it, the user's changes kept, and records which writes stand. */
  async #move(user: string, chat: string, loc: ChatLocation, rows: readonly WriteRow[], stays: (w: WriteRow) => boolean, moved: NotesMoved): Promise<void> {
    const byPath = new Map<string, WriteRow[]>();
    for (const row of rows) byPath.set(row.path, [...(byPath.get(row.path) ?? []), row]);
    for (const [path, writes] of byPath) {
      const standing = writes.filter((r) => r.stands === 1).sort((a, b) => b.id - a.id);
      const missing = writes.filter((r) => r.stands === 0 && stays(r)).sort((a, b) => a.id - b.id);
      // A file whose newest standing write stays, with nothing to put back, is where it should be.
      if (missing.length === 0 && (standing[0] === undefined || stays(standing[0]))) continue;
      const lookup = await locate(loc, path);
      if (!lookup.ok || lookup.at.level !== "chat" || lookup.at.kind !== "notes" || lookup.at.disk === null || lookup.at.is === "folder") continue;
      const disk = lookup.at.disk;
      await oneFileAtATime(disk, async () => {
        const held = await readText(disk);
        let text = held;
        let kept = false;
        // Taken back, newest first, down to the first write that stays or that the file no longer holds.
        const undone: WriteRow[] = [];
        for (const w of standing) {
          if (stays(w)) break;
          if (hashOf(text) !== w.after) {
            kept = true;
            break;
          }
          text = this.#texts(w.id).before;
          undone.push(w);
        }
        // Put back, oldest first, each that the file holds what it was written over. A write recorded before its text was kept cannot be.
        const redone: WriteRow[] = [];
        for (const w of missing) {
          if (w.whole === 0) continue;
          const texts = this.#texts(w.id);
          if (hashOf(text) !== hashOf(texts.before)) {
            kept = true;
            continue;
          }
          text = texts.text;
          redone.push(w);
        }
        if (text !== held) {
          if (text === null) await rm(disk, { force: true });
          else {
            await mkdir(dirname(disk), { recursive: true });
            await writeWhole(disk, text);
          }
        }
        if (undone.length + redone.length > 0) {
          await this.#d.writes.run((db) => {
            for (const w of undone) db.run("DELETE FROM tree_applied WHERE user = ? AND chat = ? AND write_id = ?", [user, chat, w.id]);
            for (const w of redone) db.run("INSERT OR IGNORE INTO tree_applied (user, chat, write_id) VALUES (?, ?, ?)", [user, chat, w.id]);
          }, "keeping which notes stand");
        }
        moved.undone += undone.length;
        moved.redone += redone.length;
        if (kept) moved.kept.push(path);
      });
    }
  }

  /**
   * A branch's notes folder, the first time its notes are put at a turn: its source's notes as they
   * stand, with which writes stand in them, so putting them at the branch's turn leaves the notes of its
   * branch point. A branch whose folder holds notes already (a migration carried them) keeps its own.
   */
  async #start(user: string, loc: ChatLocation & { character: string; chat: string }, from: string, chat: string): Promise<number> {
    const source = this.#location(user, from);
    const own = await locate(loc, NOTES_FOLDER);
    if (source === null || !own.ok || own.at.disk === null) return 0;
    if (own.at.is === "folder") for await (const e of walk(loc, "chat", [NOTES_FOLDER], own.at.disk, Number.POSITIVE_INFINITY)) if (!e.folder) return 0;
    const theirs = await locate(source, NOTES_FOLDER);
    if (!theirs.ok || theirs.at.is !== "folder" || theirs.at.disk === null) return 0;
    let started = 0;
    for await (const e of walk(source, "chat", [NOTES_FOLDER], theirs.at.disk, Number.POSITIVE_INFINITY)) {
      if (e.folder) continue;
      const to = join(own.at.disk, ...e.rest.slice(1));
      const data = await readFile(e.disk);
      await mkdir(dirname(to), { recursive: true });
      await writeWhole(to, data);
      started++;
    }
    await this.#d.writes.run(
      (db) => db.run("INSERT OR IGNORE INTO tree_applied (user, chat, write_id) SELECT user, ?3, write_id FROM tree_applied WHERE user = ?1 AND chat = ?2", [user, from, chat]),
      "starting a branch's notes",
    );
    return started;
  }
}
