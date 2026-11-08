// `story.passage` and `story.unrendered` (DEPTH-PLAN §1.3, `shared/passage.ts`): how a scene's
// moments were rendered, and which the narrator couldn't render, in the turn record's read part.
// The rendering, never canon: they change no world state, validate structurally and are never
// grouped, as every story event. A player's line words neither: the reply is the rendering, and its
// change chip lists the beats that reached him (LIVE3 lane 1b), its unfaithful chip what wasn't rendered.

import type { PackEvent } from "../../../shared/ledger";
import { passageOf, passageProblem, STORY_PASSAGE, STORY_UNRENDERED, unrenderedOf, unrenderedProblem } from "../../../shared/passage";
import type { EventTypeDef } from "../../../engine/registry";

export const storyPassageEvent: EventTypeDef<PackEvent> = {
  type: STORY_PASSAGE,
  validate: (e) => {
    if (e.group !== undefined || e.tiedTo !== undefined) return { code: "story_grouped", reason: "a story event stands alone (no group)" };
    const problem = passageProblem(e.data);
    return problem === null ? null : { code: "bad_story_event", reason: problem };
  },
  apply: () => {},
  neutral: true,
  describe: (e, _ctx, viewer) => {
    if (viewer !== undefined) return "";
    const p = passageOf(e.data);
    return p ? `passage ${p.index + 1}: ${p.beats.length} beat(s)${p.departs ? ", streamed unfaithful" : ""}` : "passage";
  },
};

export const storyUnrenderedEvent: EventTypeDef<PackEvent> = {
  type: STORY_UNRENDERED,
  validate: (e) => {
    if (e.group !== undefined || e.tiedTo !== undefined) return { code: "story_grouped", reason: "a story event stands alone (no group)" };
    const problem = unrenderedProblem(e.data);
    return problem === null ? null : { code: "bad_story_event", reason: problem };
  },
  apply: () => {},
  neutral: true,
  describe: (e, _ctx, viewer) => {
    if (viewer !== undefined) return "";
    const n = unrenderedOf(e.data)?.moments.length ?? 0;
    return `${n} moment${n === 1 ? "" : "s"} not rendered`;
  },
};
