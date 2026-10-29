// GM → Minds on demand and lore pins on the fake host (DESIGN §24.5, §24.9): Run minds now records
// the chosen characters' minds from the chat so far as one GM edit with its Undo; lore pinned to a
// character and to a place reaches that character's mind and every helper and mind call there, and
// a secret pinned there reaches none of them; a whole book pinned is read as the book is at each
// call; a step's pins reach every call of that step and no other, the mind step's every mind; a pin
// to a missing entry is linted.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import type { MindsRunView } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { bookTextHash } from "../../src/shared/lore";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { readCharacter } from "../../src/packs/minds/core/state";
import { lint, newWorld } from "../../src/cli/local-engine";
import { Rig } from "../support/rig";

const PEOPLE = ["danny_okafor", "priya_nair"] as const;
const MIND = /You are the private mind of (.+?) in the roleplay world/;

/** Mind calls answer with `mark` in the monologue; every other step says nothing. */
function fakeModels(rig: Rig, mark: { text: string }): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const mind = MIND.exec(req.messages[0]?.content ?? "")?.[1];
    if (mind) return JSON.stringify({ monologue: `${mark.text} thoughts of ${mind}.`, depiction: `${mind} looks up`, intent: "wait and see", reactions: [], plans: [], mood: "calm" });
    if ((req.messages[0]?.content ?? "").includes("You map a player's typed input")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    return JSON.stringify({ proposals: [] });
  };
}

const mindCalls = (rig: Rig): QuietRequest[] => rig.host.quietCalls.filter((c) => MIND.test(c.messages[0]?.content ?? ""));
const nameOf = (c: QuietRequest): string => MIND.exec(c.messages[0]?.content ?? "")?.[1] ?? "";

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

/** Port Alder with Danny and Priya Live beside the POV; `setup` writes lore and pins into the draft (it gets the POV's start place) before the commit. */
async function alderChat(rig: Rig, setup: (worldId: string, here: string) => Promise<void> = async () => undefined): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...PEOPLE] } } }));
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  await setup(worldId, draft.start.place);
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov");
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: PEOPLE.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

/** The run's last update, once it has ended. */
async function runEnd(rig: Rig, runId: string): Promise<MindsRunView> {
  const last = await rig.host.sentWhere((m) => m.type === "lre.minds.update" && m.run.runId === runId && m.run.status !== "running");
  if (last.type !== "lre.minds.update") throw new Error("not a minds run update");
  return last.run;
}

