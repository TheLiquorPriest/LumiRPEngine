// A limit reached, as the pages count it: a limit not passed, but with too little left under it for an
// answer, is told by what was left, the least room an answer is given, and that the next call was not
// made for it; never as a count under its limit.

import { expect, test } from "bun:test";
import { limitCount, limitName } from "../../src/ui/words";

test("a limit with too little left for an answer says what was left and why the call was not made; one reached gives its count", () => {
  const floor = { limit: "tokens" as const, per: "job" as const, max: 300, value: 279, floor: 256 };
  expect(`${limitName(floor)}: ${limitCount(floor)}`).toBe('tokens sent and written in one job: 21 of 300 left, less than the 256 tokens your setting "Least room for an answer" keeps for an answer, so the next call was not made');
  expect(limitCount({ limit: "calls", max: 40, value: 40 })).toBe("40 of 40");
});
