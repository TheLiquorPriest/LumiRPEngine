// What the engine's own events record and the Undo of each: a quest's stage and what was revealed of it, a tier and a life state, a value put
// back, and a roll, which stays. Each is told as a reply's event and taken back by the Undo of a change; the world reads as it did before.
// A change a later change has written over stays, and the answer names it. Every name is the starter world's own, invented.

import { describe, expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

describe("the engine's events are taken back", () => {
  test("a quest moved from one stage to another goes back to the stage and the minute it was entered, and what was revealed is hidden again", async () => {
    const r = await rig("pov");
    const was = structuredClone(r.world().tracks.q_fleet_contract);
    const done = await recordedAndTaken(r, [
      { type: "stage", track: "q_fleet_contract", to: "trial", from: "kickoff" },
      event("engine.revealed", { track: "q_fleet_contract", stage: "kickoff" }),
    ]);
    expect(done).toMatchObject({ applied: [true, true], changed: true, left: [], differs: [] });
    expect(r.world().tracks.q_fleet_contract).toEqual(was);
  });

  test("a tier and a life state are taken back", async () => {
    const r = await rig("pov");
    const done = await recordedAndTaken(r, [event("engine.entity", { entity: "danny_okafor", tier: "background" }), event("engine.life", { entity: "danny_okafor", to: "dead" })]);
    expect(done).toMatchObject({ applied: [true, true], changed: true, left: [], differs: [] });
  });

  test("a roll the player has seen stays, and the answer says why", async () => {
    const r = await rig("pov");
    const done = await recordedAndTaken(r, [event("engine.check", { actor: "pov", check: "repair", outcome: "success", total: 14, dc: 12 })]);
    expect(done.applied).toEqual([true]);
    expect(done.left.map((l) => [l.code, l.values?.op, l.values?.why])).toEqual([["not_reversible", "engine.check", "roll"]]);
  });
});
