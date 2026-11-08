// `story.talk` (DEPTH-PLAN §2.5, `shared/talk.ts`): real-time dialogue starts, is offered, or ends.
// Like the narrative record's events it changes no world state (`neutral`: an entry of talk events
// alone stays out of the world-state folds), validates structurally (never against the state, so a
// rebased view never drops it) and stands alone, never grouped.

import type { PackEvent } from "../../../shared/ledger";
import { STORY_TALK, talkOf, talkProblem } from "../../../shared/talk";
import type { EventTypeDef } from "../../../engine/registry";
import { own } from "../../../engine/pack-kit";

export const storyTalkEvent: EventTypeDef<PackEvent> = {
  type: STORY_TALK,
  neutral: true,
  validate: (e) => {
    if (e.group !== undefined || e.tiedTo !== undefined) return { code: "story_grouped", reason: "a story event stands alone (no group)" };
    const problem = talkProblem(e.data);
    return problem === null ? null : { code: "bad_story_event", reason: problem };
  },
  apply: () => {},
  describe: (e, ctx) => {
    const t = talkOf(e.data);
    if (!t) return "real-time dialogue";
    const name = own(ctx.state.entities, t.with)?.name ?? t.with;
    return t.state === "on" ? `real-time dialogue with ${name}` : t.state === "offer" ? `real-time dialogue with ${name} offered` : `real-time dialogue with ${name} ends`;
  },
};
