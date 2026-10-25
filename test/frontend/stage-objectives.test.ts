// A stage's objectives on the stage page (DESIGN §10): a labelled objective shows and edits both its
// label and its condition, a plain formula still works, and an item check writes a label the player
// can read rather than code.

import { describe, expect, test } from "bun:test";
import { objectiveFrom, objectiveParts } from "../../src/packs/story/ui/objectives";
import { itemObjective } from "../../src/shared/items-build";

describe("a stage's objectives", () => {
  test("a labelled objective shows its label and its condition, and a plain formula its condition", () => {
    expect(objectiveParts({ label: "Find the ledger", when: "carries(pov, 'ledger')" })).toEqual({ label: "Find the ledger", when: "carries(pov, 'ledger')" });
    expect(objectiveParts("at(pov, 'cafe')")).toEqual({ label: "", when: "at(pov, 'cafe')" });
  });

  test("an edit keeps the objective's form: labelled stays labelled, no label is the plain formula", () => {
    expect(objectiveFrom({ label: " Find the ledger ", when: "carries(pov, 'ledger')" })).toEqual({ label: "Find the ledger", when: "carries(pov, 'ledger')" });
    expect(objectiveFrom({ label: "", when: "at(pov, 'cafe')" })).toBe("at(pov, 'cafe')");
  });

  test("an item check writes a plain label the player reads, which the author may reword", () => {
    const relay = { id: "spare_relay", name: "Spare relay" };
    const tower = { id: "tower", name: "Radio tower" };
    const carries = itemObjective("carries", relay);
    const lies = itemObjective("at", relay, tower);
    // The label names the thing (and the place) by name, never by id; the condition holds the ids.
    expect(carries.label.toLowerCase()).toContain("spare relay");
    expect(carries.label).not.toContain("spare_relay");
    expect(carries.when).toBe("carries(pov, 'spare_relay')");
    expect(lies.label.toLowerCase()).toContain("radio tower");
    expect(lies.when).toBe("at('spare_relay', 'tower')");
    // A different check reads differently.
    expect(new Set([carries.label, itemObjective("has_item", relay).label, lies.label]).size).toBe(3);
    // The author's own line replaces the suggestion.
    expect(itemObjective("carries", relay, null, "Bring the relay back").label).toBe("Bring the relay back");
  });
});
