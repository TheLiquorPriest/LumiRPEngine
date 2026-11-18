// Lint for the ruleset primitives (DESIGN §11, §13): where `roll()` may appear (effect arguments
// only), data-table reads (`table`, `table_step`) naming a table or column the world lacks, checks
// (dice, natural bands, advantage, DC margins, opponents), pools, and the `ruleset` container
// (progression, the sheet layout, level floors). Pure, like the structural lint it runs beside.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { defaultAdjudication, readAdjudication } from "../shared/adjudication";
import { DOMAINS } from "../shared/ids";
import type { LintIssue } from "../shared/lint";
import type { CheckDef, EffectSpec, Expr, ProgressionDef, WorldDoc } from "../shared/world";
import { EFFECT_ONLY_FUNCTIONS, objectiveWhen, requirementExpr } from "../shared/world";
import { lintAdjudication } from "./adjudication";
import { diceDistribution, naturalDie, parseDice } from "./dice";
import { callsIn, compile, type FormulaCall } from "./expr";
import { rulesetFloor, type Registry } from "./registry-impl";
import { levelFor, progressionApplies, thresholdsOf } from "./ruleset";
import { fieldDef, kindFields, objects } from "./scope";
import { own } from "./pack-kit";
import { say } from "../shared/lines";

/** A formula in the world document; `effectArg` when it is a `=` formula in an effect's arguments, the only place `roll()` may go. */
export interface ExprSite {
  path: string;
  expr: Expr;
  effectArg: boolean;
}

/** An effect list read from authored JSON (a check effect's outcomes). */
function specsOf(v: JsonValue | undefined): EffectSpec[] {
  return objects(v).flatMap((o) => (typeof o.type === "string" ? [{ type: o.type, args: isRecord(o.args) ? (o.args as Record<string, JsonValue>) : {} }] : []));
}

/**
 * Every authored effect list in the world, with its path: action outcomes, rules, track stages,
 * progressions' `onLevel`, and the outcomes of `check` effects inside any of them.
 */
export function effectLists(world: WorldDoc): { path: string; effects: EffectSpec[] }[] {
  const out: { path: string; effects: EffectSpec[] }[] = [];
  const add = (path: string, effects: readonly EffectSpec[] | undefined): void => {
    if (!Array.isArray(effects)) return;
    out.push({ path, effects: [...effects] });
    effects.forEach((spec, i) => {
      if (spec.type !== "check" || !isRecord(spec.args?.outcomes)) return;
      for (const [outcome, list] of Object.entries(spec.args.outcomes as JsonObject)) add(`${path}.${i}.args.outcomes.${outcome}`, specsOf(list));
    });
  };
  for (const [id, a] of Object.entries(world.actions)) for (const [o, list] of Object.entries(a.outcomes)) add(`actions.${id}.outcomes.${o}`, list);
  for (const [id, r] of Object.entries(world.rules)) add(`rules.${id}.do`, r.do);
  for (const [id, t] of Object.entries(world.tracks)) {
    for (const [sid, s] of Object.entries(t.stages)) {
      add(`tracks.${id}.stages.${sid}.effects`, s.effects);
      add(`tracks.${id}.stages.${sid}.rewards`, s.rewards);
    }
  }
  const progression = world.ruleset?.progression;
  if (isRecord(progression)) for (const [id, p] of Object.entries(progression)) if (isRecord(p)) add(`ruleset.progression.${id}.onLevel`, p.onLevel);
  return out;
}

/** The formulas a check reads (all evaluated before the roll, so none may roll). */
function checkSites(path: string, check: CheckDef): ExprSite[] {
  const out: ExprSite[] = [];
  const push = (key: string, expr: Expr | undefined): void => {
    if (typeof expr === "string") out.push({ path: `${path}.${key}`, expr, effectArg: false });
  };
  push("modifier", check.modifier);
  push("advantage", check.advantage);
  push("dc", check.dc);
  const vs = check.vs;
  if (vs) {
    push("vs.modifier", vs.modifier);
    push("vs.passive", vs.passive);
  }
  return out;
}

