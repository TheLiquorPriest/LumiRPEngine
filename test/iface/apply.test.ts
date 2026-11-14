// `world_apply` as a model meets it: squares counted as the map prints them, with what the grid says
// of a move in the answer; one call that builds on what its earlier operations made; a world with
// nothing in it; and answers that say what would have worked. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { playedWorld } from "../../src/engine/places-in-play";
import { gridMoves, mapLines, shippedTexts } from "../../src/iface/index";
import { compileMaps } from "../../src/shared/maps";
import type { WorldDoc } from "../../src/shared/world";
import { INN } from "./map/fixtures";
import { dataOf, rig, texts, wordsFromFiles, world } from "./rig";

/** The invented world with the inn's common room drawn as a map. */
function mapped(): WorldDoc {
  const w = world();
  w.maps = { ...w.maps, [INN.id]: INN };
  return compileMaps(w);
}

describe("squares on a map", () => {
  test("a square counts from 1, and what the grid says of a move is said in the answer", async () => {
    const t = await rig({ grid: gridMoves(await mapLines(shippedTexts())) }, mapped());
    const src = { from: "prose", message: "m-7" };
    const set = await t.call("world_apply", { operations: [{ op: "place", what: "bram", square: [4, 3], source: src }] });
    expect(set.error).toBeUndefined();
    const crossed = await t.call("world_apply", { operations: [{ op: "move", who: "bram", to: "common_room", square: [11, 3], source: src }] });
    expect(texts(crossed)).toContain("Operation 1 (move): Bram [bram]: from (4,3) to (11,3) is 7 squares (35 ft), 7 squares of movement, 2 rounds, 12 seconds.");
    const walled = await t.call("world_apply", { operations: [{ op: "move", who: "tam", to: "common_room", square: [1, 4], source: src }] });
    expect(texts(walled)).toContain("Operation 1 (move): Tam [tam] stands on (1,4), which block the way; it was put there all the same.");
    expect(t.s.stateAt(t.turn.id).state.world.entities.tam?.fields).toMatchObject({ place: "common_room", x: 0, y: 3 });
    const recorded = t.s.changes(t.turn.id).length;
    const zero = await t.call("world_apply", { operations: [{ op: "place", what: "tam", square: [0, 3], source: src }] });
    expect(zero.error).toBe(true);
    expect(texts(zero).some((x) => x.startsWith("Operation 1 (place): square cannot be read"))).toBe(true);
    expect(t.s.changes(t.turn.id).length).toBe(recorded);
    for (const r of [crossed, walled, zero]) wordsFromFiles(r);
  });
});

