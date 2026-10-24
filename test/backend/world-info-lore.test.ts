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
import { blankWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { startState } from "../packs/support";
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

describe("World Info secrecy wherever the entry is read", () => {
  const carrying = (rig: Rig, text: string): string[] => rig.host.quietCalls.filter((c) => JSON.stringify(c.messages).includes(text)).map((c) => (c.messages[0]?.content ?? "").slice(0, 40));
  /** A user book holding one entry (on, constant), attached to `chatId`. */
  async function oneEntry(rig: Rig, chatId: string, over: Partial<HostBookEntryInput>): Promise<{ bookId: string; entryId: string }> {
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The wreck", `${SECRET}.`, { keys: ["zzqq"], constant: false, ...over }), rig.host.userId);
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : []), bookId] }, rig.host.userId);
    return { bookId, entryId };
  }

  test("a secret, gate-shut World Info entry pinned to the starting place reaches no call and no trace", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The wreck", `${SECRET}.`, { keys: ["zzqq"], constant: false }), rig.host.userId);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId, fields: { secret: true, gate: "false" } }));
    const worldId = await rig.newWorld("Harbor");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: {}, places: { [draft.start.place]: [{ book: bookId, entry: entryId }] }, steps: {} } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = quiet;
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, SECRET)).toEqual([]);
    const traced = (rig.rt.inspectorRecords(chatId) ?? []).flatMap((r) => r.lore ?? []).flatMap((t) => t.entries.map((e) => e.title));
    expect(traced).not.toContain("The wreck");
  });

  test("a public world entry over a book entry made secret in Build reads as secret: not in the Place section, nor any call", async () => {
    const { rig, chatId } = await bookChat([], true);
    const { bookId, entryId } = await oneEntry(rig, chatId, {});
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wall", value: { id: "wall", title: "The harbor wall", content: `${SECRET}.`, keys: [], links: [draft.start.place], source: { kind: "book", bookId, entryId, hash: bookTextHash(`${SECRET}.`) } } }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: committed.revision }));
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId, fields: { secret: true, gate: "false" } }));
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "I look at the harbor wall.", "Gulls call.");
    expect(rig.host.section(DEFAULT_SECTIONS.place?.label ?? "Place")).not.toContain(SECRET);
    expect(carrying(rig, SECRET)).toEqual([]);
  });

  test("a book entry secret on both sides opens only once both gates hold, its own and the world entry's", async () => {
    const registry = createRegistry(ALL_PACKS);
    const world = blankWorld("w_both", "Both");
    world.lore.wreck = { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate: "false", source: { kind: "book", bookId: "b", entryId: "e", hash: bookTextHash(`${SECRET}.`) } };
    const verdict = await worldInfoVerdict(
      { registry, playsWorld: () => true, head: async () => ({ world, state: startState(world, registry) }), carried: () => new Set(), log: () => undefined },
      { chatId: "c", userId: "u", chatMetadata: {}, entries: [{ id: "e", bookId: "b", disabled: true, extensions: { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" } } } }] },
    );
    expect(verdict).toEqual({ disabled: ["e"], enabled: [] });
  });

  test("the outline gate's chip shows no World Info secret an outline beat repeats", async () => {
    const OUTLINE = "You outline a roleplay narrator's next reply";
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = () => "{}";
    for (const patch of [{ modelUse: { preset: "full" } }, { gates: { outline: true } }, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const { bookId, entryId } = await oneEntry(rig, chatId, {});
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId, fields: { secret: true, gate: "false" } }));
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").startsWith(OUTLINE) ? JSON.stringify({ beats: [`${SECRET}.`, "Danny glances at the clock."] }) : "{}");
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 10 } }, source: "palette", now: true }));
    await rig.host.start(chatId, { type: "normal" });
    const gate = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "outline_gate");
    expect(gate?.detail ?? "").toContain("Danny glances at the clock");
    expect(JSON.stringify(gate)).not.toContain(SECRET);
  });

  test("a secret whose gate this turn's Go opens is in that turn's own prompt", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = () => "{}";
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await oneEntry(rig, chatId, { disabled: true, constant: true, keys: [], extensions: { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "self.place == 'alder_market'" } } } });
    rig.body(await rig.send({ type: "lre.action", chatId, action: "go", params: { to: "alder_market" }, source: "palette", now: true }));
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(inPrompt(rig, SECRET)).toBe(true);
    await rig.host.finish(g, "You walk to the market.");
  });

  test("a Re-read reads World Info as it is now, not as an earlier Re-read of the same reply did", async () => {
    const { rig, chatId, ids } = await bookChat([entry("The ferry", "FERRY-OLD: the ferry runs twice a day.")]);
    await rig.turn(chatId, "I walk to the ferry.", "The ferry horn sounds.");
    const reply = rig.host.chat(chatId).messages.at(-1);
    if (!reply) throw new Error("no reply");
    const reread = async (text: string): Promise<string> => {
      rig.host.editMessage(chatId, reply.id, text);
      await rig.host.settle();
      rig.host.quietCalls.length = 0;
      rig.body(await rig.send({ type: "lre.chip", chatId, chip: `reread:${reply.id}:${reply.swipeId}`, choice: "reread" }));
      return JSON.stringify(rig.host.quietCalls.map((c) => c.messages));
    };
    expect(await reread("The ferry horn sounds twice by the ferry.")).toContain("FERRY-OLD");
    await rig.host.books.fill(ids[0] ?? "", "FERRY-NEW: the ferry stopped running.", rig.host.userId);
    const second = await reread("The ferry horn sounds three times by the ferry.");
    expect(second).toContain("FERRY-NEW");
    expect(second).not.toContain("FERRY-OLD");
  });
});
