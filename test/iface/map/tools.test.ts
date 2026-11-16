// The map tools through their own `run`, on invented maps (plan §8.2, scenarios 60 to 63 of
// §17.4): someone crosses a room and the map shows it; a locked door shuts the way and the view
// until it is opened; a lantern laid on a table shares its square and moves with it; a grid of 5 ft
// squares laid for a place with no map counts rounds of six seconds; a swipe of the turn that locked
// a door leaves it as drawn; and the map shows in `world_query`. Every word of every answer is a
// line of the map's part, or the map's own picture.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HostTool, JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { isRecord } from "../../../src/shared/json";
import { WriteQueue } from "../../../src/app/database";
import { hashJson } from "../../../src/shared/hash";
import type { WorldDoc } from "../../../src/shared/world";
import { migrateStore } from "../../../src/store/schema";
import { openStore, type UserStore } from "../../../src/store/store";
import { type EngineDeps, engineTools, Lines, mapLines, mapView, SHIPPED_GUIDANCE, shippedTexts, stateScan } from "../../../src/iface/index";
import { CELLAR, INN, registry, TOWN, worldWith } from "./fixtures";

const USER = "user-a";
const CHAT = "chat-a";
const SRC = { source: { from: "prose", message: "m-1" } } as const;

/** A line any text fills (one that is all fields) proves nothing, so the checks leave it out. */
const SENTINEL = "\u0001 no line of any part says this";
const strict = (text: string): RegExp[] => Lines.parse(text, "answers").patterns().filter((p) => !p.test(SENTINEL));
const mapPatterns = strict(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "map-answers.md")).text());

/** A store over `world` with one chat and a first turn, and the engine's tools, called on a turn (the first unless named). */
async function mapRig(world: WorldDoc, more: (deps: EngineDeps) => Promise<Partial<EngineDeps>> = async () => ({})) {
  const revision = hashJson(world);
  const db = new Database(":memory:");
  migrateStore(db);
  const env = { registry: registry(), worlds: (r: string) => (r === revision ? world : undefined) };
  const store = openStore({ db, ...env });
  const writes = new WriteQueue(db, 10);
  const s: UserStore = store.user(USER);
  await writes.run(() => s.createChat({ id: CHAT, world: world.id, revision }));
  const first = await writes.run(() => s.beginTurn({ chat: CHAT, kind: "new" }));
  const base: EngineDeps = { store: s, env, writes, files: shippedTexts(), search: stateScan };
  const deps: EngineDeps = { ...base, ...(await more(base)) };
  const tools = new Map<string, HostTool>((await engineTools(deps)).map((t) => [t.name, t]));
  const call = async (name: string, args: JsonObject, turn: string = first.id): Promise<ToolResult> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn }, agent: { id: "gm-1", definition: "gm", parent: "author-1" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tool.run(args, ctx);
  };
  return { s, writes, first, call, tools };
}

function texts(r: ToolResult): string[] {
  return r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));
}

/** How each part of an answer came to be: data, a line, or a tree. */
function kindsOf(r: ToolResult): string[] {
  const parts = isRecord(r.details) ? r.details.parts : undefined;
  return Array.isArray(parts) ? parts.filter((p): p is string => typeof p === "string") : [];
}

function dataOf(r: ToolResult): JsonObject {
  const at = kindsOf(r).indexOf("data");
  const parsed: unknown = at < 0 ? {} : JSON.parse(texts(r)[at] ?? "{}");
  return isRecord(parsed) ? (parsed as JsonObject) : {};
}

/** A line of the map's picture: the column numbers, or a row's number and its symbols. */
const PICTURE = /^(?: {6}\d+(?: \d+)*| {0,3}\d+ {2}.*)$/;

