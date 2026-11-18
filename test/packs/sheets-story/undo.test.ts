// A story flag raised by a reply and the Undo of it. The flag's name is invented.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("a story flag is taken back", async () => {
  const r = await rig("pov");
  const done = await recordedAndTaken(r, [event("story.flag", { name: "met_danny", value: true })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
