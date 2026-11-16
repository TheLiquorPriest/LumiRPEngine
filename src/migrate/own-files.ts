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
import { WS_DELETE, WS_WRITE, workspaceOf, workspacePins } from "../engine/workspace";
import { isRecord } from "../shared/json";
import type { TurnRow, UserStore } from "../store";
import { readBytes, sha256 } from "./files";
import { AREA_DOC, type AreaFile, areaDoc, areaOf, chatOfKey, docKey, pathTurns, type TurnAreas } from "./history";
import { MIND_FILE } from "./inside";
import type { Item } from "./report";
import { keepWritten, type WrittenFile, writtenFiles } from "./tables";
import type { Today } from "./today";
import { agentMetaOf } from "./today/chat-agent-meta";
import { chatKnowledgePrefsOf } from "./today/chat-knowledge-prefs";

/** The folder, at the user's level, that his agents, skills, texts, GUIDANCE.md and prompt sets are written under, switched off: nothing is in force until he says. */
export const IMPORTED = "imported";

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
  /** Records a note's text as the version an imported turn wrote (the old engine its writer): what the file held before and what it left; it stands where that turn stands on the chat's path (`TreeNotes.recordVersion`). */
  recordVersion(db: Database, files: string, user: string, chat: string, turn: string, path: string, before: string | null, after: string | null, by: { id: string; definition: string }, at: number, stands: boolean): Promise<void>;
  /** Forgets the versions an earlier run recorded for a chat, those whose writer is `{ id: "carried" }` (`TreeNotes.forgetCarried`). */
  forgetVersions(db: Database, files: string, user: string, chat: string): Promise<void>;
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
  /** Records a note's text as the version an imported turn wrote, for the old engine `definition` (`TreeLayout.recordVersion`, with the run's database, the tree's folder and the user given). */
  recordVersion(chat: string, turn: string, path: string, before: string | null, after: string | null, definition: string, at: number, stands: boolean): Promise<void>;
  /** Forgets the versions an earlier run recorded for a chat. */
  forgetVersions(chat: string): Promise<void>;
}

