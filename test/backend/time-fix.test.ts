// The clock's ✎ fix (DESIGN §9.2, §12) on the whole backend, in Port Alder: the time row's target,
// a later time run as an applied advance runs it, an earlier one set back with nothing in between
// undone or run again (L48), Undo, a prepared turn gone stale, and swipes and edits of the head.

import { describe, expect, test } from "bun:test";
import type { WorldState } from "../../src/engine/state";
import { isRecord } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import { ranTo } from "../../src/engine/simulate";
import { Rig } from "../support/rig";

const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const HOME = "harbor_street_114";

/**
 * Port Alder after one turn: Monday 14 September 2026 at 06:45, the player character and Danny at
 * home. Danny works at Alder Automotive from 07:00, fuels up at Shoreline Fuel from 12:00 and is back
 * at 12:30; Marcus, off screen at the garage since 06:30, lunches at the Rusty Anchor from 12:00 to
 * 12:45; the phone bill on the player character's card falls due at 09:00, paid as the slot it falls
 * in ends (11:30).
 */
async function alder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I stretch.", "You stretch.");
  return { rig, chatId };
}

async function folded(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("not a world chat");
  return core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
}

/** How many times the phone bill was charged to the player character's card. */
function phoneBills(state: Readonly<WorldState>): number {
  const journal = state.packs.economy?.journal;
  const card = isRecord(journal) ? journal.acct_pov_card : undefined;
  return (Array.isArray(card) ? card : []).filter((line) => isRecord(line) && line.flow === "bill_phone").length;
}

/** The clock as the pill reads it, with where Danny, Marcus and the player character are and the phone bills paid. */
async function world(rig: Rig, chatId: string): Promise<{ clock: string | undefined; danny: string | null; marcus: string | null; you: string | null; bills: number }> {
  const state = await folded(rig, chatId);
  const view = await rig.rt.view(chatId, rig.host.userId);
  return { clock: view.hud?.clock.label, danny: placeOfEntity(state, DANNY), marcus: placeOfEntity(state, MARCUS), you: placeOfEntity(state, "pov"), bills: phoneBills(state) };
}

async function setTime(rig: Rig, chatId: string, time: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.fix", chatId, time }));
}

async function corrections(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix");
}

/**
 * A Timelapse turn of `minutes`, run as the palette sends it with Follow my routine on. Decision
 * (issue #48): following the POV's routine is the palette's choice now, off by default; these tests
 * are about what the clock's ✎ lets run again, the POV's own schedules included, so they choose it.
 */
async function timelapse(rig: Rig, chatId: string, minutes: number): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes }, followRoutine: true }, source: "palette" }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "Time passes.");
}

