// The words of an action a pack declares: its label, its description and the labels of its params. They are read from the lines
// (`guidance/.prompts/history-actions.md`: `action_<id>_label`, `action_<id>_description`, `action_<id>_param_<name>`) each time one is read,
// so they are the words in force then (a chat's own copy included, as `say` has it) and never words in code. A label whose line is not there
// reads as the action's id; a description or a param label with no line reads as none.

import type { ActionDef, ParamDef } from "../shared/world";
import { say } from "../shared/lines";
import type { PackAction } from "./registry";

/** The action as the registry holds it: `def` with its label, its description and its params' labels read through the lines. */
export function spoken(def: PackAction): ActionDef {
  const { words, ...given } = def;
  const id = def.id;
  const params: Record<string, ParamDef> = {};
  for (const [name, written] of Object.entries(def.params)) {
    // Copied as it is defined, not as it reads now: a worded param's label is read when asked for (a spread would say it here, while the registry is made, before it is certain any lines are in force).
    const param = Object.defineProperties({}, Object.getOwnPropertyDescriptors(written)) as ParamDef;
    Object.defineProperty(param, "label", { enumerable: true, configurable: true, get: () => say(`action_${id}_param_${name}`, words) || written.label });
    params[name] = param;
  }
  const action = { ...given, params } as ActionDef;
  Object.defineProperties(action, {
    label: { enumerable: true, configurable: true, get: () => say(`action_${id}_label`, words) || id },
    description: { enumerable: true, configurable: true, get: () => say(`action_${id}_description`, words) || undefined },
  });
  return action;
}
