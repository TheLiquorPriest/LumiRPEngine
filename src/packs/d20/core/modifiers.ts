// Modifiers, the one construct the layer adds (RULESET-DESIGN §4.3): where a creature's come from, how they stack, and where a
// total's number comes from (`explain`). A creature's modifiers come from the traits it has, the conditions it is under, the
// passing effects on it, what it wears and has readied, and its size; a procedure may add those the GM names. The ruleset says how
// they stack (`D20Def.bonuses`): of the types it names and the untyped every one counts, of any other type the best; penalties all
// count, or the worst of each type. A limit counts the lowest of its name and adds nothing.

import type { EntityId } from "../../../shared/ids";
import { say } from "../../../shared/lines";
import type { D20Def, Modifier, ModifierSource } from "../../../shared/d20";
import { D20_FIELDS } from "../../../shared/d20";
import type { Node, Program, Value } from "../../../engine/expr";
import { compile, runProgram } from "../../../engine/expr";
import type { EnvVars } from "../../../engine/expr";
import type { ReadContext } from "../../../engine/registry";
import { own } from "../../../engine/pack-kit";
import { evalExpr, fieldDef, scopeEnv } from "../../../engine/scope";
import { conditionsHeld, effectsHeld, gearOn, labelOfRow, modifiersIn, numberIn, rowIdOf, rowsOf, sizeOf, textIn, thingModifiers, thingNumber, traitsHeld } from "./model";

/** One modifier as it bears on a creature now: its value worked out, where it came from, and whether it counts. */
export interface Counted {
  to: string;
  value: number;
  type: string | null;
  source: ModifierSource;
  /** The trait, condition, effect, thing or size it came from, by its label. */
  from: string;
  note?: string;
  limit?: true;
  bypass?: string[];
  /** It counts toward the total; false where a better one of its type counts instead. */
  counted: boolean;
}

/** Modifier reads in progress: a modifier whose value asks for a bonus stops here instead of recursing. */
let reading = 0;

function worked(ctx: ReadContext, who: EntityId, v: number | string | undefined, fallback: Value): Value {
  if (typeof v === "number") return v;
  if (reading > 6) return fallback;
  reading++;
  try {
    return evalExpr(v, scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who } }), fallback);
  } finally {
    reading--;
  }
}

/**
 * The modifiers a creature has from anything, with `given` ones added, each worked out; those whose `when` does not hold are left
 * out. `wants` picks the names asked for before any value or `when` is worked out, so a modifier whose value asks for another total
 * (a finesse's Dexterity, a grace's Charisma) works out only the modifiers that total needs.
 */