/** The `=` formulas in an effect's arguments, at any depth; a check effect's inline check and outcomes are read as such. */
function argSites(path: string, spec: EffectSpec): ExprSite[] {
  const out: ExprSite[] = [];
  const visit = (at: string, v: JsonValue | undefined): void => {
    if (typeof v === "string") {
      if (v.startsWith("=")) out.push({ path: at, expr: v.slice(1), effectArg: true });
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(`${at}.${i}`, x));
    else if (isRecord(v)) for (const [k, x] of Object.entries(v as JsonObject)) visit(`${at}.${k}`, x);
  };
  for (const [key, value] of Object.entries(spec.args ?? {})) {
    if (spec.type === "check" && key === "outcomes") continue;
    if (spec.type === "check" && key === "check" && isRecord(value)) out.push(...checkSites(`${path}.args.check`, value as unknown as CheckDef));
    else visit(`${path}.args.${key}`, value);
  }
  return out;
}

/** Every formula in the world document, with whether it is an effect argument. */
export function exprSites(world: WorldDoc): ExprSite[] {
  const out: ExprSite[] = [];
  const push = (path: string, expr: Expr | undefined): void => {
    if (typeof expr === "string") out.push({ path, expr, effectArg: false });
  };
  for (const [id, k] of Object.entries(world.kinds)) {
    for (const [name, f] of Object.entries(k.fields)) {
      push(`kinds.${id}.fields.${name}.derived`, f.derived);
      if (isRecord(f.pool) && !own(k.fields, String(f.pool.max))) push(`kinds.${id}.fields.${name}.pool.max`, f.pool.max);
      if (isRecord(f.pool)) push(`kinds.${id}.fields.${name}.pool.recover`, f.pool.recover);
    }
  }
  for (const [id, a] of Object.entries(world.actions)) {
    a.requires.forEach((r, i) => push(`actions.${id}.requires.${i}`, requirementExpr(r)));
    push(`actions.${id}.duration`, a.duration);
    push(`actions.${id}.activity.until`, a.activity?.until);
    if (typeof a.check === "object" && a.check !== null) out.push(...checkSites(`actions.${id}.check`, a.check));
  }
  for (const [id, c] of Object.entries(world.checks)) out.push(...checkSites(`checks.${id}`, c));
  for (const [id, r] of Object.entries(world.rules)) {
    push(`rules.${id}.when`, r.when);
    if ("at" in r.on) push(`rules.${id}.on.at`, r.on.at);
  }
  for (const [id, t] of Object.entries(world.tracks)) {
    for (const [sid, s] of Object.entries(t.stages)) {
      const at = `tracks.${id}.stages.${sid}`;
      s.next.forEach((n, i) => push(`${at}.next.${i}.when`, n.when));
      push(`${at}.fail.when`, s.fail?.when);
      push(`${at}.gate`, s.gate);
      (s.objectives ?? []).forEach((o, i) => push(`${at}.objectives.${i}`, objectiveWhen(o)));
    }
  }
  for (const [id, l] of Object.entries(world.lore)) push(`lore.${id}.gate`, l.gate);
  const sections = world.ruleset?.sheet?.sections;
  if (Array.isArray(sections)) {
    sections.forEach((s, i) => {
      if (isRecord(s) && Array.isArray(s.rows)) s.rows.forEach((row, j) => isRecord(row) && push(`ruleset.sheet.sections.${i}.rows.${j}.formula`, "formula" in row ? row.formula : undefined));
    });
  }
  const combat: unknown = world.ruleset?.combat;
  if (isRecord(combat)) {
    for (const [key, sub] of [["tieBreak", null], ["end", null], ["down", "when"], ["sides", "hostile"], ["sides", "ally"], ["tactics", "threat"], ["tactics", "lowHp"]] as const) {
      const v = sub === null ? combat[key] : isRecord(combat[key]) ? (combat[key] as JsonObject)[sub] : undefined;
      push(`ruleset.combat.${key}${sub === null ? "" : `.${sub}`}`, typeof v === "string" ? v : undefined);
    }
    if (isRecord(combat.economy)) for (const [id, b] of Object.entries(combat.economy)) if (isRecord(b) && typeof b.count === "string") push(`ruleset.combat.economy.${id}.count`, b.count);
    if (isRecord(combat.initiative)) out.push(...checkSites("ruleset.combat.initiative", combat.initiative as unknown as CheckDef));
  }
  for (const { path, effects } of effectLists(world)) effects.forEach((spec, i) => out.push(...argSites(`${path}.${i}`, spec)));
  return out;
}

