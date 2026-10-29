// World Info as lore (DESIGN §4.2, §6.1, §6.11). A chat's World Info entries are read live by the
// helpers and minds, and LRE writes none of them but on the user's press in Build. What is secret in
// an entry is in its own text, as secret marks (`shared/secret-marks.ts`): the interceptor hands the
// narrator's prompt each mark as the chat's narrator view has it, marked or left out; the host strips
// every mark by itself, so a mark fails closed; helpers read an entry's public text, and a mark's own
// text reaches only its holders' minds and the knowledge step, which reads what each person in the
// scene holds. An earlier build's secrecy fields are read as they stand and never written. Each test
// says what reached the prompt, a helper, a mind or the user, and that the user's books are as they
// were.

import { describe, expect, test } from "bun:test";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import type { HostBookEntryInput, QuietRequest, WorldInfoCandidate, WorldInfoVerdict } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { calendarOf, clockAt, dateAt } from "../../src/engine/calendar";
import { worldInfoVerdict, type WorldInfoGate } from "../../src/backend/wi-interceptor";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { factId, MINDS_EVENTS, type MindsRunView } from "../../src/shared/minds";
import type { BackendToFrontend, LoreBookEntryView, LoreBookView, ResultBodies } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { bookTextHash } from "../../src/shared/lore";
import { publicText, secretMarkText } from "../../src/shared/secret-marks";
import { blankWorld } from "../../src/engine/authoring";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { bookLabels } from "../../src/frontend/build/book-lore";
import { startState } from "../packs/support";
import { plainMinds, Rig } from "../support/rig";

const SECRET = "The ferryman scuttled the old boat for the insurance money";
const GATE = "self.cash > 100000";
/** Port Alder's player character becomes the harbor master: the gate holds once they are. */
const HARBOR_MASTER = "self.occupation == 'harbor_master'";
const INTERPRET = "You map a player's typed input";
const MIND_PROMPT = "You are the private mind of";
const MIND = /You are the private mind of (.+?) in the roleplay world/;
/** The start of the knowledge step's prompt (DESIGN §24.11): it reads what each person in the scene holds, their secrets among it. */
const KNOWLEDGE_STEP = "You keep track of who knows what in the roleplay world";
/** The start of the name of the book the engine writes its sections into, never one of the user's. */
const ENGINE_BOOK = "LumiRPEngine · ";

const FERRY = "FERRY-MARK: the ferry runs twice a day.";
const DEBT = "DEBT-MARK: Marcus owes the marina three months of slip fees.";
const WRECK = "WRECK-MARK: the old boat went down with the marina's records aboard.";
const DOCK = "DOCK-MARK: the dock is stone.";
const SEEN = "SEEN-MARK: Jordan saw the boat go down from the breakwater.";
const PLAIN = "PLAIN-MARK: the pier is older than the ferry.";

function quiet(req: QuietRequest): string {
  const prompt = req.messages[0]?.content ?? "";
  if (prompt.includes(INTERPRET)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  if (prompt.includes(MIND_PROMPT)) return plainMinds(req);
  return JSON.stringify({ proposals: [] });
}

const entry = (comment: string, content: string, over: Partial<HostBookEntryInput> = {}): HostBookEntryInput => ({ comment, content, keys: ["ferry"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over });
/** LRE's own fields on an entry, in its extension data. */
const lreFields = (lore: JsonObject): JsonObject => ({ [LEDGER_NAMESPACE]: { lore } });
/** An entry an earlier build kept secret: stored switched off, its gate in its LRE fields. */
const oldSecret = (gate = GATE): HostBookEntryInput => entry("The wreck", `${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate }) });
/** An entry about `place`, with LRE's `extra` fields beside its link. */
const about = (place: string, content: string, extra: JsonObject = {}, over: Partial<HostBookEntryInput> = {}): HostBookEntryInput => entry("The harbor wall", content, { keys: [], ...over, extensions: lreFields({ links: [place], ...extra }) });

/**
 * Port Alder entries with secret marks: Marcus's, kept from everyone else; a whole entry kept from
 * everyone; one Jordan, the player character, knows. Each author named a person by a word of their name.
 */
const MARKED: HostBookEntryInput[] = [
  entry("The ferry", `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`),
  entry("The wreck", `{{// Secret: ${WRECK}}}`),
  entry("The dock", `${DOCK}\n{{// Secret (known to Jordan): ${SEEN}}}`),
];

/** A narrator view a chat may choose for itself: whose knowledge, and whether secrets are marked or left out. */
type NarratorView = { knowledge: "scene" | "pov"; secrets: "marked" | "omit" };
/** The player character's view with secrets left out, for a test about what the player character's narrator may be told. */
const PLAYER_VIEW: NarratorView = { knowledge: "pov", secrets: "omit" };
/** The people whose minds a chat with minds runs: always Live, in the player character's scene. */
const MINDS = ["danny_okafor", "priya_nair"];

/** Attaches a book to the chat beside the ones it has, as the host's World Info picker does. */
async function attachBook(rig: Rig, chatId: string, bookId: string): Promise<void> {
  const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
  const attached = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
  await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...attached, bookId] }, rig.host.userId);
}

interface ChatOptions {
  /** Port Alder on every shipped pack, the space pack's Place section among them, instead of the test pack's harbor. */
  shipped?: boolean;
  /** With `shipped`: minds on, Danny Okafor and Priya Nair always Live and in the player character's scene. */
  minds?: boolean;
  /** The chat's own narrator view; absent, it follows the default, everyone in the scene with secrets marked. */
  narrator?: NarratorView;
}

/**
 * A world chat with a user book attached that holds `entries` (made knowing where the player
 * character starts); returns the entry ids in order.
 */
async function bookChat(entries: HostBookEntryInput[] | ((here: string, world: WorldDoc) => HostBookEntryInput[]), options: ChatOptions = {}): Promise<{ rig: Rig; chatId: string; bookId: string; ids: string[]; pov: string }> {
  const rig = new Rig({ shipped: options.shipped === true, minds: options.minds === true });
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  if (!options.minds) rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
  const worldId = options.shipped ? await rig.newWorld("Alder", "modern_slice_of_life") : await rig.newWorld("Harbor");
  if (options.minds) rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: MINDS } } }));
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat(options.shipped ? "Morning." : "Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (options.minds) {
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: MINDS.map((entity) => ({ op: "move", entity, to: draft.start.place })) }));
  }
  if (options.narrator) {
    // Where GM → This chat keeps it: in LRE's key of the chat's metadata, beside the chat's run. The
    // engine reads the two together, so it is told to read them afresh, as after an attach.
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    const own = meta[LEDGER_NAMESPACE];
    await rig.host.chats.mergeChatMetadata(chatId, { [LEDGER_NAMESPACE]: { ...(isRecord(own) ? own : {}), prefs: { narrator: options.narrator } } }, rig.host.userId);
    rig.rt.forgetChat(chatId);
  }
  const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
  const ids: string[] = [];
  for (const e of typeof entries === "function" ? entries(draft.start.place, draft) : entries) ids.push(await rig.host.books.createEntry(bookId, e, rig.host.userId));
  await attachBook(rig, chatId, bookId);
  rig.host.quietReply = quiet;
  return { rig, chatId, bookId, ids, pov: draft.pov };
}

