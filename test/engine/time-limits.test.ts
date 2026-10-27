// Hard maxima for time controls and realism levels. A timelapse past the reach runs one reach at a
// time and offers to carry on, and a narrated skip past it is offered; an oversized unit cap still
// ends a segment at the ceiling; a malformed document starts inside the bounds.
import { describe, expect, test } from "bun:test";
import { applyTimeAdvance, resolveTarget, runTimelapse, tickMinutes } from "../../src/engine/time";
import { clampLevel, clampScale, clampTick, clampUnitCap, TIME_LIMITS } from "../../src/engine/time-limits";
import { Working } from "../../src/engine/working";
import { MINUTES_PER_DAY } from "../../src/engine/calendar";
import { baseWorld, registryOf, startState } from "../packs/support";

const reg = registryOf();

describe("time limits", () => {
  test("a 1e7-minute timelapse runs one reach at a time and offers to carry on; told, it is offered whole and runs nothing", () => {
    const world = baseWorld();
    const w = new Working(reg, world, startState(world));
    const clock = w.state.clock;
    expect(runTimelapse(reg, w, { type: "duration", minutes: Number.POSITIVE_INFINITY }, { runSeed: "x" })).toMatchObject({ code: "past" });
    const far = resolveTarget(reg, world, w.state, { type: "duration", minutes: 1e7 });
    if ("code" in far) throw new Error(far.reason);
    expect(far.goal).toBeGreaterThanOrEqual(clock + 1e7);
    expect(far.to - clock).toBeLessThanOrEqual(TIME_LIMITS.timelapseMinutes);
    const run = runTimelapse(reg, w, { type: "duration", minutes: 1e7 }, { runSeed: "x", unitCap: { agentDays: 1, events: 5000 } });
    if ("code" in run) throw new Error(run.reason);
    expect(run.result.to).toBeGreaterThan(clock);
    expect(run.remaining).toBe((far.goal ?? 0) - run.result.to);
    expect(run.chip).toMatchObject({ kind: "continue_timelapse", target: { type: "duration", minutes: run.remaining } });
    const told = new Working(reg, world, startState(world));
    expect(applyTimeAdvance(reg, told, 1e7, { runSeed: "x", capMinutes: 240 })).toMatchObject({ applied: false, reason: "over_cap", chip: { kind: "timelapse_offer", target: { type: "duration", minutes: 1e7 } } });
    expect(told.state.clock).toBe(clock);
    expect(told.events).toEqual([]);
  });

  test("an oversized unit cap, from the state or the request, still ends a segment at the ceiling", () => {
    const world = baseWorld();
    world.rules.chatter = { id: "chatter", on: { tick: "slot" }, do: Array.from({ length: 40 }, (_, i) => ({ type: "note", args: { text: `note ${i}` } })) };
    const w = new Working(reg, world, startState(world));
    w.state.time.unitCap = { agentDays: 1e9, events: 1e9 };
    const r = runTimelapse(reg, w, { type: "duration", minutes: 120 * MINUTES_PER_DAY }, { runSeed: "x", unitCap: { agentDays: 1e9, events: 1e9 } });
    if ("code" in r) throw new Error(r.reason);
    expect(r.result.stop).toBe("cap");
    expect(r.result.events).toBeLessThanOrEqual(TIME_LIMITS.unitCap.events);
    expect(r.result.agentDays).toBeLessThanOrEqual(TIME_LIMITS.unitCap.agentDays);
    expect(r.chip?.kind).toBe("continue_timelapse");
  });

  test("a malformed document starts inside the bounds: levels, ticks, scale, thresholds and the unit cap", () => {
    const world = baseWorld();
    const levels: Record<string, unknown> = world.realism.levels;
    levels.money = 9;
    levels.gear = -3;
    levels.vehicles = 2.6;
    levels.castlife = "max";
    world.time.unitCap = { agentDays: 1e9, events: 1e9 };
    world.time.sceneTicks.conversation = 1e9;
    world.time.speedThrough.sleep = { mode: "offer", thresholdMinutes: 1e9 };
    const state = startState(world);
    expect([state.realism.levels.money, state.realism.levels.gear, state.realism.levels.vehicles, state.realism.levels.castlife]).toEqual([4, 0, 3, 0]);
    expect(state.time.unitCap).toEqual({ agentDays: 600, events: 5000 });
    expect(state.time.sceneTicks.conversation).toBe(TIME_LIMITS.tickMinutes);
    expect(state.time.speedThrough.sleep?.thresholdMinutes).toBe(TIME_LIMITS.thresholdMinutes[1]);
    state.time.scale = 1e6;
    expect(tickMinutes(world, state)).toBeLessThanOrEqual(TIME_LIMITS.tickMinutes);
    const atOne = tickMinutes(world, { ...state, time: { ...state.time, scale: 1 } });
    state.time.scale = Number.NaN;
    expect(tickMinutes(world, state)).toBe(atOne);
  });

  test("the clamps", () => {
    expect(clampUnitCap({ agentDays: Number.NaN, events: -5 })).toEqual({ agentDays: 600, events: 1 });
    expect(clampUnitCap(undefined)).toEqual({ agentDays: 600, events: 5000 });
    expect(clampUnitCap({ agentDays: 0.5, events: 40 })).toEqual({ agentDays: 0.5, events: 40 });
    expect([clampTick(-1), clampTick(1e9), clampTick("x"), clampTick(10)]).toEqual([0, 1440, 2, 10]);
    expect([clampScale(0), clampScale(100), clampScale(0.01), clampScale(2)]).toEqual([1, 10, 0.25, 2]);
    expect([clampLevel(5), clampLevel(-1), clampLevel(1.4), clampLevel(null)]).toEqual([4, 0, 1, 0]);
  });
});