describe("Run minds now (GM → Minds)", () => {
  test("records the chosen characters' minds from the chat so far, as one GM edit with its Undo, and tells the player nothing", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const mark = { text: "TURN-MARK" };
    fakeModels(rig, mark);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "LAST-REPLY-MARK: Danny nods. Priya smiles at you.");
    const before = mindCalls(rig).length;
    mark.text = "RUN-MARK";
    const started = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: ["danny_okafor"] })).run as MindsRunView;
    expect(started.status).toBe("running");
    const done = await runEnd(rig, started.runId);
    expect(done.status).toBe("done");
    expect(done.entries.map((e) => [e.entity, e.status])).toEqual([["danny_okafor", "recorded"]]);
    // Only Danny was asked, on the chat so far: how the latest reply ended.
    const calls = mindCalls(rig).slice(before);
    expect(calls.map(nameOf)).toEqual(["Danny Okafor"]);
    expect(calls[0]?.messages[1]?.content ?? "").toContain("LAST-REPLY-MARK");
    let { state } = await stateOf(rig, chatId);
    expect(readCharacter(state, "danny_okafor").mind?.monologue).toContain("RUN-MARK");
    expect(readCharacter(state, "danny_okafor").mind?.reason).toBe("gm");
    expect(readCharacter(state, "priya_nair").mind?.monologue).toContain("TURN-MARK");
    // No player surface tells the mind.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain("RUN-MARK");
    // One edit: its Undo takes the run's mind back.
    expect(done.undo).toMatch(/^fix:/);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: done.undo ?? "", choice: "undo" }));
    ({ state } = await stateOf(rig, chatId));
    expect(readCharacter(state, "danny_okafor").mind?.monologue).toContain("TURN-MARK");
    // Everyone Live and Near when nobody is named; a second run while one runs is refused.
    const all = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId })).run as MindsRunView;
    expect(all.entries.map((e) => e.entity).sort()).toEqual([...PEOPLE]);
    const again = await rig.send({ type: "lre.minds", op: "run", chatId });
    expect(again.type === "lre.error" && again.code).toBe("conflict");
    expect((await runEnd(rig, all.runId)).entries.every((e) => e.status === "recorded")).toBe(true);
  });

  test("a mind that comes back empty says why, and nothing is recorded", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const chatId = await alderChat(rig);
    rig.host.quietReply = () => "";
    const run = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: ["priya_nair"] })).run as MindsRunView;
    const done = await runEnd(rig, run.runId);
    expect(done.status).toBe("failed");
    expect(done.entries[0]?.reason).toBe("the answer was empty");
    expect(done.undo).toBeNull();
  });

  test("reads World Info as a turn's minds do: a world entry over a book entry made secret in Build reaches no mind it runs", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const user = rig.host.userId;
    const book = await rig.host.books.create("Town lore", "", user);
    const text = "RUMOR-PIN: the harbor master takes bribes.";
    const entryId = await rig.host.books.createEntry(book, { comment: "Harbor rumor", content: text, keys: [], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} }, user);
    const chatId = await alderChat(rig, async (worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "rumor", value: { id: "rumor", title: "Harbor rumor", content: text, keys: [], links: [], source: { kind: "book", bookId: book, entryId, hash: bookTextHash(text) } } }));
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { danny_okafor: [{ lore: "rumor" }] }, places: {} } }));
    });
    rig.body(await rig.send({ type: "lre.lore", op: "mark", bookId: book, entryId, change: { kind: "secret", knownTo: [], keptFrom: "everyone" } }));
    const before = mindCalls(rig).length;
    const run = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: ["danny_okafor"] })).run as MindsRunView;
    expect((await runEnd(rig, run.runId)).status).toBe("done");
    const calls = mindCalls(rig).slice(before);
    expect(calls.map(nameOf)).toEqual(["Danny Okafor"]);
    expect(JSON.stringify(calls)).not.toContain("RUMOR-PIN");
  });
});

