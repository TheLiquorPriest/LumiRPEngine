// What needs no answer does not ask for another call: a `world_apply` that is applied and answers
// "already so" or "kept on the horizon as words" as reports leaves the closing call unclean, so the
// model is called again. A line that only says
// how something was read, or that nothing needed changing, is the answer's text; one that says
// something does not add up stays a report. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-8" };

/** A blank world with a kitchen, two people in it, and a hand lantern on its floor. */
async function kitchen(): Promise<Rig> {
  const t = await rig({}, "blank");
  const r = await t.call("world_apply", {
    operations: [
      { op: "spawn", kind: "place", name: "Keeper's kitchen", source: SRC },
      { op: "spawn", kind: "person", name: "Traveller", at: "Keeper's kitchen", source: SRC },
      { op: "spawn", kind: "person", name: "Marta Venn", at: "Keeper's kitchen", source: SRC },
      { op: "spawn", name: "hand lantern", at: "Keeper's kitchen", source: SRC },
    ],
  });
  expect(r.error).toBeUndefined();
  return t;
}

async function play(t: Rig, operations: JsonObject[]): Promise<ToolResult> {
  const r = await t.call("world_apply", asHarnessPasses(t.tools.get("world_apply") as HostTool, { operations }));
  wordsFromFiles(r);
  return r;
}

describe("an answer with nothing wrong in it is clean", () => {
  test("the lantern already where it is put and a horizon kept partly as words are said in the answer, and nothing is reported", async () => {
    const t = await kitchen();
    const r = await play(t, [
      { op: "place", what: "hand lantern", at: "Keeper's kitchen", source: SRC },
      { op: "horizon", list: ["Keeper's kitchen", "the storm coming in"] },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    const lines = texts(r).filter((x) => x.startsWith("Operation"));
    expect(lines.some((x) => x.startsWith("Operation 1 (place): hand lantern [") && x.endsWith("] was already so; nothing changed."))).toBe(true);
    expect(lines.some((x) => x.startsWith("Operation 2 (horizon): the storm coming in names no place, person or thing, so it is kept on the horizon as words."))).toBe(true);
  });

  test("what does not add up stays a report: a giver who did not hold what was given", async () => {
    const t = await kitchen();
    const r = await play(t, [{ op: "give", what: "hand lantern", from: "Traveller", to: "Marta Venn", how: "lent", source: SRC }]);
    expect(r.error).toBeUndefined();
    expect(r.reports).toHaveLength(1);
    expect(r.reports?.[0]).toStartWith("Operation 1 (give): Traveller [");
    expect(r.reports?.[0]).toContain("did not hold hand lantern [");
  });
});
