// The party and companions on the one move path (DESIGN §9.4): the party doesn't take along someone
// the same read or edit put elsewhere, nor anyone on a move that goes nowhere; whoever comes along
// leaves what they were doing behind, and a stated activity holds where they already are. A
// Timelapse record of moves on a grid still coarsens (DESIGN §4.3).

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { applyProposals } from "../../src/backend/turn-model";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { applyEffects } from "../../src/engine/effects";
import { resolveEdit } from "../../src/engine/edits";
import { createRegistry } from "../../src/engine/registry-impl";
import { relocate } from "../../src/engine/relocate";
import { createRng } from "../../src/engine/rng";
import { placeOfEntity } from "../../src/engine/scope";
import { coarsen } from "../../src/engine/simulate";
import { Working } from "../../src/engine/working";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** Riverton with the player character and Maya where given, Maya travelling with it; her activity as given. */
function riverton(you: string, maya: string, activity?: string): Working {
  const world = modernUsWorld("w", "R");
  const state = startState(world, reg);
  const [p, m] = [state.entities.you, state.entities.maya];
  if (!p || !m) throw new Error("fixture");
  p.fields.place = you;
  m.fields.place = maya;
  if (activity !== undefined) m.fields.activity = activity;
  m.relations.push({ type: "travels_with", to: "you" });
  return new Working(reg, world, state);
}

describe("the party on the one move path", () => {
  test("someone the same reply sends into a place inside the player character's stays there, in either order", () => {
    for (const [here, theirs] of [
      ["apartment_bldg", "apartment"],
      ["apartment", "apartment_bldg"],
    ] as const) {
      for (const order of ["maya first", "you first"] as const) {
        const w = riverton(here, here);
        const maya = { type: "location", entity: "maya", place: theirs };
        const you = { type: "location", entity: "you", place: "cafe" };
        applyProposals(reg, w, order === "maya first" ? [maya, you] : [you, maya], "seed", "run");
        expect([here, order, placeOfEntity(w.state, "you"), placeOfEntity(w.state, "maya")]).toEqual([here, order, "cafe", theirs]);
      }
    }
  });

  test("a party member who comes along leaves their activity behind, and their own stated one holds where the party brought them", () => {
    const w = riverton("cafe", "cafe", "work_shift");
    applyProposals(reg, w, [{ type: "location", entity: "you", place: "office" }], "seed", "run");
    expect([placeOfEntity(w.state, "maya"), w.state.entities.maya?.fields.activity]).toEqual(["office", "idle"]);
    const told = riverton("cafe", "cafe", "work_shift");
    applyProposals(
      reg,
      told,
      [
        { type: "location", entity: "you", place: "office" },
        { type: "location", entity: "maya", place: "office", activity: "meeting" },
      ],
      "seed",
      "run",
    );
    expect([placeOfEntity(told.state, "maya"), told.state.entities.maya?.fields.activity]).toEqual(["office", "meeting"]);
  });

  test("a Go companion leaves their activity behind", () => {
    const w = riverton("cafe", "cafe", "work_shift");
    const rosa = w.state.entities.rosa;
    if (!rosa) throw new Error("fixture");
    rosa.fields.place = "cafe";
    rosa.fields.activity = "work_shift";
    const out = applyEffects(reg, w, [{ type: "move", args: { entity: "you", to: "office", with: "rosa" } }], { bindings: { self: "you" }, rng: createRng("m") });
    expect(out.rejected).toEqual([]);
    expect([placeOfEntity(w.state, "rosa"), w.state.entities.rosa?.fields.activity]).toEqual(["office", "idle"]);
  });

  test("a move of the player character to where it already is leaves its party where they are", () => {
    const w = riverton("apartment_bldg", "apartment");
    const edit = resolveEdit(reg, w.world, w.state, [{ op: "set", entity: "you", field: "place", value: "apartment_bldg" }], { gm: false, runSeed: "r" });
    if ("rejection" in edit) throw new Error(edit.rejection.reason);
    w.applyAll(edit.events);
    expect(placeOfEntity(w.state, "maya")).toBe("apartment");
  });
});

describe("a Timelapse record of moves on a grid", () => {
  /** An inn drawn on a grid and a market stall, with the grid system on. */
  function inn(): WorldDoc {
    const w = blankWorld("w_inn", "Inn");
    w.mapSettings = { display: "knowledge", grid: { movement: true, sightRadius: 3 } };
    w.realism.levels.space = 3;
    w.places = { town: { id: "town", name: "Saltmarsh", fields: {} }, inn: { id: "inn", name: "The Gull", parent: "town", fields: {} }, market: { id: "market", name: "Fish market", parent: "town", fields: {} } };
    w.maps = {
      inn_ground: { id: "inn_ground", scope: "inn", cellMeters: 40, layout: ["############", "#ttttt#kkkk#", "#ttttt+kkkk#", "#tttt.#kkkk#", "##+#########", "#hhhhhhhhhh#", "#####+######"], legend: { t: { place: "taproom" }, k: { place: "kitchen" }, h: { place: "hall" } }, places: [{ id: "taproom" }, { id: "kitchen" }, { id: "hall" }] },
      stalls: { id: "stalls", scope: "market", cellMeters: 40, layout: ["#####", "#sss#", "##+##"], legend: { s: { place: "stall" } }, places: [{ id: "stall" }] },
    };
    const you = w.entities.you;
    if (you) you.fields.place = "taproom";
    return migrateWorld(w);
  }

  test("the player character's moves through the one move path coarsen to one position", () => {
    const world = inn();
    const start = initialState(world, "seed", reg);
    const w = new Working(reg, world, start);
    for (const to of ["stall", "kitchen", "stall", "kitchen", "stall", "taproom"]) {
      const events = relocate(w.ctx, "you", to);
      if (!Array.isArray(events)) throw new Error(events.reason);
      w.applyAll(events);
    }
    const coarse = coarsen(reg, world, start, w.events);
    const positions = (events: readonly LedgerEvent[]) => events.filter((e) => e.type === "space.pos").length;
    expect(positions(w.events)).toBeGreaterThan(1);
    expect(positions(coarse)).toBe(1);
    expect(coarse.length).toBeLessThan(w.events.length);
  });
});
