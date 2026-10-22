// Time skips (DESIGN §24.7) on the whole backend with fake steps: the beats a skip finds, the minds at
// them, a mind's interrupt stopping the skip at its time with the stop chip, the caps, the `skip`
// step's beats recorded, the before-the-reply clock running out, Re-run asking again and replay; and
// the beat scan and the beats cap on their own.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import type { MindPlan } from "../../src/shared/minds";
import { calendarOf, clockAt, clockOfLocal, dateAt, formatHHMM, formatStamp } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_NOTE } from "../../src/engine/simulate";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { clockFix, replaySkip, runTimelapse } from "../../src/engine/time";
import { timelapseIntent, turnStart } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { toChain } from "../../src/backend/ledger-io";
import { readRun } from "../../src/backend/runtime";
import { capBeats, runSkip, scanBeats, type Beat, type BeatMinds } from "../../src/backend/skip";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";
import { decodeContextView } from "../../src/frontend/play/context";
import { Rig } from "../support/rig";

const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";

/** Every mind a turn asks answers plainly, and every other helper call with nothing. */
function plainly(req: QuietRequest): string {
  if (!(req.messages[0]?.content ?? "").includes("You are the private mind of")) return "{}";
  return JSON.stringify({ monologue: "Nothing yet.", depiction: "busy", intent: "Keep working.", reactions: [], plans: [], mood: "calm" });
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

/** Port Alder after one ordinary turn, with the helper answering `plainly`. */
async function portAlder(): Promise<{ rig: Rig; chatId: string; day: number; at: (day: number, hhmm: string) => number }> {
  const rig = new Rig({ shipped: true, minds: true });
  rig.host.quietReply = plainly;
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
  test("a Live character's plan with the POV sends no invitation, so the skip runs on to the meeting, the scan's beat, where his mind steps in", async () => {
    const { rig, chatId, day, at } = await portAlder();
    const meet = at(day + 1, "19:00");
    await marcusPlans(rig, chatId, [meet]);
    // The same span run whole, as a plain timelapse from the state the skip starts from: Marcus is
    // Live, so his plan asks the POV along in no invitation, and none stops the run.
    const start = await folded(rig, chatId);
    const run = readRun(await rig.host.chats.chatMetadata(chatId, rig.host.userId));
    if (!run) throw new Error("no run");
    const whole = new Working(rig.rt.registry, start.world, start.state);
    turnStart(rig.rt.registry, whole, run.runSeed);
    const plain = runTimelapse(rig.rt.registry, whole, { type: "duration", minutes: 3 * 1440 }, { runSeed: run.runSeed });
    if ("code" in plain) throw new Error(plain.reason);
    expect(whole.events.some((e) => e.type === "castlife.invitation")).toBe(false);
    expect(plain.summary.stoppedBy).not.toBe("invitation");
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, (who, when) => who === MARCUS && when === meet);
    await skipDays(rig, chatId, 3, {});
    const first = await folded(rig, chatId);
    const skip = ofType(first.record?.events, "minds.skip")[0];
    expect(skip && "data" in skip ? skip.data.beats : null).toEqual(expect.arrayContaining([expect.objectContaining({ at: meet, source: "scan" })]));
    expect(calls.some((c) => c.at === meet && c.who.includes(MARCUS))).toBe(true);
    expect(first.record?.events.find((e) => e.type === "timelapse")).toMatchObject({ stoppedBy: "mind", mind: MARCUS, to: meet });
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
    // Every mind's call fails, so no beat records a mind.
    const calls: { at: number; reason: string }[] = [];
    rig.rt.beatMinds = async (input) => {
      calls.push({ at: input.moment.at, reason: input.moment.reason });
      return { events: [], traces: [] };
    };
    // The same span run whole, as a plain timelapse from the state the skip starts from, under the same cap.
    const start = await folded(rig, chatId);
    const run = readRun(await rig.host.chats.chatMetadata(chatId, rig.host.userId));
    if (!run) throw new Error("no run");
    const whole = new Working(rig.rt.registry, start.world, start.state);
    turnStart(rig.rt.registry, whole, run.runSeed);
    const plain = runTimelapse(rig.rt.registry, whole, { type: "duration", minutes: 3 * 1440 }, { runSeed: run.runSeed, overrides: { invitation: "note" } });
    if ("code" in plain) throw new Error(plain.reason);
    await skipDays(rig, chatId, 3);
    const { state, record } = await folded(rig, chatId);
    expect(record?.events.find((e) => e.type === "timelapse")).toMatchObject({ to: plain.summary.to });
    expect(state.clock).toBe(plain.summary.to);
    // Whoever was asked at the skip's end was asked there.
    for (const call of calls.filter((c) => c.reason.startsWith("The time skip ends"))) expect(call.at).toBe(plain.summary.to);
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

  test("the skip step's call is listed in the Context panel's minds calls, as the step alone, with no text", async () => {
    const { rig, chatId } = await portAlder();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { skip: { enabled: true, signals: ["always"] } } } } }));
    rig.host.quietReply = (req) => (req.messages.some((m) => m.content.includes("skipping ahead in time")) ? JSON.stringify({ beats: [] }) : "{}");
    rig.rt.beatMinds = fakeMinds([], () => false);
    await skipDays(rig, chatId, 1);
    const context = decodeContextView((await rig.rt.view(chatId, rig.host.userId)).panels["core.context"]);
    const calls = context?.generations[0]?.minds ?? [];
    expect(calls.filter((m) => m.purpose === "skip")).toEqual([expect.objectContaining({ purpose: "skip", phase: "skip", who: "", level: null, outcome: "recorded", prompt: "default" })]);
  });

  test("when the engine run's clock runs out during a skip, the run stops: nothing is generated, the clock stays, and the flag says so, with a Retry", async () => {
    const { rig, chatId, day, at } = await portAlder();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { timeouts: { engineRunMs: 1000 } } }));
    await marcusPlans(rig, chatId, [at(day + 1, "19:00"), at(day + 2, "19:00")]);
    rig.rt.beatMinds = fakeMinds([], () => false, true);
    const before = (await folded(rig, chatId)).state.clock;
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 3 * 1440 }, overrides: { invitation: "note" } }, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect(rig.host.restarts).toEqual([]);
    expect(rig.host.chat(chatId).messages.at(-1)?.isUser).toBe(true);
    expect((await folded(rig, chatId)).state.clock).toBe(before);
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect(flag?.detail).toMatch(/^Time limit: Engine run ran out after 1 s/);
    expect(flag?.actions.map((a) => a.label)).toEqual(["Retry", "Diagnostics"]);
  });

  test("a clock already out before the first beat still takes the skip to that beat, so its Continue gets further", async () => {
    const { rig, chatId, day, at } = await portAlder();
    await marcusPlans(rig, chatId, [at(day + 1, "19:00")]);
    const { state, world } = await folded(rig, chatId);
    const settings = await rig.rt.settings.get(rig.host.userId);
    const target = { type: "duration" as const, minutes: 3 * 1440 };
    const asked: number[] = [];
    const skip = await runSkip({ registry: rig.rt.registry, steps: rig.rt.steps, minds: async (input) => (asked.push(input.moment.at), { events: [], traces: [] }), host: rig.host }, { chatId, userId: rig.host.userId, world, state, intent: { ...timelapseIntent(target, { invitation: "note" }) }, runSeed: "seed", settings, signal: AbortSignal.abort() });
    if (!skip) throw new Error("no skip");
    const beats = skip.record.beats.map((b) => b.at);
    expect(skip.record.stop).toEqual({ by: "clock", at: beats[1] ?? NaN });
    expect(beats[1]).toBeGreaterThan(state.clock);
    expect(asked).toEqual([]);
    // The plan replays it there, and offers the rest.
    const w = new Working(rig.rt.registry, world, state);
    turnStart(rig.rt.registry, w, "seed");
    const out = replaySkip(rig.rt.registry, w, target, skip.record, { runSeed: "seed", overrides: { invitation: "note" } });
    if ("code" in out) throw new Error(out.reason);
    expect(out.summary.to).toBe(beats[1] ?? NaN);
    expect(out.chip).toEqual({ kind: "continue_timelapse", target: { type: "duration", minutes: state.clock + target.minutes - (beats[1] ?? 0) }, remaining: state.clock + target.minutes - (beats[1] ?? 0) });
  });

  test("no skip runs while a fight holds the clock: no one is asked, and the turn notes why", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    rig.host.quietReply = plainly;
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    // The Modern profile brings combat.
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "modern", choices: {} }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const { state, world } = await folded(rig, chatId);
    const cal = calendarOf(world);
    await marcusPlans(rig, chatId, [clockAt(cal, dateAt(cal, state.clock).dayIndex + 1, 19 * 60)]);
    // The player character is made too tough for one round of Danny's blows to put down.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "pov", field: "con", value: 30 }] }));
    rig.body(await rig.send({ type: "lre.action", chatId, action: "fight", params: { target: "danny_okafor" }, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Danny squares up to you.");
    const before = (await folded(rig, chatId)).state.clock;
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, () => false);
    await skipDays(rig, chatId, 2);
    const after = await folded(rig, chatId);
    expect(calls).toEqual([]);
    expect(JSON.stringify(after.record?.events)).toContain("Timelapse not run: a fight is under way");
    expect(after.record?.events.some((e) => e.type === "minds.skip" || e.type === "timelapse")).toBe(false);
    expect(after.state.clock).toBe(before);
  });

  test("the minds at a skip's end are the turn's own: a model's interrupt there is no stop and isn't recorded", async () => {
    const { rig, chatId } = await portAlder();
    // No beats: only the end's minds think, through the real runner, each answering with an interrupt.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { skip: { maxBeats: 0 } } } }));
    rig.host.quietReply = (req) => {
      const mind = /You are the private mind of (.+?) in the roleplay world/.exec(req.messages[0]?.content ?? "")?.[1];
      return mind ? JSON.stringify({ monologue: `${mind} has had enough.`, depiction: "restless", intent: "Go and find Jordan.", reactions: [], plans: [], mood: null, interrupt: { reason: `${mind} comes looking for Jordan.` } }) : "{}";
    };
    await skipDays(rig, chatId, 1);
    const { record } = await folded(rig, chatId);
    const minds = ofType(record?.events, "minds.mind").flatMap((e) => ("data" in e ? [e.data] : []));
    expect(minds.length).toBeGreaterThan(0);
    expect(minds.map((m) => [m.moment, m.interrupt])).toEqual(minds.map(() => ["turn", null]));
    expect(record?.events.find((e) => e.type === "timelapse")).toMatchObject({ stoppedBy: null });
  });

  test("of the minds interrupting at a beat, only the one that stops the skip is recorded as stepping in", async () => {
    const { rig, chatId, day, at } = await portAlder();
    const meet = at(day + 1, "19:00");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: MARCUS, level: "live" }, { op: "mind_memory", entity: MARCUS, part: "plan", id: null, value: { what: "Talk to Jordan and Danny", kind: "meet", when: { from: meet, to: meet + 60 }, with: ["pov", "danny_okafor"], priority: 4 } }] }));
    const calls: { at: number; who: string[]; reason: string }[] = [];
    rig.rt.beatMinds = fakeMinds(calls, (_who, when) => when === meet);
    await skipDays(rig, chatId, 3);
    const { record } = await folded(rig, chatId);
    expect(calls.find((c) => c.at === meet)?.who).toEqual(expect.arrayContaining([MARCUS, "danny_okafor"]));
    const summary = record?.events.find((e) => e.type === "timelapse");
    expect(summary).toMatchObject({ stoppedBy: "mind", to: meet });
    const stopper = summary?.type === "timelapse" ? summary.mind : undefined;
    expect(stopper).toBeDefined();
    const interrupting = ofType(record?.events, "minds.mind").flatMap((e) => ("data" in e && e.data.interrupt !== null ? [e.data.entity] : []));
    expect(interrupting).toEqual([stopper ?? ""]);
  });

  // Decision (issue #48, routine roles): the Live and Near cast's routine is informative by default, so
  // no skip moves them by it any more, whether or not the POV has left them; this replaces the earlier
  // rule that released them to their routine once the POV was gone.
  test("in a skip the cast the story is about stays where the story has them, the POV gone or not (§8 routine roles)", async () => {
    const { rig, chatId } = await portAlder();
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: DANNY, level: "live" }, { op: "mind_pin", entity: MARCUS, level: "near" }] }));
    const { state, world } = await folded(rig, chatId);
    const home = placeOfEntity(state, world.pov);
    const marcus = placeOfEntity(state, MARCUS);
    expect(placeOfEntity(state, DANNY)).toBe(home);
    // Under the world's own interrupts, where an arrival stops a skip.
    const lapse = (povRoutine: boolean): { w: Working; stoppedBy: string | null } => {
      const w = new Working(rig.rt.registry, world, state);
      turnStart(rig.rt.registry, w, "seed");
      const out = runTimelapse(rig.rt.registry, w, { type: "duration", minutes: 4 * 60 }, { runSeed: "seed", ...(povRoutine ? {} : { povRoutine: false }) });
      if ("code" in out) throw new Error(out.reason);
      return { w, stoppedBy: out.summary.stoppedBy };
    };
    // A Timelapse that follows the POV's routine takes it to the garage; Danny, left behind, and
    // Marcus, at his own home, stay where they are, their levels read again at each step, no mind asked.
    const { w: palette, stoppedBy } = lapse(true);
    expect([world.pov, DANNY, MARCUS].map((who) => placeOfEntity(palette.state, who))).toEqual(["alder_automotive", home, marcus]);
    expect(stoppedBy).toBeNull();
    expect(palette.events.some((e) => e.type === "minds.mind")).toBe(false);
    // One that holds the POV at home: everyone stays.
    const held = lapse(false).w;
    expect([world.pov, DANNY, MARCUS].map((who) => placeOfEntity(held.state, who))).toEqual([home, home, marcus]);
  });
});

