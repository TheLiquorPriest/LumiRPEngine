// Requirements in words (DESIGN §11): the drive action's "the vehicle isn't at the place already"
// has words of its own, and an authored requirement that only looks like it keeps its ordinary ones.

import { describe, expect, test } from "bun:test";
import { failureWords } from "../../src/play/state/requirement-words";

describe("requirement words", () => {
  test("the drive action's own-spot requirement reads as a vehicle already there", () => {
    expect(failureWords("place(vehicle) != to")).not.toBeNull();
  });

  test("an authored place(x) != here reads as it always did, never as the drive's", () => {
    expect(failureWords("place(lamp) != here")).toBe(failureWords("place(lamp) == elsewhere"));
    expect(failureWords("place(lamp) != here")).not.toBe(failureWords("place(vehicle) != to"));
  });
});
