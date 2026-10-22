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
import { ROUTINE_EVENTS, routineSettingsOf, type SkipPlan, type SkipPlanCalls } from "../../src/shared/routines";
import { DEFAULT_MIND_READS } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { FakeHost } from "../support/fake-host";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";
import { held, pin, whereabouts } from "../packs/castlife/town";
import { skipLifeOf } from "../../src/packs/castlife/core/routines";
import { livesPlans } from "../../src/packs/castlife/core/commitments";

const reg = createRegistry(ALL_PACKS);
const INTERPRET_MARK = "You map a player's typed input";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };
const isPlanCall = (req: QuietRequest): boolean => (req.messages[0]?.content ?? "").includes(SKIP_PLAN_SYSTEM);
const block = (start: string, end: string, place: string, label = "Checks the moorings"): JsonObject => ({ label, start, end, place, activity: "work" });
/** Danny's skip is the model's to plan: his routine informative, his skip life `model`. */
const follow = (skips: "model" | "stay"): LedgerEvent => ({ type: ROUTINE_EVENTS.follow, data: { entity: "danny_okafor", follow: { mode: null, awareness: null, role: "informative", skips } } });

// ---------------------------------------------------------------- through the whole backend

/** A Port Alder chat after one ordinary turn, with Danny's skip planned by the model; `plan` answers the skip plan call, and `setup` edits the world first. */
async function alder(plan: (req: QuietRequest) => string, setup?: (rig: Rig, worldId: string) => Promise<void>): Promise<{ rig: Rig; chatId: string; calls: () => number }> {
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
  if (setup) {
    await setup(rig, worldId);
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
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
  rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 120 } }, source: "palette", now: true }));
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

  /** The part of a plan call's input under `title`, which runs to the next blank line. */
  const partOf = (prompt: string, title: string): string => prompt.split("\n\n").find((part) => part.startsWith(`${title}\n`)) ?? "";

  test("the lore pinned to the time-skip step reaches the plan's input, read as no one, so a secret entry pinned there stays out", async () => {
    let prompt = "";
    const { rig, chatId } = await alder(
      (req) => {
        prompt = req.messages[1]?.content ?? "";
        return JSON.stringify({ plans: [] });
      },
      async (rig, worldId) => {
        const put = async (id: string, value: JsonObject) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id, value }));
        await put("ferry_week", { id: "ferry_week", title: "Ferry week", content: "FERRY-MARK: the ferry runs late all week.", keys: [], links: [] });
        await put("marina_debt", { id: "marina_debt", title: "The marina debt", content: "DEBT-MARK: Danny owes the marina.", keys: [], links: [], secret: true, gate: "false", audience: [] });
        rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: {}, places: {}, steps: { skip: [{ lore: "ferry_week" }, { lore: "marina_debt" }] } } }));
      },
    );
    await lapse(rig, chatId);
    const pinned = partOf(prompt, "Pinned lore:");
    expect(pinned).toContain("FERRY-MARK: the ferry runs late all week.");
    expect(prompt).not.toContain("DEBT-MARK");
  });

  test("Recent chat reaches the plan's input while minds read it: the chat before the skip's turn, less the latest reply it reads already; off by default, none", async () => {
    let prompt = "";
    const { rig, chatId } = await alder((req) => {
      prompt = req.messages[1]?.content ?? "";
      return JSON.stringify({ plans: [] });
    });
    await lapse(rig, chatId);
    expect(prompt).not.toContain("Recent chat");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { history: { on: true } } } } }));
    await lapse(rig, chatId);
    const recent = partOf(prompt, "Recent chat (as the player sees it):").split("\n").slice(1);
    expect(recent).toEqual(expect.arrayContaining(["Player: I look around the shop.", "Story: The shop is quiet."]));
    expect(recent.indexOf("Player: I look around the shop.")).toBeLessThan(recent.indexOf("Story: The shop is quiet."));
    expect(partOf(prompt, "The latest reply:")).toBe("The latest reply:\nTwo hours go by.");
    expect(recent).not.toContain("Story: Two hours go by.");
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
  const event = await planSkip({ registry: reg, steps: new Steps(host, new CallMeter()), log: () => {}, host }, { chatId: "chat", userId: host.userId, world, state, intent, runSeed: "seed", reply: "", journal: [], reads: DEFAULT_MIND_READS, hideJson: true, signal: new AbortController().signal, limit: 60_000 });
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

  test("someone the engine lives no day for (no agent, as Jess, Nora and Helen) is never planned, and no call is made for them alone", async () => {
    const jess: LedgerEvent = { type: ROUTINE_EVENTS.follow, data: { entity: "jess_kowalczyk", follow: { mode: null, awareness: null, role: "informative", skips: "model" } } };
    const { world, state, stamp } = monday([jess]);
    const alone = await plan(world, state, { plans: [{ entity: "jess_kowalczyk", blocks: [block(stamp(10), stamp(40), "rusty_anchor", "Tends bar")] }] });
    expect([alone.event, alone.calls]).toEqual([null, 0]);
    // With Danny, an agent, planned too, only he is.
    const both = monday([jess, follow("model")]);
    const { event } = await plan(both.world, both.state, { plans: [{ entity: "jess_kowalczyk", blocks: [block(both.stamp(10), both.stamp(40), "rusty_anchor", "Tends bar")] }, { entity: "danny_okafor", blocks: [block(both.stamp(10), both.stamp(40), "alder_harbor_marina")] }] });
    expect(plannedOf(event).map((p) => p.entity)).toEqual(["danny_okafor"]);
  });

  test("a call that fails, times out or is cut off still sends each character whose skip the model plans home to sleep overnight", async () => {
    // Port Alder on Monday at 21:00: Marcus at the shop with the POV, Danny at the Anchor, both Far.
    const world = STARTER_WORLDS.modern_slice_of_life!("w", "Port Alder");
    const cal = calendarOf(world);
    const start = startState(world, reg);
    start.clock = clockOfStamp(cal, "2026-09-14 21:00") ?? 0;
    const w = new Working(reg, world, start);
    const put = (entity: string, place: string): LedgerEvent => ({ type: "set", entity, field: "place", value: place });
    w.applyAll([pin("marcus_delgado", "far"), pin("danny_okafor", "far"), put(world.pov, "alder_automotive"), put("marcus_delgado", "alder_automotive"), put("danny_okafor", "rusty_anchor")]);
    const host = new FakeHost();
    host.quietReply = () => {
      throw new Error("the provider refused");
    };
    const intent = { action: "timelapse", params: { target: { type: "duration", minutes: 7 * 60 } }, probabilities: { timelapse: 1 } };
    const event = await planSkip({ registry: reg, steps: new Steps(host, new CallMeter()), log: () => {}, host }, { chatId: "chat", userId: host.userId, world, state: w.state, intent, runSeed: "seed", reply: "", journal: [], reads: DEFAULT_MIND_READS, hideJson: true, signal: new AbortController().signal, limit: 60_000 });
    if (!event) throw new Error("no plan recorded");
    expect(plannedOf(event)).toEqual([]);
    w.applyAll([event]);
    const ctx = reg.context(world, w.state);
    const model = Object.keys(w.state.entities).filter((id) => livesPlans(ctx, id) && skipLifeOf(ctx, id) === "model");
    expect(model).toEqual(expect.arrayContaining(["danny_okafor", "marcus_delgado"]));
    held(w, clockOfStamp(cal, "2026-09-15 04:00") ?? 0);
    expect(model.map((id) => whereabouts(w, id))).toEqual(model.map((id) => [w.state.entities[id]?.fields.home, "sleep"]));
  });
});

