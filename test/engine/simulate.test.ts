import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import type { PackDef } from "../../src/engine/registry";
import { advance, agentCursor, catchUp, coarsen, completedSlot } from "../../src/engine/simulate";
import type { WorldState } from "../../src/engine/state";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import { withoutAmbient } from "./support";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";

/** A world process (seeded weather, rare incidents) and an agent process (hunger, wandering, invitations). */
const simPack: PackDef = {
  id: "simtest",
  label: "Sim test",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.process({
      id: "simtest.weather",
      domain: "weather",
      minLevel: 1,
      step(slot, ctx, rng) {
        const out: LedgerEvent[] = [];
        for (const id of Object.keys(ctx.state.entities).sort()) {
          if (ctx.state.entities[id]?.kind !== "region") continue;
          const g = rng(id);
          out.push({ type: "set", entity: id, field: "weather", value: g.pick(["sun", "rain", "fog"]) });
          if (g.next() < 0.08) out.push({ type: "engine.signal", data: { class: "incident", text: `Storm damage at slot ${slot.index}` } });
        }
        return out;
      },
    });
    r.process({
      id: "simtest.life",
      domain: "castlife",
      minLevel: 1,
      scope: "agent",
      step(slot, ctx, rng, agent) {
        if (!agent) return [];
        const g = rng(agent);
        const out: LedgerEvent[] = [{ type: "add", entity: agent, field: "hunger", delta: g.int(1, 3) }];
        out.push({ type: "set", entity: agent, field: "place", value: g.pick(["home", "cafe"]) });
        if (agent !== ctx.world.pov && g.next() < 0.1) out.push({ type: "engine.signal", data: { class: "invitation", text: `${agent} invites you out (slot ${slot.index})`, entity: agent } });
        return out;
      },
    });
  },
};

function simWorld(): WorldDoc {
  const world = baseWorld();
  world.kinds.region = { id: "region", label: "Region", fields: { weather: { type: "text" } } };
  world.entities.north = { id: "north", kind: "region", name: "North", tier: "background", fields: {}, relations: [] };
  world.entities.ana = { id: "ana", kind: "person", name: "Ana", tier: "supporting", fields: { place: "home", home: "home" }, relations: [], agent: true };
  world.entities.bo = { id: "bo", kind: "person", name: "Bo", tier: "supporting", fields: { place: "cafe", home: "cafe" }, relations: [], agent: true };
  world.schedules.work = {
    id: "work",
    owner: "dev",
    target: "activity",
    recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] },
    slots: [{ start: "09:00", end: "17:00", value: "work_shift" }],
  };
  return world;
}

const allNote = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } as const;

function lapse(world: WorldDoc, state: WorldState, minutes: number, opts: { overrides?: Record<string, "stop" | "note" | "ignore">; unitCap?: { agentDays: number; events: number } } = {}) {
  const reg = registryOf([simPack]);
  const w = new Working(reg, world, state);
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "run-1", overrides: opts.overrides ?? allNote, ...(opts.unitCap ? { unitCap: opts.unitCap } : {}) });
  if ("code" in out) throw new Error(out.reason);
  return { w, out };
}

