// Sheets pack (DESIGN §9.3): character stats as person fields, derived formulas, bands as words,
// conditions, and stat checks through the engine's one check mechanism (exact odds).
//
// World config (`packs.sheets.config`): `stats` [{id, label, min, max, default}] (default: might,
// agility, wits, charm, grit on 3–18), `derived` {id: {label, formula}} over the stats (default
// health and composure), `bands` (stat words; default poor … exceptional).
//
// Level contract (domain `sheets`, read at the person):
//   0  off
//   1  stats as words only (bands); checks still roll, odds hidden as words
//   2  stat numbers
//   3  derived values and modifiers on checks
//   4  conditions (injured, exhausted …) that modify checks until they expire

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { SheetSectionView } from "../../../shared/state-view";
import { tierLabel } from "../../../shared/tiers";
import type { BandDef, CheckDef } from "../../../shared/world";
import { createEnv, evalNumber } from "../../../engine/expr";
import { labelOf, numOf, objOf, strOf, own } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { buildEntitySheet } from "../../../engine/ruleset";
import { bandOf, kindIs } from "../../../engine/scope";
import { povPlace } from "../../../engine/visibility";

export interface StatDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export const DEFAULT_STATS: readonly StatDef[] = [
  { id: "might", label: "Might", min: 3, max: 18, default: 10 },
  { id: "agility", label: "Agility", min: 3, max: 18, default: 10 },
  { id: "wits", label: "Wits", min: 3, max: 18, default: 10 },
  { id: "charm", label: "Charm", min: 3, max: 18, default: 10 },
  { id: "grit", label: "Grit", min: 3, max: 18, default: 10 },
];

export const DEFAULT_DERIVED: Readonly<Record<string, { label: string; formula: string }>> = {
  health: { label: "Health", formula: "10 + grit" },
  composure: { label: "Composure", formula: "8 + floor((wits + charm) / 4)" },
};

export const DEFAULT_STAT_BANDS: readonly BandDef[] = [
  { label: "poor", max: 5 },
  { label: "weak", min: 6, max: 8 },
  { label: "average", min: 9, max: 12 },
  { label: "good", min: 13, max: 15 },
  { label: "excellent", min: 16, max: 17 },
  { label: "exceptional", min: 18 },
];

/** A condition's default check penalty. */
export const CONDITION_MOD = -2;

/** The stat check: 1d20 + stat modifier + conditions − difficulty + 10; 10+ succeeds, 20+ is a great success. */
export const STAT_CHECK: CheckDef = {
  id: "sheets.stat",
  dice: "1d20",
  modifier: "stat_mod(self, stat) + condition_mod(self) - difficulty_of(params.difficulty) + 10",
  bands: [
    { outcome: "failure", max: 9 },
    { outcome: "success", min: 10, max: 19 },
    { outcome: "great", min: 20 },
  ],
};

declare module "../../../engine/registry" {
  interface QueryMap {
    /** A stat's value (default when unset). */
    "sheets.stat": (ctx: ReadContext, who: EntityId, stat: string) => number;
    /** The stats a check can name (the palette's Attempt options), in sheet order. */
    "sheets.stats": (ctx: ReadContext) => { id: string; label: string }[];
    /** Someone's active conditions by label (Sheets 4 and up), as the Encounter card lists them. */
    "sheets.conditions": (ctx: ReadContext, who: EntityId) => string[];
  }
}

function config(ctx: Pick<ReadContext, "world">): JsonObject {
  return ctx.world.packs.sheets?.config ?? {};
}

export function statsOf(ctx: Pick<ReadContext, "world">): StatDef[] {
  const raw = config(ctx).stats;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_STATS];
  return raw.map((s) => objOf(s)).filter((s) => typeof s.id === "string").map((s) => ({ id: strOf(s.id), label: strOf(s.label, strOf(s.id)), min: numOf(s.min, 3), max: numOf(s.max, 18), default: numOf(s.default, 10) }));
}

