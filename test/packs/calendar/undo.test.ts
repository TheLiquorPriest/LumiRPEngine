// A holiday set in play and its Undo: the world's holidays read as they did before. The date is the starter world's, invented.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("a holiday set in play is taken back", async () => {
  const r = await rig("pov");
  const done = await recordedAndTaken(r, [event("calendar.holiday", { id: "zed_day", label: "Zed Day", rule: { type: "fixed", month: 7, day: 4 } })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