describe("simulation stepping", () => {
  test("skipping N days equals N one-day steps and any segmentation (L29)", () => {
    const world = simWorld();
    const s0 = startState(world);
    const whole = lapse(world, s0, 4 * 1440).w.state;
    let days = s0;
    for (let i = 0; i < 4; i++) days = lapse(world, days, 1440).w.state;
    let odd = s0;
    for (const m of [17, 1000, 333, 1440 * 2, 4 * 1440 - 17 - 1000 - 333 - 1440 * 2]) odd = lapse(world, odd, m).w.state;
    expect(hashJson(days)).toBe(hashJson(whole));
    expect(hashJson(odd)).toBe(hashJson(whole));
    expect(whole.clock).toBe(s0.clock + 4 * 1440);
    expect(whole.entities.ana?.fields.hunger).toBeGreaterThan(0);
  });

  test("the POV's own routine moves it only when time runs on its own; an ordinary turn leaves it to the player", () => {
    const world = simWorld();
    world.pov = "dev";
    const reg = registryOf([simPack]);
    const turn = new Working(reg, world, startState(world));
    advance(reg, turn, turn.state.clock + 3 * 1440, { runSeed: "r", mode: "turn" });
    expect(turn.events.some((e) => e.type === "set" && e.entity === "dev" && e.field === "activity")).toBe(false);
    const lapsed = new Working(reg, world, startState(world));
    advance(reg, lapsed, lapsed.state.clock + 3 * 1440, { runSeed: "r", mode: "timelapse", interrupts: allNote });
    expect(lapsed.events.some((e) => e.type === "set" && e.entity === "dev" && e.field === "activity" && e.value === "work_shift")).toBe(true);
  });

  test("timelapse events re-fold to the same state, raw and coarsened", () => {
    const world = simWorld();
    const s0 = startState(world);
    const { w } = lapse(world, s0, 3 * 1440);
    const reg = registryOf([simPack]);
    expect(hashJson(fold(reg, world, s0, w.events))).toBe(hashJson(w.state));
    const coarse = coarsen(reg, world, s0, w.events);
    expect(coarse.length).toBeLessThan(w.events.length);
    expect(hashJson(fold(reg, world, s0, coarse))).toBe(hashJson(w.state));
    // accumulators stay deltas after coarsening (L21)
    expect(coarse.some((e) => e.type === "set" && e.field === "hunger")).toBe(false);
  });

  test("interrupts stop deterministically at the slot's end; `note` keeps the earlier events", () => {
    const world = simWorld();
    const s0 = startState(world);
    const stop = { ...allNote, invitation: "stop" as const };
    const a = lapse(world, s0, 6 * 1440, { overrides: stop });
    const b = lapse(world, s0, 6 * 1440, { overrides: stop });
    expect(a.out.result.stop).toBe("interrupt");
    expect(a.out.result.stoppedBy).toBe("invitation");
    expect(a.out.result.to).toBe(b.out.result.to);
    expect(a.w.events).toEqual(b.w.events);
    const stoppedAt = a.out.result.to;
    expect((stoppedAt - (s0.clock - 8 * 60)) % 360).toBe(0); // on a slot boundary
    const noted = lapse(world, s0, 6 * 1440, { overrides: allNote });
    expect(noted.out.result.to).toBe(s0.clock + 6 * 1440);
    const prefix = a.w.events.filter((e) => e.type !== "timelapse" && e.type !== "engine.caught");
    const notedPrefix = noted.w.events.filter((e) => e.type !== "engine.caught").slice(0, prefix.length);
    expect(notedPrefix).toEqual(prefix);
    expect(noted.out.result.notes.some((n) => n.class === "invitation")).toBe(true);
  });

  test("the unit cap ends a segment on a slot boundary, always after at least one slot; segments compose", () => {
    const world = simWorld();
    const s0 = startState(world);
    const tiny = { agentDays: 0.01, events: 5000 };
    const first = lapse(world, s0, 2 * 1440, { unitCap: tiny });
    expect(first.out.result.stop).toBe("cap");
    expect(first.out.result.slots).toBe(1);
    expect(first.out.chip?.kind).toBe("continue_timelapse");
    let state = first.w.state;
    let remaining = first.out.remaining;
    let segments = 1;
    while (remaining > 0) {
      const next = lapse(world, state, remaining, { unitCap: tiny });
      expect(next.out.result.slots).toBeGreaterThanOrEqual(1);
      state = next.w.state;
      remaining = next.out.remaining;
      segments++;
    }
    expect(segments).toBeGreaterThan(5);
    expect(hashJson(state)).toBe(hashJson(lapse(world, s0, 2 * 1440).w.state));
  });

  test("the event cap rolls back the slot that would exceed it", () => {
    const world = simWorld();
    const s0 = startState(world);
    const { out, w } = lapse(world, s0, 2 * 1440, { unitCap: { agentDays: 600, events: 40 } });
    expect(out.result.stop).toBe("cap");
    expect(w.events.length).toBeLessThanOrEqual(40 + 4);
  });

  test("turn-mode catch-up: K agents round-robin, the rest stay on a deterministic backlog", () => {
    const world = simWorld();
    const reg = registryOf([simPack]);
    const s0 = startState(world);
    const w = new Working(reg, world, s0);
    advance(reg, w, w.state.clock + 1440, { runSeed: "run-1", mode: "turn" });
    const done = completedSlot(world, w.state);
    const order: string[] = [];
    let backlog = Infinity;
    for (let turn = 0; turn < 3; turn++) {
      const r = catchUp(reg, w, { runSeed: "run-1", agents: 1 });
      order.push(...r.stepped.map((s) => s.agent));
      expect(r.backlog).toBeLessThan(backlog);
      backlog = r.backlog;
    }
    expect(order).toEqual(["ana", "bo", "dev"]);
    expect(backlog).toBe(0);
    for (const a of ["ana", "bo", "dev"]) expect(agentCursor(world, w.state, a)).toBe(done);
    expect(hashJson(fold(reg, world, s0, w.events))).toBe(hashJson(w.state));
  });

  test("on-screen agents catch up first; the agent-day budget leaves a backlog", () => {
    const world = simWorld();
    const reg = registryOf([simPack]);
    const w = new Working(reg, world, startState(world));
    advance(reg, w, w.state.clock + 2 * 1440, { runSeed: "r", mode: "turn" });
    const r = catchUp(reg, w, { runSeed: "r", agents: 2, onScreen: ["bo"], agentDays: 0.5 });
    expect(r.stepped[0]?.agent).toBe("bo");
    expect(r.stepped.length).toBe(1);
    expect(r.backlog).toBeGreaterThan(0);
  });

  test("schedules apply at their own instants, on the right weekdays", () => {
    const world = simWorld();
    const reg = registryOf([simPack]);
    const w = new Working(reg, world, startState(world)); // Fri 08:00
    const seen: string[] = [];
    for (let h = 0; h < 24 * 4; h++) {
      advance(reg, w, w.state.clock + 60, { runSeed: "r", mode: "turn" });
      seen.push(String(w.state.entities.dev?.fields.activity ?? ""));
    }
    // Fri 09:00–17:00 work, weekend idle, Mon 09:00 work again
    expect(seen[0]).toBe("work_shift");
    expect(seen[8]).toBe("idle");
    expect(seen.slice(16, 16 + 48).every((a) => a === "idle")).toBe(true);
    expect(seen[24 * 3 + 1]).toBe("work_shift");
  });

  test("deterministic without ambient time or randomness", () => {
    const world = simWorld();
    const s0 = startState(world);
    const a = withoutAmbient(() => lapse(world, s0, 2 * 1440).w.events);
    const b = withoutAmbient(() => lapse(world, s0, 2 * 1440).w.events);
    expect(a).toEqual(b);
    void POV;
  });
});
