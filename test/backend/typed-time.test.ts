// A typed skip to a stated day and time (DESIGN §9.2, §24.7): `interpret` is told the day and time as
// the HUD shows them and names the moment as "YYYY-MM-DD HH:MM"; the engine reads it with the world's
// calendar into the timelapse's `at` target, refuses one that has passed, runs toward one beyond its
// reach in steps, and with minds on runs it as a time skip to exactly then.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { calendarOf, clockOfStamp, formatStamp } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { resolveTarget } from "../../src/engine/time";
import { TIME_LIMITS } from "../../src/engine/time-limits";
import { toChain } from "../../src/backend/ledger-io";
import { interpretedTarget } from "../../src/backend/runtime";
import type { BeatMinds } from "../../src/backend/skip";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);

/** Port Alder on its first Monday, 14 September 2026, at 06:27, as the live chat was. */
function monday(): { world: WorldDoc; clock: (stamp: string) => number; state: WorldState } {
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
  return { world, clock, state };
}

describe("a stated day and time", () => {
  test("reads with the calendar: later this week, next week, either way of writing it", () => {
    const { world, clock, state } = monday();
    expect(interpretedTarget({ at: "2026-09-18 18:00" }, world, state, "Skip ahead to Friday at 6 PM.")).toEqual({ type: "at", at: clock("2026-09-18 18:00") });
    expect(interpretedTarget({ at: "2026-09-25 18:00" }, world, state, "Skip to next Friday at 6 PM.")).toEqual({ type: "at", at: clock("2026-09-25 18:00") });
    expect(interpretedTarget({ at: "2026-09-18T18:00" }, world, state, "")).toEqual({ type: "at", at: clock("2026-09-18 18:00") });
    // It wins over a day part the model gave beside it, which is how the live turn misread "Friday at 6 PM".
    expect(interpretedTarget({ at: "2026-09-18 18:00", until: "evening" }, world, state, "")).toEqual({ type: "at", at: clock("2026-09-18 18:00") });
    const target = interpretedTarget({ at: "2026-09-18 18:00" }, world, state, "");
    expect(target && resolveTarget(reg, world, state, target)).toMatchObject({ to: clock("2026-09-18 18:00") });
  });

  test("is local to where the player character is, as the HUD shows it", () => {
    const { world, clock, state } = monday();
    // Chicago keeps Central time, an hour behind Port Alder's Eastern: 18:00 there is 19:00 at home.
    const pov = state.entities[world.pov];
    if (pov) pov.fields.place = "chicago_il";
    expect(interpretedTarget({ at: "2026-09-18 18:00" }, world, state, "")).toEqual({ type: "at", at: clock("2026-09-18 19:00") });
  });

  test("a time that has passed is refused with a note; one beyond a timelapse's reach is run toward one reach at a time", () => {
    const { world, clock, state } = monday();
    const past = interpretedTarget({ at: "2026-09-11 18:00" }, world, state, "Skip ahead to Friday at 6 PM.");
    expect(past && resolveTarget(reg, world, state, past)).toEqual({ code: "past", reason: "that time has passed" });
    const far = interpretedTarget({ at: "2027-10-01 09:00" }, world, state, "");
    const resolved = far && resolveTarget(reg, world, state, far);
    if (!resolved || "code" in resolved) throw new Error("the far target was refused");
    expect(resolved.goal).toBe(clock("2027-10-01 09:00"));
    expect(resolved.to).toBeGreaterThan(state.clock);
    expect(resolved.to - state.clock).toBeLessThanOrEqual(TIME_LIMITS.timelapseMinutes);
  });

  test("text that isn't a day and time the calendar has is no stated time", () => {
    const { world, state } = monday();
    for (const at of ["Friday 18:00", "2026-09-18", "2026-09-18 6 PM", "2026-02-30 18:00", "2026-13-01 10:00", "2026-09-18 24:00", "2026-09-18 18:60"]) {
      expect(interpretedTarget({ at }, world, state, "")).toBeNull();
    }
    // The other params still read when the stated time doesn't.
    expect(interpretedTarget({ at: "Friday 18:00", until: "evening" }, world, state, "")).toEqual({ type: "day_part", dayPart: "evening" });
  });

  test("\"next <day part>\" still means the following one when the coming one is close", () => {
    const { world, clock, state } = monday();
    // Morning starts at 08:00, under three hours away at 06:27: the next morning is Tuesday's.
    expect(interpretedTarget({ until: "next morning" }, world, state, "I sleep until the next morning.")).toEqual({ type: "at", at: clock("2026-09-15 08:00") });
  });
});

const MARCUS = "marcus_delgado";

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

