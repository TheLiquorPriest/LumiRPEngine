// Row 0.2's two-step form (PlanGates-24 item 2; plan §10.7, §17.1 l.1773): the same thirty lines with the
// connection in the two-step form (the first build stopped at 23 and 10). A turn is kept when the intent
// record was written first, the reply was the plain text of a message of its own shown when the message
// ended, and no working text was shown; calls on the reply's path are counted against exactly 2 (R-96).
// Reported beside the tags for G0's report: the plan gives the two-step form no pass of its own here, so
// both parts are measured as rates and shown with every miss, never judged.

import { gate } from "../route/form";
import { playTwoStep } from "./play";

export default gate({
  id: "phase0-0.2-two-step",
  waves: [1, 5],
  parts: [
    {
      id: "two-step",
      words: "The two-step form on the floor model: the intent record written first, the reply the plain text of a message of its own shown when the message ends, no working text shown, over the same thirty lines as the tags",
      mark: "as shipped",
      measured: "thirty simple turns on the floor chat, one at a time, RPE's connection set to the two-step form for the run; a turn is kept when the Author's first tool call is the write of the intent file, the reply was released as a message, and no call but the reply's carried text; reported beside the tags",
    },
    {
      id: "calls",
      words: "Model calls on the reply's path in the two-step form: exactly 2, counted over thirty turns and reported beside the tags",
      mark: "as shipped",
      measured: "per turn, the Author's calls begun before the reply's release, against exactly 2 (R-96); a turn whose reply was never released has no count and is a miss",
    },
  ],
  fixtures: [],
  bed: [
    "the floor fixture made by `bun scripts/testbed/floor.ts setup`: its invented card, persona, preset and book",
    "two connections in Lumiverse on the same model: plain generation (read, not sent to) and RPE's",
    "RPE's connection the Author runs on, in the two-step form: set for the run by the play in the chat's settings (`reply.forms.<connection>`)",
    "the lead driving one run at a time",
  ],
  live: playTwoStep,
});