export function modifiersOf(ctx: ReadContext, rules: D20Def, who: EntityId, given: readonly Modifier[] = [], wants: (to: string) => boolean = () => true): Counted[] {
  const out: Counted[] = [];
  const add = (mods: readonly Modifier[], source: ModifierSource, from: string, choice?: string): void => {
    for (const m of mods) {
      const to = choice !== undefined ? m.to.replace("{choice}", choice) : m.to;
      if (!wants(to)) continue;
      // A chosen trait's value and condition may name its choice too (`table('weapons', '{choice}', 'threat')`).
      const chosen = (v: string | number): string | number => (choice !== undefined && typeof v === "string" ? v.replaceAll("{choice}", choice) : v);
      if (m.when !== undefined && !worked(ctx, who, chosen(m.when), false)) continue;
      const value = Number(worked(ctx, who, chosen(m.value), 0));
      if (!Number.isFinite(value)) continue;
      out.push({ to, value, type: typeof m.type === "string" && m.type !== "" ? m.type : null, source, from, ...(m.note !== undefined ? { note: m.note } : {}), ...(m.limit === true ? { limit: true as const } : {}), ...(Array.isArray(m.bypass) ? { bypass: m.bypass } : {}), counted: true });
    }
  };
  const traits = rowsOf(ctx, rules, "traits");
  for (const t of traitsHeld(ctx, rules, who)) {
    const row = own(traits, t.id);
    if (row) add(modifiersIn(row.modifiers), "trait", t.choice !== undefined ? `${labelOfRow(row, t.id)} (${t.choice})` : labelOfRow(row, t.id), t.choice);
  }
  const conditions = rowsOf(ctx, rules, "conditions");
  for (const c of conditionsHeld(ctx, who)) {
    const row = own(conditions, c.id);
    if (row) add(modifiersIn(row.modifiers), "condition", labelOfRow(row, c.id));
  }
  for (const e of effectsHeld(ctx, who)) add(e.modifiers, "effect", e.label);
  const armor = rowsOf(ctx, rules, "armor");
  const weapons = rowsOf(ctx, rules, "weapons");
  const { worn, readied } = gearOn(ctx, who);
  for (const [things, source] of [[worn, "worn"], [readied, "readied"]] as const) {
    for (const id of things) {
      const name = own(ctx.state.entities, id)?.name ?? id;
      const rid = rowIdOf(ctx, id);
      const a = own(armor, rid);
      if (a) {
        // Armour and a shield: their bonus of their type (with the thing's enhancement), the most Dexterity they let count, their check penalty.
        const bonus = numberIn(a.bonus);
        if (bonus !== null) add([{ to: "ac", value: bonus + thingNumber(ctx, id, D20_FIELDS.enhancement), type: textIn(a.type) }], source, name);
        const most = numberIn(a.max_dex);
        if (most !== null) add([{ to: "max_dex", value: most, limit: true }], source, name);
        const check = numberIn(a.check);
        if (check !== null && check !== 0) add([{ to: "armor_check", value: check }], source, name);
        add(modifiersIn(a.modifiers), source, name);
      }
      const w = source === "readied" ? own(weapons, rid) : undefined;
      if (w) add(modifiersIn(w.modifiers), source, name);
      add(thingModifiers(ctx, id), source, name);
    }
  }
  const size = sizeOf(ctx, rules, who);
  const sizeRow = own(rowsOf(ctx, rules, "sizes"), size);
  if (sizeRow) add(modifiersIn(sizeRow.modifiers), "size", labelOfRow(sizeRow, size));
  add(given, "given", say("d20_given"));
  return out;
}

/** The names a call asks for: one, or several set apart by commas. */
export function namesOf(to: string): string[] {
  return to.split(",").map((s) => s.trim()).filter((s) => s !== "");
}

/** Whether a modifier to `to` bears on a total asked for by `name`: the same name, or a wider one (`attack` bears on `attack.melee`). */
function bears(to: string, names: readonly string[]): boolean {
  return names.some((n) => n === to || n.startsWith(`${to}.`));
}

/**
 * The modifiers that bear on `to` (one name, or several by commas), with the ruleset's stacking applied: each marked whether it
 * counts. `types` keeps only those types (`only`) or leaves them out (`without`), untyped being the type `untyped`.
 */
export function stacked(ctx: ReadContext, rules: D20Def, who: EntityId, to: string, filter?: { types: readonly string[]; keep: boolean }, given: readonly Modifier[] = []): Counted[] {
  const names = namesOf(to);
  const mods = modifiersOf(ctx, rules, who, given, (t) => bears(t, names)).filter((m) => m.limit !== true && m.value !== 0 && (filter === undefined || filter.types.includes(m.type ?? "untyped") === filter.keep));
  const stack = new Set(rules.bonuses.stack);
  const best = new Map<string, Counted>();
  for (const m of mods) {
    const all = m.type === null || (m.value > 0 ? stack.has(m.type) : rules.bonuses.penaltiesStack);
    if (all) continue;
    const key = `${m.value > 0 ? "+" : "-"}${m.type}`;
    const held = best.get(key);
    if (held === undefined || (m.value > 0 ? m.value > held.value : m.value < held.value)) best.set(key, m);
  }
  return mods.map((m) => {
    if (m.type === null || (m.value > 0 ? stack.has(m.type) : rules.bonuses.penaltiesStack)) return m;
    return { ...m, counted: best.get(`${m.value > 0 ? "+" : "-"}${m.type}`) === m };
  });
}

/** What the modifiers that count add up to. */
export function sumOf(mods: readonly Counted[]): number {
  return mods.reduce((n, m) => n + (m.counted ? m.value : 0), 0);
}

