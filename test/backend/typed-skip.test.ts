// Typed time skips (DESIGN §5.2, §9.2, §24.7): an out-of-character instruction that states a span
// of time ("OOC: over the next hour, I sort the stock") is read as a time skip of that span and runs
// through the same time-skip path as the palette's Timelapse. `interpret` names the skip; the span
// is read from the player's own words, the same way every time. A message the read gives no skip
// never becomes one, whatever time words it holds, and an ordinary action stays one.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { interpretedTarget } from "../../src/backend/runtime";
import { calendarOf, clockOfStamp } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { objOf } from "../../src/engine/pack-kit";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
const INTERPRET_MARK = "You map a player's typed input";
const MIND_MARK = "You are the private mind of";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };

/** Port Alder on its first Monday, 14 September 2026, at 06:27. */
function monday(): { world: WorldDoc; state: WorldState; clock: (stamp: string) => number } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("w", "Port Alder");
  const cal = calendarOf(world);
  const clock = (stamp: string): number => {
    const at = clockOfStamp(cal, stamp);
    if (at === null) throw new Error(`not a stamp: ${stamp}`);
    return at;
  };
  const state = startState(world, reg);
  state.clock = clock("2026-09-14 06:27");
  return { world, state, clock };
}

/**
 * A Port Alder chat after one ordinary turn. `interpret` answers `read(the typed text, its prompt)`;
 * a mind answers plainly; every other step reads nothing.
 */
async function alder(read: (text: string, system: string) => JsonObject, minds = false): Promise<{ rig: Rig; chatId: string; worldId: string }> {
  const rig = new Rig({ shipped: true, minds });
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(MIND_MARK)) return JSON.stringify({ monologue: "Not yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: "calm" });
    if (!system.includes(INTERPRET_MARK)) return "{}";
    const text = req.messages[1]?.content ?? "";
    return JSON.stringify(text.startsWith("I look around") ? NONE : read(text, system));
  };
  rig.rt.beatMinds = async () => ({ events: [], traces: [] });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  return { rig, chatId, worldId };
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("not a world chat");
  const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const state = core.fold(observed).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  const head = core.chain(observed).at(-1);
  return { state, world, record: head?.ledger?.swipes[String(head.swipeId)] };
}

const timelapseOf = (events: readonly LedgerEvent[] | undefined): LedgerEvent | undefined => (events ?? []).find((e) => e.type === "timelapse");

async function offers(rig: Rig, chatId: string): Promise<string[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "timelapse_offer").map((c) => c.label);
}

describe("a span in the player's own words", () => {
  test("reads the same way every time: a length, a part of the day, a shift", () => {
    const { world, state, clock } = monday();
    const read = (span: string) => interpretedTarget({ span }, world, state, "");
    expect(read("over the next hour")).toEqual({ type: "duration", minutes: 60 });
    expect(read("for the next two hours")).toEqual({ type: "duration", minutes: 120 });
    expect(read("skip ahead two hours")).toEqual({ type: "duration", minutes: 120 });
    expect(read("the next 45 minutes")).toEqual({ type: "duration", minutes: 45 });
    expect(read("half an hour")).toEqual({ type: "duration", minutes: 30 });
    expect(read("an hour and a half")).toEqual({ type: "duration", minutes: 90 });
    expect(read("two and a half hours")).toEqual({ type: "duration", minutes: 150 });
    expect(read("an hour and twenty minutes")).toEqual({ type: "duration", minutes: 80 });
    expect(read("1.5 hours")).toEqual({ type: "duration", minutes: 90 });
    expect(read("a couple of hours")).toEqual({ type: "duration", minutes: 120 });
    expect(read("three hours later")).toEqual({ type: "duration", minutes: 180 });
    expect(read("over the next two days")).toEqual({ type: "duration", minutes: 2880 });
    expect(read("skip ahead to evening")).toEqual({ type: "day_part", dayPart: "evening" });
    expect(read("later that evening")).toEqual({ type: "day_part", dayPart: "evening" });
    expect(read("later that night")).toEqual({ type: "day_part", dayPart: "night" });
    expect(read("until the afternoon")).toEqual({ type: "day_part", dayPart: "afternoon" });
    // Evening is still ahead today at 06:27, so tonight is this evening.
    expect(read("later tonight")).toEqual({ type: "day_part", dayPart: "evening" });
    // Morning starts at 08:00, under three hours away: the next morning is Tuesday's.
    expect(read("until the next morning")).toEqual({ type: "at", at: clock("2026-09-15 08:00") });
    expect(read("tomorrow evening")).toEqual({ type: "at", at: clock("2026-09-15 17:30") });
    expect(read("until my next shift")).toEqual({ type: "shift" });
  });

  test("words that state no span, or two, or a day and time, are left to the rest of the read", () => {
    const { world, state, clock } = monday();
    const read = (span: string) => interpretedTarget({ span }, world, state, "");
    // None stated, one gone by, a rate, an age, or two different ones (a sentence's end keeps lengths apart).
    for (const span of ["a while", "a few hours", "for some time", "two hours ago", "the last two hours", "every hour", "$20 an hour", "a four day old relationship", "an hour, then until evening", "An hour. Two hours."]) expect(read(span)).toBeNull();
    expect(read("cover the next hour of progress (1:45p to 2:45p)")).toBeNull();
    // A day and time is the read's stated time, never half-read as a part of the day.
    expect(interpretedTarget({ span: "tomorrow evening at 8", at: "2026-09-15 20:00" }, world, state, "")).toEqual({ type: "at", at: clock("2026-09-15 20:00") });
    expect(interpretedTarget({ span: "Friday at 6 PM", at: "2026-09-18 18:00" }, world, state, "")).toEqual({ type: "at", at: clock("2026-09-18 18:00") });
    // Words that don't read leave the read's own numbers.
    expect(interpretedTarget({ span: "a few hours", minutes: 180 }, world, state, "")).toEqual({ type: "duration", minutes: 180 });
    // A day part the read gives in the player's words reads as one.
    expect(interpretedTarget({ until: "later that evening" }, world, state, "")).toEqual({ type: "day_part", dayPart: "evening" });
    expect(interpretedTarget({ minutes: "90" }, world, state, "")).toEqual({ type: "duration", minutes: 90 });
  });
});

