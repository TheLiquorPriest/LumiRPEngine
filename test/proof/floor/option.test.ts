// The owner's connection, as an option (PlanGates-4-fix1 item 13; finding 22; N-15): given connections
// already made on both sides, Lumiverse's for the plain arm and RPE's for the Author's, the floor plays and
// judges there; the table names each arm's provider and model and refuses a verdict unless both arms ran
// on one model. The script never takes a key; without the option only the floor's own connections are
// called.

import { describe, expect, test } from "bun:test";
import { optionOf } from "../../../scripts/proof/floor/play";
import { floorHead, measuredRows } from "../../../scripts/testbed/floor-measure";
import { MODEL, recordedRun } from "./recorded";

/** Recorded turns on a second connection: the owner's, named by the option on both sides. */
function onOwners(plainModel = MODEL) {
  const run = recordedRun({ form: "tag", connection: "owner-author", plain: { connection: "conn-owner-plain", model: plainModel } });
  return { ...run, option: { plain: "conn-owner-plain", rpe: "owner-author" }, arms: { plain: { connection: "conn-owner-plain", provider: "invented-provider", model: plainModel }, rpe: { connection: "owner-author", provider: null, model: MODEL } } };
}

describe("the owner's connections, as an option", () => {
  test("over recorded turns of a second connection, the table names both arms' provider and model and judges there", () => {
    const run = onOwners();
    expect(floorHead(run)).toContain(`Played on the owner's connections, by option: plain invented-provider / ${MODEL} (connection conn-owner-plain); RPE provider not known / ${MODEL} (connection owner-author), the Author's model by its trace.`);
    const rows = measuredRows(run);
    expect(rows["first-words"].verdict).toBe("pass");
    expect(rows["per-token"].verdict).toBe("pass");
  });

  test("turns whose arms ran on two models give no verdict on the rows that compare them", () => {
    const rows = measuredRows(onOwners("another-invented-model"));
    for (const id of ["first-words", "per-token"] as const) {
      expect(rows[id].verdict).toBe("not judged");
      expect(rows[id].why).toContain(`plain generation ran on another-invented-model and the Author on ${MODEL}: not the same model`);
    }
  });

  test("an Author that did not run on the option's connection is no verdict there", () => {
    const run = { ...onOwners(), option: { plain: "conn-owner-plain", rpe: "owner-author-2" } };
    expect(measuredRows(run)["first-words"].why).toContain("the Author ran on owner-author, not on the owner's connection the option names (owner-author-2)");
  });

  test("the option names both arms or neither; without it only the floor's own connections are called", () => {
    expect(optionOf({})).toBeNull();
    expect(optionOf({ FLOOR_OWNER_PLAIN: "conn-owner-plain", FLOOR_OWNER_AUTHOR: "owner-author" })).toEqual({ plain: "conn-owner-plain", rpe: "owner-author" });
    expect(() => optionOf({ FLOOR_OWNER_PLAIN: "conn-owner-plain" })).toThrow("set FLOOR_OWNER_PLAIN");
    expect(floorHead(recordedRun({ form: "tag" })).join("\n")).toContain("Played on the floor's own connections (N-15)");
  });
});
