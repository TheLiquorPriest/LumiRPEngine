// Narrated-change channels and their bounds (DESIGN §9.4, §11): a time skip under `confirm` waits on
// a confirm chip and applies whole on Apply, as auto applies it, paused clock or not, and a fight
// holds none of it back; a reply's regard moves as far as the story tells, each axis inside its range.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { regardAxes } from "../../src/packs/relationships/core/index";
import type { JsonObject } from "../../src/shared/json";
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
  /** Danny's regard axes toward the player now, as the relationships pack reads them (decayed). */
  const axes = async () => {
    const s = await state();
    const world = (await rig.rt.ledger.core(chatId, rig.host.userId))?.worldAt(s.revision);
    if (!world) throw new Error("no world");
    return regardAxes(rig.rt.registry.context(world, s), "danny_okafor", "pov");
  };
  // A first turn reads nothing, so the clock and regard start from a played turn.
  rig.host.quietReply = () => "{}";
  await rig.turn(chatId, "I look around.", "The shop is quiet.");
  await opts.ready?.(rig, chatId);
  const before = (await state()).clock;
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await (opts.play ? opts.play(rig, chatId) : rig.turn(chatId, "I sit with Danny.", "An hour later, Danny trusts you a good deal more."));
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
  return { rig, chatId, state, axes, chips, before };
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
  await rig.host.finish(g, "The shop works on for another quarter of an hour.");
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

  test("a skip past how long one runs without asking is offered as a Timelapse, not applied", async () => {
    // A day and an hour: past the default of a day.
    const got = await chat([{ type: "time_advance", minutes: 1500 }], { time_advance: { mode: "confirm" } });
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

  test("during a fight it applies all the same, in either mode, and Apply on an earlier chip applies it too", async () => {
    const auto = await chat([{ type: "time_advance", minutes: 20 }], { time_advance: { mode: "auto" } }, { fights: true, ready: fight });
    expect((await auto.state()).clock - auto.before).toBe(20);
    const asked = await chat([{ type: "time_advance", minutes: 20 }], { time_advance: { mode: "confirm" } }, { fights: true, ready: fight });
    const confirm = asked.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    asked.rig.body(await asked.rig.send({ type: "lre.chip", chatId: asked.chatId, chip: confirm.id, choice: "confirm" }));
    expect((await asked.state()).clock - asked.before).toBe(20);
    for (const got of [auto, asked]) {
      expect(got.chips.filter((c) => c.kind === "decline")).toEqual([]);
      expect(got.rig.rt.ledger.errors).toEqual([]);
    }
    // A chip offered before the fight: Apply moves the clock.
    const got = await chat([], { time_advance: { mode: "confirm" } }, { fights: true, ready: fight });
    const head = got.rig.host.head(got.chatId);
    if (!head) throw new Error("no reply");
    const proposal = { type: "time_advance", minutes: 45 };
    await got.rig.rt.chips.add(got.chatId, got.rig.host.userId, [{ id: "confirm:earlier", kind: "confirm", messageId: head.id, swipeId: head.swipeId, label: "+45 min", actions: [{ id: "confirm", label: "Apply" }], expires: "next_send", payload: { type: "time_advance", connection: "active", proposal } }]);
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: "confirm:earlier", choice: "confirm" }));
    expect((await got.state()).clock - got.before).toBe(45);
  });

  test("a skip farther than a timelapse reaches is offered as a Timelapse, never dropped", async () => {
    // Two years later: past the 366 days one timelapse reaches. The turn keeps only its own tick, as a
    // turn whose reply skips nothing does.
    const none = await chat([], { time_advance: { mode: "auto" } });
    const got = await chat([{ type: "time_advance", minutes: 2 * 365 * 24 * 60 }], { time_advance: { mode: "auto" } });
    expect((await got.state()).clock - got.before).toBe((await none.state()).clock - none.before);
    const offer = got.chips.find((c) => c.kind === "timelapse_offer" && c.label.includes("skipped ahead"));
    if (!offer) throw new Error("no Timelapse chip");
    expect(offer.actions.map((a) => a.id)).toEqual(["timelapse"]);
  });
});

