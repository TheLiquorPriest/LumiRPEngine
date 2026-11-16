// The Places page's reading of what a route answers: who stands on which square (a big piece on each it covers), a scale and a legend in words, a record
// named by the words a lore entry's `defines` wrote it in, and the Rules page's hook standing and timeout.

import { describe, expect, test } from "bun:test";
import type { MapPieceShown, PlaceRow, TreeHook } from "../../src/shared/api";
import { namesRecord } from "../../src/ui/bindings";
import { legendWords, scaleWords, standing } from "../../src/ui/pages/places/grid";
import { placeMatches } from "../../src/ui/pages/places";
import { hookStanding, timeoutOf } from "../../src/ui/pages/rules/hooks";

const piece = (id: string, square: number[], over: Partial<MapPieceShown> = {}): MapPieceShown => ({ id, name: id, kind: "person", square, ...over });

describe("a place's grid", () => {
  test("a piece covering two squares by two stands on each, and who shares a square is listed together", () => {
    const on = standing([piece("cart", [2, 2], { size: [2, 2] }), piece("wren", [3, 3])]);
    expect([...on.keys()].sort()).toEqual(["2,2", "2,3", "3,2", "3,3"]);
    expect(on.get("3,3")?.map((p) => p.id)).toEqual(["cart", "wren"]);
  });

  test("a scale and a legend are said in words", () => {
    expect(scaleWords({ metres: 1.5, feet: 5, unit: "feet", diagonal: "one", step: { per: "round", seconds: 6, squares: 6 } })).toBe("A square is 5 feet wide; a round of 6 seconds moves 6 squares.");
    expect(scaleWords({ metres: 20, feet: 65, unit: "metres", diagonal: "one", step: { per: "minute" } })).toBe("A square is 20 metres wide; a minute moves one square.");
    expect(legendWords({ terrain: "water", blocked: true })).toBe("terrain water, blocked");
    expect(legendWords("wall")).toBe("wall");
  });

  test("a place matches by its name, its kind or the place it is in", () => {
    const row: PlaceRow = { place: "p-1", name: "The Long Table", parent: { id: "p-0", name: "Harbor Inn" }, kind: "spot", grid: false, made: true };
    expect([placeMatches(row, "table"), placeMatches(row, "inn"), placeMatches(row, "spot"), placeMatches(row, "castle")]).toEqual([true, true, true, false]);
  });
});

describe("bindings", () => {
  test("an entry's defines names a record by its ref, its id or its name, however written", () => {
    const record = { ref: "place:harbor", names: ["Harbor Inn", "harbor"] };
    expect(["place:harbor", "harbor", "HARBOR INN", " Harbor Inn "].map((what) => namesRecord(what, record))).toEqual([true, true, true, true]);
    expect(namesRecord("place:market", record)).toBe(false);
  });
});

describe("hooks on the Rules page", () => {
  const hook = (over: Partial<TreeHook>): TreeHook => ({ name: "check", on: "before-tool", runs: "./check.sh", off: false, offIn: [], replacedBy: null, applies: true, ...over });
  const file = { path: "@global/.hooks/hooks.yml" } as never;

  test("a hook waits for the server's rpe allow, runs once it is on, and says why it does not otherwise", () => {
    expect(hookStanding({ hook: hook({ state: "waiting" }), file }).words).toContain("rpe allow check");
    expect(hookStanding({ hook: hook({ state: "on" }), file }).inForce).toBe(true);
    expect(hookStanding({ hook: hook({ off: true, offIn: ["chat"], applies: false, state: "on" }), file }).words).toContain("switched off");
    expect(hookStanding({ hook: hook({ replacedBy: "hooks/hooks.yml", applies: false, state: "on" }), file }).words).toContain("replaced");
  });

  test("a hook's own timeout is read from its entry, not the next one's", () => {
    const text = "before-tool:\n  - name: check\n    command: ./check.sh\n    timeout: 10\n  - name: other\n    command: ./other.sh\n";
    expect(timeoutOf(text, "check")).toBe(10);
    expect(timeoutOf(text, "other")).toBeNull();
  });
});
