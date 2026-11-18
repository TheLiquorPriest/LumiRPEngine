// The sheet under the world's tabletop rules (RULESET-DESIGN §5.4): someone's numbers in words, each total with its parts and where
// each part comes from, so no agent need make one up. Abilities, defence and its variants, each weapon in hand and each attack of its
// own with its attack, damage, threat, range and rounds loaded, saves, skills, hit points and the states they bring, conditions and
// effects with what is left of them, daily gauges, classes and traits. It changes nothing; its answer is data.

import type { JsonObject } from "rp-harness/contract";
import type { EntityId } from "../../shared/ids";
import { D20_FIELDS } from "../../shared/d20";
import { say } from "../../shared/lines";
import { own } from "../../engine/pack-kit";
import { fieldDef, poolMax, scopeEnv } from "../../engine/scope";
import { isClassSkill, levelsOf, modOf, scoreOf } from "../../packs/d20/core/functions";
import { classesOf, conditionsHeld, effectsHeld, gearOn, isOn, labelOfRow, naturalAttacks, numberIn, ranksOf, rowIdOf, rowsOf, rulesOf, sizeOf, textIn, thingNumber, traitsHeld, wordsIn } from "../../packs/d20/core/model";
import { explain, partsWords, signed, totalOf } from "../../packs/d20/core/modifiers";
import { TEXT, type ToolSpec } from "../kit";
import { isUnread, named } from "../ops";
import type { Reading } from "../reading";
import { foundIn, type ReadDef, readTool } from "./run";

/** A total and its parts, in words. */
function line(r: Reading, who: EntityId, name: string, vars: JsonObject = {}): JsonObject | null {
  const rules = rulesOf(r.world);
  const e = rules ? explain(r.ctx, rules, who, name, vars as never) : null;
  return e ? { total: e.total, parts: partsWords(e) } : null;
}

/** Each weapon in hand and each attack of its own: its attack and its parts, its damage, its threat, its range, its rounds. */
function weapons(r: Reading, who: EntityId): JsonObject[] {
  const rules = rulesOf(r.world);
  if (!rules) return [];
  const a = rules.attack;
  const size = sizeOf(r.ctx, rules, who);
  const rows = rowsOf(r.ctx, rules, "weapons");
  const out: JsonObject[] = [];
  const strength = (held: string): number => Math.floor((own(a.strengthShare, held) ?? 0) * modOf(r.ctx, rules, who, a.strength));
  for (const id of gearOn(r.ctx, who).readied) {
    const rid = rowIdOf(r.ctx, id);
    const row = own(rows, rid);
    if (!row) continue;
    const held = textIn(row.held);
    const ranged = held === "projectile" || held === "thrown" || held === "ranged";
    const enh = thingNumber(r.ctx, id, D20_FIELDS.enhancement);
    const roll = line(r, who, ranged ? a.totals.ranged : a.totals.melee, { weapon: rid, key: rid });
    const dmg = row.damage;
    const dice = typeof dmg === "string" ? dmg : dmg !== null && typeof dmg === "object" && !Array.isArray(dmg) ? (typeof dmg[size] === "string" ? dmg[size] : (Object.values(dmg).find((x) => typeof x === "string") ?? "")) : "";
    const bonus = strength(held) + totalOf(r.ctx, rules, who, a.totals.damage, { weapon: rid, key: rid }) + enh;
    const magazine = numberIn(row.magazine ?? null);
    out.push({
      with: named(r, id),
      attack: roll === null ? null : { total: Number(roll.total) + enh, parts: [roll.parts, enh !== 0 ? say("d20_part_enhancement", { value: signed(enh), from: named(r, id) }) : ""].filter((x) => x !== "").join(", ") },
      damage: `${String(dice)}${bonus !== 0 ? signed(bonus) : ""}`,
      threat: numberIn(row.threat ?? null) ?? a.autoHit,
      multiplier: numberIn(row.multiplier ?? null) ?? 1,
      ...(numberIn(row.range ?? null) !== null ? { range: numberIn(row.range ?? null) } : {}),
      ...(wordsIn(row.types).length > 0 ? { types: wordsIn(row.types).join(", ") } : {}),
      ...(magazine !== null ? { rounds: say("d20_sheet_rounds", { loaded: thingNumber(r.ctx, id, D20_FIELDS.loaded), magazine }) } : {}),
      ...(wordsIn(row.fire).length > 0 ? { fire: wordsIn(row.fire).join(", ") } : {}),
    });
  }
  for (const nat of naturalAttacks(r.ctx, who)) {
    const roll = line(r, who, nat.total ?? a.totals.melee, { weapon: "", key: "" });
    const bonus = strength(nat.held ?? "one") + totalOf(r.ctx, rules, who, a.totals.damage, { weapon: "", key: "" });
    out.push({
      with: nat.label,
      attack: roll === null ? null : { total: Number(roll.total) + (nat.bonus ?? 0) + (nat.secondary === true ? a.secondary : 0), parts: roll.parts },
      damage: `${nat.damage}${bonus !== 0 ? signed(bonus) : ""}`,
      threat: nat.threat ?? a.autoHit,
      multiplier: nat.multiplier ?? 1,
      ...(nat.types !== undefined ? { types: nat.types.join(", ") } : {}),
    });
  }
  return out;
}

/** What is left of a condition or an effect: turns, minutes, a save that ends it, in the lines' words. */
function left(r: Reading, held: { until?: number; rounds?: number; save?: { save: string; dc: number } }): string {
  return say("d20_length", { ...(held.rounds !== undefined ? { rounds: held.rounds } : {}), ...(held.until !== undefined ? { minutes: Math.max(0, held.until - r.state.world.clock) } : {}), ...(held.save !== undefined ? { save: held.save.save, dc: held.save.dc } : {}) });
}

