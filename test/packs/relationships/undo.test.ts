// A regard changed by a reply and the Undo of it: how two people regard each other reads as it did. The people are the starter world's, invented.

import { expect, test } from "bun:test";
import { event, recordedAndTaken, rig } from "../../play/undo-rig";

test("a regard that warmed is taken back", async () => {
  const r = await rig("pov");
  const done = await recordedAndTaken(r, [event("relationships.regard", { from: "pov", to: "danny_okafor", deltas: { warmth: 5 }, at: r.world().clock })]);
  expect(done).toMatchObject({ applied: [true], changed: true, left: [], differs: [] });
});
