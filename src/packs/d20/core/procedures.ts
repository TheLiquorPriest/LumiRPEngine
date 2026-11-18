// Each action's procedure (RULESET-DESIGN §5.1) as an effect of the pack's, `d20.<action>`: it reads the sheet and the ruleset,
// rolls what it rolls with the effect's own seeded dice, and gives the changes and the action's record. `who` is the act's doer;
// `ruled` the outcome the GM ruled, which is taken as it is and rolled for no further.

import type { EffectDef } from "../../../engine/registry";
import { D20_ACTIONS } from "../../../shared/d20";

/** The effect of each action, by its id. */
export const D20_PROCEDURES: readonly EffectDef[] = D20_ACTIONS.map((id) => ({
  type: `d20.${id === "d20_rest" ? "rest" : id}`,
  args: ["who", "ruled?"],
  resolve: () => {
    throw new Error(`The d20 pack's ${id} is not built yet.`);
  },
}));
