// The world built without hand-written JSON (`harness-tools/world-build.ts`): a place, a path between
// two places, a map, what is on a map, and the map settings. Each tool writes the world's draft
// through the port a harness call is given (`worldBuild`), so what a tool says it wrote is read back
// from the store, as Build would read it; nothing reaches the chat until the draft is committed and
// the chat brought to it, which the last test walks through.

import { describe, expect, test } from "bun:test";
import { type WorldBuild, worldBuild } from "../../src/backend/agents/tools/harness-ports";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import type { WorldDoc } from "../../src/shared/world";
import { stateOf } from "../support/mind-chat";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { answer, castChat, castEnv, castTurn, noModelCalls, refusal, type TurnSetup } from "./harness-cast-kit";

const BLUEBIRD = "bluebird_coffee";
const ANCHOR = "rusty_anchor";
const TOWN = "port_alder";

/** The author's env on a fresh cast chat with the world's document in reach, and the draft as the store has it. */
async function builder(setup: TurnSetup = {}): Promise<{ rig: Rig; chatId: string; env: ToolEnv; build: WorldBuild; draft: () => Promise<WorldDoc> }> {
  const { rig, chatId } = await castChat();
  const build = await worldBuild(rig.rt, chatId, rig.host.userId);
  if (!build) throw new Error("the chat plays no world");
  const env: ToolEnv = { ...castEnv(rig, chatId, await castTurn(rig, chatId, setup)), build };
  return { rig, chatId, env, build, draft: async () => (await build.edit({ op: "get" })).draft };
}

describe("world_place", () => {
  test("makes a place from its name, changes only what a call gives, and removes it", async () => {
    const { rig, env, draft } = await builder();
    const made = await answer(env, "world_place", { name: "The Old Mill", parent: "Port Alder", scene: "exploration", visibility: "discoverable", description: "A brick mill by the weir.", fields: '{"tags":["ruin"]}' });
    expect(made).toMatchObject({ place: "the_old_mill", changed: "Made the place The Old Mill (the_old_mill)." });
    expect(String(made.next)).toContain("world_commit");
    expect((await draft()).places.the_old_mill).toEqual({ id: "the_old_mill", name: "The Old Mill", parent: TOWN, sceneType: "exploration", visibility: "discoverable", fields: { tags: ["ruin"], description: "A brick mill by the weir." } });
    // Named by its name, and only the members given change; a field given as null is taken out.
    const changed = await answer(env, "world_place", { place: "the old mill", time_zone: "America/Chicago", fields: '{"tags":null,"region":"north"}' });
    expect(changed.changed).toBe("Changed the place The Old Mill (the_old_mill): time_zone, fields.");
    expect((await draft()).places.the_old_mill).toEqual({ id: "the_old_mill", name: "The Old Mill", parent: TOWN, sceneType: "exploration", visibility: "discoverable", timeZone: "America/Chicago", fields: { region: "north", description: "A brick mill by the weir." } });
    // The same call again writes nothing.
    const again = await answer(env, "world_place", { place: "the_old_mill", time_zone: "America/Chicago" });
    expect(again.unchanged).toBeDefined();
    expect(again.draft).toEqual(changed.draft);
    const removed = await answer(env, "world_place", { place: "the_old_mill", remove: true });
    expect(removed.changed).toBe("Removed the place The Old Mill (the_old_mill).");
    expect((await draft()).places.the_old_mill).toBeUndefined();
    noModelCalls(rig);
  });

  test("refuses what it can't write, each time with what to fix", async () => {
    const { rig, env, draft } = await builder();
    const before = await draft();
    // A place that isn't there: the draft's places to choose from.
    const none = await refusal(env, "world_place", { place: "the lighthouse", name: "Lighthouse" });
    expect(none).toContain("the lighthouse");
    expect(none).toContain(BLUEBIRD);
    // A new place needs its name; one of a name the draft has is the one meant.
    expect(await refusal(env, "world_place", { parent: TOWN })).toContain("name");
    const twin = await refusal(env, "world_place", { name: "bluebird coffee" });
    expect(twin).toContain(`Bluebird Coffee (${BLUEBIRD})`);
    expect(twin).toContain("name it in place");
    expect(await refusal(env, "world_place", { name: "Second Bluebird", id: BLUEBIRD })).toContain("give another id");
    expect(await refusal(env, "world_place", { place: BLUEBIRD, id: "bluebird" })).toContain("keeps its id");
    // A parent inside the place itself, a scene type the world doesn't have, a zone the engine doesn't know, fields that aren't an object.
    expect(await refusal(env, "world_place", { place: TOWN, parent: BLUEBIRD })).toContain("can't be inside itself");
    expect(await refusal(env, "world_place", { place: BLUEBIRD, scene: "heist" })).toContain("downtime");
    expect(await refusal(env, "world_place", { place: BLUEBIRD, time_zone: "Mars/Olympus" })).toContain("America/Chicago");
    expect(await refusal(env, "world_place", { place: BLUEBIRD, visibility: "hidden" })).toContain("discoverable");
    expect(await refusal(env, "world_place", { place: BLUEBIRD, fields: "tags: shop" })).toContain("JSON object");
    expect(await refusal(env, "world_place", { place: BLUEBIRD })).toContain("nothing to change");
    expect(await refusal(env, "world_place", { remove: true })).toContain("place");
    expect(await draft()).toEqual(before);
    noModelCalls(rig);
  });

  test("is refused to a caller below the game master's tier, and a place a map draws is changed in its map", async () => {
    const { rig, chatId, env, build, draft } = await builder();
    const helper: ToolEnv = { ...castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), "scribe"), build };
    for (const [name, args] of [
      ["world_place", { name: "The Old Mill" }],
      ["world_path", { from: HOME, to: BLUEBIRD, minutes: 3 }],
      ["world_map", { scope: TOWN, title: "Town" }],
      ["world_map_place", { map: "town", name: "Quay" }],
      ["world_map_link", { map: "town", from: "quay", to: HOME, minutes: 3 }],
      ["world_map_settings", { display: "fog" }],
    ] as const) expect(await refusal(helper, name, args)).toContain("game master's tier");
    expect((await draft()).places.the_old_mill).toBeUndefined();
    await answer(env, "world_map", { scope: TOWN, title: "Town" });
    await answer(env, "world_map_place", { map: "town", name: "Quay" });
    const drawn = await refusal(env, "world_place", { place: "Quay", description: "Wet stone." });
    expect(drawn).toContain("drawn by the map town");
    expect(drawn).toContain("world_map_place");
    noModelCalls(rig);
  });
});

