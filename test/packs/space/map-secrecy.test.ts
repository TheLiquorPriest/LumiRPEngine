// The map on the player layer (DESIGN §7, §12): it never names a place the POV can't see, not even
// one it stands inside, and the POV never walks into one.

import { describe, expect, test } from "bun:test";
import { hasCell } from "../../../src/shared/grid";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { blankWorld, migrateWorld } from "../../../src/engine/authoring";
import { authorLines, playerLines } from "../../../src/engine/player-events";
import { createRegistry } from "../../../src/engine/registry-impl";
import { paramCandidates, resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runRulesOnEvents } from "../../../src/engine/rules";
import type { WorldState } from "../../../src/engine/state";
import { canSeePlace, HIDDEN_PLACE_NAME } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { initialState } from "../../../src/engine/world-state";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildMapView, type MapView } from "../../../src/packs/space/core/view";
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

const VAULT_CELL = 2 * 16 + 13;
const TRAPDOOR_CELL = 5 * 16 + 13;

function inn(display: "knowledge" | "fog" = "knowledge", movement = true): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  w.mapSettings = { display, grid: { movement, sightRadius: 3 } };
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

  test("standing in a room inside it: both go by stand-ins, by ids that aren't their own, and neither is somewhere to go", () => {
    const { world, state } = riverton((w) => {
      w.places.safehouse = { id: "safehouse", name: "Resistance safehouse", parent: "riverton", fields: {}, visibility: "secret" };
      w.places.cellar_room = { id: "cellar_room", name: "Cellar room", parent: "safehouse", fields: {} };
      w.entities.you!.fields.place = "cellar_room";
    });
    // The room is public on its own, but a room of a place the POV can't see is as hidden as it.
    expect([canSeePlace(reg, world, state, "you", "safehouse"), canSeePlace(reg, world, state, "you", "cellar_room")]).toEqual([false, false]);
    const view = buildMapView(reg.context(world, state));
    const text = JSON.stringify(view);
    for (const hidden of ["safehouse", "Resistance", "cellar_room", "Cellar room"]) expect(text).not.toContain(hidden);
    const [, standIn, here] = view.path;
    expect([view.path.length, view.here]).toEqual([3, here]);
    const town = view.scopes.find((s) => s.id === "riverton");
    expect(town?.places.find((p) => p.id === standIn)).toMatchObject({ name: HIDDEN_PLACE_NAME, known: false });
    // It opens, under the same stand-in, on the room the POV is in, a stand-in too; its breadcrumbs lead out to the town.
    const inside = view.scopes.find((s) => s.id === standIn);
    expect([inside?.name, inside?.places.map((p) => [p.id, p.name]), inside?.trail.map((c) => c.id)]).toEqual([HIDDEN_PLACE_NAME, [[here, HIDDEN_PLACE_NAME]], [null, "riverton"]]);
    expect(view.scope).toBe(standIn ?? "");
    expect(view.travel.some((t) => t.to === standIn || t.to === here)).toBe(false);
  });

  test("a public room inside it is offered from nowhere outside it: not on the map, not in the palette's Go to", () => {
    const { world, state } = riverton((w) => {
      w.places.safehouse = { id: "safehouse", name: "Resistance safehouse", parent: "riverton", fields: {}, visibility: "secret" };
      w.places.cellar_room = { id: "cellar_room", name: "Cellar room", parent: "safehouse", fields: {} };
    });
    state.realism.levels.space = 2;
    const view = buildMapView(reg.context(world, state));
    expect(view.travel.some((t) => t.to === "cellar_room")).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Cellar room");
    const go = reg.actions.get("go");
    if (!go) throw new Error("no go action");
    expect(paramCandidates(reg, world, state, go, "to")).not.toContain("cellar_room");
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

describe("the map's display, applied before the view leaves the engine", () => {
  const gridOf = (view: MapView) => {
    const grid = view.scopes.find((s) => s.id === "inn")?.grid;
    if (!grid) throw new Error("no grid");
    return grid;
  };

  test("in fog, the cells the POV hasn't seen go out blank: no terrain, no wall, no area", () => {
    const world = inn("fog");
    const grid = gridOf(buildMapView(reg.context(world, initialState(world, "seed", reg))));
    expect(hasCell(grid.seen ?? "", TRAPDOOR_CELL)).toBe(false);
    expect([grid.terrain[TRAPDOOR_CELL], grid.blocked.includes(TRAPDOOR_CELL)]).toEqual(["", false]);
    expect(Object.values(grid.areas).flat().every((cell) => hasCell(grid.seen ?? "", cell))).toBe(true);
    expect(JSON.stringify(grid)).not.toContain("trapdoor");
    // What it has seen keeps its walls: the taproom's wall above the POV.
    expect([hasCell(grid.seen ?? "", 3), grid.terrain[3], grid.blocked.includes(3)]).toEqual([true, "wall", true]);
  });

  test("a room the POV can't see: by knowledge nothing at all, void and walled; in fog, unseen, exactly what any unseen cell is", () => {
    for (const display of ["knowledge", "fog"] as const) {
      const world = inn(display);
      const view = buildMapView(reg.context(world, initialState(world, "seed", reg)));
      const grid = gridOf(view);
      // Fog never outlines a hidden room: its unseen cells go out as the unseen trapdoor's do.
      expect([grid.terrain[VAULT_CELL], grid.blocked.includes(VAULT_CELL)]).toEqual(display === "knowledge" ? ["void", true] : [grid.terrain[TRAPDOOR_CELL], grid.blocked.includes(TRAPDOOR_CELL)]);
      expect(JSON.stringify(view)).not.toContain('"vault"');
    }
  });

  test("the chat's pick decides, and Fog and Known send different maps", () => {
    const world = inn("knowledge");
    const ctx = reg.context(world, initialState(world, "seed", reg));
    const fog = buildMapView(ctx, "fog");
    const known = buildMapView(ctx, "knowledge");
    expect([fog.display, known.display, buildMapView(ctx).display]).toEqual(["fog", "knowledge", "knowledge"]);
    expect(gridOf(fog).terrain).not.toEqual(gridOf(known).terrain);
    expect(gridOf(known).seen).toBeUndefined();
    expect(gridOf(known).terrain[TRAPDOOR_CELL]).toBe("trapdoor_to_vault");
  });

  test("without the grid system, fog blanks the rooms the POV hasn't been in, known or hidden", () => {
    const world = inn("fog", false);
    const grid = gridOf(buildMapView(reg.context(world, initialState(world, "seed", reg))));
    const kitchen = 2 * 16 + 8;
    const taproom = 2 * 16 + 3;
    expect([grid.terrain[kitchen], hasCell(grid.seen ?? "", kitchen), grid.areas.kitchen]).toEqual(["", false, []]);
    expect([grid.terrain[taproom], hasCell(grid.seen ?? "", taproom)]).toEqual(["floor", true]);
    expect([grid.terrain[VAULT_CELL], grid.blocked.includes(VAULT_CELL), hasCell(grid.seen ?? "", VAULT_CELL)]).toEqual(["", false, false]);
  });
});

describe("routes on the map", () => {
  test("a route whose real end the POV can't see isn't drawn, not even to the visible place around that end", () => {
    const { world, state } = riverton((w) => {
      w.places.park_cache = { id: "park_cache", name: "Smugglers' cache", parent: "park", fields: {}, visibility: "secret" };
      w.routes.apt_cache = { id: "apt_cache", from: "apartment_bldg", to: "park_cache", modes: { walk: { minutes: 1 } }, bidirectional: true };
    });
    const town = buildMapView(reg.context(world, state)).scopes.find((s) => s.id === "riverton");
    const line = town?.routes.find((r) => [r.from, r.to].sort().join() === "apartment_bldg,park");
    // The visible route says 10 minutes; the hidden one's minute never reaches the drawn line.
    expect(line?.modes.walk?.minutes).toBe(10);
  });

  test("a closed route isn't drawn, and travel under the travel simulation doesn't take it", () => {
    const { world, state } = riverton((w) => {
      w.packs.space!.config.closedRoutes = ["apt_park"];
      w.mapSettings = { display: "knowledge", grid: { movement: false, sightRadius: 3 }, travelSimulation: true };
    });
    const view = buildMapView(reg.context(world, state));
    const town = view.scopes.find((s) => s.id === "riverton");
    expect(town?.routes.some((r) => [r.from, r.to].sort().join() === "apartment_bldg,park")).toBe(false);
    const walk = (v: MapView) => v.travel.find((t) => t.to === "park" && t.mode === "walk");
    const open = riverton(() => undefined);
    expect(walk(buildMapView(reg.context(open.world, open.state)))?.disabled).toBeUndefined();
    expect(walk(view)?.disabled).toBe("no walking route");
  });

  test("opening or closing a way to a place the POV can't see says somewhere; the author's line names it", () => {
    const { world, state } = riverton((w) => {
      w.places.vault = { id: "vault", name: "The vault", parent: "riverton", fields: {}, visibility: "secret" };
      w.routes.apt_vault = { id: "apt_vault", from: "apartment_bldg", to: "vault", modes: { walk: { minutes: 3 } }, bidirectional: true };
    });
    const opened: LedgerEvent[] = [{ type: "space.route", data: { route: "apt_vault", open: true } }];
    expect(playerLines(reg, world, state, "you", opened)).toEqual(["The way from Elm Street Apartments to somewhere opens"]);
    expect(authorLines(reg, world, state, opened, 8)).toEqual(["The way from Elm Street Apartments to The vault opens"]);
  });
});

describe("things lying in cells", () => {
  const items = (view: MapView) => (view.scopes.find((s) => s.id === "inn")?.grid?.items ?? []).map((i) => [i.id, i.x, i.y]);

  test("with the grid system, a thing shows only while the POV has it in sight: moved out of sight, it isn't shown where it went", () => {
    const { w, act } = play(inn("fog"));
    expect(items(buildMapView(w.ctx))).toEqual([["lantern", 5, 3]]);
    expect(act("step", { x: 8, y: 2 }).ok).toBe(true);
    w.apply({ type: "set", entity: "lantern", field: "x", value: 1 });
    w.apply({ type: "set", entity: "lantern", field: "y", value: 1 });
    expect(items(buildMapView(w.ctx))).toEqual([]);
    expect(act("step", { x: 3, y: 2 }).ok).toBe(true);
    expect(items(buildMapView(w.ctx))).toEqual([["lantern", 1, 1]]);
  });

  test("without it, a thing shows only in the place the POV is in", () => {
    const { w } = play(inn("knowledge", false));
    expect(items(buildMapView(w.ctx))).toEqual([["lantern", 5, 3]]);
    w.apply({ type: "set", entity: "lantern", field: "place", value: "kitchen" });
    w.apply({ type: "set", entity: "lantern", field: "x", value: 8 });
    expect(items(buildMapView(w.ctx))).toEqual([]);
  });
});

describe("a grid's items", () => {
  test("a prototype name among them, with no such entity, starts the chat without it", () => {
    const w = blankWorld("w_proto", "Proto");
    w.places = { town: { id: "town", name: "Town", fields: {}, grid: "g" } };
    w.grids = { g: { id: "g", width: 2, height: 1, terrain: ["floor", "floor"], blocked: [], zones: {}, items: { constructor: 1, toString: 0 } } };
    w.start = { ...w.start, place: "town" };
    w.entities.you!.fields.place = "town";
    const state = initialState(migrateWorld(w), "seed", reg);
    expect(Object.keys(state.entities)).not.toContain("constructor");
    expect(state.entities.you?.fields.place).toBe("town");
  });
});

describe("the narrator's place line", () => {
  const place = (world: WorldDoc, state: WorldState) => reg.renderers.filter((r) => r.slot === "scene").flatMap((r) => r.render(reg.context(world, state))).filter((l) => l.startsWith("Place:"));

  test("never names a place the POV can't see: around it, it is left out; the POV's own, it is somewhere", () => {
    const { world, state } = riverton((w) => {
      w.places.safehouse = { id: "safehouse", name: "Resistance safehouse", parent: "riverton", fields: {}, visibility: "secret" };
      w.places.cellar_room = { id: "cellar_room", name: "Cellar room", parent: "safehouse", fields: {} };
      w.entities.you!.fields.place = "cellar_room";
    });
    expect(place(world, state)).toEqual([`Place: ${HIDDEN_PLACE_NAME}.`]);
    state.entities.you!.fields.place = "safehouse";
    expect(place(world, state)).toEqual([`Place: ${HIDDEN_PLACE_NAME} (in Riverton).`]);
  });
});
