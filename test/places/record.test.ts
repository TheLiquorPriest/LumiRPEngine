import { describe, expect, test } from "bun:test";
import { PLACE_STORE_AREA } from "../../src/places/fold";
import { placeLines } from "../../src/places/lines";
import { PLACES_DEFAULTS } from "../../src/places/settings";
import { accessOf, featuresOf, placeAt, sinceOf } from "../../src/places/record";
import { factStore } from "../../src/store/facts";
import type { ChangeInput } from "../../src/store";
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