const interpretPrompt = (rig: Rig): string => rig.host.quietCalls.find((c) => (c.messages[0]?.content ?? "").includes(INTERPRET))?.messages[0]?.content ?? "";
const inPrompt = (rig: Rig, text: string): boolean => rig.host.assembled.some((e) => e.content.includes(text));
/** The text the last prompt holds of one World Info entry, inserted by its own activation; "" when it holds none. */
const promptOf = (rig: Rig, id: string): string => rig.host.assembled.find((e) => e.id === id)?.content ?? "";
/** The helper and mind calls whose messages hold `text`, each by the start of its prompt. */
const carrying = (rig: Rig, text: string): string[] => rig.host.quietCalls.filter((c) => JSON.stringify(c.messages).includes(text)).map((c) => (c.messages[0]?.content ?? "").slice(0, 40));
/** Who was handed `text`: each mind by its character's name, the knowledge step by its own, every other call as a helper. */
const readers = (rig: Rig, text: string): string[] => [...new Set(rig.host.quietCalls.filter((c) => JSON.stringify(c.messages).includes(text)).map((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] ?? ((c.messages[0]?.content ?? "").startsWith(KNOWLEDGE_STEP) ? "the knowledge step" : "a helper")))];

/** Every entry of the user's own books as the host stores it, by id: the engine's own book, which holds its sections, aside. */
function userEntries(rig: Rig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const book of rig.host.bookStore.values()) if (!book.name.startsWith(ENGINE_BOOK)) for (const id of book.entries.keys()) out[id] = rig.host.storedEntry(id);
  return out;
}

/** Every section's text: as the last prompt held each, and as GM → This chat → Sections previews each now. */
async function sectionTexts(rig: Rig, chatId: string): Promise<string[]> {
  const engine = new Set([...rig.host.bookStore.values()].filter((b) => b.name.startsWith(ENGINE_BOOK)).flatMap((b) => [...b.entries.keys()]));
  const preview = rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
  return [...rig.host.assembled.filter((e) => engine.has(e.id)).map((e) => e.content), ...preview.sections.flatMap((s) => (s.content === null ? [] : [s.content]))];
}

/** An entry as the host gives the interceptor one. */
const candidate = (id: string, bookId: string, disabled: boolean, extensions: JsonObject, content = `${SECRET}.`): WorldInfoCandidate => ({ id, bookId, disabled, extensions, comment: "", content });
/** The interceptor's gate as the runtime's, the chat's world and state read by `head`. */
const gateOn = (registry: Registry, head: WorldInfoGate["head"]): WorldInfoGate => ({ registry, playsWorld: () => true, head, settings: async () => defaultSettings(), log: () => undefined });

/**
 * The texts a prompt gets of `entries` with `verdict` applied as the host applies it, before its own
 * macro pass strips any mark: an off vote wins, an on vote switches on an entry stored off, and a text
 * of the prompt's own stands in for the entry's.
 */
function prompted(entries: readonly WorldInfoCandidate[], verdict: WorldInfoVerdict): string[] {
  const off = new Set(verdict.disabled);
  const on = new Set(verdict.enabled);
  const text = new Map((verdict.mutated ?? []).map((m) => [m.id, m.content]));
  return entries.filter((e) => !off.has(e.id) && (!e.disabled || on.has(e.id))).map((e) => text.get(e.id) ?? e.content);
}

describe("World Info read live as lore", () => {
  test("a helper's search finds a book entry's text live, and one an earlier build kept secret only once its gate holds", async () => {
    const { rig, chatId, pov } = await bookChat([entry("The ferry", "The ferry crosses to Gull Island twice a day."), oldSecret()]);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(interpretPrompt(rig)).toContain("The ferry crosses to Gull Island");
    expect(interpretPrompt(rig)).not.toContain(SECRET);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: pov, field: "cash", value: 200000 }] }));
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(interpretPrompt(rig)).toContain(SECRET);
  });
});

