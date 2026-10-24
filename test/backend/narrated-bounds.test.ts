// Narrated-change channels and their bounds (DESIGN §9.4): a time skip under `confirm` waits on a
// confirm chip and applies whole on Apply, as auto applies it, paused clock or not; none applies
// during a fight; a reply's regard moves each axis of a pair by at most 10 in all, the later
// proposals cut down or refused in order.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { regardBudget } from "../../src/backend/runtime";
import { regardAxes } from "../../src/packs/relationships/core/index";
import type { JsonObject } from "../../src/shared/json";
import { expectMatch } from "../support/match";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";

/**
 * A fresh Port Alder chat whose next reply the extractor reads as `proposals`, with `extraction`
 * settings applied first. With `fights` the world has the Modern profile's combat; `world` edits
 * and commits the world before the chat attaches; `ready` runs after a first turn, before that
 * reply's turn, and `before` is the clock then; `play` plays that turn in place of a typed
 * "I sit with Danny."
 */
async function chat(
  proposals: JsonObject[],
  extraction: JsonObject,
  opts: { fights?: boolean; world?: (rig: Rig, worldId: string) => Promise<void>; ready?: (rig: Rig, chatId: string) => Promise<void>; play?: (rig: Rig, chatId: string) => Promise<void> } = {},
) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  if (opts.fights) {
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "modern", choices: {} }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  await opts.world?.(rig, worldId);
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction } }));
  const state = async () => {
    const s = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    if (!s) throw new Error("no state");
    return s;
  };
  /** The sum of Danny's regard axes toward the player now, as the relationships pack reads them (decayed to the clock). */
  const danny = async () => {
    const s = await state();
    const world = (await rig.rt.ledger.core(chatId, rig.host.userId))?.worldAt(s.revision);
    if (!world) throw new Error("no world");
    return Object.values(regardAxes(rig.rt.registry.context(world, s), "danny_okafor", "pov")).reduce((a, b) => a + b, 0);
  };
  // A first turn reads nothing, so the clock and regard start from a played turn.
  rig.host.quietReply = () => "{}";
  await rig.turn(chatId, "I look around.", "The shop is quiet.");
  await opts.ready?.(rig, chatId);
  const before = (await state()).clock;
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await (opts.play ? opts.play(rig, chatId) : rig.turn(chatId, "I sit with Danny.", "An hour later, Danny trusts you a good deal more."));
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return { rig, chatId, state, danny, chips, before };
}

/** Pauses the chat's clock, as the HUD's Pause clock does. */
async function pause(rig: Rig, chatId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "pause", scope: { all: true }, to: true }));
}

/** Starts a fight with Danny from the palette; the POV is made too tough for one round of his blows to put down. */
async function fight(rig: Rig, chatId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "pov", field: "con", value: 30 }] }));
  rig.body(await rig.send({ type: "lre.action", chatId, action: "fight", params: { target: "danny_okafor" }, source: "palette", now: true }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "Danny squares up to you.");
}

/** Plays a 30-minute timelapse from the palette, whose reply tells of more time passing. */
async function timelapse(rig: Rig, chatId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 30 } }, source: "palette", now: true }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "The yards work for another quarter of an hour.");
}

describe("a narrated time skip under confirm", () => {
  test("waits on a confirm chip, then applies whole on Apply", async () => {
    const got = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "confirm" } });
    const confirm = got.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    expect(confirm.actions.map((a) => a.id)).toEqual(["confirm", "reject"]);
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: confirm.id, choice: "confirm" }));
    // The reply's skip is the turn's whole: its tick and the skip together come to it.
    expect((await got.state()).clock - got.before).toBe(45);
    expect(got.rig.rt.ledger.errors).toEqual([]);
    const learning = await got.rig.rt.settings.learningOf(got.rig.host.userId);
    expect(learning.connections.active?.time_advance?.accepted).toBe(1);
  });

  test("No leaves the clock alone", async () => {
    const got = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "confirm" } });
    const confirm = got.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    const read = (await got.state()).clock;
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: confirm.id, choice: "reject" }));
    expect((await got.state()).clock).toBe(read);
  });

  test("a skip past the cap is offered as a Timelapse, not applied", async () => {
    const got = await chat([{ type: "time_advance", minutes: 600 }], { time_advance: { mode: "confirm" } });
    expect(got.chips.some((c) => c.kind === "confirm")).toBe(false);
    const offer = got.chips.find((c) => c.kind === "timelapse_offer" && c.label.includes("skipped ahead"));
    expect(offer).toBeDefined();
    expect(offer?.actions.map((a) => a.id)).toEqual(["timelapse"]);
  });
});

