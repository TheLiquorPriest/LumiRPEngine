// The player's journal (plan §8.3, §9.6): drawn from the quest records through what the player is shown of each. A quest he may see
// whole shows its name, what it is, each stage with its condition and what was called on it with the reason, who and where, and its
// stakes and rewards; one shown by stages, its name and those stages; one set to nothing is absent, with no stand-in row and no
// count. A secret the Author never showed is absent on this road as on every road the player looks. Code draws; it never decides
// what is shown: that is the Author's write, or the quest's own visibility where he made none.

import { type QuestView, seenOf } from "./record";
import type { JournalQuest, QuestRecordRow } from "./shapes";

/**
 * One stage of a quest as a page shows it, with the world's standing where the quest is one the world defines: each objective met or
 * not, as the player's quests show it; and on the record behind the gate (`record`), the way on that holds, which the Author takes.
 */
function stagesOf(view: QuestView, standing: Readonly<Record<string, string>>, only: ReadonlySet<string> | null, record: boolean): QuestRecordRow["stages"] {
  return view.stages
    .filter((s) => only === null || only.has(s.id))
    .map((s) => ({ id: s.id, label: s.label, condition: s.condition, state: s.call?.state ?? null, why: s.call?.why ?? null, current: view.world ? standing[view.id] === s.id : null, objectives: [...s.objectives], way: record ? s.way : null }));
}

/** A quest as the record holds it, whatever the player may see. */
export function recordOf(view: QuestView, standing: Readonly<Record<string, string>>, open: boolean): QuestRecordRow {
  return {
    id: view.id,
    kind: view.kind,
    name: view.name,
    world: view.world,
    objective: view.objective,
    why: view.why,
    stakes: view.stakes,
    rewards: view.rewards,
    stages: stagesOf(view, standing, null, true),
    who: view.who,
    where: view.where,
    things: view.things,
    closed: view.closed === null ? null : { outcome: view.closed.outcome, why: view.closed.why },
    thread: view.thread,
    visibility: view.visibility,
    shown: view.shown,
    open,
  };
}

/**
 * The journal: each quest the player may see. `knows` is whether his character knows a quest that is known to some, by the world's
 * own rule; `standing` is where each of the world's tracks stands now.
 */
export function journalOf(views: readonly QuestView[], standing: Readonly<Record<string, string>>, knows: (view: QuestView) => boolean): JournalQuest[] {
  return views.flatMap((view): JournalQuest[] => {
    const seen = seenOf(view, knows(view));
    if (!seen.whole && seen.stages.length === 0) return [];
    const base = { id: view.id, kind: view.kind, name: view.name, world: view.world };
    if (seen.whole) {
      return [
        {
          ...base,
          whole: true,
          objective: view.objective,
          why: view.why,
          stakes: view.stakes,
          rewards: view.rewards,
          stages: stagesOf(view, standing, null, false),
          who: view.who,
          where: view.where,
          things: view.things,
          closed: view.closed === null ? null : { outcome: view.closed.outcome, why: view.closed.why },
          thread: view.thread,
        },
      ];
    }
    return [{ ...base, whole: false, objective: null, why: null, stakes: null, rewards: null, stages: stagesOf(view, standing, new Set(seen.stages), false), who: [], where: [], things: [], closed: null, thread: null }];
  });
}