describe("an out-of-character instruction that states a span", () => {
  test("is the time skip of that span, run through the palette's time-skip path", async () => {
    const skip: JsonObject = { action: "timelapse", params: { span: "over the next hour" }, confidence: 0.9 };
    const typed = await alder(() => skip, true);
    const before = await folded(typed.rig, typed.chatId);
    await typed.rig.turn(typed.chatId, "OOC: over the next hour, I sort the stock.", "An hour goes by among the shelves.");
    const after = await folded(typed.rig, typed.chatId);
    expect(after.record?.status).toBe("ok");
    expect(after.state.clock).toBe(before.state.clock + 60);
    // The same hour run from the palette, in a second chat of the same world from the same start.
    const palette = typed.rig.host.createChat("Morning.");
    typed.rig.body(await typed.rig.send({ type: "lre.world", op: "attach", worldId: typed.worldId, chatId: palette }));
    await typed.rig.turn(palette, "I look around the shop.", "The shop is quiet.");
    typed.rig.body(await typed.rig.send({ type: "lre.action", chatId: palette, action: "timelapse", params: { target: { type: "duration", minutes: 60 } }, source: "palette", now: true }));
    const g = await typed.rig.host.start(palette, { type: "normal" });
    await typed.rig.host.finish(g, "An hour goes by.");
    const ran = await folded(typed.rig, palette);
    expect(timelapseOf(after.record?.events)).toEqual(timelapseOf(ran.record?.events));
    expect(timelapseOf(after.record?.events)).toMatchObject({ from: before.state.clock, to: before.state.clock + 60, target: { type: "duration", minutes: 60 }, stoppedBy: null });
    // Minds are on, so both are time skips: each records its beats.
    expect(after.record?.events.some((e) => e.type === "minds.skip")).toBe(true);
    expect(ran.record?.events.some((e) => e.type === "minds.skip")).toBe(true);
  });

  test("its Continue keeps the POV where the story has it, as the span did", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: { span: "over the next ten hours" }, confidence: 0.9 }));
    // Two agent-days a segment: the span stops on a slot boundary and offers the rest on a Continue.
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: 2, events: 5000 } }));
    const before = await folded(rig, chatId);
    const here = placeOfEntity(before.state, before.world.pov);
    await rig.turn(chatId, "OOC: over the next ten hours, I sort the stock.", "The hours go by among the shelves.");
    const stopped = await folded(rig, chatId);
    expect(stopped.state.clock).toBeLessThan(before.state.clock + 600);
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "continue_timelapse");
    if (!chip) throw new Error("no Continue");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "timelapse" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "More hours go by.");
    // The rest runs as the span did: past the POV's own lunch and work, it stays where the story has it.
    const after = await folded(rig, chatId);
    expect(after.state.clock).toBeGreaterThan(stopped.state.clock);
    expect(placeOfEntity(after.state, after.world.pov)).toBe(here);
  });

  test("a skip the read splits between its params and then keeps the span", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: {}, confidence: 0.9, then: { minutes: 120 } }));
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "(OOC: skip ahead two hours)", "Two hours slip by.");
    const after = await folded(rig, chatId);
    expect(timelapseOf(after.record?.events)).toMatchObject({ target: { type: "duration", minutes: 120 } });
    expect(after.state.clock).toBe(before.state.clock + 120);
  });

  test("a skip whose until holds the player's words reads them", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: { until: "later that evening" }, confidence: 0.9 }));
    await rig.turn(chatId, "[OOC] later that evening", "The light goes amber.");
    const { record, world, state } = await folded(rig, chatId);
    expect(timelapseOf(record?.events)).toMatchObject({ target: { type: "day_part", dayPart: "evening" } });
    expect(state.clock).toBe(clockOfStamp(calendarOf(world), "2026-09-14 17:30") ?? Number.NaN);
  });

  test("a skip the read chose without a span it can read takes the one the message states", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: {}, confidence: 0.9 }));
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "We stand up the piano and keep at it.\n\nOOC:\n- cover the next hour of the plan's progress", "The piano stands by noon.");
    const after = await folded(rig, chatId);
    expect(timelapseOf(after.record?.events)).toMatchObject({ target: { type: "duration", minutes: 60 } });
    expect(after.state.clock).toBe(before.state.clock + 60);
  });

  test("a message stating two spans, with none in the read, isn't guessed at", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: {}, confidence: 0.9 }));
    await rig.turn(chatId, "I worked on the truck for two hours. OOC: skip ahead to evening.", "Evening comes.");
    const { record } = await folded(rig, chatId);
    expect(timelapseOf(record?.events)).toBeUndefined();
  });

  test("a read that fills only what the skip's catalog entry requires still says how long", async () => {
    // A reader that gives exactly the params the catalog marks as required (no "?"), each in the
    // input's own words for the span.
    const required = (system: string): string[] => {
      const line = system.split("\n").find((l) => l.startsWith("timelapse — ")) ?? "";
      const params = /Params: (.*?)\. (?:Needs|Said as):/.exec(line)?.[1] ?? "";
      return [...params.matchAll(/(?:^|, )([a-z_]+) \(/g)].map((m) => m[1] ?? "");
    };
    const { rig, chatId } = await alder((_text, system) => ({ action: "timelapse", params: Object.fromEntries(required(system).map((p) => [p, "skip ahead to evening"])), confidence: 0.9 }));
    await rig.turn(chatId, "I worked on the truck for two hours. OOC: skip ahead to evening.", "Evening comes.");
    const { record } = await folded(rig, chatId);
    expect(timelapseOf(record?.events)).toMatchObject({ target: { type: "day_part", dayPart: "evening" } });
  });

  test("a span after the actions, in words, is offered once they have played", async () => {
    const { rig, chatId } = await alder(() => ({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9, then: { span: "for two hours" } }));
    await rig.turn(chatId, "I head over to Bluebird Coffee, then wait there for two hours.", "The bell over the door jangles.");
    const { record, state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    expect(timelapseOf(record?.events)).toBeUndefined();
    expect(await offers(rig, chatId)).toEqual(["Timelapse 2 h?"]);
  });
});