/** Every part of an answer is data, a line of an answers' part, or a map whose every line is one of the map's lines or its picture; every report is a line. */
function wordsFromFiles(r: ToolResult, patterns: readonly RegExp[] = mapPatterns): void {
  const kinds = kindsOf(r);
  texts(r).forEach((text, i) => {
    if (kinds[i] === "data") return;
    if (kinds[i] === "tree") {
      for (const l of text.split("\n")) if (l !== "") expect({ line: l, ok: PICTURE.test(l) || mapPatterns.some((p) => p.test(l)) }).toEqual({ line: l, ok: true });
      return;
    }
    expect({ text, ok: patterns.some((p) => p.test(text)) }).toEqual({ text, ok: true });
  });
  for (const rep of r.reports ?? []) expect({ rep, ok: patterns.some((p) => p.test(rep)) }).toEqual({ rep, ok: true });
}

/** The answer's one operation. */
function opOf(r: ToolResult): JsonObject {
  return ((dataOf(r).operations as JsonObject[] | undefined) ?? [])[0] ?? {};
}

describe("map_place and map_view", () => {
  test("someone crosses the room: the way and its time are told, and the map shows them where they stand", async () => {
    const t = await mapRig(worldWith(INN));
    const placed = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wren", square: [2, 5] }, { who: "Bram", square: [4, 3] }], standing: "assumed", ...SRC });
    expect(placed.error).toBeUndefined();
    expect(opOf(placed)).toMatchObject({ op: "map_place", lane: "engine", applied: true, standing: "assumed" });
    wordsFromFiles(placed);

    const crossed = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wren", square: [11, 5], walk: true }], ...SRC });
    expect(texts(crossed)).toContain("Wren [wren] walked from (2,5) to (11,5): 9 squares (45 ft), 9 squares of movement, 2 rounds, 12 seconds.");
    expect((opOf(crossed).pieces as JsonObject[])[0]).toMatchObject({ who: "Wren [wren]", at: [11, 5], way: { distance: 9, rounds: 2, seconds: 12 } });
    expect((dataOf(crossed).changed as JsonObject[]).some((c) => c.at === "entity:wren")).toBe(true);
    wordsFromFiles(crossed);

    const shown = await t.call("map_view", { at: "The Common Room" });
    const map = texts(shown)[0] ?? "";
    expect(map).toContain("Map: The Common Room. 12 by 8 squares of 5 ft, counted in rounds of 6 seconds. North is up.");
    expect(map).toContain("   1  # # # # # + # # # #  #  #");
    expect(map).toContain("   you, Wren [wren] (11,5)");
    expect(map).toContain("   Bram [bram] (4,3), 35 ft from you");
    wordsFromFiles(shown);
  });

  test("someone put inside a wall is put there all the same, and the answer says so", async () => {
    const t = await mapRig(worldWith(INN));
    const r = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Bram", square: [1, 4] }], ...SRC });
    expect(opOf(r).applied).toBe(true);
    expect(r.reports ?? []).toEqual(["map_place: Bram [bram] stands on (1,4), which block the way; it was put there all the same."]);
    wordsFromFiles(r);
  });

  test("a lantern laid on the table shares its square and moves with it", async () => {
    const t = await mapRig(worldWith(INN));
    await t.call("map_place", { at: "The Common Room", pieces: [{ who: "long table", square: [9, 2], size: [2, 2], blocks: "way" }, { who: "lantern", square: [2, 2] }], ...SRC });
    const laid = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "lantern", on: "long table" }], ...SRC });
    expect(texts(laid)).toContain("Lantern [lantern] lies on Long table [long_table], at (9,2).");
    wordsFromFiles(laid);
    const moved = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "long table", square: [3, 6] }], ...SRC });
    expect(moved.error).toBeUndefined();
    const map = texts(await t.call("map_view", { at: "The Common Room" }))[0] ?? "";
    expect(map).toContain("   Lantern [lantern], on Long table (3,6)");
    expect(map).toContain("   Long table [long_table] (3,6), 2 by 2 squares, blocking the way");
  });

  test("a name that is not there, or a square off the map, records nothing and says why", async () => {
    const t = await mapRig(worldWith(INN));
    const unknown = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wrenna Q", square: [2, 2] }], ...SRC });
    const off = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wren", square: [13, 2] }], ...SRC });
    expect([unknown.error, off.error]).toEqual([true, true]);
    expect(texts(off)[0]).toBe("square: square (13,2) is off the map of The Common Room [common_room], which is 12 by 8 squares.");
    expect(t.s.changes(t.first.id).length).toBe(0);
    wordsFromFiles(unknown);
    wordsFromFiles(off);
  });
});

