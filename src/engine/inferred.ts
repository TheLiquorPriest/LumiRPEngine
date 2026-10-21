// Inferred checks (DESIGN §11): a typed attempt no catalog action with its own check covers, read by
// `interpret` as the built-in Try something, and rolled with the world's own sheet through the one
// check mechanism. Pure: the policy, the world's skills, the read's checks and the roll read only the
// world, the state and the turn's seed, so the plan, a Re-run and every replay read the same.
//
//   policy   the chat's `infer` marker, else the world ruleset's default, else its realism preset's
//            at its Sheets level (`inferredDefaults`)
//   skills   the rows of each table a skill action names (Use a skill, Make a save: a check, a text
//            param from a table and a difficulty), rolled by that action's check; and, on the Sheets
//            pack's own sheet, its stats, rolled by Attempt's

import type { Level } from "../shared/ids";
import { inferredDefaults, readInferred, type InferredChecks, type SheetSkill } from "../shared/inferred";
import { tableChoices } from "../shared/tables";
import type { ActionDef, WorldDoc } from "../shared/world";
import { offersAction } from "../shared/world";
import { checkOf } from "./checks";
import { optionalQuery, own } from "./pack-kit";
import { presetOf } from "./realism";
import type { Registry } from "./registry-impl";
import { rulesetFloor } from "./registry-impl";
import { evalExpr, scopeEnv, truthy } from "./scope";
import type { WorldState } from "./state";

/** The built-in action an inferred check plays as (DESIGN §11): Try something, carrying the check. */
export const TRY_ACTION = "try";

/** The Sheets level a chat plays at, the world's floor included: what the defaults read. */
function sheetsLevel(world: Pick<WorldDoc, "ruleset" | "mapSettings">, state: Pick<WorldState, "realism">): Level {
  return rulesetFloor(world, "sheets", state.realism.levels.sheets);
}

/** The policy in force: the chat's own (an `infer` marker, starting ones included), else the world ruleset's default, else its realism preset's at its Sheets level. */
export function inferredOf(world: Pick<WorldDoc, "ruleset" | "mapSettings">, state: Pick<WorldState, "inferred" | "realism">): InferredChecks {
  return state.inferred ?? readInferred(world.ruleset?.inferred) ?? inferredDefaults(presetOf(state.realism), sheetsLevel(world, state));
}

/** A skill the world's sheet has, and what rolls it: the action whose check reads it through `param`. */
export interface SkillSource extends SheetSkill {
  action: ActionDef;
  param: string;
}

/** The text param an action names a skill through, with the skills it may name; null when it has none. */
function skillParam(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef): { param: string; rows: SheetSkill[] } | null {
  const params = Object.entries(action.params).filter(([name]) => name !== "difficulty");
  const [entry] = params;
  // One skill param and a difficulty: anything else it needs (a target, an item) isn't a plain roll.
  if (!entry || params.length !== 1 || action.params.difficulty?.type !== "text") return null;
  const [param, def] = entry;
  if (def.type !== "text") return null;
  if (def.table !== undefined) return { param, rows: tableChoices(own(world.tables, def.table)).map((c) => ({ id: c.key, label: c.label })) };
  // The Sheets pack's own sheet rolls its stats through Attempt; a world that designs a sheet shows
  // that one instead (Play → You), so the pack's stats aren't its sheet's.
  if (action.pack === "sheets" && action.id === "attempt" && param === "stat" && world.ruleset?.sheet === undefined) {
    const ctx = reg.context(world, state);
    return { param, rows: optionalQuery(ctx, "sheets.stats")?.(ctx) ?? [] };
  }
  return null;
}

/**
 * The skills the world's sheet has, in sheet order, each with what rolls it: an offered action with
 * a check, a skill param and a difficulty, whose requirements the POV meets now (a world's own
 * actions before the packs'). One without requirements rolls a skill before one with them (Use a
 * skill before Push a skill), and a skill two actions name is the first's.
 */
export function skillSources(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): SkillSource[] {
  const env = scopeEnv({ reg, ctx: reg.context(world, state), bindings: { self: world.pov, actor: world.pov } });
  const actions = [...Object.values(world.actions), ...[...reg.actions.values()].filter((a) => !own(world.actions, a.id))];
  const ready = actions.filter((a) => offersAction(world, a) && a.combat === undefined && checkOf(world, a.check) !== null && a.requires.every((r) => truthy(evalExpr(r, env, false))));
  const ordered = [...ready.filter((a) => a.requires.length === 0), ...ready.filter((a) => a.requires.length > 0)];
  const out: SkillSource[] = [];
  const seen = new Set<string>();
  for (const action of ordered) {
    const named = skillParam(reg, world, state, action);
    for (const row of named?.rows ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ ...row, action, param: named?.param ?? "" });
    }
  }
  return out;
}

/** The skills the world's sheet has, as the Checks screens list them. */
export function worldSkills(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): SheetSkill[] {
  return skillSources(reg, world, state).map(({ id, label }) => ({ id, label }));
}
