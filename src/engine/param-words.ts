// An action's parameter in words, for a person and for the Author alike: its label (its own, else its ref kind's, else a count's "How
// many", else its name in words), and, for a parameter that takes one of a list, each value it takes with the name a person is shown for
// it: a row of its data table, or what the game system that keeps the list gives (`ParamDef.choices`). The palette offers those names, a
// press that leaves the parameter out is told them, and the Author is told each value with its name; a person is never shown an id.

import type { EntityId } from "../shared/ids";
import { orOf, say } from "../shared/lines";
import { tableChoices } from "../shared/tables";
import type { ActionDef, ParamDef, WorldDoc } from "../shared/world";
import { optionalQuery, own } from "./pack-kit";
import type { QueryMap, ReadContext } from "./registry";
import type { Registry } from "./registry-impl";

/** The param that counts an action's thing (Buy's, a holding's sale): it reads with that thing. */
export const COUNT_PARAM = "qty";

/** A param's label: its own, else its ref kind's ("Person"), else a count's "How many", else its name in words ("Days"). */
export function paramLabel(action: ActionDef, name: string, world: WorldDoc, registry: Registry): string {
  const def = action.params[name];
  if (def?.label) return def.label;
  const kind = def?.ref ? (world.kinds[def.ref] ?? registry.kinds.get(def.ref)) : undefined;
  if (kind?.label) return kind.label;
  if (name === COUNT_PARAM) return say("action_how_many");
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One value a parameter takes, and the name a person is shown for it. */
export interface ParamChoice {
  value: string;
  label: string;
}

/** What a game system registers under the name a parameter's `choices` gives: each value the parameter takes for `actor`, with its name. */
export type ParamChoicesQuery = (ctx: ReadContext, actor: EntityId) => ParamChoice[];

/** The values a `text` parameter takes, each with its name: its data table's rows, else its `choices` query's list; none for any other. */
export function paramChoices(ctx: ReadContext, def: ParamDef | undefined, actor: EntityId): ParamChoice[] {
  if (def?.type !== "text") return [];
  if (def.table !== undefined) return tableChoices(own(ctx.world.tables, def.table)).map((row) => ({ value: row.key, label: row.label }));
  if (def.choices === undefined) return [];
  // The query is named by the declaration, so it is looked up by that name: every such query has the one shape `ParamChoicesQuery` says.
  const query = optionalQuery(ctx, def.choices as keyof QueryMap) as unknown as ParamChoicesQuery | null;
  return query === null ? [] : query(ctx, actor);
}

/**
 * Why an action cannot be done while a parameter it needs is left out, in a person's words: the action by its label, the parameter by
 * its own, and, where it takes one of a list, the names of the list (`why_action_needs_param`).
 */
export function neededWords(registry: Registry, world: WorldDoc, action: ActionDef, name: string, choices: readonly ParamChoice[]): string {
  const param = paramLabel(action, name, world, registry).toLowerCase();
  return say("why_action_needs_param", { action: action.label, param, ...(choices.length > 0 ? { choices: orOf(choices.map((c) => c.label)) } : {}) });
}
