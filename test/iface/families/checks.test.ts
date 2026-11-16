// Checks on an invented world: checks_odds is found by its own words, and reads an action's real
// odds for anyone, or why it cannot be tried, changing nothing. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { WorldDoc } from "../../../src/shared/world";
import { CHECK_TOOLS } from "../../../src/iface/families/checks";
import { dataOf, texts } from "../rig";
import { descriptions, eachFoundByItsWords, familyRig, searchByWords, wordsFromFiles } from "./kit";

/** A wall anyone may try to climb on a d20 against 10, and a gate only someone holding the gate key may try. */
function climbing(w: WorldDoc): void {
  w.actions.climb_wall = { id: "climb_wall", label: "Climb the wall", params: {}, requires: [], check: { id: "climb_wall", dice: "1d20", dc: "10" }, outcomes: { failure: [], success: [] }, duration: "3" };
  w.actions.force_gate = { id: "force_gate", label: "Force the gate", params: { gate: { type: "ref", ref: "thing" } }, requires: ["false"], check: { id: "force_gate", dice: "1d20", dc: "15" }, outcomes: { failure: [], success: [] }, duration: "1" };
}

describe("checks", () => {
  test("checks_odds is found by a search on its own words", async () => {
    await eachFoundByItsWords(CHECK_TOOLS.map((t) => t.name));
    expect(searchByWords("odds of an action", await descriptions())).toContain("checks_odds");
  });

  test("an action's odds are read for anyone, its arguments by name, and nothing changes", async () => {
    const t = await familyRig(climbing);
    const r = await t.call("checks_odds", { action: "climb_wall", actor: "Bram" });
    expect(r.error).toBeUndefined();
    const odds = dataOf(r).odds as JsonObject;
    expect(odds).toMatchObject({ action: "Climb the wall [climb_wall]", actor: "Bram [bram]", available: true, minutes: 3, dc: 10, chances: { failure: 45, success: 55 } });
    const shut = dataOf(await t.call("checks_odds", { action: "force_gate", actor: "bram", params: { gate: "Knife" } })).odds as JsonObject;
    expect(shut.available).toBe(false);
    expect(typeof shut.why).toBe("string");
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });

  test("an action that is not there names every action there is, once; a name not there is said with the near ones", async () => {
    const t = await familyRig(climbing);
    const r = await t.call("checks_odds", { action: "climb", actor: "bram" });
    expect(r.error).toBe(true);
    const said = texts(r).join("\n");
    expect(said.split("It is one of:")).toHaveLength(2);
    expect(said).toContain("climb_wall");
    const nobody = await t.call("checks_odds", { action: "climb_wall", actor: "Brahm" });
    expect(texts(nobody)[0]).toBe("there is nothing called Brahm that is a person. Near: Bram [bram], Tam [tam], Wren [wren], Odile [odile].");
    for (const x of [r, nobody]) wordsFromFiles(x);
  });
});
