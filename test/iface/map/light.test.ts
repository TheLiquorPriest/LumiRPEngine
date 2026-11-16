// What is lit (plan §8.2): a place's light is set as any place's field is, and the grid reads it over the
// place; sight says whether the target stands lit and whether it is past the sight radius, as facts.
// Through the tools as a model meets them. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { gridMoves, mapLines, shippedTexts } from "../../../src/iface/index";
import { INN, worldWith } from "./fixtures";
import { dataOf, rig, texts } from "../rig";

const src = { source: { from: "prose", message: "m-9" } };

/** The inn's common room, Wren at one end of it and Odile at the other, and a sight that reaches `radius` squares. */
async function inn(radius: number) {
  const world = worldWith(INN);
  world.mapSettings = { display: "knowledge", grid: { movement: false, sightRadius: radius } };
  const t = await rig({ grid: gridMoves(await mapLines(shippedTexts())) }, world);
  const placed = await t.call("map_place", { at: "The Common Room", pieces: [{ who: "Wren", square: [2, 5] }, { who: "Odile", square: [11, 5] }], ...src });
  expect(placed.error).toBeUndefined();
  return t;
}

describe("what is lit", () => {
  test("a place set dark is listed as dark, and sight says the target stands in the dark and, with a short radius, past it", async () => {
    const t = await inn(12);
    const lit = await t.call("map_measure", { from: "Wren", to: "Odile" });
    expect(texts(lit)).toContain("Wren (2,5) and Odile (11,5) can see each other.");
    expect(dataOf(lit)).toMatchObject({ sees: true, clear: true, lit: true });

    const set = await t.call("world_apply", { operations: [{ op: "set", at: "common_room", key: "light", value: "dark", ...src }] });
    expect(set.error).toBeUndefined();
    const dark = await t.call("map_measure", { from: "Wren", to: "Odile" });
    expect(texts(dark).some((l) => l.includes("and Odile (11,5) stands in the dark"))).toBe(true);
    expect(dataOf(dark)).toMatchObject({ sees: true, clear: true, lit: false });
    const view = await t.call("map_view", { at: "The Common Room" });
    expect(texts(view).join("\n")).toContain("in the dark: The Common Room [common_room], the whole map");

    const back = await t.call("world_apply", { operations: [{ op: "set", at: "common_room", key: "light", value: "lit", ...src }] });
    expect(back.error).toBeUndefined();
    expect(dataOf(await t.call("map_measure", { from: "Wren", to: "Odile" }))).toMatchObject({ lit: true });

    const short = await inn(3);
    await short.call("world_apply", { operations: [{ op: "set", at: "common_room", key: "light", value: "dark", ...src }] });
    const far = await short.call("map_measure", { from: "Wren", to: "Odile" });
    expect(texts(far).some((l) => l.includes("farther than the 3 squares") && l.includes("and stands in the dark"))).toBe(true);
    expect(dataOf(far)).toMatchObject({ sees: false, clear: true, lit: false, radius: 3 });
  });

  test("a light that is neither lit nor dark is recorded as given and said to read as unset", async () => {
    const t = await inn(12);
    const set = await t.call("world_apply", { operations: [{ op: "set", at: "common_room", key: "light", value: "pitch black", ...src }] });
    expect(set.error).toBeUndefined();
    expect((set.reports ?? []).some((r) => r.includes("neither lit nor dark") && r.includes("reads as lit"))).toBe(true);
    expect(dataOf(await t.call("map_measure", { from: "Wren", to: "Odile" }))).toMatchObject({ lit: true });
  });
});
