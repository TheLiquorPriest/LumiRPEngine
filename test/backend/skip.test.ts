// Time skips (DESIGN §24.7) on the whole backend with fake steps: the beats a skip finds, the minds at
// them, a mind's interrupt stopping the skip at its time with the stop chip, the caps, the `skip`
// step's beats recorded, the before-the-reply clock running out, Re-run asking again and replay.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import { calendarOf, clockAt, dateAt, formatHHMM, formatStamp } from "../../src/engine/calendar";
import { placeOfEntity } from "../../src/engine/scope";
import { runTimelapse } from "../../src/engine/time";
import { turnStart } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { toChain } from "../../src/backend/ledger-io";
import { readRun } from "../../src/backend/runtime";
import type { BeatMinds } from "../../src/backend/skip";
import { Rig } from "../support/rig";

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

/** Port Alder after one ordinary turn, with every helper call answered with nothing. */
async function portAlder(): Promise<{ rig: Rig; chatId: string; day: number; at: (day: number, hhmm: string) => number }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = () => "{}";
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  const { state, world } = await folded(rig, chatId);
  const cal = calendarOf(world);
  return { rig, chatId, day: dateAt(cal, state.clock).dayIndex, at: (day, hhmm) => clockAt(cal, day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) };
}

/** Marcus, pinned Live, plans to meet the player character at these times. */
async function marcusPlans(rig: Rig, chatId: string, times: readonly number[]): Promise<void> {
  const ops: JsonObject[] = [{ op: "mind_pin", entity: MARCUS, level: "live" }];
  for (const [i, from] of times.entries()) ops.push({ op: "mind_memory", entity: MARCUS, part: "plan", id: null, value: { what: `Talk to Jordan about the books (${i + 1})`, kind: "meet", when: { from, to: from + 60 }, with: ["pov"], priority: 4 } });
  rig.body(await rig.send({ type: "lre.edit", chatId, ops }));
}

/**
 * A fake runner: a mind for each person asked, interrupting where `interrupts` says; every call kept.
 * A slow one is still thinking when the before-the-reply clock runs out: it waits for that signal (the
 * behaviour under test is the real pre-phase deadline) and then gives what finished, nothing.
 */
function fakeMinds(calls: { at: number; who: string[]; reason: string }[], interrupts: (who: string, at: number) => boolean, slow = false): BeatMinds {
  return async (input) => {
    calls.push({ at: input.moment.at, who: [...input.who], reason: input.moment.reason });
    if (slow && !input.signal.aborted) {
      const { promise, resolve } = Promise.withResolvers<void>();
      input.signal.addEventListener("abort", () => resolve(), { once: true });
      await promise;
    }
    if (input.signal.aborted) return { events: [], traces: [] };
    const events: LedgerEvent[] = input.who.map((id) => ({
      type: "minds.mind",
      data: { entity: id, at: input.moment.at, place: placeOfEntity(input.state, id), level: input.levels[id] ?? "near", moment: "beat", reason: input.moment.reason, monologue: "Something has to be said.", depiction: "restless", intent: "Find Jordan.", reactions: [], plans: [], mood: null, interrupt: interrupts(id, input.moment.at) ? { reason: "He comes looking for Jordan." } : null, withheld: false },
    }));
    return { events, traces: [] };
  };
}

/** A timelapse of `days` under `overrides`: by default invitations only note (the plan's own invitation would end it first otherwise). */
async function skipDays(rig: Rig, chatId: string, days: number, overrides: JsonObject = { invitation: "note" }): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: days * 1440 }, overrides }, source: "palette" }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "Days pass.");
}

const ofType = (events: readonly LedgerEvent[] | undefined, type: string): LedgerEvent[] => (events ?? []).filter((e) => e.type === type);

