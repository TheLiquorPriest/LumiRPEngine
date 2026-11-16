// The engine's validators advise on the store's own path: a code of a rule of the world is kept as the report of a change that
// applies, a structural one leaves the change unapplied with its report, and a number a cap lowers is told.

import { describe, expect, test } from "bun:test";
import { ruling } from "../../src/store/fold";
import { engine, testStore } from "./fixtures";

describe("the validators advise on the store's own path", () => {
  test("a stage that moved, a cap that lowers a number and a rule of the world apply with their codes; a thing not there stays unapplied", () => {
    const { s, revision } = testStore();
    s.createChat({ id: "c", revision });
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    const { changes, state } = s.addChanges(
      t.id,
      engine(
        { type: "set", entity: "wren", field: "stamina", value: 9 },
        { type: "set", entity: "wren", field: "stamina", value: 4, atMost: true },
        { type: "stage", track: "errand", from: "done", to: "done" },
        { type: "set", entity: "nobody", field: "stamina", value: 1 },
      ),
    );
    expect(changes.map((c) => [c.applied, c.reports.map((r) => r.code)])).toEqual([
      [true, []],
      [true, ["capped"]],
      [true, ["stage_moved"]],
      [false, ["missing_entity"]],
    ]);
    expect(state.world.entities.wren?.fields.stamina).toBe(4);
    expect(state.world.tracks.errand?.stage).toBe("done");
  });

  test("a code of a rule of the world is content, and one that names what is not there is structural", () => {
    expect(["stage_moved", "materialized", "exists", "declined", "not_open"].map(ruling)).toEqual(["content", "content", "content", "content", "content"]);
    expect(["missing_entity", "unknown_event", "bad_event", "not_found", "tied"].map(ruling)).toEqual(["structural", "structural", "structural", "structural", "structural"]);
  });
});
