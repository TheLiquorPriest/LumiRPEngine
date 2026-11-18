// A round of the minds told by a reply and the Undo of it: the count of rounds reads as it did.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("a round of the minds is taken back", async () => {
  const r = await rig("pov");
  const done = await recordedAndTaken(r, [event("minds.round", { on: true, at: r.world().clock })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