describe("an earlier build's secrecy fields, read as they stand", () => {
  test("keep an entry out of the prompt until its gate holds, then it is in; nothing LRE does writes it: turns, a draft save, a commit and Upgrade, the Sections preview, GM → Minds → Run, a Re-read", async () => {
    const { rig, chatId, bookId, ids, pov } = await bookChat([entry("The ferry", FERRY), oldSecret(HARBOR_MASTER)], { shipped: true, minds: true });
    const secretId = ids[1] ?? "";
    const stood = userEntries(rig);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(inPrompt(rig, FERRY)).toBe(true);
    expect(inPrompt(rig, SECRET)).toBe(false);
    expect(userEntries(rig)).toEqual(stood);
    // A world entry indexed from it, secret by the same gate: its draft save, the commit, the chat's Upgrade to it.
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wreck", value: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: ["ferry"], links: [], secret: true, gate: HARBOR_MASTER, source: { kind: "book", bookId, entryId: secretId, hash: bookTextHash(`${SECRET}.`) } } }));
    expect(userEntries(rig)).toEqual(stood);
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: committed.revision }));
    expect(userEntries(rig)).toEqual(stood);
    await rig.turn(chatId, "I walk back to the ferry.", "The ferry horn sounds again.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    rig.body(await rig.send({ type: "lre.sections", chatId }));
    expect(userEntries(rig)).toEqual(stood);
    // GM → Minds → Run on Danny, who holds no part of it while its gate is shut.
    const before = rig.host.quietCalls.length;
    const run = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: ["danny_okafor"] })).run as MindsRunView;
    const ended = await rig.host.sentWhere((m) => m.type === "lre.minds.update" && m.run.runId === run.runId && m.run.status !== "running");
    expect(ended.type === "lre.minds.update" && ended.run.status).toBe("done");
    const ran = rig.host.quietCalls.slice(before);
    expect(ran.map((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1])).toContain("Danny Okafor");
    expect(JSON.stringify(ran.map((c) => c.messages))).not.toContain(SECRET);
    expect(userEntries(rig)).toEqual(stood);
    // The gate holds: the entry is switched on for the prompt, and stays stored as it was.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: pov, field: "occupation", value: "harbor_master" }] }));
    await rig.turn(chatId, "I wait by the ferry.", "The ferry docks.");
    expect(promptOf(rig, secretId)).toContain(SECRET);
    expect(userEntries(rig)).toEqual(stood);
    const reply = rig.host.chat(chatId).messages.at(-1);
    if (!reply) throw new Error("no reply");
    rig.host.editMessage(chatId, reply.id, "The ferry docks by the ferry office.");
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: `reread:${reply.id}:${reply.swipeId}`, choice: "reread" }));
    expect(userEntries(rig)).toEqual(stood);
    // Three turns, a minds run and a Re-read on Port Alder with minds take a while.
  }, 60_000);

  test("an entry kept secret on both sides, by its own fields and by the world entry indexed from it, opens only once both gates hold", async () => {
    const registry = createRegistry(ALL_PACKS);
    const world = blankWorld("w_both", "Both");
    const entries = [candidate("e", "b", true, lreFields({ secret: true, gate: "true" }))];
    for (const [gate, opens] of [["false", false], ["true", true]] as const) {
      world.lore.wreck = { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate, source: { kind: "book", bookId: "b", entryId: "e", hash: bookTextHash(`${SECRET}.`) } };
      const verdict = await worldInfoVerdict(gateOn(registry, async () => ({ world, state: startState(world, registry) })), { chatId: "c", userId: "u", chatMetadata: {}, entries });
      expect(prompted(entries, verdict).some((t) => t.includes(SECRET))).toBe(opens);
    }
  });

  test("a twin an earlier build switched off as the copy of a secret world entry's source opens only once the world entry's gate holds too", async () => {
    const registry = createRegistry(ALL_PACKS);
    const world = blankWorld("w_twin", "Twin");
    // Its text as the book has it since the world entry was indexed: the note alone ties it to the world entry.
    const entries = [candidate("t", "b2", true, { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" }, secretCopyOf: { entry: "b/e", off: false, fields: null } } }, "WRECK-NOW: the boat went down.")];
    for (const [gate, opens] of [["false", false], ["true", true]] as const) {
      world.lore.wreck = { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate, source: { kind: "book", bookId: "b", entryId: "e", hash: bookTextHash(`${SECRET}.`) } };
      const verdict = await worldInfoVerdict(gateOn(registry, async () => ({ world, state: startState(world, registry) })), { chatId: "c", userId: "u", chatMetadata: {}, entries });
      expect(prompted(entries, verdict).includes("WRECK-NOW: the boat went down.")).toBe(opens);
    }
  });
});

describe("secret marks in the narrator's prompt", () => {
  test("under the default view, everyone in the scene with secrets marked, each mark is told marked with whom it is known to, beside the entry's public text", async () => {
    const { rig, chatId, ids } = await bookChat(MARKED, { shipped: true });
    const [ferry = "", wreck = "", dock = ""] = ids;
    const stood = userEntries(rig);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    // The author wrote "Marcus" and "Jordan": the narrator is told whose secret each is by their names.
    for (const told of [FERRY, DEBT, "Marcus Delgado"]) expect(promptOf(rig, ferry)).toContain(told);
    for (const told of [DOCK, SEEN, "Jordan Ellis"]) expect(promptOf(rig, dock)).toContain(told);
    // A whole-entry secret is that one secret, marked.
    expect(promptOf(rig, wreck)).toBe(secretMarkText(WRECK, [], "everyone"));
    expect(userEntries(rig)).toEqual(stood);
  });

  const VIEWS: [string, NarratorView][] = [
    ["everyone in the scene with secrets left out", { knowledge: "scene", secrets: "omit" }],
    ["the player character's, secrets marked", { knowledge: "pov", secrets: "marked" }],
  ];
  for (const [label, narrator] of VIEWS) {
    test(`under a chat's own view, ${label}, a mark kept from the player character is left out, a whole-entry one switched off, and one Jordan knows stays, marked`, async () => {
      const { rig, chatId, ids } = await bookChat(MARKED, { shipped: true, narrator });
      const [ferry = "", wreck = "", dock = ""] = ids;
      const stood = userEntries(rig);
      await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
      expect(promptOf(rig, ferry)).toContain(FERRY);
      expect(inPrompt(rig, DEBT)).toBe(false);
      expect(promptOf(rig, wreck)).toBe("");
      expect(inPrompt(rig, WRECK)).toBe(false);
      for (const told of [DOCK, SEEN, "Jordan Ellis"]) expect(promptOf(rig, dock)).toContain(told);
      expect(userEntries(rig)).toEqual(stood);
    });
  }

  // What the player character's narrator may be told: the chat's view is the player character's.
  test("a mark the player character holds by now goes in under their view, they among the people who know it; one they don't hold stays out", async () => {
    const { rig, chatId, bookId, ids, pov } = await bookChat(MARKED, { shipped: true, narrator: PLAYER_VIEW });
    const [ferry = "", wreck = ""] = ids;
    // Marcus told Jordan about the slip fees in play, as the knowledge step records a telling (DESIGN §24.11).
    const debt = factId({ kind: "wi", book: bookId, entry: ferry, mark: 0 });
    const told: LedgerEvent[] = [
      { type: MINDS_EVENTS.fact, data: { fact: { id: debt, kind: "wi", claim: DEBT, about: [], truth: "true" } } },
      { type: MINDS_EVENTS.learn, data: { who: [pov], fact: debt, how: "told", by: "marcus_delgado", evidence: [], belief: "true", confidence: 1, msg: null, at: 0 } },
    ];
    await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id: "told", target: "head", entry: { kind: "fix", events: told } });
    await rig.host.settle();
    const stood = userEntries(rig);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    for (const shown of [FERRY, DEBT, "Marcus Delgado", "Jordan Ellis"]) expect(promptOf(rig, ferry)).toContain(shown);
    expect(promptOf(rig, wreck)).toBe("");
    expect(inPrompt(rig, WRECK)).toBe(false);
    expect(userEntries(rig)).toEqual(stood);
  });

  /** Marks kept from the player character as an author may write them: in words, and with a name misspelled. */
  const YOU = "YOU-MARK: the harbor master keeps a second set of keys.";
  const PC = "PC-MARK: a page is torn out of the ferry's logbook.";
  const TYPO = "TYPO-MARK: Danny sold the old outboard for cash.";
  const OTHERS = "OTHERS-MARK: Jordan paid the slip fees twice.";
  const NAMED = [entry("The harbor", `${DOCK}\n{{// Secret (kept from you): ${YOU}}}\n{{// Secret (kept from the player character): ${PC}}}\n{{// Secret (kept from Jordan Elis): ${TYPO}}}\n{{// Secret (kept from Marcus): ${OTHERS}}}`)];
  for (const [label, narrator] of VIEWS) {
    test(`under a chat's own view, ${label}, a mark kept from "you", from "the player character", or from a name that names no one is left out; one kept from Marcus alone stays`, async () => {
      const { rig, chatId, ids } = await bookChat(NAMED, { shipped: true, narrator });
      await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
      for (const shown of [DOCK, OTHERS]) expect(promptOf(rig, ids[0] ?? "")).toContain(shown);
      for (const kept of [YOU, PC, TYPO]) expect(inPrompt(rig, kept)).toBe(false);
    });
  }

  test("under the default view, the marks kept from \"you\" and \"the player character\" are told kept from Jordan; one kept from a misspelled name is told kept from Jordan too, and one kept from Marcus alone from him", async () => {
    const { rig, chatId, ids } = await bookChat(NAMED, { shipped: true });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const told = promptOf(rig, ids[0] ?? "");
    expect(told).toContain(DOCK);
    for (const kept of [YOU, PC]) expect(told).toContain(secretMarkText(kept, [], ["Jordan Ellis"]));
    // The narrator can't tell whom "Jordan Elis" means, so it is told the player character may be one of them.
    expect(told).toContain(secretMarkText(TYPO, [], ["Jordan Ellis", "Jordan Elis"]));
    expect(told).toContain(secretMarkText(OTHERS, [], ["Marcus Delgado"]));
  });

  test("when the interceptor fails, the host strips every mark itself and no secret reaches the prompt, an earlier build's with its gate holding included", async () => {
    const { rig, chatId, ids } = await bookChat([...MARKED, oldSecret("true"), entry("The pier", PLAIN)]);
    const stood = userEntries(rig);
    rig.host.worldInfoInterceptor = async () => {
      throw new Error("the interceptor broke");
    };
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    for (const shown of [FERRY, DOCK, PLAIN]) expect(inPrompt(rig, shown)).toBe(true);
    for (const kept of [DEBT, WRECK, SEEN, SECRET]) expect(inPrompt(rig, kept)).toBe(false);
    expect(promptOf(rig, ids[1] ?? "")).toBe("");
    expect(userEntries(rig)).toEqual(stood);
  });

  test("when the chat's state can't be read, no secret reaches the prompt: every mark is left out, and a whole-entry secret, a mark's twin and an earlier build's secret stored on are all off", async () => {
    const entries = [
      candidate("ferry", "b", false, {}, `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`),
      candidate("wreck", "b", false, {}, `{{// Secret: ${WRECK}}}`),
      candidate("dock", "b", false, {}, `${DOCK}\n{{// Secret (known to Jordan): ${SEEN}}}`),
      candidate("copy", "b2", false, {}, DEBT),
      candidate("old", "b", false, lreFields({ secret: true, gate: "true" })),
      candidate("plain", "b", false, {}, PLAIN),
    ];
    const verdict = await worldInfoVerdict(gateOn(createRegistry(ALL_PACKS), async () => Promise.reject(new Error("no state"))), { chatId: "c", userId: "u", chatMetadata: {}, entries });
    const told = prompted(entries, verdict).join("\n");
    for (const shown of [FERRY, DOCK, PLAIN]) expect(told).toContain(shown);
    for (const kept of [DEBT, WRECK, SEEN, SECRET]) expect(told).not.toContain(kept);
  });

  test("a mark that can't be read reaches no prompt and no helper, while the entry's other text does, and Build shows it as one that can't be read", async () => {
    const BROKEN = "{{// Secret: BROKEN-A {{user}} BROKEN-B}}";
    const { rig, chatId, bookId, ids } = await bookChat([entry("The ferry", `${FERRY}\n${BROKEN}`)]);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(promptOf(rig, ids[0] ?? "")).toContain(FERRY);
    expect(interpretPrompt(rig)).toContain(FERRY);
    for (const words of ["BROKEN-A", "BROKEN-B"]) {
      expect(inPrompt(rig, words)).toBe(false);
      expect(carrying(rig, words)).toEqual([]);
    }
    const shown = (rig.body(await rig.send({ type: "lre.lore", op: "entries", bookId })).entries as LoreBookEntryView[]).find((e) => e.id === ids[0]);
    expect(shown?.unreadable?.map((u) => u.raw)).toEqual([BROKEN]);
    expect(shown?.marks).toBeUndefined();
  });

  /** A Port Alder chat whose book holds Marcus's mark, and a book a character's card brought holding a copy of the mark's words, both read by the chat. */
  async function twinChat(narrator?: NarratorView): Promise<{ rig: Rig; chatId: string; original: string; twin: string }> {
    const { rig, chatId, ids } = await bookChat([entry("The ferry", `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`)], { shipped: true, narrator });
    const card = rig.host.userBook("Harbor notes", { character: true });
    const twin = await rig.host.books.createEntry(card, entry("Marina gossip", `  ${DEBT}\n`), rig.host.userId);
    await attachBook(rig, chatId, card);
    return { rig, chatId, original: ids[0] ?? "", twin };
  }

  test("a twin, an entry whose whole text is a mark's text, reads as the mark: told as the mark is told, and read by no helper", async () => {
    const { rig, chatId, original, twin } = await twinChat();
    const stood = userEntries(rig);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const told = promptOf(rig, twin);
    expect(told).toContain(DEBT);
    expect(told).toContain("Marcus Delgado");
    expect(promptOf(rig, original)).toContain(told);
    expect(carrying(rig, DEBT)).toEqual([]);
    expect(userEntries(rig)).toEqual(stood);
  });

  test("a twin is left out with its mark where the view leaves the mark out", async () => {
    const { rig, chatId, twin } = await twinChat(PLAYER_VIEW);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(promptOf(rig, twin)).toBe("");
    expect(inPrompt(rig, DEBT)).toBe(false);
    expect(carrying(rig, DEBT)).toEqual([]);
  });
});

