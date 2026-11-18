// The history lines (`guidance/.prompts/history-*.md`): the words of what the chat's history and the world's notices say, as the engine's
// pure code asks for them (`say`, `src/shared/lines.ts`). They are kept one file to a family of lines (the money's, an organization's, a
// vehicle's, the lint's problems, the refusals' reasons, the word tables and so on), each a `format: lines` part of its own, so each can be
// edited on its own. This reads the parts in force through a chat's guidance files (each from the nearest level that has it, none where it is
// switched off) and hands them to the engine as one source of lines: a line is said by the first part that holds it.

import { type LineSource, useLines, withLines } from "../shared/lines";
import { type GuidanceFiles, Lines } from "./texts";

/** The history lines' parts, each the file `.prompts/<part>.md`, in the order a line is looked for in them. */
export const HISTORY_PARTS = [
  "history-money",
  "history-orgs",
  "history-routines",
  "history-fights",
  "history-vehicles",
  "history-calendar",
  "history-lint",
  "history-refusals",
  "history-words",
  "history-narrator",
  "history-engine",
  "history-minds",
  "history-records",
  "history-journal",
  "history-world",
  "history-actions",
  "history-build",
  "history-migration",
] as const;

/** Whether `path` (a file's path or its name) is the file of one of the history lines' parts. */
export function isHistoryFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return HISTORY_PARTS.some((part) => name === `${part}.md`);
}

/** The text of each history part in force, by the part's name: what a thread that cannot read the files is handed (`linesOf` makes the lines of it). A part that is not in force is not in it. */
export type HistoryTexts = Readonly<Record<string, string>>;

/** The text of each history part in force through `files`, each from the nearest level that has it, none where it is switched off. */
export async function historyTexts(files: Pick<GuidanceFiles, "read">): Promise<HistoryTexts> {
  const read = await Promise.all(HISTORY_PARTS.map(async (part) => [part, await files.read("prompts", part)] as const));
  return Object.fromEntries(read.filter((part): part is readonly [(typeof HISTORY_PARTS)[number], string] => part[1] !== undefined));
}

/** The lines the parts' texts hold, a line said by the first part that holds it; null where no part is in force, which says nothing. The one place the texts become lines, on every thread. */
export function linesOf(texts: HistoryTexts): LineSource | null {
  const parts = HISTORY_PARTS.flatMap((part) => (texts[part] === undefined ? [] : [Lines.parse(texts[part], `.prompts/${part}.md`)]));
  if (parts.length === 0) return null;
  return {
    line(name, fields) {
      for (const part of parts) if (part.source.has(name)) return part.line(name, fields);
      return undefined;
    },
  };
}

/** The lines in force through `files`; null where no part is in force, which says nothing. */
export async function historyLines(files: Pick<GuidanceFiles, "read">): Promise<LineSource | null> {
  return linesOf(await historyTexts(files));
}

/** Makes the texts the lines the engine says on this thread (the application's, until others are installed). */
export function installHistoryTexts(texts: HistoryTexts): void {
  useLines(linesOf(texts));
}

/** Makes the lines in force through `files` the ones the engine says on this thread, and gives back their texts, for the other threads to be handed. */
export async function installHistoryLines(files: Pick<GuidanceFiles, "read">): Promise<HistoryTexts> {
  const texts = await historyTexts(files);
  installHistoryTexts(texts);
  return texts;
}

/**
 * Runs `work` with the lines in force through `files` (a chat's own: for each part, the nearest level that has it, the chat's before the user's before the shipped one)
 * as the lines the engine says, so what it words in `work` is worded as that chat has it. `work` must be synchronous: the lines are the chat's only until it
 * returns, and an `await` inside it ends them. The application's lines come back after, and a chat that switched every part off says nothing.
 */
export async function withHistoryLines<T>(files: Pick<GuidanceFiles, "read">, work: () => T): Promise<T> {
  return withLines(await historyLines(files), work);
}
