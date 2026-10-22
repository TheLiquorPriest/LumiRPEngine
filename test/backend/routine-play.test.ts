// Routines in play, through the whole backend (DESIGN §8, §24.7, §24.9): a span the player spends
// doing something keeps the POV where the story has it; a typed time skip runs through with no
// invitation nothing grounds; and the GM's routine controls go through `lre.edit`, read back through
// `lre.routine` and come off with the Undo chip, in Port Alder.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { calendarOf, clockOfStamp } from "../../src/engine/calendar";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";

/** What `interpret` reads each typed message as: a move, a typed time skip, or nothing. */
const READS: Record<string, JsonObject> = {
  "I look around the shop.": { action: null, params: {}, confidence: 0.9, reason: "no action" },
  "I walk down to the marina to look the boats over.": { action: "go", params: { to: "alder_harbor_marina" }, confidence: 0.9 },
  "OOC: for the next two hours, I service the township fleet.": { action: "timelapse", params: { span: "for the next two hours" }, confidence: 0.9 },
  "OOC: over the next hour, I tidy up the workshop.": { action: "timelapse", params: { span: "over the next hour" }, confidence: 0.9 },
};

/** A Port Alder chat after one ordinary turn on its first Monday morning. */
async function alder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = (req: QuietRequest) => {
    if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
    return JSON.stringify(READS[req.messages[1]?.content ?? ""] ?? READS["I look around the shop."]);
  };
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  return { rig, chatId };
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("not a world chat");
  const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const state = core.fold(observed).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  const head = core.chain(observed).at(-1);
  return { state, world, events: head?.ledger?.swipes[String(head.swipeId)]?.events ?? [] };
}

/** Time runs on its own from the palette to `stamp` (Monday's), again after anything that stops it. */
async function lapseTo(rig: Rig, chatId: string, stamp: string): Promise<void> {
  for (let tries = 0; tries < 8; tries++) {
    const { state, world } = await folded(rig, chatId);
    const at = clockOfStamp(calendarOf(world), stamp);
    if (at === null) throw new Error(`not a stamp: ${stamp}`);
    if (state.clock >= at) return;
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "at", at } }, source: "palette", now: true }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Time passes.");
  }
  throw new Error(`never reached ${stamp}`);
}

const timelapseOf = (events: readonly LedgerEvent[]): LedgerEvent | undefined => events.find((e) => e.type === "timelapse");

describe("a time skip the player types", () => {
  test("a span the player spends doing something keeps them where the story put them: the fleet, not home", async () => {
    const { rig, chatId } = await alder();
    // The POV's routine has it at the garage until half past three, then home.
    await lapseTo(rig, chatId, "2026-09-14 14:30");
    await rig.turn(chatId, "I walk down to the marina to look the boats over.", "The township boats knock at their moorings.");
    const there = await folded(rig, chatId);
    expect(placeOfEntity(there.state, there.world.pov)).toBe("alder_harbor_marina");
    await rig.turn(chatId, "OOC: for the next two hours, I service the township fleet.", "Two hours of salt and grease go by.");
    const after = await folded(rig, chatId);
    expect(timelapseOf(after.events)).toMatchObject({ from: there.state.clock, to: there.state.clock + 120, stoppedBy: null });
    expect(placeOfEntity(after.state, after.world.pov)).toBe("alder_harbor_marina");
    // Nothing in the span moved the POV.
    expect(after.events.some((e) => "entity" in e && e.entity === after.world.pov && e.type === "set" && e.field === "place")).toBe(false);
  });

  test("an hour typed out of character runs through, with no invitation nothing in the world grounds", async () => {
    const { rig, chatId } = await alder();
    await lapseTo(rig, chatId, "2026-09-14 17:00");
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "OOC: over the next hour, I tidy up the workshop.", "The hour goes in sweeping and sorting.");
    const after = await folded(rig, chatId);
    expect(timelapseOf(after.events)).toMatchObject({ from: before.state.clock, to: before.state.clock + 60, stoppedBy: null });
    expect(after.state.clock).toBe(before.state.clock + 60);
    expect(after.events.filter((e) => e.type === "castlife.invitation")).toEqual([]);
  });
});

describe("the GM's routine controls in play", () => {
  test("a change goes in through lre.edit, reads back through lre.routine, and the Undo chip takes it off", async () => {
    const { rig, chatId } = await alder();
    const fleet: JsonObject = { id: "fleet", label: "Works on the township boats", activity: "work", kind: "fixed", at: "16:00", minutes: 90, place: { place: "alder_harbor_marina" } };
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "routine_block", entity: "danny_okafor", block: "fleet", value: fleet }, { op: "routine_follow", entity: "danny_okafor", mode: "no_invitations" }] }));
    const changed = rig.body(await rig.send({ type: "lre.routine", chatId, op: "changed" })).changed;
    expect(changed).toEqual([expect.objectContaining({ entity: "danny_okafor", follow: { mode: "no_invitations", awareness: null, role: null, skips: null }, blocks: [expect.objectContaining({ block: "fleet", off: false })] })]);
    const gm = rig.body(await rig.send({ type: "lre.routine", chatId, op: "day", entity: "danny_okafor", view: "gm" })).gm as JsonObject;
    expect(gm.blocks).toContainEqual(expect.objectContaining({ block: fleet, owner: expect.objectContaining({ level: "chat" }), source: expect.objectContaining({ type: "gm" }) }));
    expect(gm.day).toMatchObject({ blocks: expect.arrayContaining([expect.objectContaining({ from: "4:00 PM", to: "5:30 PM", place: "alder_harbor_marina" })]) });
    // One submit is one Undo.
    const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
    if (!undo) throw new Error("no Undo chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
    expect(rig.body(await rig.send({ type: "lre.routine", chatId, op: "changed" })).changed).toEqual([]);
    const back = rig.body(await rig.send({ type: "lre.routine", chatId, op: "day", entity: "danny_okafor", view: "gm" })).gm as JsonObject;
    expect(JSON.stringify(back.blocks)).not.toContain("fleet");
  });
});