describe("world_path", () => {
  test("connects two places, reuses the route they have, turns it one-way and disconnects them", async () => {
    const { rig, env, draft } = await builder();
    const id = `rt_${BLUEBIRD}_${ANCHOR}`;
    const made = await answer(env, "world_path", { from: "Bluebird Coffee", to: ANCHOR, minutes: 5, km: 0.4, terrain: "paved" });
    expect(made).toMatchObject({ route: id, changed: `Made the path between Bluebird Coffee and The Rusty Anchor (${id}).` });
    expect((await draft()).routes[id]).toEqual({ id, from: BLUEBIRD, to: ANCHOR, modes: { walk: { minutes: 5, distanceKm: 0.4, terrain: "paved" } }, bidirectional: true });
    // Named from its other end, the same route takes a second mode and keeps the first.
    expect((await answer(env, "world_path", { from: ANCHOR, to: BLUEBIRD, mode: "road", minutes: 2 })).route).toBe(id);
    expect((await draft()).routes[id]?.modes).toEqual({ walk: { minutes: 5, distanceKm: 0.4, terrain: "paved" }, road: { minutes: 2 } });
    // A route of the world's own is changed in place: its distance stays.
    expect((await answer(env, "world_path", { from: HOME, to: BLUEBIRD, minutes: 3 })).route).toBe("rt_home_bluebird");
    expect((await draft()).routes.rt_home_bluebird).toMatchObject({ from: HOME, to: BLUEBIRD, modes: { walk: { minutes: 3, distanceKm: 0.1 } }, bidirectional: true });
    // One-way, it runs as the call says; a call against it is told how to turn it.
    await answer(env, "world_path", { from: ANCHOR, to: BLUEBIRD, one_way: true });
    expect((await draft()).routes[id]).toMatchObject({ from: ANCHOR, to: BLUEBIRD, bidirectional: false });
    const against = await refusal(env, "world_path", { from: BLUEBIRD, to: ANCHOR, minutes: 6 });
    expect(against).toContain(`from ${ANCHOR} to ${BLUEBIRD}`);
    expect(against).toContain("one_way: false");
    await answer(env, "world_path", { from: BLUEBIRD, to: ANCHOR, one_way: false });
    expect((await draft()).routes[id]?.bidirectional).toBe(true);
    // One mode goes, then the route.
    const mode = await answer(env, "world_path", { from: BLUEBIRD, to: ANCHOR, mode: "road", remove: true });
    expect(String(mode.changed)).toContain("the road way");
    expect(Object.keys((await draft()).routes[id]?.modes ?? {})).toEqual(["walk"]);
    await answer(env, "world_path", { from: BLUEBIRD, to: ANCHOR, remove: true });
    expect((await draft()).routes[id]).toBeUndefined();
    noModelCalls(rig);
  });

  test("refuses what it can't write, each time with what to fix", async () => {
    const { rig, env, draft } = await builder();
    const before = await draft();
    const none = await refusal(env, "world_path", { from: "the lighthouse", to: BLUEBIRD, minutes: 3 });
    expect(none).toContain("the lighthouse");
    expect(none).toContain(ANCHOR);
    expect(await refusal(env, "world_path", { from: BLUEBIRD, to: "Bluebird Coffee", minutes: 3 })).toContain("two different places");
    expect(await refusal(env, "world_path", { from: BLUEBIRD, to: ANCHOR, mode: "rail", minutes: 3 })).toContain("offroad");
    // A new path needs its minutes, above 0.
    expect(await refusal(env, "world_path", { from: BLUEBIRD, to: ANCHOR })).toContain("minutes");
    expect(await refusal(env, "world_path", { from: BLUEBIRD, to: ANCHOR, minutes: 0 })).toContain("above 0");
    expect(await refusal(env, "world_path", { from: HOME, to: BLUEBIRD })).toContain("nothing to change");
    // Nothing to disconnect: the places the first does have paths to.
    const apart = await refusal(env, "world_path", { from: BLUEBIRD, to: ANCHOR, remove: true });
    expect(apart).toContain("nothing to remove");
    expect(apart).toContain(HOME);
    expect(await refusal(env, "world_path", { from: HOME, to: BLUEBIRD, mode: "water", remove: true })).toContain("Its modes: walk");
    expect(await draft()).toEqual(before);
    // A path a map draws is the map's.
    await answer(env, "world_map", { scope: TOWN, title: "Town" });
    await answer(env, "world_map_place", { map: "town", name: "Quay" });
    await answer(env, "world_map_place", { map: "town", name: "Weir" });
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "weir", minutes: 4 });
    const drawn = await refusal(env, "world_path", { from: "Weir", to: "Quay", minutes: 9 });
    expect(drawn).toContain("drawn by the map town");
    expect(drawn).toContain("world_map_link");
    noModelCalls(rig);
  });
});