/** The lowest limit of a name a creature has, or null where none applies. */
export function limitOf(ctx: ReadContext, rules: D20Def, who: EntityId, name: string): number | null {
  let low: number | null = null;
  for (const m of modifiersOf(ctx, rules, who, [], (t) => t === name)) if (m.limit === true && (low === null || m.value < low)) low = m.value;
  return low;
}

// ---------------------------------------------------------------- where a total's number comes from

/** One part of a total: the term of its formula, its value, and for a term that adds modifiers each of them. */
export interface Part {
  value: number;
  /** The part in words (`d20_part_*`). */
  words: string;
  mods?: Counted[];
}

/** A total worked out, with its parts. */
export interface Explained {
  total: number;
  parts: Part[];
}

/** A formula's top-level terms, each with its sign. */
function termsOf(node: Node, sign: 1 | -1, out: { node: Node; sign: 1 | -1 }[]): void {
  if (node.k === "bin" && (node.op === "+" || node.op === "-")) {
    termsOf(node.a, sign, out);
    termsOf(node.b, node.op === "-" ? ((-sign) as 1 | -1) : sign, out);
    return;
  }
  out.push({ node, sign });
}

/** A term as its formula writes it. */
function sourceOf(n: Node): string {
  switch (n.k) {
    case "num":
      return String(n.v);
    case "str":
      return `'${n.v}'`;
    case "lit":
      return String(n.v);
    case "id":
      return n.path.join(".");
    case "call":
      return `${n.name}(${n.args.map(sourceOf).join(", ")})`;
    case "un":
      return n.op === "-" ? `-${sourceOf(n.a)}` : `not ${sourceOf(n.a)}`;
    case "bin":
      return `(${sourceOf(n.a)} ${n.op} ${sourceOf(n.b)})`;
    case "tern":
      return `(${sourceOf(n.c)} ? ${sourceOf(n.a)} : ${sourceOf(n.b)})`;
  }
}

/** A number with its sign, as a part says it. */
export function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** A modifier as a part's words say it: its value, its type and where it came from, and whether a better one counted instead. */
export function modWords(m: Counted): string {
  return say(m.counted ? "d20_part_mod" : "d20_part_mod_lost", { value: signed(m.value), type: m.type ?? "", from: m.from, ...(m.note !== undefined ? { note: m.note } : {}) });
}

/** The name of an ability as the creature's kind labels its field, else its id. */
function abilityLabel(ctx: ReadContext, who: EntityId, id: string): string {
  const kind = own(ctx.state.entities, who)?.kind;
  return (kind !== undefined ? fieldDef(ctx.registry, ctx.world, kind, id)?.label : undefined) ?? id;
}

/** A term in words: what the layer's own functions are, said by name; any other term as its formula writes it. */
function termWords(ctx: ReadContext, who: EntityId, n: Node, value: number, vars: EnvVars): string {
  const v = signed(value);
  // An argument as a word: a string, a bound name, else what it works out to (an ability read off a table); its source if none.
  const lit = (i: number): string => {
    const a = n.k === "call" ? n.args[i] : undefined;
    if (!a) return "";
    if (a.k === "str") return a.v;
    if (a.k === "id" && a.path.length === 1) {
      const bound = own(vars, a.path[0] ?? "");
      if (typeof bound === "string") return bound;
    }
    const worked = runProgram({ source: "", root: a, nodeCount: 64 }, scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who }, vars }));
    return typeof worked === "string" && worked !== "" ? worked : sourceOf(a);
  };
  if (n.k === "num") return say("d20_part_base", { value: v });
  if (n.k === "call") {
    switch (n.name) {
      case "mod":
      case "score":
        return say(n.name === "mod" ? "d20_part_ability" : "d20_part_score", { value: v, ability: abilityLabel(ctx, who, lit(1)) });
      case "ranks":
        return say("d20_part_ranks", { value: v, skill: lit(1) });
      case "class_sum":
        return say("d20_part_classes", { value: v, track: lit(1) });
      case "levels":
        return say("d20_part_levels", { value: v });
      case "hit_dice":
        return say("d20_part_hit_dice", { value: v });
      case "size_mod":
        return say("d20_part_size", { value: v });
      case "total":
        return say("d20_part_total", { value: v, name: lit(1) });
      case "limit":
        return say("d20_part_limit", { value: v, name: lit(1) });
      case "min":
      case "max": {
        // The argument that won, in its own words: Dexterity under armour's limit reads as Dexterity, or as the limit.
        const env = scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who }, vars });
        const won = n.args.find((a) => Number(runProgram({ source: "", root: a, nodeCount: 64 }, env)) === value);
        if (won) return termWords(ctx, who, won, value, vars);
        break;
      }
    }
  }
  return say("d20_part_formula", { value: v, formula: sourceOf(n) });
}

