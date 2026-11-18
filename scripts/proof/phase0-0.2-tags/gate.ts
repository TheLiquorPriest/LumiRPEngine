// Row 0.2's tags (PlanGates-24 item 1 and item 4's notice; plan §18.1 row 0.2: "on the floor model the tags
// are kept in at least 28 of 30 turns"; below that "that connection works the two-step way (§10.7), and if
// it is the floor model you are told at G0"). Live on the bed at wave 1's checkpoint, before G0, which reads
// its count from this run's bundle; in the formal round on the final build, for §22's table. The count is
// the rate the plan asks, 28 of 30, of a part that rests on the shipped guidance; the loop's notice is a
// part of its own.

import { gate } from "../route/form";
import { TAGS_PASS } from "../lib/phase0";
import { playTags } from "./play";

export default gate({
  id: "phase0-0.2-tags",
  waves: [1, 5],
  parts: [
    {
      id: "tags",
      words: "On the floor model the tags are kept in at least 28 of 30 turns",
      mark: "as shipped",
      wants: TAGS_PASS,
      measured:
        "thirty simple turns on the floor chat (the floor's twenty lines and ten more), one at a time through the chat page, RPE's connection set to the tag form for the run in the chat's settings, under the shipped files as they stand; a turn is kept when its first message held the intent record in its tag at its head and the reply in its tag, closed, with nothing leaked, before any reminder added a call (the first build's definition, read from RPE's trace); a turn whose RPE side could not be read is neither kept nor missed; below 28 of 30 that connection works the two-step way and the owner is told at G0",
    },
    {
      id: "loop",
      words: "pi's loop: where it fell short, told to you before wave 1 with the choice of fixing around pi or keeping LumiAH's loop for now",
      mark: "code",
      measured: "the three findings of Phase 0's report on pi's loop (a stop that pi alone does not carry through, follow-ups pi still reads after a batch that ended the run, sampling applied per request only on OpenAI-compatible connections), each asked again of the installed pi and of RPH as they stand, printed as a notice with both choices and kept; met where each still reads as found",
    },
  ],
  fixtures: [],
  bed: [
    "the floor fixture made by `bun scripts/testbed/floor.ts setup`: its invented card, persona, preset and book",
    "two connections in Lumiverse on the same model: plain generation (read, not sent to) and RPE's",
    "RPE's connection the Author runs on, in the tag form: set for the run by the play in the chat's settings (`connections.<connection>.reply.form`)",
    "the lead driving one run at a time",
  ],
  live: playTags,
});
