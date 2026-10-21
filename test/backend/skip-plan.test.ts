// The model's skip plan (#53): as a timelapse starts, one helper call plans the informative people
// whose skip the model plans; its checked answer is recorded as `castlife.skip_plan` ahead of the
// timelapse, in the same swipe. Blocks that don't hold are dropped, a failed call plans no one and
// leaves a note, a Continue inside the planned span asks nothing, and no one to plan means no call.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { planSkip, SKIP_PLAN_SYSTEM } from "../../src/backend/skip-plan";
import { CallMeter, Steps } from "../../src/backend/steps";
import { calendarOf, clockOfStamp, formatStamp } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { ROUTINE_EVENTS, type SkipPlan } from "../../src/shared/routines";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { FakeHost } from "../support/fake-host";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
const INTERPRET_MARK = "You map a player's typed input";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };
const isPlanCall = (req: QuietRequest): boolean => (req.messages[0]?.content ?? "").includes(SKIP_PLAN_SYSTEM);
const block = (start: string, end: string, place: string, label = "Checks the moorings"): JsonObject => ({ label, start, end, place, activity: "work" });
/** Danny's skip is the model's to plan: his routine informative, his skip life `model`. */
const follow = (skips: "model" | "stay"): LedgerEvent => ({ type: ROUTINE_EVENTS.follow, data: { entity: "danny_okafor", follow: { mode: null, awareness: null, role: "informative", skips } } });

// ---------------------------------------------------------------- through the whole backend

/** A Port Alder chat after one ordinary turn, with Danny's skip planned by the model; `plan` answers the skip plan call. */
async function alder(plan: (req: QuietRequest) => string): Promise<{ rig: Rig; chatId: string; calls: () => number }> {
  const rig = new Rig({ shipped: true });
  let calls = 0;
  rig.host.quietReply = (req: QuietRequest) => {
    if (isPlanCall(req)) {
      calls++;
      return plan(req);
    }
    return (req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify(NONE) : "{}";
  };
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "routine_follow", entity: "danny_okafor", role: "informative", skips: "model" }] }));
  return { rig, chatId, calls: () => calls };
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

/** Two hours from the palette's Timelapse. */
async function lapse(rig: Rig, chatId: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 120 } }, source: "palette" }));
  const g = await rig.host.start(chatId, { type: "normal" });
  await rig.host.finish(g, "Two hours go by.");
}

describe("a timelapse with someone the model plans", () => {
  test("one call plans them, and its blocks are recorded ahead of the timelapse in the same swipe", async () => {
    let span: { from: number; to: number } = { from: 0, to: 0 };
    let cal = calendarOf(STARTER_WORLDS.modern_slice_of_life!("w", "Port Alder"));
    const { rig, chatId, calls } = await alder(() => JSON.stringify({ plans: [{ entity: "danny_okafor", blocks: [block(formatStamp(cal, span.from + 15), formatStamp(cal, span.from + 75), "alder_harbor_marina")] }] }));
    const before = await folded(rig, chatId);
    cal = calendarOf(before.world);
    span = { from: before.state.clock, to: before.state.clock + 120 };
    await lapse(rig, chatId);
    const { events } = await folded(rig, chatId);
    expect(calls()).toBe(1);
    const at = events.findIndex((e) => e.type === ROUTINE_EVENTS.skipPlan);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(events.findIndex((e) => e.type === "timelapse"));
    expect(events[at]).toMatchObject({ data: { from: span.from, to: span.to, plans: [{ entity: "danny_okafor", blocks: [{ start: span.from + 15, end: span.from + 75, place: "alder_harbor_marina", activity: "work" }] }] } });
  });

  test("a call that fails plans no one and leaves a note, and the skip still runs", async () => {
    const { rig, chatId, calls } = await alder(() => {
      throw new Error("the provider refused");
    });
    const before = await folded(rig, chatId);
    await lapse(rig, chatId);
    const { events, state } = await folded(rig, chatId);
    expect(calls()).toBeGreaterThanOrEqual(1);
    const plan = events.find((e) => e.type === ROUTINE_EVENTS.skipPlan);
    expect(plan).toMatchObject({ data: { plans: [], note: expect.any(String) } });
    expect(events.find((e) => e.type === "timelapse")).toMatchObject({ from: before.state.clock, to: before.state.clock + 120 });
    expect(state.clock).toBe(before.state.clock + 120);
  });
});