// ---------------------------------------------------------------- one call, or one per person

/** Danny and Marcus, both agents, have their skip planned by the model; the world asks as `calls` says. */
function pair(calls: SkipPlanCalls) {
  const marcus: LedgerEvent = { type: ROUTINE_EVENTS.follow, data: { entity: "marcus_delgado", follow: { mode: null, awareness: null, role: "informative", skips: "model" } } };
  const m = monday([follow("model"), marcus]);
  const world: WorldDoc = { ...m.world, routineSettings: { ...routineSettingsOf(m.world), skipPlanCalls: calls } };
  return { ...m, world };
}

/** `planSkip` over two hours, each call answering for the people its own input names; `fails` names whose call fails. */
async function planEach(world: WorldDoc, state: WorldState, stamp: (minutes: number) => string, fails: readonly string[] = []): Promise<{ event: LedgerEvent | null; calls: string[][] }> {
  const host = new FakeHost();
  const calls: string[][] = [];
  const places: Record<string, string> = { danny_okafor: "alder_harbor_marina", marcus_delgado: "alder_automotive" };
  host.quietReply = (req) => {
    if (!isPlanCall(req)) return "{}";
    const user = req.messages[1]?.content ?? "";
    const named = Object.keys(places).filter((id) => user.includes(`(id ${id})`));
    calls.push(named);
    if (named.some((id) => fails.includes(id))) throw new Error("the provider refused");
    return JSON.stringify({ plans: named.map((id) => ({ entity: id, blocks: [block(stamp(10), stamp(40), places[id] ?? "")] })) });
  };
  const intent = { action: "timelapse", params: { target: { type: "duration", minutes: 120 } }, probabilities: { timelapse: 1 } };
  const event = await planSkip({ registry: reg, steps: new Steps(host, new CallMeter()), log: () => {}, host }, { chatId: "chat", userId: host.userId, world, state, intent, runSeed: "seed", reply: "", journal: [], reads: DEFAULT_MIND_READS, hideJson: true, signal: new AbortController().signal, limit: 60_000 });
  return { event, calls };
}

describe("how the skip plan asks", () => {
  test("together asks once, for everyone", async () => {
    const { world, state, stamp } = pair("together");
    const { event, calls } = await planEach(world, state, stamp);
    expect(calls).toEqual([["danny_okafor", "marcus_delgado"]]);
    expect(plannedOf(event).map((p) => p.entity).sort()).toEqual(["danny_okafor", "marcus_delgado"]);
  });

  test("parallel asks once per person, each told only of themselves, and merges their blocks into one plan", async () => {
    const { world, state, stamp } = pair("parallel");
    const { event, calls } = await planEach(world, state, stamp);
    expect(calls.map((c) => c.join()).sort()).toEqual(["danny_okafor", "marcus_delgado"]);
    expect(plannedOf(event).map((p) => [p.entity, p.blocks.map((b) => b.place)]).sort()).toEqual([
      ["danny_okafor", ["alder_harbor_marina"]],
      ["marcus_delgado", ["alder_automotive"]],
    ]);
  });

  test("a person whose call fails is left unplanned, the others keep their plans, and the note counts them", async () => {
    const { world, state, stamp } = pair("parallel");
    const { event } = await planEach(world, state, stamp, ["marcus_delgado"]);
    expect(plannedOf(event).map((p) => p.entity)).toEqual(["danny_okafor"]);
    const note = event && "data" in event ? event.data.note : undefined;
    expect(typeof note).toBe("string");
    expect(String(note)).toContain("1 of 2");
    expect(String(note)).not.toContain("Marcus");
  });
});