describe("a narrated time skip, auto or confirm", () => {
  test("with the clock paused, Apply does what auto does: the skip applies whole", async () => {
    const auto = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "auto" } }, { ready: pause });
    expect((await auto.state()).clock - auto.before).toBe(45);
    const asked = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "confirm" } }, { ready: pause });
    const confirm = asked.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    expect((await asked.state()).clock).toBe(asked.before);
    asked.rig.body(await asked.rig.send({ type: "lre.chip", chatId: asked.chatId, chip: confirm.id, choice: "confirm" }));
    expect((await asked.state()).clock - asked.before).toBe(45);
    for (const got of [auto, asked]) expect(got.rig.rt.ledger.errors).toEqual([]);
  });

  test("a timelapse turn's reply proposes none: the clock ends where the timelapse took it (L27)", async () => {
    const got = await chat([{ type: "time_advance", minutes: 15 }], { time_advance: { mode: "auto" } }, { play: timelapse });
    expect((await got.state()).clock - got.before).toBe(30);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });

  test("nor does a world's effects step on that turn, nor a Re-read of the reply edited later", async () => {
    // The effects step's prompt carries the extractor's mark, so the fake answers it with the skip too.
    const effects = async (rig: Rig, worldId: string) => {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "steps", id: "fx", value: { id: "fx", purpose: "extract", template: `Note the time that passed, and ${EXTRACT_MARK}.`, output: "effects", signals: ["always"] } }));
      rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    };
    const got = await chat([{ type: "time_advance", minutes: 15 }], { time_advance: { mode: "auto" } }, { world: effects, play: timelapse });
    expect(got.rig.host.quietCalls.some((r) => r.messages[0]?.content.startsWith("Note the time that passed"))).toBe(true);
    expect((await got.state()).clock - got.before).toBe(30);
    // A Re-read has no pre phase: it still knows the turn was a timelapse.
    const head = got.rig.host.head(got.chatId);
    if (!head) throw new Error("no reply");
    got.rig.host.editMessage(got.chatId, head.id, `${head.swipes[0] ?? ""} Another hour slips by.`);
    await got.rig.host.settle();
    const reread = (await got.rig.rt.view(got.chatId, got.rig.host.userId)).chips.find((c) => c.kind === "reread");
    if (!reread) throw new Error("no reread chip");
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: reread.id, choice: "reread" }));
    expect((await got.state()).clock - got.before).toBe(30);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });

  test("during a fight none applies, in either mode: it is declined with a note, and Apply on an earlier chip is refused", async () => {
    for (const mode of ["auto", "confirm"]) {
      const got = await chat([{ type: "time_advance", minutes: 20 }], { time_advance: { mode } }, { fights: true, ready: fight });
      expect((await got.state()).clock).toBe(got.before);
      expect(got.chips.filter((c) => c.kind === "confirm" || c.kind === "timelapse_offer")).toEqual([]);
      expectMatch(got.chips.find((c) => c.kind === "decline"), { label: "Didn't apply: +20 min", detail: expect.stringContaining("a fight is under way") });
      expect(got.rig.rt.ledger.errors).toEqual([]);
    }
    // A chip offered before the fight: Apply is refused, and the clock stays.
    const got = await chat([], { time_advance: { mode: "confirm" } }, { fights: true, ready: fight });
    const head = got.rig.host.head(got.chatId);
    if (!head) throw new Error("no reply");
    const proposal = { type: "time_advance", minutes: 45 };
    await got.rig.rt.chips.add(got.chatId, got.rig.host.userId, [{ id: "confirm:earlier", kind: "confirm", messageId: head.id, swipeId: head.swipeId, label: "+45 min", actions: [{ id: "confirm", label: "Apply" }], expires: "next_send", payload: { type: "time_advance", connection: "active", proposal } }]);
    const reply = await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: "confirm:earlier", choice: "confirm" });
    expectMatch(reply, { type: "lre.error", message: expect.stringContaining("a fight is under way") });
    expect((await got.state()).clock).toBe(got.before);
  });
});

