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
import { GLOBAL_PREFIX, PINS_PATH } from "../shared/stores";
import type { TurnRow, UserStore } from "../store";
import { readBytes, sha256 } from "./files";
import { AREA_DOC, type AreaFile, areaDoc, areaOf, chatOfKey, docKey, pathTurns, type TurnAreas } from "./history";
import { MIND_FILE } from "./inside";
import type { Item } from "./report";
import { keepWritten, type WrittenFile, writtenFiles } from "./tables";
import type { Today } from "./today";
import { agentMetaOf } from "./today/chat-agent-meta";
import { chatKnowledgePrefsOf } from "./today/chat-knowledge-prefs";
import { type SetApartReason, sortPromptTexts } from "./today/prompt-texts";
import type { Matcher } from "./model-choices";
import { lumiahSettings } from "./settings";

/** The folder, at the user's level, that his agents, skills, texts, GUIDANCE.md and prompt sets are written under, switched off: nothing is in force until he says. */
export const IMPORTED = "imported";

/** The folder, under `imported/` at the user's level, of the prompt sets today's turns recorded: each named by the hash a turn's record gives it (`Rec.prompts`). */
export const PROMPT_SETS = "prompt-sets";

/** The folders under `imported/` at the user's level of his agents and skills, where a file listing shows them: switching one on writes it where its kind is read from. */
export const IMPORTED_AGENTS = "agents";
export const IMPORTED_SKILLS = "skills";
/** Under the texts' folder: LumiAH's own texts, and those of the engine's set apart, by reason. */
export const LUMIAH_TEXTS = "lumiah";
export const SET_APART = "set-apart";

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
  /** Every tool name RPE's and RPH's shipped files and his own tool files give (`.tools/`); absent: the names of his agents' tools are not checked. */
  toolNames?(files: string): Promise<readonly string[]>;
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
  /** Every tool name RPE's and RPH's shipped files and his own tool files give, to tell a tool name of his agents' that no longer exists; absent: tool names are not checked. */
  toolNames?(): Promise<readonly string[]>;
}

export interface OwnFilesCarried {
  agents: number;
  skills: number;
  /** Every text of his attached under `imported/`: his edits of the engine's, those set apart, and LumiAH's. */
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
  /** His edited texts of LumiAH's, as they are under `prompts/lumiah/`. */
  textsLumiah: number;
  /** Texts of the engine's that today's build would not send (a placeholder it needs missing, or blank where it may not be) or whose id no build had: attached under `prompts/set-apart/<reason>/`, each with its reason. */
  textsSetApart: { id: string; reason: SetApartReason; missing: string[] }[];
  /** Texts of the engine's word for word the shipped text: not his edit, kept in the backup only, and listed by id. */
  textsShipped: string[];
  /** Ids of either store whose stored value is not a text: kept in the backup only. */
  textsNotText: string[];
  /** What each of his own agents' model choice became: the connection it named, and RPE's it is carried to, or why none. */
  agentModels: { agent: string; connection: string; carriedTo: string | null; why: string | null }[];
  /** A tool name of his own agents' that no tool of RPE's or RPH's has, listed and left out of the header; the original keeps it. */
  deadTools: { agent: string; tool: string }[];
  /** Whether the tool names were checked at all: the run was given the tools' names. */
  toolsChecked: boolean;
  /** Files pinned in today's build, to be written as pins (`pins.ts`). */
  pins: PinWanted[];
  /** The ids of his own agent definitions, which are carried switched off. */
  agentIds: string[];
  /** Each chat's notes, versions and learned files, by chat. */
  byChat: { chat: string; notes: number; versions: number; learned: number }[];
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
async function agentsWorkspace(today: Today, history: NoteHistory, chat: string): Promise<{ files: { path: string; text: string; pinned: boolean; blob: string }[]; changes: Map<string, NoteChange[]> }> {
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
  const files: { path: string; text: string; pinned: boolean; blob: string }[] = [];
  for (const [path, hash] of Object.entries(workspaceOf(head)).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const body = await text(hash);
    if (body !== null) files.push({ path, text: body, pinned: pinned[path] === true, blob: `agents/blobs/${hash}` });
  }
  return { files, changes };
}

/** The files each role's entry of a workspace's pins manifest (`.pins.json`, read as JSON) lists, as today's reader takes them: a role's list of paths, or its `files`; a file that does not read lists none. */
function pinsManifest(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [role, value] of Object.entries(raw)) {
    const files = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.files) ? value.files : [];
    const paths = files.filter((p): p is string => typeof p === "string" && p !== "" && p !== PINS_PATH);
    if (paths.length > 0) out[role] = [...new Set(paths)];
  }
  return out;
}

