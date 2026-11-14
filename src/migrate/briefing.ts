// A migrated chat's first briefing on RPE (STANDALONE-PLAN §12: a chat migrated from today's build is
// not bootstrapped from nothing; it starts with everything today's build knew of it). The real run
// keeps what it carried of each chat it imported (`migration_chat.carried`): which of today's engines
// played it and how many of its turns were carried, whether today's state was kept where RPE's
// reckoning differed, each character's mind files attached and not yet filed, the story record's
// entries, and the notes. The turn lane lays these out with the prompt part `.prompts/migrated.md`
// and gives the text to the notice `migrated_chat` of `.prompts/notices.md` as its `{{carried}}`, in
// the chat's first briefing: one while no turn RPE played is on the chat's path. Facts only: what is
// done about them is the guidance's.

import type { Database } from "bun:sqlite";
import type { Store } from "../store";
import type { ChatEngine } from "./chats";
import { VERSIONS } from "./own-files";
import type { MigrationReport } from "./report";
import type { StoryCounts } from "./story-record";
import { chatRecord } from "./tables";

/** The prompt part that lays out what the migration carried of a chat. */
export const MIGRATED_PART = "migrated";
/** The notice of `.prompts/notices.md` that says a chat was migrated; its `{{carried}}` is the part's text. */
export const MIGRATED_NOTICE = "migrated_chat";

/** What a run carried of one chat it imported: names and counts, never content. */
export interface ChatCarried {
  /** Which of today's engines played the chat; null where today's build played no world in it. */
  engine: ChatEngine | null;
  /** Turns carried: one per swipe of every reply the chat holds itself. */
  turns: number;
  /** Where RPE's reckoning of a turn's state differed from today's, today's was kept as the turn's starting state. */
  marked: boolean;
  /** Each character a mind file was attached to, by the name the cast knows it by, and the files, not yet filed. */
  characters: { name: string; files: string[] }[];
  story: StoryCounts;
  /** The chat's notes in its own notes folder, the folder by the path its agents see it at; null where the run was not given the file tree, or the chat had none. */
  notes: { folder: string; latest: number; versions: number; learned: number } | null;
}

/**
 * What the run that made `report` carried of a chat it imported. `notes` is where the chat's notes
 * folder from today's build is in its agents' view (`persistent-workspace/imported`); null where the
 * run was not given the file tree.
 */
export function chatCarried(report: MigrationReport, chat: string, notes: string | null): ChatCarried {
  const imported = report.imports?.find((c) => c.chatId === chat);
  const own = notes === null ? undefined : report.carried?.ownFiles?.byChat.find((c) => c.chat === chat);
  const story = report.carried?.story.byChat.find((c) => c.chat === chat);
  return {
    engine: report.chats.find((c) => c.chatId === chat)?.engine ?? null,
    turns: imported?.turns ?? 0,
    marked: (imported?.differences.length ?? 0) > 0,
    characters: (report.carried?.minds.characters ?? []).filter((c) => c.chat === chat).map((c) => ({ name: c.name, files: c.files })),
    story: { beats: story?.beats ?? 0, struck: story?.struck ?? 0, futures: story?.futures ?? 0, castings: story?.castings ?? 0 },
    notes: own === undefined || notes === null || own.notes + own.versions + own.learned === 0 ? null : { folder: notes, latest: own.notes, versions: own.versions, learned: own.learned },
  };
}

/** The fields of `.prompts/migrated.md`. A part with nothing in it is left out, so the layout shows nothing of it. (A type, not an interface, so it is a template's fields.) */
export type MigratedFields = {
  played?: { engine: string; turns: number };
  marked?: true;
  characters?: { items: { name: string; files: { ".": string[] } }[] };
  story?: { beats: number; struck: number; futures: number; castings: number };
  notes?: { folder: string; latest: number; versions: string; learned?: { folder: string } };
};

/**
 * What the migration carried of a chat, as `.prompts/migrated.md` lays it out, for the chat's first
 * briefing on RPE: null where no run of this build imported the chat, or a turn RPE played is on its
 * path already. Reads RPE's database only.
 */
export function migratedChat(input: { db: Database; store: Store; user: string; chat: string }): MigratedFields | null {
  const s = input.store.user(input.user);
  if (s.chat(input.chat) === null) return null;
  if (s.path(input.chat).some((e) => e.turn !== null && s.turn(e.turn)?.imported === false)) return null;
  const record = chatRecord(input.db, input.user, input.chat);
  if (record === null) return null;
  const c = record.carried;
  const { beats, struck, futures, castings } = c.story;
  const story = beats + struck + futures + castings > 0 ? { beats, struck, futures, castings } : undefined;
  return {
    ...(c.engine !== null ? { played: { engine: c.engine, turns: c.turns } } : {}),
    ...(c.marked ? { marked: true } : {}),
    ...(c.characters.length > 0 ? { characters: { items: c.characters.map((p) => ({ name: p.name, files: { ".": p.files } })) } } : {}),
    ...(story !== undefined ? { story } : {}),
    ...(c.notes !== null ? { notes: { folder: c.notes.folder, latest: c.notes.latest, versions: `${c.notes.folder}/${VERSIONS}`, ...(c.notes.learned > 0 ? { learned: { folder: `${c.notes.folder}/learned` } } : {}) } } : {}),
  };
}
