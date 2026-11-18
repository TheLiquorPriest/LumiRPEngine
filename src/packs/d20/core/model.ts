// What the layer reads (RULESET-DESIGN §4): the world's `ruleset.d20` part, the rows of the tables it names, and what a creature
// keeps of the layer's own (its classes, ranks, traits, conditions, effects, attacks, size), each read as the data holds it and
// nothing assumed of a game.

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { TableRow } from "../../../shared/tables";
import type { ConditionHeld, D20Def, D20TableRole, EffectHeld, Modifier, NaturalAttack } from "../../../shared/d20";
import { D20_FIELDS } from "../../../shared/d20";
import type { ReadContext } from "../../../engine/registry";
import { own } from "../../../engine/pack-kit";
import { contentsOf } from "../../../engine/things";
import { isGone } from "../../../engine/scope";

/** The world's tabletop rules, or null for a world without them. */
export function rulesOf(world: ReadContext["world"]): D20Def | null {
  const d = world.ruleset?.d20;
  return isRecord(d) && Array.isArray(d.abilities) && isRecord(d.totals) ? d : null;
}

/** Whether the layer is live: the world has the rules and the chat's level of the domain is 1 or more (no tier or band decides it). */
export function isOn(ctx: Pick<ReadContext, "world" | "state">): boolean {
  return rulesOf(ctx.world) !== null && (ctx.state.realism.levels.d20 ?? 0) >= 1;
}

/** The rows of the ruleset's table of a role; empty where it names none or the world lacks it. */
export function rowsOf(ctx: Pick<ReadContext, "world">, rules: D20Def, role: D20TableRole): Readonly<Record<string, TableRow>> {
  const id = rules.tables[role];
  const table = id === undefined ? undefined : own(ctx.world.tables, id);
  return table && isRecord(table.rows) ? table.rows : {};
}

/** A row of a role's table by its id, or by its label in any case. */
export function rowOf(ctx: Pick<ReadContext, "world">, rules: D20Def, role: D20TableRole, said: string): { id: string; row: TableRow } | null {
  const rows = rowsOf(ctx, rules, role);
  const exact = own(rows, said);
  if (exact) return { id: said, row: exact };
  const lower = said.trim().toLowerCase();
  for (const [id, row] of Object.entries(rows)) {
    const label = typeof row.label === "string" ? row.label : typeof row.name === "string" ? row.name : "";
    if (id.toLowerCase() === lower || label.toLowerCase() === lower) return { id, row };
  }
  return null;
}

/** A row's label, else its id. */
export function labelOfRow(row: TableRow | undefined, id: string): string {
  return typeof row?.label === "string" && row.label !== "" ? row.label : typeof row?.name === "string" && row.name !== "" ? row.name : id.replace(/_/g, " ");
}

/** A cell read as a number, or null. */
export function numberIn(v: JsonValue | undefined): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** A cell read as words, or the empty string. */
export function textIn(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : "";
}

/** A cell read as a list of words. */
export function wordsIn(v: JsonValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : typeof v === "string" && v !== "" ? v.split(",").map((s) => s.trim()).filter((s) => s !== "") : [];
}

/** A cell read as modifiers: each an object with `to` and `value`. */
export function modifiersIn(v: JsonValue | undefined): Modifier[] {
  if (!Array.isArray(v)) return [];
  return v.filter((m): m is JsonObject => isRecord(m) && typeof m.to === "string" && m.to !== "" && (typeof m.value === "number" || typeof m.value === "string")) as unknown as Modifier[];
}

function fieldsOf(ctx: Pick<ReadContext, "state">, who: EntityId): Readonly<JsonObject> {
  return own(ctx.state.entities, who)?.fields ?? {};
}

/** A record of counts kept on a creature (its classes, its ranks): each whole number by its key. */
function countsOf(v: JsonValue | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n) && n !== 0) out[k] = n;
  return out;
}

/** A creature's levels in each class. */
export function classesOf(ctx: Pick<ReadContext, "state">, who: EntityId): Record<string, number> {
  return countsOf(fieldsOf(ctx, who)[D20_FIELDS.classes]);
}

/** A creature's ranks in each skill. */
export function ranksOf(ctx: Pick<ReadContext, "state">, who: EntityId): Record<string, number> {
  return countsOf(fieldsOf(ctx, who)[D20_FIELDS.ranks]);
}

/** The traits a creature has taken, each with the choice it was taken with. */
export function traitsTaken(ctx: Pick<ReadContext, "state">, who: EntityId): { id: string; choice?: string; why?: string }[] {
  const raw = fieldsOf(ctx, who)[D20_FIELDS.traits];
  if (!Array.isArray(raw)) return [];
  const out: { id: string; choice?: string; why?: string }[] = [];
  for (const t of raw) {
    if (typeof t === "string" && t !== "") out.push({ id: t });
    else if (isRecord(t) && typeof t.id === "string" && t.id !== "") out.push({ id: t.id, ...(typeof t.choice === "string" && t.choice !== "" ? { choice: t.choice } : {}), ...(typeof t.why === "string" ? { why: t.why } : {}) });
  }
  return out;
}