describe("the beat scan and the beats cap", () => {
  test("the scan finds the player character's appointments, the story's moments and their money, up to where the skip would end", () => {
    const reg = createRegistry(ALL_PACKS);
    // Riverton, from Friday 16 October 2026 at 07:30: a time rule, three appointments, one in the span,
    // and the player character's Friday coffee at the café, where its quest's first stage is met.
    const world = modernUsWorld("w", "R");
    const cal = calendarOf(world);
    world.rules.siren = { id: "siren", on: { at: "hour >= 18" }, do: [{ type: "signal", args: { class: "incident", text: "A siren wails." } }], once: true, interrupt: true };
    world.routines = { coffee: { id: "coffee", owner: "you", blocks: [{ id: "coffee", label: "Coffee with the neighbors", activity: "socialize", kind: "fixed", at: "17:00", minutes: 90, days: { weekdays: [5] }, place: { place: "cafe" } }] } };
    const you = world.entities.you;
    if (!you) throw new Error("no POV");
    you.fields.appointments = ["2026-10-16T06:00", "2026-10-19T15:00", "2026-11-05T10:00"].map((at, i) => ({ at: clockOfLocal(cal, at), minutes: 60, place: "park", label: ["Before", "Dentist", "After"][i] ?? "" }));
    const state = startState(world);
    const found = (overrides?: Record<string, string>): string[][] => {
      const scan = scanBeats(reg, world, state, timelapseIntent({ type: "duration", minutes: 19 * 1440 }, overrides), "seed");
      if (!scan) throw new Error("no scan");
      expect([scan.from, scan.to]).toEqual([state.clock, state.clock + 19 * 1440]);
      return [...scan.beats].sort((a, b) => a.at - b.at || a.reason.localeCompare(b.reason)).map((b) => [formatStamp(cal, b.at, 0), b.reason]);
    };
    // Run whole, every class only noting: the rule and the quest's stage, the appointment in the span, and the card's bills.
    expect(found(ALL_NOTE)).toEqual([
      ["2026-10-16 18:00", "a story moment: Settle in"],
      ["2026-10-16 18:00", "the rule siren"],
      ["2026-10-19 15:00", "the player character's appointment: Dentist"],
      ["2026-11-01 09:00", "the player character's money: Insurance: Pickup truck: $225.00 paid."],
      ["2026-11-03 08:30", "the player character's money: Visa card statement: $380.00; minimum $35.00 due 28 Nov."],
    ]);
    // Under the world's own policy the quest's stage stops it that evening, so nothing after is a beat.
    expect(found()).toEqual([
      ["2026-10-16 18:00", "a story moment: Settle in"],
      ["2026-10-16 18:00", "the rule siren"],
    ]);
  });

  test("a plan with the player character that a mind made in an older chat is no beat; the GM's is", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = modernUsWorld("w", "R");
    const cal = calendarOf(world);
    const s0 = startState(world);
    const meet = clockAt(cal, dateAt(cal, s0.clock).dayIndex + 1, 19 * 60);
    const plan = (source: MindPlan["source"]): JsonObject => ({ id: "p1", what: "Talk to the player character about the audit", kind: "meet", when: { from: meet, to: meet + 60 }, where: null, with: ["you"], priority: 5, status: "open", made: s0.clock, source, closed: null, reason: null });
    const planBeats = (events: LedgerEvent[]): string[] => {
      const state = fold(reg, world, s0, [{ type: "minds.pin", data: { entity: "jordan", level: "live" } }, ...events]);
      const scan = scanBeats(reg, world, state, timelapseIntent({ type: "duration", minutes: 2 * 1440 }, ALL_NOTE), "seed");
      if (!scan) throw new Error("no scan");
      return scan.beats.filter((b) => b.reason.includes("plan with the player character")).map((b) => `${formatStamp(cal, b.at, 0)} ${b.who.join(",")}`);
    };
    // As an older chat's ledger holds it: the mind's answer carried its own plan.
    const old: LedgerEvent[] = [
      { type: "minds.round", data: { at: s0.clock, on: true } },
      { type: "minds.mind", data: { entity: "jordan", at: s0.clock, place: null, level: "live", moment: "turn", reason: "live", monologue: "m", depiction: "d", intent: "i", reactions: [], plans: [plan("mind")], mood: null, interrupt: null, withheld: false } },
    ];
    expect(planBeats(old)).toEqual([]);
    expect(planBeats([{ type: "minds.plan_edit", data: { entity: "jordan", plan: "p1", value: plan("gm") } }])).toEqual([`${formatStamp(cal, meet, 0)} jordan`]);
  });

  test("after the clock's ✎ set it back, the scan finds no beat up to where it had stood: no mind thinks there again (L48)", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = modernUsWorld("w", "R");
    const cal = calendarOf(world);
    const you = world.entities.you;
    if (!you) throw new Error("no POV");
    you.fields.appointments = [{ at: clockOfLocal(cal, "2026-10-19T15:00"), minutes: 60, place: "park", label: "Dentist" }];
    const fixed = (state: WorldState, at: string): WorldState => {
      const fix = clockFix(reg, world, state, at, "seed");
      if ("code" in fix) throw new Error(fix.reason);
      return fold(reg, world, state, fix.events);
    };
    const start = startState(world);
    const back = fixed(fixed(start, "2026-10-20 00:00"), "2026-10-16 07:30");
    const scan = scanBeats(reg, world, back, timelapseIntent({ type: "duration", minutes: 19 * 1440 }, ALL_NOTE), "seed");
    if (!scan) throw new Error("no scan");
    const mark = clockOfLocal(cal, "2026-10-20T00:00");
    expect([scan.from, scan.after]).toEqual([back.clock, mark]);
    expect(scan.beats.length).toBeGreaterThan(0);
    expect(scan.beats.filter((b) => b.at <= mark || b.reason.includes("Dentist"))).toEqual([]);
  });

  test("the cap keeps the weightiest beats, earliest first among equals, each minute's beats as one, in time order", () => {
    const beat = (at: number, rank: number, reason: string, source: Beat["source"] = "scan", who: string[] = []): Beat => ({ at, reason, source, who, rank });
    const beats = [
      beat(50, 6, "the step's", "model"),
      beat(10, 5, "money"),
      beat(40, 1, "Maya's plan", "scan", ["maya"]),
      beat(20, 3, "an appointment"),
      beat(40, 6, "a model's at the same minute", "model", ["jordan", "maya"]),
      beat(30, 2, "Rosa's invitation", "scan", ["rosa"]),
      beat(60, 4, "a story moment"),
      beat(70, 4, "a later story moment"),
      beat(50, 6, "the step's again", "model", ["rosa"]),
    ];
    expect(capBeats(beats, 4)).toEqual([
      beat(20, 3, "an appointment"),
      beat(30, 2, "Rosa's invitation", "scan", ["rosa"]),
      beat(40, 1, "Maya's plan", "scan", ["maya", "jordan"]),
      beat(60, 4, "a story moment"),
    ]);
    expect(capBeats(beats, Infinity)).toEqual([
      beat(10, 5, "money"),
      beat(20, 3, "an appointment"),
      beat(30, 2, "Rosa's invitation", "scan", ["rosa"]),
      beat(40, 1, "Maya's plan", "scan", ["maya", "jordan"]),
      beat(50, 6, "the step's", "model", ["rosa"]),
      beat(60, 4, "a story moment"),
      beat(70, 4, "a later story moment"),
    ]);
    expect(capBeats(beats, 0)).toEqual([]);
  });
});
