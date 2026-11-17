// Each character's mind files (STANDALONE-PLAN §15.2, §12): attached to the character's record in the
// cast as they are, every word, per turn, until they are filed. Today's harness kept a person's mind as
// files in the chat's area, under `minds/<entity>/` (`backend/story/minds.ts:38-52`). Each version of
// a file is attached to the character as `character_doc` text on the turn whose area first held it on
// its path, and the character's mind item for the file names that version in a change of that turn (a
// file a turn removed is a change that drops it); so reading the record at a turn gives each file as
// that turn left it, and a swipe takes its versions with it. Every write says what it is, and that it
// is not filed yet:
//
//   item   `imported:<character>:<file>`, one per character and file
//   value  { kind: "imported", file: "core.md", version: <the version of the file's text attached>, entity: <today's entity id>, filed: false }
//
// How a character's agent is given them, and the filing that marks them filed, are the cast's view
// (`cast:self(imported)`) and the filing job's: here they are only recorded.

import type { Database } from "bun:sqlite";
import { attachFile, type CastWrite, chatLine, filesAttachedOn, findCharacter, importedItemId, writeCast } from "../cast";
import type { Store, TurnRow, UserStore } from "../store";
import { AREA_DOC, type AreaChange, chatOfKey, docKey, importedTurns, pathTurns, type TurnAreas } from "./history";
import { MIND_FILE } from "./inside";
import type { People } from "./people";
import { type Apart, apartBy, type ChatFate } from "./report";

/** Who the migration's rows say wrote them, on the cast's and the story's records. */
export const MIGRATION_WRITER = "migration";

export interface MindsCarried {
  /** Versions this run put on a record, each once by chat, file and text. */
  versions: number;
  /** Of those, the ones none of the chat's own area documents holds: read from the area its turn's record names, where LumiAH wrote no document for that generation (a Continue's, or a branch's copy of a turn of the chat it was made from). */
  unlisted: number;
  /** The cast's rows written: each version on the turn that first held it on its path, and each removal. */
  rows: number;
  /** Each character a file was attached to: its chat, the cast's id (the report holds no name), today's entity, and the files. */
  characters: { chat: string; character: string; entity: string; files: string[] }[];
  /**
   * The rest of the versions the rehearsal counts in today's areas (every area document of every chat,
   * whatever its fate), by why this run put them on no record. Of the chats it imported: in areas no
   * imported turn ended with (before any turn, a generation that left no reply, or a reply's that a
   * Continue then changed) and no turn's area holds, kept in the backup only (`untied`); in a branch's
   * own areas, the same as the chat it was made from holds, on the records of the turns the two share
   * (`shared`); whose text today's clean-up had removed (`gone`). Of the chats it did not import, by
   * what came of each (`apart`).
   */
  untied: number;
  shared: number;
  gone: number;
  apart: Apart[];
}

/** The entity and file a mind file's path names (`mindPath`: the entity's id as its code). */
function mindOf(path: string): { entity: string; file: string } | null {
  const m = /^minds\/([^/]+)\/([a-z]+\.md)$/.exec(path);
  if (m === null || !MIND_FILE.test(path)) return null;
  try {
    return { entity: decodeURIComponent(m[1] ?? ""), file: m[2] ?? "" };
  } catch {
    return null;
  }
}

/**
 * Attaches the mind files of the chats `chats` names, turn by turn, onto their characters' records:
 * what each imported turn changed of them is read first, then written in one transaction. Every
 * version found in today's areas is accounted for: on a record, or why not; `fate` says what came of a
 * chat this run did not import.
 */