describe("what each reader is handed of an entry's marks", () => {
  test("helpers read an entry's public text and never a mark's; the mark's text reaches its holder's mind, and the knowledge step reading what they hold, and no other", async () => {
    const TIPS = "TIPS-MARK: Danny skims the shop's tip jar on Fridays.";
    const { rig, chatId } = await bookChat([entry("The ferry", `${FERRY}\n{{// Secret (known to Danny Okafor): ${TIPS}}}`)], { shipped: true, minds: true });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(interpretPrompt(rig)).toContain(FERRY);
    expect(readers(rig, MIND_PROMPT)).toEqual(expect.arrayContaining(["Danny Okafor", "Priya Nair"]));
    expect(readers(rig, TIPS).sort()).toEqual(["Danny Okafor", "the knowledge step"]);
  });

  const OLD = "OLD-MARK: the ferryman sank his own boat for the insurance money.";
  const WALL = "WALL-MARK: the harbor wall is older than the town.";
  const TUNNEL = "TUNNEL-MARK: Danny found a smugglers' tunnel behind the wall.";

  /**
   * Port Alder with minds, and a book whose earlier-build secret was moved to a mark: its whole text
   * wrapped as one mark kept from everyone, its old fields kept beside it (their gate holding), switched
   * on again. Beside it, a place entry whose text holds one of Danny's secrets. Both are about where the
   * player character starts, so the Place section reads them.
   */
  async function migratedChat(narrator?: NarratorView): Promise<{ rig: Rig; chatId: string; migrated: string }> {
    const { rig, chatId, ids } = await bookChat((here) => [entry("The old boat", `{{// Secret: ${OLD}}}`, { extensions: lreFields({ secret: true, gate: "true", links: [here] }) }), about(here, `${WALL}\n{{// Secret (known to Danny Okafor): ${TUNNEL}}}`)], { shipped: true, minds: true, narrator });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    return { rig, chatId, migrated: ids[0] ?? "" };
  }

  test("a migrated secret reaches no section, prompt, helper, mind or trace under a view that leaves secrets out, and no section holds a mark as written", async () => {
    const { rig, chatId } = await migratedChat({ knowledge: "scene", secrets: "omit" });
    const sections = await sectionTexts(rig, chatId);
    expect(sections.some((s) => s.includes(WALL))).toBe(true);
    for (const s of sections) for (const leak of ["{{//", "｛｛", OLD, TUNNEL]) expect(s).not.toContain(leak);
    expect(inPrompt(rig, OLD)).toBe(false);
    expect(inPrompt(rig, TUNNEL)).toBe(false);
    // The helpers and both minds ran.
    expect(interpretPrompt(rig)).not.toBe("");
    expect(readers(rig, MIND_PROMPT)).toEqual(expect.arrayContaining(["Danny Okafor", "Priya Nair"]));
    expect(carrying(rig, OLD)).toEqual([]);
    expect(JSON.stringify(rig.rt.inspectorRecords(chatId) ?? [])).not.toContain(OLD);
  });

  test("under the default view a migrated secret reaches the narrator marked, still no helper or mind, and no section holds a mark as written", async () => {
    const { rig, chatId, migrated } = await migratedChat();
    expect(promptOf(rig, migrated)).toBe(secretMarkText(OLD, [], "everyone"));
    const sections = await sectionTexts(rig, chatId);
    expect(sections.some((s) => s.includes(WALL))).toBe(true);
    for (const s of sections) for (const leak of ["{{//", "｛｛"]) expect(s).not.toContain(leak);
    expect(readers(rig, MIND_PROMPT)).toEqual(expect.arrayContaining(["Danny Okafor", "Priya Nair"]));
    expect(carrying(rig, OLD)).toEqual([]);
  });
});