/** A definition's header in the new format (`name`, `description`, and for an agent its `model`, `effort`, `tools`, what it is `given` and its `limits`), and its body. */
function headed(header: Record<string, unknown>, body: string): string {
  const fields = Object.fromEntries(Object.entries(header).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(fields, null, 2).replace(/\n+$/, "")}\n---\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** How one agent of his own runs, as the header of its definition in RPE says it. */
interface Run {
  connection: string | null;
  model: string | null;
  effort: string | null;
  toolsAs: string | null;
  tools: string[];
  limits: Record<string, number>;
}

/** The efforts RPH's definitions take: today's `inherit` and `auto` have no counterpart there and leave the connection's own. */
const EFFORTS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Today's agent budget (`AgentBudget`) as the limits of a definition's header, by name, and the divisor of a time in milliseconds. */
const BUDGET_LIMITS: readonly (readonly [budget: string, limit: string, per: number])[] = [
  ["callTokensIn", "callTokensIn", 1],
  ["callTokensOut", "callTokensOut", 1],
  ["callMs", "callTime", 1000],
  ["callTools", "toolsPerAnswer", 1],
  ["tokensIn", "tokensIn", 1],
  ["tokensOut", "tokensOut", 1],
  ["toolTurns", "toolRounds", 1],
  ["wallMs", "time", 1000],
  ["revisions", "messages", 1],
  ["concurrency", "toolsAtOnce", 1],
];

const mapping = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/**
 * How his agent `id` runs: what he set for it in LumiAH's settings (`core.agents.<id>`) over what its definition holds, a field at a
 * time (as `agentSettings` reads them). While it names no connection and follows another definition, that one's connection and,
 * unless it names one, model are its own, one step as `resolveAgent` takes it.
 */
function runOf(id: string, definitions: Record<string, unknown>, settings: Record<string, unknown>): Run {
  const def = mapping(definitions[id]);
  const set = mapping(mapping(mapping(settings.core).agents)[id]);
  const field = (key: string): unknown => (Object.hasOwn(set, key) ? set[key] : def[key]);
  let connection = text(field("connectionId")) ?? null;
  let model = text(field("model")) ?? null;
  if (connection === null && typeof def.follows === "string" && def.follows !== id) {
    const base = mapping(mapping(mapping(settings.core).agents)[def.follows]);
    const upstream = mapping(definitions[def.follows]);
    connection = text(Object.hasOwn(base, "connectionId") ? base.connectionId : upstream.connectionId) ?? null;
    if (model === null) model = text(Object.hasOwn(base, "model") ? base.model : upstream.model) ?? null;
  }
  const effort = text(field("effort"));
  const toolsAs = text(field("toolCalls"));
  const budget = { ...mapping(def.budget), ...mapping(set.budget) };
  const limits: Record<string, number> = {};
  for (const [from, to, per] of BUDGET_LIMITS) {
    const v = budget[from];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) limits[to] = Math.ceil(v / per);
  }
  const tools = field("tools");
  return {
    connection,
    model,
    effort: effort !== undefined && EFFORTS.includes(effort) ? effort : null,
    toolsAs: toolsAs === "native" || toolsAs === "text" ? toolsAs : null,
    tools: Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string") : [],
    limits,
  };
}

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
export async function carryOwnFiles(today: Today, items: readonly Item[], places: TreePlaces, history: NoteHistory, models: Matcher): Promise<OwnFilesCarried> {
  const out: OwnFilesCarried = { agents: 0, skills: 0, texts: 0, textsLumiah: 0, textsSetApart: [], textsShipped: [], textsNotText: [], promptSets: 0, guidance: 0, home: 0, global: 0, notes: 0, versions: 0, removals: 0, learned: 0, workspace: 0, untied: 0, leftOut: 0, heldAsHis: 0, leftAlone: 0, kept: 0, removed: 0, oldLayout: 0, changed: 0, pins: [], agentIds: [], agentModels: [], deadTools: [], toolsChecked: false, byChat: [] };
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
    if (heldAs !== sha256(body)) {
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

  // The user's own agents and skills, under imported/agents and imported/skills in the new header format with the original beside each; and their texts, sorted by today's own reader.
  const harness = await today.userView.json("harness/settings.json");
  const definitions = isRecord(harness) && isRecord(harness.definitions) ? harness.definitions : {};
  const ownAgents = isRecord(definitions.agents) ? definitions.agents : {};
  const settings = await lumiahSettings(today);
  const tools = places.toolNames === undefined ? null : new Set(await places.toolNames());
  out.toolsChecked = tools !== null;
  for (const [id, def] of Object.entries(ownAgents)) {
    if (!isRecord(def)) continue;
    out.agentIds.push(id);
    const run = runOf(id, ownAgents, settings);
    const choice = run.connection === null ? null : models({ where: `agent ${id} of your own`, connection: run.connection, model: run.model, to: { agent: id, path: `${IMPORTED_AGENTS}/${id}.md` } });
    if (choice !== null) out.agentModels.push({ agent: id, connection: choice.connection, carriedTo: choice.carried?.id ?? null, why: choice.why });
    for (const tool of run.tools) if (tools !== null && !tools.has(tool)) out.deadTools.push({ agent: id, tool });
    const given = def.given === "request" ? ["chat:history[-1:]"] : undefined;
    const header = { name: id, description: text(def.description), model: choice?.carried?.id ?? "default", effort: run.effort ?? undefined, tools_as: run.toolsAs ?? undefined, tools: run.tools.filter((t) => tools === null || tools.has(t)), given, limits: Object.keys(run.limits).length > 0 ? run.limits : undefined };
    if (await put("", IMPORTED, `${IMPORTED_AGENTS}/${id}.md`, headed(header, text(def.instructions) ?? ""))) out.agents++;
    await put("", IMPORTED, `${IMPORTED_AGENTS}/${id}.original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  for (const [id, def] of Object.entries(isRecord(definitions.skills) ? definitions.skills : {})) {
    if (!isRecord(def)) continue;
    if (await put("", IMPORTED, `${IMPORTED_SKILLS}/${id}/SKILL.md`, headed({ name: id, description: text(def.description) }, text(def.body) ?? ""))) out.skills++;
    await put("", IMPORTED, `${IMPORTED_SKILLS}/${id}/original.json`, `${JSON.stringify(def, null, 2)}\n`);
  }
  // His edited texts of the engine: his edit as it is under imported/, one today's build would not send and one no build had set apart each under its reason, the shipped text word for word counted and listed. LumiAH's own texts as they are, each named for what it was.
  const engine = await today.userView.json("settings.json");
  const sorted = sortPromptTexts(isRecord(engine) && isRecord(engine.prompts) ? engine.prompts.texts : undefined);
  for (const t of sorted.edits) if (await put("", IMPORTED, `${places.prompts}/${t.id}.md`, t.text)) out.texts++;
  for (const t of sorted.setApart) {
    if (!(await put("", IMPORTED, `${places.prompts}/${SET_APART}/${t.reason.replaceAll("_", "-")}/${t.id}.md`, t.text))) continue;
    out.texts++;
    out.textsSetApart.push({ id: t.id, reason: t.reason, missing: t.missing });
  }
  out.textsShipped = sorted.shipped.map((t) => t.id);
  out.textsNotText = sorted.notText;
  const lumiahTexts = isRecord(harness) && isRecord(harness.texts) ? harness.texts : {};
  for (const [id, body] of Object.entries(lumiahTexts)) {
    if (typeof body !== "string") out.textsNotText.push(id);
    else if (await put("", IMPORTED, `${places.prompts}/${LUMIAH_TEXTS}/${id}.md`, body)) {
      out.texts++;
      out.textsLumiah++;
    }
  }

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
  // The agents engine's global workspace, into the global notes folder with his own `~/` files, which every chat's agents read and none writes; a file pinned in GM → Workspace is the Author's pin.
  const global = await today.userView.json("agents/global.json");
  for (const [path, f] of Object.entries(isRecord(global) && isRecord(global.files) ? global.files : {})) {
    const body = isRecord(f) && typeof f.hash === "string" ? await today.userView.read(`agents/blobs/${f.hash}`) : null;
    if (body !== null && (await put("", places.notes, path, body))) {
      out.global++;
      if (isRecord(f) && f.pinned === true) pin(null, `@global/${places.notes}/${path}`, ["main"]);
    }
  }
  // Settings → Agents → Context's pins, by role, which today's build hands each role in every chat before the workspace's own.
  const engineSettings = await today.userView.json("settings.json");
  const context = isRecord(engineSettings) && isRecord(engineSettings.agents) ? engineSettings.agents.context : null;
  const roles = isRecord(context) && isRecord(context.roles) ? context.roles : {};
  const contextPins = Object.entries(roles).flatMap(([role, c]): [string, string[]][] => (isRecord(c) && Array.isArray(c.pins) ? [[role, c.pins.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim())]] : []));
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
    const inWorkspace = new Set<string>();
    for (const f of heads?.files ?? []) if (await put(id, folder, f.path, f.text)) {
      out.workspace++;
      mine.notes++;
      inWorkspace.add(f.path);
      if (f.pinned) pin(config, `${places.notes}/${f.path}`, ["main"]);
    }
    // Settings → Agents → Context's pins and the workspace's pins manifest (`.pins.json`): each role's files, a chat's or a global `~/` one, pinned for that role.
    const manifest = heads?.files.find((f) => f.path === PINS_PATH);
    for (const [role, files] of [...contextPins, ...Object.entries(pinsManifest(manifest === undefined ? null : await today.userView.json(manifest.blob)))]) {
      for (const path of files) {
        if (path.startsWith(GLOBAL_PREFIX)) pin(null, `@global/${places.notes}/${path}`, [role]);
        else if (inWorkspace.has(path)) pin(config, `${places.notes}/${path}`, [role]);
      }
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
    const raw = await today.userView.json(item.path);
    const at = isRecord(raw) && typeof raw.at === "number" ? raw.at : 0;
    const was = latest.get(chat);
    if (was === undefined || at > was.at || (at === was.at && item.path > was.doc)) latest.set(chat, { at, doc: item.path });
  }
  return new Map([...latest].map(([chat, { doc }]) => [chat, doc]));
}
