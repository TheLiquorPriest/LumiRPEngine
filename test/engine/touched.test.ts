// The touched record (DESIGN §4.3 `migrate`): what applied events wrote of entities' definitions,
// kept inside event apply, names only.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { MapCellDef, WorldDoc } from "../../src/shared/world";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { applyEvent, applyMarker, EXTERNAL_ACCOUNT_PREFIX, validateEvent } from "../../src/engine/events";
import { own } from "../../src/engine/pack-kit";
import { playedWorld } from "../../src/engine/places-in-play";
import type { Touch } from "../../src/engine/registry";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { touchedAspect, touchedField, touchedRelation } from "../../src/engine/touched";
import { chatDraftOf, draftEvent, NO_DRAFT } from "../../src/engine/world-draft";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { doorsAt, editedMap, shapeOf, squareEditsOf, type DoorState, type Shape, whereOf } from "../../src/packs/space/core/grid-play";
import { drawnOf } from "../../src/packs/space/core/grid-model";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import { baseWorld, fold, POV, startState } from "../packs/support";
import { EVERY_TYPE, everythingWorld, registeredTypes } from "./every-type";

const reg = createRegistry(ALL_PACKS);

/** The base world with a checking account for Sam. */
function world(): WorldDoc {
  const w = baseWorld();
  w.entities.acct = { id: "acct", kind: "account", name: "Sam's checking", tier: "background", fields: { owner: POV, type: "checking", opening: 5000 }, relations: [] };
  return w;
}

function played(events: Parameters<typeof fold>[3]): WorldState {
  const w = world();
  return fold(reg, w, startState(w, reg), events);
}

describe("the touched record", () => {
  test("names the fields, relations, levels, new entities and balances applied events wrote, never values", () => {
    const state = played([
      { type: "set", entity: "dev", field: "place", value: "home" },
      { type: "add", entity: POV, field: "cash", delta: -10 },
      { type: "link", rel: "knows", from: POV, to: "dev" },
      { type: "spawn", entity: { id: "coin", kind: "person", name: "Coin", tier: "background", fields: {}, relations: [] } },
      { type: "engine.entity", data: { entity: "dev", tier: "supporting" } },
      { type: "post", lines: [{ account: "acct", amount: -300 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}shop`, amount: 300 }], memo: "Bought a lamp" },
    ]);
    applyMarker(state, { kind: "resolve", domain: "money", scope: { entity: POV }, to: 2 });
    expect(touchedField(state, "dev", "place")).toBe(true);
    expect(touchedField(state, "dev", "home")).toBe(false);
    expect(touchedField(state, POV, "cash")).toBe(true);
    expect(touchedRelation(state, POV, "knows", "dev")).toBe(true);
    expect(touchedAspect(state, "coin", "spawned")).toBe(true);
    expect(touchedAspect(state, "dev", "tier")).toBe(true);
    expect(touchedAspect(state, "dev", "agent")).toBe(false);
    expect(touchedAspect(state, POV, "levels")).toBe(true);
    expect(touchedAspect(state, "acct", "posted")).toBe(true);
    // Names only: none of the values written is in it.
    for (const value of ['"home"', "supporting", "lamp"]) expect(JSON.stringify(state.packs.engine?.touched)).not.toContain(value);
  });

  test("a change that went back to where it was still counts", () => {
    const state = played([
      { type: "add", entity: "dev", field: "cash", delta: 5 },
      { type: "add", entity: "dev", field: "cash", delta: -5 },
    ]);
    expect(state.entities.dev?.fields.cash).toBe(900);
    expect(touchedField(state, "dev", "cash")).toBe(true);
  });

  test("a materialization's opening posting leaves the balance untouched; its generated detail counts", () => {
    const state = played([
      {
        type: "materialize",
        entity: POV,
        domain: "money",
        generatorVersion: 1,
        tablesRevision: "t",
        events: [
          { type: "post", lines: [{ account: "acct", amount: 5000 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}${POV}`, amount: -5000 }], memo: "Opening balances" },
          { type: "set", entity: POV, field: "skill", value: 3 },
        ],
      },
    ]);
    expect(touchedAspect(state, "acct", "posted")).toBe(false);
    expect(touchedField(state, POV, "skill")).toBe(true);
  });
});

