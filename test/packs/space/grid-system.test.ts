import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import { cellIndex, findPath, gridMinutes, hasCell, standingGrid } from "../../../src/shared/grid";
import { mapLint } from "../../../src/shared/maps";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { RuleDef, WorldDoc } from "../../../src/shared/world";
import { blankWorld, migrateWorld } from "../../../src/engine/authoring";
import { applyEffects } from "../../../src/engine/effects";
import { readEngineSlice } from "../../../src/engine/engine-pack";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runRulesOnEvents } from "../../../src/engine/rules";
import { cellsSeen } from "../../../src/engine/seen";
import { Working } from "../../../src/engine/working";
import { initialState } from "../../../src/engine/world-state";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { buildMapView } from "../../../src/packs/space/core/view";
import { fold } from "../support";

const reg = createRegistry(ALL_PACKS);

// A taproom with a lantern in it, a kitchen behind a door, and a back hall with a hearth below.
const LAYOUT = ["############", "#ttttt#kkkk#", "#ttttt+kkkk#", "#ttttL#kkkk#", "##+#########", "#hhhHHhhhhh#", "#####+######"];

function inn(opts: { movement?: boolean; rules?: RuleDef[]; layout?: string[] } = {}): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  w.mapSettings = { display: "knowledge", grid: { movement: opts.movement ?? true, sightRadius: 3 } };
  w.kinds.person!.fields.warmth = { type: "number", default: 0 };
  w.places = {
    town: { id: "town", name: "Saltmarsh", fields: {} },
    inn: { id: "inn", name: "The Gull", parent: "town", fields: {} },
    market: { id: "market", name: "Fish market", parent: "town", fields: {} },
  };
  w.entities.lantern = { id: "lantern", kind: "item", name: "Lantern", tier: "background", fields: {}, relations: [] };
  w.maps = {
    inn_ground: {
      id: "inn_ground",
      scope: "inn",
      title: "Ground floor",
      cellMeters: 40,
      layout: opts.layout ?? LAYOUT,
      legend: { t: { place: "taproom" }, k: { place: "kitchen" }, h: { place: "hall" }, H: { zone: "hearth" }, L: { item: "lantern" } },
      places: [
        { id: "taproom", name: "Taproom" },
        { id: "kitchen", name: "Kitchen" },
        { id: "hall", name: "Back hall" },
      ],
    },
  };
  w.start = { ...w.start, place: "taproom" };
  w.entities.you!.fields.place = "taproom";
  for (const rule of opts.rules ?? []) w.rules[rule.id] = rule;
  return migrateWorld(w);
}

function play(world: WorldDoc) {
  const s0 = initialState(world, "seed", reg);
  const w = new Working(reg, world, s0);
  const act = (action: string, params: Record<string, string | number>) => {
    const r = resolveAction(reg, w, { action, params }, createRng(`${action}:${JSON.stringify(params)}`));
    if (r.ok) runRulesOnEvents(reg, w, r.events, { seed: action });
    return r;
  };
  return { s0, w, act };
}

describe("map display modes", () => {
  test("by knowledge, a place known of but never visited is told apart from one visited", () => {
    const world = inn();
    const s = initialState(world, "seed", reg);
    const view = buildMapView(reg.context(world, s));
    expect([view.display, view.movement]).toEqual(["knowledge", true]);
    const town = view.scopes.find((scope) => scope.id === "town");
    const market = town?.places.find((p) => p.id === "market");
    expect([market?.known, market?.visited]).toEqual([true, false]);
    expect(town?.places.find((p) => p.id === "inn")?.visited).toBe(true);
    const fog = { ...world, mapSettings: { display: "fog" as const, grid: { movement: true, sightRadius: 3 } } };
    expect(buildMapView(reg.context(fog, s)).display).toBe("fog");
  });

  test("in fog, the POV sees the cells around it but not through walls, and the fold agrees", () => {
    const world = inn();
    const { s0, w, act } = play(world);
    const at = standingGrid(world, "taproom");
    if (!at) throw new Error("no grid");
    const seen = (x: number, y: number) => hasCell(cellsSeen(w.state, at.scope, at.grid.width) ?? "", cellIndex(at.grid, { x, y }) ?? -1);
    expect([w.state.entities.you?.fields.x, w.state.entities.you?.fields.y]).toEqual([3, 2]);
    expect([seen(4, 2), seen(3, 4), seen(3, 5)]).toEqual([true, true, false]);
    expect(act("step", { x: 2, y: 4 }).ok).toBe(true);
    expect(seen(3, 5)).toBe(true);
    expect(hashJson(fold(reg, world, s0, w.events))).toBe(hashJson(w.state));
  });
});