describe("a typed skip to Friday at 6 PM", () => {
  test("runs as a time skip to exactly then, stopping at its beats; the model was told the day and time", async () => {
    // The skip runs its beats' minds, so minds are on, and every mind the turn asks answers plainly.
    const rig = new Rig({ shipped: true, minds: true });
    const prompts: string[] = [];
    let reading: JsonObject = {};
    rig.host.quietReply = (req) => {
      const system = req.messages[0]?.content ?? "";
      if (system.includes("You are the private mind of")) return JSON.stringify({ monologue: "Not yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: "calm" });
      if (!system.includes("You map a player's typed input")) return "{}";
      prompts.push(system);
      return JSON.stringify(reading);
    };
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const before = await folded(rig, chatId);
    const cal = calendarOf(before.world);
    const friday = clockOfStamp(cal, "2026-09-18 18:00");
    const wednesday = clockOfStamp(cal, "2026-09-16 19:00");
    if (friday === null || wednesday === null) throw new Error("no stamps");
    expect(formatStamp(cal, before.state.clock).startsWith("2026-09-14 06:")).toBe(true);
    // Marcus, pinned Live, means to talk to Jordan on Wednesday evening: a beat of the skip. His plan's
    // invitation only notes, here, so the skip runs on to the time the player named.
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "interrupt", scope: { interrupt: "invitation" }, to: "note" }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: MARCUS, level: "live" }, { op: "mind_memory", entity: MARCUS, part: "plan", id: null, value: { what: "Talk to Jordan about the books", kind: "meet", when: { from: wednesday, to: wednesday + 60 }, with: ["pov"], priority: 4 } }] }));
    const calls: { at: number; who: string[] }[] = [];
    const minds: BeatMinds = async (input) => {
      calls.push({ at: input.moment.at, who: [...input.who] });
      const events: LedgerEvent[] = input.who.map((id) => ({ type: "minds.mind", data: { entity: id, at: input.moment.at, place: placeOfEntity(input.state, id), level: input.levels[id] ?? "near", moment: "beat", reason: input.moment.reason, monologue: "Not yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: null, interrupt: null, withheld: false } }));
      return { events, traces: [] };
    };
    rig.rt.beatMinds = minds;
    reading = { action: "timelapse", params: { at: "2026-09-18 18:00" }, confidence: 0.9 };
    await rig.turn(chatId, "I put in my shifts at the garage all week. Skip ahead to Friday at 6 PM.", "The week goes by.");
    expect(prompts.at(-1)).toContain('or at a stated day and time, as "YYYY-MM-DD HH:MM" (it is now Mon 2026-09-14 06:');
    const { state, record } = await folded(rig, chatId);
    expect(record?.status).toBe("ok");
    expect(state.clock).toBe(friday);
    expect(record?.events.find((e) => e.type === "timelapse")).toMatchObject({ from: before.state.clock, to: friday, target: { type: "at", at: friday }, stoppedBy: null });
    const skip = record?.events.find((e) => e.type === "minds.skip");
    expect(skip && "data" in skip ? skip.data.beats : null).toEqual(expect.arrayContaining([expect.objectContaining({ at: wednesday, source: "scan" })]));
    expect(calls.some((c) => c.at === wednesday && c.who.includes(MARCUS))).toBe(true);
  });

  test("one that has passed runs no skip: the turn notes why", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: "timelapse", params: { at: "2026-09-11 18:00" }, confidence: 0.9 }) : "{}");
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    let beats = 0;
    rig.rt.beatMinds = async () => {
      beats++;
      return { events: [], traces: [] };
    };
    await rig.turn(chatId, "Skip ahead to last Friday at 6 PM.", "Nothing changes.");
    const { state, world, record } = await folded(rig, chatId);
    expect(JSON.stringify(record?.events)).toContain("Timelapse not run: that time has passed");
    expect(record?.events.some((e) => e.type === "timelapse" || e.type === "minds.skip")).toBe(false);
    expect(beats).toBe(0);
    expect(state.clock).toBeLessThan(clockOfStamp(calendarOf(world), "2026-09-14 08:00") ?? 0);
  });

  test("after another action, it is offered as a Timelapse to that time", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9, then: { at: "2026-09-18 18:00" } }) : "{}");
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I head over to Bluebird Coffee, then skip ahead to Friday at 6 PM.", "The coffee shop is warm.");
    const { state, world } = await folded(rig, chatId);
    const friday = clockOfStamp(calendarOf(world), "2026-09-18 18:00");
    expect(placeOfEntity(state, world.pov)).toBe("bluebird_coffee");
    expect(state.clock).toBeLessThan(clockOfStamp(calendarOf(world), "2026-09-14 08:00") ?? 0);
    const offer = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "timelapse_offer");
    if (!offer) throw new Error("no offer");
    rig.rt.beatMinds = async () => ({ events: [], traces: [] });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: offer.id, choice: "timelapse" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The week goes by.");
    expect((await folded(rig, chatId)).record?.events.find((e) => e.type === "timelapse")).toMatchObject({ target: { type: "at", at: friday } });
  });

  test("in another time zone, the time typed is read local to where they are", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: "eat", params: {}, confidence: 0.9, then: { at: "2026-09-18 18:00" } }) : "{}");
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    // In Chicago, an hour behind Port Alder: 18:00 there is 19:00 at home.
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { pov: string; entities: Record<string, JsonObject & { fields: JsonObject }> } };
    const pov = draft.entities[draft.pov];
    if (!pov) throw new Error("no POV");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: draft.pov, value: { ...pov, fields: { ...pov.fields, place: "chicago_il" } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I grab breakfast, then skip ahead to Friday at 6 PM.", "The diner is busy.");
    const { state, world } = await folded(rig, chatId);
    expect(placeOfEntity(state, world.pov)).toBe("chicago_il");
    const offer = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "timelapse_offer");
    if (!offer) throw new Error("no offer");
    rig.rt.beatMinds = async () => ({ events: [], traces: [] });
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: offer.id, choice: "timelapse" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The week goes by.");
    expect((await folded(rig, chatId)).record?.events.find((e) => e.type === "timelapse")).toMatchObject({ target: { type: "at", at: clockOfStamp(calendarOf(world), "2026-09-18 19:00") } });
  });
});
