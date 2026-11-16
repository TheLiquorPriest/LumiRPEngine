import { describe, expect, test } from "bun:test";
import { baseOf, placeSliceOf, sourcesOf } from "../../src/places/fold";
import { sourcesNow } from "../../src/places/sources";
import { CHAT, texts } from "../iface/rig";
import { placesRig } from "./rig";

const src = { from: "lore", lore: "e-layout" };

describe("a place made with the place operation", () => {
  test("it is made with its sources and its base drawn against them, an entry Lumiverse does not hold is said, and spawn makes no place", async () => {
    const t = await placesRig();
    t.lore.entries.set("e-layout", { title: "The Drowned Bell", revision: "r1" });
    const made = await t.call("world_apply", {
      operations: [{ op: "place", kind: "place", name: "The Drowned Bell", at: "thornbury", description: "A tavern under the tide line.", sources: [{ entry: "e-layout", aspect: "layout" }, "e-lost"], source: src }],
    });
    expect(made.error).toBeUndefined();
    expect((made.reports ?? []).join(" ")).toContain("no lore entry e-lost");
    const state = t.s.stateAt(t.turn.id).state;
    const slice = placeSliceOf(state);
    const id = Object.keys(slice.sources)[0] ?? "";
    expect(id).toBe("the_drowned_bell");
    expect(sourcesOf(slice, id).map((s) => [s.entry, s.aspect])).toEqual([["e-layout", "layout"], ["e-lost", ""]]);
    expect(baseOf(slice, id)).toMatchObject({ text: "A tavern under the tide line.", drawn: { "e-layout": "r1" } });
    // Read live, the bound entries come with their aspects, and the entry that is not there is shown gone.
    const shown = await sourcesNow(t.lore, { user: "user-a", chat: CHAT }, id, baseOf(slice, id), sourcesOf(slice, id));
    expect(shown.sources.map((s) => [s.entry, s.aspect, s.title, s.newer])).toEqual([["e-layout", "layout", "The Drowned Bell", false], ["e-lost", "", null, true]]);
    expect(shown.older).toBe(true);

    // An invented place carries no source and no words: made all the same.
    const invented = await t.call("world_apply", { operations: [{ op: "place", kind: "room", name: "Cold cellar", at: "the_drowned_bell", source: { from: "default" } }] });
    expect(invented.error).toBeUndefined();

    // spawn makes none: it answers with what it does make and names the place operation.
    const spawned = await t.call("world_apply", { operations: [{ op: "spawn", kind: "room", name: "Loft", at: "the_drowned_bell", source: { from: "default" } }] });
    expect(spawned.error).toBe(true);
    expect(texts(spawned).join("\n")).toContain("place operation");
  });
});
