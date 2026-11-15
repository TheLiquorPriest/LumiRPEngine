// Row 0.2's two-step form, thirty turns on the floor chat (PlanGates-24 item 2): the count of
// `../lib/count.ts` with the connection set to the two-step form. Nothing is told the owner of it here: its
// figures go to G0's report (`../g0/forms.ts` reads them back).

import { resolve } from "node:path";
import type { Play } from "../route/form";
import { isFloorActs, missingActs, type FloorActs } from "../floor/play";
import { playCount, type Counted } from "../lib/count";
import { liveLoopReader, type LoopReader } from "../lib/loop";
import { buildFrom, installedRph, type BuildReader } from "../lib/record";

const RPE_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** Plays the two-step form on the bed, through the host's acts. */
export async function playTwoStep(play: Play): Promise<void> {
  if (!isFloorActs(play.acts)) throw new Error(`the host's acts do not give what the two-step form is counted with (the floor's acts, PlanScenarios-2's rig host or PlanScenarios-3's bed host): ${missingActs(play.acts).join("; ")}`);
  const reader = liveLoopReader(play.acts);
  try {
    await playTwoStepWith(play, play.acts, reader, buildFrom(RPE_ROOT, installedRph(RPE_ROOT)));
  } finally {
    reader.close();
  }
}

/** The two-step form's play over a reader. */
export function playTwoStepWith(play: Play, acts: FloorActs, reader: LoopReader, build: BuildReader | null): Promise<Counted> {
  return playCount(play, acts, reader, build, { form: "two-step", setting: "two-step", part: "two-step", calls: "calls" });
}
