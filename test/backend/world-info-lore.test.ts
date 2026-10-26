// World Info as lore (DESIGN §4.2, §6.1, §6.11): a chat's World Info entries are read live as lore by
// the helpers and minds, an LRE-secret one only once its gate holds; the interceptor keeps a secret
// entry out of the main generation's prompt until then, and keeps it out whenever it can't tell; an
// entry an engine section carried, such as the Place section's lore, is switched off for that prompt.

import { describe, expect, test } from "bun:test";
import { DEFAULT_SECTIONS } from "../../src/backend/book";
import type { HostBookEntryInput, QuietRequest, WorldInfoCandidate } from "../../src/backend/host";
import type { Delivered } from "../../src/backend/ledger-io";
import { toChain } from "../../src/backend/ledger-io";
import { calendarOf, clockAt, dateAt } from "../../src/engine/calendar";
import { worldInfoVerdict, type WorldInfoGate } from "../../src/backend/wi-interceptor";
import { lastLoreIndex, loreIndex } from "../../src/backend/lore-secrets";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import type { LoreBookEntryView, LoreBookView } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { bookLoreFieldsOf, bookTextHash } from "../../src/shared/lore";
import { blankWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { bookLabels } from "../../src/frontend/build/book-lore";
import { startState } from "../packs/support";
import { FakeHost } from "../support/fake-host";
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
/** The helper and mind calls whose messages hold `text`, each by the start of its prompt. */
const carrying = (rig: Rig, text: string): string[] => rig.host.quietCalls.filter((c) => JSON.stringify(c.messages).includes(text)).map((c) => (c.messages[0]?.content ?? "").slice(0, 40));
async function rich(rig: Rig, chatId: string, pov: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: pov, field: "cash", value: 200000 }] }));
}

