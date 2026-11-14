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
// (`H/core/workspace.ts:41-53`). A chat's notes are its area at its latest turn, and versioned by
// turn (§15.2): every earlier version is kept under `turns/`, in a folder for the turn that wrote it
// (`message-<n>-swipe-<k>`, the chat's first message counting as 0), holding the files that turn
// changed; an area no imported turn names holds all its files, in `before-any-turn` or
// `generation-<id>`. Its mind files are the characters' (`minds.ts`), not the Author's.

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { YAML } from "bun";
import { writeWhole } from "../app/disk";
import type { Migration, MigrationArea } from "../app/migrations";
import { isRecord } from "../shared/json";
import type { UserStore } from "../store";
import { AREA_DOC, type AreaFile, areaOf, carriedAreas, importedTurns, type TurnAreas } from "./history";
import { MIND_FILE } from "./inside";
import type { Item } from "./report";
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
  learned: number;
  /** Files whose names would leave the folder they go in: not written, in the backup only. */
  leftOut: number;
  /** Chats played on RPE, whose notes this run left as they are. */
  leftAlone: number;
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

/** What a run's import holds of each chat, for its notes' earlier versions: RPE's database, the user's store, and each turn's area. */
export interface NoteHistory {
  db: Database;
  s: UserStore;
  areas: TurnAreas;
}

/**
 * Each earlier version of a chat's notes, by the folder it is kept in under `turns/`: for each area
 * document of the chat that an imported turn names, the files that turn changed; for the others, all
 * their files. Mind files are left to their own row.
 */