describe("world_map", () => {
  test("makes a node map from its title, changes it, and takes it out with what it made", async () => {
    const { rig, env, draft } = await builder();
    const made = await answer(env, "world_map", { scope: "Port Alder", title: "Port Alder streets", width: 100, height: 60 });
    expect(made).toMatchObject({ map: "port_alder_streets", changed: "Made the map port_alder_streets." });
    expect((await draft()).maps.port_alder_streets).toEqual({ id: "port_alder_streets", scope: TOWN, title: "Port Alder streets", size: [100, 60] });
    // Named by its title; the height alone keeps the width.
    const changed = await answer(env, "world_map", { map: "Port Alder streets", title: "Streets", height: 80 });
    expect(changed.changed).toBe("Changed the map port_alder_streets: title, height.");
    expect((await draft()).maps.port_alder_streets).toEqual({ id: "port_alder_streets", scope: TOWN, title: "Streets", size: [100, 80] });
    expect((await answer(env, "world_map", { map: "port_alder_streets", title: "Streets" })).unchanged).toBeDefined();
    await answer(env, "world_map_place", { map: "port_alder_streets", name: "Quay" });
    expect((await draft()).places.quay?.map).toBe("port_alder_streets");
    await answer(env, "world_map", { map: "port_alder_streets", remove: true });
    const after = await draft();
    expect(after.maps.port_alder_streets).toBeUndefined();
    expect(after.places.quay).toBeUndefined();
    noModelCalls(rig);
  });

  test("draws a grid map from its rows and legend, once the map has the places the legend names", async () => {
    const { rig, env, draft } = await builder();
    await answer(env, "world_map", { map: "home_floor", scope: HOME, title: "Ground floor" });
    const rows = ["#####", "#k+b#", "#####"];
    const legend = '{"k":{"place":"kitchen"},"b":{"place":"bedroom"}}';
    // The legend names places the map doesn't have yet: the engine's own check says so, and nothing is written.
    const early = await refusal(env, "world_map", { map: "home_floor", layout: rows, legend });
    expect(early).toContain(`"kitchen" isn't one of this map's places`);
    expect((await draft()).maps.home_floor?.layout).toBeUndefined();
    await answer(env, "world_map_place", { map: "home_floor", name: "Kitchen" });
    await answer(env, "world_map_place", { map: "home_floor", name: "Bedroom" });
    await answer(env, "world_map", { map: "home_floor", layout: rows, legend, cell_meters: 2 });
    const doc = await draft();
    expect(doc.maps.home_floor).toMatchObject({ layout: rows, legend: { k: { place: "kitchen" }, b: { place: "bedroom" } }, cellMeters: 2 });
    // The store compiled it: the home has the map's grid, and each room its cell.
    expect(doc.grids.home_floor).toMatchObject({ width: 5, height: 3, map: "home_floor" });
    expect(doc.places[HOME]?.grid).toBe("home_floor");
    expect(doc.places.kitchen).toMatchObject({ parent: HOME, map: "home_floor", cell: { x: 1, y: 1 } });
    // One character of the legend changes, the rest stay.
    await answer(env, "world_map", { map: "home_floor", legend: '{"b":null}', layout: ["#####", "#k+.#", "#####"] });
    expect((await draft()).maps.home_floor?.legend).toEqual({ k: { place: "kitchen" } });
    noModelCalls(rig);
  });

  test("refuses what it can't write, each time with what to fix", async () => {
    const { rig, env, draft } = await builder();
    const before = await draft();
    // No map of that name, and no place given for a new one to draw.
    const none = await refusal(env, "world_map", { map: "harbour", title: "Harbour" });
    expect(none).toContain("harbour");
    expect(none).toContain("scope");
    expect(await refusal(env, "world_map", { title: "Harbour" })).toContain("scope");
    expect(await refusal(env, "world_map", { scope: TOWN })).toContain("map");
    expect(await refusal(env, "world_map", { scope: "the lighthouse", title: "Harbour" })).toContain(BLUEBIRD);
    // The engine's own checks of a map: an id it can't have, rows of different widths.
    expect(await refusal(env, "world_map", { map: "the harbour!", scope: TOWN })).toContain("letters, digits");
    expect(await refusal(env, "world_map", { scope: TOWN, title: "Harbour", layout: ["###", "#"] })).toContain("row 2 is 1 wide");
    expect(await refusal(env, "world_map", { scope: TOWN, title: "Harbour", layout: "###" })).toContain("list of rows");
    expect(await refusal(env, "world_map", { scope: TOWN, title: "Harbour", legend: "k is the kitchen" })).toContain("JSON object");
    expect(await refusal(env, "world_map", { scope: TOWN, title: "Harbour", width: 40 })).toContain("width and height go together");
    expect(await refusal(env, "world_map", { scope: TOWN, title: "Harbour", width: 2.5, height: 4 })).toContain("whole number");
    expect(await refusal(env, "world_map", { map: "harbour", remove: true })).toContain("no map");
    expect(await draft()).toEqual(before);
    await answer(env, "world_map", { scope: TOWN, title: "Harbour" });
    expect(await refusal(env, "world_map", { scope: TOWN, title: "Harbour" })).toContain("name it in map");
    expect(await refusal(env, "world_map", { map: "harbour" })).toContain("nothing to change");
    noModelCalls(rig);
  });
});

