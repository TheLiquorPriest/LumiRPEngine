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
    expect(itemObjective("carries", relay)).toEqual({ label: "Have the spare relay with you", when: "carries(pov, 'spare_relay')" });
    expect(itemObjective("carries", relay, null, "Bring the relay back")).toEqual({ label: "Bring the relay back", when: "carries(pov, 'spare_relay')" });
    expect(itemObjective("at", relay, { id: "tower", name: "the radio tower" })).toEqual({ label: "Get the spare relay to the radio tower", when: "at('spare_relay', 'tower')" });
  });
});