describe("the Place section's lore", () => {
  const place = (rig: Rig): string => rig.host.section(DEFAULT_SECTIONS.place?.label ?? "Place");

  test("tells a place-linked entry the player character may read, and the entry still reaches the prompt by its own activation", async () => {
    const { rig, chatId, ids } = await bookChat((here) => [about(here, "WALL-MARK: the harbor wall is older than the town.")], { shipped: true });
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(place(rig)).toContain("WALL-MARK");
    expect(promptOf(rig, ids[0] ?? "")).toContain("WALL-MARK");
  });

  test("an entry about the town too long for the budget is left out whole, never cut, and the place's own description stays", async () => {
    const long = Array.from({ length: 2000 }, (_, i) => `In year ${i} the town grew by a street.`).join(" ");
    const { rig, chatId } = await bookChat((_here, world) => [about(world.places[world.start.place]?.parent ?? world.start.place, long)], { shipped: true });
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(place(rig)).toContain("Harbor Hardware");
    expect(place(rig)).not.toContain("In year 0 the town grew");
  });

  // What the player character's narrator may be told: the chat's view is the player character's.
  test("a place entry an earlier build kept secret stays out of the section and the prompt until its gate holds, then is in both", async () => {
    const { rig, chatId, pov, ids } = await bookChat((here) => [about(here, `${SECRET}.`, { secret: true, gate: HARBOR_MASTER }, { disabled: true })], { shipped: true, narrator: PLAYER_VIEW });
    await rig.turn(chatId, "I wait.", "Gulls call.");
    expect(inPrompt(rig, SECRET)).toBe(false);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: pov, field: "occupation", value: "harbor_master" }] }));
    await rig.turn(chatId, "I wait some more.", "Gulls call again.");
    expect(place(rig)).toContain(SECRET);
    expect(promptOf(rig, ids[0] ?? "")).toContain(SECRET);
  });
});