describe("world_map_place", () => {
  test("puts a place on a map, moves it, renames it, says which map it opens into, and takes it off", async () => {
    const { rig, env, draft } = await builder();
    await answer(env, "world_map", { scope: TOWN, title: "Town", width: 100, height: 60 });
    const put = await answer(env, "world_map_place", { map: "Town", name: "Quay Market", x: 10, y: 20 });
    expect(put).toMatchObject({ map: "town", place: "quay_market", changed: "Made Quay Market (quay_market) on the map town." });
    expect((await draft()).maps.town?.places).toEqual([{ id: "quay_market", name: "Quay Market", at: [10, 20] }]);
    // The store compiled it into a place of the world, inside the map's scope.
    expect((await draft()).places.quay_market).toEqual({ id: "quay_market", name: "Quay Market", parent: TOWN, fields: {}, map: "town", layoutPos: { x: 10, y: 20 } });
    // Moved along one axis, the other stays; renamed, it keeps its id.
    await answer(env, "world_map_place", { map: "town", place: "Quay Market", x: 30 });
    await answer(env, "world_map_place", { map: "town", place: "quay_market", name: "Fish Market" });
    expect((await draft()).maps.town?.places).toEqual([{ id: "quay_market", name: "Fish Market", at: [30, 20] }]);
    // The map of its inside is made first, then named.
    await answer(env, "world_map", { scope: "Fish Market", title: "Market stalls" });
    await answer(env, "world_map_place", { map: "town", place: "Fish Market", opens: "Market stalls" });
    expect((await draft()).maps.town?.places?.[0]?.opens).toBe("market_stalls");
    // Taken off, it goes with the map's links to it.
    await answer(env, "world_map_place", { map: "town", name: "Weir" });
    await answer(env, "world_map_link", { map: "town", from: "weir", to: "quay_market", minutes: 4 });
    await answer(env, "world_map_place", { map: "town", place: "weir", remove: true });
    const doc = await draft();
    expect(doc.maps.town?.links).toEqual([]);
    expect(doc.places.weir).toBeUndefined();
    noModelCalls(rig);
  });

  test("refuses what it can't write, each time with what to fix", async () => {
    const { rig, env, draft } = await builder();
    expect(await refusal(env, "world_map_place", { map: "town", name: "Quay" })).toContain("world_map with scope");
    await answer(env, "world_map", { scope: TOWN, title: "Town", width: 100, height: 60 });
    await answer(env, "world_map", { map: "cafe_floor", scope: BLUEBIRD });
    await answer(env, "world_map_place", { map: "town", name: "Quay" });
    const before = await draft();
    expect(await refusal(env, "world_map_place", {})).toContain("map");
    expect(await refusal(env, "world_map_place", { map: "town" })).toContain("name");
    // A place the map doesn't have: the ones it has.
    const none = await refusal(env, "world_map_place", { map: "town", place: "Weir", x: 1, y: 1 });
    expect(none).toContain("Its places, by id: quay");
    // A map's place is new to the world: an id the world has is refused by the engine's own check.
    expect(await refusal(env, "world_map_place", { map: "town", name: "Bluebird Coffee" })).toContain("give this one another id");
    expect(await refusal(env, "world_map_place", { map: "town", name: "quay" })).toContain("name it in place");
    expect(await refusal(env, "world_map_place", { map: "town", place: "quay", id: "wharf" })).toContain("keeps its id");
    expect(await refusal(env, "world_map_place", { map: "town", name: "Weir", x: 4 })).toContain("x and y go together");
    expect(await refusal(env, "world_map_place", { map: "town", name: "Weir", x: 400, y: 4 })).toContain("outside the 100 × 60 map");
    expect(await refusal(env, "world_map_place", { map: "town", place: "quay", opens: "cellar" })).toContain("cafe_floor");
    expect(await refusal(env, "world_map_place", { map: "town", place: "quay", opens: "cafe_floor" })).toContain(`draws "${BLUEBIRD}"`);
    expect(await refusal(env, "world_map_place", { map: "town", place: "quay" })).toContain("nothing to change");
    expect(await refusal(env, "world_map_place", { map: "town", remove: true })).toContain("place");
    expect(await draft()).toEqual(before);
    noModelCalls(rig);
  });
});

