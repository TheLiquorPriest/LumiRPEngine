// `story.scene` (DEPTH-PLAN §4.4, §5.2, `shared/scene.ts`): the author's setup of a scene in a depth
// turn's record, with the effort each character plays at. Like the narrative record's other events it
// changes no world state, validates structurally (never against the state, so a rebased view never
// drops it) and stands alone, never grouped.

import type { PackEvent } from "../../../shared/ledger";
import { sceneOf, sceneProblem, STORY_SCENE } from "../../../shared/scene";
import type { EventTypeDef } from "../../../engine/registry";
import { own } from "../../../engine/pack-kit";

export const storySceneEvent: EventTypeDef<PackEvent> = {
  type: STORY_SCENE,
  neutral: true,
  validate: (e) => {
    if (e.group !== undefined || e.tiedTo !== undefined) return { code: "story_grouped", reason: "a story event stands alone (no group)" };
    const problem = sceneProblem(e.data);
    return problem === null ? null : { code: "bad_story_event", reason: problem };
  },
  apply: () => {},
  describe: (e, ctx) => {
    const s = sceneOf(e.data);
    if (!s) return "a scene";
    const place = own(ctx.world.places, s.place)?.name ?? s.place;
    return `${s.opens ? "a scene opens" : "the scene goes on"} at ${place}${s.ends ? ", and ends" : ""}`;
  },
};