describe("lore pins", () => {
  test("reach the pinned character's mind, and every helper and mind call at the pinned place; a secret pinned there reaches none", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    const user = rig.host.userId;
    const book = await rig.host.books.create("Town lore", "", user);
    const bookEntry = await rig.host.books.createEntry(book, { comment: "Town notice", content: "BOOK-PIN: the harbor closes at dusk.", keys: [], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} }, user);
    const chatId = await alderChat(rig, async (worldId, here) => {
      const put = async (id: string, value: JsonObject): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id, value }));
      await put("danny_ledger", { id: "danny_ledger", title: "Danny's ledger", content: "DANNY-PIN: Danny owes the bank three months.", keys: [], links: [] });
      await put("house_rules", { id: "house_rules", title: "House rules", content: "PLACE-PIN: no shoes on the couch.", keys: [], links: [] });
      await put("hidden_truth", { id: "hidden_truth", title: "Hidden truth", content: "SECRET-PIN: the deed is forged.", keys: [], links: [], secret: true, gate: "false" });
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { danny_okafor: [{ lore: "danny_ledger" }] }, places: { [here]: [{ lore: "house_rules" }, { lore: "hidden_truth" }, { book, entry: bookEntry }] } } }));
    });
    await rig.turn(chatId, "I walk to the window and wait.", "The kettle clicks off.");
    const minds = new Map(mindCalls(rig).map((c) => [nameOf(c), c.messages[1]?.content ?? ""]));
    expect(minds.get("Danny Okafor")).toContain("DANNY-PIN");
    for (const name of ["Danny Okafor", "Priya Nair"]) {
      expect(minds.get(name)).toContain("PLACE-PIN");
      expect(minds.get(name)).toContain("BOOK-PIN");
    }
    expect(minds.get("Priya Nair")).not.toContain("DANNY-PIN");
    // A helper at the place reads the place's pins, never a character's.
    const interpret = rig.host.quietCalls.find((c) => (c.messages[0]?.content ?? "").includes("You map a player's typed input"))?.messages[0]?.content ?? "";
    expect(interpret).toContain("PLACE-PIN");
    expect(interpret).toContain("BOOK-PIN");
    expect(interpret).not.toContain("DANNY-PIN");
    // The secret reaches no call, and no trace names it; the inspector shows the pins that were read.
    expect(JSON.stringify(rig.host.quietCalls)).not.toContain("SECRET-PIN");
    const records = rig.rt.inspectorRecords(chatId) ?? [];
    expect(JSON.stringify(records)).not.toContain("Hidden truth");
    const danny = records.flatMap((r) => r.minds ?? []).find((t) => t.who === "Danny Okafor" && t.purpose === "mind");
    expect((danny?.pinned ?? []).map((p) => p.title)).toEqual(["Danny's ledger", "House rules", "Town notice"]);
    expect(records.flatMap((r) => r.lore ?? []).find((t) => t.step === "interpret")?.entries.filter((e) => e.pinned).map((e) => e.title)).toEqual(["House rules", "Town notice"]);
  });

  test("a whole book pinned is read as the book is at each call: its switched-on entries, one added after pinning included, never one the engine wrote", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const user = rig.host.userId;
    const entry = (comment: string, content: string, disabled = false, extensions: JsonObject = {}) => ({ comment, content, keys: [], disabled, constant: false, position: 0, depth: 4, role: null, order: 100, extensions });
    const chapters = await rig.host.books.create("Chat chapters", "", user);
    await rig.host.books.createEntry(chapters, entry("Chapter 1", "CHAPTER-1: they met at the marina."), user);
    await rig.host.books.createEntry(chapters, entry("Draft", "OFF-MARK: a chapter not finished.", true), user);
    // A section the engine wrote, which holds what minds give the narrator, stays out whatever pins its book.
    const sections = await rig.host.books.create("Sections", "", user);
    await rig.host.books.createEntry(sections, entry("LRE · Minds", "ENGINE-MARK: another mind's depiction.", false, { lumi_rp_engine: { slot: "minds" } }), user);
    const chatId = await alderChat(rig, async (worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { danny_okafor: [{ book: chapters }, { book: sections }] }, places: {} } }));
    });
    const danny = (): string => mindCalls(rig).filter((c) => nameOf(c) === "Danny Okafor").at(-1)?.messages[1]?.content ?? "";
    await rig.turn(chatId, "Morning, Danny.", "He nods.");
    expect(danny()).toContain("CHAPTER-1");
    expect(danny()).not.toContain("OFF-MARK");
    // The next chapter is written into the book: no pin changes, no commit and no Upgrade.
    await rig.host.books.createEntry(chapters, entry("Chapter 2", "CHAPTER-2: the storm came in."), user);
    await rig.turn(chatId, "What happened next?", "The wind picks up.");
    expect(danny()).toContain("CHAPTER-1");
    expect(danny()).toContain("CHAPTER-2");
    expect(danny()).not.toContain("OFF-MARK");
    expect(JSON.stringify(rig.host.quietCalls)).not.toContain("ENGINE-MARK");
  });

  test("a step's pins reach every call of that step, whatever its lore setting, and no other step's", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps: { interpret: { enabled: true, signals: ["always"], lore: { policy: "none", tokens: 400 } } } } } }));
    const chatId = await alderChat(rig, async (worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "step_note", value: { id: "step_note", title: "Step note", content: "STEP-PIN: typed words mean what the player says.", keys: [], links: [] } }));
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: {}, places: {}, steps: { interpret: [{ lore: "step_note" }] } } }));
    });
    await rig.turn(chatId, "I walk to the window and wait.", "The kettle clicks off.");
    const interpret = (c: QuietRequest): boolean => (c.messages[0]?.content ?? "").includes("You map a player's typed input");
    expect(rig.host.quietCalls.find(interpret)?.messages[0]?.content).toContain("STEP-PIN");
    const others = rig.host.quietCalls.filter((c) => !interpret(c));
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) expect(JSON.stringify(c.messages)).not.toContain("STEP-PIN");
  });

  test("the mind step's pins reach every mind, after what is pinned to each, and no helper", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const chatId = await alderChat(rig, async (worldId) => {
      const put = async (id: string, value: JsonObject): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id, value }));
      await put("danny_ledger", { id: "danny_ledger", title: "Danny's ledger", content: "DANNY-PIN: Danny owes the bank three months.", keys: [], links: [] });
      await put("every_mind", { id: "every_mind", title: "Town talk", content: "EVERY-MIND-PIN: the harbor festival is Saturday.", keys: [], links: [] });
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { danny_okafor: [{ lore: "danny_ledger" }] }, places: {}, steps: { mind: [{ lore: "every_mind" }] } } }));
    });
    await rig.turn(chatId, "I walk to the window and wait.", "The kettle clicks off.");
    const minds = new Map(mindCalls(rig).map((c) => [nameOf(c), c.messages[1]?.content ?? ""]));
    for (const name of ["Danny Okafor", "Priya Nair"]) expect(minds.get(name)).toContain("EVERY-MIND-PIN");
    const danny = minds.get("Danny Okafor") ?? "";
    expect(danny.indexOf("DANNY-PIN")).toBeGreaterThanOrEqual(0);
    expect(danny.indexOf("DANNY-PIN")).toBeLessThan(danny.indexOf("EVERY-MIND-PIN"));
    const helpers = rig.host.quietCalls.filter((c) => !MIND.test(c.messages[0]?.content ?? ""));
    expect(helpers.length).toBeGreaterThan(0);
    for (const c of helpers) expect(JSON.stringify(c.messages)).not.toContain("EVERY-MIND-PIN");
  });

  test("the memory step's pins reach each memory written after the reply, as its only lore, and no mind or helper", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const chatId = await alderChat(rig, async (worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "memory_note", value: { id: "memory_note", title: "What to remember", content: "MEMORY-PIN: remember who owes whom.", keys: [], links: [] } }));
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: {}, places: {}, steps: { memory: [{ lore: "memory_note" }] } } }));
    });
    await rig.turn(chatId, "I walk to the window and wait.", "The kettle clicks off.");
    const MEMORY = /You keep the memory of (.+?) in the roleplay world/;
    const memories = rig.host.quietCalls.filter((c) => MEMORY.test(c.messages[0]?.content ?? ""));
    expect(memories.map((c) => MEMORY.exec(c.messages[0]?.content ?? "")?.[1]).sort()).toEqual(["Danny Okafor", "Priya Nair"]);
    for (const c of memories) expect(c.messages[1]?.content).toContain("## Pinned lore\n- What to remember: MEMORY-PIN: remember who owes whom.");
    for (const c of rig.host.quietCalls.filter((c) => !MEMORY.test(c.messages[0]?.content ?? ""))) expect(JSON.stringify(c.messages)).not.toContain("MEMORY-PIN");
  });

  test("a memory doesn't read a pinned world entry whose World Info entry was made secret since it was indexed", async () => {
    const SECRET = "WALL-SECRET: the harbor wall hides the smugglers' tunnel.";
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const user = rig.host.userId;
    const bookId = await rig.host.books.create("Harbor notes", "", user);
    const entryId = await rig.host.books.createEntry(bookId, { comment: "The harbor wall", content: SECRET, keys: [], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} }, user);
    const chatId = await alderChat(rig, async (worldId) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "wall", value: { id: "wall", title: "The harbor wall", content: SECRET, keys: [], links: [], source: { kind: "book", bookId, entryId, hash: bookTextHash(SECRET) } } }));
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: {}, places: {}, steps: { memory: [{ lore: "wall" }] } } }));
    });
    rig.body(await rig.send({ type: "lre.lore", op: "mark", bookId, entryId, change: { kind: "secret", knownTo: [], keptFrom: "everyone" } }));
    await rig.turn(chatId, "I walk to the window and wait.", "The kettle clicks off.");
    const MEMORY = /You keep the memory of (.+?) in the roleplay world/;
    const memories = rig.host.quietCalls.filter((c) => MEMORY.test(c.messages[0]?.content ?? ""));
    expect(memories.length).toBeGreaterThan(0);
    for (const c of memories) expect(JSON.stringify(c.messages)).not.toContain("WALL-SECRET");
  });

  test("a pin to an entry the world doesn't have is linted where it is", () => {
    const world = newWorld("w_pins", "Pins");
    const issues = lint({ ...world, lorePins: { characters: { [world.pov]: [{ lore: "no_such_entry" }] }, places: {}, steps: {} } });
    expect(issues.filter((i) => i.code === "pin_missing").map((i) => [i.path, i.severity])).toEqual([[`lorePins.characters.${world.pov}`, "warning"]]);
  });
});