export interface OwnFilesCarried {
  agents: number;
  skills: number;
  texts: number;
  /** The prompt sets today's turns recorded, under `prompt-sets/`. */
  promptSets: number;
  guidance: number;
  home: number;
  /** The agents engine's global workspace files, in the global notes folder with the `~/` files. */
  global: number;
  notes: number;
  /** Versions of each chat's notes recorded on the turns that wrote them, in RPE's own history of notes. */
  versions: number;
  /** Of those, the notes a turn removed or moved away. */
  removals: number;
  learned: number;
  /** The agents engine's chat workspace files (counted among the notes). */
  workspace: number;
  /** Area documents of LumiAH's chat areas that no imported turn ended with (before any turn, or a generation that left no reply): in the backup only. */
  untied: number;
  /** Files whose names would leave the folder they go in: not written, in the backup only. */
  leftOut: number;
  /** Files this run would write that RPE already holds as something else (made or changed in RPE since): left as they are. */
  heldAsHis: number;
  /** Chats played on RPE, whose notes this run left as they are. */
  leftAlone: number;
  /** Chats this run did not import whose earlier import stands, whose notes an earlier run wrote: left as they are. */
  kept: number;
  /** Files an earlier run wrote that this run does not write again, as today's side no longer has them: removed, each as that run wrote it. */
  removed: number;
  /** Files of the layout an earlier build's run used (`imported/chats/` at the user's level) that were removed, where they were still as that run wrote them. */
  oldLayout: number;
  /** Files an earlier run wrote that today's side no longer has, changed in RPE since: left as they are, and no longer the migration's. */
  changed: number;
  /** Files pinned in today's build, to be written as pins (`pins.ts`). */
  pins: PinWanted[];
  /** The ids of his own agent definitions, which are carried switched off. */
  agentIds: string[];
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

/** A file pinned in today's build for a definition (`FileEntry.pins`, or the agents engine's pin on a workspace file): the config it is written in (null: the global one), the file as that level's view names it, and the definition's id as today's build had it. */
export interface PinWanted {
  config: string | null;
  file: string;
  role: string;
}

/** A note a turn wrote or removed, by its path: its text before and after. */
interface NoteChange {
  path: string;
  before: string | null;
  after: string | null;
}

/**
 * The agents engine's workspace over a chat's imported turns: its files as the chat's head holds them, each with whether it is
 * pinned, and, by turn, what the turn wrote or removed (the turn's `engine.ws.write` and `engine.ws.delete` changes, against the
 * workspace the turn started from), with the texts of the blobs they name. A text today's clean-up had removed leaves its file out.
 */
async function agentsWorkspace(today: Today, history: NoteHistory, chat: string): Promise<{ files: { path: string; text: string; pinned: boolean }[]; changes: Map<string, NoteChange[]> }> {
  const text = async (hash: string | undefined): Promise<string | null> => (hash === undefined ? null : today.userView.read(`agents/blobs/${hash}`));
  const changes = new Map<string, NoteChange[]>();
  for (const { turn } of pathTurns(history.db, history.s, chat)) {
    const wrote = history.s.changes(turn.id).filter((c) => c.applied && (c.op === WS_WRITE || c.op === WS_DELETE));
    if (wrote.length === 0) continue;
    const start = workspaceOf(history.s.startOf(turn.id).state.world);
    const end: Record<string, string> = { ...start };
    for (const c of wrote) {
      const data = isRecord(c.value) && isRecord(c.value.data) ? c.value.data : {};
      if (typeof data.path !== "string") continue;
      if (c.op === WS_WRITE && typeof data.hash === "string") end[data.path] = data.hash;
      else delete end[data.path];
    }
    const list: NoteChange[] = [];
    for (const path of [...new Set([...Object.keys(start), ...Object.keys(end)])].sort()) {
      if (start[path] === end[path]) continue;
      const [before, after] = [await text(start[path]), await text(end[path])];
      if ((start[path] !== undefined && before === null) || (end[path] !== undefined && after === null)) continue;
      list.push({ path, before, after });
    }
    if (list.length > 0) changes.set(turn.id, list);
  }
  const head = history.s.headState(chat).state.world;
  const pinned = workspacePins(head);
  const files: { path: string; text: string; pinned: boolean }[] = [];
  for (const [path, hash] of Object.entries(workspaceOf(head)).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const body = await text(hash);
    if (body !== null) files.push({ path, text: body, pinned: pinned[path] === true });
  }
  return { files, changes };
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
  const out: OwnFilesCarried = { agents: 0, skills: 0, texts: 0, promptSets: 0, guidance: 0, home: 0, global: 0, notes: 0, versions: 0, removals: 0, learned: 0, workspace: 0, untied: 0, leftOut: 0, heldAsHis: 0, leftAlone: 0, kept: 0, removed: 0, oldLayout: 0, changed: 0, pins: [], agentIds: [], byChat: [] };
  const wrote: WrittenFile[] = [];
  const earlier = new Map(writtenFiles(history.db, history.s.id).map((f) => [`${f.base}\u0000${f.path}`, f.sha256]));
  /**
   * Writes one file, by its path below the folder `base` of the tree's: the user's level's, or a chat's notes' (`chat`, "" for none).
   * A name that would leave the folder it goes in is counted as left out, and stays in the backup. A file RPE holds there that is not
   * what an earlier run wrote (one he made or changed, or a job of his) is never written over: it is left, and counted.
   */
  const put = async (chat: string, base: string, path: string, body: string): Promise<boolean> => {
    if (!staysInside(path)) {
      out.leftOut++;
      return false;
    }
    const disk = join(places.root, base, path);
    const held = await readBytes(disk);
    const heldAs = held === null ? null : sha256(held);
    if (heldAs !== null && heldAs !== sha256(body) && heldAs !== earlier.get(`${base}\u0000${path}`)) {
      out.heldAsHis++;
      return false;
    }
    if (heldAs === null) {
      await mkdir(dirname(disk), { recursive: true });
      await writeWhole(disk, body);
    }
    wrote.push({ chat, base, path, sha256: sha256(body) });
    return true;
  };
  /** Pinned files to write as pins, once the notes they name are there. */
  const pin = (config: string | null, file: string, roles: readonly string[]): void => {
    for (const role of roles) out.pins.push({ config, file, role });
  };

  // The user's own agents and skills, in the new header format with the original beside each; and their edited texts.
  const harness = json(await today.userView.read("harness/settings.json"));
  const definitions = isRecord(harness) && isRecord(harness.definitions) ? harness.definitions : {};
  for (const [id, def] of Object.entries(isRecord(definitions.agents) ? definitions.agents : {})) {
    if (!isRecord(def)) continue;
    out.agentIds.push(id);
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
        } else if (await put("", places.notes, f.path, f.text)) {
          out.home++;
          pin(null, `@global/${places.notes}/${f.path}`, f.pins);
        }
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
  // A chat RPE's store holds that this run did not import keeps what an earlier run wrote for it: it was played on RPE, or its earlier import stands.
  const keeps = (chat: string): boolean => chat !== "" && !history.carried.has(chat) && history.s.chat(chat) !== null;
  // The agents engine's global workspace, into the global notes folder with his own `~/` files, which every chat's agents read and none writes.
  const global = json(await today.userView.read("agents/global.json"));
  for (const [path, f] of Object.entries(isRecord(global) && isRecord(global.files) ? global.files : {})) {
    const body = isRecord(f) && typeof f.hash === "string" ? await today.userView.read(`agents/blobs/${f.hash}`) : null;
    if (body !== null && (await put("", places.notes, path, body))) out.global++;
  }
  // Each chat's into its own notes folder, placed as RPE places the chat: by its name and its character's, as Lumiverse has them.
  for (const id of [...new Set([...history.carried, ...latest.keys(), ...learned.keys()])].sort()) {
    if (keeps(id)) {
      if (places.played(id)) out.leftAlone++;
      else out.kept++;
      continue;
    }
    // A branch reads as LumiAH gave it its files: its turns' areas, the ones it shares included; and the learned/ of the chat it was made from, until it has its own.
    const now = (await notesNow(id, latest.get(id) ?? null, history)).filter((f) => !MIND_FILE.test(f.path));
    const doc = chatLine(history.s, id).map((c) => learned.get(c)).find((d) => d !== undefined);
    const knows = doc === undefined ? [] : ((await history.areas.doc(doc))?.files ?? []);
    const row = today.chats.find((c) => c.id === id);
    const imported = history.s.chat(id) !== null && history.carried.has(id);
    const heads = imported ? await agentsWorkspace(today, history, id) : null;
    const keptLearned = Object.entries(agentMetaOf(row?.metadata ?? {}).learned);
    if (now.length === 0 && knows.length === 0 && (heads === null || heads.files.length === 0) && keptLearned.length === 0) continue;
    const character = row === undefined || row.character === null ? null : today.db.character(row.character);
    const folder = `${await places.chat(id, { character, chat: { name: row?.name ?? "" } })}/${places.notes}`;
    const config = join(places.root, dirname(folder), "RPE.yml");
    const mine = { chat: id, notes: 0, versions: 0, learned: 0 };
    for (const f of now) if (await put(id, folder, f.path, f.text)) {
      mine.notes++;
      pin(config, `${places.notes}/${f.path}`, f.pins);
    }
    for (const f of knows) if (await put(id, folder, `learned/${f.path}`, f.text)) mine.learned++;
    for (const f of heads?.files ?? []) if (await put(id, folder, f.path, f.text)) {
      out.workspace++;
      mine.notes++;
      if (f.pinned) pin(config, `${places.notes}/${f.path}`, ["main"]);
    }
    for (const [path, file] of keptLearned) {
      const body = await today.userView.read(`agents/blobs/${file.hash}`);
      if (body !== null && (await put(id, folder, path, body))) mine.learned++;
    }
    // Each version of a note, on the turn that wrote it, in RPE's own history of notes: showing an earlier carried reply puts its notes back.
    if (imported) {
      await places.forgetVersions(id);
      const definition = chatKnowledgePrefsOf(row?.metadata ?? {}).engine ?? "classic";
      const standing = history.s.path(id);
      const record = async (turn: TurnRow, at: number, change: { path: string; before: string | null; after: string | null }): Promise<void> => {
        await places.recordVersion(id, turn.id, change.path, change.before, change.after, definition, turn.created, standing[at]?.turn === turn.id);
        mine.versions++;
        if (change.after === null) out.removals++;
      };
      for (const { turn, at } of pathTurns(history.db, history.s, id)) {
        for (const c of (await history.areas.changesAt(turn, (path) => !MIND_FILE.test(path))) ?? []) await record(turn, at, { path: c.path, before: c.was?.text ?? null, after: c.now?.text ?? null });
        for (const c of heads?.changes.get(turn.id) ?? []) await record(turn, at, c);
      }
      out.untied += [...history.areas.carried].filter((doc) => AREA_DOC.exec(doc)?.[1] === docKey(id) && !history.areas.tied.has(doc)).length;
    }
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
    if (f.base === IMPORTED && f.path.startsWith("chats/")) out.oldLayout++;
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