describe("map_door and map_measure", () => {
  test("a locked door: no way and no line of sight through it until it is opened", async () => {
    const t = await mapRig(worldWith(CELLAR));
    await t.call("map_place", { at: "The Cellar", pieces: [{ who: "Odile", square: [2, 3] }], ...SRC });
    const locked = await t.call("map_door", { at: "The Cellar", door: [5, 3], state: "locked", ...SRC });
    expect(texts(locked)).toContain("The door at (5,3) is locked now; it was open.");
    expect(opOf(locked).door).toEqual({ at: [5, 3], was: "open", now: "locked" });
    wordsFromFiles(locked);

    const shut = await t.call("map_measure", { from: "Odile", to: [8, 3] });
    expect(texts(shut)).toContain("Odile (2,3) and (8,3) cannot see each other: a wall, a door that is not open, or something that blocks the view is between them.");
    expect(texts(shut)).toContain("There is no way from Odile (2,3) to (8,3) as the map stands: walls, doors that are not open, or what blocks the way close it.");
    expect(dataOf(shut)).toMatchObject({ squares: 6, sees: false, way: null });
    wordsFromFiles(shut);

    await t.call("map_door", { at: "The Cellar", door: [5, 3], state: "open", ...SRC });
    const open = await t.call("map_measure", { from: "Odile", to: [8, 3] });
    expect(dataOf(open)).toMatchObject({ sees: true, way: { distance: 6, rounds: 1, seconds: 6 } });
    expect(texts(open)).toContain("The way from Odile (2,3) to (8,3) is 6 squares (30 ft) and costs 6 squares of movement: 1 round, 6 seconds.");
    wordsFromFiles(open);
  });

  test("a square with no door is refused with the doors there are", async () => {
    const t = await mapRig(worldWith(CELLAR));
    const r = await t.call("map_door", { at: "The Cellar", door: [3, 3], state: "locked", ...SRC });
    expect(r.error).toBe(true);
    expect(texts(r)[0]).toBe("map_door: there is no door at (3,3) on the map of The Cellar [cellar]. Its doors: (5,3).");
    wordsFromFiles(r);
  });

  test("map_door takes no reason, since a door's state keeps none", async () => {
    const t = await mapRig(worldWith(CELLAR));
    const takes = (name: string): string[] => {
      const schema = t.tools.get(name)?.parameters;
      return isRecord(schema) && isRecord(schema.properties) ? Object.keys(schema.properties) : [];
    };
    expect(takes("map_door")).toEqual(["at", "door", "state", "source", "precision", "standing"]);
    // map_place keeps its reason with a thing that comes to someone by it, through today's item moves.
    expect(takes("map_place")).toContain("why");
  });

  test("the way to something that blocks the way is measured across open floor, whichever end it is", async () => {
    const t = await mapRig(worldWith(INN));
    await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wren", square: [2, 5] }, { who: "chest", square: [6, 5], blocks: "way" }], ...SRC });
    const there = await t.call("map_measure", { from: "Wren", to: "chest" });
    const back = await t.call("map_measure", { from: "chest", to: "Wren" });
    expect(dataOf(there)).toMatchObject({ squares: 4, sees: true, way: { distance: 4, cost: 4, rounds: 1, seconds: 6 } });
    expect(dataOf(back)).toMatchObject({ squares: 4, sees: true, way: { distance: 4, cost: 4, rounds: 1, seconds: 6 } });
    expect(texts(there)).toContain("The way from Wren (2,5) to Iron-bound chest (6,5) is 4 squares (20 ft) and costs 4 squares of movement: 1 round, 6 seconds.");
    wordsFromFiles(there);
  });

  test("a list in an answer is said once, however many it holds", async () => {
    const t = await mapRig(worldWith(INN));
    const zoned = await t.call("map_lay", { place: "The Far Road", rows: ["#####", "#zzy#", "#zzy#", "#####"], legend: { z: { zone: "verge" }, y: { zone: "ditch" } }, ...SRC });
    expect(zoned.error).toBeUndefined();
    await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wren", square: [3, 3] }, { who: "Bram", square: [4, 3] }], ...SRC });
    const said = async (name: string, args: JsonObject): Promise<string> => texts(await t.call(name, args))[0] ?? "";
    expect(await said("map_measure", { from: "Wren", area: "square", size: 1 })).toBe('area cannot be read: you sent "square". It is one of: burst, cone, line.');
    expect(await said("map_place", { at: "The Common Room", pieces: [{ who: "Wren", blocks: "walls" }], ...SRC })).toBe('map_place: blocks cannot be read, you sent "walls". It is one of: way, view, both, none.');
    expect(await said("map_place", { at: "The Common Room", pieces: [{ who: "Tram", square: [2, 2] }], ...SRC })).toBe("map_place: there is nothing called Tram that is a person or a thing. Near: Bram [bram], Tam [tam].");
    expect(await said("map_door", { at: "The Common Room", door: [3, 3], state: "open", ...SRC })).toBe("map_door: there is no door at (3,3) on the map of The Common Room [common_room]. Its doors: (6,1), (12,5).");
    expect(await said("map_place", { at: "The Far Road", pieces: [{ who: "Tam", zone: "bank" }], ...SRC })).toBe("map_place: this map has no zone bank. Its zones: ditch, verge.");
    const burst = await t.call("map_measure", { from: "Wren", area: "burst", size: 1 });
    expect(texts(burst)).toContain("The burst from Wren (3,3), 1 squares (5 ft), covers 8 squares. In it: Bram [bram], Wren [wren].");
    const edited = await t.call("map_edit", { at: "The Common Room", strokes: [{ symbol: "b", squares: [[2, 6]] }], legend: { b: { terrain: "bench", blocked: true }, s: { terrain: "straw" } }, ...SRC });
    expect(texts(edited)).toContain("1 squares of the map of The Common Room [common_room] were drawn anew, and its legend changed for b, s.");
  });

  test("ranges and areas: who stands within reach, and what a burst covers short of the walls", async () => {
    const t = await mapRig(worldWith(CELLAR));
    await t.call("map_place", { at: "The Cellar", pieces: [{ who: "Odile", square: [2, 2] }, { who: "cask", square: [3, 4] }], ...SRC });
    const r = await t.call("map_measure", { from: "Odile", within: 2, area: "burst", size: 1 });
    expect(dataOf(r)).toMatchObject({ within: { range: 2, who: ["Cask of cider [cask]"] }, area: { kind: "burst", size: 1, who: ["Odile [odile]"] } });
    expect(((dataOf(r).area as JsonObject).squares as unknown[]).length).toBe(4);
    wordsFromFiles(r);
  });

  test("a swipe of the turn that locked the door leaves it as drawn", async () => {
    const t = await mapRig(worldWith(CELLAR));
    await t.call("map_place", { at: "The Cellar", pieces: [{ who: "Odile", square: [2, 3] }], ...SRC });
    await t.call("map_door", { at: "The Cellar", door: [5, 3], state: "locked", ...SRC });
    await t.writes.run(() => t.s.tieTurn(t.first.id, { message: "m1", hash: "h-locked", date: 1 }));
    const swipe = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "swipe", target: "m1" }));
    const there = await t.call("map_measure", { at: "The Cellar", from: [2, 3], to: [8, 3] }, swipe.id);
    expect(dataOf(there)).toMatchObject({ sees: true, way: { distance: 6 } });
    const map = texts(await t.call("map_view", { at: "The Cellar" }, swipe.id))[0] ?? "";
    expect(map).toContain("   door (5,3) open");
    // Her square was that turn's too.
    expect(map).toContain("   Odile [odile], here with no square yet");
  });
});