describe("the grid system", () => {
  test("lifts Space to 3, and the starters leave it off", () => {
    const world = inn();
    world.realism.levels.space = 1;
    expect(reg.context(world, initialState(world, "seed", reg)).levelOf("you", "space")).toBe(3);
    for (const make of Object.values(STARTER_WORLDS)) expect(make("w", "n").mapSettings).toBeUndefined();
  });

  test("steps go around walls and through doors, and change the room", () => {
    const world = inn();
    const { w, act } = play(world);
    const at = standingGrid(world, "taproom");
    const kitchen = world.places.kitchen?.cell;
    if (!at || !kitchen) throw new Error("no grid");
    expect(act("step", { x: 6, y: 1 }).ok).toBe(false);
    const path = findPath(at.grid, { x: 3, y: 2 }, kitchen);
    if (!path) throw new Error("no path");
    const r = act("step", { x: kitchen.x, y: kitchen.y });
    expect([r.ok, r.duration]).toEqual([true, gridMinutes(at.grid, path)]);
    expect(w.state.entities.you?.fields.place).toBe("kitchen");
  });

  test("routes come from the doors between rooms, only with movement on; a room without a door is linted", () => {
    const pairs = (world: WorldDoc) =>
      Object.values(world.routes)
        .map((route) => [route.from, route.to].sort().join("-"))
        .sort();
    expect(pairs(inn())).toEqual(["hall-taproom", "kitchen-taproom"]);
    expect(pairs(inn({ movement: false }))).toEqual([]);
    const sealed = inn({ layout: LAYOUT.map((row, y) => (y === 2 ? row.replace("+", "#") : row)) });
    expect(mapLint(sealed).some((issue) => issue.code.includes("floor_apart"))).toBe(true);
  });

  test("a thing in a cell lies there and is taken within reach", () => {
    const { w, act } = play(inn());
    const lantern = () => w.state.entities.lantern?.fields ?? {};
    expect([lantern().place, lantern().x, lantern().y]).toEqual(["taproom", 5, 3]);
    expect(act("take", { item: "lantern" }).ok).toBe(false);
    expect(act("step", { x: 4, y: 3 }).ok).toBe(true);
    expect(act("take", { item: "lantern" }).ok).toBe(true);
    expect(lantern().x).toBeUndefined();
    expect(act("step", { x: 1, y: 1 }).ok).toBe(true);
    expect(act("drop", { item: "lantern" }).ok).toBe(true);
    expect([lantern().place, lantern().x, lantern().y]).toEqual(["taproom", 1, 1]);
  });

  test("a zone rule fires once per entry and folds back the same", () => {
    const world = inn({ rules: [{ id: "warm", on: { zone: "hearth", in: "inn" }, do: [{ type: "add", args: { entity: "you", field: "warmth", delta: 1 } }] }] });
    const { s0, w, act } = play(world);
    const fired = () => readEngineSlice(w.state).fired.warm?.n ?? 0;
    const counts = [{ x: 2, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 5 }].map((cell) => {
      expect(act("step", cell).ok).toBe(true);
      return fired();
    });
    expect(counts).toEqual([0, 1, 1, 1, 2]);
    expect(w.state.entities.you?.fields.warmth).toBe(2);
    expect(hashJson(fold(reg, world, s0, w.events))).toBe(hashJson(w.state));
  });

  test("a removed person fires no zone or cell trigger and can't be stepped", () => {
    const rules: RuleDef[] = [
      { id: "warm", on: { zone: "hearth", in: "inn", who: { ids: ["cook"] } }, do: [{ type: "add", args: { entity: "cook", field: "warmth", delta: 1 } }] },
      { id: "spot", on: { cell: [5, 5], in: "inn", who: { kind: ["person"] } }, do: [{ type: "add", args: { entity: "cook", field: "warmth", delta: 10 } }] },
    ];
    const setup = (gone: boolean) => {
      const world = inn({ rules });
      world.entities.cook = { id: "cook", kind: "person", name: "Mara", tier: "background", fields: { place: "taproom", x: 2, y: 2, ...(gone ? { gone: true } : {}) }, relations: [] };
      return play(world).w;
    };
    const stepCook = (w: Working) => {
      const r = applyEffects(reg, w, [{ type: "space.step", args: { entity: "cook", x: 5, y: 5 } }], { bindings: {}, rng: createRng("step") });
      runRulesOnEvents(reg, w, r.applied, { seed: "step" });
      return r;
    };
    const fired = (w: Working) => Object.keys(readEngineSlice(w.state).fired).sort();

    const here = setup(false);
    expect(stepCook(here).rejected).toEqual([]);
    expect(fired(here)).toEqual(["spot", "warm"]);

    const away = setup(true);
    expect(stepCook(away).rejected.map((r) => r.rejection.code)).toEqual(["gone"]);
    expect([away.state.entities.cook?.fields.x, away.state.entities.cook?.fields.y]).toEqual([2, 2]);
    // A move that reaches the ledger some other way still fires nothing for them.
    const moved: LedgerEvent = { type: "space.pos", data: { entity: "cook", at: { scope: "inn", x: 5, y: 5 }, from: { scope: "inn", x: 5, y: 4 } } };
    away.apply(moved);
    runRulesOnEvents(reg, away, [moved], { seed: "moved" });
    expect(fired(away)).toEqual([]);
  });
});
