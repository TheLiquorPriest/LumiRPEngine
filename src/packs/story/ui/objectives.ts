// A stage's objectives as the stage page edits them (DESIGN §10): each a label the player reads in
// their quests and a condition the engine tests. A plain-formula objective (the older form, which the
// player sees as its condition) edits the same way with no label.

import type { Objective } from "../../../shared/world";

/** One objective as the editor shows it: its label (empty for a plain formula) and its condition. */
export interface ObjectiveParts {
  label: string;
  when: string;
}

export function objectiveParts(o: Objective): ObjectiveParts {
  return typeof o === "string" ? { label: "", when: o } : { label: o.label, when: o.when };
}

/** An objective from what the editor holds: with a label, `{label, when}`; with none, the plain formula. */
export function objectiveFrom(parts: ObjectiveParts): Objective {
  const label = parts.label.trim();
  return label === "" ? parts.when : { label, when: parts.when };
}
