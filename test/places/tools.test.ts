import { describe, expect, test } from "bun:test";
import { placeAt } from "../../src/places/record";
import { waysPart } from "../../src/places/ways";
import { CHAT, texts } from "../iface/rig";
import { placesRig } from "./rig";

const src = { from: "gm" };

describe("the places' tools", () => {
  test("world_path lays a way with its minutes and the record shows it with its turn; place_label renames and place_remove takes out, a place that holds something is told so", async () => {
    const t = await placesRig();
    const at = (): ReturnType<typeof placeAt> => placeAt(t.store, "user-a", CHAT, t.turn.id);

    const laid = await t.call("world_path", { from: "market_square", to: "far_road", mode: "walk", minutes: 20, km: 1.6, source: src });
    expect(laid.error).toBeUndefined();
    const found = at();
    if (found === null) throw new Error("the chat plays the invented world");
    const ways = waysPart(found, "market_square");
    expect(ways.ways.map((w) => [w.to.id, w.dir, w.modes, w.turn])).toEqual([["far_road", "both", [{ mode: "walk", minutes: 20, km: 1.6 }], t.turn.id]]);
    expect(ways.adjoining.map((a) => [a.id, a.how])).toEqual([["lamp_ladle", "beside"], ["far_road", "way"]]);
    // A way is changed by what changes in it, and taken out whole or by its mode.
    const slower = await t.call("world_path", { from: "market_square", to: "far_road", mode: "road", minutes: 8, source: src });
    expect(slower.error).toBeUndefined();
    const both = at();
    if (both === null) throw new Error("the chat plays the invented world");
    expect(waysPart(both, "far_road").ways[0]?.modes.map((m) => m.mode)).toEqual(["walk", "road"]);
    const gone = await t.call("world_path", { from: "market_square", to: "far_road", remove: true, source: src });
    expect(gone.error).toBeUndefined();
    expect(waysPart(at() as NonNullable<ReturnType<typeof placeAt>>, "market_square").ways).toEqual([]);

    // A place of the world's own is renamed in the chat's draft; one made in play by its own place op.
    const renamed = await t.call("place_label", { place: "cellar", name: "The Wine Cellar", aliases: ["the vault"], source: src });
    expect(renamed.error).toBeUndefined();
    expect(at()?.ctx.world.places.cellar?.name).toBe("The Wine Cellar");
    const made = await t.call("world_apply", { operations: [{ op: "place", kind: "room", name: "Loft", at: "common_room", source: { from: "default" } }] });
    expect(made.error).toBeUndefined();
    const loft = Object.values(at()?.ctx.world.places ?? {}).find((p) => p.name === "Loft");
    const relabelled = await t.call("place_label", { place: loft?.id ?? "", aliases: ["the attic"], source: src });
    expect(relabelled.error).toBeUndefined();
    const removed = await t.call("place_remove", { place: loft?.id ?? "", source: src });
    expect(removed.error).toBeUndefined();
    expect(Object.values(at()?.ctx.world.places ?? {}).some((p) => p.name === "Loft")).toBe(false);
    // The cellar holds a cask: it stays, and the answer says why.
    const held = await t.call("place_remove", { place: "cellar", source: src });
    expect(held.error).toBe(true);
    expect(texts(held).join("\n")).toContain("occupied");
  });
});
