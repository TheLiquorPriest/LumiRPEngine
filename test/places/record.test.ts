import { describe, expect, test } from "bun:test";
import { baseAt } from "../../src/places/base";
import { baseOf, PLACE_STORE_AREA, placeSliceOf } from "../../src/places/fold";
import { sourcesNow } from "../../src/places/sources";
import { placeLines } from "../../src/places/lines";
import { PLACES_DEFAULTS } from "../../src/places/settings";
import { accessOf, featuresOf, type PlaceAt, placeAt, sinceOf } from "../../src/places/record";
import { factStore } from "../../src/store/facts";
import type { ChangeInput } from "../../src/store";
import { CHAT as IFACE_CHAT, rig, texts } from "../iface/rig";
import { placesRig } from "./rig";
import { CHAT, openTable, USER } from "../story/rig";

const INN = "lamp_ladle";

function fact(about: string, key: string, value: string, more: { part?: string; beat?: string } = {}): ChangeInput {
  const { op, value: v } = factStore.change({ about, key, value, ...more });
  return { lane: "engine", op, value: v, by: "gm", source: "prose" };
}

describe("a place's record", () => {
  test("a fact keeps its record part and its beat, a swipe takes it away, and the parts read as lines", async () => {
    const t = await openTable({ areas: [PLACE_STORE_AREA] });
    const turn = await t.begin();
    await t.write(turn, [{ part: "beat", item: null, value: { text: "The east wing burned down." } }]);
    const beat = t.record(turn).of("beat")[0]?.id ?? "";
    const here = `place:${INN}`;
    await t.writes.run(() =>
      t.s.addChanges(turn.id, [
        fact(here, "east_wing", "burned down, the roof fell in", { part: "since", beat }),
        fact(here, "hearth", "a wide hearth of river stone", { part: "feature" }),
        fact(here, "back_door", "barred from inside at night", { part: "access" }),
        fact(here, "smell", "woodsmoke"),
      ]),
    );
    const tied = await t.tie(turn);

    const at = placeAt(t.store, USER, CHAT, null);
    if (at === null) throw new Error("the chat plays the invented world");
    const since = sinceOf(at, INN, PLACES_DEFAULTS);
    expect(since.more).toBe(0);
    expect(since.items.map((r) => [r.key, r.turn, r.beat?.id, r.beat?.text])).toEqual([["east_wing", tied.id, beat, "The east wing burned down."]]);
    expect(featuresOf(at, INN, PLACES_DEFAULTS).facts.items.map((r) => r.key)).toEqual(["hearth"]);
    expect(accessOf(at, INN, PLACES_DEFAULTS).facts.items.map((r) => r.key)).toEqual(["back_door"]);

    // The setting cuts a part to its newest, and the line says how many were left out and the query that reads them.
    const lines = placeLines({ at, place: INN, settings: { ...PLACES_DEFAULTS, since: 1 }, depth: 1 });
    expect(lines.map((l) => l.kind)).toEqual(["place_since", "place_feature", "place_access"]);
    expect(lines.find((l) => l.kind === "place_since")?.fields).toMatchObject({ key: "east_wing", beat: { id: beat } });

    // A swipe of the reply takes the facts away with the turn.
    const swipe = await t.swipe();
    await t.tie(swipe);
    const after = placeAt(t.store, USER, CHAT, null);
    if (after === null) throw new Error("the chat plays the invented world");
    expect(sinceOf(after, INN, PLACES_DEFAULTS).items).toEqual([]);
    expect(placeLines({ at: after, place: INN, settings: PLACES_DEFAULTS, depth: 1 }).filter((l) => l.kind === "place_none").map((l) => l.fields.part)).toEqual(["since", "feature", "access"]);
  });
});