function derivedOf(ctx: Pick<ReadContext, "world">): Record<string, { label: string; formula: string }> {
  const raw = objOf(config(ctx).derived);
  if (Object.keys(raw).length === 0) return { ...DEFAULT_DERIVED };
  const out: Record<string, { label: string; formula: string }> = {};
  for (const [id, v] of Object.entries(raw)) {
    const d = objOf(v);
    out[id] = { label: strOf(d.label, id), formula: typeof v === "string" ? v : strOf(d.formula, "0") };
  }
  return out;
}

function statBands(ctx: Pick<ReadContext, "world">): BandDef[] {
  const raw = config(ctx).bands;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_STAT_BANDS];
  return raw.map((b) => objOf(b)).map((b) => ({ label: strOf(b.label), ...(typeof b.min === "number" ? { min: b.min } : {}), ...(typeof b.max === "number" ? { max: b.max } : {}) }));
}

export function statValue(ctx: ReadContext, who: EntityId, stat: string): number {
  const def = statsOf(ctx).find((s) => s.id === stat);
  const v = own(own(ctx.state.entities, who)?.fields ?? {}, stat);
  return typeof v === "number" ? v : (def?.default ?? 10);
}

export function statMod(value: number): number {
  return Math.floor((value - 10) / 2);
}

export function statWord(ctx: ReadContext, value: number): string {
  return bandOf(statBands(ctx), value)?.label ?? "average";
}

export function derivedValue(ctx: ReadContext, who: EntityId, id: string): number {
  const d = own(derivedOf(ctx), id);
  if (!d) return 0;
  const vars: Record<string, number> = {};
  for (const s of statsOf(ctx)) vars[s.id] = statValue(ctx, who, s.id);
  return evalNumber(d.formula, createEnv(vars, { floor: (x) => Math.floor(Number(x)), min: (a, b) => Math.min(Number(a), Number(b)), max: (a, b) => Math.max(Number(a), Number(b)) }), 0);
}

export interface Condition {
  id: string;
  label: string;
  mod: number;
  until?: number;
}

export function activeConditions(ctx: ReadContext, who: EntityId): Condition[] {
  if (ctx.levelOf(who, "sheets") < 4) return [];
  const raw = own(ctx.state.entities, who)?.fields.conditions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => objOf(c))
    .filter((c) => typeof c.id === "string" && !(typeof c.until === "number" && c.until <= ctx.state.clock))
    .map((c) => ({ id: strOf(c.id), label: strOf(c.label, strOf(c.id)), mod: numOf(c.mod, CONDITION_MOD), ...(typeof c.until === "number" ? { until: c.until } : {}) }));
}

function conditionMod(ctx: ReadContext, who: EntityId): number {
  return activeConditions(ctx, who).reduce((a, c) => a + c.mod, 0);
}

/** Common names for the default stats, so "strength" or "dexterity" checks read the right one. */
const STAT_ALIASES: Readonly<Record<string, string>> = {
  strength: "might", str: "might", power: "might", brawn: "might",
  dexterity: "agility", dex: "agility", speed: "agility", reflexes: "agility", stealth: "agility",
  intelligence: "wits", int: "wits", wisdom: "wits", perception: "wits", smarts: "wits",
  charisma: "charm", cha: "charm", persuasion: "charm", presence: "charm",
  constitution: "grit", con: "grit", endurance: "grit", toughness: "grit", willpower: "grit",
};

/** The stat a check names: its id, its label, or a common name for it. */
export function statId(ctx: Pick<ReadContext, "world">, text: string): string {
  const t = text.trim().toLowerCase();
  const stats = statsOf(ctx);
  const hit = stats.find((s) => s.id.toLowerCase() === t || s.label.toLowerCase() === t);
  if (hit) return hit.id;
  const alias = own(STAT_ALIASES, t);
  return alias && stats.some((s) => s.id === alias) ? alias : text;
}

