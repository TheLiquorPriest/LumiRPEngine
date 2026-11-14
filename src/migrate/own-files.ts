// The user's own files (STANDALONE-PLAN §15.2: "Your own agents and skills", "Your edited prompts and
// texts", "Your GUIDANCE.md", "The Author's notebook…" and "learned/ and your own ~/ files"). The
// user's agents, skills, texts, GUIDANCE.md and `~/` files are written into the user's level of RPE's
// file tree under `imported/`, where nothing is in force until the user switches it on: they were
// written for agents that are gone or changed. Each chat's notes and `learned/` are written into that
// chat's own notes folder, under `imported/`: carried as notes (§15.2), where that chat's agents read
// them and no other chat's do, since the tree's view never shows one chat's folder to another
// (`src/tree/view.ts`). The migration may not import the tree (`test/standalone-boundaries.test.ts`),
// so the caller gives its folder names, its tables and where a chat's folder is (`TreeLayout`).
//
// What is read: the user's own definitions and texts in LumiAH's `harness/settings.json`, the
// engine's edited texts in `settings.json` (`prompts.texts`), and LumiAH's areas (`~/`, each chat's
// `learned/` and its area, turn by turn), each a head naming an index blob that names each file's body
// (`H/core/workspace.ts:41-53`). A chat's notes are its area as the reply it shows left it, as LumiAH's
// chat area follows the story path, and versioned by turn (§15.2): every earlier version is kept under
// `turns/`, in a folder for the turn that wrote it (`message-<n>-swipe-<k>`, the chat's first message
// counting as 0), holding the files that turn changed; an area no imported turn ended with holds all
// its files, in `before-any-turn` or `generation-<id>`. Its mind files are the characters' (`minds.ts`),
// not the Author's.

