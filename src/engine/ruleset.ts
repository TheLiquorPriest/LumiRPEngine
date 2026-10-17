// The world's tabletop ruleset (DESIGN §11): progression (levels from XP) and the designed sheet.
// Pure reads. The level-ups themselves are applied by effects (engine/effects `levelUps`), so they
// are recorded as events and replay exactly; the realism floors live with effective levels
// (engine/registry-impl `rulesetFloor`).

import type { EntityId, KindId } from "../shared/ids";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { FixTarget, SheetRowView, SheetSectionView } from "../shared/state-view";
import type { FieldDef, ProgressionDef, SheetRowDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { bandOf, evalExpr, fieldDef, kindIs, poolMax, scopeEnv } from "./scope";
import { own } from "./pack-kit";

/** Whether a progression applies to entities of a kind: its `kind` (descendants too), else any kind with both its fields. */
export function progressionApplies(reg: Registry, world: WorldDoc, prog: ProgressionDef, kind: KindId): boolean {
  if (prog.kind !== undefined) return kindIs(reg, world, kind, prog.kind);
  return fieldDef(reg, world, kind, prog.xpField) !== undefined && fieldDef(reg, world, kind, prog.levelField) !== undefined;
}

/** The XP each level needs, from level 1: the list, or the named table column's numbers in row order. */
export function thresholdsOf(world: WorldDoc, prog: ProgressionDef): number[] {
  const t = prog.thresholds;
  if (Array.isArray(t)) return t.filter((x) => typeof x === "number" && Number.isFinite(x));
  const table = isRecord(t) ? own(world.tables, t.table) : undefined;
  const out: number[] = [];
  if (!table || !isRecord(table.rows)) return out;
  for (const row of Object.values(table.rows)) {
    const v: JsonValue | undefined = isRecord(row) ? own(row, t.column) : undefined;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** The level an amount of XP reaches: how many thresholds, in order, it has reached; at most `maxLevel`. */
export function levelFor(thresholds: readonly number[], xp: number, maxLevel?: number): number {
  let level = 0;
  for (const t of thresholds) {
    if (xp < t) break;
    level++;
  }
  return maxLevel !== undefined && Number.isFinite(maxLevel) ? Math.min(level, Math.max(0, Math.floor(maxLevel))) : level;
}

/** A field's stored number, else its default number; derived formulas don't apply to progression fields. */
function storedNumber(reg: Registry, ctx: ReadContext, entity: EntityId, field: string): number | null {
  const e = own(ctx.state.entities, entity);
  const v = e ? own(e.fields, field) : undefined;
  if (typeof v === "number") return v;
  const d = e ? fieldDef(reg, ctx.world, e.kind, field)?.default : undefined;
  return typeof d === "number" ? d : null;
}

export interface ProgressReading {
  level: number;
  xp: number;
  /** The XP the current level needed. */
  from: number;
  /** The XP the next level needs; null at the top. */
  next: number | null;
  /** The level the XP has reached (above `level` until the level-up is applied). */
  reached: number;
}

/**
 * An entity's place on a progression, or null when the progression doesn't apply to it. The level
 * is the level field's stored number, else its default, else the level zero XP reaches.
 */
export function progressOf(reg: Registry, ctx: ReadContext, entity: EntityId, prog: ProgressionDef): ProgressReading | null {
  const e = own(ctx.state.entities, entity);
  if (!e || !progressionApplies(reg, ctx.world, prog, e.kind)) return null;
  const thresholds = thresholdsOf(ctx.world, prog);
  const xp = storedNumber(reg, ctx, entity, prog.xpField) ?? 0;
  const level = storedNumber(reg, ctx, entity, prog.levelField) ?? levelFor(thresholds, 0, prog.maxLevel);
  const top = prog.maxLevel !== undefined ? Math.min(thresholds.length, prog.maxLevel) : thresholds.length;
  return { level, xp, from: thresholds[level - 1] ?? 0, next: level < top ? (thresholds[level] ?? null) : null, reached: levelFor(thresholds, xp, prog.maxLevel) };
}

function words(id: string): string {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shown(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A value as the sheet shows it: money in the world's currency, refs by name, a number's band as its detail. */
function display(ctx: ReadContext, def: FieldDef | undefined, v: JsonValue | undefined): { value: string; detail?: string } {
  if (v === undefined || v === null) return { value: "—" };
  if (typeof v === "boolean") return { value: v ? "yes" : "no" };
  if (typeof v === "number") {
    if (def?.type === "money") return { value: formatMoney(v, ctx.world.currency) };
    const band = bandOf(def?.bands, v);
    return band ? { value: shown(v), detail: band.label } : { value: shown(v) };
  }
  if (typeof v === "string") return { value: own(ctx.state.entities, v)?.name ?? own(ctx.world.places, v)?.name ?? v };
  return { value: Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : "—" };
}

const FIXABLE: Readonly<Record<string, true>> = { number: true, text: true, bool: true, enum: true, money: true, duration: true };

function fixOf(entity: EntityId, field: string, def: FieldDef, value: JsonValue | undefined, bounds: { min?: number; max?: number }): FixTarget | undefined {
  if (def.derived !== undefined || !own(FIXABLE, def.type)) return undefined;
  return {
    entity,
    field,
    type: def.type,
    value: value ?? null,
    ...(def.type === "enum" && def.values ? { options: def.values.map((x) => ({ value: x, label: x })) } : {}),
    ...(bounds.min !== undefined ? { min: bounds.min } : {}),
    ...(bounds.max !== undefined ? { max: bounds.max } : {}),
  };
}

function rowOf(reg: Registry, ctx: ReadContext, entity: EntityId, row: SheetRowDef, fixes: boolean): SheetRowView | null {
  const e = own(ctx.state.entities, entity);
  if (!e) return null;
  const env = scopeEnv({ reg, ctx, bindings: { self: entity } });
  if ("formula" in row) {
    const v = evalExpr(row.formula, env, null);
    return { label: row.label, ...display(ctx, undefined, v) };
  }
  if ("pool" in row) {
    const def = fieldDef(reg, ctx.world, e.kind, row.pool);
    if (!def?.pool) return null;
    const read = env.lookup(["self", row.pool]);
    const current = typeof read === "number" ? read : 0;
    const max = poolMax(reg, ctx, entity, def.pool);
    const min = def.pool.min ?? 0;
    const fix = fixes ? fixOf(entity, row.pool, def, own(e.fields, row.pool) ?? current, { min, ...(max !== null ? { max } : {}) }) : undefined;
    return { label: row.label ?? def.label ?? words(row.pool), value: `${shown(current)} / ${max === null ? "—" : shown(max)}`, pool: { current, min, max }, ...(fix ? { fix } : {}) };
  }
  if ("progression" in row) {
    const prog = own(ctx.world.ruleset?.progression ?? {}, row.progression);
    const p = prog ? progressOf(reg, ctx, entity, prog) : null;
    if (!prog || !p) return null;
    const def = fieldDef(reg, ctx.world, e.kind, prog.xpField);
    const xpLabel = def?.label ?? "XP";
    const fix = fixes && def ? fixOf(entity, prog.xpField, def, own(e.fields, prog.xpField) ?? p.xp, { min: def.min, max: def.max }) : undefined;
    return {
      label: row.label ?? prog.label,
      value: shown(p.level),
      detail: p.next === null ? `${shown(p.xp)} ${xpLabel} · top level` : `${shown(p.xp)} / ${shown(p.next)} ${xpLabel}`,
      progress: { level: p.level, xp: p.xp, from: p.from, next: p.next },
      ...(fix ? { fix } : {}),
    };
  }
  if (typeof row.field !== "string") return null;
  const def = fieldDef(reg, ctx.world, e.kind, row.field);
  // Stored JSON (a list keeps its length); derived fields and unset pools read through the scope.
  const stored = own(e.fields, row.field) ?? def?.default;
  if (!def && stored === undefined) return null;
  const value = def?.derived === undefined && stored !== undefined ? stored : env.lookup(["self", row.field]);
  const fix = fixes && def ? fixOf(entity, row.field, def, stored, { min: def.min, max: def.max }) : undefined;
  return { label: row.label ?? def?.label ?? words(row.field), ...display(ctx, def, value), ...(fix ? { fix } : {}) };
}

/**
 * An entity's designed sheet (DESIGN §11): the world's `ruleset.sheet` sections, each row read from
 * that entity (a field, a formula with the entity as `self`, a pool's current of max, a
 * progression's level and XP). Null when the world designs no sheet. Any entity reads: Play → You
 * builds the POV's, and a GM view can build anyone's. `fixes` adds ✎ targets to the rows a fix can
 * write. Rows that don't apply to the entity (a pool its kind lacks) are left out.
 */
export function buildEntitySheet(ctx: ReadContext, entity: EntityId, opts: { fixes?: boolean } = {}): SheetSectionView[] | null {
  const layout = ctx.world.ruleset?.sheet;
  if (!layout || !Array.isArray(layout.sections) || layout.sections.length === 0) return null;
  const reg = ctx.registry;
  return layout.sections.map((section) => ({
    title: section.label,
    rows: (Array.isArray(section.rows) ? section.rows : []).flatMap((row) => {
      const view = isRecord(row) ? rowOf(reg, ctx, entity, row, opts.fixes === true) : null;
      return view ? [view] : [];
    }),
  }));
}

/** The most a ruleset the Sheet Designer previews may hold: it is read on the backend thread at every edit. */
export const SHEET_PREVIEW_LIMITS = Object.freeze({ sections: 32, rows: 64, thresholds: 200, formula: 1024 });

const ROW_PARTS = ["field", "formula", "pool", "progression"] as const;

/**
 * Why a ruleset sent for the Sheet Designer's preview can't be read, or null: the parts the sheet
 * reads (its sections and rows, and the progressions rows name) in the world's shapes, within
 * `SHEET_PREVIEW_LIMITS`. Each row's cost grows with its progression's thresholds, so an unchecked
 * ruleset could hold the backend for seconds, and a malformed one would fail inside the sheet.
 */
export function sheetRulesetProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return "The ruleset must be an object.";
  const limits = SHEET_PREVIEW_LIMITS;
  if (raw.sheet !== undefined) {
    const sheet = raw.sheet;
    if (!isRecord(sheet) || !Array.isArray(sheet.sections)) return "A sheet is a list of sections.";
    if (sheet.sections.length > limits.sections) return `A sheet has at most ${limits.sections} sections.`;
    for (const section of sheet.sections) {
      if (!isRecord(section) || typeof section.id !== "string" || typeof section.label !== "string" || !Array.isArray(section.rows)) return "A section needs an id, a title and a list of rows.";
      if (section.rows.length > limits.rows) return `A section has at most ${limits.rows} rows.`;
      for (const row of section.rows) {
        if (!isRecord(row) || ROW_PARTS.filter((k) => typeof row[k] === "string").length !== 1 || (row.label !== undefined && typeof row.label !== "string")) return "A row shows one thing: a field, a formula, a pool or a progression.";
        if (typeof row.formula === "string" && row.formula.length > limits.formula) return `A formula is at most ${limits.formula} characters.`;
      }
    }
  }
  if (raw.progression !== undefined) {
    if (!isRecord(raw.progression)) return "Progressions are an object by id.";
    for (const p of Object.values(raw.progression)) {
      if (!isRecord(p) || typeof p.xpField !== "string" || typeof p.levelField !== "string") return "A progression needs an XP field and a level field.";
      const t = p.thresholds;
      if (Array.isArray(t) ? t.some((x) => typeof x !== "number" || !Number.isFinite(x)) : !(isRecord(t) && typeof t.table === "string" && typeof t.column === "string")) return "Thresholds are a list of XP amounts, or a data table and column.";
      if (Array.isArray(t) && t.length > limits.thresholds) return `A progression has at most ${limits.thresholds} thresholds.`;
    }
  }
  return null;
}
