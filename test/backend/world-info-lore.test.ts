// World Info as lore (DESIGN §4.2, §6.1): a chat's World Info entries are read live as lore by the
// helpers, an LRE-secret one only once its gate holds; the interceptor keeps a secret entry out of
// the main generation's prompt until then, and keeps it out whenever it can't tell; an entry an engine
// section carried is switched off for that prompt.

import { describe, expect, test } from "bun:test";
import type { HostBookEntryInput, QuietRequest } from "../../src/backend/host";
import type { Delivered } from "../../src/backend/ledger-io";
import { worldInfoVerdict } from "../../src/backend/wi-interceptor";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { Rig } from "../support/rig";

const SECRET = "The ferryman scuttled the old boat for the insurance money";
const GATE = "self.cash > 100000";
const INTERPRET = "You map a player's typed input";

function quiet(req: QuietRequest): string {
  if ((req.messages[0]?.content ?? "").includes(INTERPRET)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  return JSON.stringify({ proposals: [] });
}

const entry = (comment: string, content: string, over: Partial<HostBookEntryInput> = {}): HostBookEntryInput => ({ comment, content, keys: ["ferry"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over });
/** A book entry LRE keeps secret: stored switched off, with its gate in its LRE fields. */
const secretEntry = (): HostBookEntryInput => entry("The wreck", `${SECRET}.`, { disabled: true, extensions: { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: GATE } } } });

/** A world chat with a user book attached that holds `entries`; returns the entry ids in order. */
async function bookChat(entries: HostBookEntryInput[]): Promise<{ rig: Rig; chatId: string; bookId: string; ids: string[]; pov: string }> {
  const rig = new Rig();
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
  const worldId = await rig.newWorld("Harbor");
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
  const ids: string[] = [];
  for (const e of entries) ids.push(await rig.host.books.createEntry(bookId, e, rig.host.userId));
  const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
  const attached = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
  await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...attached, bookId] }, rig.host.userId);
  rig.host.quietReply = quiet;
  return { rig, chatId, bookId, ids, pov: draft.pov };
}

const interpretPrompt = (rig: Rig): string => rig.host.quietCalls.find((c) => (c.messages[0]?.content ?? "").includes(INTERPRET))?.messages[0]?.content ?? "";
const inPrompt = (rig: Rig, text: string): boolean => rig.host.assembled.some((e) => e.content.includes(text));
async function rich(rig: Rig, chatId: string, pov: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: pov, field: "cash", value: 200000 }] }));
}

describe("World Info read live as lore", () => {
  test("a helper's search finds a book entry's text live, and an LRE-secret one only once its gate holds", async () => {
    const { rig, chatId, pov } = await bookChat([entry("The ferry", "The ferry crosses to Gull Island twice a day."), secretEntry()]);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(interpretPrompt(rig)).toContain("The ferry crosses to Gull Island");
    expect(interpretPrompt(rig)).not.toContain(SECRET);
    await rich(rig, chatId, pov);
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(interpretPrompt(rig)).toContain(SECRET);
  });
});

describe("the World Info interceptor", () => {
  test("a secret entry stays out of the main generation's prompt until its gate holds, then is switched on for it", async () => {
    const { rig, chatId, pov } = await bookChat([entry("The ferry", "FERRY-MARK: the ferry runs twice a day."), secretEntry()]);
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(inPrompt(rig, "FERRY-MARK")).toBe(true);
    expect(inPrompt(rig, SECRET)).toBe(false);
    await rich(rig, chatId, pov);
    await rig.turn(chatId, "I wait some more.", "Gulls call again.");
    expect(inPrompt(rig, SECRET)).toBe(true);
  });

  test("when the interceptor fails, an entry made secret in Build stays off, even with its gate holding", async () => {
    const { rig, chatId, pov, bookId, ids } = await bookChat([entry("The wreck", `${SECRET}.`)]);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: ids[0] ?? "", fields: { secret: true, gate: GATE } }));
    await rich(rig, chatId, pov);
    rig.host.worldInfoInterceptor = async () => {
      throw new Error("the interceptor broke");
    };
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(inPrompt(rig, SECRET)).toBe(false);
  });

  test("when the chat's state can't be read, every secret entry is voted off, one stored on included", async () => {
    const extensions: JsonObject = { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" } } };
    const verdict = await worldInfoVerdict(
      { registry: createRegistry(ALL_PACKS), playsWorld: () => true, head: async () => Promise.reject(new Error("no state")), carried: () => new Set(), log: () => undefined },
      { chatId: "c", userId: "u", chatMetadata: {}, entries: [{ id: "on", bookId: "b", disabled: false, extensions }, { id: "plain", bookId: "b", disabled: false, extensions: {} }] },
    );
    expect(verdict).toEqual({ disabled: ["on"], enabled: [] });
  });

  test("an entry an engine section carried is switched off for that prompt, and no other", async () => {
    const { rig, chatId, bookId, ids } = await bookChat([entry("The ferry", "FERRY-MARK: the ferry runs twice a day."), entry("The dock", "DOCK-MARK: the dock is stone.")]);
    const carried = ids[0] ?? "";
    const deliver = rig.rt.deliver.bind(rig.rt);
    rig.rt.deliver = async (input): Promise<Delivered> => ({ ...(await deliver(input)), sources: [{ bookId, entryId: carried }] });
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(inPrompt(rig, "FERRY-MARK")).toBe(false);
    expect(inPrompt(rig, "DOCK-MARK")).toBe(true);
  });
});

describe("Build's World Info lore editor", () => {
  test("writes LRE's fields onto an entry: made secret it is stored switched off, its fields taken off it is switched back on, its other extension data kept", async () => {
    const { rig, bookId, ids } = await bookChat([entry("The wreck", `${SECRET}.`, { extensions: { other_tool: { note: "kept" } } })]);
    const entryId = ids[0] ?? "";
    const write = (fields: JsonObject | null) => rig.send({ type: "lre.lore", op: "fields", bookId, entryId, fields });
    const fields = { secret: true, gate: GATE, audience: ["judge"], holders: ["dev"] };
    expect(rig.body(await write(fields)).entries).toEqual([expect.objectContaining({ id: entryId, disabled: true, lore: fields })]);
    expect(rig.host.storedEntry(entryId)?.extensions).toEqual({ other_tool: { note: "kept" }, [LEDGER_NAMESPACE]: { lore: fields } });
    const ungated = await write({ secret: true });
    expect(ungated.type === "lre.error" && ungated.code).toBe("bad_request");
    rig.body(await write(null));
    expect(rig.host.storedEntry(entryId)).toMatchObject({ disabled: false, extensions: { other_tool: { note: "kept" } } });
  });
});
