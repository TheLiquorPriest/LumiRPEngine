// RPE's file tree on disk (plan §5): one folder under the data folder, `files/`, whose root is the
// global level. Under it, `defaults/` is the shipped level (read-only, laid out again at every start),
// and `chats/<character or group>-<id8>/` a character level, with each of its chats' levels in it as
// `<chat>-<id8>/`. A chat's folder is the agents' root; the other levels appear under their mounts.
//
//   files/RPE-global.yml        the user's global config (connections live in it too)
//   files/ALL-AGENTS.md …       the user's own global files, beside .agents/ .rules/ .skills/ …
//   files/persistent-workspace/ the global notes (R-175): every chat's agents read them, he writes them
//   files/defaults/             every shipped file: RPH's own, with RPE's laid over them
//   files/chats/<c>/            AGENTS.md, agents/, rules/, skills/ of a character
//   files/chats/<c>/<chat>/     RPE.yml, the chat's files, rules/ skills/ agents/ hooks/,
//                               persistent-workspace/{story,engine,prose,notes}/, sessions/
//
// Every folder the plan draws is made with its level: the global level's at every start, a character's
// and a chat's when the chat is first placed (and again at each placing, should one have gone); no file
// is made. The folder names of a chat are chosen once, when RPE first meets the chat, and kept
// (`chats.ts`): a character or chat renamed in Lumiverse keeps its folder.

import type { GuidanceKind, LayerLevel } from "rp-harness/contract";
import { GLOBAL_CONFIG_FILE, SHIPPED_FOLDER } from "../app/config";

/** Where each level other than the chat's appears in the agents' view: the same in every host. */
export const MOUNTS = { shipped: "@shipped/", global: "@global/", character: "@character/" } as const satisfies Record<Exclude<LayerLevel, "chat">, string>;

/** The shipped level's folder under the tree's root, as the data folder's own layout names it (`src/app/config.ts`). */
export { SHIPPED_FOLDER };
/** The folder of the character levels under the tree's root. */
export const CHATS_FOLDER = "chats";
/** The config file of the shipped and global levels (plan §5.4 "Config"), as the data folder's own layout names it. */
export const GLOBAL_CONFIG = GLOBAL_CONFIG_FILE;
/** A chat's config file. */
export const CHAT_CONFIG = "RPE.yml";
/** The keys of a level's config file the files layer reads (RPH's `CONFIG_KEYS`): the files switched off, read at every level, added for a kind of turn, added to stacks, and pinned. */
export const FILE_KEYS = { off: "off", layered: "layered", added: "added", instructions: "instructions", pins: "pins" } as const;
/** The name a scope gives for "no chat" where the harness asks for a chat's stack but a page names none: no chat has an id that begins with `~`, so it is never placed, and its view is the shipped and global levels alone. */
export const NO_CHAT = "~no-chat";
/** The chat's notes (plan §5 `persistent-workspace/`): agents read and write them. */
export const NOTES_FOLDER = "persistent-workspace";
/** The folders of a chat's notes (plan §5 `story/ engine/ prose/ notes/`), each of the notes kind. */
export const NOTE_FOLDERS = ["story", "engine", "prose", "notes"] as const;
/** The chat's sessions (plan §5 `sessions/<session-id>/`), each with its turns' folders. */
export const SESSIONS_FOLDER = "sessions";
/** Where the owner's jobs of no chat keep their notes and sessions (C-23), under the tree's folder: in such a job's view its notes folder and `sessions/` stand at the root, and nothing else of a chat's level. RPE serves one user, so it is one folder. */
export const JOBS_FOLDER = "jobs";
/** A session's turn folders. */
export const TURNS_FOLDER = "turns";
/** The folders of a turn agents may write in (plan §5.1). */
export const TURN_WRITABLE = ["queries", "scratch", "output", "cache"] as const;
/** The turn's transcripts (plan §5.3): each agent's own traffic, RPH's alone to write (`<definition>-<handle>.jsonl`, and the requests beside them). */
export const TURN_TRANSCRIPTS = "transcripts";
/** RPE's trace of the turn at the top of its folder (or of a session's, for a job of no turn): each record as RPH gave it, its agent's traffic left to the transcripts. */
export const TURN_TRACE = "trace.jsonl";
/** Generated files at the top of a chat's folder (plan §5.1). */
export const GENERATED_FILES: readonly string[] = ["LORE-INDEX.md", "PROMPT-MAP.md"];

/** The guidance folders of the shipped and global levels. */
export const GLOBAL_FOLDERS = { agents: ".agents", skills: ".skills", rules: ".rules", hooks: ".hooks", prompts: ".prompts", tools: ".tools" } as const satisfies Record<GuidanceKind, string>;
/** The guidance folders of a character level (plan §5: `AGENTS.md, rules/, agents/, skills/`). Its other folders are its chats. */
export const CHARACTER_FOLDERS = { agents: "agents", rules: "rules", skills: "skills" } as const satisfies Partial<Record<GuidanceKind, string>>;
/** The guidance folders of a chat (plan §5). */
export const CHAT_FOLDERS = { agents: "agents", rules: "rules", skills: "skills", hooks: "hooks" } as const satisfies Partial<Record<GuidanceKind, string>>;

/** Fixed: how many characters of a name a folder keeps before its id. */
const NAME_CHARS = 40;

/** The first eight letters and digits of an id: enough to tell a character's chats apart by eye. */
export function id8(id: string): string {
  const kept = id.replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 8);
  return kept === "" ? "0" : kept;
}

/** A name as a folder holds it: plain lower-case letters and digits joined by "-", so that no two spellings of one name on a case-blind disk differ. */
export function slug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_CHARS)
    .replace(/-+$/g, "");
}

/** A folder named for a thing and its id: `<name>-<id8>`, or `<id8>` alone for a name with nothing a folder keeps. */
export function folderFor(name: string, id: string): string {
  const named = slug(name);
  return named === "" ? id8(id) : `${named}-${id8(id)}`;
}

/** A turn's folder: its number on its path (from 1) and its id's first letters, as plan §5 writes it. */
export function turnFolderName(n: number, turn: string): string {
  return `turn-${n}-${id8(turn)}`;
}

/** What a chat's folder takes is told by area (the Storage page): its notes, its turn folders, its sessions' own files, and the rest of its files. */
export type StorageArea = "notes" | "turns" | "sessions" | "files";

/** The area of a file of a chat by its segments below the chat's folder. */
export function areaOf(rest: readonly string[]): StorageArea {
  if (rest[0] === NOTES_FOLDER) return "notes";
  if (rest[0] === SESSIONS_FOLDER) return rest[2] === TURNS_FOLDER ? "turns" : "sessions";
  return "files";
}