/** What a test's own gate knows of the user's books: `host`'s (none, by default), read as the runtime's gate reads them. */
const knowing = (host: FakeHost = new FakeHost()): Pick<WorldInfoGate, "secrets" | "lastSecrets"> => ({ secrets: (userId) => loreIndex(host, userId), lastSecrets: (userId) => lastLoreIndex(host, userId) });
/** An entry as the host gives the interceptor one. */
const candidate = (id: string, bookId: string, disabled: boolean, extensions: JsonObject, content = `${SECRET}.`): WorldInfoCandidate => ({ id, bookId, disabled, extensions, comment: "", content });

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
      { registry: createRegistry(ALL_PACKS), playsWorld: () => true, head: async () => Promise.reject(new Error("no state")), carried: () => new Set(), ...knowing(), log: () => undefined },
      { chatId: "c", userId: "u", chatMetadata: {}, entries: [candidate("on", "b", false, extensions), candidate("plain", "b", false, {}, "PLAIN-MARK: the ferry is late.")] },
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
      { registry: rig.rt.registry, playsWorld: () => true, head: async () => null, carried: () => new Set(), ...knowing(rig.host), log: () => undefined },
      { chatId, userId: rig.host.userId, chatMetadata: {}, entries: [candidate(entryId, bookId, stored?.disabled ?? false, stored?.extensions ?? {}, stored?.content)] },
    );
    expect(unreadable.disabled).toContain(entryId);
    rig.host.worldInfoInterceptor = async () => {
      throw new Error("the interceptor broke");
    };
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(inPrompt(rig, SECRET)).toBe(false);
  });

  test("before LRE's first read of the user's books has finished, a prompt doesn't wait for it: every entry of theirs is off, the engine's own left alone", async () => {
    const registry = createRegistry(ALL_PACKS);
    const world = blankWorld("w_cold", "Cold");
    const verdict = await worldInfoVerdict(
      { registry, playsWorld: () => true, head: async () => ({ world, state: startState(world, registry) }), carried: () => new Set(), secrets: async () => null, lastSecrets: (userId) => lastLoreIndex(new FakeHost(), userId), log: () => undefined },
      { chatId: "c", userId: "u", chatMetadata: {}, entries: [candidate("plain", "b", false, {}, "PLAIN-MARK: the ferry is late."), candidate("section", "eb", false, { [LEDGER_NAMESPACE]: { slot: "place" } }, "[Place] The harbor.")] },
    );
    expect(verdict).toEqual({ disabled: ["plain"], enabled: [] });
  });

  test("a World Info book LRE can't read is named in a toast and in Settings → Caveats, and keeps the user's World Info off in world chats until it reads", async () => {
    const { rig, chatId } = await bookChat([entry("The ferry", "FERRY-MARK: the ferry runs twice a day.")]);
    const broken = await rig.host.books.create("Old notes", "", rig.host.userId);
    const entries = rig.host.books.entries;
    let damaged = true;
    rig.host.books.entries = async (id, userId) => {
      if (id === broken && damaged) throw new Error("the book is damaged");
      return entries(id, userId);
    };
    const caveats = async (): Promise<string[]> => (rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats as { message: string }[]).map((c) => c.message);
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(inPrompt(rig, "FERRY-MARK")).toBe(false);
    expect(rig.host.toasts.filter((t) => t.message.includes("Old notes"))).toHaveLength(1);
    expect((await caveats()).some((m) => m.includes("Old notes") && m.includes("the book is damaged"))).toBe(true);
    damaged = false;
    await rig.turn(chatId, "I wait some more.", "Gulls call again.");
    expect(inPrompt(rig, "FERRY-MARK")).toBe(true);
    expect((await caveats()).some((m) => m.includes("Old notes"))).toBe(false);
  });

  test("when LRE has never managed to list the user's books, the turn goes on with all of their World Info off, and a toast and Settings → Caveats say so", async () => {
    const rig = new Rig();
    // The books can't be listed from the engine's start.
    const listing = rig.host.books.list;
    let down = true;
    rig.host.books.list = async (userId) => {
      if (down) throw new Error("the books service is down");
      return listing(userId);
    };
    for (const patch of [{ modelUse: { preset: "full" } }, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const worldId = await rig.newWorld("Harbor");
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    await rig.host.books.createEntry(bookId, entry("The ferry", "FERRY-MARK: the ferry runs twice a day."), rig.host.userId);
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : []), bookId] }, rig.host.userId);
    rig.host.quietReply = quiet;
    const unlisted = async (): Promise<boolean> => (rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats as { code: string }[]).some((c) => c.code === "lore_books_unlisted");
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    // The turn went on, its reply in the chat, with none of the user's World Info in its prompt.
    expect(rig.host.chat(chatId).messages.at(-1)?.isUser).toBe(false);
    expect(inPrompt(rig, "FERRY-MARK")).toBe(false);
    expect(rig.host.toasts.filter((t) => t.message.includes("can't list your World Info books"))).toHaveLength(1);
    expect(await unlisted()).toBe(true);
    down = false;
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(inPrompt(rig, "FERRY-MARK")).toBe(true);
    expect(await unlisted()).toBe(false);
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

  test("a gate is checked as it is typed: the form is told what Save would refuse, and only that", async () => {
    const { rig, bookId, ids } = await bookChat([entry("The wreck", `${SECRET}.`)]);
    const entryId = ids[0] ?? "";
    const cases: JsonObject[] = [{ secret: true, gate: GATE }, { secret: true, gate: "self.cash >" }, { secret: true, gate: "stage.keeper == 'revealed" }, { secret: true }, { secret: true, gate: "  " }, { secret: false, gate: "self.cash >" }, { links: ["dev"] }];
    for (const fields of cases) {
      const problem: unknown = rig.body(await rig.send({ type: "lre.lore", op: "check", fields })).problem;
      const checked = typeof problem === "string" ? problem : null;
      const saved = await rig.send({ type: "lre.lore", op: "fields", bookId, entryId, fields });
      // A problem exactly when Save refuses, in the words of its refusal.
      expect(checked === null).toBe(saved.type !== "lre.error");
      if (checked !== null) expect(saved.type === "lre.error" ? saved.message : null).toBe(checked);
    }
  });

  test("two books that share a name read apart in every book picker: a character's copy beside the one imported on its own", async () => {
    const rig = new Rig();
    const own = rig.host.userBook("Saga - Core", { added: 1792425242 });
    const copy = rig.host.userBook("Saga - Core", { character: true, added: 1792425595 });
    const other = rig.host.userBook("Harbor lore", { added: 1792425242 });
    const labels = bookLabels(rig.body(await rig.send({ type: "lre.lore", op: "books" })).books as LoreBookView[]);
    expect(new Set([labels[own], labels[copy]]).size).toBe(2);
    // Told apart by where each came from, not by an id the user never sees.
    for (const id of [own, copy]) expect(labels[id]?.startsWith("Saga - Core") && !labels[id]?.includes(id)).toBe(true);
    expect(labels[other]).toBe("Harbor lore");
  });
});

