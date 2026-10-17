// Lint for the ruleset primitives (DESIGN §11, §13): where `roll()` may appear (effect arguments
// only), data-table reads (`table`, `table_step`) naming a table or column the world lacks, checks
// (dice, natural bands, advantage, DC margins, opponents), pools, and the `ruleset` container
// (progression, the sheet layout, level floors). Pure, like the structural lint it runs beside.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { DOMAINS } from "../shared/ids";
import type { LintIssue } from "../shared/protocol";
import type { CheckDef, EffectSpec, Expr, ProgressionDef, WorldDoc } from "../shared/world";
import { EFFECT_ONLY_FUNCTIONS, objectiveWhen } from "../shared/world";
import { diceDistribution, naturalDie, parseDice } from "./dice";
import { callsIn, compile, type FormulaCall } from "./expr";
import type { Registry } from "./registry-impl";
import { thresholdsOf } from "./ruleset";
import { fieldDef, kindFields, objects } from "./scope";
import { own } from "./pack-kit";

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
    a.requires.forEach((r, i) => push(`actions.${id}.requires.${i}`, r));
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
        err(site.path, "roll_outside_effect", `${call.name}() works only in an effect's arguments (a "=" formula there). Here it would make shown odds and what the engine reads change on their own, so it reads as nothing.`);
      }
      if (call.name !== "table" && call.name !== "table_step") continue;
      const [id, key, column] = call.args;
      if (typeof id !== "string") continue;
      const columns = columnsOf(world, id);
      if (!columns) {
        err(site.path, "table_ref", `${call.name}() reads the data table "${id}", which this world doesn't have.`);
        continue;
      }
      if (typeof column === "string" && !columns.has(column)) err(site.path, "table_column", `The data table "${id}" has no column "${column}".`);
      const rows = own(world.tables, id)?.rows;
      if (call.name === "table" && (typeof key === "string" || typeof key === "number") && isRecord(rows) && !own(rows, String(key))) warn(site.path, "table_row", `The data table "${id}" has no row "${key}"; the read gives nothing.`);
    }
  }

  // Checks: dice with exact odds; natural bands and advantage need a natural die; margins need a DC.
  const lintCheck = (path: string, check: CheckDef, opponents: readonly string[] | null): void => {
    let natural = false;
    try {
      natural = naturalDie(parseDice(check.dice)) !== null;
      diceDistribution(check.dice);
    } catch (e) {
      err(`${path}.dice`, "dice", `"${String(check.dice)}" can't be rolled with exact odds: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const site of checkSites(path, check)) {
      try {
        compile(site.expr);
      } catch (e) {
        err(site.path, "types", `This formula doesn't parse: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const bands = Array.isArray(check.bands) ? check.bands : [];
    if (!natural && bands.some((b) => b.natural)) err(`${path}.bands`, "natural_band", `Natural bands read one kept die, but "${check.dice}" doesn't start with one (use d20, 2d20kh1 or 2d20kl1).`);
    if (!natural && check.advantage !== undefined) err(`${path}.advantage`, "advantage", `Advantage adds a natural die, but "${check.dice}" doesn't start with one (use d20, d100, 2d20kh1…).`);
    const hasDc = check.dc !== undefined || check.vs !== undefined;
    if (!hasDc && bands.some((b) => b.margin)) err(`${path}.bands`, "margin_band", "Margin bands measure from a DC, and this check has neither a dc nor an opponent.");
    if (bands.length === 0 && !hasDc) warn(`${path}.bands`, "no_bands", "With no bands and no DC every roll reads none.");
    const vs = check.vs;
    if (!vs) return;
    if ([vs.check, vs.modifier, vs.passive].filter((x) => x !== undefined).length > 1) err(`${path}.vs`, "vs", "An opponent rolls a check, rolls this check's dice with a modifier, or has a passive score: give one of check, modifier and passive.");
    if (vs.check !== undefined && !own(world.checks, vs.check)) err(`${path}.vs.check`, "refs", `The opponent's check "${vs.check}" doesn't exist.`);
    if (vs.passive !== undefined && check.dc !== undefined) warn(`${path}.dc`, "dc_passive", "The opponent's passive score is the DC, so dc is never read.");
    const who = vs.who ?? "target";
    if (opponents && !opponents.includes(who)) err(`${path}.vs.who`, "vs_who", `The opponent is "${who}", which isn't one of this action's people (${opponents.length > 0 ? opponents.join(", ") : "it names none"}).`);
  };
  for (const [id, c] of Object.entries(world.checks)) lintCheck(`checks.${id}`, c, null);
  for (const [id, a] of Object.entries(world.actions)) {
    const opponents = Object.entries(a.params).flatMap(([name, p]) => (p.type === "ref" ? [name] : []));
    if (typeof a.check === "object" && a.check !== null) lintCheck(`actions.${id}.check`, a.check, opponents);
    else if (typeof a.check === "string") {
      const named = own(world.checks, a.check);
      if (!named) err(`actions.${id}.check`, "refs", `"${a.label}" rolls the check "${a.check}", which doesn't exist.`);
      else if (named.vs && !opponents.includes(named.vs.who ?? "target")) err(`actions.${id}.check`, "vs_who", `"${a.label}" rolls an opposed check against "${named.vs.who ?? "target"}", which isn't one of its people.`);
    }
  }
  for (const { path, effects } of effectLists(world)) {
    effects.forEach((spec, i) => {
      const at = `${path}.${i}.args`;
      if (spec.type === "check") {
        const c = spec.args?.check;
        if (typeof c === "string" && !c.startsWith("=") && !own(world.checks, c)) err(`${at}.check`, "refs", `This check effect rolls "${c}", which doesn't exist.`);
        if (isRecord(c)) lintCheck(`${at}.check`, c as unknown as CheckDef, ["target"]);
        if (!isRecord(spec.args?.outcomes)) warn(`${at}.outcomes`, "no_outcomes", "This check effect has no outcomes, so its roll changes nothing.");
      }
      if (spec.type === "award" && typeof spec.args?.progression === "string" && !own(world.ruleset?.progression ?? {}, spec.args.progression)) err(`${at}.progression`, "refs", `This award names the progression "${spec.args.progression}", which the ruleset doesn't define.`);
    });
  }

  // Pools: number fields whose max names a field of the kind or parses as a formula.
  for (const [id, k] of Object.entries(world.kinds)) {
    for (const [name, f] of Object.entries(k.fields)) {
      if (f.pool === undefined) continue;
      const at = `kinds.${id}.fields.${name}.pool`;
      if (!isRecord(f.pool) || typeof f.pool.max !== "string" || f.pool.max.trim() === "") {
        err(at, "pool", `${k.label}'s ${f.label ?? name} pool needs a max: a field or a formula.`);
        continue;
      }
      if (f.type !== "number") err(at, "pool", `${k.label}'s ${f.label ?? name} is a pool, so it must be a number field.`);
      if (f.pool.max === name) err(`${at}.max`, "pool", `${k.label}'s ${f.label ?? name} can't be its own max.`);
      const named = own(kindFields(reg, world, id), f.pool.max);
      if (named && named.type !== "number") err(`${at}.max`, "pool", `${k.label}'s ${f.label ?? name} takes its max from ${f.pool.max}, which isn't a number field.`);
      for (const [key, expr] of [["max", named ? undefined : f.pool.max], ["recover", f.pool.recover]] as const) {
        if (typeof expr !== "string") continue;
        try {
          compile(expr);
        } catch (e) {
          err(`${at}.${key}`, "types", `This formula doesn't parse: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // The ruleset container (DESIGN §11).
  const rs: unknown = world.ruleset;
  if (rs === undefined) return issues;
  if (!isRecord(rs)) {
    err("ruleset", "ruleset", "The ruleset must be an object.");
    return issues;
  }
  const floors = rs.minLevels;
  if (floors !== undefined) {
    if (!isRecord(floors)) err("ruleset.minLevels", "ruleset", "Level floors must be an object of domain levels.");
    else {
      for (const [domain, level] of Object.entries(floors)) {
        const known = DOMAINS.find((d) => d === domain);
        if (!known) err(`ruleset.minLevels.${domain}`, "ruleset", `"${domain}" isn't a realism domain.`);
        else if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 4) err(`ruleset.minLevels.${domain}`, "ruleset", "A level floor is a whole number from 0 to 4.");
        else if (world.realism.levels[known] < level) info(`ruleset.minLevels.${domain}`, "level_floor", `The realism defaults put ${domain} at ${world.realism.levels[known]}; this ruleset plays it at ${level}.`);
      }
    }
  }
  const progression = rs.progression;
  if (progression !== undefined && !isRecord(progression)) err("ruleset.progression", "ruleset", "Progressions must be an object keyed by id.");
  else if (progression !== undefined) {
    const allKinds = [...new Set([...Object.keys(world.kinds), ...reg.kinds.keys()])];
    for (const [id, raw] of Object.entries(progression)) {
      const at = `ruleset.progression.${id}`;
      if (!isRecord(raw) || typeof raw.xpField !== "string" || typeof raw.levelField !== "string" || raw.xpField === "" || raw.levelField === "") {
        err(at, "progression", "A progression needs an XP field and a level field.");
        continue;
      }
      const p = raw as unknown as ProgressionDef;
      if (typeof p.label !== "string" || p.label.trim() === "") warn(`${at}.label`, "progression", "A progression needs a label: the sheet and the Journal show it.");
      if (p.xpField === p.levelField) err(at, "progression", "XP and the level need two different fields.");
      if (p.kind !== undefined && !own(world.kinds, p.kind) && !reg.kinds.has(p.kind)) err(`${at}.kind`, "refs", `The kind "${p.kind}" doesn't exist.`);
      const kinds = p.kind !== undefined ? [p.kind] : allKinds.filter((k) => fieldDef(reg, world, k, p.xpField) && fieldDef(reg, world, k, p.levelField));
      if (p.kind === undefined && kinds.length === 0) warn(at, "progression", `No kind has both ${p.xpField} and ${p.levelField}, so this progression applies to no one.`);
      for (const k of p.kind !== undefined && (own(world.kinds, p.kind) || reg.kinds.has(p.kind)) ? kinds : []) {
        for (const [key, field] of [["xpField", p.xpField], ["levelField", p.levelField]] as const) {
          const def = fieldDef(reg, world, k, field);
          if (!def) err(`${at}.${key}`, "progression", `The kind ${k} has no field ${field}.`);
          else if (def.type !== "number") err(`${at}.${key}`, "progression", `${field} must be a number field.`);
          else if (def.derived !== undefined) err(`${at}.${key}`, "progression", `${field} is derived, so the engine can't set it.`);
        }
      }
      const t = p.thresholds;
      if (Array.isArray(t)) {
        if (t.length === 0 || t.some((x) => typeof x !== "number" || !Number.isFinite(x))) err(`${at}.thresholds`, "thresholds", "Thresholds are a list of XP amounts, one per level from level 1.");
      } else if (isRecord(t) && typeof t.table === "string" && typeof t.column === "string") {
        const columns = columnsOf(world, t.table);
        if (!columns) err(`${at}.thresholds`, "table_ref", `The data table "${t.table}" doesn't exist.`);
        else if (!columns.has(t.column)) err(`${at}.thresholds`, "table_column", `The data table "${t.table}" has no column "${t.column}".`);
      } else err(`${at}.thresholds`, "thresholds", "Thresholds are a list of XP amounts, or a data table and column.");
      const list = thresholdsOf(world, p);
      if (list.some((x, i) => i > 0 && x < (list[i - 1] ?? x))) err(`${at}.thresholds`, "thresholds", "Thresholds must rise level by level.");
      if (p.maxLevel !== undefined && (typeof p.maxLevel !== "number" || !Number.isInteger(p.maxLevel) || p.maxLevel < 1)) err(`${at}.maxLevel`, "progression", "The top level is a whole number of at least 1.");
      if (p.onLevel !== undefined && !Array.isArray(p.onLevel)) err(`${at}.onLevel`, "progression", "onLevel is a list of effects.");
    }
  }
  const sheet = rs.sheet;
  if (sheet !== undefined) {
    if (!isRecord(sheet) || !Array.isArray(sheet.sections)) {
      err("ruleset.sheet", "sheet", "A sheet is a list of sections.");
      return issues;
    }
    const pov = own(world.entities, world.pov);
    const povFields = pov ? kindFields(reg, world, pov.kind) : {};
    const seen = new Set<string>();
    sheet.sections.forEach((s, i) => {
      const at = `ruleset.sheet.sections.${i}`;
      if (!isRecord(s) || typeof s.id !== "string" || s.id === "" || !Array.isArray(s.rows)) {
        err(at, "sheet", "A section needs an id and a list of rows.");
        return;
      }
      if (seen.has(s.id)) err(`${at}.id`, "sheet", `Two sections share the id "${s.id}".`);
      seen.add(s.id);
      if (typeof s.label !== "string" || s.label.trim() === "") warn(`${at}.label`, "sheet", "A section needs a label to show as its title.");
      s.rows.forEach((row, j) => {
        const rat = `${at}.rows.${j}`;
        const keys = isRecord(row) ? ["field", "formula", "pool", "progression"].filter((k) => typeof row[k] === "string") : [];
        if (!isRecord(row) || keys.length !== 1) {
          err(rat, "sheet", "A row shows one thing: a field, a formula, a pool or a progression.");
          return;
        }
        if (typeof row.field === "string" && !own(povFields, row.field)) warn(rat, "sheet", `The point of view's kind has no field ${row.field}.`);
        if (typeof row.pool === "string" && !own(povFields, row.pool)?.pool) warn(rat, "sheet", `${row.pool} isn't a pool on the point of view's kind.`);
        if (typeof row.progression === "string" && !(isRecord(progression) && own(progression, row.progression))) err(rat, "refs", `The progression "${row.progression}" doesn't exist.`);
        if (typeof row.formula === "string") {
          if (typeof row.label !== "string" || row.label.trim() === "") err(`${rat}.label`, "sheet", "A formula row needs a label.");
          try {
            compile(row.formula);
          } catch (e) {
            err(`${rat}.formula`, "types", `This formula doesn't parse: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
    });
  }
  return issues;
}
