// The lore's shipped files, loaded the way the agents' guidance is: as the shipped level of a folder
// host, with a character level holding each chat a test plays.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Guidance, loadGuidance } from "rp-harness";
import type { FilesPort, Scope, ToolCtx } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { USER } from "./fixtures";

const GUIDANCE = resolve(import.meta.dir, "../../guidance");

/** The prompt parts and tool files the lore reads. */
const SHIPPED = { prompts: ["lore-answers", "lore-map"], tools: ["lore_index_write"] } as const;

export interface LoreGuidance {
  files: FilesPort;
  guidance(chat: string): Guidance;
}

export async function shippedGuidance(dir: string, chats: readonly string[]): Promise<LoreGuidance> {
  for (const [kind, names] of Object.entries(SHIPPED)) {
    mkdirSync(join(dir, "files", "defaults", `.${kind}`), { recursive: true });
    for (const name of names) copyFileSync(join(GUIDANCE, `.${kind}`, `${name}.md`), join(dir, "files", "defaults", `.${kind}`, `${name}.md`));
  }
  for (const chat of chats) {
    mkdirSync(join(dir, "files", "chats", "keeper", chat), { recursive: true });
    mkdirSync(join(dir, "host", "chats", chat), { recursive: true });
    writeFileSync(join(dir, "host", "chats", chat, "chat.json"), JSON.stringify({ character: "keeper" }));
  }
  const host = await createFolderHost({ dir, user: USER });
  return { files: host.files, guidance: (chat) => loadGuidance(host.files, { user: USER, chat, session: "session-1" }) };
}

/** A call's context, as RPH gives a tool one: the indexer's, in a job tied to no turn unless one is named. */
export function callCtx(scope: Omit<Scope, "session">, definition = "indexer"): ToolCtx {
  return { scope: { ...scope, session: "session-1" }, agent: { id: "agent-1", definition, job: "job-1" }, run: "run-1", callId: "call-1", signal: new AbortController().signal, onUpdate: () => undefined };
}
