// The world beyond view's events in the story pack (DEPTH-PLAN §4.6, `shared/episodes.ts`).
//
//   story.draft   an episode simulated off screen, not canon: like the narrative record's events it
//                 validates structurally (so a rebased view never drops it) and stands alone, never
//                 grouped. All it changes is whom it holds from routine (`holds`: its people, for its
//                 episode's span), so the Cast life planner places none of them elsewhere then
//                 (`story.held`); a drop lets them go, a settlement keeps the hold for the span
//   story.settle  a draft made canon: it marks the draft settled in the story slice (`settled`: draft
//                 → the minute its beats were dated from), so a chain settles a draft once and never
//                 one the author dropped; its entry carries the beats and the world changes beside it.
//                 Decided at its basis, before whatever turn may follow there, it lands only where those
//                 turns still fold as made with it and the live beats from its minute on are the pins
//                 it read (`later`, checked in `LedgerCore.layerVerdict`)

import { draftOf, draftProblem, droppedIn, holdOf, pinsOf, settledIn, settleOf, settleProblem, STORY_DRAFT, STORY_SETTLE } from "../../../shared/episodes";
import type { JsonObject } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import type { EventTypeDef, Rejection } from "../../../engine/registry";
import { mutableSlice, objOf, sliceOf } from "../../../engine/pack-kit";

function alone(e: PackEvent): Rejection | null {
  return e.group !== undefined || e.tiedTo !== undefined ? { code: "story_grouped", reason: "a story event stands alone (no group)" } : null;
}

export const storyDraftEvent: EventTypeDef<PackEvent> = {
  type: STORY_DRAFT,
  validate: (e) => {
    const problem = draftProblem(e.data);
    return alone(e) ?? (problem === null ? null : { code: "bad_story_event", reason: problem });
  },
  apply: (e, state) => {
    const d = draftOf(e.data);
    if (!d) return;
    const slice = mutableSlice(state, "story");
    slice.holds = { ...objOf(slice.holds), [d.id]: holdOf(d) as unknown as JsonObject };
  },
  describe: (e) => {
    const d = draftOf(e.data);
    return d ? `a draft of what happens off screen (${d.beats.length} beat${d.beats.length === 1 ? "" : "s"}): ${d.summary}` : "a draft of what happens off screen";
  },
};

export const storySettleEvent: EventTypeDef<PackEvent> = {
  type: STORY_SETTLE,
  validate: (e, ctx) => {
    const grouped = alone(e);
    if (grouped) return grouped;
    const problem = settleProblem(e.data);
    if (problem !== null) return { code: "bad_story_event", reason: problem };
    const draft = String(e.data.draft);
    if (settledIn(sliceOf(ctx.state, "story"), draft)) return { code: "draft_settled", reason: "this draft is already settled here" };
    if (droppedIn(sliceOf(ctx.state, "author"), draft)) return { code: "draft_dropped", reason: "the author dropped this draft here" };
    return null;
  },
  apply: (e, state) => {
    const s = settleOf(e.data);
    if (!s) return;
    const slice = mutableSlice(state, "story");
    slice.settled = { ...objOf(slice.settled), [s.draft]: s.at };
  },
  later: {
    pins: (e, story) => {
      const s = settleOf(e.data);
      if (!s) return null;
      const now = pinsOf(story, s.at);
      if (now.digest === s.pins.digest) return null;
      return now.count > s.pins.count ? `the story moved on past what it read: ${now.count - s.pins.count} beat${now.count - s.pins.count === 1 ? "" : "s"} from its story time on came since` : "the beats it read from its story time on have changed since";
    },
  },
  describe: (e) => {
    const s = settleOf(e.data);
    return s ? `a draft settled: ${s.beats.length} beat${s.beats.length === 1 ? "" : "s"} made canon` : "a draft settled";
  },
};