/** The modifiers a `bonus`, `bonus_without` or `bonus_only` term adds, when its arguments are words the formula writes. */
function termMods(ctx: ReadContext, rules: D20Def, who: EntityId, n: Node, vars: EnvVars): Counted[] | null {
  if (n.k !== "call" || !["bonus", "bonus_without", "bonus_only"].includes(n.name)) return null;
  const env = scopeEnv({ reg: ctx.registry, ctx, bindings: { self: who }, vars });
  const arg = (i: number): string => {
    const a = n.args[i];
    if (!a) return "";
    const p: Program = { source: "", root: a, nodeCount: 64 };
    return String(runProgram(p, env) ?? "");
  };
  const to = arg(1);
  const filter = n.name === "bonus" ? undefined : { types: namesOf(arg(2)), keep: n.name === "bonus_only" };
  return stacked(ctx, rules, who, to, filter);
}

/** What a total reads that a call may leave unbound, as words: no skill, no weapon, no attack (`vs`) and no key. */
const UNBOUND: EnvVars = { skill: "", weapon: "", vs: "", key: "" };

/**
 * A named total of the ruleset (`D20Def.totals`) worked out for `who`, with each top-level term of its formula as a part and, for a
 * term that adds modifiers, each modifier with its source, its type and whether it counted (§4.4). `vars` binds `skill`, `weapon`,
 * `vs` (`melee` or `ranged`, for a defence read against an attack) and the rest of what the total reads; `bindings` its `target`.
 * Null for a total the ruleset does not name.
 */
export function explain(ctx: ReadContext, rules: D20Def, who: EntityId, name: string, given: EnvVars = {}, bindings: Record<string, EntityId> = {}): Explained | null {
  const src = own(rules.totals, name);
  if (typeof src !== "string") return null;
  let program: Program;
  try {
    program = compile(src);
  } catch {
    return null;
  }
  const vars: EnvVars = { ...UNBOUND, ...given };
  const env = scopeEnv({ reg: ctx.registry, ctx, bindings: { ...bindings, self: who }, vars });
  const terms: { node: Node; sign: 1 | -1 }[] = [];
  termsOf(program.root, 1, terms);
  const parts: Part[] = [];
  let total = 0;
  for (const t of terms) {
    const raw = Number(runProgram({ source: src, root: t.node, nodeCount: program.nodeCount }, env));
    const value = (Number.isFinite(raw) ? raw : 0) * t.sign;
    total += value;
    const mods = termMods(ctx, rules, who, t.node, vars);
    if (mods !== null) {
      // A bonus term is said modifier by modifier; with none, it is no part at all.
      if (mods.length > 0) parts.push({ value, words: mods.map(modWords).join(", "), mods });
      continue;
    }
    if (value !== 0 || t.node.k === "num") parts.push({ value, words: termWords(ctx, who, t.node, value, vars) });
  }
  // A formula that is not a plain sum (a ternary, a max) is its own figure: the terms only say where its numbers come from.
  const whole = Number(runProgram(program, env));
  return { total: Number.isFinite(whole) ? whole : total, parts };
}

/** A total's parts in words, joined. */
export function partsWords(e: Explained): string {
  return e.parts.map((p) => p.words).join(", ");
}

/** A total's figure alone. */
export function totalOf(ctx: ReadContext, rules: D20Def, who: EntityId, name: string, vars: EnvVars = {}, bindings: Record<string, EntityId> = {}): number {
  const src = own(rules.totals, name);
  if (typeof src !== "string") return 0;
  const v = Number(evalExpr(src, scopeEnv({ reg: ctx.registry, ctx, bindings: { ...bindings, self: who }, vars: { ...UNBOUND, ...vars } }), 0));
  return Number.isFinite(v) ? v : 0;
}
