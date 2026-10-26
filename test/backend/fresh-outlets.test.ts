// No stale outlets (DESIGN §5.1, §6.4, §6.8): every engine section a prompt holds comes from the
// engine run that prepared the generation being assembled, at the place the preset that generation
// is assembled with gives it. The world's book holds a turn's sections only from its reply's guard
// until that prompt is assembled; a generation with no turn of its own (Impersonate, a dry run) is
// assembled from an empty book; and what can't be emptied, or a preset the host can't name, stops
// the generation with a flag that says why.

import { describe, expect, test } from "bun:test";
import type { HostPresetBlock, QuietRequest } from "../../src/backend/host";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { FakeHost, type AssembledEntry } from "../support/fake-host";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const EXTRACT_MARK = "propose concrete state changes";
const OUTLINE_MARK = "You outline a roleplay narrator's next reply";

const block = (name: string, content: string, enabled = true): HostPresetBlock => ({ id: `b_${name}`, name, content, enabled, marker: null, injectionTrigger: [], characterTagTrigger: [], categoryMode: null });

/** The world's engine entries that hold text or are on, as the host stores them. */
async function liveEntries(rig: Rig, chatId: string) {
  const run = await rig.rt.runOf(chatId, rig.host.userId);
  const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
  return (await rig.host.books.entries(bookId, rig.host.userId)).filter((e) => isRecord(e.extensions[LEDGER_NAMESPACE]) && (!e.disabled || e.content !== ""));
}

/** The engine's sections among what a prompt holds. */
function sectionsIn(entries: readonly AssembledEntry[]): string[] {
  return entries.filter((e) => /^\[[A-Z][a-z]+\]\n/.test(e.content)).map((e) => e.content);
}

/** The text a prompt holds at a preset's outlet. */
const atOutlet = (rig: Rig, outlet: string): string => rig.host.assembled.find((e) => e.position === 8 && e.outlet === outlet)?.content ?? "";

/** Holds the host's entry writes that `match` picks until `release`, as a host under load is slow to make them. `held` resolves when the first is held. */
function holdFills(rig: Rig, match: (content: string | null) => boolean): { release: () => void; held: Promise<void> } {
  const fill = rig.host.books.fill;
  const gate = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  rig.host.books.fill = async (entryId, content, userId) => {
    if (match(content)) {
      held.resolve();
      await gate.promise;
    }
    return fill(entryId, content, userId);
  };
  return {
    release: () => {
      rig.host.books.fill = fill;
      gate.resolve();
    },
    held: held.promise,
  };
}

/** A world with a checked coin flip, so a turn that flips has an Outcome. */
async function coinWorld(rig: Rig, meta: JsonObject = {}): Promise<string> {
  const worldId = await rig.newWorld("Coins");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "checks", id: "coin_flip", value: { id: "coin_flip", dice: "1d2", bands: [{ outcome: "fail", max: 1 }, { outcome: "success", min: 2 }] } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "flip_coin", value: { id: "flip_coin", label: "Flip a coin", params: {}, requires: [], check: "coin_flip", outcomes: { success: [], fail: [] }, duration: "1", lexicon: ["flip a coin"] } }));
  if (Object.keys(meta).length > 0) rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: meta }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  return worldId;
}

