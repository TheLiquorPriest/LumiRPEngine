// The agent tools against a Port Alder chat (INC1-SPEC R3a): a chat on the shipped starter world with
// whatever a test adds to its world first, the env an agent's tools run with under each knowledge
// setting, and a call through `toolsFor`, as an agent makes one: the tool it is given, the arguments
// it writes and the text it gets back. Starter-world names only.

import type { AgentTool, ToolOutcome } from "../../src/backend/agents/runtime";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { type ToolEnv, toolsFor } from "../../src/backend/agents/tools/registry";
import type { HostBookEntryInput } from "../../src/backend/host";
import type { AgentKnowledge, ToolTier } from "../../src/shared/agent-tools";
import type { JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import type { PromptTexts } from "../../src/shared/prompts";
import { Rig } from "./rig";

/** Port Alder's player character, Jordan Ellis. */
export const POV = "pov";
/** Where Jordan wakes. */
export const HOME = "harbor_street_114";
export const KNOWLEDGE: readonly AgentKnowledge[] = ["pov", "everyone", "gm"];

/** What a test adds to Port Alder's world before its chat starts: whole items of a collection by id (entities, places, lore, tracks, …). */
export interface AlderSetup {
  put?: Partial<Record<"entities" | "places" | "lore" | "tracks" | "actions" | "schedules", Record<string, JsonObject>>>;
  /** Minds on; the rig keeps them off unless asked. */
  minds?: boolean;
}

/** A Port Alder chat on every shipped pack, its world first given what `setup` puts. */
export async function alderChat(setup: AlderSetup = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true, minds: setup.minds === true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  for (const [collection, items] of Object.entries(setup.put ?? {})) {
    for (const [id, value] of Object.entries(items ?? {})) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  }
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** The env an agent's tools run with in `chatId` under `knowledge`, reading the chat's head; no writer unless given. */
export function toolEnv(rig: Rig, chatId: string, knowledge: AgentKnowledge, writer: ToolEnv["writer"] = null): ToolEnv {
  const base = { userId: rig.host.userId, chatId, knowledge };
  return { ...base, reader: outsideReader(rig.rt, base), writer, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
}

/** The tools an agent would be given in `chatId` under `knowledge`: the read tier unless told otherwise, in the user's texts as `texts` has them. */
export async function agentTools(rig: Rig, chatId: string, knowledge: AgentKnowledge, options: { tiers?: readonly ToolTier[]; texts?: PromptTexts } = {}): Promise<AgentTool[]> {
  const env = toolEnv(rig, chatId, knowledge);
  const { world } = await env.reader.view();
  return toolsFor({ world, tiers: options.tiers ?? ["read"], texts: options.texts ?? {}, env });
}

/** One call of the tool `name`, as the runtime makes it. */
export async function callTool(rig: Rig, chatId: string, knowledge: AgentKnowledge, name: string, args: JsonObject = {}): Promise<ToolOutcome> {
  const tool = (await agentTools(rig, chatId, knowledge)).find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.run(args, { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: `call_${name}` });
}

/** A call's answer, read back from its JSON; a refusal fails the test with its text. */
export async function answerOf<T = Record<string, unknown>>(rig: Rig, chatId: string, knowledge: AgentKnowledge, name: string, args: JsonObject = {}): Promise<T> {
  const out = await callTool(rig, chatId, knowledge, name, args);
  if (out.error) throw new Error(`${name} refused: ${out.text}`);
  return JSON.parse(out.text) as T;
}

/** Events written to the chat's head as one correction, as the turn that made them would record them. */
export async function recordFix(rig: Rig, chatId: string, id: string, events: LedgerEvent[]): Promise<void> {
  await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id, target: "head", entry: { kind: "fix", events } });
}

/** A World Info entry as the host's editor makes one, switched on and constant unless `over` says otherwise. */
export function bookEntry(comment: string, content: string, over: Partial<HostBookEntryInput> = {}): HostBookEntryInput {
  return { comment, content, keys: [], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over };
}

/** LRE's own fields on a World Info entry, in its extension data: what it links (`links`), and the like. */
export function lreFields(lore: JsonObject): JsonObject {
  return { [LEDGER_NAMESPACE]: { lore } };
}

/** A user book holding `entries`, attached to the chat as the host's World Info picker does; the entry ids in order. */
export async function attachBook(rig: Rig, chatId: string, name: string, entries: readonly HostBookEntryInput[]): Promise<{ bookId: string; ids: string[] }> {
  const bookId = await rig.host.books.create(name, "", rig.host.userId);
  const ids: string[] = [];
  for (const e of entries) ids.push(await rig.host.books.createEntry(bookId, e, rig.host.userId));
  const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
  const attached = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
  await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...attached, bookId] }, rig.host.userId);
  return { bookId, ids };
}