describe("time skips", () => {
  test("under the default policy an invitation stops the skip where the span run whole stops, and Continue's scan finds the beat after it", async () => {
    const { rig, chatId, day, at } = await portAlder();
    const meet = at(day + 1, "19:00");
    await marcusPlans(rig, chatId, [meet]);
    // The same span run whole, as a plain timelapse from the state the skip starts from: Marcus's
    // invitation, asked six hours before the meeting, stops it at the end of that slot.
    const start = await folded(rig, chatId);
    const run = readRun(await rig.host.chats.chatMetadata(chatId, rig.host.userId));
    if (!run) throw new Error("no run");
    const whole = new Working(rig.rt.registry, start.world, start.state);
    turnStart(rig.rt.registry, whole, run.runSeed);
    const plain = runTimelapse(rig.rt.registry, whole, { type: "duration", minutes: 3 * 1440 }, { runSeed: run.runSeed });
    if ("code" in plain) throw new Error(plain.reason);
    expect(plain.summary.stoppedBy).toBe("invitation");
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, (who, when) => who === MARCUS && when === meet);
    await skipDays(rig, chatId, 3, {});
    const first = await folded(rig, chatId);
    expect(first.record?.events.find((e) => e.type === "timelapse")).toMatchObject({ stoppedBy: "invitation", to: plain.summary.to });
    expect(first.state.clock).toBe(plain.summary.to);
    // Continue runs the rest: its scan finds the meeting, where Marcus thinks and steps in.
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "continue_timelapse");
    expect(chip?.label).toBe("Timelapse stopped: an invitation");
    if (!chip) throw new Error("no stop chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "timelapse" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Evening comes.");
    const second = await folded(rig, chatId);
    const skip = ofType(second.record?.events, "minds.skip")[0];
    expect(skip && "data" in skip ? skip.data.beats : null).toEqual(expect.arrayContaining([expect.objectContaining({ at: meet, source: "scan" })]));
    expect(calls.some((c) => c.at === meet && c.who.includes(MARCUS))).toBe(true);
    expect(second.record?.events.find((e) => e.type === "timelapse")).toMatchObject({ stoppedBy: "mind", mind: MARCUS, to: meet });
  });

  test("a 3-day skip finds the beats, runs the minds at them and stops on an interrupt at its time, with the chip; replay is identical", async () => {
    const { rig, chatId, day, at } = await portAlder();
    const meet = at(day + 1, "19:00");
    await marcusPlans(rig, chatId, [meet]);
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, (who, when) => who === MARCUS && when === meet);
    await skipDays(rig, chatId, 3);
    const { state, record } = await folded(rig, chatId);
    expect(calls.some((c) => c.at === meet && c.who.includes(MARCUS))).toBe(true);
    const skip = ofType(record?.events, "minds.skip")[0];
    expect(skip && "data" in skip ? skip.data.beats : null).toEqual(expect.arrayContaining([expect.objectContaining({ at: meet, source: "scan" })]));
    const summary = record?.events.find((e) => e.type === "timelapse");
    expect(summary).toMatchObject({ stoppedBy: "mind", mind: MARCUS, to: meet });
    expect(state.clock).toBe(meet);
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "continue_timelapse");
    expect(chip?.label).toMatch(/^Timelapse stopped: (Marcus Delgado|someone)$/);
    // The minds' words never reach a player surface: the Journal and chips hold none of them.
    expect(JSON.stringify(await rig.rt.view(chatId, rig.host.userId))).not.toContain("Something has to be said");
    // Replay folds the record as it stands, with no model asked again.
    const before = calls.length;
    const again = rig.restart();
    again.rt.beatMinds = fakeMinds(calls, () => false);
    expect((await folded(again, chatId)).state).toEqual(state);
    expect(calls.length).toBe(before);
  });

  test("Re-run asks the minds again", async () => {
    const { rig, chatId, day, at } = await portAlder();
    await marcusPlans(rig, chatId, [at(day + 1, "19:00")]);
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, () => false);
    await skipDays(rig, chatId, 2);
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    const g = await rig.host.start(chatId, { type: "swipe" });
    await rig.host.finish(g, "Days pass, again.");
    expect(calls.length).toBeGreaterThan(first);
  });

  test("the beats per skip and the minds per beat keep to their caps", async () => {
    const { rig, chatId, day, at } = await portAlder();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { skip: { maxBeats: 2, maxMindsPerBeat: 1 } } } }));
    await marcusPlans(rig, chatId, [at(day + 1, "19:00"), at(day + 2, "12:30"), at(day + 2, "19:00")]);
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, () => false);
    await skipDays(rig, chatId, 3);
    const beats = calls.filter((c) => !c.reason.startsWith("The time skip ends"));
    expect(beats.length).toBeLessThanOrEqual(2);
    expect(beats.every((c) => c.who.length <= 1)).toBe(true);
    const skip = ofType((await folded(rig, chatId)).record?.events, "minds.skip")[0];
    expect(skip && "data" in skip && Array.isArray(skip.data.beats) ? skip.data.beats.length : -1).toBe(2);
  });

  test("the skip step's beats are recorded with the scanned ones", async () => {
    const { rig, chatId, day, at } = await portAlder();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { skip: { enabled: true, signals: ["always"] } } } } }));
    const { world } = await folded(rig, chatId);
    const festival = at(day + 1, "15:00");
    const d = dateAt(calendarOf(world), festival);
    const stamp = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")} ${formatHHMM(d.minuteOfDay)}`;
    rig.host.quietReply = (req) => (req.messages.some((m) => m.content.includes("skipping ahead in time")) ? JSON.stringify({ beats: [{ at: stamp, reason: "The harbour festival" }] }) : "{}");
    rig.rt.beatMinds = fakeMinds([], () => false);
    await skipDays(rig, chatId, 2);
    const skip = ofType((await folded(rig, chatId)).record?.events, "minds.skip")[0];
    expect(skip && "data" in skip ? skip.data.beats : null).toEqual(expect.arrayContaining([{ at: festival, reason: "The harbour festival", source: "model" }]));
  });

  test("a skip whose beats' minds give nothing replays as it ran before the reply, ending where that run ended", async () => {
    const { rig, chatId, day, at } = await portAlder();
    // Two agent-days a segment: the early-morning and morning slots run, midday (11:30 to 14:00) doesn't fit.
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: 2, events: 5000 } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { skip: { enabled: true, signals: ["always"] } } } } }));
    const { world } = await folded(rig, chatId);
    const lunch = at(day, "12:30");
    rig.host.quietReply = (req) => (req.messages.some((m) => m.content.includes("skipping ahead in time")) ? JSON.stringify({ beats: [{ at: formatStamp(calendarOf(world), lunch), reason: "Lunch at the diner" }] }) : "{}");
    // Every mind's call fails, so no beat records a mind; the last minds asked are the skip's end.
    const calls: { at: number; reason: string }[] = [];
    rig.rt.beatMinds = async (input) => {
      calls.push({ at: input.moment.at, reason: input.moment.reason });
      return { events: [], traces: [] };
    };
    await skipDays(rig, chatId, 3);
    const end = calls.at(-1);
    expect(end?.reason).toStartWith("The time skip ends");
    const { state, record } = await folded(rig, chatId);
    expect(record?.events.find((e) => e.type === "timelapse")).toMatchObject({ to: end?.at });
    expect(state.clock).toBe(end?.at ?? NaN);
  });

  test("the unit cap ends a skip on a slot boundary, though a beat falls inside the slot it can't run", async () => {
    const { rig, chatId, day, at } = await portAlder();
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: 2, events: 5000 } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { skip: { enabled: true, signals: ["always"] } } } } }));
    const { world } = await folded(rig, chatId);
    rig.host.quietReply = (req) => (req.messages.some((m) => m.content.includes("skipping ahead in time")) ? JSON.stringify({ beats: [{ at: formatStamp(calendarOf(world), at(day, "12:30")), reason: "Lunch at the diner" }] }) : "{}");
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, () => false);
    await skipDays(rig, chatId, 3);
    const { state, record } = await folded(rig, chatId);
    // Midday (11:30 to 14:00) doesn't fit: the skip ends at its start, as the same span run whole does, with no one asked at 12:30.
    expect(record?.events.find((e) => e.type === "timelapse")).toMatchObject({ stoppedBy: null, to: at(day, "11:30") });
    expect(state.clock).toBe(at(day, "11:30"));
    expect(calls.map((c) => c.at)).not.toContain(at(day, "12:30"));
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "continue_timelapse");
    expect(chip?.label).toMatch(/^Continue timelapse/);
  });

  test("the skip step makes no call until the user turns it on", async () => {
    const { rig, chatId, day, at } = await portAlder();
    await marcusPlans(rig, chatId, [at(day + 1, "19:00")]);
    let asked = 0;
    rig.host.quietReply = (req) => {
      if (req.messages.some((m) => m.content.includes("skipping ahead in time"))) asked++;
      return "{}";
    };
    rig.rt.beatMinds = fakeMinds([], () => false);
    // The default settings (Standard) leave the step off.
    await skipDays(rig, chatId, 1);
    expect(asked).toBe(0);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { skip: { enabled: true, signals: ["always"] } } } } }));
    await skipDays(rig, chatId, 1);
    expect(asked).toBe(1);
  });

  test("when the before-the-reply clock runs out the skip stops at a beat, keeps what it ran and offers Continue; the turn commits", async () => {
    const { rig, chatId, day, at } = await portAlder();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { budgets: { pre: { calls: 4, ms: 250 } } } } }));
    await marcusPlans(rig, chatId, [at(day + 1, "19:00"), at(day + 2, "19:00")]);
    rig.rt.beatMinds = fakeMinds([], () => false, true);
    await skipDays(rig, chatId, 3);
    const { state, record } = await folded(rig, chatId);
    expect(record?.status).toBe("ok");
    // It stopped at its first beat, the one whose minds were still thinking, well short of the target.
    const skip = ofType(record?.events, "minds.skip")[0];
    const first = skip && "data" in skip && Array.isArray(skip.data.beats) && typeof (skip.data.beats[0] as JsonObject | undefined)?.at === "number" ? Number((skip.data.beats[0] as JsonObject).at) : NaN;
    expect(state.clock).toBe(first);
    expect(record?.events.find((e) => e.type === "timelapse")).toMatchObject({ stoppedBy: null, to: first });
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "continue_timelapse");
    expect(chip?.label).toMatch(/^Continue timelapse/);
  });
});
