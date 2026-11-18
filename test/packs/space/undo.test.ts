// Where someone is within a place, told by a reply, and the Undo of it. The people and places are the starter world's, invented.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("where someone is in a place is taken back", async () => {
  const r = await rig("pov");
  const done = await recordedAndTaken(r, [event("space.where", { entity: "pov", zone: "yard", words: "by the door" })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
