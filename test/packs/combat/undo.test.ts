// A fight begun by a reply and the Undo of it: no fight is under way. The fighters are the starter world's people, invented.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("a fight begun is taken back", async () => {
  const r = await rig("pov");
  const fighters = [
    { id: "pov", side: "party", init: 10, left: {} },
    { id: "danny_okafor", side: "foes", init: 5, left: {} },
  ];
  const done = await recordedAndTaken(r, [event("combat.start", { encounter: "e1", place: null, order: fighters })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
