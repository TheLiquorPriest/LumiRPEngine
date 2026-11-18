// A person's need changed by a reply and the Undo of it: the need reads as it did. The people are the starter world's, invented.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("a need that rose is taken back", async () => {
  const r = await rig("pov");
  const done = await recordedAndTaken(r, [event("castlife.need", { entity: "pov", need: "hunger", delta: 5, at: r.world().clock })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