/** A check's difficulty: a number, or a word (easy 8, moderate 10, hard 15, very hard 20, …); moderate when unstated. */
const DIFFICULTY_WORDS: Readonly<Record<string, number>> = { trivial: 5, easy: 8, routine: 8, simple: 8, moderate: 10, medium: 10, average: 10, normal: 10, tricky: 12, hard: 15, difficult: 15, tough: 15, "very hard": 20, "very difficult": 20, heroic: 25, "nearly impossible": 30 };
export const DEFAULT_DIFFICULTY = 10;

export function difficultyOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return DEFAULT_DIFFICULTY;
  const t = v.trim().toLowerCase();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : (own(DIFFICULTY_WORDS, t) ?? DEFAULT_DIFFICULTY);
}

/** The check modifier for a stat: the stat modifier from level 3, plus conditions at level 4. */
function checkMod(ctx: ReadContext, who: EntityId, stat: string): number {
  if (ctx.levelOf(who, "sheets") < 3) return 0;
  return statMod(statValue(ctx, who, statId(ctx, stat)));
}

/**
 * Play → You (the UI's YouView): the POV's sheet as rows. A world whose ruleset designs a sheet
 * shows that one (DESIGN §11, pools as bars, progressions with XP toward the next level); else the
 * pack's own stats and derived values. ✎ fixes from level 2; nothing at level 0.
 */
export interface SheetView {
  level: number;
  name: string;
  /** The POV's tier as players see it (the world's label). */
  tier: string;
  place?: string;
  activity?: string;
  conditions: string[];
  sections: SheetSectionView[];
}