describe("a secret World Info entry's twins", () => {
  const ALIKE = "WRECK-ALIKE: the wreck is only a wreck.";

  /**
   * A chat that scans only a book a character's card brought, named like the book holding the entry
   * to make secret (as Lumiverse scans a character's own copy): in it the entry's twin, its title and
   * text spaced otherwise, and an entry with the same title but other text.
   */
  async function twinChat(): Promise<{ rig: Rig; chatId: string; bookId: string; original: string; copyBook: string; twin: string; alike: string; pov: string }> {
    const { rig, chatId, bookId, ids, pov } = await bookChat([entry("The wreck", `${SECRET}.`)]);
    const copyBook = rig.host.userBook("harbor  NOTES", { character: true });
    const twin = await rig.host.books.createEntry(copyBook, entry("  The wreck ", `${SECRET}.\n`), rig.host.userId);
    const alike = await rig.host.books.createEntry(copyBook, entry("The wreck", ALIKE), rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [copyBook] }, rig.host.userId);
    return { rig, chatId, bookId, original: ids[0] ?? "", copyBook, twin, alike, pov };
  }

  test("is kept off with it: stored switched off, and out of the prompt until the gate holds, then in it; an entry only titled alike is untouched", async () => {
    const { rig, chatId, bookId, original, twin, alike, pov } = await twinChat();
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
    expect(rig.host.storedEntry(alike)).toMatchObject({ disabled: false, extensions: {} });
    await rig.turn(chatId, "I look at the harbor.", "Gulls call.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    expect(inPrompt(rig, "WRECK-ALIKE")).toBe(true);
    await rich(rig, chatId, pov);
    await rig.turn(chatId, "I look again.", "The tide turns.");
    expect(inPrompt(rig, SECRET)).toBe(true);
  });

  test("making the entry public again puts it and its twin back on, the twin as it stood", async () => {
    const { rig, bookId, original, twin, alike } = await twinChat();
    const stood = rig.host.storedEntry(twin);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    expect([rig.host.storedEntry(original)?.disabled, rig.host.storedEntry(twin)?.disabled]).toEqual([true, true]);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: null }));
    expect(rig.host.storedEntry(original)?.disabled).toBe(false);
    expect(rig.host.storedEntry(twin)).toEqual(stood);
    expect(rig.host.storedEntry(alike)).toMatchObject({ disabled: false, extensions: {} });
  });

  test("Build names each twin a secret keeps off, and a twin's own secrecy changes only with its original's", async () => {
    const { rig, bookId, original, copyBook, twin, alike } = await twinChat();
    const entries = async (book: string) => rig.body(await rig.send({ type: "lre.lore", op: "entries", bookId: book })).entries as LoreBookEntryView[];
    expect((await entries(bookId)).find((e) => e.id === original)?.twins).toEqual([{ bookId: copyBook, entryId: twin }]);
    expect((await entries(copyBook)).find((e) => e.id === alike)?.twins).toBeUndefined();
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    expect((await entries(copyBook)).find((e) => e.id === twin)?.copyOf).toEqual({ bookId, entryId: original, kept: true });
    const refused = await rig.send({ type: "lre.lore", op: "fields", bookId: copyBook, entryId: twin, fields: null });
    expect(refused.type).toBe("lre.error");
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
  });

  test("a secret world entry's source keeps its twins off too, from the draft save that makes it secret", async () => {
    const { rig, chatId, bookId, original, twin } = await twinChat();
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wreck", value: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate: GATE, source: { kind: "book", bookId, entryId: original, hash: bookTextHash(`${SECRET}.`) } } }));
    expect(rig.host.storedEntry(original)?.disabled).toBe(true);
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
  });

  test("a twin kept as the copy of a secret world entry's source opens only once the world entry's gate holds too", async () => {
    const registry = createRegistry(ALL_PACKS);
    const world = blankWorld("w_twin", "Twin");
    world.lore.wreck = { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate: "false", source: { kind: "book", bookId: "b", entryId: "e", hash: bookTextHash(`${SECRET}.`) } };
    const copy = { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" }, secretCopyOf: { entry: "b/e", off: false, fields: null } } };
    // Its text as the book has it since the world entry was indexed: the note alone ties it to the world entry.
    const verdict = await worldInfoVerdict(
      { registry, playsWorld: () => true, head: async () => ({ world, state: startState(world, registry) }), carried: () => new Set(), ...knowing(), log: () => undefined },
      { chatId: "c", userId: "u", chatMetadata: {}, entries: [candidate("t", "b2", true, copy, "WRECK-NOW: the boat went down.")] },
    );
    expect(verdict).toEqual({ disabled: ["t"], enabled: [] });
  });

  test("a twin in a book named otherwise, one the host won't write and one the host builds from a card stay out of the narrator's prompt and every helper call until the gate holds", async () => {
    const { rig, chatId, bookId, ids, pov } = await bookChat([entry("The wreck", `${SECRET}.`)]);
    // The write the host refuses comes first: the twins after it are kept all the same.
    const docks = await rig.host.books.create("Dock gossip", "", rig.host.userId);
    const refused = await rig.host.books.createEntry(docks, entry("What they say", `${SECRET}.`), rig.host.userId);
    rig.host.refusedWrites.add(refused);
    const card = rig.host.userBook("The ferryman's lorebook", { character: true });
    const named = await rig.host.books.createEntry(card, entry("Wreck", `  ${SECRET}.`), rig.host.userId);
    rig.host.cardEntries = [{ ...entry("", `${SECRET}.`), id: "card-wreck", bookId: "card", outlet: null }];
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : []), card, docks] }, rig.host.userId);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: ids[0] ?? "", fields: { secret: true, gate: GATE } }));
    expect([rig.host.storedEntry(named)?.disabled, rig.host.storedEntry(refused)?.disabled]).toEqual([true, false]);
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    expect(carrying(rig, SECRET)).toEqual([]);
    await rich(rig, chatId, pov);
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(inPrompt(rig, SECRET)).toBe(true);
    expect(interpretPrompt(rig)).toContain(SECRET);
  });

  test("a pass that read the original's book before it was made secret doesn't put its twin back on", async () => {
    const { rig, chatId, bookId, original, twin } = await twinChat();
    const before = await rig.host.books.entries(bookId, rig.host.userId);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    const kept = rig.host.storedEntry(twin);
    // The turn's pass gets the original's book as it was before the write, and the twin's after it.
    const entries = rig.host.books.entries;
    let stale = true;
    rig.host.books.entries = async (id, userId) => {
      if (id !== bookId || !stale) return entries(id, userId);
      stale = false;
      return structuredClone(before);
    };
    await rig.turn(chatId, "I look at the harbor.", "Gulls call.");
    expect(rig.host.storedEntry(twin)).toEqual(kept);
    expect(inPrompt(rig, SECRET)).toBe(false);
  });

  test("a twin of two secrets opens only once both gates hold, and stays kept while either is secret", async () => {
    const { rig, chatId, bookId, original, twin, pov } = await twinChat();
    // The second secret came in a book imported with LRE's fields on it.
    const third = rig.host.userBook("Harbor Notes");
    await rig.host.books.createEntry(third, entry("The wreck", `${SECRET}.`, { disabled: true, extensions: { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: GATE } } } }), rig.host.userId);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: "true" } }));
    await rig.turn(chatId, "I look at the harbor.", "Gulls call.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: null }));
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
    await rich(rig, chatId, pov);
    await rig.turn(chatId, "I look again.", "The tide turns.");
    expect(inPrompt(rig, SECRET)).toBe(true);
  });

  test("a twin that is also a secret world entry's source stays off when the entry it was kept with is made public", async () => {
    const { rig, chatId, bookId, original, copyBook, twin } = await twinChat();
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wreck", value: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate: GATE, source: { kind: "book", bookId: copyBook, entryId: twin, hash: bookTextHash(`${SECRET}.`) } } }));
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: null }));
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
  });

  test("a twin follows its original once the original's book is renamed, and Build and the server agree that it is kept", async () => {
    const { rig, bookId, original, copyBook, twin } = await twinChat();
    const entries = async (book: string) => rig.body(await rig.send({ type: "lre.lore", op: "entries", bookId: book })).entries as LoreBookEntryView[];
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    rig.host.renameBook(bookId, "Old harbor notes");
    expect((await entries(copyBook)).find((e) => e.id === twin)?.copyOf).toEqual({ bookId, entryId: original, kept: true });
    expect((await rig.send({ type: "lre.lore", op: "fields", bookId: copyBook, entryId: twin, fields: null })).type).toBe("lre.error");
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: "false" } }));
    expect(bookLoreFieldsOf(rig.host.storedEntry(twin)?.extensions)?.gate).toBe("false");
  });

  test("a twin stays kept with its original after either one's text is edited, and Build and the server still say so", async () => {
    const { rig, chatId, bookId, original, copyBook, twin } = await twinChat();
    const entries = async (book: string) => rig.body(await rig.send({ type: "lre.lore", op: "entries", bookId: book })).entries as LoreBookEntryView[];
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    // A typo fixed in the original, in Lumiverse's own World Info editor: the twin holds the text as the card had it.
    rig.host.editEntry(original, { content: `${SECRET}, as everyone suspected.` });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
    expect(inPrompt(rig, SECRET)).toBe(false);
    // Then the twin's own text, edited by hand.
    rig.host.editEntry(twin, { content: `${SECRET}, or so the ferryman says.` });
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(rig.host.storedEntry(twin)?.disabled).toBe(true);
    expect(inPrompt(rig, SECRET)).toBe(false);
    expect((await entries(copyBook)).find((e) => e.id === twin)?.copyOf).toEqual({ bookId, entryId: original, kept: true });
    expect((await rig.send({ type: "lre.lore", op: "fields", bookId: copyBook, entryId: twin, fields: null })).type).toBe("lre.error");
  });

  test("a copy whose text drifted from its original's is held to the original's gate as it is now, while its own rewrite fails", async () => {
    const { rig, chatId, bookId, original, twin, pov } = await twinChat();
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: "true" } }));
    rig.host.editEntry(original, { content: `${SECRET}, as everyone suspected.` });
    // The gate is tightened in Build, and the host won't write the copy's new fields.
    rig.host.refusedWrites.add(twin);
    rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId: original, fields: { secret: true, gate: GATE } }));
    expect(bookLoreFieldsOf(rig.host.storedEntry(twin)?.extensions)?.gate).toBe("true");
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    await rich(rig, chatId, pov);
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(inPrompt(rig, SECRET)).toBe(true);
  });

  test("a turn reads no book of the user's again when none changed since the last", async () => {
    const { rig, chatId } = await bookChat([entry("The ferry", "The ferry crosses to Gull Island twice a day.")]);
    const pair = [rig.host.userBook("Saga - Core"), rig.host.userBook("Saga - Core", { character: true })];
    for (const id of pair) await rig.host.books.createEntry(id, entry("The town", "TOWN-MARK: the town has one road."), rig.host.userId);
    await rig.turn(chatId, "I wait.", "Gulls call.");
    const read: string[] = [];
    const entries = rig.host.books.entries;
    rig.host.books.entries = async (id, userId) => {
      read.push(id);
      return entries(id, userId);
    };
    await rig.turn(chatId, "I wait some more.", "Gulls call again.");
    expect(read.filter((id) => pair.includes(id))).toEqual([]);
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
  /** A user book holding one entry (on, constant), attached to `chatId`. */
  async function oneEntry(rig: Rig, chatId: string, over: Partial<HostBookEntryInput>): Promise<{ bookId: string; entryId: string }> {
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The wreck", `${SECRET}.`, { keys: ["zzqq"], constant: false, ...over }), rig.host.userId);
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : []), bookId] }, rig.host.userId);
    return { bookId, entryId };
  }

  /** A world chat on the test world, the player character at `here`: `setup` writes the draft's lore (and any books it reads) before the commit. */
  async function loreChat(setup: (rig: Rig, worldId: string, here: string) => Promise<void>): Promise<{ rig: Rig; chatId: string }> {
    const rig = new Rig();
    for (const patch of [{ modelUse: { preset: "full" } }, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const worldId = await rig.newWorld("Harbor");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    await setup(rig, worldId, draft.start.place);
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = quiet;
    return { rig, chatId };
  }
  const DEBT = "DEBT-MARK: the ferryman owes the harbor master money.";
  /** A book holding `DEBT`, Known by whoever knows `links`; attached to `chatId` when given. */
  async function debtBook(rig: Rig, links: string[], chatId?: string): Promise<{ bookId: string; entryId: string }> {
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The debt", DEBT, { extensions: { [LEDGER_NAMESPACE]: { lore: { visibility: "known_by", links } } } }), rig.host.userId);
    if (!chatId) return { bookId, entryId };
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...(Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : []), bookId] }, rig.host.userId);
    return { bookId, entryId };
  }

  test("a world entry with a visibility no reader knows stays unread by every call, whatever its links", async () => {
    const RUMOR = "RUMOR-MARK: the harbor master takes bribes.";
    const { rig, chatId } = await loreChat(async (rig, worldId, here) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "rumor", value: { id: "rumor", title: "Harbor rumor", content: RUMOR, keys: ["ferry"], links: [here], visibility: "secret" } }));
    });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "RUMOR-MARK")).toEqual([]);
    expect(inPrompt(rig, "RUMOR-MARK")).toBe(false);
  });

  test("a Known-by world entry that links nothing stays unread when a book entry of its text links what the player character knows", async () => {
    let place = "";
    const { rig, chatId } = await loreChat(async (rig, worldId, here) => {
      place = here;
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "debt", value: { id: "debt", title: "The debt", content: DEBT, keys: ["ferry"], links: [], visibility: "known_by" } }));
    });
    await debtBook(rig, [place], chatId);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "DEBT-MARK")).toEqual([]);
  });

  test("a Known-by world entry that links nothing stays unread though the book entry it was indexed from links what the player character knows", async () => {
    const { rig, chatId } = await loreChat(async (rig, worldId, here) => {
      const { bookId, entryId } = await debtBook(rig, [here]);
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "debt", value: { id: "debt", title: "The debt", content: DEBT, keys: ["ferry"], links: [], visibility: "known_by", source: { kind: "book", bookId, entryId, hash: bookTextHash(DEBT) } } }));
    });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "DEBT-MARK")).toEqual([]);
  });

  /**
   * A world chat whose starting place has one book entry pinned, its book attached to no chat:
   * `setup` gives the entry its fields and the draft its lore before the commit.
   */
  async function pinnedChat(content: string, setup: (rig: Rig, worldId: string, bookId: string, entryId: string) => Promise<void>): Promise<{ rig: Rig; chatId: string }> {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The wreck", content, { keys: ["zzqq"], constant: false }), rig.host.userId);
    const worldId = await rig.newWorld("Harbor");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    await setup(rig, worldId, bookId, entryId);
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: {}, places: { [draft.start.place]: [{ book: bookId, entry: entryId }] }, steps: {} } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = quiet;
    return { rig, chatId };
  }

  test("a book entry pinned where the player character is reads as Known by when the world entry indexed from it is", async () => {
    const DEBT = "DEBT-MARK: the ferryman owes the harbor master money.";
    const { rig, chatId } = await pinnedChat(DEBT, async (rig, worldId, bookId, entryId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "debt", value: { id: "debt", title: "The debt", content: DEBT, keys: [], links: ["dev"], visibility: "known_by", source: { kind: "book", bookId, entryId, hash: bookTextHash(DEBT) } } }));
    });
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "DEBT-MARK")).toEqual([]);
    expect(inPrompt(rig, "DEBT-MARK")).toBe(false);
  });

  test("a book entry secret in Build and indexed into a secret world entry, pinned where the player character is, opens only once the world entry's gate holds too", async () => {
    const { rig, chatId } = await pinnedChat(`${SECRET}.`, async (rig, worldId, bookId, entryId) => {
      rig.body(await rig.send({ type: "lre.lore", op: "fields", bookId, entryId, fields: { secret: true, gate: "true" } }));
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wreck", value: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate: "false", source: { kind: "book", bookId, entryId, hash: bookTextHash(`${SECRET}.`) } } }));
    });
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, SECRET)).toEqual([]);
    const traced = (rig.rt.inspectorRecords(chatId) ?? []).flatMap((r) => r.lore ?? []).flatMap((t) => t.entries.map((e) => e.title));
    expect(traced).not.toContain("The wreck");
  });

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
      { registry, playsWorld: () => true, head: async () => ({ world, state: startState(world, registry) }), carried: () => new Set(), ...knowing(), log: () => undefined },
      { chatId: "c", userId: "u", chatMetadata: {}, entries: [candidate("e", "b", true, { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" } } })] },
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
