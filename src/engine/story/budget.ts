// The budget dial (DEPTH2-PLAN §5): how many T1, T2 and T3 treatments a stretch of story time allows
// (`StorySettings.budget`). T4, the author just writing it, is never counted. A treatment counts
// wherever it sits within one stretch of the one asked for, before or after it in story time, so no
// stretch anywhere holds more than the dial allows. Pure: `draft_open` and the scene tools ask it with
// what they count as treatments.

import type { DraftTier } from "../../shared/ledger";
import type { StoryBudget } from "../../shared/settings";
import type { StoryPath } from "./record";

/** One treatment: its tier, and when in story time it treats. */
export interface Treatment {
  tier: DraftTier;
  at: number;
}

/** A tier the budget is spent on around a treatment asked for: its tier, how many the dial allows, how many the stretch holds, and the stretch. */
export interface BudgetSpent {
  tier: 1 | 2 | 3;
  limit: number;
  used: number;
  stretchMinutes: number;
}

/** The treatments the drafts on `path` stand for: each one not dropped. */
export function treatmentsOn(path: StoryPath): Treatment[] {
  return path.drafts.filter(({ draft }) => draft.state !== "dropped").map(({ draft }) => ({ tier: draft.tier, at: draft.when }));
}

/** How `ask` would overspend `budget` beside `used`; null where it fits, as T4 always does. */
export function budgetSpent(budget: StoryBudget, used: readonly Treatment[], ask: Treatment): BudgetSpent | null {
  if (ask.tier === 4) return null;
  const tier = ask.tier;
  const limit = tier === 1 ? budget.t1 : tier === 2 ? budget.t2 : budget.t3;
  const count = used.filter((t) => t.tier === tier && Math.abs(t.at - ask.at) < budget.stretchMinutes).length;
  return count >= limit ? { tier, limit, used: count, stretchMinutes: budget.stretchMinutes } : null;
}