describe("Build's World Info lore editor", () => {
  test("Make secret and Make public change only an entry's text, Save only its LRE fields, and an entry is made secret no other way", async () => {
    const TEXT = "WRECK-TEXT: the old boat lies off the point.";
    const OWED = "OWED-TEXT: Dev owes the ferryman.";
    const { rig, bookId, ids } = await bookChat([entry("The wreck", TEXT, { extensions: { other_tool: { note: "kept" } } }), oldSecret()]);
    const [entryId = "", oldId = ""] = ids;
    /** The entry as the host stores it: its text, and everything else of it. */
    const stored = (id: string) => {
      const e = rig.host.storedEntry(id);
      if (!e) throw new Error(`no entry ${id}`);
      const { content, ...rest } = e;
      return { content, rest };
    };
    const mark = (id: string, change: JsonObject) => rig.send({ type: "lre.lore", op: "mark", bookId, entryId: id, change });
    const shown = (reply: BackendToFrontend) => (rig.body(reply).entries as LoreBookEntryView[]).find((e) => e.id === entryId);
    const before = stored(entryId);

    // Make secret: the whole text one secret, Dev's.
    let view = shown(await mark(entryId, { kind: "secret", knownTo: ["Dev"], keptFrom: "everyone" }));
    expect(view).toMatchObject({ disabled: false, whole: true, marks: [{ text: TEXT, knownTo: ["Dev"], keptFrom: "everyone" }] });
    expect(stored(entryId).rest).toEqual(before.rest);
    // Make public: the text as it was.
    view = shown(await mark(entryId, { kind: "public", mark: 0 }));
    expect(view?.marks).toBeUndefined();
    expect(stored(entryId)).toEqual(before);
    // A secret line added at its end, then its names changed: the rest of the text stays what anyone reads.
    view = shown(await mark(entryId, { kind: "add", text: OWED, knownTo: ["Dev"], keptFrom: ["Sam"] }));
    expect(view?.marks).toEqual([{ text: OWED, knownTo: ["Dev"], keptFrom: ["Sam"] }]);
    expect(view?.whole).toBeUndefined();
    expect(publicText(stored(entryId).content).trim()).toBe(TEXT);
    view = shown(await mark(entryId, { kind: "names", mark: 0, knownTo: ["Sam", "Dev"], keptFrom: "everyone" }));
    expect(view?.marks).toEqual([{ text: OWED, knownTo: ["Sam", "Dev"], keptFrom: "everyone" }]);
    expect(publicText(stored(entryId).content).trim()).toBe(TEXT);
    expect(stored(entryId).rest).toEqual(before.rest);
    // A mark the host couldn't strip whole is refused, and nothing is written.
    const marked = stored(entryId);
    const unwritable = await mark(entryId, { kind: "add", text: "Dev }} owes more.", knownTo: [], keptFrom: "everyone" });
    expect(unwritable.type === "lre.error" && unwritable.code).toBe("bad_request");
    expect(stored(entryId)).toEqual(marked);
    // Made public, the mark's words stay where they stood, as plain text.
    view = shown(await mark(entryId, { kind: "public", mark: 0 }));
    expect(view?.marks).toBeUndefined();
    expect(stored(entryId)).toEqual({ content: `${TEXT}\n${OWED}`, rest: before.rest });
    // An earlier build's secret takes no mark: its secrecy moves with its book's, which keeps it for a restore.
    const old = stored(oldId);
    const refused = await mark(oldId, { kind: "secret", knownTo: [], keptFrom: "everyone" });
    expect(refused.type === "lre.error" && refused.code).toBe("bad_request");
    expect(stored(oldId)).toEqual(old);

    // Save: the entry's visibility and links and nothing else of it, the other tool's data kept.
    const save = (id: string, fields: JsonObject | null) => rig.send({ type: "lre.lore", op: "fields", bookId, entryId: id, fields });
    const plain = stored(entryId);
    rig.body(await save(entryId, { visibility: "known_by", links: ["dev"] }));
    expect(stored(entryId)).toEqual({ content: plain.content, rest: { ...plain.rest, extensions: { other_tool: { note: "kept" }, ...lreFields({ visibility: "known_by", links: ["dev"] }) } } });
    // Secrecy is no field Save writes: an entry is made secret by a mark in its text.
    const saved = stored(entryId);
    const secrecy: JsonObject[] = [{ secret: true, gate: GATE }, { links: ["dev"], gate: GATE }, { holders: ["dev"] }, { secret: false }];
    for (const fields of secrecy) {
      const reply = await save(entryId, fields);
      expect(reply.type === "lre.error" && reply.code).toBe("bad_request");
      expect(stored(entryId)).toEqual(saved);
    }
    rig.body(await save(entryId, null));
    expect(stored(entryId)).toEqual(plain);
    // An earlier build's secrecy fields stay as stored beside what Save writes, the entry stored off as it was.
    rig.body(await save(oldId, { links: ["home"] }));
    expect(stored(oldId)).toEqual({ content: old.content, rest: { ...old.rest, extensions: lreFields({ secret: true, gate: GATE, links: ["home"] }) } });
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

describe("World Info secrecy wherever the entry is read", () => {
  /** A user book holding one entry (on, answering to a key nobody types), attached to `chatId`. */
  async function oneEntry(rig: Rig, chatId: string, over: Partial<HostBookEntryInput>): Promise<{ bookId: string; entryId: string }> {
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The wreck", `${SECRET}.`, { keys: ["zzqq"], constant: false, ...over }), rig.host.userId);
    await attachBook(rig, chatId, bookId);
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
  const DEBT_NOTE = "DEBT-MARK: the ferryman owes the harbor master money.";
  /** A book holding `DEBT_NOTE`, Known by whoever knows `links`; attached to `chatId` when given. */
  async function debtBook(rig: Rig, links: string[], chatId?: string): Promise<{ bookId: string; entryId: string }> {
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The debt", DEBT_NOTE, { extensions: lreFields({ visibility: "known_by", links }) }), rig.host.userId);
    if (chatId) await attachBook(rig, chatId, bookId);
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
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "debt", value: { id: "debt", title: "The debt", content: DEBT_NOTE, keys: ["ferry"], links: [], visibility: "known_by" } }));
    });
    await debtBook(rig, [place], chatId);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "DEBT-MARK")).toEqual([]);
  });

  test("a Known-by world entry that links nothing stays unread though the book entry it was indexed from links what the player character knows", async () => {
    const { rig, chatId } = await loreChat(async (rig, worldId, here) => {
      const { bookId, entryId } = await debtBook(rig, [here]);
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "debt", value: { id: "debt", title: "The debt", content: DEBT_NOTE, keys: ["ferry"], links: [], visibility: "known_by", source: { kind: "book", bookId, entryId, hash: bookTextHash(DEBT_NOTE) } } }));
    });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "DEBT-MARK")).toEqual([]);
  });

  /**
   * A world chat whose starting place has one book entry pinned, `over` its own, its book attached to
   * no chat: `setup` gives the draft its lore, and the entry any change made in Build, before the commit.
   */
  async function pinnedChat(content: string, over: Partial<HostBookEntryInput>, setup: (rig: Rig, worldId: string, bookId: string, entryId: string) => Promise<void>): Promise<{ rig: Rig; chatId: string }> {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
    const bookId = await rig.host.books.create("Harbor notes", "", rig.host.userId);
    const entryId = await rig.host.books.createEntry(bookId, entry("The wreck", content, { keys: ["zzqq"], constant: false, ...over }), rig.host.userId);
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
    const { rig, chatId } = await pinnedChat(DEBT_NOTE, {}, async (rig, worldId, bookId, entryId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "debt", value: { id: "debt", title: "The debt", content: DEBT_NOTE, keys: [], links: ["dev"], visibility: "known_by", source: { kind: "book", bookId, entryId, hash: bookTextHash(DEBT_NOTE) } } }));
    });
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, "DEBT-MARK")).toEqual([]);
    expect(inPrompt(rig, "DEBT-MARK")).toBe(false);
  });

  test("a book entry an earlier build kept secret, indexed into a secret world entry and pinned where the player character is, opens only once the world entry's gate holds too", async () => {
    const { rig, chatId } = await pinnedChat(`${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate: "true" }) }, async (rig, worldId, bookId, entryId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wreck", value: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate: "false", source: { kind: "book", bookId, entryId, hash: bookTextHash(`${SECRET}.`) } } }));
    });
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, SECRET)).toEqual([]);
    const traced = (rig.rt.inspectorRecords(chatId) ?? []).flatMap((r) => r.lore ?? []).flatMap((t) => t.entries.map((e) => e.title));
    expect(traced).not.toContain("The wreck");
  });

  test("a World Info entry made secret in Build, pinned to the starting place, reaches no call and no trace", async () => {
    const { rig, chatId } = await pinnedChat(`${SECRET}.`, {}, async (rig, _worldId, bookId, entryId) => {
      rig.body(await rig.send({ type: "lre.lore", op: "mark", bookId, entryId, change: { kind: "secret", knownTo: [], keptFrom: "everyone" } }));
    });
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, SECRET)).toEqual([]);
    const traced = (rig.rt.inspectorRecords(chatId) ?? []).flatMap((r) => r.lore ?? []).flatMap((t) => t.entries.map((e) => e.title));
    expect(traced).not.toContain("The wreck");
  });

  /** A copy note as an earlier build left it on a twin it switched off: the original it names, the twin on before, no fields of its own. */
  const copyNote = (original: string): JsonObject => ({ [LEDGER_NAMESPACE]: { secretCopyOf: { entry: original, off: false, fields: null } } });

  test("a card's copy of a secret, pinned alone, is as secret as its original in a book nothing else reads: it reaches no call and no trace", async () => {
    const { rig, chatId } = await pinnedChat(`${SECRET}.`, { disabled: true }, async (rig, _worldId, _bookId, entryId) => {
      const saga = await rig.host.books.create("Saga - Core", "", rig.host.userId);
      const original = await rig.host.books.createEntry(saga, entry("The wreck", `${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate: "false" }) }), rig.host.userId);
      // What an earlier build left on the copy a character's card brought: the pinned entry is that copy.
      await rig.host.books.update(entryId, { extensions: copyNote(`${saga}/${original}`) }, rig.host.userId);
    });
    const stood = userEntries(rig);
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, SECRET)).toEqual([]);
    const traced = (rig.rt.inspectorRecords(chatId) ?? []).flatMap((r) => r.lore ?? []).flatMap((t) => t.entries.map((e) => e.title));
    expect(traced).not.toContain("The wreck");
    expect(userEntries(rig)).toEqual(stood);
  });

  test("a card's copy of a secret whose original is gone, pinned, stays secret: it reaches no call", async () => {
    const { rig, chatId } = await pinnedChat(`${SECRET}.`, { disabled: true, extensions: copyNote("gone-book/gone-entry") }, async () => undefined);
    await rig.turn(chatId, "I look out at the water and wait.", "Gulls call.");
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);
    expect(carrying(rig, SECRET)).toEqual([]);
  });

  // What the player character's narrator may be told: the chat's view is the player character's.
  test("a public world entry over a book entry made secret in Build reads as secret: not in the Place section, nor any call", async () => {
    const { rig, chatId } = await bookChat([], { shipped: true, narrator: PLAYER_VIEW });
    const { bookId, entryId } = await oneEntry(rig, chatId, {});
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wall", value: { id: "wall", title: "The harbor wall", content: `${SECRET}.`, keys: [], links: [draft.start.place], source: { kind: "book", bookId, entryId, hash: bookTextHash(`${SECRET}.`) } } }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: committed.revision }));
    rig.body(await rig.send({ type: "lre.lore", op: "mark", bookId, entryId, change: { kind: "secret", knownTo: [], keptFrom: "everyone" } }));
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "I look at the harbor wall.", "Gulls call.");
    expect(rig.host.section(DEFAULT_SECTIONS.place?.label ?? "Place")).not.toContain(SECRET);
    expect(carrying(rig, SECRET)).toEqual([]);
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
    rig.body(await rig.send({ type: "lre.lore", op: "mark", bookId, entryId, change: { kind: "secret", knownTo: [], keptFrom: "everyone" } }));
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
    await oneEntry(rig, chatId, { disabled: true, constant: true, keys: [], extensions: lreFields({ secret: true, gate: "self.place == 'alder_market'" }) });
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

describe("minds in a time skip", () => {
  test("a mind at a skip's beat reads a live World Info entry", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(MIND_PROMPT) ? JSON.stringify({ monologue: "Nothing yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: "calm" }) : "{}");
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // Every place's name brings the entry up, so a mind anywhere reads it.
    const bookId = await rig.host.books.create("Town notes", "", rig.host.userId);
    await rig.host.books.createEntry(bookId, entry("Town notes", "BEAT-MARK: the town council meets on Thursdays.", { keys: Object.values(draft.places).map((p) => p.name), constant: false }), rig.host.userId);
    await attachBook(rig, chatId, bookId);
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
    const minds = rig.host.quietCalls.slice(before).filter((c) => (c.messages[0]?.content ?? "").includes(MIND_PROMPT));
    expect(minds.length).toBeGreaterThan(0);
    expect(minds.some((c) => JSON.stringify(c.messages).includes("BEAT-MARK"))).toBe(true);
  });
});
