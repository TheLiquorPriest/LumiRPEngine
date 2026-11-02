// The workspace's system files as an agent's system instructions (DESIGN §4.4): `AGENTS.md`, every
// agent's, and `roles/<role>.md`, its role's own (`main` for the main agent, `assistant` for the GM
// assistant, a turn role by its id), at both levels of the workspace. Every agent's prompt carries
// them after its own system prompt: the global workspace's (`~/`) first, then the chat's, each
// level's `AGENTS.md` before the role's file, so the chat's have the last word (`systemPaths`). None
// ships: a file that isn't there, or holds only blanks, adds nothing. They come whole, in that order,
// within Settings → Agents → System instructions' tokens (`agents.systemTokens`); the first that no
// longer fits is cut at a line, the rest are left out, and the agent is told which. Framed by the
// Every agent page's texts.

import { RUNTIME_TEXT } from "../../shared/agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import { systemPaths } from "../../shared/stores";
import { tokensOf } from "../book";
import { renderPrompt } from "../prompts";
import type { WorkspaceFile } from "./tools/workspace";

/** What the system files are read from: a workspace's files (an agent's view of it: a turn's, with what it staged) and their bodies. */
export interface SystemFilesSource {
  workspace(): Promise<readonly WorkspaceFile[]>;
  blob(hash: string): Promise<string | null>;
}

/** `role`'s system instructions from `source`, framed and within `tokens`; empty when the workspace holds none for it. */
export async function systemInstructions(source: SystemFilesSource, input: { role: string; tokens: number; texts: PromptTexts }): Promise<string> {
  const { texts } = input;
  const listed = new Map((await source.workspace()).map((f) => [f.path, f] as const));
  const read: { path: string; text: string }[] = [];
  for (const path of systemPaths(input.role)) {
    const file = listed.get(path);
    const text = file ? ((await source.blob(file.hash)) ?? "").trim() : "";
    if (text !== "") read.push({ path, text });
  }
  if (read.length === 0) return "";
  const framed = (path: string, text: string): string => renderPrompt(RUNTIME_TEXT.systemFile, texts, { path, text });
  const parts: string[] = [];
  const cut: string[] = [];
  let left = input.tokens;
  for (const { path, text } of read) {
    if (cut.length > 0) {
      cut.push(path);
      continue;
    }
    const whole = framed(path, text);
    if (tokensOf(whole) <= left) {
      parts.push(whole);
      left -= tokensOf(whole);
      continue;
    }
    // The most lines that still fit, from the top: none when not even its first line does.
    const lines = text.split("\n");
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (tokensOf(framed(path, lines.slice(0, mid).join("\n"))) <= left) lo = mid;
      else hi = mid - 1;
    }
    if (lo > 0) parts.push(framed(path, lines.slice(0, lo).join("\n")));
    cut.push(path);
  }
  if (cut.length > 0) parts.push(renderPrompt(RUNTIME_TEXT.systemCut, texts, { paths: cut.join(", "), tokens: String(input.tokens) }));
  return renderPrompt(RUNTIME_TEXT.systemFiles, texts, { files: parts.join("\n\n") });
}

/** An agent's system prompt with its system instructions after it, when it has any. */
export function withInstructions(system: string, instructions: string): string {
  return instructions === "" ? system : system.trim() === "" ? instructions : `${system}\n\n${instructions}`;
}