describe("a narrated time skip a Re-read reads", () => {
  /** The reply's offers to run what it skipped as a Timelapse. */
  const offers = async (rig: Rig, chatId: string, messageId: string) => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "timelapse_offer" && c.label.includes("skipped ahead") && c.messageId === messageId);
  /** The extractor reads the next reply as `proposals`. */
  const reads = (rig: Rig, proposals: JsonObject[]) => {
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  };
  /** Edits the reply to `text`; its Re-read chip. */
  const edit = async (rig: Rig, chatId: string, messageId: string, text: string) => {
    rig.host.editMessage(chatId, messageId, text);
    await rig.host.settle();
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
    if (!chip) throw new Error("no reread chip");
    return chip.id;
  };
  // Two days later: past the default of a day.
  const twoDays = [{ type: "time_advance", minutes: 2 * 24 * 60 }];

  test("past how long a skip runs without asking, is offered as a Timelapse, in place of what its earlier read offered", async () => {
    const got = await chat([], { time_advance: { mode: "auto" } });
    const head = got.rig.host.head(got.chatId);
    if (!head) throw new Error("no reply");
    expect(await offers(got.rig, got.chatId, head.id)).toEqual([]);
    const told = await edit(got.rig, got.chatId, head.id, "Two days later, Danny calls.");
    reads(got.rig, twoDays);
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: told, choice: "reread" }));
    expect((await offers(got.rig, got.chatId, head.id)).map((c) => c.actions.map((a) => a.id))).toEqual([["timelapse"]]);
    // Edited again to skip nothing: the offer goes with the read that made it.
    const untold = await edit(got.rig, got.chatId, head.id, "Danny calls.");
    reads(got.rig, []);
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: untold, choice: "reread" }));
    expect(await offers(got.rig, got.chatId, head.id)).toEqual([]);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });

  test("held behind the next reply in flight, is offered once that reply lands the read", async () => {
    const got = await chat([], { time_advance: { mode: "auto" } });
    const head = got.rig.host.head(got.chatId);
    if (!head) throw new Error("no reply");
    const told = await edit(got.rig, got.chatId, head.id, "Two days later, Danny calls.");
    got.rig.host.sendUser(got.chatId, "I pick up.");
    await got.rig.host.settle();
    const g = await got.rig.host.start(got.chatId, { type: "normal" });
    reads(got.rig, twoDays);
    expect(got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: told, choice: "reread" }))).toEqual({ applied: false, pending: true });
    expect(await offers(got.rig, got.chatId, head.id)).toEqual([]);
    reads(got.rig, []);
    await got.rig.host.finish(g, "Danny asks how you've been.");
    expect((await offers(got.rig, got.chatId, head.id)).map((c) => c.actions.map((a) => a.id))).toEqual([["timelapse"]]);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a reply's regard", () => {
  test("auto: each change applies as far as the story tells", async () => {
    const proposals = [8, 6, 3].map((delta) => ({ type: "regard", from: "danny_okafor", to: "pov", axis: "trust", delta }));
    const none = await chat([], { regard: { mode: "auto" } });
    const got = await chat(proposals, { regard: { mode: "auto" } });
    expect((await got.axes()).trust - (await none.axes()).trust).toBeCloseTo(17, 9);
    expect(got.chips.filter((c) => c.kind === "undo").map((c) => c.label)).toEqual(["Danny Okafor's trust toward you rose by 8", "Danny Okafor's trust toward you rose by 6", "Danny Okafor's trust toward you rose by 3"]);
    expect(got.chips.filter((c) => c.kind === "decline" || c.kind === "untracked")).toEqual([]);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });

  test("confirm: each chip applies whole", async () => {
    const proposals = [8, 6, 3].map((delta) => ({ type: "regard", from: "danny_okafor", to: "pov", axis: "trust", delta }));
    const none = await chat([], { regard: { mode: "confirm" } });
    const got = await chat(proposals, { regard: { mode: "confirm" } });
    const confirms = got.chips.filter((c) => c.kind === "confirm");
    expect(confirms).toHaveLength(3);
    for (const c of confirms) got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: c.id, choice: "confirm" }));
    expect((await got.axes()).trust - (await none.axes()).trust).toBeCloseTo(17, 9);
  });

  test("an axis stays inside its range however far the story moves it", async () => {
    const got = await chat([{ type: "regard", from: "danny_okafor", to: "pov", axis: "trust", delta: 500 }], { regard: { mode: "auto" } });
    expect((await got.axes()).trust).toBe(100);
  });
});
