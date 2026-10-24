// World Info as lore (DESIGN §4.2, §6.1, §6.11): a chat's World Info entries are read live as lore by
// the helpers and minds, an LRE-secret one only once its gate holds; the interceptor keeps a secret
// entry out of the main generation's prompt until then, and keeps it out whenever it can't tell; an
// entry an engine section carried, such as the Place section's lore, is switched off for that prompt.

import { describe, expect, test } from "bun:test";
import { DEFAULT_SECTIONS } from "../../src/backend/book";
import type { HostBookEntryInput, QuietRequest } from "../../src/backend/host";
import type { Delivered } from "../../src/backend/ledger-io";
import { toChain } from "../../src/backend/ledger-io";
import { calendarOf, clockAt, dateAt } from "../../src/engine/calendar";
import { worldInfoVerdict } from "../../src/backend/wi-interceptor";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { bookTextHash } from "../../src/shared/lore";
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

/**
 * A world chat with a user book attached that holds `entries` (made knowing where the POV starts);
 * returns the entry ids in order. `shipped`: Port Alder on every shipped pack, the space pack's Place
 * section among them, instead of the test pack's harbor.
 */
async function bookChat(entries: HostBookEntryInput[] | ((here: string, world: WorldDoc) => HostBookEntryInput[]), shipped = false): Promise<{ rig: Rig; chatId: string; bookId: string; ids: string[]; pov: string }> {
  const rig = new Rig({ shipped });
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
  const worldId = shipped ? await rig.newWorld("Alder", "modern_slice_of_life") : await rig.newWorld("Harbor");
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
  const ids: string[] = [];
  for (const e of typeof entries === "function" ? entries(draft.start.place, draft) : entries) ids.push(await rig.host.books.createEntry(bookId, e, rig.host.userId));
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

  test("a secret world entry indexed from a book keeps that entry stored off: with the state unreadable or the interceptor throwing, it stays out", async () => {
    const { rig, chatId, bookId, ids } = await bookChat([entry("The wreck", `${SECRET}.`)]);
    const entryId = ids[0] ?? "";
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wreck", value: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: ["ferry"], links: [], secret: true, gate: GATE, source: { kind: "book", bookId, entryId, hash: bookTextHash(`${SECRET}.`) } } }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: committed.revision }));
    const stored = rig.host.storedEntry(entryId);
    const unreadable = await worldInfoVerdict(
      { registry: rig.rt.registry, playsWorld: () => true, head: async () => null, carried: () => new Set(), log: () => undefined },
      { chatId, userId: rig.host.userId, chatMetadata: {}, entries: [{ id: entryId, bookId, disabled: stored?.disabled ?? false, extensions: stored?.extensions ?? {} }] },
    );
    expect(unreadable.disabled).toContain(entryId);
    rig.host.worldInfoInterceptor = async () => {
      throw new Error("the interceptor broke");
    };
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(inPrompt(rig, SECRET)).toBe(false);
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

describe("the Place section's lore", () => {
  /** Port Alder's player character becomes the harbor master: the gate below holds once they are. */
  const HARBOR_MASTER = "self.occupation == 'harbor_master'";
  /** An entry about `place`, with LRE's `extra` fields beside its link. */
  const about = (place: string, content: string, extra: JsonObject = {}, over: Partial<HostBookEntryInput> = {}): HostBookEntryInput => entry("The harbor wall", content, { keys: [], ...over, extensions: { [LEDGER_NAMESPACE]: { lore: { links: [place], ...extra } } } });
  const place = (rig: Rig): string => rig.host.section(DEFAULT_SECTIONS.place?.label ?? "Place");
  const alone = (rig: Rig, id: string): boolean => rig.host.assembled.some((e) => e.id === id);

  test("carries a place-linked entry the player character may read, and the interceptor switches that entry off for the same prompt", async () => {
    const { rig, chatId, ids } = await bookChat((here) => [about(here, "WALL-MARK: the harbor wall is older than the town.")], true);
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(place(rig)).toContain("WALL-MARK");
    expect(alone(rig, ids[0] ?? "")).toBe(false);
  });

  test("a long entry about the town doesn't push the place's own description out of the section", async () => {
    const long = Array.from({ length: 2000 }, (_, i) => `In year ${i} the town grew by a street.`).join(" ");
    const { rig, chatId } = await bookChat((_here, world) => [about(world.places[world.start.place]?.parent ?? world.start.place, long)], true);
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(place(rig)).toContain("Harbor Hardware");
    expect(place(rig)).toContain("In year 0 the town grew");
  });

  test("a secret place entry stays out of the section and the prompt until its gate holds", async () => {
    const { rig, chatId, pov, ids } = await bookChat((here) => [about(here, `${SECRET}.`, { secret: true, gate: HARBOR_MASTER }, { disabled: true })], true);
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: pov, field: "occupation", value: "harbor_master" }] }));
    await rig.turn(chatId, "I wait some more.", "Gulls call again.");
    expect(place(rig)).toContain(SECRET);
    expect(alone(rig, ids[0] ?? "")).toBe(false);
  });
});

describe("minds in a time skip", () => {
  const MIND = "You are the private mind of";

  test("a mind at a skip's beat reads a live World Info entry", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(MIND) ? JSON.stringify({ monologue: "Nothing yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: "calm" }) : "{}");
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // Every place's name brings the entry up, so a mind anywhere reads it.
    const bookId = await rig.host.books.create("Town notes", "", rig.host.userId);
    await rig.host.books.createEntry(bookId, entry("Town notes", "BEAT-MARK: the town council meets on Thursdays.", { keys: Object.values(draft.places).map((p) => p.name), constant: false }), rig.host.userId);
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : []), bookId] }, rig.host.userId);
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    // Marcus, pinned Live, means to meet the player character tomorrow evening: the skip's beat.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const clock = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.clock ?? 0;
    const cal = calendarOf(draft);
    const meet = clockAt(cal, dateAt(cal, clock).dayIndex + 1, 19 * 60);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: "marcus_delgado", level: "live" }, { op: "mind_memory", entity: "marcus_delgado", part: "plan", id: null, value: { what: "Talk to Jordan about the books", kind: "meet", when: { from: meet, to: meet + 60 }, with: ["pov"], priority: 4 } }] }));
    const before = rig.host.quietCalls.length;
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 3 * 1440 }, overrides: { invitation: "note" } }, source: "palette", now: true }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Days pass.");
    const minds = rig.host.quietCalls.slice(before).filter((c) => (c.messages[0]?.content ?? "").includes(MIND));
    expect(minds.length).toBeGreaterThan(0);
    expect(minds.some((c) => JSON.stringify(c.messages).includes("BEAT-MARK"))).toBe(true);
  });
});
