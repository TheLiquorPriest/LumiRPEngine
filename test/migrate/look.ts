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
import { CAST_STORE_AREA } from "../../src/cast";
import { importedText } from "../../src/cast/imported";
import { createRegistry } from "../../src/engine/registry-impl";
import type { MigrationPageInput } from "../../src/migrate/page";
import { Rehearsals } from "../../src/migrate/rehearse-job";
import type { MigrationReport } from "../../src/migrate/report";
import { ALL_PACKS } from "../../src/packs/index";
import { openStore, type Store, storedWorlds, type UserStore } from "../../src/store";
import { STORY_STORE_AREA } from "../../src/story";
import { NOTES_FOLDER, TreeChats } from "../../src/tree";
import { IDENT, USER, type Fixture } from "./fixture";
import { readable } from "./tree";

const registry = createRegistry(ALL_PACKS);

/** The store each user's store was opened by, so a look at a character reads through it. */
const opened = new WeakMap<UserStore, Store>();

/** The Migration page's input over RPE's database `db`, with no rehearsal and the runtime's folders as the fixture has them. */
export function pageInput(db: Database, fixture: Pick<Fixture, "sources">): MigrationPageInput {
  const none = async (): Promise<never> => {
    throw new Error("no rehearsal here");
  };
  return { db, user: USER, identifier: IDENT, rehearsals: new Rehearsals(none, Date.now), database: null, runtime: fixture.sources.runtime ?? { configDir: "", dataDir: "" } };
}

/** RPE's database in the data folder `data` and the user's store in it, its worlds the store's own, for one look. */
export function look<T>(data: string, at: (db: Database, s: UserStore, store: Store) => T): T {
  const db = new Database(join(data, "rpe.db"));
  try {
    const store = openStore({ db, registry, worlds: storedWorlds(db), areas: [CAST_STORE_AREA, STORY_STORE_AREA] });
    const s = store.user(USER);
    opened.set(s, store);
    return at(db, s, store);
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
  const store = opened.get(s);
  if (character === null || store === undefined) throw new Error(`no character ${name}`);
  const record = CastRecord.read(store, USER, castAt(s, chat, turn));
  // Each file as the earlier build kept it: its text is the version the item names.
  return Object.fromEntries(
    record
      .of(character.id, "mind")
      .filter((m) => m.fields.kind === "imported")
      .map((m) => {
        const { version: _version, ...rest } = m.fields;
        return [String(m.fields.file), { ...rest, text: importedText(db, USER, m) }];
      }),
  );
}

/** A chat's notes as its own agents read them: each by its path under the notes folder, with its text; null where the chat has no folders. */
export async function notesOf(data: string, chat: string): Promise<Map<string, string> | null> {
  const files = dataPaths(data).files;
  const own = look(data, (db) => new TreeChats(db, { run: async (write) => write(db) }, files).folders(USER, chat));
  if (own === null) return null;
  const prefix = `${NOTES_FOLDER}/`;
  return new Map([...(await readable({ files, ...own }))].flatMap(([path, text]) => (path.startsWith(prefix) ? [[path.slice(prefix.length), text] as const] : [])));
}

/** The versions of a chat's notes the run recorded in RPE's own history of notes: each note by its path, with its text before and after (null: none) and whether it stands on the chat's path. */
export function versionsOf(data: string, chat: string): { turn: string; path: string; before: string | null; after: string | null; stands: boolean }[] {
  return look(data, (db) =>
    db
      .query<{ turn: string; path: string; before: string | null; text: string | null; stands: number }, [string, string, string]>("SELECT v.turn, v.path, v.before, v.text, EXISTS(SELECT 1 FROM tree_applied a WHERE a.user = v.user AND a.chat = v.chat AND a.write_id = v.id) AS stands FROM note_version v WHERE v.user = ? AND v.chat = ? AND json_extract(v.agent, '$.id') = ? ORDER BY v.id")
      .all(USER, chat, "carried")
      .map((v) => ({ turn: v.turn, path: v.path, before: v.before, after: v.text, stands: v.stands === 1 })),
  );
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