describe("the clock's ✎ fix", () => {
  test("the time row's ✎: the view's fixes carry a time target, from now in the world's calendar where you are, and none with Calendar & time off", async () => {
    const { rig, chatId } = await alder();
    const fix = (await rig.rt.view(chatId, rig.host.userId)).hud?.fixes.time;
    expect(fix).toEqual({
      type: "time",
      value: "2026-09-14 06:45",
      gregorian: true,
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((name, i) => ({ name, days: [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i] })),
    });
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "resolve", domain: "calendar", scope: { all: true }, to: 0 }));
    expect((await rig.rt.view(chatId, rig.host.userId)).hud?.fixes.time).toBeUndefined();
  });

  test("later: the clock reads the new time, the story keeps the player character and Danny with it at home, Marcus off screen is where his schedule puts him, the bill due between is paid once, and the next reply's Scene has the time", async () => {
    const { rig, chatId } = await alder();
    expect(await world(rig, chatId)).toEqual({ clock: "Mon 14 Sep 2026, 06:45", danny: HOME, marcus: "alder_automotive", you: HOME, bills: 0 });
    await setTime(rig, chatId, "2026-09-14 12:00");
    // The time passes as a narrated skip does: the player character stays where the story has it, and
    // Danny, in the scene with it, isn't taken out of it by his schedule; Marcus goes to lunch at noon.
    expect(await world(rig, chatId)).toEqual({ clock: "Mon 14 Sep 2026, 12:00", danny: HOME, marcus: "rusty_anchor", you: HOME, bills: 1 });
    const [chip] = await corrections(rig, chatId);
    expect(chip?.detail).toStartWith("Clock moved on 5 h 15 min");
    await rig.turn(chatId, "I look around.", "The cafe is busy.");
    expect(rig.host.section("Scene")).toContain("Time: Mon 14 Sep 2026, 12:");
    expect((await world(rig, chatId)).bills).toBe(1);
  });

  test("earlier: the clock goes back, nothing in between is undone, and passing it again runs none of it; past where it stood the world runs on", async () => {
    const { rig, chatId } = await alder();
    await setTime(rig, chatId, "2026-09-14 12:00");
    await setTime(rig, chatId, "2026-09-14 06:50");
    expect(await world(rig, chatId)).toEqual({ clock: "Mon 14 Sep 2026, 06:50", danny: HOME, marcus: "rusty_anchor", you: HOME, bills: 1 });
    expect((await corrections(rig, chatId)).map((c) => c.detail?.split(" · ")[0])).toEqual(["Clock moved on 5 h 15 min", "Clock set back 5 h 10 min"]);
    // A Timelapse past 07:00, 09:00 and 11:30, whose routines would take the player character and
    // Danny to the garage, moves neither of them and charges no second bill.
    await timelapse(rig, chatId, 295);
    expect(await world(rig, chatId)).toEqual({ clock: "Mon 14 Sep 2026, 11:45", danny: HOME, marcus: "rusty_anchor", you: HOME, bills: 1 });
    // Plain turns and the ✎ again up to where the clock had stood: still nothing.
    await rig.turn(chatId, "I wait.", "You wait.");
    await setTime(rig, chatId, "2026-09-14 12:00");
    expect(await world(rig, chatId)).toEqual({ clock: "Mon 14 Sep 2026, 12:00", danny: HOME, marcus: "rusty_anchor", you: HOME, bills: 1 });
    // Past 12:00 the schedules run again: at 12:30 the player character and Danny go back to the
    // garage (home is where their routine's rest has them), and at 12:45 Marcus does.
    await timelapse(rig, chatId, 45);
    expect(await world(rig, chatId)).toEqual({ clock: "Mon 14 Sep 2026, 12:45", danny: "alder_automotive", marcus: "alder_automotive", you: "alder_automotive", bills: 1 });
  });

  test("Undo takes a fix of the time back: the clock and the state from before it", async () => {
    const { rig, chatId } = await alder();
    const before = await world(rig, chatId);
    await setTime(rig, chatId, "2026-09-14 12:00");
    const later = await world(rig, chatId);
    await setTime(rig, chatId, "2026-09-14 06:50");
    // Undoing the set-back puts the clock where it stood, and nothing behind it is kept from running.
    const [, back] = await corrections(rig, chatId);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: back?.id, choice: "undo" }));
    expect(await world(rig, chatId)).toEqual(later);
    expect(ranTo(await folded(rig, chatId))).toBe((await folded(rig, chatId)).clock);
    // Undoing the move on takes the time, the moves and the bill back.
    const [on] = await corrections(rig, chatId);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: on?.id, choice: "undo" }));
    expect(await world(rig, chatId)).toEqual(before);
  });

  test("a turn the engine prepared before the fix is stale: the engine runs again, and the reply's Scene has the corrected time", async () => {
    const { rig, chatId } = await alder();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    await setTime(rig, chatId, "2026-09-14 12:00");
    rig.host.restarts.length = 0;
    expect((await rig.host.begin(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(rig.host.restarts).toMatchObject([{ chatId, as: "regenerate" }]);
    const reply = await rig.host.begin(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(rig.host.section("Scene")).toContain("Time: Mon 14 Sep 2026, 12:");
    await rig.host.finish(reply, "The cafe is busy.");
  });

  test("a swipe or an edit of the head keeps a fix of the time as it keeps any fix: an edit keeps it, Re-narrate and Re-run carry it, and its own swipe still has it", async () => {
    const { rig, chatId } = await alder();
    await setTime(rig, chatId, "2026-09-14 12:00");
    const fixed = await world(rig, chatId);
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    rig.host.editMessage(chatId, head.id, "You stretch, slowly.");
    await rig.host.settle();
    expect(await world(rig, chatId)).toEqual(fixed);
    for (const mode of ["renarrate", "rerun"] as const) {
      rig.rt.setSwipeChoice(chatId, mode);
      await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "You stretch again.");
      expect(await world(rig, chatId)).toEqual(fixed);
    }
    rig.host.navigate(chatId, head.id, 0);
    await rig.host.settle();
    expect(await world(rig, chatId)).toEqual(fixed);
  });
});
