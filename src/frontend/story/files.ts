// The chat's area of LumiAH's workspace as the story pages reach it: the files of a principal's
// mind (`minds/<id>/`) and the author's notebook (`author/`). The drawer hands the port in from
// `harness/pages.tsx`, which asks LumiAH's backend with its own page requests (`lah.ws.*`), so
// nothing here imports LumiAH. A write names the version it was made on: another write since is a
// conflict, and the page reads the file again. Which files a mind and the notebook hold, in order,
// and when the author last reflected are pure, so they are tested without a browser.

import { AUTHOR_FILE, HARNESS_AGENT } from "../../shared/harness-texts";
import { PREPARE_PATH } from "../../shared/harness-texts-prepare";
import { MIND_FILE_IDS, type MindFileId } from "../../shared/settings";

/** A file of the chat's area, as the pages show it: who last wrote it (the player, or an agent by its definition's id) and its version, which a write names. */
export interface StoryFile {
  path: string;
  chars: number;
  at: number;
  by: { who: "user" } | { who: "agent"; agent: string };
  version: string;
}

/** A read or write the workspace refused, in its own words: `conflict` where the file changed since it was read, `missing` where it isn't there. */
export interface FilesFailed {
  failed: string;
  code: "conflict" | "missing" | "other";
}

/** The chat's area of LumiAH's workspace, as it stands at the chat's latest reply. */
export interface StoryFiles {
  /** The files whose path starts with `prefix`. */
  list(chatId: string, prefix: string): Promise<StoryFile[] | FilesFailed>;
  read(chatId: string, path: string): Promise<{ text: string; version: string } | FilesFailed>;
  /** Writes as the player; `base`, the version the text was made on (null: a new file). */
  write(chatId: string, path: string, text: string, base: string | null): Promise<{ file: StoryFile } | FilesFailed>;
}

/** What a mind's file holds, in the pages' words. */
export const MIND_FILE_LABEL: Readonly<Record<MindFileId, { title: string; note: string }>> = {
  core: { title: "Who they are", note: "Their heart and history. The author writes it, and so can you." },
  now: { title: "Right now", note: "Where they are and what fills their mind at this moment." },
  memory: { title: "Memory", note: "What they remember, in their own words." },
  beliefs: { title: "Beliefs", note: "What they hold true, rightly or not." },
  people: { title: "People", note: "How they see the people in their life." },
  plans: { title: "Plans", note: "What they mean to do." },
  outline: { title: "Their past in outline", note: "What they know only in outline of a past they didn't relive." },
  profile: { title: "Profile", note: "All a supporting character has: the author keeps it short." },
};

/** A file of a mind's folder: the known ones by id, in order, then any other the folder holds. */
export interface MindEntry {
  path: string;
  id: MindFileId | null;
  file: StoryFile | null;
}

/** The files of the mind in `folder`: each known file in order (null where it isn't written yet: a supporting character's profile alone, a principal's every file but the profile), then the rest. */
export function mindEntries(folder: string, files: readonly StoryFile[], principal: boolean): MindEntry[] {
  const inFolder = files.filter((f) => f.path.startsWith(folder));
  const known = MIND_FILE_IDS.filter((id) => (principal ? id !== "profile" : id === "profile"));
  const entries: MindEntry[] = known.map((id) => {
    const path = `${folder}${id}.md`;
    return { path, id, file: inFolder.find((f) => f.path === path) ?? null };
  });
  for (const file of inFolder) if (!entries.some((e) => e.path === file.path)) entries.push({ path: file.path, id: MIND_FILE_IDS.find((id) => file.path === `${folder}${id}.md`) ?? null, file });
  return entries;
}

/** The notebook's pages in the pages' words, by path. */
export const NOTEBOOK_LABEL: Readonly<Record<string, string>> = {
  [AUTHOR_FILE.notebook]: "The index",
  [AUTHOR_FILE.threads]: "Threads",
  [AUTHOR_FILE.questions]: "Open questions",
  [AUTHOR_FILE.setups]: "Setups",
  [AUTHOR_FILE.arcs]: "Arcs",
  [AUTHOR_FILE.player]: "The player",
  [AUTHOR_FILE.futures]: "Futures",
  [AUTHOR_FILE.scene]: "The scene",
  [PREPARE_PATH]: "The prepared start",
};

/** The notebook's files: its pages in the author's order, then anything else it keeps under `author/`, by name. */
export function notebookFiles(files: readonly StoryFile[]): StoryFile[] {
  const order = Object.values(AUTHOR_FILE) as string[];
  const rank = (path: string) => (order.includes(path) ? order.indexOf(path) : order.length);
  return files.filter((f) => f.path.startsWith("author/")).sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

/** When the author last wrote in its notebook, by reflecting: the newest of its own writes there; null where it has written none. */
export function lastReflected(files: readonly StoryFile[]): number | null {
  const own = files.filter((f) => f.path.startsWith("author/") && f.by.who === "agent" && f.by.agent === HARNESS_AGENT.author);
  return own.length === 0 ? null : Math.max(...own.map((f) => f.at));
}

/** Who last wrote a file, in a few words. */
export function writerWords(file: StoryFile, agentName: (agent: string) => string): string {
  return file.by.who === "user" ? "you" : agentName(file.by.agent);
}

/** A file's name as a list shows it: its label where the page has one, else its name in its folder. */
export function fileTitle(path: string, folder: string): string {
  const label = NOTEBOOK_LABEL[path];
  if (label !== undefined) return label;
  const id = MIND_FILE_IDS.find((m) => path === `${folder}${m}.md`);
  return id ? MIND_FILE_LABEL[id].title : path.slice(folder.length);
}