describe("world_map_link", () => {
  test("links two of a map's places, changes the link, and removes it", async () => {
    const { rig, env, draft } = await builder();
    await answer(env, "world_map", { scope: TOWN, title: "Town" });
    await answer(env, "world_map_place", { map: "town", name: "Quay" });
    await answer(env, "world_map_place", { map: "town", name: "Weir" });
    const made = await answer(env, "world_map_link", { map: "town", from: "Quay", to: "Weir", minutes: 4 });
    expect(made).toMatchObject({ map: "town", changed: "Made the link between quay and weir on the map town." });
    expect((await draft()).maps.town?.links).toEqual([{ from: "quay", to: "weir", minutes: 4 }]);
    // The store compiled it into a route of the world, the map's own.
    expect((await draft()).routes["town:quay:weir"]).toEqual({ id: "town:quay:weir", from: "quay", to: "weir", modes: { walk: { minutes: 4 } }, bidirectional: true, map: "town" });
    // Named from its other end: its minutes change; one-way, it runs as the call says.
    await answer(env, "world_map_link", { map: "town", from: "weir", to: "quay", minutes: 6 });
    expect((await draft()).maps.town?.links).toEqual([{ from: "quay", to: "weir", minutes: 6 }]);
    await answer(env, "world_map_link", { map: "town", from: "weir", to: "quay", one_way: true });
    expect((await draft()).maps.town?.links).toEqual([{ from: "weir", to: "quay", minutes: 6, bidirectional: false }]);
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir", minutes: 5 })).toContain("one_way: false");
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "weir", one_way: false });
    // A second way of travelling is a second link; without a mode, the call must say which.
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "weir", mode: "road", minutes: 1 });
    expect((await draft()).maps.town?.links).toEqual([{ from: "weir", to: "quay", minutes: 6 }, { from: "quay", to: "weir", mode: "road", minutes: 1 }]);
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir", minutes: 2 })).toContain("walk, road");
    // A link may lead to a place that isn't the map's.
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "Bluebird Coffee", minutes: 3 });
    expect((await draft()).routes[`town:quay:${BLUEBIRD}`]?.map).toBe("town");
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "weir", mode: "road", remove: true });
    expect((await draft()).maps.town?.links).toEqual([{ from: "weir", to: "quay", minutes: 6 }, { from: "quay", to: BLUEBIRD, minutes: 3 }]);
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "weir", remove: true });
    expect((await draft()).routes["town:weir:quay"]).toBeUndefined();
    noModelCalls(rig);
  });

  test("refuses what it can't write, each time with what to fix", async () => {
    const { rig, env, draft } = await builder();
    await answer(env, "world_map", { scope: TOWN, title: "Town" });
    await answer(env, "world_map_place", { map: "town", name: "Quay" });
    await answer(env, "world_map_place", { map: "town", name: "Weir" });
    const before = await draft();
    expect(await refusal(env, "world_map_link", { map: "harbour", from: "quay", to: "weir", minutes: 4 })).toContain("Its maps, by id: town");
    const none = await refusal(env, "world_map_link", { map: "town", from: "quay", to: "the lighthouse", minutes: 4 });
    expect(none).toContain("the lighthouse");
    expect(none).toContain("weir");
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "Quay", minutes: 4 })).toContain("two different places");
    // A new link needs its minutes, above 0; a map's link is never by air.
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir" })).toContain("minutes");
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir", minutes: -2 })).toContain("above 0");
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir", mode: "air", minutes: 4 })).toContain("walk, road, offroad, water");
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir", remove: true })).toContain("nothing to remove");
    expect(await draft()).toEqual(before);
    await answer(env, "world_map_link", { map: "town", from: "quay", to: "weir", minutes: 4 });
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir" })).toContain("nothing to change");
    expect(await refusal(env, "world_map_link", { map: "town", from: "quay", to: "weir", mode: "water", remove: true })).toContain("quay - weir (walk)");
    noModelCalls(rig);
  });
});

