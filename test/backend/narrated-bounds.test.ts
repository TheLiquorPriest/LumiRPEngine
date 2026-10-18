// Narrated-change channels and their bounds (DESIGN §9.4): a time skip under `confirm` waits on a
// confirm chip and applies whole on Apply; a reply's regard moves each axis of a pair by at most 10
// in all, the later proposals cut down or refused in order.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { regardBudget } from "../../src/backend/runtime";
import { regardAxes } from "../../src/packs/relationships/core/index";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";

/** A fresh Port Alder chat whose next reply the extractor reads as `proposals`, with `extraction` settings applied first. */
async function chat(proposals: JsonObject[], extraction: JsonObject) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
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
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await rig.turn(chatId, "I sit with Danny.", "An hour later, Danny trusts you a good deal more.");
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return { rig, chatId, state, danny, chips };
}

describe("a narrated time skip under confirm", () => {
  test("waits on a confirm chip, then applies whole on Apply", async () => {
    const got = await chat([{ type: "time_advance", minutes: 45 }], { time_advance: { mode: "confirm" } });
    const confirm = got.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    expect(confirm.actions.map((a) => a.id)).toEqual(["confirm", "reject"]);
    const read = (await got.state()).clock;
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: confirm.id, choice: "confirm" }));
    expect((await got.state()).clock - read).toBe(45);
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
