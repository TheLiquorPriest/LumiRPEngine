// `story.record` (`shared/story-record.ts`): a record imported from the memory system the chat used
// before depth, landed at the stretch it spans. Like the narrative record's other events it changes no
// world state, validates structurally (never against the state, so a rebased view never drops it) and
// stands alone, never grouped.

import type { PackEvent } from "../../../shared/ledger";
import { recordOf, recordProblem, STORY_RECORD } from "../../../shared/story-record";
import type { EventTypeDef } from "../../../engine/registry";

export const storyRecordEvent: EventTypeDef<PackEvent> = {
  type: STORY_RECORD,
  neutral: true,
  validate: (e) => {
    if (e.group !== undefined || e.tiedTo !== undefined) return { code: "story_grouped", reason: "a story event stands alone (no group)" };
    const problem = recordProblem(e.data);
    return problem === null ? null : { code: "bad_story_event", reason: problem };
  },
  apply: () => {},
  describe: (e, _ctx, viewer) => {
    if (viewer !== undefined) return "";
    const r = recordOf(e.data);
    return r ? `imported ${r.level}: ${r.title} (messages ${r.range[0] + 1}–${r.range[1] + 1})` : "an imported record";
  },
};
