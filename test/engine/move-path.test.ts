// The one move path (DESIGN §4.1, §9.4): every writer of where someone is leaves the state the `move`
// effect leaves: out of whatever held them (`in`), at the place, and, for the player character from
// Space 3, standing on the place's cell.

import { describe, expect, test } from "bun:test";
import type { EntityId } from "../../src/shared/ids";
import type { EffectSpec, WorldDoc } from "../../src/shared/world";
import { applyEffects } from "../../src/engine/effects";
import { resolveEdit } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { instantEvents } from "../../src/engine/schedules";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { at, fixed, lapse, routine, town, withRoutines } from "../packs/castlife/town";

const reg = createRegistry(ALL_PACKS);

/** Riverton at Space 3, the café drawn at a cell; `who` starts in the garage, inside the toolbox. */
function riverton(who: EntityId): { world: WorldDoc; state: WorldState } {
  const world = modernUsWorld("w", "R");
  world.realism.levels.space = 3;
  const cafe = world.places.cafe;
  if (cafe) cafe.cell = { x: 2, y: 5 };
  const state = startState(world, reg);
  const e = state.entities[who];
  if (!e) throw new Error(`no ${who}`);
  e.fields.place = "garage";
  e.relations.push({ type: "in", to: "toolbox" });
  return { world, state };
}

/** Where someone ends up: whatever holds them, their place and their cell. */
function where(state: WorldState, who: EntityId) {
  const e = state.entities[who];
  const x = e?.fields.x;
  const y = e?.fields.y;
  return { in: e?.relations.filter((r) => r.type === "in").map((r) => r.to), place: placeOfEntity(state, who), cell: typeof x === "number" && typeof y === "number" ? [x, y] : null };
}

function byEffects(who: EntityId, specs: readonly EffectSpec[]) {
  const { world, state } = riverton(who);
  const w = new Working(reg, world, state);
  const out = applyEffects(reg, w, specs, { bindings: { self: who }, rng: createRng("m") });
  expect(out.rejected).toEqual([]);
  return where(w.state, who);
}

describe("every writer of a place moves alike", () => {
  test("the player character: the move effect, a narrated move, driving, a hold, and a GM edit", () => {
    const moved = byEffects("you", [{ type: "move", args: { entity: "you", to: "cafe" } }]);
    expect(moved).toEqual({ in: [], place: "cafe", cell: [2, 5] });
    const { world, state } = riverton("you");
    const told = reg.proposals.get("location")?.toEffects({ entity: "you", place: "cafe" }, reg.context(world, state)) ?? [];
    expect(byEffects("you", told)).toEqual(moved);
    expect(byEffects("you", [{ type: "vehicles.drive", args: { vehicle: "truck", to: "cafe", driver: "you" } }])).toEqual(moved);
    expect(byEffects("you", [{ type: "castlife.override", args: { who: "you", place: "cafe" } }])).toEqual(moved);
    const gm = riverton("you");
    const edit = resolveEdit(reg, gm.world, gm.state, [{ op: "set", entity: "you", field: "place", value: "cafe" }], { gm: true, runSeed: "r" });
    if ("rejection" in edit) throw new Error(edit.rejection.reason);
    const w = new Working(reg, gm.world, gm.state);
    w.applyAll(edit.events);
    expect(where(w.state, "you")).toEqual(moved);
  });

  test("someone else: a schedule's edge and a routine's block", () => {
    const moved = byEffects("maya", [{ type: "move", args: { entity: "maya", to: "cafe" } }]);
    expect(moved).toEqual({ in: [], place: "cafe", cell: null });
    const { world, state } = riverton("maya");
    const schedule = world.schedules.maya_place;
    if (!schedule) throw new Error("no schedule");
    const events = instantEvents(reg, reg.context(world, state), { at: state.clock, schedule, slot: 0, day: 0, occurrence: 0, edge: "start" }, "r");
    const w = new Working(reg, world, state);
    w.applyAll(events);
    expect(where(w.state, "maya")).toEqual(moved);
    // Maya's own evening at the Anchor, laid by the planner and lived in a timelapse.
    const t = town((wd) => withRoutines(wd, [routine("r_maya", "maya", [fixed("evening", "18:00", 120, { place: "pub" })])]));
    t.state.entities.maya?.relations.push({ type: "in", to: "chen_household" });
    lapse(t, at(t, 0, "18:30"));
    expect(where(t.state, "maya")).toEqual({ in: [], place: "pub", cell: null });
  });

  test("the player character's party rides along when it drives; someone not in the party stays", () => {
    const { world, state } = riverton("you");
    // Maya travels with the player character and Rosa doesn't; both wait with it in the garage.
    for (const id of ["maya", "rosa"]) {
      const e = state.entities[id];
      if (e) e.fields.place = "garage";
    }
    state.entities.maya?.relations.push({ type: "travels_with", to: "you" });
    const w = new Working(reg, world, state);
    const out = applyEffects(reg, w, [{ type: "vehicles.drive", args: { vehicle: "truck", to: "cafe", driver: "you" } }], { bindings: { self: "you" }, rng: createRng("m") });
    expect(out.rejected).toEqual([]);
    expect(where(w.state, "maya")).toEqual({ in: [], place: "cafe", cell: null });
    expect(placeOfEntity(w.state, "rosa")).toBe("garage");
    expect(placeOfEntity(w.state, "truck")).toBe("cafe");
  });

  test("in a Timelapse where the player character follows its routine to work, its party goes along", () => {
    const t = town((wd) => withRoutines(wd, [routine("r_you", "you", [fixed("work", "09:00", 480, { place: "office" })])]));
    // Rosa travels with the player character and waits with it at home.
    const rosa = t.state.entities.rosa;
    if (!rosa) throw new Error("no Rosa");
    rosa.fields.place = placeOfEntity(t.state, "you");
    rosa.relations.push({ type: "travels_with", to: "you" });
    lapse(t, at(t, 0, "09:30"));
    expect(placeOfEntity(t.state, "you")).toBe("office");
    expect(placeOfEntity(t.state, "rosa")).toBe("office");
  });
});
