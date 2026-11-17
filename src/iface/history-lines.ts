// The history lines (`guidance/.prompts/history-lines.md`): the words of what the chat's history and the world's notices say, as the engine's
// pure code asks for them (`say`, `src/engine/lines.ts`). This reads the part in force through a chat's guidance files (the nearest level
// that has it, none where it is switched off) and hands it to the engine as its source of lines.

import { type LineSource, useLines, withLines } from "../engine/lines";
import { type GuidanceFiles, Lines } from "./texts";

/** The history lines' part. */
export const HISTORY_PART = "history-lines";

/** The lines in force through `files`; null where the part is not in force, which says nothing. */
export async function historyLines(files: Pick<GuidanceFiles, "read">): Promise<LineSource | null> {
  const text = await files.read("prompts", HISTORY_PART);
  return text === undefined ? null : Lines.parse(text, `.prompts/${HISTORY_PART}.md`);
}

/** Makes the lines in force through `files` the ones the engine says (the application's, until another is installed). */
export async function installHistoryLines(files: Pick<GuidanceFiles, "read">): Promise<void> {
  useLines(await historyLines(files));
}

/**
 * Runs `work` with the lines in force through `files` (a chat's own: the nearest level that has the part, the chat's before the user's before the shipped one)
 * as the lines the engine says, so what it words in `work` is worded as that chat has it. `work` must be synchronous: the lines are the chat's only until it
 * returns, and an `await` inside it ends them. The application's lines come back after, and a chat whose part is switched off says nothing.
 */
export async function withHistoryLines<T>(files: Pick<GuidanceFiles, "read">, work: () => T): Promise<T> {
  return withLines(await historyLines(files), work);
}