// ---------------------------------------------------------------- the planner on its own

/** Port Alder on its first Monday at 06:27, with `events` applied (Danny's follow, an earlier plan). */
function monday(events: LedgerEvent[]): { world: WorldDoc; state: WorldState; stamp: (minutes: number) => string } {
  const world = STARTER_WORLDS.modern_slice_of_life!("w", "Port Alder");
  const cal = calendarOf(world);
  const state = startState(world, reg);
  state.clock = clockOfStamp(cal, "2026-09-14 06:27") ?? 0;
  const w = new Working(reg, world, state);
  w.applyAll(events);
  const start = w.state.clock;
  return { world, state: w.state, stamp: (minutes) => formatStamp(cal, start + minutes) };
}

/** `planSkip` over two hours from `state`, the model answering `answer`; the event and how many calls it made. */
async function plan(world: WorldDoc, state: WorldState, answer: JsonObject): Promise<{ event: LedgerEvent | null; calls: number }> {
  const host = new FakeHost();
  let calls = 0;
  host.quietReply = (req) => {
    if (isPlanCall(req)) calls++;
    return JSON.stringify(answer);
  };
  const intent = { action: "timelapse", params: { target: { type: "duration", minutes: 120 } }, probabilities: { timelapse: 1 } };
  const event = await planSkip({ registry: reg, steps: new Steps(host, new CallMeter()), log: () => {} }, { userId: host.userId, world, state, intent, runSeed: "seed", reply: "", journal: [], signal: new AbortController().signal, limit: 60_000 });
  return { event, calls };
}

const plannedOf = (event: LedgerEvent | null): SkipPlan["plans"] => (event && "data" in event ? (event.data as unknown as SkipPlan).plans : []);

describe("the skip plan's checks", () => {
  test("a block at a place it wasn't offered, or outside the skip, is dropped", async () => {
    const { world, state, stamp } = monday([follow("model")]);
    const { event } = await plan(world, state, { plans: [{ entity: "danny_okafor", blocks: [block(stamp(10), stamp(40), "alder_harbor_marina"), block(stamp(50), stamp(70), "nowhere_at_all"), block(stamp(100), stamp(200), "bluebird_coffee")] }] });
    expect(plannedOf(event)).toEqual([{ entity: "danny_okafor", blocks: [expect.objectContaining({ start: state.clock + 10, end: state.clock + 40, place: "alder_harbor_marina" })] }]);
  });

  test("a label naming a place the player character can't see is dropped", async () => {
    const { world, state, stamp } = monday([follow("model")]);
    const { event } = await plan(world, state, { plans: [{ entity: "danny_okafor", blocks: [block(stamp(10), stamp(40), "alder_harbor_marina", "Slips over to 12 Birch Lane"), block(stamp(50), stamp(90), "alder_harbor_marina")] }] });
    expect(plannedOf(event)).toEqual([{ entity: "danny_okafor", blocks: [expect.objectContaining({ start: state.clock + 50, end: state.clock + 90 })] }]);
  });

  test("a Continue inside the planned span asks nothing", async () => {
    const start = monday([]).state.clock;
    const earlier: LedgerEvent = { type: ROUTINE_EVENTS.skipPlan, data: { from: start, to: start + 240, plans: [] } };
    const { world, state } = monday([follow("model"), earlier]);
    const { event, calls } = await plan(world, state, { plans: [] });
    expect(event).toBeNull();
    expect(calls).toBe(0);
  });

  test("no one whose skip the model plans means no call", async () => {
    const { world, state } = monday([follow("stay")]);
    const { event, calls } = await plan(world, state, { plans: [] });
    expect(event).toBeNull();
    expect(calls).toBe(0);
  });
});