describe("the fact operation's part and beat", () => {
  test("a fact about a place takes its part and is recorded with it; a part that is none of a place's, or a beat the record does not hold, is read as such", async () => {
    const t = await rig();
    const src = { from: "prose", message: "m-1" };
    const done = await t.call("world_apply", { operations: [{ op: "fact", about: "common_room", key: "hearth", value: "a wide hearth of river stone", part: "feature", source: src }] });
    expect(texts(done).join("\n")).not.toContain("cannot be read");
    expect(t.s.headState(IFACE_CHAT).state.facts["place:common_room"]).toBeUndefined();
    const staged = t.s.stateFor(t.turn.id, null).state.facts["place:common_room"] ?? [];
    expect(staged.map((f) => [f.key, f.part])).toEqual([["hearth", "feature"]]);

    const wrongPart = await t.call("world_apply", { operations: [{ op: "fact", about: "common_room", key: "k", value: "v", part: "smell", source: src }] });
    expect(texts(wrongPart).join("\n")).toContain("since, feature, access");
    const person = await t.call("world_apply", { operations: [{ op: "fact", about: "wren", key: "k", value: "v", part: "since", source: src }] });
    expect(texts(person).join("\n")).toContain("not a place");
    const noBeat = await t.call("world_apply", { operations: [{ op: "fact", about: "common_room", key: "k", value: "v", beat: "b-99", source: src }] });
    expect(texts(noBeat).join("\n")).toContain("holds no beat b-99");
  });
});

describe("a place's base", () => {
  test("set with the key base writes it as the area's change drawn against the bound entries, a swipe takes it away, and the world's own words stand until then", async () => {
    const t = await placesRig();
    t.lore.bound.set("common_room", [
      { entry: "e-layout", aspect: "layout", by: "owner" },
      { entry: "e-history", aspect: "history", by: "run" },
    ]);
    t.lore.entries.set("e-layout", { title: "The common room", revision: "r1" });
    t.lore.entries.set("e-history", { title: "The inn's founding", revision: "h1" });

    const at = (): PlaceAt => {
      const found = placeAt(t.store, USER, IFACE_CHAT, t.turn.id);
      if (found === null) throw new Error("the chat plays the invented world");
      return found;
    };
    // Until a base is written, the world's own words for the place stand, as the world's.
    expect(baseAt(at(), "common_room", null)).toMatchObject({ text: "Smoky and loud.", world: true });

    const done = await t.call("world_apply", { operations: [{ op: "set", at: "common_room", key: "base", value: "A low room of black beams and a wide hearth.", source: { from: "author" } }] });
    expect(texts(done).join("\n")).toContain("A low room of black beams");
    const written = baseOf(placeSliceOf(t.s.stateAt(t.turn.id).state), "common_room");
    expect(written).toMatchObject({ text: "A low room of black beams and a wide hearth.", drawn: { "e-layout": "r1", "e-history": "h1" } });
    expect(baseAt(at(), "common_room", null)).toMatchObject({ text: "A low room of black beams and a wide hearth.", world: false });
    // Today's description is the same part: the chat's draft of its world is not written.
    expect(at().ctx.world.places.common_room?.fields.description).toBe("Smoky and loud.");

    // The entry changes in Lumiverse: the base is older than its source, and so is the source's row.
    t.lore.entries.set("e-layout", { title: "The common room", revision: "r2" });
    const sources = await sourcesNow(t.lore, { user: USER, chat: IFACE_CHAT }, "common_room", written);
    expect(sources.older).toBe(true);
    expect(sources.sources.map((s) => [s.entry, s.newer])).toEqual([["e-layout", true], ["e-history", false]]);
    // The place's lines carry the base marked older, and each source with its aspect, read live.
    const lines = placeLines({ at: at(), place: "common_room", settings: PLACES_DEFAULTS, depth: 1, sources });
    expect(lines.find((l) => l.kind === "place_base")?.fields).toMatchObject({ older: true });
    expect(lines.filter((l) => l.kind === "place_source").map((l) => [l.fields.entry, l.fields.aspect, l.fields.newer ?? false])).toEqual([["e-layout", "layout", true], ["e-history", "history", false]]);
    // A new base drawn against what stands now takes the mark away.
    const again = await t.call("world_apply", { operations: [{ op: "set", at: "common_room", key: "description", value: "A low room, the hearth always lit.", source: { from: "author" } }] });
    expect(texts(again).join("\n")).toContain("the hearth always lit");
    const redrawn = baseOf(placeSliceOf(t.s.stateAt(t.turn.id).state), "common_room");
    expect((await sourcesNow(t.lore, { user: USER, chat: IFACE_CHAT }, "common_room", redrawn)).older).toBe(false);
    expect(redrawn?.versions.map((v) => v.text)).toEqual(["A low room of black beams and a wide hearth.", "A low room, the hearth always lit."]);
  });
});
