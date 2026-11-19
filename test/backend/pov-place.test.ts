// The POV's place on the player's surfaces (DESIGN §7): a place it can't see, even the one it stands
// in, is "Somewhere" with no id wherever the player reads it, while a `known_by` place it is anywhere
// inside keeps its name.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { paramCandidates, resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { canSeePlace, HIDDEN_PLACE_NAME, povPlace } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { buildCastView } from "../../src/packs/castlife/core/index";
import { buildGarageView } from "../../src/packs/vehicles/core/view";
import { buildMapView, travelWays } from "../../src/packs/space/core/view";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

describe("a secret place the POV stands in", () => {
  test("is Somewhere in Cast and the Garage, where a place the POV sees keeps its name", () => {
    const world = modernUsWorld("w", "R");
    world.places.hideout = { id: "hideout", name: "The Smugglers' Hideout", parent: "riverton", fields: {}, visibility: "secret" };
    const state = startState(world);
    for (const id of [world.pov, "maya", "truck"]) state.entities[id]!.fields.place = "hideout";
    state.entities.truck!.fields.home = "hideout";
    const ctx = reg.context(world, state);
    const cast = buildCastView(ctx);
    const garage = buildGarageView(ctx);
    expect(cast.people.find((p) => p.id === "maya")?.place).toBe(HIDDEN_PLACE_NAME);
    expect(garage.vehicles.find((v) => v.id === "truck")).toMatchObject({ place: HIDDEN_PLACE_NAME, home: HIDDEN_PLACE_NAME });
    expect(JSON.stringify([cast, garage])).not.toContain("Smugglers");
    // Back in the building's garage, the truck's place is named again; only its home base isn't.
    state.entities.truck!.fields.place = "garage";
    expect(buildGarageView(reg.context(world, state)).vehicles.find((v) => v.id === "truck")).toMatchObject({ place: "Building garage", home: HIDDEN_PLACE_NAME });
  });
});

describe("a place the POV is inside", () => {
  /** Riverton with a kitchen and a bedroom in Maya's flat, which the POV knows of only by being there. */
  function mayaFlat(): WorldDoc {
    const world = modernUsWorld("w", "R");
    world.places.maya_kitchen = { id: "maya_kitchen", name: "Maya's kitchen", parent: "maya_flat", fields: {} };
    world.places.maya_bedroom = { id: "maya_bedroom", name: "Maya's bedroom", parent: "maya_flat", fields: {} };
    world.entities[world.pov]!.fields.place = "maya_flat";
    return world;
  }

  test("walking from Maya's flat into its kitchen keeps the kitchen and the flat named, and the bedroom offered", () => {
    const world = mayaFlat();
    const w = new Working(reg, world, startState(world));
    const go = reg.actions.get("go");
    if (!go) throw new Error("no go action");
    expect(paramCandidates(reg, w.world, w.state, go, "to")).toContain("maya_kitchen");
    expect(resolveAction(reg, w, { action: "go", params: { to: "maya_kitchen" } }, createRng("go")).ok).toBe(true);
    // The HUD pill, Scene and the sheet all name it through `povPlace`.
    expect(povPlace(reg, w.world, w.state)).toEqual({ id: "maya_kitchen", name: "Maya's kitchen" });
    const map = buildMapView(w.ctx);
    expect([map.here, map.path, map.scope]).toEqual(["maya_kitchen", ["riverton", "maya_flat", "maya_kitchen"], "maya_flat"]);
    expect(JSON.stringify(map)).not.toContain(HIDDEN_PLACE_NAME);
    expect(travelWays(w.ctx, null).some((t) => t.to === "maya_bedroom")).toBe(true);
    expect(paramCandidates(reg, w.world, w.state, go, "to")).toContain("maya_bedroom");
    // Out of the flat again, it is someone else's home the POV doesn't know.
    expect(resolveAction(reg, w, { action: "go", params: { to: "cafe" } }, createRng("go:cafe")).ok).toBe(true);
    expect(["maya_flat", "maya_kitchen", "maya_bedroom"].some((id) => canSeePlace(reg, w.world, w.state, w.world.pov, id))).toBe(false);
  });

  test("a secret room in it is still Somewhere: being inside names only what isn't secret", () => {
    const world = mayaFlat();
    world.places.maya_safe_room = { id: "maya_safe_room", name: "Maya's safe room", parent: "maya_flat", fields: {}, visibility: "secret" };
    world.places.maya_closet = { id: "maya_closet", name: "Maya's closet", parent: "maya_safe_room", fields: {} };
    const state = startState(world);
    for (const place of ["maya_safe_room", "maya_closet"]) {
      state.entities[world.pov]!.fields.place = place;
      expect(povPlace(reg, world, state)).toEqual({ id: null, name: HIDDEN_PLACE_NAME });
      expect(["maya_flat", "maya_safe_room", "maya_closet"].map((id) => canSeePlace(reg, world, state, world.pov, id))).toEqual([true, false, false]);
      expect(JSON.stringify(buildMapView(reg.context(world, state)))).not.toContain("safe room");
    }
  });
});