describe("a reply's regard budget", () => {
  test("auto: in order, the later proposals for a pair are cut down, then refused with a decline chip", async () => {
    const proposals = [8, 6, 3].map((delta) => ({ type: "regard", from: "danny_okafor", to: "pov", axis: "trust", delta }));
    const none = await chat([], { regard: { mode: "auto" } });
    const got = await chat(proposals, { regard: { mode: "auto" } });
    const moved = (await got.danny()) - (await none.danny());
    // Each axis is stored to a tenth, so a change spread over the axes rounds a little.
    expect(moved).toBeGreaterThan(9.5);
    expect(moved).toBeLessThanOrEqual(10.5);
    expect(got.chips.filter((c) => c.kind === "undo").map((c) => c.label)).toEqual(["Danny Okafor → you: trust +8", "Danny Okafor → you: trust +2"]);
    expect(got.chips.filter((c) => c.kind === "decline").map((c) => c.label)).toEqual(["Didn't apply: Danny Okafor → you: trust +3"]);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });

  test("confirm: the chips together never move the pair past the cap", async () => {
    const proposals = [8, 6, 3].map((delta) => ({ type: "regard", from: "danny_okafor", to: "pov", axis: "trust", delta }));
    const none = await chat([], { regard: { mode: "confirm" } });
    const got = await chat(proposals, { regard: { mode: "confirm" } });
    const confirms = got.chips.filter((c) => c.kind === "confirm");
    expect(confirms).toHaveLength(2);
    for (const c of confirms) got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: c.id, choice: "confirm" }));
    const moved = (await got.danny()) - (await none.danny());
    expect(moved).toBeGreaterThan(9.5);
    expect(moved).toBeLessThanOrEqual(10.5);
  });

  test("the budget is net per pair and axis; an axis-less change counts against every axis", () => {
    const fit = regardBudget();
    const r = (from: string, to: string, delta: number, axis?: string): JsonObject => ({ type: "regard", from, to, delta, ...(axis ? { axis } : {}) });
    expect(fit(r("a", "b", 7, "trust"))?.delta).toBe(7);
    // Another axis of the same pair, and the other direction, have their own room.
    expect(fit(r("a", "b", 10, "warmth"))?.delta).toBe(10);
    expect(fit(r("b", "a", 10, "trust"))?.delta).toBe(10);
    // Every axis moves with an axis-less change: warmth has nothing left.
    expect(fit(r("a", "b", 2))).toBeNull();
    // Moving back is room again, net.
    expect(fit(r("a", "b", -4, "warmth"))?.delta).toBe(-4);
    expect(fit(r("a", "b", 5))?.delta).toBe(3);
    expect(fit(r("a", "b", 1, "trust"))).toBeNull();
    // A single proposal never moves more than the cap, nor does a fall.
    expect(regardBudget()(r("a", "b", 25, "trust"))?.delta).toBe(10);
    expect(regardBudget()(r("a", "b", -25, "trust"))?.delta).toBe(-10);
    // Anything else passes as it is.
    const move = { type: "location", entity: "a", place: "x" };
    expect(fit(move)).toBe(move);
  });
});