/** What an event wrote of entities' definitions: each field, relation (by type and target), tier, agent flag, level overrides, classes and tags and life state that changed, each new entity and each own account's balance. */
function written(before: Readonly<WorldState>, after: Readonly<WorldState>): Touch[] {
  const out: Touch[] = [];
  const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
  for (const [id, e] of Object.entries(after.entities)) {
    const was = own(before.entities, id);
    if (!was) {
      out.push({ entity: id, aspect: "spawned" });
      continue;
    }
    for (const f of new Set([...Object.keys(was.fields), ...Object.keys(e.fields)])) if (differs(own(was.fields, f), own(e.fields, f))) out.push({ entity: id, field: f });
    for (const key of new Set([...was.relations, ...e.relations].map((r) => `${r.type}\u0000${r.to}`))) {
      const [rel = "", to = ""] = key.split("\u0000");
      if (differs(was.relations.filter((x) => x.type === rel && x.to === to), e.relations.filter((x) => x.type === rel && x.to === to))) out.push({ entity: id, rel, to });
    }
    if (was.name !== e.name) out.push({ entity: id, aspect: "name" });
    if (was.tier !== e.tier) out.push({ entity: id, aspect: "tier" });
    if (was.agent !== e.agent) out.push({ entity: id, aspect: "agent" });
    if (differs(was.levels, e.levels)) out.push({ entity: id, aspect: "levels" });
    if (differs([was.class, was.tags], [e.class, e.tags])) out.push({ entity: id, aspect: "class" });
    if (was.life !== e.life) out.push({ entity: id, aspect: "life" });
    if (own(before.accounts, id) !== own(after.accounts, id)) out.push({ entity: id, aspect: "posted" });
  }
  return out;
}