/** A table's columns: those it declares, and any a row carries. */
function columnsOf(world: WorldDoc, id: string): Set<string> | null {
  const table = own(world.tables, id);
  if (!table) return null;
  const out = new Set(Object.keys(isRecord(table.columns) ? table.columns : {}));
  if (isRecord(table.rows)) for (const row of Object.values(table.rows)) if (isRecord(row)) for (const k of Object.keys(row)) out.add(k);
  return out;
}

export function lintRuleset(world: WorldDoc, reg: Registry): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string): void => void issues.push({ severity: "error", path, code, message });
  const warn = (path: string, code: string, message: string): void => void issues.push({ severity: "warning", path, code, message });
  const info = (path: string, code: string, message: string): void => void issues.push({ severity: "info", path, code, message });

  // Formulas: `roll()` only in effect arguments; table reads name real tables and columns.
  for (const site of exprSites(world)) {
    let calls: FormulaCall[];
    try {
      calls = callsIn(site.expr);
    } catch {
      continue;
    }
    for (const call of calls) {
      if (EFFECT_ONLY_FUNCTIONS.includes(call.name) && !site.effectArg) {
        err(site.path, "roll_outside_effect", say("lint_name_is_for_an_effects_arguments", { name: call.name }));
      }
      if (call.name !== "table" && call.name !== "table_step") continue;
      const [id, key, column] = call.args;
      if (typeof id !== "string") continue;
      const columns = columnsOf(world, id);
      if (!columns) {
        err(site.path, "table_ref", say("lint_name_reads_the_data_table_id_which", { name: call.name, id: id }));
        continue;
      }
      if (typeof column === "string" && !columns.has(column)) err(site.path, "table_column", say("lint_the_data_table_id_has_no_column", { id: id, column: column }));
      const rows = own(world.tables, id)?.rows;
      if (call.name === "table" && (typeof key === "string" || typeof key === "number") && isRecord(rows) && !own(rows, String(key))) warn(site.path, "table_row", say("lint_the_data_table_id_has_no_row", { id: id, key: key }));
    }
  }

  // Checks: dice with exact odds; natural bands and advantage need a natural die; margins need a DC.
  const lintCheck = (path: string, check: CheckDef, opponents: readonly string[] | null): void => {
    let natural = false;
    try {
      natural = naturalDie(parseDice(check.dice)) !== null;
      diceDistribution(check.dice);
    } catch (e) {
      err(`${path}.dice`, "dice", say("lint_dice_cant_be_rolled_with_exact_odds", { dice: String(check.dice), message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    for (const site of checkSites(path, check)) {
      try {
        compile(site.expr);
      } catch (e) {
        err(site.path, "types", say("lint_this_formula_doesnt_parse_message", { message: e instanceof Error ? e.message : String(e) }));
      }
    }
    const bands = Array.isArray(check.bands) ? check.bands : [];
    if (!natural && bands.some((b) => b.natural)) err(`${path}.bands`, "natural_band", say("lint_natural_bands_read_one_kept_die_but", { dice: check.dice }));
    if (!natural && check.advantage !== undefined) err(`${path}.advantage`, "advantage", say("lint_advantage_adds_a_natural_die_but_dice", { dice: check.dice }));
    const hasDc = check.dc !== undefined || check.vs !== undefined;
    if (!hasDc && bands.some((b) => b.margin)) err(`${path}.bands`, "margin_band", say("lint_margin_bands_measure_from_a_dc_and"));
    if (bands.length === 0 && !hasDc) warn(`${path}.bands`, "no_bands", say("lint_with_no_bands_and_no_dc_every"));
    const vs = check.vs;
    if (!vs) return;
    if ([vs.check, vs.modifier, vs.passive].filter((x) => x !== undefined).length > 1) err(`${path}.vs`, "vs", say("lint_an_opponent_rolls_a_check_rolls_this"));
    if (vs.check !== undefined && !own(world.checks, vs.check)) err(`${path}.vs.check`, "refs", say("lint_the_opponents_check_check_doesnt_exist", { check: vs.check }));
    if (vs.passive !== undefined && check.dc !== undefined) warn(`${path}.dc`, "dc_passive", say("lint_the_opponents_passive_score_is_the_dc"));
    const who = vs.who ?? "target";
    if (opponents && !opponents.includes(who)) err(`${path}.vs.who`, "vs_who", say("lint_the_opponent_is_who_which_isnt_one", { who: who, opponents: opponents.join(", "), if_opponents: opponents.length > 0 }));
  };
  for (const [id, c] of Object.entries(world.checks)) lintCheck(`checks.${id}`, c, null);
  for (const [id, a] of Object.entries(world.actions)) {
    const opponents = Object.entries(a.params).flatMap(([name, p]) => (p.type === "ref" ? [name] : []));
    if (typeof a.check === "object" && a.check !== null) lintCheck(`actions.${id}.check`, a.check, opponents);
    else if (typeof a.check === "string") {
      const named = own(world.checks, a.check);
      if (!named) err(`actions.${id}.check`, "refs", say("lint_label_rolls_the_check_check_which_doesnt", { label: a.label, check: a.check }));
      else if (named.vs && !opponents.includes(named.vs.who ?? "target")) err(`actions.${id}.check`, "vs_who", say("lint_label_rolls_an_opposed_check_against_who", { label: a.label, who: named.vs.who }));
    }
  }
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      const at = `${path}.${i}.args`;
      if (spec.type === "check") {
        const c = spec.args?.check;
        if (typeof c === "string" && !c.startsWith("=") && !own(world.checks, c)) err(`${at}.check`, "refs", say("lint_this_check_effect_rolls_c_which_doesnt", { c: c }));
        if (isRecord(c)) lintCheck(`${at}.check`, c as unknown as CheckDef, ["target"]);
        if (!isRecord(spec.args?.outcomes)) warn(`${at}.outcomes`, "no_outcomes", say("lint_this_check_effect_has_no_outcomes_so"));
      }
      if (spec.type === "award" && typeof spec.args?.progression === "string" && !own(world.ruleset?.progression ?? {}, spec.args.progression)) err(`${at}.progression`, "refs", say("lint_this_award_names_the_progression_progression_which", { progression: spec.args.progression }));
    });
  }

  // Pools: number fields whose max names a field of the kind or parses as a formula.
  for (const [id, k] of Object.entries(world.kinds)) {
    for (const [name, f] of Object.entries(k.fields)) {
      if (f.pool === undefined) continue;
      const at = `kinds.${id}.fields.${name}.pool`;
      if (!isRecord(f.pool) || typeof f.pool.max !== "string" || f.pool.max.trim() === "") {
        err(at, "pool", say("lint_label_s_name_pool_needs_a_max", { label: k.label, name: f.label ?? name }));
        continue;
      }
      if (f.type !== "number") err(at, "pool", say("lint_label_s_name_is_a_pool_so", { label: k.label, name: f.label ?? name }));
      if (f.pool.max === name) err(`${at}.max`, "pool", say("lint_label_s_name_cant_be_its_own", { label: k.label, name: f.label ?? name }));
      const named = own(kindFields(reg, world, id), f.pool.max);
      if (named && named.type !== "number") err(`${at}.max`, "pool", say("lint_label_s_name_takes_its_max_from", { label: k.label, name: f.label ?? name, max: f.pool.max }));
      for (const [key, expr] of [["max", named ? undefined : f.pool.max], ["recover", f.pool.recover]] as const) {
        if (typeof expr !== "string") continue;
        try {
          compile(expr);
        } catch (e) {
          err(`${at}.${key}`, "types", say("lint_this_formula_doesnt_parse_message", { message: e instanceof Error ? e.message : String(e) }));
        }
      }
    }
  }

  // Combat (DESIGN §11): what combat actions spend, the rules' parts, and the Sheets floor a fight
  // that reads stat modifiers needs (they are 0 below Sheets 3).
  const combat: unknown = isRecord(world.ruleset) ? world.ruleset.combat : undefined;
  const budgets = isRecord(combat) && isRecord(combat.economy) ? (combat.economy as JsonObject) : null;
  const fightPaths = ["ruleset.combat."];
  for (const [id, a] of Object.entries(world.actions)) {
    const c: unknown = a.combat;
    if (c === undefined) continue;
    const at = `actions.${id}.combat`;
    fightPaths.push(`actions.${id}.`);
    if (typeof a.check === "string") fightPaths.push(`checks.${a.check}.`);
    if (!isRecord(c) || !isRecord(c.cost)) {
      err(at, "combat", say("lint_label_is_a_combat_action_so_it", { label: a.label }));
      continue;
    }
    if (combat === undefined) warn(at, "combat", say("lint_label_is_a_combat_action_but_this", { label: a.label }));
    for (const [budget, n] of Object.entries(c.cost)) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) err(`${at}.cost.${budget}`, "combat", say("lint_a_cost_is_a_whole_number_of"));
      else if (budgets && !own(budgets, budget)) err(`${at}.cost.${budget}`, "refs", say("lint_label_spends_budget_which_the_action_economy", { label: a.label, budget: budget }));
    }
    if (c.role !== undefined && c.role !== "attack" && c.role !== "defend") err(`${at}.role`, "combat", say("lint_a_combat_actions_role_is_attack_or"));
    if (c.start !== undefined && typeof c.start !== "boolean") err(`${at}.start`, "combat", say("lint_whether_it_starts_a_fight_is_yes"));
  }
  if (isRecord(combat)) {
    const init = combat.initiative;
    if (typeof init === "string") {
      fightPaths.push(`checks.${init}.`);
      if (!own(world.checks, init)) err("ruleset.combat.initiative", "refs", say("lint_the_initiative_check_init_doesnt_exist", { init: init }));
    } else if (isRecord(init) && typeof init.dice === "string") lintCheck("ruleset.combat.initiative", init as unknown as CheckDef, []);
    else err("ruleset.combat.initiative", "combat", say("lint_a_fight_needs_an_initiative_check_a"));
    if (!budgets || Object.keys(budgets).length === 0) err("ruleset.combat.economy", "combat", say("lint_a_fight_needs_an_action_economy_at"));
    for (const [id, b] of Object.entries(budgets ?? {})) {
      const at = `ruleset.combat.economy.${id}`;
      if (!isRecord(b)) {
        err(at, "combat", say("lint_a_budget_has_a_label_a_count"));
        continue;
      }
      if (typeof b.label !== "string" || b.label.trim() === "") warn(`${at}.label`, "combat", say("lint_a_budget_needs_a_label_the_palette"));
      if (b.per !== undefined && b.per !== "turn" && b.per !== "round") err(`${at}.per`, "combat", say("lint_a_budget_refills_each_turn_or_each"));
      if (b.count !== undefined && typeof b.count !== "string" && !(typeof b.count === "number" && b.count >= 0)) err(`${at}.count`, "combat", say("lint_a_budgets_count_is_a_number_of"));
    }
    const pov = own(world.entities, world.pov);
    const hp = typeof combat.hp === "string" && combat.hp !== "" ? combat.hp : null;
    const hpDef = hp && pov ? fieldDef(reg, world, pov.kind, hp) : undefined;
    if (!hp) err("ruleset.combat.hp", "combat", say("lint_a_fight_needs_the_hp_field_a"));
    else if (pov && !hpDef) err("ruleset.combat.hp", "combat", say("lint_the_point_of_views_kind_has_no", { hp: hp }));
    else if (hpDef && !hpDef.pool) warn("ruleset.combat.hp", "combat", say("lint_hp_isnt_a_pool_so_damage_has", { hp: hp }));
    if (combat.stalemate !== undefined && !(typeof combat.stalemate === "number" && Number.isInteger(combat.stalemate) && combat.stalemate >= 0)) err("ruleset.combat.stalemate", "combat", say("lint_a_stalemate_is_a_whole_number_of"));
    if (combat.endTurn !== undefined && combat.endTurn !== "spent" && combat.endTurn !== "manual") err("ruleset.combat.endTurn", "combat", say("lint_the_povs_turn_ends_once_its_spent"));
    if (combat.adjudicate !== undefined && combat.adjudicate !== "dice" && combat.adjudicate !== "policy") err("ruleset.combat.adjudicate", "combat", say("lint_a_fights_checks_are_settled_by_the"));
    if (combat.adjudicate === "policy") {
      // The player's same attack comes round every round; a new round counts as a change, but not as a new scene (DESIGN §11).
      const policy = readAdjudication(isRecord(world.ruleset) ? world.ruleset.adjudication : undefined) ?? defaultAdjudication();
      if (policy.retry === "once") warn("ruleset.combat.adjudicate", "combat", say("lint_fights_follow_the_policy_and_its_retry"));
    }
    if (combat.showHp !== undefined && combat.showHp !== "wounds" && combat.showHp !== "exact") err("ruleset.combat.showHp", "combat", say("lint_others_hp_shows_as_wounds_or_as"));
    if (combat.wounds !== undefined && (!Array.isArray(combat.wounds) || combat.wounds.some((b) => !isRecord(b) || typeof b.label !== "string"))) err("ruleset.combat.wounds", "combat", say("lint_wounds_are_bands_with_labels_over_the"));
    const sites = exprSites(world);
    for (const site of sites) {
      if (!site.path.startsWith("ruleset.combat.") || site.path.startsWith("ruleset.combat.initiative")) continue;
      try {
        compile(site.expr);
      } catch (e) {
        err(site.path, "types", say("lint_this_formula_doesnt_parse_message", { message: e instanceof Error ? e.message : String(e) }));
      }
    }
    const statMods = sites.some((s) => fightPaths.some((p) => s.path.startsWith(p)) && /\b(stat_mod|condition_mod)\s*\(/.test(s.expr));
    if (statMods && rulesetFloor(world, "sheets", world.realism.levels.sheets) < 3) info("ruleset.minLevels.sheets", "level_floor", say("lint_this_worlds_fights_read_stat_modifiers_which"));
  } else if (combat !== undefined) err("ruleset.combat", "combat", say("lint_combat_must_be_an_object"));

  // The ruleset container (DESIGN §11), its adjudication policy first: the sheet's checks below may end early.
  const rs: unknown = world.ruleset;
  if (rs === undefined) return issues;
  issues.push(...lintAdjudication(world));
  if (!isRecord(rs)) {
    err("ruleset", "ruleset", say("lint_the_ruleset_must_be_an_object"));
    return issues;
  }
  const floors = rs.minLevels;
  if (floors !== undefined) {
    if (!isRecord(floors)) err("ruleset.minLevels", "ruleset", say("lint_level_floors_must_be_an_object_of"));
    else {
      for (const [domain, level] of Object.entries(floors)) {
        const known = DOMAINS.find((d) => d === domain);
        if (!known) err(`ruleset.minLevels.${domain}`, "ruleset", say("lint_domain_isnt_a_realism_domain", { domain: domain }));
        else if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 4) err(`ruleset.minLevels.${domain}`, "ruleset", say("lint_a_level_floor_is_a_whole_number"));
        else if ((world.realism.levels[known] ?? 0) < level) info(`ruleset.minLevels.${domain}`, "level_floor", say("lint_the_realism_defaults_put_domain_at_known", { domain: domain, known: world.realism.levels[known] ?? 0, level: level }));
      }
    }
  }
  const progression = rs.progression;
  if (progression !== undefined && !isRecord(progression)) err("ruleset.progression", "ruleset", say("lint_progressions_must_be_an_object_keyed_by"));
  else if (progression !== undefined) {
    const allKinds = [...new Set([...Object.keys(world.kinds), ...reg.kinds.keys()])];
    for (const [id, raw] of Object.entries(progression)) {
      const at = `ruleset.progression.${id}`;
      if (!isRecord(raw) || typeof raw.xpField !== "string" || typeof raw.levelField !== "string" || raw.xpField === "" || raw.levelField === "") {
        err(at, "progression", say("lint_a_progression_needs_an_xp_field_and"));
        continue;
      }
      const p = raw as unknown as ProgressionDef;
      if (typeof p.label !== "string" || p.label.trim() === "") warn(`${at}.label`, "progression", say("lint_a_progression_needs_a_label_the_sheet"));
      if (p.xpField === p.levelField) err(at, "progression", say("lint_xp_and_the_level_need_two_different"));
      if (p.kind !== undefined && !own(world.kinds, p.kind) && !reg.kinds.has(p.kind)) err(`${at}.kind`, "refs", say("lint_the_kind_kind_doesnt_exist", { kind: p.kind }));
      const kinds = p.kind !== undefined ? [p.kind] : allKinds.filter((k) => fieldDef(reg, world, k, p.xpField) && fieldDef(reg, world, k, p.levelField));
      if (p.kind === undefined && kinds.length === 0) warn(at, "progression", say("lint_no_kind_has_both_xpfield_and_levelfield", { xpField: p.xpField, levelField: p.levelField }));
      for (const k of p.kind !== undefined && (own(world.kinds, p.kind) || reg.kinds.has(p.kind)) ? kinds : []) {
        for (const [key, field] of [["xpField", p.xpField], ["levelField", p.levelField]] as const) {
          const def = fieldDef(reg, world, k, field);
          if (!def) err(`${at}.${key}`, "progression", say("lint_the_kind_k_has_no_field_field", { k: k, field: field }));
          else if (def.type !== "number") err(`${at}.${key}`, "progression", say("lint_field_must_be_a_number_field", { field: field }));
          else if (def.derived !== undefined) err(`${at}.${key}`, "progression", say("lint_field_is_derived_so_the_engine_cant", { field: field }));
        }
      }
      const t = p.thresholds;
      if (Array.isArray(t)) {
        if (t.length === 0 || t.some((x) => typeof x !== "number" || !Number.isFinite(x))) err(`${at}.thresholds`, "thresholds", say("lint_thresholds_are_a_list_of_xp_amounts"));
      } else if (isRecord(t) && typeof t.table === "string" && typeof t.column === "string") {
        const columns = columnsOf(world, t.table);
        if (!columns) err(`${at}.thresholds`, "table_ref", say("lint_the_data_table_table_doesnt_exist", { table: t.table }));
        else if (!columns.has(t.column)) err(`${at}.thresholds`, "table_column", say("lint_the_data_table_id_has_no_column", { id: t.table, column: t.column }));
      } else err(`${at}.thresholds`, "thresholds", say("lint_thresholds_are_a_list_of_xp_amounts_2"));
      const list = thresholdsOf(world, p);
      if (list.some((x, i) => i > 0 && x < (list[i - 1] ?? x))) err(`${at}.thresholds`, "thresholds", say("lint_thresholds_must_rise_level_by_level"));
      if (p.maxLevel !== undefined && (typeof p.maxLevel !== "number" || !Number.isInteger(p.maxLevel) || p.maxLevel < 1)) err(`${at}.maxLevel`, "progression", say("lint_the_top_level_is_a_whole_number"));
      if (p.onLevel !== undefined && !Array.isArray(p.onLevel)) err(`${at}.onLevel`, "progression", say("lint_onlevel_is_a_list_of_effects"));
      // A level follows its XP: one authored otherwise moves to its XP's level when that XP next changes.
      const name = typeof p.label === "string" && p.label.trim() !== "" ? p.label : "Level";
      for (const [eid, e] of Object.entries(world.entities)) {
        if (!progressionApplies(reg, world, p, e.kind)) continue;
        const numberOf = (field: string): number | null => {
          const v = own(e.fields, field) ?? fieldDef(reg, world, e.kind, field)?.default;
          return typeof v === "number" ? v : null;
        };
        const levelDef = fieldDef(reg, world, e.kind, p.levelField);
        const xp = numberOf(p.xpField) ?? 0;
        const level = numberOf(p.levelField) ?? levelFor(list, 0, p.maxLevel);
        const reached = Math.min(Math.max(levelFor(list, xp, p.maxLevel), levelDef?.min ?? -Infinity), levelDef?.max ?? Infinity);
        if (level === reached) continue;
        const xpLabel = fieldDef(reg, world, e.kind, p.xpField)?.label ?? p.xpField;
        const needs = list[level - 1];
        warn(`entities.${eid}.fields.${p.levelField}`, "progression_level", say("lint_name_is_at_name2_level_but_xp", { name: e.name, name2: name, level: level, xp: xp, xpLabel: xpLabel, reached: reached, needs: needs, if_needs: needs !== undefined }));
      }
    }
  }
  const sheet = rs.sheet;
  if (sheet !== undefined) {
    if (!isRecord(sheet) || !Array.isArray(sheet.sections)) {
      err("ruleset.sheet", "sheet", say("lint_a_sheet_is_a_list_of_sections"));
      return issues;
    }
    const pov = own(world.entities, world.pov);
    const povFields = pov ? kindFields(reg, world, pov.kind) : {};
    const seen = new Set<string>();
    sheet.sections.forEach((s, i) => {
      const at = `ruleset.sheet.sections.${i}`;
      if (!isRecord(s) || typeof s.id !== "string" || s.id === "" || !Array.isArray(s.rows)) {
        err(at, "sheet", say("lint_a_section_needs_an_id_and_a"));
        return;
      }
      if (seen.has(s.id)) err(`${at}.id`, "sheet", say("lint_two_sections_share_the_id_id", { id: s.id }));
      seen.add(s.id);
      if (typeof s.label !== "string" || s.label.trim() === "") warn(`${at}.label`, "sheet", say("lint_a_section_needs_a_label_to_show"));
      s.rows.forEach((row, j) => {
        const rat = `${at}.rows.${j}`;
        const keys = isRecord(row) ? ["field", "formula", "pool", "progression"].filter((k) => typeof row[k] === "string") : [];
        if (!isRecord(row) || keys.length !== 1) {
          err(rat, "sheet", say("lint_a_row_shows_one_thing_a_field"));
          return;
        }
        if (typeof row.field === "string" && !own(povFields, row.field)) warn(rat, "sheet", say("lint_the_point_of_views_kind_has_no", { hp: row.field }));
        if (typeof row.pool === "string" && !own(povFields, row.pool)?.pool) warn(rat, "sheet", say("lint_pool_isnt_a_pool_on_the_point", { pool: row.pool }));
        if (typeof row.progression === "string" && !(isRecord(progression) && own(progression, row.progression))) err(rat, "refs", say("lint_the_progression_progression_doesnt_exist", { progression: row.progression }));
        if (typeof row.formula === "string") {
          if (typeof row.label !== "string" || row.label.trim() === "") err(`${rat}.label`, "sheet", say("lint_a_formula_row_needs_a_label"));
          try {
            compile(row.formula);
          } catch (e) {
            err(`${rat}.formula`, "types", say("lint_this_formula_doesnt_parse_message", { message: e instanceof Error ? e.message : String(e) }));
          }
        }
      });
    });
  }
  return issues;
}
