// One tree at any zoom (plan §6.4): the engine's data read as one nested tree, each value with where
// it comes from, a reflection at every level kept current, zoom by a point and a depth in the same
// shape at every level, and the horizon, which only a recorded change sets.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { draftEvent, NO_DRAFT } from "../../src/engine/world-draft";
import { engine, goTo, play, POV, testStore } from "./fixtures";

function chat() {
  const ts = testStore();
  ts.s.createChat({ id: "c", revision: ts.revision });
  return ts;
}

const lines = (text: string): string[] => text.split("\n");
const HEADER = /^( *)\S.* \[[^\]]+\] \([^)]+\)( — .+)?$/;
const VALUE = /^( *)· [^:]+: /;

/** Every line is a level's header or one of its values, each value right under its level, each level two spaces in from its parent, and no deeper than asked. */
function shapeOf(text: string, depth: number): void {
  let header = -1;
  let deepest = 0;
  const levels: number[] = [];
  for (const line of lines(text)) {
    const h = HEADER.exec(line);
    if (h) {
      const level = (h[1] ?? "").length / 2;
      expect(Number.isInteger(level)).toBe(true);
      expect(level <= (levels.at(-1) ?? -1) + 1).toBe(true);
      levels.push(level);
      header = level;
      deepest = Math.max(deepest, level);
      continue;
    }
    const v = VALUE.exec(line);
    expect(v).not.toBeNull();
    expect((v?.[1] ?? "").length).toBe(header * 2 + 2);
    // Values belong to levels above the cut, never to the levels at it.
    expect(header < depth || header === 0).toBe(true);
  }
  expect(deepest).toBeLessThanOrEqual(depth);
}

describe("the tree view", () => {
  test("the engine's data reads as one tree, nested as the engine records it", () => {
    const { s } = chat();
    const view = s.view("c");
    expect(lines(view.query("world", 1))).toEqual([
      "The Hollow Vale [world] (world) — 4 people (Bram, Wren, Odile), 6 things, 7 places, 1 group, 2 records; 1 open",
      "  · time: Sat 1 Mar 2031, 8:00 AM (calendar)",
      "  · time zone: Europe/London",
      "  · currency: USD ($)",
      "  Hollow Vale [vale] (place) — 4 people (Bram, Wren, Odile), 6 things, 6 places, 1 record; 1 open",
      "  Groups [groups] (groups) — 1 group",
      "  Elsewhere [elsewhere] (not in any place) — 1 record",
    ]);
    const wren = view.query(POV, "full");
    for (const line of ["  Coin purse [purse] (Container) — 1 record", "    Wren's coin [acct_wren] (Account)", "  Grey cloak [cloak] (Item, worn)", "  Satchel [satchel] (Container) — 1 thing", "    Knife [knife] (Item)"]) expect(lines(wren)).toContain(line);
    const town = lines(view.query("thornbury", 2));
    expect(town.filter((l) => HEADER.test(l)).map((l) => l.replace(/ — .*$/, ""))).toEqual([
      "Thornbury [thornbury] (place)",
      "  Market Square [market_square] (place)",
      "    Tam [tam] (Character)",
      "    Market bell [bell] (Item)",
      "  The Lamp and Ladle [lamp_ladle] (place)",
      "    The Cellar [cellar] (place)",
      "    The Common Room [common_room] (place)",
    ]);
  });

  test("each value shows where it comes from; a level that sets its own keeps it, and a change on the town reaches every place in it", () => {
    const { s, world } = chat();
    const cellar = lines(s.view("c").query("cellar", 0));
    expect(cellar).toContain("  · law: the watch's rules (from Thornbury)");
    expect(cellar).toContain("  · owner: bram (from The Lamp and Ladle)");
    expect(cellar).toContain("  · region: region_vale (from Hollow Vale)");
    expect(cellar).toContain("  · time zone: Europe/London (from Hollow Vale)");
    expect(cellar).toContain("  · weather: rain (weather)");
    // What only describes a level stays with it.
    expect(cellar.some((l) => l.includes("A crooked inn"))).toBe(false);
    expect(lines(s.view("c").query("far_road", 0))).toContain("  · law: the Vale charter (from Hollow Vale)");
    // Play sets the town's curfew earlier: every place in the town that sets none takes it.
    const town = world.places.thornbury;
    if (!town) throw new Error("no town");
    const curfew = draftEvent(world, NO_DRAFT, { collection: "places", id: "thornbury", value: { ...town, fields: { ...town.fields, curfew: "dusk" } } as unknown as JsonObject });
    play(s, "c", "m1", "The watch rings the curfew early.", 1, engine(curfew));
    expect(lines(s.view("c").query("cellar", 0))).toContain("  · curfew: dusk (from Thornbury)");
    expect(lines(s.view("c").query("market_square", 0))).toContain("  · curfew: dusk (from Thornbury)");
    expect(lines(s.view("c").query("far_road", 0)).some((l) => l.includes("curfew"))).toBe(false);
  });

  test("every level carries a reflection of what is beneath it, kept current as the state changes, with an agent's own line", () => {
    const { s } = chat();
    const header = (at: string): string => lines(s.view("c").query(at, 0))[0] ?? "";
    expect(header("cellar")).toBe("The Cellar [cellar] (place) — 1 person (Odile), 1 thing");
    expect(header("market_square")).toBe("Market Square [market_square] (place) — 1 person, 1 thing");
    play(s, "c", "m1", "Tam ducks into the cellar out of the rain.", 1, [...engine(goTo("tam", "cellar")), { lane: "story", op: "store.note", value: { at: "cellar", text: "uneasy since the fire" }, by: "author", source: "author" }]);
    expect(header("cellar")).toBe("The Cellar [cellar] (place) — 2 people (Odile), 1 thing; changed turn 1; note: uneasy since the fire");
    expect(header("market_square")).toBe("Market Square [market_square] (place) — 1 thing");
    expect(header("thornbury")).toContain("changed turn 1");
    expect(header("far_road")).not.toContain("changed");
  });

  test("a query is a point and a depth, in the same shape at every level", () => {
    const { s } = chat();
    const view = s.view("c");
    for (const [at, depth] of [["world", 1], ["world", 3], ["vale", 2], ["lamp_ladle", 1], ["common_room", 2], [POV, 3], ["groups", 1]] as const) shapeOf(view.query(at, depth), depth);
    shapeOf(view.query("world", "full"), 99);
    expect(view.query("cella", 1)).toBe("Nothing in the tree is called cella. Near: The Cellar [cellar].");
  });

  test("the horizon is the Author's list: only a recorded change sets it, and it goes with its turn", () => {
    const { s } = chat();
    expect(s.view("c").horizon()).toEqual([]);
    play(s, "c", "m1", "She means to look in on the cellar.", 1, [{ lane: "story", op: "store.horizon", value: { list: ["cellar", "tam", "the_harbour"] }, by: "author", source: "author" }]);
    expect(s.view("c").horizon()).toEqual([
      { at: "cellar", ref: "place:cellar", name: "The Cellar" },
      { at: "tam", ref: "entity:tam", name: "Tam" },
      { at: "the_harbour", ref: null, name: null },
    ]);
    // Another swipe of that reply sets none: with it showing, the horizon is as it was before.
    play(s, "c", "m1", "She sits by the fire instead.", 2, [], { target: "m1" });
    expect(s.view("c").horizon()).toEqual([]);
  });
});