describe("one call builds on itself", () => {
  test("a later operation names what an earlier one of the same call made, and the call is recorded as one", async () => {
    const t = await rig();
    const src = { from: "prose", message: "m-8" };
    const r = await t.call("world_apply", {
      operations: [
        { op: "spawn", name: "Kitchen table", at: "common_room", source: src },
        { op: "spawn", name: "Clay jug", on: "Kitchen table", source: src },
        { op: "spawn", name: "Brass key", in: "bell", source: src },
        { op: "spawn", name: "Ines Varga", kind: "character", at: "cellar", source: src },
        { op: "move", who: "Ines Varga", to: "common_room", with: ["odile"], source: src },
        { op: "give", what: "Clay jug", to: "Ines Varga", how: "handed", source: src },
        { op: "horizon", list: ["common_room", "Ines Varga", "Brass key"], source: { from: "author" } },
      ],
    });
    expect(r.error).toBeUndefined();
    const stored = t.s.stateAt(t.turn.id).state;
    const byName = (name: string): string => Object.entries(stored.world.entities).find(([, e]) => e.name === name)?.[0] ?? "";
    const ines = byName("Ines Varga");
    expect(stored.world.entities[ines]?.fields.place).toBe("common_room");
    expect(stored.world.entities.odile?.fields.place).toBe("common_room");
    expect(stored.world.entities[byName("Clay jug")]?.relations).toContainEqual({ type: "in", to: ines });
    // A bell holds nothing: the key is put in it all the same, and the answer says which rule that bent.
    expect(stored.world.entities[byName("Brass key")]?.relations).toContainEqual({ type: "in", to: "bell" });
    expect((r.reports ?? []).some((x) => x.startsWith("Operation 3 (spawn): Brass key") && x.includes("cant_hold"))).toBe(true);
    expect(stored.horizon).toEqual(["place:common_room", `entity:${ines}`, `entity:${byName("Brass key")}`]);
    wordsFromFiles(r);
  });

  test("an operation that names what only a later one makes is refused, and nothing of the call is recorded", async () => {
    const t = await rig();
    const src = { from: "prose", message: "m-9" };
    const r = await t.call("world_apply", {
      operations: [
        { op: "move", who: "Pell Ardent", to: "common_room", source: src },
        { op: "spawn", name: "Pell Ardent", kind: "character", at: "cellar", source: src },
      ],
    });
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.startsWith("Operation 1 (move): there is nothing called Pell Ardent"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });
});

describe("a world with nothing in it", () => {
  test("its first place is made with no container, and the same call puts places, people and the horizon in it", async () => {
    const t = await rig({}, "blank");
    const src = { from: "prose", message: "m-1" };
    const r = await t.call("world_apply", {
      operations: [
        { op: "spawn", kind: "place", name: "Gull Skerry", description: "A bare rock with a light on it.", source: src },
        { op: "spawn", kind: "place", name: "Keeper's kitchen", at: "Gull Skerry", source: src },
        { op: "spawn", kind: "room", name: "Lamp room", at: "Gull Skerry", source: src },
        { op: "spawn", kind: "person", name: "Ada Lorne", at: "Keeper's kitchen", source: src },
        { op: "horizon", list: ["Keeper's kitchen", "Ada Lorne", "Lamp room"], source: { from: "author" } },
      ],
    });
    expect(r.error).toBeUndefined();
    const state = t.s.stateAt(t.turn.id).state;
    const doc = t.deps.env.worlds(state.world.revision);
    if (!doc) throw new Error("no blank world");
    const places = playedWorld(doc, state.world).places;
    const id = (name: string): string => Object.values(places).find((p) => p.name === name)?.id ?? "";
    expect(places[id("Gull Skerry")]?.parent).toBeUndefined();
    expect(places[id("Keeper's kitchen")]?.parent).toBe(id("Gull Skerry"));
    expect(places[id("Lamp room")]?.parent).toBe(id("Gull Skerry"));
    expect(state.world.entities.ada_lorne?.fields.place).toBe(id("Keeper's kitchen"));
    expect(state.horizon).toEqual([`place:${id("Keeper's kitchen")}`, "entity:ada_lorne", `place:${id("Lamp room")}`]);
    const data = dataOf(r);
    expect((data.changed as JsonObject[]).filter((c) => String(c.at).startsWith("place:") && c.new === true).map((c) => c.name)).toEqual(expect.arrayContaining(["Gull Skerry", "Keeper's kitchen", "Lamp room"]));
    expect((data.now as JsonObject[]).some((n) => n.ref === `place:${id("Keeper's kitchen")}`)).toBe(true);
    wordsFromFiles(r);

    // Made again, a place of that name in the same place stands for it, and no second one is made.
    const again = await t.call("world_apply", { operations: [{ op: "spawn", kind: "place", name: "Gull Skerry", source: src }] });
    expect(again.error).toBeUndefined();
    expect(again.reports).toBeUndefined();
    expect(texts(again).some((x) => x.startsWith("Operation 1 (spawn): Gull Skerry") && x.includes("is there already"))).toBe(true);
    const after = t.s.stateAt(t.turn.id).state;
    expect(Object.values(playedWorld(doc, after.world).places).filter((p) => p.name === "Gull Skerry")).toHaveLength(1);
  });

  test("a place is made with the fields the call gives, and what a place has none of is said not to be kept", async () => {
    const t = await rig({}, "blank");
    const src = { from: "prose", message: "m-3" };
    const r = await t.call("world_apply", {
      operations: [
        { op: "spawn", kind: "place", name: "Gull Skerry", fields: { law: "curfew at dusk" }, tier: "notable", source: src },
        { op: "spawn", kind: "room", name: "Lamp room", at: "Gull Skerry", description: "Glass on every side.", fields: { smell: "paraffin", description: "never read over the call's own" }, source: src },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    expect(texts(r)).toContain("Operation 1 (spawn): a place has no tier, so that was not kept.");
    expect(texts(r).filter((x) => x.includes("so that was not kept"))).toHaveLength(1);
    const state = t.s.stateAt(t.turn.id).state;
    const doc = t.deps.env.worlds(state.world.revision);
    if (!doc) throw new Error("no blank world");
    const places = Object.values(playedWorld(doc, state.world).places);
    expect(places.find((p) => p.name === "Gull Skerry")?.fields).toEqual({ law: "curfew at dusk" });
    expect(places.find((p) => p.name === "Lamp room")?.fields).toEqual({ smell: "paraffin", description: "Glass on every side." });
    wordsFromFiles(r);
  });
});

describe("answers that say what would work", () => {
  const src = { from: "prose", message: "m-2" };

  test("a value that is none of the choices names the whole list, once, and what that kind of operation takes", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "spawn", kind: "building", name: "Tide mill", at: "common_room", source: src }] });
    expect(r.error).toBe(true);
    const said = texts(r).join("\n");
    expect(said.split("It is one of:")).toHaveLength(2);
    expect(said).toMatch(/kind cannot be read, you sent "building"\. It is one of: character, thing, person, .*, region \(Weather region\), .*, place, room, spot, venue\./);
    expect(said).toContain("spawn needs name, and also takes kind, at, in, on, tier, fields, bestiary, type, class, qty, owner, description, why.");
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });

  test("a name that is not there says what goes by it, the near names, and that it can be made earlier in the call", async () => {
    const t = await rig();
    const r = await t.call("world_apply", {
      operations: [
        { op: "spawn", kind: "region", name: "Skerry Rock", source: src },
        { op: "move", who: "bram", to: "Skerry Rock", source: src },
      ],
    });
    expect(r.error).toBe(true);
    expect(texts(r)).toEqual([
      "Operation 2 (move): there is nothing called Skerry Rock that is a place. By that name there is Skerry Rock [skerry_rock] (Weather region).",
      "A place can be made earlier in this same call: spawn with kind place and its name, before the operation that names it.",
      "move needs who, to, and also takes with, square, near, zone, why.",
      "Nothing was recorded. Send the call again with that put right.",
    ]);
    const near = await t.call("world_apply", { operations: [{ op: "move", who: "bram", to: "Celler", source: src }] });
    expect(texts(near)[0]).toBe("Operation 1 (move): there is nothing called Celler that is a place. Near: The Cellar [cellar].");
    wordsFromFiles(r);
  });

  test("an operation sent without what it needs says what that kind needs and takes, and what it was sent that it does not read", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "fact", subject: "bram", value: "Keeps a ledger of every debt.", source: src }] });
    expect(texts(r)).toEqual(["Operation 1 (fact) needs about, key.", "fact needs about, key, value, and also takes replaces. It does not read subject.", "Nothing was recorded. Send the call again with that put right."]);
    const empty = await t.call("world_apply", {});
    expect(texts(empty)).toEqual(["operations cannot be read. It is a list of operations, each with its op, one of: move, place, give, wear, store, pay, pass_time, set, fact, quest, relate, spawn, horizon."]);
    for (const x of [r, empty]) wordsFromFiles(x);
  });

  test("every word of those answers is the answers' file's: changed there, the answer changes; switched off, it holds no words", async () => {
    const shipped = shippedTexts();
    const edited = (await shipped.read("prompts", "engine-answers"))?.replace("want_place: a place", "want_place: somewhere on the map").replace(/^make_place: .*$/m, "make_place: Spawn it first.");
    const t = await rig({ files: { read: async (kind, name) => (kind === "prompts" && name === "engine-answers" ? edited : shipped.read(kind, name)) } });
    const r = await t.call("world_apply", { operations: [{ op: "move", who: "bram", to: "Gull Skerry", source: src }] });
    expect(texts(r).slice(0, 2)).toEqual(["Operation 1 (move): there is nothing called Gull Skerry that is somewhere on the map.", "Spawn it first."]);
    const off = await rig({ files: { read: async (kind, name) => (kind === "prompts" && name === "engine-answers" ? undefined : shipped.read(kind, name)) } });
    const calls: JsonObject[] = [{ operations: [{ op: "move", who: "bram", to: "Gull Skerry" }] }, { operations: [{ op: "spawn", kind: "building", name: "Mill" }] }, {}];
    for (const call of calls) {
      const quiet = await off.call("world_apply", call);
      expect(quiet.error).toBe(true);
      expect(texts(quiet)).toEqual([]);
    }
  });
});

describe("the tool's worked example", () => {
  test("the scene its file shows is set from nothing in one call, as it says", async () => {
    const t = await rig({}, "blank");
    const line = t.tools.get("world_apply")?.description.split("\n").find((l) => l.startsWith('{"operations"'));
    const r = await t.call("world_apply", JSON.parse(line ?? "{}") as JsonObject);
    expect(r.error).toBeUndefined();
    expect(r.reports ?? []).toEqual([]);
    expect((dataOf(r).operations as JsonObject[]).every((o) => o.applied === true)).toBe(true);
    const state = t.s.stateAt(t.turn.id).state;
    const doc = t.deps.env.worlds(state.world.revision);
    if (!doc) throw new Error("no blank world");
    const places = Object.values(playedWorld(doc, state.world).places);
    const outer = places.find((p) => p.parent === undefined);
    const inner = places.find((p) => p.parent !== undefined && p.parent === outer?.id);
    expect(places).toHaveLength(2);
    const there = Object.values(state.world.entities).filter((e) => e.fields.place === inner?.id);
    expect(there.filter((e) => e.kind === "person")).toHaveLength(2);
    expect(there.filter((e) => e.kind !== "person")).toHaveLength(1);
  });
});