export function buildSheetView(ctx: ReadContext): SheetView {
  const pov = ctx.world.pov;
  const e = own(ctx.state.entities, pov);
  const level = ctx.levelOf(pov, "sheets");
  const designed = level === 0 ? null : buildEntitySheet(ctx, pov, { fixes: level >= 2 });
  const stats = level === 0 || designed
    ? []
    : statsOf(ctx).map((s) => {
        const v = statValue(ctx, pov, s.id);
        const word = statWord(ctx, v);
        const mod = statMod(v);
        if (level === 1) return { label: s.label, value: word };
        return { label: s.label, value: level >= 3 ? `${v} (${mod >= 0 ? "+" : ""}${mod})` : String(v), detail: word, fix: { entity: pov, field: s.id, type: "number" as const, value: v, min: s.min, max: s.max } };
      });
  const derived = level >= 3 && !designed ? Object.entries(derivedOf(ctx)).map(([id, d]) => ({ label: d.label, value: String(derivedValue(ctx, pov, id)) })) : [];
  const place = povPlace(ctx.registry, ctx.world, ctx.state);
  const activity = strOf(e?.fields.activity);
  return {
    level,
    name: e?.name ?? pov,
    tier: e ? tierLabel(ctx.world, e.tier) : "",
    ...(place ? { place: place.name } : {}),
    ...(activity !== "" ? { activity } : {}),
    conditions: activeConditions(ctx, pov).map((c) => c.label),
    sections: designed ?? [...(stats.length > 0 ? [{ title: "Stats", rows: stats }] : []), ...(derived.length > 0 ? [{ title: "Derived", rows: derived }] : [])],
  };
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

export const sheetsPack: PackDef = {
  id: "sheets",
  label: "Character sheets",
  version: 1,
  domain: "sheets",
  requires: ["space"],
  register(r) {
    // The stat fields live on `person` (space); worlds with other stats still store them as fields.
    r.query("sheets.stat", statValue);
    r.query("sheets.stats", (ctx) => statsOf(ctx).map((s) => ({ id: s.id, label: s.label })));
    r.query("sheets.conditions", (ctx, who) => activeConditions(ctx, who).map((c) => c.label));
    r.formula("stat", (ctx, who, stat) => statValue(ctx, String(who ?? ""), String(stat ?? "")));
    r.formula("stat_mod", (ctx, who, stat) => checkMod(ctx, String(who ?? ""), String(stat ?? "")));
    r.formula("difficulty_of", (_ctx, v) => difficultyOf(v));
    r.formula("stat_word", (ctx, who, stat) => statWord(ctx, statValue(ctx, String(who ?? ""), String(stat ?? ""))));
    r.formula("derived", (ctx, who, id) => derivedValue(ctx, String(who ?? ""), String(id ?? "")));
    r.formula("condition_mod", (ctx, who) => conditionMod(ctx, String(who ?? "")));
    r.formula("has_condition", (ctx, who, id) => activeConditions(ctx, String(who ?? "")).some((c) => c.id === String(id ?? "")));

    r.effect({
      type: "sheets.condition",
      args: ["condition", "who?", "label?", "mod?", "minutes?", "clear?"],
      resolve(a, ctx) {
        const who = strOf(a.who) || ctx.world.pov;
        const e = own(ctx.state.entities, who);
        if (!e) return reject("missing_entity", `no ${labelOf(ctx, who)}`);
        const id = strOf(a.condition).toLowerCase().replace(/\W+/g, "_");
        if (!id) return reject("bad_condition", "a condition needs a name");
        const kept = (Array.isArray(e.fields.conditions) ? e.fields.conditions : []).filter((c) => objOf(c).id !== id && !(typeof objOf(c).until === "number" && numOf(objOf(c).until) <= ctx.state.clock));
        if (a.clear === true) return [{ type: "set", entity: who, field: "conditions", value: kept }];
        const next: JsonObject = { id, label: strOf(a.label, strOf(a.condition)), mod: numOf(a.mod, CONDITION_MOD) };
        if (typeof a.minutes === "number" && a.minutes > 0) next.until = ctx.state.clock + Math.round(a.minutes);
        return [{ type: "set", entity: who, field: "conditions", value: [...kept, next] }];
      },
    });

    r.action({
      id: "attempt",
      label: "Attempt",
      description: "Try something hard that one of your stats decides: climb, force, persuade, notice.",
      pack: "sheets",
      params: { stat: { type: "text", label: "Stat" }, difficulty: { type: "text", optional: true, label: "Difficulty (easy, moderate, hard, very hard or a number)" } },
      requires: ["level.sheets >= 1"],
      check: STAT_CHECK,
      outcomes: { failure: [], success: [], great: [] },
      duration: "5",
      lexicon: ["try to", "attempt", "check"],
      observable: "makes an attempt",
    });

    r.renderer({
      slot: "outcome",
      render(ctx) {
        const conditions = activeConditions(ctx, ctx.world.pov);
        return conditions.length > 0 ? [`You are ${conditions.map((c) => c.label.toLowerCase()).join(", ")}.`] : [];
      },
    });
    r.view({ panel: "sheets.you", build: (ctx) => buildSheetView(ctx) as unknown as JsonValue });

    r.proposal({
      type: "condition",
      boundField: "list",
      validate(p, ctx) {
        const who = strOf(p.who) || ctx.world.pov;
        if (!own(ctx.state.entities, who) || !kindIs(ctx.registry, ctx.world, own(ctx.state.entities, who)?.kind ?? "", "person")) return reject("missing_entity", "a condition needs a person");
        if (strOf(p.condition) === "") return reject("bad_condition", "a condition needs a name");
        return null;
      },
      toEffects: (p) => [{ type: "sheets.condition", args: { who: strOf(p.who), condition: strOf(p.condition), ...(typeof p.minutes === "number" ? { minutes: p.minutes } : {}), ...(p.clear === true ? { clear: true } : {}) } }],
    });

    r.lint({
      code: "sheets.stat_range",
      check(world) {
        const stats = statsOf({ world });
        const issues = [];
        for (const e of Object.values(world.entities)) {
          for (const s of stats) {
            const v = own(e.fields, s.id);
            if (typeof v === "number" && (v < s.min || v > s.max)) issues.push({ severity: "warning" as const, code: "sheets.stat_range", message: `${e.name}'s ${s.label} ${v} is outside ${s.min}–${s.max}.`, path: `entities.${e.id}.fields.${s.id}` });
          }
        }
        return issues;
      },
    });
  },
};

export default sheetsPack;