/** Someone's whole sheet under the rules. */
function sheetOf(r: Reading, who: EntityId): JsonObject {
  const rules = rulesOf(r.world);
  if (!rules) return {};
  const ctx = r.ctx;
  const kind = own(r.state.world.entities, who)?.kind ?? "";
  const label = (field: string): string => fieldDef(r.registry, r.world, kind, field)?.label ?? field;
  const abilities = rules.abilities.map((ab) => ({ ability: label(ab), score: scoreOf(ctx, rules, who, ab), mod: signed(modOf(ctx, rules, who, ab)) }));
  const saves = Object.keys(rules.totals)
    .filter((k) => k.startsWith("save."))
    .map((k) => ({ save: k.slice(5), ...line(r, who, k) }));
  const skillsRows = rowsOf(ctx, rules, "skills");
  const ranks = ranksOf(ctx, who);
  const skills = Object.entries(skillsRows)
    .filter(([id, row]) => row.trained !== true || (own(ranks, id) ?? 0) > 0)
    .map(([id, row]) => ({ skill: labelOfRow(row, id), ranks: own(ranks, id) ?? 0, ...(isClassSkill(ctx, rules, who, id) ? { class_skill: true } : {}), ...line(r, who, "skill", { skill: id, key: id, weapon: id }) }));
  const hpField = rules.hp.field;
  const e = own(r.state.world.entities, who);
  const def = e ? fieldDef(r.registry, r.world, e.kind, hpField) : undefined;
  // As the sheet reads the gauge: what it holds, an unset one full.
  const hpNow = numberIn(scopeEnv({ reg: r.registry, ctx, bindings: { self: who } }).lookup(["self", hpField]) ?? null) ?? 0;
  const hpMax = def?.pool ? poolMax(r.registry, ctx, who, def.pool) : null;
  const conditionsTable = rowsOf(ctx, rules, "conditions");
  const traitsTable = rowsOf(ctx, rules, "traits");
  const classesTable = rowsOf(ctx, rules, "classes");
  const daily = rules.hp.rest.daily.flatMap((field) => {
    const d = e ? fieldDef(r.registry, r.world, e.kind, field) : undefined;
    if (!d?.pool) return [];
    const v = numberIn(own(e?.fields ?? {}, field) ?? null) ?? poolMax(r.registry, ctx, who, d.pool) ?? 0;
    return [{ gauge: d.label ?? field, now: v, most: poolMax(r.registry, ctx, who, d.pool) }];
  });
  return {
    who: named(r, who),
    ...(isOn(ctx) ? {} : { off: true }),
    classes: Object.entries(classesOf(ctx, who)).map(([c, l]) => `${labelOfRow(own(classesTable, c), c)} ${l}`).join(", "),
    levels: levelsOf(ctx, who),
    size: labelOfRow(own(rowsOf(ctx, rules, "sizes"), sizeOf(ctx, rules, who)), sizeOf(ctx, rules, who)),
    abilities,
    defence: { ac: line(r, who, "ac"), touch: line(r, who, "ac.touch"), flat_footed: line(r, who, "ac.flat") },
    initiative: line(r, who, "initiative"),
    weapons: weapons(r, who),
    saves,
    skills,
    hp: {
      now: hpNow,
      ...(hpMax !== null ? { most: hpMax } : {}),
      ...(numberIn(own(e?.fields ?? {}, rules.hp.temporary) ?? null) ? { temporary: numberIn(own(e?.fields ?? {}, rules.hp.temporary) ?? null) } : {}),
      ...(numberIn(own(e?.fields ?? {}, rules.hp.nonlethal) ?? null) ? { nonlethal: numberIn(own(e?.fields ?? {}, rules.hp.nonlethal) ?? null) } : {}),
    },
    conditions: conditionsHeld(ctx, who).map((c) => ({ condition: labelOfRow(own(conditionsTable, c.id), c.id), left: left(r, c), ...(textIn(own(conditionsTable, c.id)?.text) !== "" ? { does: textIn(own(conditionsTable, c.id)?.text) } : {}) })),
    effects: effectsHeld(ctx, who).map((x) => ({ effect: x.label, mods: x.modifiers.map((m) => say("d20_mod_to", { value: typeof m.value === "number" ? signed(m.value) : m.value, type: m.type ?? "", to: m.to })).join(", "), left: left(r, x) })),
    ...(daily.length > 0 ? { daily } : {}),
    traits: traitsHeld(ctx, rules, who).map((t) => (t.choice !== undefined ? `${labelOfRow(own(traitsTable, t.id), t.id)} (${t.choice})` : labelOfRow(own(traitsTable, t.id), t.id))),
  };
}

const sheet: ReadDef = {
  name: "sheet",
  family: "checks",
  properties: { who: TEXT },
  required: [],
  example: { who: "Mara" },
  read(r, args, reply) {
    if (rulesOf(r.world) === null) return { line: "no_d20_rules", fields: {} };
    let who = r.doc.pov;
    if (args.who !== undefined && args.who !== null && args.who !== "") {
      const found = foundIn(r, "who", args.who, "entity");
      if (isUnread(found)) return found;
      who = found.id;
    }
    reply.data({ sheet: sheetOf(r, who) });
    return undefined;
  },
};

/** The sheet under the world's tabletop rules. */
export const SHEET_TOOLS: readonly ToolSpec[] = [readTool(sheet)];
