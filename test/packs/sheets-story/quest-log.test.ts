// The quest log of the play view lists, under a quest the world defines, the stages it was moved past with how each ended and why, from the
// same moves the pages read (`withTrails`). The quest and the people are the starter world's, invented.

import { expect, test } from "bun:test";
import { decodeQuestsView } from "../../../src/packs/story/ui/panel";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { rig } from "../../play/undo-rig";

test("a quest moved from one stage to another shows the stage it left, how it ended and why", async () => {
  const r = await rig("marcus_delgado");
  const log = async () => decodeQuestsView((await r.view()).panels["story.quests"])?.tracks.find((t) => t.id === "q_fleet_contract");
  const before = await log();
  expect(before).toBeDefined();
  expect(before?.past).toEqual([]);
  await r.record([{ type: "stage", track: "q_fleet_contract", from: "kickoff", to: "trial", why: "The fleet's owner signed on." } as LedgerEvent]);
  const after = await log();
  expect(after?.stage).not.toBe(before?.stage);
  expect(after?.past).toEqual([{ label: expect.any(String), state: "met", why: "The fleet's owner signed on." }]);
});

test("a secret's moves are not told in the log: it lists a secret under a stand-in, which is no quest's", async () => {
  const r = await rig(undefined, "mystery_manor");
  await r.record([{ type: "stage", track: "s_thorne_death", from: "before", to: "cue", why: "Nobody has found the cup yet." } as LedgerEvent]);
  expect(JSON.stringify((await r.view()).panels["story.quests"])).not.toContain("Nobody has found the cup yet.");
});