describe("world_map_settings", () => {
  test("changes only the settings a call gives, and writes nothing for the settings the world already plays by", async () => {
    const { rig, env, draft } = await builder();
    // The defaults, on a world that keeps no map settings: nothing to write.
    const same = await answer(env, "world_map_settings", { display: "knowledge", grid_movement: false });
    expect(same.unchanged).toBeDefined();
    expect((await draft()).mapSettings).toBeUndefined();
    const set = await answer(env, "world_map_settings", { display: "fog", grid_movement: true, sight_radius: 5 });
    expect(set).toMatchObject({ changed: "Changed the map settings: display, grid_movement, sight_radius.", settings: { display: "fog", grid_movement: true, sight_radius: 5, travel_simulation: false } });
    expect((await draft()).mapSettings).toEqual({ display: "fog", grid: { movement: true, sightRadius: 5 } });
    await answer(env, "world_map_settings", { travel_simulation: true });
    expect((await draft()).mapSettings).toEqual({ display: "fog", grid: { movement: true, sightRadius: 5 }, travelSimulation: true });
    expect((await answer(env, "world_map_settings", { travel_simulation: true })).unchanged).toBeDefined();
    noModelCalls(rig);
  });

  test("refuses what it can't write, each time with what to fix", async () => {
    const { rig, env, draft } = await builder();
    expect(await refusal(env, "world_map_settings", {})).toContain("display, grid_movement, sight_radius, travel_simulation");
    expect(await refusal(env, "world_map_settings", { display: "dark" })).toContain("knowledge, fog");
    expect(await refusal(env, "world_map_settings", { sight_radius: 99 })).toContain("from 0 to 32");
    expect(await refusal(env, "world_map_settings", { sight_radius: 2.5 })).toContain("whole number");
    expect((await draft()).mapSettings).toBeUndefined();
    noModelCalls(rig);
  });
});

