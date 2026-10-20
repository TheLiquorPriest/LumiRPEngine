import { describe, expect, test } from "bun:test";
import { initialUi } from "../../src/frontend/app";
import { findEntities } from "../../src/frontend/gm/editor";
import { gmAt, hideTruth, revealTruth } from "../../src/frontend/gm/gate";
import { placesInOrder } from "../../src/frontend/gm/sections";
import type { GmEntity, GmView } from "../../src/shared/state-view";

describe("the GM gate", () => {
  test("Show the truth opens it, moving between sections keeps it, and Hide closes it where it was", () => {
    const shown = gmAt(revealTruth(initialUi(false)), "economy.money");
    expect(shown.gm).toEqual({ revealed: true, section: "economy.money" });
    expect(gmAt(shown, "story").gm).toEqual({ revealed: true, section: "story" });
    expect(hideTruth(shown).gm).toEqual({ revealed: false, section: "economy.money" });
  });

  test("a transition that changes nothing keeps the same state, so nothing re-renders for it", () => {
    const ui = initialUi(false);
    expect(hideTruth(ui)).toBe(ui);
    expect(gmAt(ui, "world")).toBe(ui);
    const shown = revealTruth(ui);
    expect(revealTruth(shown)).toBe(shown);
  });
});

const entity = (id: string, name: string, kind: string, gone = false): GmEntity => ({ id, name, kind, tier: "background", agent: false, pov: false, gone, spawned: false, visibility: "public", place: null, holder: null, fields: [], relations: [], levels: [], class: {}, tags: [], sheet: null, life: { state: "alive", label: "Alive", acts: true, everyone: true, aware: [], unaware: [] } });

describe("World's search", () => {
  const all = [entity("npc_vic", "Vic Moreau", "npc", true), entity("npc_rosie", "Rosie Alvarez", "npc"), entity("civic", "Honda Civic", "vehicle"), entity("npc_dev", "Dev Patel", "npc")];

  test("present people and things come first, the removed after, each by name", () => {
    expect(findEntities(all, "", "").map((e) => e.id)).toEqual(["npc_dev", "civic", "npc_rosie", "npc_vic"]);
  });

  test("a kind filter and a name or id fragment, in any case, narrow it together", () => {
    expect(findEntities(all, "", "npc").map((e) => e.id)).toEqual(["npc_dev", "npc_rosie", "npc_vic"]);
    expect(findEntities(all, "  ROS ", "").map((e) => e.id)).toEqual(["npc_rosie"]);
    expect(findEntities(all, "npc_", "vehicle")).toEqual([]);
    expect(findEntities(all, "civic", "").map((e) => e.id)).toEqual(["civic"]);
  });
});

describe("GM Places", () => {
  const place = (id: string, parent: string | null): GmView["places"][number] => ({ id, name: id, visibility: "public", parent, pins: 0 });

  test("each place reads under its parent, depth first, in the world's order", () => {
    const order = placesInOrder([place("office", "diner"), place("diner", null), place("apartment", null), place("booth", "diner"), place("drawer", "office")]);
    expect(order.map((p) => [p.place.id, p.depth])).toEqual([
      ["diner", 0],
      ["office", 1],
      ["drawer", 2],
      ["booth", 1],
      ["apartment", 0],
    ]);
  });

  test("a place under a parent the GM view doesn't list is at the top, and a loop of parents still lists every place once", () => {
    const order = placesInOrder([place("cellar", "gone"), place("a", "b"), place("b", "a"), place("self", "self")]);
    expect(order.map((p) => [p.place.id, p.depth])).toEqual([
      ["cellar", 0],
      ["a", 0],
      ["b", 0],
      ["self", 0],
    ]);
  });
});