describe("map_lay and map_edit", () => {
  test("a room grid over one square of the town's map: for the place drawn there, or a new one", async () => {
    const t = await mapRig(worldWith(TOWN));
    const kettle = await t.call("map_lay", { place: "The Crooked Kettle", over: "Thornbury", square: [3, 2], width: 8, height: 6, doors: [[1, 3]], ...SRC });
    expect(kettle.error).toBeUndefined();
    expect(texts(kettle)).toContain("The Crooked Kettle [crooked_kettle] has a map now: 8 by 6 squares of 5 ft (nobody gave a width, so the setting's is taken as an assumption), counted in rounds of 6 seconds.");
    const mill = await t.call("map_lay", { place: "The Old Mill", over: "Thornbury", square: [2, 3], width: 6, height: 5, ...SRC });
    expect(texts(mill)).toContain("The Old Mill [the_old_mill] has a map now: 6 by 5 squares of 5 ft (nobody gave a width, so the setting's is taken as an assumption), counted in rounds of 6 seconds.");
    const placed = await t.call("map_place", { at: "The Old Mill", pieces: [{ who: "Wren", square: [3, 3] }], ...SRC });
    expect(opOf(placed)).toMatchObject({ applied: true, pieces: [{ who: "Wren [wren]", at: [3, 3] }] });
    wordsFromFiles(mill);
  });

  test("a door given outside the room is said, with the room's size, and the rest is laid", async () => {
    const t = await mapRig(worldWith(INN));
    const laid = await t.call("map_lay", { place: "The Far Road", width: 8, height: 6, doors: [[1, 3], [9, 3], [4, 7]], ...SRC });
    expect(laid.error).toBeUndefined();
    expect(laid.reports ?? []).toEqual(["map_lay: the door at (9,3) is outside the room, which is 8 by 6 squares, and was not drawn.", "map_lay: the door at (4,7) is outside the room, which is 8 by 6 squares, and was not drawn."]);
    wordsFromFiles(laid);
    const map = texts(await t.call("map_view", { at: "The Far Road" }))[0] ?? "";
    expect(map.split("\n").at(-1)).toBe("   door (1,3) open");
  });

  test("a map too large to show whole is shown around a centre, and says which part", async () => {
    const t = await mapRig(worldWith(INN));
    await t.call("map_lay", { place: "The Far Road", width: 50, height: 40, ...SRC });
    const r = await t.call("map_view", { at: "The Far Road", centre: [45, 35] });
    expect(texts(r)[0]).toContain("Shown: columns 11 to 50, rows 11 to 40. map_view with another centre shows the rest.");
    expect(dataOf(r)).toMatchObject({ from: [11, 11], to: [50, 40], whole: false });
    wordsFromFiles(r);
  });

  test("a grid of 5 ft squares laid for a place with no map counts rounds of six seconds", async () => {
    const t = await mapRig(worldWith(INN));
    const laid = await t.call("map_lay", { place: "The Far Road", width: 12, height: 8, doors: [[1, 4]], standing: "assumed", ...SRC });
    expect(laid.error).toBeUndefined();
    expect(texts(laid)).toContain("The Far Road [far_road] has a map now: 12 by 8 squares of 5 ft (nobody gave a width, so the setting's is taken as an assumption), counted in rounds of 6 seconds.");
    expect(opOf(laid).laid).toMatchObject({ width: 12, height: 8, size: { amount: 5, unit: "feet" }, sizeAssumed: true, step: { per: "round", seconds: 6, squares: 6 } });
    wordsFromFiles(laid);

    const brought = await t.call("map_place", { at: "The Far Road", pieces: [{ who: "Tam", square: [2, 2] }], ...SRC });
    expect(brought.reports).toBeUndefined();
    expect(texts(brought)).toContain("map_place: Tam [tam] was at Market Square [market_square], and was brought to The Far Road [far_road] first.");
    const run = await t.call("map_measure", { from: "Tam", to: [11, 7] });
    expect(dataOf(run)).toMatchObject({ way: { distance: 9, rounds: 2, seconds: 12 } });
    expect(texts(await t.call("map_lay", { place: "The Far Road", width: 4, height: 4, ...SRC }))[0]).toBe("map_lay: The Far Road [far_road] has a map already (far_road_map).");
  });

  test("a room wider or higher than a map can be is refused before it is built, at any size asked", async () => {
    const t = await mapRig(worldWith(INN));
    const wide = await t.call("map_lay", { place: "The Far Road", width: 65, height: 8, ...SRC });
    expect(wide.error).toBe(true);
    expect(texts(wide)).toEqual(["map_lay: a map is at most 64 by 64 squares, and this one would be 65 by 8.", "Nothing was recorded. Send the call again with that put right."]);
    wordsFromFiles(wide);
    const started = performance.now();
    const huge = await t.call("map_lay", { place: "The Far Road", width: 50_000, height: 50_000, ...SRC });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(texts(huge)[0]).toBe("map_lay: a map is at most 64 by 64 squares, and this one would be 50000 by 50000.");
    expect(t.s.changes(t.first.id).length).toBe(0);
    const most = await t.call("map_lay", { place: "The Far Road", width: 64, height: 64, ...SRC });
    expect(opOf(most).laid).toMatchObject({ width: 64, height: 64 });
  });

  test("a bar drawn across the cellar is kept as that change: it blocks the way and not the view", async () => {
    const t = await mapRig(worldWith(CELLAR));
    const edited = await t.call("map_edit", { at: "The Cellar", strokes: [{ symbol: "b", line: [[6, 2], [6, 4]] }, { symbol: "?", squares: [[8, 2]] }], legend: { b: { terrain: "bar", blocked: true, seeThrough: true } }, ...SRC });
    expect(edited.error).toBeUndefined();
    expect(texts(edited)).toContain("4 squares of the map of The Cellar [cellar] were drawn anew, and its legend changed for b.");
    expect(edited.reports).toBeUndefined();
    expect(texts(edited)).toContain("map_edit: no legend names ?, so it reads as floor.");
    expect(t.s.changes(t.first.id).map((c) => c.op)).toEqual(["space.squares"]);
    wordsFromFiles(edited);
    // Through the open door and over the bar: seen, and no way across.
    const view = await t.call("map_measure", { at: "The Cellar", from: [2, 3], to: [8, 3] });
    expect(dataOf(view)).toMatchObject({ sees: true, way: null });
    expect(texts(await t.call("map_view", { at: "The Cellar" }))[0]).toContain("b bar (blocks the way, not the view)");
  });

  test("a rectangle to (2,000,000, 2,000,000) answers in a few milliseconds with one line about it", async () => {
    const t = await mapRig(worldWith(CELLAR));
    const timed = async (args: JsonObject): Promise<{ r: ToolResult; ms: number }> => {
      const started = performance.now();
      const r = await t.call("map_edit", { at: "The Cellar", ...args, ...SRC });
      return { r, ms: performance.now() - started };
    };
    const rect = await timed({ strokes: [{ symbol: ".", rect: [[1, 1], [2_000_000, 2_000_000]] }] });
    expect(rect.r.error).toBeUndefined();
    expect(texts(rect.r)).toContain("45 squares of the map of The Cellar [cellar] were drawn anew.");
    expect(rect.r.reports ?? []).toEqual(["map_edit: 3999999999955 squares of stroke 1 (.) are off the map, which is 9 by 5 squares, and were not drawn."]);
    expect(rect.ms).toBeLessThan(1000);
    wordsFromFiles(rect.r);
    // A line as far off: only the squares it crosses on the map are worked out.
    const line = await timed({ strokes: [{ symbol: "#", line: [[2, 2], [2_000_000, 1]] }] });
    expect(texts(line.r)).toContain("8 squares of the map of The Cellar [cellar] were drawn anew.");
    expect(line.r.reports ?? []).toEqual(["map_edit: 1999991 squares of stroke 1 (#) are off the map, which is 9 by 5 squares, and were not drawn."]);
    expect(line.ms).toBeLessThan(1000);
  });

  test("corners given in feet say once how much fell off; a stroke wholly off the map draws nothing and says why", async () => {
    const t = await mapRig(worldWith(INN, CELLAR));
    const feet = await t.call("map_edit", { at: "The Common Room", strokes: [{ symbol: ".", rect: [[5, 5], [60, 40]] }, { symbol: "#", squares: [[2, 2], [13, 2], [1, 9]] }], ...SRC });
    expect(feet.error).toBeUndefined();
    expect(texts(feet)).toContain("33 squares of the map of The Common Room [common_room] were drawn anew.");
    expect(feet.reports ?? []).toEqual([
      "map_edit: 1984 squares of stroke 1 (.) are off the map, which is 12 by 8 squares, and were not drawn.",
      "map_edit: 2 squares of stroke 2 (#) are off the map, which is 12 by 8 squares, and were not drawn.",
    ]);
    wordsFromFiles(feet);
    const before = t.s.changes(t.first.id).length;
    const off = await t.call("map_edit", { at: "The Cellar", strokes: [{ symbol: "#", rect: [[20, 20], [30, 30]] }], ...SRC });
    expect(off.error).toBe(true);
    expect(texts(off)).toEqual(["map_edit: 121 squares of stroke 1 (#) are off the map, which is 9 by 5 squares, and were not drawn.", "Nothing was recorded. Send the call again with that put right."]);
    expect(t.s.changes(t.first.id).length).toBe(before);
    wordsFromFiles(off);
  });
});

