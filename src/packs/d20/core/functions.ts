// The formula functions the layer adds (RULESET-DESIGN §4.4). Values stay numbers and words: no list enters the formula language.
// A ruleset's totals are written with them, and so are its tables' formulas.

import type { Value } from "../../../engine/expr";
import type { ReadContext } from "../../../engine/registry";
import { D20_FUNCTIONS } from "../../../shared/d20";

type Fn = (ctx: ReadContext, ...args: Value[]) => Value;

function notBuilt(name: string): Fn {
  return () => {
    throw new Error(`The d20 pack's ${name} is not built yet.`);
  };
}

/** Each function by its name in `D20_FUNCTIONS`. */
export const D20_FORMULAS: Readonly<Record<string, Fn>> = Object.fromEntries(Object.keys(D20_FUNCTIONS).map((name) => [name, notBuilt(name)]));