/**
 * Every trait a creature has: those it took, and the features its classes give at the levels it has in them (a classes row's
 * `features`, by level), each with where it came from.
 */
export function traitsHeld(ctx: Pick<ReadContext, "world" | "state">, rules: D20Def, who: EntityId): { id: string; choice?: string; from: string | null }[] {
  const out: { id: string; choice?: string; from: string | null }[] = traitsTaken(ctx, who).map((t) => ({ id: t.id, ...(t.choice !== undefined ? { choice: t.choice } : {}), from: null }));
  for (const [cls, level] of Object.entries(classesOf(ctx, who))) {
    const features = own(rowsOf(ctx, rules, "classes"), cls)?.features;
    if (!isRecord(features)) continue;
    for (const [at, ids] of Object.entries(features)) {
      const n = Number(at);
      if (!Number.isFinite(n) || n > level) continue;
      for (const id of wordsIn(ids)) out.push({ id, from: cls });
    }
  }
  return out;
}

/** Whether a length kept on a held condition or effect has run out on the clock. */
function ended(held: { until?: number; rounds?: number }, clock: number): boolean {
  return (typeof held.until === "number" && held.until <= clock) || (typeof held.rounds === "number" && held.rounds <= 0);
}

/** The conditions a creature is under now: those whose length has not run out. */
export function conditionsHeld(ctx: Pick<ReadContext, "state">, who: EntityId): ConditionHeld[] {
  const raw = fieldsOf(ctx, who)[D20_FIELDS.conditions];
  if (!Array.isArray(raw)) return [];
  return (raw.filter((c) => isRecord(c) && typeof c.id === "string" && c.id !== "") as unknown as ConditionHeld[]).filter((c) => !ended(c, ctx.state.clock));
}

/** The passing effects on a creature now. */
export function effectsHeld(ctx: Pick<ReadContext, "state">, who: EntityId): EffectHeld[] {
  const raw = fieldsOf(ctx, who)[D20_FIELDS.effects];
  if (!Array.isArray(raw)) return [];
  return (raw.filter((e) => isRecord(e) && typeof e.label === "string") as unknown as EffectHeld[]).filter((e) => !ended(e, ctx.state.clock)).map((e) => ({ ...e, modifiers: modifiersIn(e.modifiers as unknown as JsonValue) }));
}

/** A creature's own attacks. */
export function naturalAttacks(ctx: Pick<ReadContext, "state">, who: EntityId): NaturalAttack[] {
  const raw = fieldsOf(ctx, who)[D20_FIELDS.attacks];
  return Array.isArray(raw) ? (raw.filter((a) => isRecord(a) && typeof a.label === "string" && typeof a.damage === "string") as unknown as NaturalAttack[]) : [];
}

/** A creature's size: its own, else the ruleset's default. */
export function sizeOf(ctx: Pick<ReadContext, "state">, rules: D20Def, who: EntityId): string {
  const s = fieldsOf(ctx, who)[D20_FIELDS.size];
  return typeof s === "string" && s !== "" ? s : rules.defaultSize;
}

/** The row a thing reads in a table of rows by catalog id (a weapon, an armour): the one it is said to be (`d20_row`), else its catalog's, else its own id's. */
export function rowIdOf(ctx: Pick<ReadContext, "state">, thing: EntityId): string {
  const fields = fieldsOf(ctx, thing);
  const said = fields[D20_FIELDS.row];
  if (typeof said === "string" && said !== "") return said;
  const c = fields.catalog;
  return typeof c === "string" && c !== "" ? c : thing;
}

/** The things a creature wears (`worn_by`) and has readied in hand (`equipped`), in id order. */
export function gearOn(ctx: Pick<ReadContext, "state">, who: EntityId): { worn: EntityId[]; readied: EntityId[] } {
  const worn: EntityId[] = [];
  const readied: EntityId[] = [];
  for (const id of contentsOf(ctx.state, who)) {
    const e = own(ctx.state.entities, id);
    if (!e || isGone(ctx.state, id)) continue;
    if (e.relations.some((r) => r.type === "equipped" && r.to === who)) readied.push(id);
    else if (e.relations.some((r) => r.type === "worn_by" && r.to === who)) worn.push(id);
  }
  return { worn, readied };
}

/** A thing's own number field (its enhancement, its rounds loaded), or 0. */
export function thingNumber(ctx: Pick<ReadContext, "state">, thing: EntityId, field: string): number {
  return numberIn(fieldsOf(ctx, thing)[field]) ?? 0;
}

/** A thing's own modifiers. */
export function thingModifiers(ctx: Pick<ReadContext, "state">, thing: EntityId): Modifier[] {
  return modifiersIn(fieldsOf(ctx, thing)[D20_FIELDS.modifiers]);
}
