// The narrative record's events (DEPTH-PLAN §4.2): `story.beat`, `story.staging` and `story.strike`.
// They change no world state; what is on the active chain is read by walking it
// (`engine/ledger/story.ts`). Validation is structural, never state-dependent, and a story event is
// never grouped, so a rebased view never drops one: a beat is canon wherever its record or layer
// entry folds.

import type { PackEvent } from "../../../shared/ledger";
import { beatOf, beatProblem, STORY_BEAT, STORY_STAGING, STORY_STRIKE, stagingOf, stagingProblem, strikeOf, strikeProblem } from "../../../shared/story";
import type { EventTypeDef, Rejection } from "../../../engine/registry";

function structural(e: PackEvent, problem: string | null): Rejection | null {
  if (e.group !== undefined || e.tiedTo !== undefined) return { code: "story_grouped", reason: "a story event stands alone (no group)" };
  return problem === null ? null : { code: "bad_story_event", reason: problem };
}

// A player's line (`viewer`) words none of them: a beat's and a staging's words are blobs the
// describer can't read, so the change chip lists the beats that reached the player character by
// their texts (`backend/view.ts` `beatLines`, LIVE3 lane 1b) and never by id.
export const storyBeatEvent: EventTypeDef<PackEvent> = {
  type: STORY_BEAT,
  validate: (e) => structural(e, beatProblem(e.data)),
  apply: () => {},
  neutral: true,
  describe: (e, _ctx, viewer) => {
    if (viewer !== undefined) return "";
    const b = beatOf(e.data);
    return b ? `beat ${b.id}: ${b.actors.join(", ") || "the world"} ${b.act}` : "beat";
  },
};

export const storyStagingEvent: EventTypeDef<PackEvent> = {
  type: STORY_STAGING,
  validate: (e) => structural(e, stagingProblem(e.data)),
  apply: () => {},
  neutral: true,
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `staging of ${stagingOf(e.data)?.who ?? "someone"}`),
};

export const storyStrikeEvent: EventTypeDef<PackEvent> = {
  type: STORY_STRIKE,
  validate: (e) => structural(e, strikeProblem(e.data)),
  apply: () => {},
  neutral: true,
  describe: (e) => `struck ${strikeOf(e.data)?.beats.length ?? 0} beat(s)`,
};