async function noteVersions(today: Today, chat: string, docs: readonly string[], history: NoteHistory): Promise<Map<string, AreaFile[]>> {
  const out = new Map<string, AreaFile[]>();
  const notes = (path: string): boolean => !MIND_FILE.test(path);
  const numbers = new Map(history.s.chat(chat) === null ? [] : history.s.path(chat).map((m, i) => [m.message, i]));
  for (const { turn, message, swipe } of importedTurns(history.db, history.s, chat)) {
    const at = numbers.get(message);
    const changed = at === undefined ? null : await history.areas.changesAt(turn, notes);
    const files = (changed ?? []).flatMap((c) => (c.now === null ? [] : [c.now]));
    if (files.length > 0) out.set(`message-${at}-swipe-${swipe}`, files);
  }
  for (const doc of docs) {
    if (history.areas.tied.has(doc)) continue;
    const generation = AREA_DOC.exec(doc)?.[2] ?? "";
    const files = ((await areaOf(today, doc))?.files ?? []).filter((f) => notes(f.path));
    if (files.length > 0) out.set(generation === "root" ? "before-any-turn" : `generation-${generation}`, files);
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

/**
 * Writes the user's own files under `imported/` at the user's level, and each chat's notes under
 * `imported/` in that chat's own notes folder, with every earlier version by the turn that wrote it.
 * `items` are the report's: only what it classifies as carried or attached is read, so a chat gone
 * from Lumiverse or one LumiAH was told to forget is left in the backup. A chat played on RPE keeps
 * the notes it has: they are RPE's now.
 */
export async function carryOwnFiles(today: Today, items: readonly Item[], places: TreePlaces, history: NoteHistory): Promise<OwnFilesCarried> {
  const out: OwnFilesCarried = { agents: 0, skills: 0, texts: 0, promptSets: 0, guidance: 0, home: 0, notes: 0, versions: 0, learned: 0, leftOut: 0, leftAlone: 0, byChat: [] };
  /** Writes one file, by its path below the tree's folder; a name that would leave the folder it goes in is counted as left out, and stays in the backup. */
  const put = async (path: string, body: string): Promise<boolean> => {
    if (!staysInside(path)) {
      out.leftOut++;
      return false;
    }
    await mkdir(dirname(join(places.root, path)), { recursive: true });
    await writeWhole(join(places.root, path), body);
    return true;
  };

  // The user's own agents and skills, in the new header format with the original beside each; and their edited texts.
  const harness = json(await today.userView.read("harness/settings.json"));
  const definitions = isRecord(harness) && isRecord(harness.definitions) ? harness.definitions : {};
  for (const [id, def] of Object.entries(isRecord(definitions.agents) ? definitions.agents : {})) {
    if (!isRecord(def)) continue;
    const tools = Array.isArray(def.tools) ? def.tools.filter((t): t is string => typeof t === "string") : undefined;
    if (await put(`${IMPORTED}/${places.agents}/${id}.md`, headed({ name: id, description: text(def.description), tools }, text(def.instructions) ?? ""))) out.agents++;
    await put(`${IMPORTED}/${places.agents}/${id}.original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  for (const [id, def] of Object.entries(isRecord(definitions.skills) ? definitions.skills : {})) {
    if (!isRecord(def)) continue;
    if (await put(`${IMPORTED}/${places.skills}/${id}/SKILL.md`, headed({ name: id, description: text(def.description) }, text(def.body) ?? ""))) out.skills++;
    await put(`${IMPORTED}/${places.skills}/${id}/original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  const engine = json(await today.userView.read("settings.json"));
  const texts = { ...(isRecord(engine) && isRecord(engine.prompts) && isRecord(engine.prompts.texts) ? engine.prompts.texts : {}), ...(isRecord(harness) && isRecord(harness.texts) ? harness.texts : {}) };
  for (const [id, body] of Object.entries(texts)) if (typeof body === "string" && (await put(`${IMPORTED}/${places.prompts}/${id}.md`, body))) out.texts++;

  // LumiAH's areas: `~/` (GUIDANCE.md apart), and each chat's learned/ and its area at its latest turn; and the prompt sets turns recorded, word for word, each by the hash its turns' records name it by.
  const learned = new Map<string, string>();
  for (const item of items) {
    if (item.where !== "user storage" || (item.fate !== "carried" && item.fate !== "attached")) continue;
    if (item.path === "harness/docs/workspace/user.json") {
      for (const f of (await areaOf(today, item.path))?.files ?? []) {
        if (f.path === "GUIDANCE.md") {
          if (await put(`${IMPORTED}/GUIDANCE.md`, f.text)) out.guidance++;
        } else if (await put(`${IMPORTED}/home/${f.path}`, f.text)) out.home++;
      }
      continue;
    }
    const set = /^prompts\/sets\/([0-9a-f]{32}\.json)$/.exec(item.path)?.[1];
    if (set !== undefined) {
      const body = await today.userView.read(item.path);
      if (body !== null && (await put(`${IMPORTED}/${PROMPT_SETS}/${set}`, body))) out.promptSets++;
      continue;
    }
    const chat = /^harness\/docs\/chats\/([^/]+)\/learned\.json$/.exec(item.path)?.[1];
    if (chat !== undefined) learned.set(chat, item.path);
  }
  const latest = await latestAreas(today, items);
  const areas = [...carriedAreas(items)];
  // Each chat's into its own notes folder, placed as RPE places the chat: by its name and its character's, as Lumiverse has them.
  for (const id of [...new Set([...latest.keys(), ...learned.keys()])].sort()) {
    if (places.played(id)) {
      out.leftAlone++;
      continue;
    }
    const row = today.chats.find((c) => c.id === id);
    const character = row === undefined || row.character === null ? null : today.db.character(row.character, today.sources.userId);
    const notes = `${await places.chat(id, { character, chat: { name: row?.name ?? "" } })}/${places.notes}/${IMPORTED}`;
    const mine = { chat: id, notes: 0, versions: 0, learned: 0 };
    const area = latest.get(id);
    if (area !== undefined) for (const f of (await areaOf(today, area))?.files ?? []) if (!MIND_FILE.test(f.path) && (await put(`${notes}/${f.path}`, f.text))) mine.notes++;
    const docs = areas.filter((doc) => AREA_DOC.exec(doc)?.[1] === id);
    for (const [folder, files] of await noteVersions(today, id, docs, history)) for (const f of files) if (await put(`${notes}/${VERSIONS}/${folder}/${f.path}`, f.text)) mine.versions++;
    const doc = learned.get(id);
    if (doc !== undefined) for (const f of (await areaOf(today, doc))?.files ?? []) if (await put(`${notes}/learned/${f.path}`, f.text)) mine.learned++;
    out.byChat.push(mine);
    out.notes += mine.notes;
    out.versions += mine.versions;
    out.learned += mine.learned;
  }
  return out;
}

/**
 * Each chat's area at its latest turn, by chat: of the area documents `items` carry or attach, the
 * one written last, and the last by path of those written at once. Earlier turns' are in the backup
 * only.
 */
export async function latestAreas(today: Today, items: readonly Item[]): Promise<Map<string, string>> {
  const latest = new Map<string, { at: number; doc: string }>();
  for (const item of items) {
    if (item.where !== "user storage" || (item.fate !== "carried" && item.fate !== "attached")) continue;
    const chat = /^harness\/docs\/chats\/([^/]+)\/area\/[^/]+\.json$/.exec(item.path)?.[1];
    if (chat === undefined) continue;
    const raw = json(await today.userView.read(item.path));
    const at = isRecord(raw) && typeof raw.at === "number" ? raw.at : 0;
    const was = latest.get(chat);
    if (was === undefined || at > was.at || (at === was.at && item.path > was.doc)) latest.set(chat, { at, doc: item.path });
  }
  return new Map([...latest].map(([chat, { doc }]) => [chat, doc]));
}