describe("a message without a skip", () => {
  test("an ordinary action with no span stays that action", async () => {
    const { rig, chatId } = await alder(() => ({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 }));
    await rig.turn(chatId, "I head over to Bluebird Coffee.", "The bell over the door jangles.");
    const { record, state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    expect(timelapseOf(record?.events)).toBeUndefined();
    expect(await offers(rig, chatId)).toEqual([]);
  });

  test("is never made one by the time words it holds", async () => {
    const { rig, chatId } = await alder((text): JsonObject => (text.startsWith("I head") ? { action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 } : { action: null, params: {}, confidence: 0.9, reason: "speech" }));
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "“I'll be back in an hour,” I tell Danny.", "Danny waves a wrench.");
    const said = await folded(rig, chatId);
    expect(timelapseOf(said.record?.events)).toBeUndefined();
    expect(said.state.clock - before.state.clock).toBeLessThan(60);
    await rig.turn(chatId, "I head over to Bluebird Coffee for an hour.", "The bell over the door jangles.");
    const moved = await folded(rig, chatId);
    expect(placeOfEntity(moved.state, moved.world.pov)).toBe("bluebird_coffee");
    expect(timelapseOf(moved.record?.events)).toBeUndefined();
    expect(await offers(rig, chatId)).toEqual([]);
  });
});

describe("the palette's Timelapse", () => {
  /** Four hours from the palette (every interrupt noted) after the first turn, into the POV's morning at the garage; whether the POV ended where it started, and what its message recorded. */
  async function palette(params: JsonObject): Promise<{ held: boolean; recorded: unknown }> {
    const { rig, chatId } = await alder(() => NONE);
    const before = await folded(rig, chatId);
    const here = placeOfEntity(before.state, before.world.pov);
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 240 }, overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" }, ...params }, source: "palette", now: true }));
    const sent = objOf(objOf((await rig.host.chats.messages(chatId, rig.host.userId)).at(-1)?.metadata[LEDGER_NAMESPACE]).params);
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The hours go by.");
    const after = await folded(rig, chatId);
    return { held: placeOfEntity(after.state, after.world.pov) === here, recorded: sent.povRoutine };
  }

  test("holds the POV where the story has it by default, and lives its routine when Follow my routine is chosen", async () => {
    // The world leaves Follow my routine off, and the sheet opens with it so.
    const { rig, chatId } = await alder(() => NONE);
    expect((await rig.rt.view(chatId, rig.host.userId)).palette?.timelapse?.followRoutine).toBe(false);
    // Held, the message records the hold as a typed span's does, so its Continue keeps it (DESIGN §8); followed, none.
    expect(await palette({})).toEqual({ held: true, recorded: false });
    expect(await palette({ followRoutine: false })).toEqual({ held: true, recorded: false });
    // Its work takes the POV to the garage.
    expect(await palette({ followRoutine: true })).toEqual({ held: false, recorded: undefined });
  });
});
