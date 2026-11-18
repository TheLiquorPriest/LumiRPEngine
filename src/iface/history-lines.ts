// The history lines (`guidance/.prompts/history-*.md`): the words of what the chat's history and the world's notices say, as the engine's
// pure code asks for them (`say`, `src/engine/lines.ts`). They are kept one file to a family of lines (the money's, an organization's, a
// vehicle's, the lint's problems, the refusals' reasons, the word tables and so on), each a `format: lines` part of its own, so each can be
// edited on its own. This reads the parts in force through a chat's guidance files (each from the nearest level that has it, none where it is
// switched off) and hands them to the engine as one source of lines: a line is said by the first part that holds it.

import { type LineSource, useLines, withLines } from "../engine/lines";
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
] as const;

/** Whether `path` (a file's path or its name) is the file of one of the history lines' parts. */
export function isHistoryFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return HISTORY_PARTS.some((part) => name === `${part}.md`);
}

/** The lines in force through `files`, each part from the nearest level that has it; null where no part is in force, which says nothing. */
export async function historyLines(files: Pick<GuidanceFiles, "read">): Promise<LineSource | null> {
  const read = await Promise.all(
    HISTORY_PARTS.map(async (part) => {
      const text = await files.read("prompts", part);
      return text === undefined ? null : Lines.parse(text, `.prompts/${part}.md`);
    }),
  );
  const parts = read.filter((part): part is Lines => part !== null);
  if (parts.length === 0) return null;
  return {
    line(name, fields) {
      for (const part of parts) if (part.source.has(name)) return part.line(name, fields);
      return undefined;
    },
  };
}

/** Makes the lines in force through `files` the ones the engine says (the application's, until another is installed). */
export async function installHistoryLines(files: Pick<GuidanceFiles, "read">): Promise<void> {
  useLines(await historyLines(files));
}

/**
 * Runs `work` with the lines in force through `files` (a chat's own: for each part, the nearest level that has it, the chat's before the user's before the shipped one)
 * as the lines the engine says, so what it words in `work` is worded as that chat has it. `work` must be synchronous: the lines are the chat's only until it
 * returns, and an `await` inside it ends them. The application's lines come back after, and a chat that switched every part off says nothing.
 */
export async function withHistoryLines<T>(files: Pick<GuidanceFiles, "read">, work: () => T): Promise<T> {
  return withLines(await historyLines(files), work);
}
