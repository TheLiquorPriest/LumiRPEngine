// No stale outlets (DESIGN §5.1, §6.4, §6.8): every engine section a prompt holds comes from the
// engine run that prepared the generation being assembled. The world's book holds one owner's
// sections at a time; a generation with no turn of its own (Impersonate, a dry run) is assembled
// from an empty book; and sections that can't be emptied stop the generation, with a flag that
// says why, rather than going out stale.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { AssembledEntry } from "../support/fake-host";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const EXTRACT_MARK = "propose concrete state changes";
const OUTLINE_MARK = "You outline a roleplay narrator's next reply";

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

/**
 * Holds the host's entry writes that `match` picks until `release`, as a host under load is slow
 * to make them; `once` holds only the first. `held` resolves when the first is held.
 */
function holdFills(rig: Rig, match: (content: string | null) => boolean, once = false): { release: () => void; held: Promise<void> } {
  const fill = rig.host.books.fill;
  const gate = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  let holding = 0;
  rig.host.books.fill = async (entryId, content, userId) => {
    if (match(content) && !(once && holding > 0)) {
      holding++;
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
  rig.body(await rig.send({ type: "lre.action", chatId, action: "flip_coin", params: {}, source: "palette" }));
  const first = await rig.host.start(chatId, { type: "normal" });
  expect(rig.host.section("Outline")).toContain("Beat 1: the coin spins.");
  await rig.host.finish(first, "Heads.");
  return { chatId, beats: () => beat };
}

describe("no stale outlets", () => {
  test("a restart while a reply streams leaves its sections in the book; the next dry run and Impersonate get none of them", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBeUndefined();
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
    // The server restarts mid-reply: nothing hears the reply end, so nothing empties its entries.
    const after = rig.restart();
    expect((await liveEntries(after, chatId)).length).toBeGreaterThan(0);
    const dry = await after.host.dryRun(chatId);
    expect(dry.messages.filter((m) => m.role === "system" && /^\[[A-Z][a-z]+\]\n/.test(m.content))).toEqual([]);
    after.host.assembled = [];
    const own = await after.host.begin(chatId, { type: "impersonate" });
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(after.host.assembled)).toEqual([]);
    await after.host.finish(own, "I stretch.");
    expect(await liveEntries(after, chatId)).toEqual([]);
  });

  test("an Impersonate pressed as the reply ends waits for the reply's sections to be emptied, and its prompt holds none", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
    // The host is slow to empty the entries, and the player presses Impersonate the moment the reply ends.
    const clears = holdFills(rig, (content) => content === null);
    const idle = rig.host.idle;
    rig.host.idle = async () => undefined;
    await rig.host.finish(reply, "The square is quiet.");
    rig.host.assembled = [];
    const impersonating = rig.host.begin(chatId, { type: "impersonate" });
    await clears.held;
    clears.release();
    rig.host.idle = idle;
    const own = await impersonating;
    await rig.host.settle();
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    await rig.host.finish(own, "I stretch.");
    expect(await liveEntries(rig, chatId)).toEqual([]);
  });

  test("an Impersonate pressed while the engine writes the reply's sections gets none of them, and that reply runs the engine again", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    // The host is slow with one of the run's writes; the others land.
    const fills = holdFills(rig, (content) => content !== null, true);
    const idle = rig.host.idle;
    rig.host.idle = async () => undefined;
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    await fills.held;
    rig.host.assembled = [];
    const asked = rig.host.contextAsked("impersonate");
    const impersonating = rig.host.begin(chatId, { type: "impersonate" });
    await asked;
    fills.release();
    rig.host.idle = idle;
    const own = await impersonating;
    await rig.host.settle();
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    await rig.host.finish(own, "I stretch.");
    // The turn the run prepared gave way: its reply is stopped, runs the engine again and holds its sections.
    rig.host.restarts.length = 0;
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
  });

  test("a reply whose sections the host wouldn't empty: the next Impersonate and dry run stop and the chat says why; once the host writes again they go out with none", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    const fill = rig.host.books.fill;
    let failing = true;
    rig.host.books.fill = async (entryId, content, userId) => {
      if (content === null && failing) throw new Error("database is locked");
      return fill(entryId, content, userId);
    };
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
    // The host writes again: the next Impersonate empties them and goes out with no section.
    failing = false;
    const own = await rig.host.begin(chatId, { type: "impersonate" });
    expect(own.halted).toBeUndefined();
    expect(sectionsIn(rig.host.assembled)).toEqual([]);
    expect(await liveEntries(rig, chatId)).toEqual([]);
  });

  test("two chats of one world: a turn the other chat runs while this one's is being written never mixes into either reply", async () => {
    const rig = new Rig();
    const worldId = await coinWorld(rig);
    const flipper = await attached(rig, worldId);
    const looker = await attached(rig, worldId);
    // The first chat flips a coin (an Outcome, and a minute passes); the other only looks around.
    rig.body(await rig.send({ type: "lre.action", chatId: flipper, action: "flip_coin", params: {}, source: "palette" }));
    rig.host.sendUser(looker, "I look around.");
    await rig.host.settle();
    const fills = holdFills(rig, (content) => content !== null, true);
    const idle = rig.host.idle;
    rig.host.idle = async () => undefined;
    expect((await rig.host.begin(flipper, { type: "normal" })).halted).toBe("cancelled");
    await fills.held;
    // The other chat's engine run reaches the book: it either waits for this one or writes over it.
    const reached = Promise.race([rig.host.sentWhere((m) => m.type === "lre.generate" && m.chatId === looker), rig.host.sentWhere((m) => m.type === "lre.activity" && m.chatId === looker && m.activity?.label === "Waiting for another chat of this world…")]);
    expect((await rig.host.begin(looker, { type: "normal" })).halted).toBe("cancelled");
    await reached;
    fills.release();
    rig.host.idle = idle;
    await rig.host.settle();
    // Each reply, whichever starts first, holds its own chat's sections and nothing of the other's.
    const looked = await rig.host.start(looker, { type: "regenerate" });
    expect(looked.halted).toBeUndefined();
    expect(rig.host.section("Outcome")).not.toContain("Flip a coin");
    const lookerScene = rig.host.section("Scene");
    expect(lookerScene).toMatch(/^\[Scene\]\n/);
    await rig.host.finish(looked, "The square is quiet.");
    // Any ask its page still holds for a turn that gave way is refused; the reply runs the engine again.
    rig.host.restarts.length = 0;
    const flipped = await rig.host.start(flipper, { type: "regenerate" });
    expect(flipped.halted).toBeUndefined();
    expect(rig.host.section("Outcome")).toMatch(/^\[Outcome\]\n- Flip a coin: (success|fail)/);
    expect(rig.host.section("Scene")).not.toBe(lookerScene);
    await rig.host.finish(flipped, "Heads.");
    expect(await liveEntries(rig, flipper)).toEqual([]);
  });

  test("an Outcome note reworded after the engine prepared the reply: the reply holds the note as it now reads", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 99999 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings up the lamp.");
    rig.host.quietReply = () => "{}";
    const decline = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "decline");
    expect(decline).toBeDefined();
    // The player presses Send with nothing typed (a new reply after the reply); the engine prepares it
    // with the note as it reads now, and the chat says to press Send.
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(rig.host.restarts).toMatchObject([{ chatId, as: "send" }]);
    // Before they do, they choose Remove it on the decline: the note is reworded.
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
    // The outline and brief steps are switched off; a Re-run of the same turn rolls the same and writes no outline of its own.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { outline: { enabled: false }, brief: { enabled: false } } } } }));
    const again = await rig.host.start(chatId, { type: "regenerate" });
    expect(again.halted).toBeUndefined();
    expect(rig.host.section("Outcome")).toMatch(/Flip a coin/);
    expect(rig.host.section("Outline")).not.toContain("Beat 1");
  });

  test("same-roll Re-runs: a Re-narrate tells its source swipe's outline, never one from a Re-run dropped before its reply", async () => {
    const rig = new Rig();
    const { chatId, beats } = await outlinedCoins(rig);
    // A Re-run is prepared (its outline is Beat 2), then dropped before its reply: a setting changed.
    expect((await rig.host.begin(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(beats()).toBe(2);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 3900 } } } }));
    rig.host.restarts.length = 0;
    // The player swipes as Re-narrate: its source is the first reply, whose outline was Beat 1.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "renarrate" } }));
    const retold = await rig.host.start(chatId, { type: "swipe" });
    expect(retold.halted).toBeUndefined();
    expect(rig.host.section("Outline")).toContain("Beat 1: the coin spins.");
    expect(rig.host.section("Outline")).not.toContain("Beat 2");
  });
});