describe("the map in world_query", () => {
  test("world_query shows a place's map in the map's own words", async () => {
    const t = await mapRig(worldWith(CELLAR), async (deps) => ({ map: mapView(await mapLines(deps.files)) }));
    await t.call("map_place", { at: "The Cellar", pieces: [{ who: "Odile", square: [2, 3] }], ...SRC });
    const r = await t.call("world_query", { at: "The Cellar", map: true });
    const map = texts(r).find((x) => x.startsWith("Map: The Cellar.")) ?? "";
    expect(map).toContain("   2  # . . . # . . . #");
    expect(map).toContain("   Odile [odile] (2,3)");
    expect(map).toContain("   door (5,3) open");
    for (const l of map.split("\n")) if (l !== "") expect({ line: l, ok: PICTURE.test(l) || mapPatterns.some((p) => p.test(l)) }).toEqual({ line: l, ok: true });
  });
});

describe("the map's part switched off", () => {
  test("every map tool answers with data and the map's picture, and no word at all", async () => {
    const shipped = shippedTexts();
    const off = { read: (kind: "tools" | "prompts", name: string) => (kind === "prompts" && name === "map-answers" ? Promise.resolve(undefined) : shipped.read(kind, name)) };
    const t = await mapRig(worldWith(CELLAR), async () => ({ files: off }));
    const answers = [
      await t.call("map_lay", { place: "The Far Road", width: 6, height: 4, ...SRC }),
      await t.call("map_place", { at: "The Cellar", pieces: [{ who: "Odile", square: [2, 3] }, { who: "cask", square: [1, 1] }], ...SRC }),
      await t.call("map_door", { at: "The Cellar", door: [5, 3], state: "locked", ...SRC }),
      await t.call("map_measure", { from: "Odile", to: [8, 3], within: 3, area: "burst", size: 1 }),
      await t.call("map_edit", { at: "The Cellar", strokes: [{ symbol: "?", squares: [[8, 2]] }], ...SRC }),
      await t.call("map_view", { at: "The Cellar" }),
      await t.call("map_door", { at: "The Cellar", door: [3, 3], state: "open", ...SRC }),
    ];
    // The cask's square is a wall, and the door shut and the symbol unknown: each was reported, and here with no words.
    expect(answers.map((r) => r.error ?? false)).toEqual([false, false, false, false, false, false, true]);
    for (const r of answers) {
      const kinds = kindsOf(r);
      texts(r).forEach((text, i) => {
        if (kinds[i] === "data") return;
        expect(kinds[i]).toBe("tree");
        for (const l of text.split("\n")) expect({ line: l, ok: PICTURE.test(l) }).toEqual({ line: l, ok: true });
      });
      expect(r.reports ?? []).toEqual([]);
    }
  });
});
