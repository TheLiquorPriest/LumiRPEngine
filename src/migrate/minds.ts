// Each character's mind files (STANDALONE-PLAN §15.2, §12): attached to the character's record in the
// cast as they are, every word, per turn, until they are filed. Today's harness kept a person's mind as
// files in the chat's area, under `minds/<entity>/` (`backend/story/minds.ts:38-52`). Each version of
// a file is a row of the cast's `mind` part on the turn whose area first held it on its path, and a
// file a turn removed is a row that drops it; so reading the record at a turn gives each file as that
// turn left it, and a swipe takes its versions with it. Every row says what it is, and that it is not
// filed yet:
//
//   item   `imported:<character>:<file>`, one per character and file
//   value  { kind: "imported", file: "core.md", text: <the file's text, byte for byte>, entity: <today's entity id>, filed: false }
//
// How a character's agent is given them, and the filing that marks them filed, are the cast's view
// (`cast:self(imported)`) and the filing job's: here they are only recorded.

import type { Database } from "bun:sqlite";
import { type CastWrite, writeCast } from "../cast";
import type { TurnRow, UserStore } from "../store";
import { AREA_DOC, type AreaChange, areaOf, docKey, importedTurns, type TurnAreas } from "./history";
import { MIND_FILE } from "./inside";
import type { People } from "./people";
import type { Today } from "./today";

/** Who the migration's rows say wrote them, on the cast's and the story's records. */
export const MIGRATION_WRITER = "migration";

/** The cast's item of one imported mind file of a character. */
export const importedItem = (character: string, file: string): string => `imported:${character}:${file}`;

export interface MindsCarried {
  /** Versions attached, each once by chat, file and text: what the rehearsal counts as found in the areas. */
  versions: number;
  /** The cast's rows written: each version on the turn that first held it on its path, and each removal. */
  rows: number;
  /** Each character a file was attached to: its chat, the cast's id and name, today's entity, and the files. */
  characters: { chat: string; character: string; name: string; entity: string; files: string[] }[];
  /** Versions in an area of the chats imported that no imported turn names (before any turn, or a generation that left no reply): kept in the backup only. */
  untied: number;
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
 * what each imported turn changed of them is read first, then written in one transaction.
 */
export async function carryMinds(input: { today: Today; db: Database; s: UserStore; chats: readonly string[]; areas: TurnAreas; people: People; carried: ReadonlySet<string>; now: number }): Promise<MindsCarried> {
  const { db, s, areas, people } = input;
  const isMind = (path: string): boolean => mindOf(path) !== null;
  const changed: { turn: TurnRow; changes: AreaChange[] }[] = [];
  /** Every version some turn's area holds, by chat, path and text: each is written on the first turn of its path that holds it. */
  const held = new Set<string>();
  const untied = new Set<string>();
  for (const chat of input.chats) {
    for (const { turn } of importedTurns(db, s, chat)) {
      const changes = await areas.changesAt(turn, isMind);
      if (changes === null || changes.length === 0) continue;
      changed.push({ turn, changes });
      for (const c of changes) if (c.now !== null) held.add(`${turn.chat}\u0000${c.path}\u0000${c.now.hash}`);
    }
    // The chat's areas no imported turn names: what their mind files hold that no turn's area does stays in the backup.
    for (const doc of input.carried) {
      if (areas.tied.has(doc) || AREA_DOC.exec(doc)?.[1] !== docKey(chat)) continue;
      for (const f of (await areaOf(input.today, doc))?.files ?? []) if (isMind(f.path) && !held.has(`${chat}\u0000${f.path}\u0000${f.hash}`)) untied.add(`${chat}\u0000${f.path}\u0000${f.hash}`);
    }
  }
  const characters = new Map<string, MindsCarried["characters"][number]>();
  let rows = 0;
  db.transaction(() => {
    for (const { turn, changes } of changed) {
      const writes: CastWrite[] = [];
      for (const change of changes) {
        const mind = mindOf(change.path);
        if (mind === null) continue;
        const person = people.of(turn, mind.entity);
        const item = importedItem(person.id, mind.file);
        if (change.now === null) {
          writes.push({ character: person.id, part: "mind", item, value: { drop: true } });
          continue;
        }
        writes.push({ character: person.id, part: "mind", item, value: { kind: "imported", file: mind.file, text: change.now.text, entity: mind.entity, filed: false } });
        const key = `${turn.chat}\u0000${person.id}`;
        const entry = characters.get(key) ?? { chat: turn.chat, character: person.id, name: person.name, entity: mind.entity, files: [] };
        if (!entry.files.includes(mind.file)) entry.files.push(mind.file);
        characters.set(key, entry);
      }
      rows += writeCast(db, { user: s.id, turn: turn.id, by: MIGRATION_WRITER, agent: null, job: null, at: turn.storyTime, now: input.now }, writes).length;
    }
  })();
  return { versions: held.size, rows, characters: [...characters.values()].map((c) => ({ ...c, files: c.files.sort() })), untied: untied.size };
}
