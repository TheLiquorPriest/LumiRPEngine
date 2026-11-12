// The author's notebook and scene page in the chat's workspace (DEPTH2-PLAN §4, "Workspace files"):
// each file is given its first shape where it doesn't exist yet (a heading and what the page is for,
// the user's own wording where they wrote one, `harness-texts.ts`), and the notebook's index and the
// scene are pinned for the author, so LumiAH leads every turn of the author's with them. Nothing here
// writes any of the story: the author writes its notebook and the scene itself, by reflecting, with
// LumiAH's workspace tools. A file that exists is never touched, whatever it holds: the author's, or
// the user's own edit.

import { AUTHOR_FILE, type AuthorFile, HARNESS_AGENT, HARNESS_TEXT } from "../../shared/harness-texts";
import type { PromptTexts } from "../../shared/prompts";
import type { HarnessFiles } from "../agents/tools/harness-ports";
import { renderPrompt } from "../prompts";

/** The chat's area of LumiAH's workspace as the notebook reaches it: its files, a write that names the version it was made on (null: a new file), and a pin for one agent definition. */
export interface NotebookPort extends Pick<HarnessFiles, "list" | "write"> {
  pin(path: string, agent: string): Promise<void>;
}

/** What shaping did: the files it gave their first shape, and those it couldn't, with LumiAH's own words for why. */
export interface NotebookShaped {
  shaped: string[];
  refused: { path: string; reason: string }[];
}

/** The author's pages pinned for it, which LumiAH puts before the first thing it is sent each turn: the notebook's index and the scene as it stands. */
const PINNED: readonly AuthorFile[] = ["notebook", "scene"];

/**
 * Gives each of the author's files that doesn't exist yet its first shape, in `texts`, and pins the
 * notebook's index and the scene for the author once each exists (a pin already there stays as it
 * is). A file written meanwhile by someone else is theirs: it is left as they wrote it. Any other
 * refusal is answered, never thrown: the turn plays on without that page.
 */
export async function shapeNotebook(port: NotebookPort, texts: PromptTexts): Promise<NotebookShaped> {
  const held = new Set((await port.list("author/")).map((file) => file.path));
  const out: NotebookShaped = { shaped: [], refused: [] };
  for (const file of Object.keys(AUTHOR_FILE) as AuthorFile[]) {
    const path = AUTHOR_FILE[file];
    if (held.has(path)) continue;
    const written = await port.write(path, renderPrompt(HARNESS_TEXT.notebook(file), texts, {}), null);
    if (!("refused" in written)) out.shaped.push(path);
    else if (written.refused.code === "conflict") held.add(path);
    else out.refused.push({ path, reason: written.refused.reason });
  }
  for (const file of PINNED) if (held.has(AUTHOR_FILE[file]) || out.shaped.includes(AUTHOR_FILE[file])) await port.pin(AUTHOR_FILE[file], HARNESS_AGENT.author);
  return out;
}