import type { Database } from "bun:sqlite";
import { mkdir, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { YAML } from "bun";
import { writeWhole } from "../app/disk";
import type { Migration, MigrationArea } from "../app/migrations";
import { chatLine } from "../cast";
import { isRecord } from "../shared/json";
import type { UserStore } from "../store";
import { readBytes, sha256 } from "./files";
import { AREA_DOC, type AreaFile, areaDoc, areaOf, chatOfKey, docKey, pathTurns, type TurnAreas } from "./history";
import { MIND_FILE } from "./inside";
import type { Item } from "./report";
import { keepWritten, type WrittenFile, writtenFiles } from "./tables";
import type { Today } from "./today";

/** The folder everything here is written under, at the user's level and in a chat's notes, as the plan names it. */
export const IMPORTED = "imported";

/** The folder of a chat's notes, under `imported/`, that keeps each earlier version by the turn that wrote it. */
export const VERSIONS = "turns";

/** The folder, under `imported/` at the user's level, of the prompt sets today's turns recorded: each named by the hash a turn's record gives it (`Rec.prompts`). */
export const PROMPT_SETS = "prompt-sets";

/** What a chat's folders are named for, as the file tree names them (`ChatNames`, `src/tree/chats.ts`): its character, and the chat itself. */
export interface ChatNames {
  character: { id: string; name: string } | null;
  chat: { name: string };
}

/** The file tree as the caller gives it to the migration, which may not import it. */
export interface TreeLayout {
  /** The folder names of a level's agents, skills and texts (`GLOBAL_FOLDERS`), and of a chat's notes (`NOTES_FOLDER`). */
  agents: string;
  skills: string;
  prompts: string;
  notes: string;
  /** The tree's tables in RPE's database, and the area they are kept under: a chat's folders are kept there. */
  tables: { area: MigrationArea; migrations: readonly Migration[] };
  /**
   * A chat's own folder, relative to the tree's folder `files`: chosen and kept in RPE's database `db`
   * the first time RPE meets the chat, as the tree chooses it, and made.
   */
  chatFolder(db: Database, files: string, user: string, chat: string, names: ChatNames): Promise<string>;
}

/** Where the user's own files go in this run: the tree's folder, its folder names, and each chat's own folder. */
export interface TreePlaces {
  /** The user's level: the file tree's root folder (`DataPaths.files`). */
  root: string;
  agents: string;
  skills: string;
  prompts: string;
  notes: string;
  /** A chat's own folder, relative to `root`. */
  chat(chat: string, names: ChatNames): Promise<string>;
  /** Whether a chat was played on RPE: its notes are RPE's then, and a run leaves them as they are. */
  played(chat: string): boolean;
}

export interface OwnFilesCarried {
  agents: number;
  skills: number;
  texts: number;
  /** The prompt sets today's turns recorded, under `prompt-sets/`. */
  promptSets: number;
  guidance: number;
  home: number;
  notes: number;
  /** Earlier versions of each chat's notes, by the turn that wrote them, under `turns/`. */
  versions: number;
  /** The notes a turn removed or moved away, listed beside its version (`removedList`). */
  removals: number;
  learned: number;
  /** Files whose names would leave the folder they go in: not written, in the backup only. */
  leftOut: number;
  /** Chats played on RPE, whose notes this run left as they are. */
  leftAlone: number;
  /** Chats this run did not import whose earlier import stands, whose notes an earlier run wrote: left as they are. */
  kept: number;
  /** Files an earlier run wrote that this run does not write again, as today's side no longer has them: removed, each as that run wrote it. */
  removed: number;
  /** Files an earlier run wrote that today's side no longer has, changed in RPE since: left as they are, and no longer the migration's. */
  changed: number;
  /** Each chat's notes, versions and learned files, by chat. */
  byChat: { chat: string; notes: number; versions: number; learned: number }[];
}

function json(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** What a run's import holds of each chat, for its notes and their earlier versions: RPE's database, the user's store, each turn's area, and the chats this run's import carried. */
export interface NoteHistory {
  db: Database;
  s: UserStore;
  areas: TurnAreas;
  /** The chats this run imported, or replaced with what today's side holds now. */
  carried: ReadonlySet<string>;
}

/** The file beside a turn's version folder under `turns/` that lists, a path a line, the notes that turn removed or moved away: beside it, as a note of any name may be among the files in it, and no folder there is named with a dot. */
export const removedList = (folder: string): string => `${folder}.removed.txt`;

/**
 * Each earlier version of a chat's notes, by the folder it is kept in under `turns/`: for each turn of
 * a reply on the chat's path, its own or one it shares with the chat it was branched from, the files
 * that turn changed and the paths it removed or moved away; for each area document of the chat no
 * imported turn ended with, all its files. Mind files are left to their own row.
 */
async function noteVersions(chat: string, docs: readonly string[], history: NoteHistory): Promise<Map<string, { files: AreaFile[]; removed: string[] }>> {
  const out = new Map<string, { files: AreaFile[]; removed: string[] }>();
  const notes = (path: string): boolean => !MIND_FILE.test(path);
  for (const { turn, swipe, at } of pathTurns(history.db, history.s, chat)) {
    const changes = (await history.areas.changesAt(turn, notes)) ?? [];
    const files = changes.flatMap((c) => (c.now === null ? [] : [c.now]));
    const removed = changes.flatMap((c) => (c.now === null ? [c.path] : []));
    if (files.length + removed.length > 0) out.set(`message-${at}-swipe-${swipe}`, { files, removed });
  }
  for (const doc of docs) {
    if (history.areas.tied.has(doc)) continue;
    const generation = AREA_DOC.exec(doc)?.[2] ?? "";
    const files = ((await history.areas.doc(doc))?.files ?? []).filter((f) => notes(f.path));
    if (files.length > 0) out.set(generation === "root" ? "before-any-turn" : `generation-${generation}`, { files, removed: [] });
  }
  return out;
}

/** A definition's header in the new format (`name`, `description`, `tools`), and its body. */
function headed(header: Record<string, unknown>, body: string): string {
  const fields = Object.fromEntries(Object.entries(header).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(fields, null, 2).replace(/\n+$/, "")}\n---\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A path that stays inside the folder it is written under: no part of it empty, "." or "..". */
const staysInside = (path: string): boolean => path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"));

/** Removes the folders a removal left empty, up to the folder `base` the file was written under. */
async function pruneEmpty(file: string, base: string): Promise<void> {
  for (let dir = dirname(file); dir.startsWith(`${base}/`); dir = dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
  }
}

/**
 * Writes the user's own files under `imported/` at the user's level, and each chat's notes under
 * `imported/` in that chat's own notes folder, with every earlier version by the turn that wrote it.
 * `items` are the report's: only what it classifies as carried or attached is read, so a chat gone
 * from Lumiverse or one LumiAH was told to forget is left in the backup. A chat RPE's store holds that
 * this run did not import keeps the notes it has: a chat played on RPE, whose notes are RPE's now, or
 * one whose earlier import stands. Everything else an earlier run wrote is replaced by what today's
 * side holds now (§15.3): a file it wrote that this run does not write again is removed, where it is
 * still as that run wrote it (`migration_file`).
 */
export async function carryOwnFiles(today: Today, items: readonly Item[], places: TreePlaces, history: NoteHistory): Promise<OwnFilesCarried> {
  const out: OwnFilesCarried = { agents: 0, skills: 0, texts: 0, promptSets: 0, guidance: 0, home: 0, notes: 0, versions: 0, removals: 0, learned: 0, leftOut: 0, leftAlone: 0, kept: 0, removed: 0, changed: 0, byChat: [] };
  const wrote: WrittenFile[] = [];
  /** Writes one file, by its path below the folder `base` of the tree's: the user's level's, or a chat's notes' (`chat`, "" for none); a name that would leave the folder it goes in is counted as left out, and stays in the backup. */
  const put = async (chat: string, base: string, path: string, body: string): Promise<boolean> => {
    if (!staysInside(path)) {
      out.leftOut++;
      return false;
    }
    const disk = join(places.root, base, path);
    await mkdir(dirname(disk), { recursive: true });
    await writeWhole(disk, body);
    wrote.push({ chat, base, path, sha256: sha256(body) });
    return true;
  };

  // The user's own agents and skills, in the new header format with the original beside each; and their edited texts.
  const harness = json(await today.userView.read("harness/settings.json"));
  const definitions = isRecord(harness) && isRecord(harness.definitions) ? harness.definitions : {};
  for (const [id, def] of Object.entries(isRecord(definitions.agents) ? definitions.agents : {})) {
    if (!isRecord(def)) continue;
    const tools = Array.isArray(def.tools) ? def.tools.filter((t): t is string => typeof t === "string") : undefined;
    if (await put("", IMPORTED, `${places.agents}/${id}.md`, headed({ name: id, description: text(def.description), tools }, text(def.instructions) ?? ""))) out.agents++;
    await put("", IMPORTED, `${places.agents}/${id}.original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  for (const [id, def] of Object.entries(isRecord(definitions.skills) ? definitions.skills : {})) {
    if (!isRecord(def)) continue;
    if (await put("", IMPORTED, `${places.skills}/${id}/SKILL.md`, headed({ name: id, description: text(def.description) }, text(def.body) ?? ""))) out.skills++;
    await put("", IMPORTED, `${places.skills}/${id}/original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  const engine = json(await today.userView.read("settings.json"));
  const texts = { ...(isRecord(engine) && isRecord(engine.prompts) && isRecord(engine.prompts.texts) ? engine.prompts.texts : {}), ...(isRecord(harness) && isRecord(harness.texts) ? harness.texts : {}) };
  for (const [id, body] of Object.entries(texts)) if (typeof body === "string" && (await put("", IMPORTED, `${places.prompts}/${id}.md`, body))) out.texts++;

  // LumiAH's areas: `~/` (GUIDANCE.md apart), and each chat's learned/ and its area as the reply it shows left it; and the prompt sets turns recorded, word for word, each by the hash its turns' records name it by.
  const learned = new Map<string, string>();
  for (const item of items) {
    if (item.where !== "user storage" || (item.fate !== "carried" && item.fate !== "attached")) continue;
    if (item.path === "harness/docs/workspace/user.json") {
      for (const f of (await areaOf(today, item.path))?.files ?? []) {
        if (f.path === "GUIDANCE.md") {
          if (await put("", IMPORTED, "GUIDANCE.md", f.text)) out.guidance++;
        } else if (await put("", IMPORTED, `home/${f.path}`, f.text)) out.home++;
      }
      continue;
    }
    const set = /^prompts\/sets\/([0-9a-f]{32}\.json)$/.exec(item.path)?.[1];
    if (set !== undefined) {
      const body = await today.userView.read(item.path);
      if (body !== null && (await put("", IMPORTED, `${PROMPT_SETS}/${set}`, body))) out.promptSets++;
      continue;
    }
    const chat = /^harness\/docs\/chats\/([^/]+)\/learned\.json$/.exec(item.path)?.[1];
    const id = chat === undefined ? null : chatOfKey(chat);
    if (id !== null) learned.set(id, item.path);
  }
  const latest = await latestAreas(today, items);
  const areas = [...history.areas.carried];
  // A chat RPE's store holds that this run did not import keeps what an earlier run wrote for it: it was played on RPE, or its earlier import stands.
  const keeps = (chat: string): boolean => chat !== "" && !history.carried.has(chat) && history.s.chat(chat) !== null;
  // Each chat's into its own notes folder, placed as RPE places the chat: by its name and its character's, as Lumiverse has them.
  for (const id of [...new Set([...history.carried, ...latest.keys(), ...learned.keys()])].sort()) {
    if (keeps(id)) {
      if (places.played(id)) out.leftAlone++;
      else out.kept++;
      continue;
    }
    // A branch reads as LumiAH gave it its files: its turns' areas, the ones it shares included; and the learned/ of the chat it was made from, until it has its own.
    const now = (await notesNow(id, latest.get(id) ?? null, history)).filter((f) => !MIND_FILE.test(f.path));
    const versions = await noteVersions(id, areas.filter((doc) => AREA_DOC.exec(doc)?.[1] === docKey(id)), history);
    const doc = chatLine(history.s, id).map((c) => learned.get(c)).find((d) => d !== undefined);
    const knows = doc === undefined ? [] : ((await history.areas.doc(doc))?.files ?? []);
    if (now.length === 0 && versions.size === 0 && knows.length === 0) continue;
    const row = today.chats.find((c) => c.id === id);
    const character = row === undefined || row.character === null ? null : today.db.character(row.character, today.sources.userId);
    const notes = `${await places.chat(id, { character, chat: { name: row?.name ?? "" } })}/${places.notes}/${IMPORTED}`;
    const mine = { chat: id, notes: 0, versions: 0, learned: 0 };
    for (const f of now) if (await put(id, notes, f.path, f.text)) mine.notes++;
    for (const [folder, { files, removed }] of versions) {
      for (const f of files) if (await put(id, notes, `${VERSIONS}/${folder}/${f.path}`, f.text)) mine.versions++;
      if (removed.length > 0 && (await put(id, notes, `${VERSIONS}/${removedList(folder)}`, `${removed.join("\n")}\n`))) out.removals += removed.length;
    }
    for (const f of knows) if (await put(id, notes, `learned/${f.path}`, f.text)) mine.learned++;
    out.byChat.push(mine);
    out.notes += mine.notes;
    out.versions += mine.versions;
    out.learned += mine.learned;
  }
  // What an earlier run wrote that this one does not write again: today's side no longer has it. Removed where it is as that run wrote it; where it was changed in RPE since, it is left, and is no longer the migration's.
  const again = new Set(wrote.map((f) => `${f.base}\u0000${f.path}`));
  const stays: WrittenFile[] = [];
  for (const f of writtenFiles(history.db, history.s.id)) {
    if (again.has(`${f.base}\u0000${f.path}`)) continue;
    if (keeps(f.chat)) {
      stays.push(f);
      continue;
    }
    const disk = join(places.root, f.base, f.path);
    const bytes = await readBytes(disk);
    if (bytes === null) continue;
    if (sha256(bytes) !== f.sha256) {
      out.changed++;
      continue;
    }
    await rm(disk);
    await pruneEmpty(disk, join(places.root, f.base));
    out.removed++;
  }
  keepWritten(history.db, history.s.id, [...stays, ...wrote]);
  return out;
}

/**
 * A chat's notes as they stand. For a chat RPE's store holds, the area of the reply it shows: the own
 * area of the last turn on its path that has one, as LumiAH's chat area follows the story path; where
 * none has, its area before any turn, or for a branch that has none, the one of the chat it was made
 * from (`H/core/areas.ts:111-116`). For a chat no run imported, whose replies no turn says, the area
 * document `newest` that was written last.
 */
async function notesNow(chat: string, newest: string | null, history: NoteHistory): Promise<AreaFile[]> {
  if (history.s.chat(chat) === null) return newest === null ? [] : ((await history.areas.doc(newest))?.files ?? []);
  const shown = await history.areas.latest(chat);
  if (shown !== null) return [...shown.values()];
  const root = chatLine(history.s, chat).map((c) => areaDoc(c, "root")).find((doc) => history.areas.carried.has(doc));
  return root === undefined ? [] : ((await history.areas.doc(root))?.files ?? []);
}

/**
 * Each chat's area document written last, by chat, of those `items` carry or attach (the last by path
 * of those written at once): the notes of a chat no run imported, whose replies no turn says.
 */
export async function latestAreas(today: Today, items: readonly Item[]): Promise<Map<string, string>> {
  const latest = new Map<string, { at: number; doc: string }>();
  for (const item of items) {
    if (item.where !== "user storage" || (item.fate !== "carried" && item.fate !== "attached")) continue;
    const key = AREA_DOC.exec(item.path)?.[1];
    const chat = key === undefined ? null : chatOfKey(key);
    if (chat === null) continue;
    const raw = json(await today.userView.read(item.path));
    const at = isRecord(raw) && typeof raw.at === "number" ? raw.at : 0;
    const was = latest.get(chat);
    if (was === undefined || at > was.at || (at === was.at && item.path > was.doc)) latest.set(chat, { at, doc: item.path });
  }
  return new Map([...latest].map(([chat, { doc }]) => [chat, doc]));
}
