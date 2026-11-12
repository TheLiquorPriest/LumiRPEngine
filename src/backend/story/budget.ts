// The budget dial as a harness call reaches it (DEPTH2-PLAN §5): `draft_open` and the scene tools ask
// whether a T1, T2 or T3 treatment fits the player's story budget (`story.budget`), beside every
// draft on the chat's path that isn't dropped, and refuse past it in the player's words, saying how
// much the stretch holds and where the dial is changed.

import { RECORD_NOTE } from "../../shared/harness-texts-record";
import type { StoryBudget } from "../../shared/settings";
import { type BudgetSpent, budgetSpent, type Treatment, treatmentsOn } from "../../engine/story/budget";
import type { ToolOutcome } from "../agents/runtime";
import type { ToolReadView } from "../agents/tools/read-view";
import type { StoryRead } from "./record";

/** How `ask` would overspend `budget` beside the drafts on the path as `read` has them (the turn's staged ones included) and `also`, what else the caller counts (a scene played); null where it fits. */
export function overBudget(read: StoryRead, budget: StoryBudget, ask: Treatment, also: readonly Treatment[] = []): BudgetSpent | null {
  return budgetSpent(budget, [...treatmentsOn(read.path), ...also], ask);
}

/** A stretch of story time in words: in days, hours or minutes, as it divides. */
function stretchWords(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** The answer that refuses a treatment past the budget, in the player's words. */
export function budgetRefusal(view: ToolReadView, spent: BudgetSpent): ToolOutcome {
  return view.refuse(RECORD_NOTE.budget, { tier: String(spent.tier), stretch: stretchWords(spent.stretchMinutes), limit: String(spent.limit), used: String(spent.used) });
}
