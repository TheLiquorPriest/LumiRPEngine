// The map on the player layer (DESIGN §7, §12): it never names a place the POV can't see, not even
// one it stands inside, and the POV never walks into one.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { blankWorld, migrateWorld } from "../../../src/engine/authoring";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runRulesOnEvents } from "../../../src/engine/rules";
import { canSeePlace } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { initialState } from "../../../src/engine/world-state";
import { ALL_PACKS } from "../../../src/packs/index";
import { HIDDEN_PLACE_NAME } from "../../../src/packs/space/core/map-scope";
import { buildMapView } from "../../../src/packs/space/core/view";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

// A 16 × 7 inn: the taproom the POV starts in, a kitchen, a secret vault behind the kitchen (the
// zone "vault", an authored secret place), and a back hall with a trapdoor far from the POV.
const LAYOUT = [
  "################",
  "#ttttt#kkkk#VVV#",
  "#ttttt+kkkk+VVV#",
  "#ttttL#kkkk#VVV#",
  "##+#############",
  "#hhhhhhhhhhhhTh#",
  "#####+##########",
];

function inn(display: "knowledge" | "fog" = "knowledge"): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  w.mapSettings = { display, grid: { movement: true, sightRadius: 3 } };
  w.places = {
    town: { id: "town", name: "Saltmarsh", fields: {} },
    inn: { id: "inn", name: "The Gull", parent: "town", fields: {} },
    vault: { id: "vault", name: "The Vault of Sorrows", parent: "inn", fields: {}, visibility: "secret" },
  };
  w.entities.lantern = { id: "lantern", kind: "item", name: "Lantern", tier: "background", fields: {}, relations: [] };
  w.maps = {
    inn_ground: {
      id: "inn_ground",
      scope: "inn",
      cellMeters: 40,
      layout: LAYOUT,
      legend: { t: { place: "taproom" }, k: { place: "kitchen" }, h: { place: "hall" }, V: { zone: "vault" }, L: { item: "lantern" }, T: { terrain: "trapdoor_to_vault" } },
      places: [{ id: "taproom", name: "Taproom" }, { id: "kitchen", name: "Kitchen" }, { id: "hall", name: "Back hall" }],
    },
  };
  w.start = { ...w.start, place: "taproom" };
  w.entities.you!.fields.place = "taproom";
  return migrateWorld(w);
}

/** Three rooms in a row: the taproom, the secret vault, and a cellar reached only through the vault. */
function row(): WorldDoc {
  const w = blankWorld("w_row", "Row");
  w.mapSettings = { display: "knowledge", grid: { movement: true, sightRadius: 3 } };
  w.places = {
    inn: { id: "inn", name: "The Gull", fields: {} },
    vault: { id: "vault", name: "The Vault of Sorrows", parent: "inn", fields: {}, visibility: "secret" },
  };
  w.maps = {
    row: {
      id: "row",
      scope: "inn",
      layout: ["##########", "#tt+VV+cc#", "##########"],
      legend: { t: { place: "taproom" }, V: { zone: "vault" }, c: { place: "cellar" } },
      places: [{ id: "taproom", name: "Taproom" }, { id: "cellar", name: "Cellar" }],
    },
  };
  w.start = { ...w.start, place: "taproom" };
  w.entities.you!.fields.place = "taproom";
  return migrateWorld(w);
}

function play(world: WorldDoc) {
  const w = new Working(reg, world, initialState(world, "seed", reg));
  const act = (action: string, params: Record<string, number | string>) => {
    const r = resolveAction(reg, w, { action, params }, createRng(`${action}:${JSON.stringify(params)}`));
    if (r.ok) runRulesOnEvents(reg, w, r.events, { seed: action });
    return r;
  };
  return { w, act };
}

/** Riverton at Space 2, changed by `patch`. */
function riverton(patch: (w: WorldDoc) => void) {
  const world = modernUsWorld("w", "R");
  patch(world);
  const state = startState(world);
  state.realism.levels.space = 2;
  return { world, state };
}

describe("a place the POV can't see", () => {
  test("is never walked into: a step onto its cells is refused, from afar or from its door", () => {
    const { w, act } = play(inn());
    expect(act("step", { x: 13, y: 2 }).ok).toBe(false);
    expect(act("step", { x: 11, y: 2 }).ok).toBe(true);
    expect(act("step", { x: 12, y: 2 }).ok).toBe(false);
    expect(w.state.entities.you?.fields.place).not.toBe("vault");
    expect(JSON.stringify(buildMapView(w.ctx))).not.toContain("Vault of Sorrows");
  });

  test("is never walked through: a room reached only across it is out of reach on foot", () => {
    const { w, act } = play(row());
    expect(act("step", { x: 3, y: 1 }).ok).toBe(true);
    expect(act("step", { x: 7, y: 1 }).ok).toBe(false);
    expect(w.state.entities.you?.fields.place).toBe("inn");
  });

  test("standing in a place inside it: the map draws it as somewhere, by an id that isn't its own, and offers no way there", () => {
    const { world, state } = riverton((w) => {
      w.places.safehouse = { id: "safehouse", name: "Resistance safehouse", parent: "riverton", fields: {}, visibility: "secret" };
      w.places.cellar_room = { id: "cellar_room", name: "Cellar room", parent: "safehouse", fields: {} };
      w.entities.you!.fields.place = "cellar_room";
    });
    expect(canSeePlace(reg, world, state, "you", "safehouse")).toBe(false);
    const view = buildMapView(reg.context(world, state));
    const text = JSON.stringify(view);
    expect(text).not.toContain("safehouse");
    expect(text).not.toContain("Resistance");
    const [, standIn, here] = view.path;
    expect([view.path.length, here, view.here]).toEqual([3, "cellar_room", "cellar_room"]);
    const town = view.scopes.find((s) => s.id === "riverton");
    expect(town?.places.find((p) => p.id === standIn)).toMatchObject({ name: HIDDEN_PLACE_NAME, known: false });
    // It opens, under the same stand-in, on the room the POV is in; its breadcrumbs lead out to the town.
    const inside = view.scopes.find((s) => s.id === standIn);
    expect([inside?.name, inside?.places.map((p) => p.id), inside?.trail.map((c) => c.id)]).toEqual([HIDDEN_PLACE_NAME, ["cellar_room"], [null, "riverton"]]);
    expect(view.scope).toBe(standIn ?? "");
    expect(view.travel.some((t) => t.to === standIn)).toBe(false);
  });

  test("standing in it: the POV's place goes by the stand-in, and the POV can walk out", () => {
    const { w, act } = play(inn());
    w.apply({ type: "set", entity: "you", field: "place", value: "vault" });
    w.apply({ type: "space.pos", data: { entity: "you", at: { scope: "inn", x: 13, y: 2 }, from: null } });
    const view = buildMapView(w.ctx);
    const text = JSON.stringify(view);
    expect(text).not.toContain("Vault of Sorrows");
    expect(text).not.toContain('"vault"');
    expect(view.here).toBe(view.path.at(-1) ?? "");
    expect(view.scopes.find((s) => s.id === "inn")?.places.find((p) => p.id === view.here)).toMatchObject({ name: HIDDEN_PLACE_NAME, known: false, visited: true });
    expect(act("step", { x: 11, y: 2 }).ok).toBe(true);
    expect(w.state.entities.you?.fields.place).toBe("inn");
  });
});