describe("the event types", () => {
  test("every type that writes an entity's definition records it in the touched record, so an Upgrade keeps it", () => {
    const types = registeredTypes(reg);
    expect(types.filter((t) => !EVERY_TYPE.some((e) => e.type === t))).toEqual([]);
    const world = everythingWorld();
    const state = initialState(world, "r", reg);
    const problems: string[] = [];
    for (const event of EVERY_TYPE) {
      const rejection = validateEvent(reg, event, reg.context(world, state));
      if (rejection) problems.push(`${event.type} doesn't apply here: ${rejection.reason}`);
      const before = structuredClone(state);
      applyEvent(reg, event, state, reg.context(world, state));
      for (const t of written(before, state)) {
        // A materialization's opening postings are the authored balance itself, never play's.
        if (event.type === "materialize" && "aspect" in t && t.aspect === "posted") continue;
        // An Undo's put-back (`engine.put`) restores what play wrote together with the touched record's note of it, so it is no write of play's.
        if (event.type === "engine.put") continue;
        const recorded = "field" in t ? touchedField(state, t.entity, t.field) : "rel" in t ? touchedRelation(state, t.entity, t.rel, t.to) : touchedAspect(state, t.entity, t.aspect);
        if (!recorded) problems.push(`${event.type} wrote ${JSON.stringify(t)} without touching it`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("what play changed on a grid, across an Upgrade (plan §8.2)", () => {
  test("a door locked, a footprint given and a square drawn anew stay as play left them, over each new revision's map", () => {
    const hearth: MapCellDef = { terrain: "hearth", blocked: true };
    const bench: MapCellDef = { terrain: "bench" };
    const rubble: MapCellDef = { terrain: "rubble", blocked: true };
    const pane: MapCellDef = { terrain: "window", blocked: true };
    /** The Gull's common room as a revision draws it (`rows`, with the symbols of its own `legend`), and its long table by the name the revision gives it. */
    const revision = (rows: string[], legend: Record<string, MapCellDef>, table: string): WorldDoc => {
      const w = blankWorld("w_room", "Common room");
      w.places.inn = { id: "inn", name: "The Gull", fields: {} };
      w.maps.room = { id: "room", scope: "inn", layout: rows, legend };
      w.entities.table = { id: "table", kind: "thing", name: table, tier: "background", fields: { place: "inn" }, relations: [] };
      // The yard's grid is authored with no map: three squares of cobble.
      w.places.yard = { id: "yard", name: "The yard", grid: "yard_grid", fields: {} };
      w.grids.yard_grid = { id: "yard_grid", width: 3, height: 1, terrain: ["cobble", "cobble", "cobble"], blocked: [], zones: {} };
      return migrateWorld(w);
    };
    const a = revision(["#########", "#.......#", "#.......+", "#########"], {}, "Long table");
    // In play the east door is locked, the table is set out three squares long, blocking the way, rubble falls on a square, and the table is said to stand under the window.
    const state = fold(reg, a, initialState(a, "ra", reg), [
      { type: "space.door", data: { scope: "inn", x: 8, y: 2, state: "locked" } },
      { type: "space.shape", data: { entity: "table", size: [3, 1], way: true, view: false } },
      { type: "space.squares", data: { map: "room", squares: [{ x: 3, y: 1, symbol: "x" }], legend: { x: rubble } } },
      { type: "space.squares", data: { map: "yard_grid", squares: [{ x: 1, y: 0, symbol: "x" }], legend: { x: rubble } } },
      { type: "space.where", data: { entity: "table", zone: "under the window" } },
    ]);
    // The next revision is the user's own edit of the map in Build: a hearth in a corner, and a bench on the square the rubble covers.
    const b = revision(["#########", "#H.b....#", "#.......+", "#########"], { H: hearth, b: bench }, "Long table");
    // A later one puts a window in the north wall and renames the table.
    const c = revision(["####w####", "#H.b....#", "#.......+", "#########"], { H: hearth, b: bench, w: pane }, "Trestle table");
    const docs: Record<string, WorldDoc> = { ra: a, rb: b, rc: c };
    const env = { worlds: (r: string) => own(docs, r), types: reg };
    /** The room as the chat plays it on `world`: the doors play set, the table's footprint, and the map with the squares play drew laid over it. */
    const room = (world: WorldDoc) => {
      const drawn = editedMap(playedWorld(world, state).maps.room, squareEditsOf(state, "room") ?? { cells: {}, legend: {} });
      return { doors: doorsAt(state, "inn"), table: shapeOf(state, "table"), layout: drawn.layout, legend: drawn.legend };
    };
    const asPlayed: { doors: Record<string, DoorState>; table: Shape } = { doors: { "8,2": "locked" }, table: { size: [3, 1], way: true, view: false } };
    // Switched to the next revision with no picks: the rubble stays over the bench drawn beneath it, and the revision's hearth shows through.
    applyMarker(state, { kind: "migrate", to: "rb" }, env);
    expect(state.revision).toBe("rb");
    expect(room(b)).toEqual({ ...asPlayed, layout: ["#########", "#H.x....#", "#.......+", "#########"], legend: { H: hearth, b: bench, x: rubble } });
    // An Upgrade with picks takes the table's new name, which play never wrote; its footprint is play's and stays, and the window shows through.
    applyMarker(state, { kind: "migrate", to: "rc", merge: {} }, env);
    expect(state.entities.table?.name).toBe("Trestle table");
    expect(room(c)).toEqual({ ...asPlayed, layout: ["####w####", "#H.x....#", "#.......+", "#########"], legend: { H: hearth, b: bench, w: pane, x: rubble } });
    // Where it stands within its place is play's as it left it, through both.
    expect(whereOf(state, "table")).toEqual({ zone: "under the window" });
    // A grid authored with no map keeps what play drew on it through both revisions as well.
    const yard = drawnOf(playedWorld(c, state), "yard", MAP_DEFAULTS, state);
    expect([yard?.terrain, [...(yard?.blocked ?? [])]]).toEqual([["cobble", "rubble", "cobble"], [1]]);
  });
});

describe("this chat's own world across an Upgrade (DEPTH2-PLAN §2)", () => {
  test("is kept as the touched record keeps what play wrote: a change the new revision took in goes, one it changed otherwise plays on", () => {
    const a = migrateWorld(blankWorld("w_up", "Upgrade"));
    a.places.town = { id: "town", name: "Saltmarsh", fields: {} };
    a.routes.lane = { id: "lane", from: "home", to: "town", modes: { walk: { minutes: 20 } }, bidirectional: true };
    const slow: JsonObject = { id: "lane", from: "home", to: "town", modes: { walk: { minutes: 90 } }, bidirectional: true };
    const made: JsonObject = { id: "back_way", from: "town", to: "home", modes: { walk: { minutes: 30 } }, bidirectional: true };
    const state = fold(reg, a, initialState(a, "ra", reg), [
      draftEvent(a, NO_DRAFT, { collection: "routes", id: "lane", value: slow }),
      draftEvent(a, NO_DRAFT, { collection: "routes", id: "back_way", value: made }),
    ]);
    // The next revision changed the lane otherwise (the user's own edit in Build), and took in the way the chat made (kept and committed).
    const b: WorldDoc = {
      ...a,
      routes: {
        ...a.routes,
        lane: { id: "lane", from: "home", to: "town", modes: { walk: { minutes: 5 } }, bidirectional: true },
        back_way: { id: "back_way", from: "town", to: "home", modes: { walk: { minutes: 30 } }, bidirectional: true },
      },
    };
    // A later one changes the way it took in.
    const c: WorldDoc = { ...b, routes: { ...b.routes, back_way: { id: "back_way", from: "town", to: "home", modes: { walk: { minutes: 12 } }, bidirectional: true } } };
    const docs: Record<string, WorldDoc> = { ra: a, rb: b, rc: c };
    const env = { worlds: (r: string) => own(docs, r), types: reg };
    applyMarker(state, { kind: "migrate", to: "rb" }, env);
    expect(playedWorld(b, state).routes.lane?.modes.walk?.minutes).toBe(90);
    expect(Object.keys(chatDraftOf(state).routes ?? {})).toEqual(["lane"]);
    expect(playedWorld(b, state).routes.back_way).toEqual(b.routes.back_way);
    // Taken in, the way is the world's own: the document's next change of it plays. The lane plays on as the chat has it.
    applyMarker(state, { kind: "migrate", to: "rc", merge: {} }, env);
    expect(playedWorld(c, state).routes.back_way?.modes.walk?.minutes).toBe(12);
    expect(playedWorld(c, state).routes.lane?.modes.walk?.minutes).toBe(90);
  });
});
