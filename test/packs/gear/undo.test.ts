// What Belongings changes of a person's things, each change a press with its Undo: moving a thing, giving it a home, wearing it, naming it,
// letting someone use it and making a thing are taken back, and the world reads as it did. The people and things are the starter world's, invented.

import { expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { pressed, rig } from "../../play/undo-rig";

const fix = (thing: JsonObject) => ({ kind: "fix" as const, fix: { thing } });

test("a change to a thing is taken back", async () => {
  const r = await rig("pov");
  for (const [label, thing] of [
    ["move it", { do: "move", item: "pov_keys", to: { place: "bluebird_coffee" } }],
    ["give it a home", { do: "home", item: "pov_keys", home: { place: "bluebird_coffee" } }],
    ["take a watch off", { do: "wear", item: "pov_watch", off: true }],
    ["let someone use it", { do: "grant", item: "pov_truck", who: "danny_okafor" }],
    ["name it", { do: "label", item: "pov_truck", name: "Big truck" }],
    ["make a thing", { do: "make", name: "A rope", at: { in: "pov" } }],
  ] as [string, JsonObject][]) {
    const done = await pressed(r, fix(thing));
    expect(done.tap.applied, `${label}: ${done.tap.words}`).toBe(true);
    expect(done.undo?.words, `${label}: the Undo`).toBe("");
    expect(done.differs, `${label}: what the Undo gave back`).toEqual([]);
  }
});