export async function carryMinds(input: { db: Database; store: Store; s: UserStore; chats: readonly string[]; areas: TurnAreas; people: People; now: number; fate: (chat: string) => ChatFate }): Promise<MindsCarried> {
  const { db, store, s, areas, people } = input;
  const isMind = (path: string): boolean => mindOf(path) !== null;
  const changed: { turn: TurnRow; changes: AreaChange[] }[] = [];
  /** Every version this run puts on a record, by chat, path and text: each is written on the first turn of its path that holds it. */
  const held = new Set<string>();
  for (const chat of input.chats) {
    for (const { turn } of importedTurns(db, s, chat)) {
      const changes = await areas.changesAt(turn, isMind);
      if (changes === null || changes.length === 0) continue;
      changed.push({ turn, changes });
      for (const c of changes) if (c.now !== null) held.add(`${turn.chat}\u0000${c.path}\u0000${c.now.hash}`);
    }
  }
  // Every version the rehearsal counts, by chat: the mind files each area document's index names.
  const found = new Map<string, Set<string>>();
  for (const doc of areas.found) {
    const key = AREA_DOC.exec(doc)?.[1];
    const chat = key === undefined ? null : chatOfKey(key);
    if (chat === null) continue;
    const versions = found.get(chat) ?? new Set<string>();
    for (const f of (await areas.index(doc)) ?? []) if (isMind(f.path)) versions.add(`${chat}\u0000${f.path}\u0000${f.hash}`);
    found.set(chat, versions);
  }
  const carried = new Set(input.chats);
  let untied = 0;
  let shared = 0;
  let gone = 0;
  for (const [chat, versions] of found) {
    if (!carried.has(chat)) continue;
    // What the areas of the turns on its path hold, the turns it shares included; and what its documents hold with the text still there.
    const onPath = new Set<string>();
    for (const { turn } of pathTurns(db, s, chat)) for (const f of (await areas.ownArea(turn))?.values() ?? []) onPath.add(`${chat}\u0000${f.path}\u0000${f.hash}`);
    const readable = new Set<string>();
    for (const doc of areas.found) if (AREA_DOC.exec(doc)?.[1] === docKey(chat)) for (const f of (await areas.doc(doc))?.files ?? []) readable.add(`${chat}\u0000${f.path}\u0000${f.hash}`);
    for (const v of versions) {
      if (held.has(v)) continue;
      if (onPath.has(v)) shared++;
      else if (readable.has(v)) untied++;
      else gone++;
    }
  }
  const unlisted = [...held].filter((v) => !found.get(v.slice(0, v.indexOf("\u0000")))?.has(v)).length;
  const apart = apartBy([...found].flatMap(([chat, versions]) => (carried.has(chat) ? [] : [[chat, versions.size] as const])), input.fate);
  const characters = new Map<string, MindsCarried["characters"][number]>();
  let rows = 0;
  db.transaction(() => {
    for (const { turn, changes } of changed) {
      const writes: CastWrite[] = [];
      for (const change of changes) {
        const mind = mindOf(change.path);
        if (mind === null) continue;
        const person = people.of(turn, mind.entity);
        const item = importedItemId(person.id, mind.file);
        if (change.now === null) {
          writes.push({ character: person.id, part: "mind", item, value: { drop: true } });
          continue;
        }
        const version = attachFile(db, { user: s.id, turn: turn.id, by: MIGRATION_WRITER, agent: null, now: input.now }, person.id, mind.file, change.now.text);
        writes.push({ character: person.id, part: "mind", item, value: { kind: "imported", file: mind.file, version, entity: mind.entity, filed: false } });
        const key = `${turn.chat}\u0000${person.id}`;
        const entry = characters.get(key) ?? { chat: turn.chat, character: person.id, entity: mind.entity, files: [] };
        if (!entry.files.includes(mind.file)) entry.files.push(mind.file);
        characters.set(key, entry);
      }
      rows += writeCast(store, { user: s.id, turn: turn.id, by: MIGRATION_WRITER, agent: null, job: null, at: turn.storyTime, now: input.now, source: "import" }, writes).length;
    }
  })();
  return { versions: held.size, unlisted, rows, characters: [...characters.values()].map((c) => ({ ...c, files: c.files.sort() })), untied, shared, gone, apart };
}

/**
 * Each character the migration attached mind files to on the turns `turns` names, in that order (a
 * chat's path: every swipe of every reply on it, the turns it shares with the chat it was branched
 * from included), by the name the cast knows it by, with the files.
 */
export function attachedOn(db: Database, s: UserStore, chat: string, turns: readonly string[]): { name: string; files: string[] }[] {
  const files = filesAttachedOn(s, turns, MIGRATION_WRITER);
  const line = chatLine(s, chat);
  return [...files].map(([character, names]) => ({ name: findCharacter(db, s.id, line, character)?.name ?? character, files: [...names].sort() }));
}
