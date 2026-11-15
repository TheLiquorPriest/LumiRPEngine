// G0, the floor test in miniature (PlanGates-17; plan §18.1 G0, pass "§17.1's first four rows"; §20 risk
// 13: if G0 fails, nothing widens). As a gate the proof runner plays (`scripts/proof/run.ts`), live on the
// test bed at wave 1's checkpoint, in a run of its own after the tags run of row 0.2 (PlanGates-24) and
// before the floor's: `G0` and `floor` are two ids, each played once in a run. It plays the floor's ten
// pairs (`scripts/proof/floor/play.ts`) and judges the floor's first four rows with the floor's own words
// and measures (`../floor/gate.ts`, one home for them), reads row 0.2's tags count from the tags run's
// bundle, and gives the owner his report and his notices (`./run.ts`, `./report.ts`, `./notice.ts`).
// G0's verdict is its part `verdict`: the one word the wave 1 checkpoint's record takes (PlanScenarios).
// There is no rig form: G0's figures are times of a real model on the bed, and a scripted model gives none.

import { gate, type GatePart } from "../route/form";
import floor from "../floor/gate";
import { playG0 } from "./run";

const floorPart = (id: string): GatePart => {
  const part = floor.parts.find((p) => p.id === id);
  if (part === undefined) throw new Error(`the floor gate has no part ${id}`);
  return part;
};

export default gate({
  id: "G0",
  waves: [1],
  parts: [
    floorPart("conditions"),
    floorPart("first-words"),
    floorPart("per-token"),
    floorPart("calls"),
    floorPart("sent"),
    { id: "tags", words: "The tags on the floor model: kept in at least 28 of 30 turns; below that the connection works the two-step way (§10.7), and as it is the floor model you are told at G0, before anything is widened", mark: "code", measured: "read, not counted: the count the tags gate (`phase0-0.2-tags`, thirty turns on the floor chat, played in a run of its own just before G0) kept in its own bundle, taken only when that bundle reads back whole, its play was a verdict, it stood on the same shipped files and the same model as this run, and it was played in the same place; reported with its figures and what follows from them, and the two-step form's count beside it" },
    { id: "verdict", words: "G0: the floor test in miniature: §17.1's first four rows pass on plain generation beside RPE, the same model at the same thinking effort", mark: "code", measured: "the four rows judged on one run with no trial and no stop, whose conditions held, the Author in the form the floor model needs; passed only when all four passed, failed when one failed, and no verdict where any is not judged (what the model was sent not measured, a trial, a stop, a form that is not the connection's)" },
  ],
  fixtures: [],
  bed: [
    ...floor.bed,
    "the tags run of row 0.2 (`phase0-0.2-tags`) played just before in a run of its own, on the same shipped files and the same model: its folder named by G0_TAGS_RUN, or the newest under RPE_PROOF_OUT; the two-step run (`phase0-0.2-two-step`) the same way (G0_TWO_STEP_RUN)",
    "a variant of the design (the reply form, the shipped wording, the Author's effort in its definition) measured by this same gate in a run of its own, its change named in G0_VARIANT",
  ],
  live: playG0,
});