describe("a place, its paths, its map", () => {
  test("are built in the draft, and the chat plays them once the draft is committed and the chat brought to it", async () => {
    const { rig, chatId, env, build } = await builder();
    const start = (await stateOf(rig, chatId)).state.revision;
    await answer(env, "world_place", { name: "The Old Mill", parent: TOWN, scene: "exploration", description: "A brick mill by the weir." });
    const path = await answer(env, "world_path", { from: "The Old Mill", to: "Bluebird Coffee", minutes: 7, km: 0.5 });
    await answer(env, "world_map", { scope: "The Old Mill", title: "Mill yard" });
    await answer(env, "world_map_place", { map: "mill_yard", name: "Wheel House", x: 2, y: 3 });
    await answer(env, "world_map_place", { map: "mill_yard", name: "Grain Loft", x: 6, y: 3 });
    const linked = await answer(env, "world_map_link", { map: "mill_yard", from: "Wheel House", to: "Grain Loft", minutes: 2, mode: "walk" });
    // No write brought an error, and every answer says the draft isn't played yet.
    expect(linked.lint).not.toHaveProperty("errors");
    expect(String(linked.next)).toContain(start);
    expect((await stateOf(rig, chatId)).world.places.the_old_mill).toBeUndefined();
    // Committed and upgraded through the port, as world_commit and world_upgrade do.
    const { revision } = await build.commit("the old mill and its yard");
    expect(await build.head()).toBe(revision);
    expect(await build.upgrade(revision)).toEqual({ pending: false });
    const { state, world } = await stateOf(rig, chatId);
    expect(state.revision).toBe(revision);
    expect(world.places.the_old_mill).toMatchObject({ name: "The Old Mill", parent: TOWN, sceneType: "exploration", fields: { description: "A brick mill by the weir." } });
    expect(world.routes[String(path.route)]).toEqual({ id: `rt_the_old_mill_${BLUEBIRD}`, from: "the_old_mill", to: BLUEBIRD, modes: { walk: { minutes: 7, distanceKm: 0.5 } }, bidirectional: true });
    expect(world.places.wheel_house).toMatchObject({ name: "Wheel House", parent: "the_old_mill", map: "mill_yard", layoutPos: { x: 2, y: 3 } });
    expect(world.routes["mill_yard:wheel_house:grain_loft"]).toMatchObject({ from: "wheel_house", to: "grain_loft", modes: { walk: { minutes: 2 } }, map: "mill_yard" });
    noModelCalls(rig);
  });
});