async function attached(rig: Rig, worldId: string): Promise<string> {
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** A same-roll coin chat whose outline step writes a numbered beat each time it is asked. */
async function outlinedCoins(rig: Rig): Promise<{ chatId: string; beats: () => number }> {
  let beat = 0;
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").startsWith(OUTLINE_MARK) ? JSON.stringify({ beats: [`Beat ${++beat}: the coin spins.`] }) : "{}");
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  const chatId = await attached(rig, await coinWorld(rig, { seedMode: "same_roll" }));
  rig.body(await rig.send({ type: "lre.action", chatId, action: "flip_coin", params: {}, source: "palette", now: true }));
  const first = await rig.host.start(chatId, { type: "normal" });
  expect(rig.host.section("Outline")).toContain("Beat 1: the coin spins.");
  await rig.host.finish(first, "Heads.");
  return { chatId, beats: () => beat };
}

describe("no stale outlets", () => {
  test("a reply's sections leave the book once its prompt is assembled: a generation the extension isn't there to guard finds none of them", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
    // The prompt is assembled and the reply streams: nothing of it is left in the book.
    expect(await liveEntries(rig, chatId)).toEqual([]);
    // The extension restarts mid-reply (an update): while it is down nothing guards a generation,
    // and the reply's end is never heard. A generation then holds no engine section.
    rig.host.restart();
    rig.host.assembled = [];
    const unguarded = await rig.host.begin(chatId, { type: "impersonate" });
    expect(unguarded.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    expect(rig.host.isOpen(reply)).toBe(false);
  });

  test("a turn waiting for its page holds nothing in the book: with the extension down, another chat's generation gets none of it", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const waiting = await attached(rig, worldId);
    const other = await attached(rig, worldId);
    rig.host.sendUser(waiting, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(waiting, { type: "normal" })).halted).toBe("cancelled");
    expect(await liveEntries(rig, waiting)).toEqual([]);
    rig.host.restart();
    rig.host.assembled = [];
    expect((await rig.host.begin(other, { type: "impersonate" })).halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    // Back up, the waiting reply runs the engine again and holds its own sections.
    const after = new Rig({ host: rig.host });
    const reply = await after.host.start(waiting, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(after.host.section("Scene")).toMatch(/^\[Scene\]\n/);
  });

  test("on a Lumiverse without required guards, an Impersonate whose guard it stopped waiting for goes ahead with none of another chat's sections", async () => {
    // The guard registers with what the host supports, so the host is an older one from the start.
    const host = new FakeHost();
    host.capabilities = { ...host.capabilities, required: false };
    const rig = new Rig({ host });
    const worldId = await rig.newWorld();
    const replying = await attached(rig, worldId);
    const other = await attached(rig, worldId);
    rig.host.sendUser(replying, "I look around.");
    await rig.host.settle();
    const reply = await rig.host.start(replying, { type: "normal" });
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
    // While that reply streams, the other chat's Impersonate: the host gives up on the guard at once.
    rig.host.assembled = [];
    const own = await rig.host.begin(other, { type: "impersonate", abandonContext: true });
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    await rig.host.finish(reply, "The square is quiet.");
  });

  test("a reply's sections the host wouldn't empty: the next Impersonate and dry run stop and the chat says why; once the host writes again they go out with none", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const fill = rig.host.books.fill;
    let failing = true;
    rig.host.books.fill = async (entryId, content, userId) => {
      if (content === null && failing) throw new Error("database is locked");
      return fill(entryId, content, userId);
    };
    const reply = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(reply, "The square is quiet.");
    expect((await liveEntries(rig, chatId)).length).toBeGreaterThan(0);
    rig.host.assembled = [];
    const stopped = await rig.host.begin(chatId, { type: "impersonate" });
    expect(stopped.halted).toBe("cancelled");
    expect(rig.host.assembled).toEqual([]);
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect(flag?.label).toBe("An earlier turn's sections couldn't be cleared, so nothing was generated");
    expect(flag?.detail).toMatch(/^Clearing an earlier turn's sections: database is locked\. .*try again/);
    expect(flag?.actions).toEqual([{ id: "diagnostics", label: "Diagnostics" }]);
    await expect(rig.host.dryRun(chatId)).rejects.toThrow();
    failing = false;
    const own = await rig.host.begin(chatId, { type: "impersonate" });
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    expect(await liveEntries(rig, chatId)).toEqual([]);
  });

  test("another chat's Impersonate while a reply's sections are being written waits for that prompt, then holds none of them; the reply holds its own", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const replying = await attached(rig, worldId);
    const other = await attached(rig, worldId);
    rig.host.sendUser(replying, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(replying, { type: "normal" })).halted).toBe("cancelled");
    const fills = holdFills(rig, (content) => content !== null);
    const idle = rig.host.idle;
    rig.host.idle = async () => undefined;
    rig.host.restarts.length = 0;
    const replyStarting = rig.host.begin(replying, { type: "regenerate" });
    await fills.held;
    const asked = rig.host.contextAsked("impersonate");
    const impersonating = rig.host.begin(other, { type: "impersonate" });
    await asked;
    fills.release();
    const reply = await replyStarting;
    expect(reply.halted).toBeUndefined();
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
    rig.host.assembled = [];
    const own = await impersonating;
    rig.host.idle = idle;
    await rig.host.settle();
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
  });

  test("two chats of one world prepare their replies side by side: each reply holds its own chat's sections and nothing of the other's", async () => {
    const rig = new Rig();
    const worldId = await coinWorld(rig);
    const flipper = await attached(rig, worldId);
    const looker = await attached(rig, worldId);
    rig.body(await rig.send({ type: "lre.action", chatId: flipper, action: "flip_coin", params: {}, source: "palette", now: true }));
    rig.host.sendUser(looker, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(flipper, { type: "normal" })).halted).toBe("cancelled");
    expect((await rig.host.begin(looker, { type: "normal" })).halted).toBe("cancelled");
    rig.host.restarts.length = 0;
    const looked = await rig.host.begin(looker, { type: "regenerate" });
    expect(looked.halted).toBeUndefined();
    expect(rig.host.section("Outcome")).not.toContain("Flip a coin");
    const lookerScene = rig.host.section("Scene");
    expect(lookerScene).toMatch(/^\[Scene\]\n/);
    await rig.host.finish(looked, "The square is quiet.");
    const flipped = await rig.host.begin(flipper, { type: "regenerate" });
    expect(flipped.halted).toBeUndefined();
    expect(rig.host.section("Outcome")).toMatch(/^\[Outcome\]\n(?:.*\n)*- Flip a coin: (success|fail)/);
    expect(rig.host.section("Scene")).not.toBe(lookerScene);
    await rig.host.finish(flipped, "Heads.");
    expect(await liveEntries(rig, flipper)).toEqual([]);
  });

  test("the preset the host generates the chat with, its profile's block states included, decides where each section goes", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // The preset holds {{outlet::lre_scene}}, but this chat's profile binding switches that block off.
    rig.host.presetPlacesOutlets = true;
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}")];
    rig.host.blockStates = { b_Story: false };
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
    // Another preset is the selected one: it places Scene at its outlet, whatever the last reply used.
    rig.host.otherPresets.set("loom", { name: "Loom", revision: 1, blocks: [block("Story", "{{outlet::lre_scene}}")] });
    rig.host.activePreset = "loom";
    rig.host.blockStates = {};
    await rig.turn(chatId, "I wait.", "Quiet.");
    expect(atOutlet(rig, "lre_scene")).toMatch(/^\[Scene\]\n/);
    expect(rig.host.assembled.filter((e) => e.content.startsWith("[Scene]"))).toHaveLength(1);
  });

  test("a preset change after the engine ran that nobody reported: the reply's guard sees it, the engine runs again and the reply is placed by the preset it is assembled with", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    rig.host.presetPlacesOutlets = true;
    rig.host.restarts.length = 0;
    rig.host.otherPresets.set("loom", { name: "Loom", revision: 1, blocks: [block("Story", "{{outlet::lre_scene}}")] });
    rig.host.activePreset = "loom";
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(atOutlet(rig, "lre_scene")).toMatch(/^\[Scene\]\n/);
  });

  test("only the generation's own preset counts: another preset saved, the same one saved with nothing the sections use changed, or old pages still reporting presets drop nothing", async () => {
    const rig = new Rig();
    rig.host.presetPlacesOutlets = true;
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}"), block("Style", "Write tersely.")];
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    const calls = rig.host.quietCalls.length;
    // Workshop saves another preset; the chat's own preset is saved with a new style line; three pages report three presets.
    rig.host.otherPresets.set("workshop", { name: "Workshop", revision: 2, blocks: [] });
    rig.host.presetRevision++;
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}"), block("Style", "Write tersely, in past tense.")];
    rig.host.emitPresetChanged("workshop");
    rig.host.emitPresetChanged("preset-1");
    for (const [page, presetId] of [["desk", "preset-1"], ["phone", "workshop"], ["tablet", null]] as const) rig.body(await rig.send({ type: "lre.hello", chatId, presetId }, page));
    // A page from before the backend stopped reading reports still sends one with its preset change: it reads as a card request.
    expect(rig.body(await rig.send({ type: "lre.preset", op: "active", presetId: "workshop" }, "phone")).card).toMatchObject({ preset: { name: expect.any(String) } });
    await rig.host.settle();
    rig.host.restarts.length = 0;
    const reply = await rig.host.begin(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(rig.host.quietCalls.length).toBe(calls);
    expect(atOutlet(rig, "lre_scene")).toMatch(/^\[Scene\]\n/);
    // A save that moves the outlet off this preset makes the engine run again, and places Scene by it.
    await rig.host.finish(reply, "Quiet.");
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    rig.host.presetRevision++;
    rig.host.presetBlocks = [block("Style", "Write tersely, in past tense.")];
    rig.host.restarts.length = 0;
    const again = await rig.host.start(chatId, { type: "regenerate" });
    expect(again.halted).toBeUndefined();
    expect(atOutlet(rig, "lre_scene")).toBe("");
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
  });

  test("when Lumiverse can't say which preset the chat generates with, the engine run stops and the chat says why", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.presetUnknown = "presets.getActive failed";
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect(rig.host.assembled).toEqual([]);
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect(flag?.label).toBe("The engine didn't finish, so nothing was generated");
    expect(flag?.detail).toContain("presets.getActive failed");
  });

  test("an Outcome note reworded after the engine prepared the reply: the reply holds the note as it now reads", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 99999 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings up the lamp.");
    rig.host.quietReply = () => "{}";
    const decline = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "decline");
    expect(decline).toBeDefined();
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(rig.host.restarts).toMatchObject([{ chatId, as: "send" }]);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: decline?.id, choice: "remove" })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    const outcome = rig.host.section("Outcome");
    expect(outcome).toContain("lamp was narrated but never happened; leave it out from here on.");
    expect(outcome).not.toContain("was declined");
  });

  test("same-roll Re-runs: a Re-run whose outline step is switched off holds no outline line an earlier run wrote", async () => {
    const rig = new Rig();
    const { chatId } = await outlinedCoins(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { outline: { enabled: false }, brief: { enabled: false } } } } }));
    const again = await rig.host.start(chatId, { type: "regenerate" });
    expect(again.halted).toBeUndefined();
    expect(rig.host.section("Outcome")).toMatch(/Flip a coin/);
    expect(rig.host.section("Outline")).not.toContain("Beat 1");
  });

  test("same-roll Re-runs: a Re-narrate tells its source swipe's outline, never one from a Re-run dropped before its reply", async () => {
    const rig = new Rig();
    const { chatId, beats } = await outlinedCoins(rig);
    expect((await rig.host.begin(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(beats()).toBe(2);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 3900 } } } }));
    rig.host.restarts.length = 0;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "renarrate" } }));
    const retold = await rig.host.start(chatId, { type: "swipe" });
    expect(retold.halted).toBeUndefined();
    expect(rig.host.section("Outline")).toContain("Beat 1: the coin spins.");
    expect(rig.host.section("Outline")).not.toContain("Beat 2");
  });
});
