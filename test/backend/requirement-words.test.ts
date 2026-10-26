// Requirements in words (DESIGN §11): the drive action's "the vehicle isn't at the place already"
// has words of its own, and an authored requirement that only looks like it keeps its ordinary ones.

import { describe, expect, test } from "bun:test";
import type { ActionDef } from "../../src/shared/world";
import { failureWords, needsOf } from "../../src/backend/requirement-words";

const named = (param: string): string => `the ${param}`;

function action(requires: string[]): Pick<ActionDef, "params" | "requires"> {
  return { params: { vehicle: { type: "ref", ref: "vehicle" }, to: { type: "ref", ref: "place" }, lamp: { type: "ref", ref: "item" } }, requires };
}

describe("requirement words", () => {
  const drive = "place(vehicle) != to";

  test("the drive action's own-spot requirement reads as a vehicle already there", () => {
    expect(failureWords(drive)).not.toBeNull();
    expect(needsOf(action([drive]), named)).toHaveLength(1);
  });

  test("an authored place(x) != here reads as it always did, never as the drive's", () => {
    const authored = "place(lamp) != here";
    expect(failureWords(authored)).toBe(failureWords("place(lamp) == elsewhere"));
    expect(needsOf(action([authored]), named)).not.toEqual(needsOf(action([drive]), named));
    expect(needsOf(action([authored]), named)).toEqual(needsOf(action(["place(lamp) == elsewhere"]), named));
  });
});
