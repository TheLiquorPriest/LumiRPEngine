// What a real run left in RPE, as the migration's tests look at it: RPE's database and the user's
// store in it, the turn the import made of a swipe, a character's imported mind files at a turn, a
// chat's notes as its own agents read them, and the report's accounts of what it found inside other
// rows' things. Holds no tests.

import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { dataPaths } from "../../src/app/config";
import { castAt } from "../../src/cast/path";
import { CastRecord, chatLine, findCharacter } from "../../src/cast/record";
import { createRegistry } from "../../src/engine/registry-impl";
import type { MigrationReport } from "../../src/migrate/report";
import { ALL_PACKS } from "../../src/packs/index";
import { openStore, type Store, storedWorlds, type UserStore } from "../../src/store";
import { STORY_STORE_AREA } from "../../src/story";
import { NOTES_FOLDER, TreeChats } from "../../src/tree";
import { USER } from "./fixture";
import { readable } from "./tree";

const registry = createRegistry(ALL_PACKS);

/** RPE's database in the data folder `data` and the user's store in it, its worlds the store's own, for one look. */
export function look<T>(data: string, at: (db: Database, s: UserStore, store: Store) => T): T {
  const db = new Database(join(data, "rpe.db"));
  try {
    const store = openStore({ db, registry, worlds: storedWorlds(db) });
    return at(db, store.user(USER), store);
  } finally {
    db.close();
  }
}

/** The turn the import made of a swipe of a chat's message, by the record the run kept beside it. */
export function turnOf(db: Database, chat: string, message: string, swipe: number): string {
  const row = db.query<{ turn: string }, [string, string, string, number]>("SELECT turn FROM imported_record WHERE user = ? AND chat = ? AND message = ? AND swipe = ?").get(USER, chat, message, swipe);
  if (row === null) throw new Error(`no turn for swipe ${swipe} of ${message}`);
  return row.turn;
}

/** A character's imported mind files in a chat at a turn (null: the chat's head), by file: each item's fields as they stand there, those a turn removed left out. */
export function mindAt(db: Database, s: UserStore, chat: string, name: string, turn: string | null): Record<string, Record<string, unknown>> {
  const character = findCharacter(db, USER, chatLine(s, chat), name);
  if (character === null) throw new Error(`no character ${name}`);
  const record = CastRecord.read(db, USER, castAt(s, chat, turn));
  return Object.fromEntries(record.of(character.id, "mind").filter((m) => m.fields.kind === "imported").map((m) => [String(m.fields.file), m.fields]));
}

/** A chat's notes the run wrote, as its own agents read them: each by its path under `imported/`, with its text; null where the chat has no folders. */
export async function notesOf(data: string, chat: string): Promise<Map<string, string> | null> {
  const files = dataPaths(data).files;
  const own = look(data, (db) => new TreeChats(db, { run: async (write) => write(db) }, files).folders(USER, chat));
  if (own === null) return null;
  const prefix = `${NOTES_FOLDER}/imported/`;
  return new Map([...(await readable({ files, ...own }))].flatMap(([path, text]) => (path.startsWith(prefix) ? [[path.slice(prefix.length), text] as const] : [])));
}

/** The report's two rows found inside other rows' things, each part of what the run did with them against the total the rehearsal found: they add up to it. */
export function accounted(report: MigrationReport): void {
  const minds = report.carried?.minds;
  const story = report.carried?.story;
  if (minds === undefined || story === undefined) throw new Error("a real run carries the minds and the story record");
  const inside = (row: string): number => report.rows.find((r) => r.row === row)?.inside?.count ?? -1;
  const apart = (list: readonly { count: number }[]): number => list.reduce((n, a) => n + a.count, 0);
  expect(minds.versions - minds.unlisted + minds.untied + minds.shared + minds.gone + apart(minds.apart)).toBe(inside("mind-files"));
  expect(story.beats + story.struck + story.futures + story.castings + story.leftOut + story.shared + story.unheld + apart(story.apart)).toBe(inside("story-record"));
}
