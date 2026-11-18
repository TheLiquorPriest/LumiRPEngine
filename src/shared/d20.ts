// The tabletop rules layer's data (the `d20` pack, RULESET-DESIGN §4): what a world's `ruleset.d20` part holds, the shapes of
// the tables it names, a modifier, and what a creature's sheet keeps of the layer's own. All of it is plain data a user grows:
// every number and formula of a game is a world's, none is written here. Code knows only how a check, an attack and harm are
// worked out, and reads everything else from these shapes.
//
// Names the other parts of RPE use (the data sets, the chat's setup, the pages, the texts) are fixed here: the table roles and
// their columns, the named totals, the fields a creature keeps, the formula functions, the actions and the records.

import type { ColumnDef } from "./tables";
import type { FieldId, KindId, ProgressionId, TableId } from "./ids";
import type { CheckDef, Expr, LifeStateId } from "./world";

/** The pack's id, and its realism domain: the layer is live in a chat only while the chat's level of this domain is 1 or more. */
export const D20_PACK = "d20";

// ---------------------------------------------------------------- modifiers

/**
 * The one construct the layer adds (§4.3). `to` names what it changes, an open word a formula asks for by name (`ac`,
 * `attack.ranged`, `damage`, `save.will`, `skill.climb`, `ability.str`, `initiative`, `hp`, `speed`, `armor_check`,
 * `attack.weapon.<weapons row>`, `reduction`, `resist.<damage type>`); a trait held with a choice fills `{choice}` in it. `value`
 * is a number or a formula with the creature as `self`. `type` is the bonus's type (absent: untyped), which decides how it stacks
 * (`D20Def.bonuses`). `when` is a formula with the creature as `self` that must hold for it to count.
 */
export interface Modifier {
  to: string;
  value: number | Expr;
  type?: string;
  when?: Expr;
  /** What it is for, in words, shown beside it where a total's parts are told. */
  note?: string;
  /** A limit, not a bonus (the most of an ability's modifier armour lets count): of several to one name the lowest counts. */
  limit?: true;
  /** For a `reduction`: damage of any of these types passes through it. */
  bypass?: string[];
}

/** Where a modifier came from, as `explain` and the answers name it. */
export type ModifierSource = "trait" | "condition" | "effect" | "worn" | "readied" | "size" | "given";

// ---------------------------------------------------------------- what a creature keeps

/** The fields the layer keeps on a creature and on a thing, by name. The formula functions read them; nothing else need know them. */
export const D20_FIELDS = {
  /** Levels in each class, by the classes table's row: `{ "fighter": 3, "rogue": 2 }`. */
  classes: "classes",
  /** Ranks in each skill trained, by the skills table's row: `{ "climb": 4 }`. */
  ranks: "ranks",
  /** The traits it has (`TraitHeld[]`): feats, its race, its class features, a template. */
  traits: "d20_traits",
  /** The conditions it is under (`ConditionHeld[]`); the sheets pack's conditions live in the same list. */
  conditions: "conditions",
  /** The passing effects on it (`EffectHeld[]`): a circumstance or a spell the GM names, with its modifiers and its end. */
  effects: "d20_effects",
  /** Its own attacks (`NaturalAttack[]`): claws, a bite, a slam. */
  attacks: "d20_attacks",
  /** Its size, a row of the sizes table; absent, the ruleset's `defaultSize`. */
  size: "size",
  /** The dice kept for its hit points, every level's summed, as `advance` and `stat_as` record them. */
  hitDice: "hit_dice",
  /** On a thing: the rounds in its magazine. */
  loaded: "loaded",
  /** On a thing: its enhancement, added to attack and damage with a weapon, to its bonus with armour. */
  enhancement: "enhancement",
  /** On a thing: its own modifiers (`Modifier[]`), counted while it is worn or readied. */
  modifiers: "modifiers",
} as const;

/** A trait a creature has: its row, and the choice it was taken with (Weapon Focus's weapon). */
export type TraitHeld = string | { id: string; choice?: string; why?: string };

/**
 * A condition a creature is under: the conditions table's row, and how long it lasts: until a clock minute (`until`), for a
 * number of its own turns in a fight (`rounds`), or until it makes a save (`save`, tried as the ruleset says); none of them,
 * until it is taken off. `label` and `mod` are the sheets pack's, which shares the list.
 */
export interface ConditionHeld {
  id: string;
  until?: number;
  rounds?: number;
  save?: { save: string; dc: number };
  why?: string;
  label?: string;
  mod?: number;
}

/** A passing effect on a creature: its label, its modifiers, and how long it lasts, as a condition does. */
export interface EffectHeld {
  label: string;
  modifiers: Modifier[];
  until?: number;
  rounds?: number;
  save?: { save: string; dc: number };
  why?: string;
}

/** One of a creature's own attacks: its label, its damage dice and how the attack is made. */
export interface NaturalAttack {
  label: string;
  damage: string;
  /** The named total its roll adds; absent, the ruleset's melee total. */
  total?: string;
  /** Added to the roll on top of the total. */
  bonus?: number;
  types?: string[];
  threat?: number;
  multiplier?: number;
  /** How the weapons row's `held` reads it, for Strength's share; absent, `one`. */
  held?: string;
  /** Made as a lesser attack beside the first (a creature's secondary attacks), with the ruleset's penalty for one. */
  secondary?: true;
}

// ---------------------------------------------------------------- the ruleset's part

/** The roles of the tables a ruleset names (`D20Def.tables`). */
export const D20_TABLE_ROLES = ["skills", "classes", "tracks", "traits", "conditions", "sizes", "weapons", "armor", "creatures", "experience", "challenges", "difficulties"] as const;
export type D20TableRole = (typeof D20_TABLE_ROLES)[number];

/** The named totals every ruleset gives (`D20Def.totals`), so the actions and the pages can ask by name. A ruleset may give more. */
export const D20_TOTALS = ["ac", "ac.touch", "ac.flat", "attack.base", "attack.melee", "attack.ranged", "damage", "save.fort", "save.ref", "save.will", "initiative", "skill", "hp.max", "speed"] as const;

/** Taking a number in place of a check's roll: the number taken, and how many times the check's usual time it takes. */
export interface TakeDef {
  value: number;
  times: number;
}

/** A shot of a weapon that fires (§5.1 `attack`'s `shots`): what it needs of the weapon, what it spends and what it changes. */
export interface ShotDef {
  /** The fire mode the weapons row's `fire` must list. */
  needs: string;
  /** Rounds it spends from the magazine. */
  rounds: number;
  /** Added to the attack roll. */
  attack?: number;
  /** Dice of the weapon's damage added. */
  dice?: number;
  /** An area shot: the side of the square it covers, in the world's units; each creature in it makes `save` against `dc`, and takes the damage on a failure. */
  area?: number;
  save?: string;
  dc?: number;
  /** A trait the shot needs: one fired without it is reported, and made all the same. */
  trait?: string;
}

/** A state hit points put a creature in (§4.5): what holds it, and the condition and life state it brings. */
export interface HpStateDef {
  id: string;
  /** A formula with the creature as `self`. */
  when: Expr;
  /** The conditions table's row put on while it holds; absent, the row of the state's own id. */
  condition?: string;
  life?: LifeStateId;
}

/**
 * A world's tabletop rules (RULESET-DESIGN §4.1). Every rule that differs between one game of the family and another is one of
 * these values or a table's cell, so one way of working serves them all.
 */
export interface D20Def {
  /** The ability scores: number fields of every kind in `kinds`. */
  abilities: string[];
  /** An ability's modifier from its effective score `x`. */
  mod: Expr;
  /** Every kind whose creatures carry the sheet's fields (people, creatures, animals). */
  kinds: KindId[];
  /** The sizes row of a creature that names none. */
  defaultSize: string;
  /** How bonuses stack: of the types in `stack` (and the untyped) every one counts; of any other type the best; penalties all count when `penaltiesStack`, else the worst of each type. */
  bonuses: { stack: string[]; penaltiesStack: boolean };
  /** The tables, by role. */
  tables: Partial<Record<D20TableRole, TableId>>;
  /** The named totals (`D20_TOTALS` and any more), each a formula with `self`, and `target`, `skill` and `weapon` where they apply. */
  totals: Record<string, Expr>;
  check: {
    /** By what is said (`10`, `20`). */
    take: Record<string, TakeDef>;
    /** Helping another: the total a helper's own roll must reach, and what it adds. */
    aid: { dc: number; bonus: number };
    /** Where a check's natural die decides on its own, if it does. */
    autoFail?: number;
    autoSucceed?: number;
  };
  save: {
    autoFail?: number;
    autoSucceed?: number;
  };
  attack: {
    /** A natural die at or below this misses, at or above `autoHit` hits. */
    autoMiss: number;
    autoHit: number;
    /** A threat needs a confirming roll to be a critical. */
    confirm: boolean;
    /** The ability whose modifier damage shares, and the share by how the weapon is held (a weapons row's `held`). */
    strength: string;
    strengthShare: Record<string, number>;
    /** Each range increment past the first takes this from the roll; the most increments by how the weapon is used. */
    incrementPenalty: number;
    increments: { thrown: number; projectile: number };
    /** Added to the roll with a weapon its wielder is not proficient with. */
    unskilled: number;
    /** Added to the roll to deal nonlethal harm with a lethal weapon, or lethal with a nonlethal one. */
    nonlethal: number;
    /** Added to a lesser attack's roll beside the first. */
    secondary: number;
    /** Further attacks a high base attack gives: from a base of `from`, one more each `step` lower, while the base stays at `from` or more. */
    iterative: { from: number; step: number };
    /** The totals an attack reads: its base (for further attacks), the melee and ranged rolls, and what modifies damage. */
    totals: { base: string; melee: string; ranged: string; damage: string };
    /** The shots a weapon that fires can make, by name (`single`, `double`, `burst`, `auto`). */
    shots: Record<string, ShotDef>;
  };
  hp: {
    /** The hit points' gauge (a pool field of every kind in `kinds`), nonlethal harm, and temporary hit points. */
    field: FieldId;
    nonlethal: FieldId;
    temporary: FieldId;
    /** Read top to bottom after any change: each that holds is put on, each that no longer holds is taken off. */
    states: HpStateDef[];
    /** What a turn in a fight does to a dying creature: it loses `lose` unless `roll` passes, which puts `stable` on it. */
    dying: { state: string; lose: number; stable: string; roll: CheckDef } | null;
    /** Massive harm: an amount for which `when` holds (with `amount`) asks for `save` against `dc`; a failure sets the hit points to `hp`. */
    massive: { when: Expr; save: string; dc: number | Expr; hp: Expr } | null;
    /** A night's rest: its hours, the hit points it gives back (a formula with `self`), the nonlethal harm an hour takes off, and the gauges it fills. */
    rest: { hours: number; hp: Expr; nonlethal: Expr; daily: FieldId[] };
  };
  /**
   * What each action spends of a fight's budgets (`ruleset.combat.economy`) when its doer is in a fight, by the action's id, and
   * `attack.full` for all the attacks a high base attack gives (§5.3). An action not named spends nothing.
   */
  costs?: Record<string, Record<string, number>>;
  levels: {
    /** The progression of `ruleset.progression` that holds experience and the total level. */
    progression: ProgressionId;
    /** How a level's die is kept: rolled, its average (`average`, a formula with `die`), or its most; the first level's at its most where `firstMost`. */
    hitPoints: "roll" | "average" | "most";
    average: Expr;
    firstMost: boolean;
    /** The most ranks a skill takes: a formula with `self` and `skill`. */
    rankLimit: Expr;
    /** Skill points a level: the class's, plus `plus` (a formula with `self`), at least `min`; the first level's times `first`. */
    skillPoints: { plus: Expr; min: number; first: number };
    /** A feat at the first level and each `featEvery`; an ability point each `abilityEvery`. Both told as open, never chosen. */
    featEvery: number;
    abilityEvery: number;
    /** Experience as the GM gives it (`table`), or worked out from what was overcome (`challenge`). */
    experienceBy: "table" | "challenge";
  };
}

// ---------------------------------------------------------------- the tables' columns

const text = (optional = false, doc?: string): ColumnDef => ({ type: "text", ...(optional ? { optional } : {}), ...(doc !== undefined ? { doc } : {}) });
const int = (optional = false, doc?: string): ColumnDef => ({ type: "int", ...(optional ? { optional } : {}), ...(doc !== undefined ? { doc } : {}) });
const json = (optional = false, doc?: string): ColumnDef => ({ type: "json", ...(optional ? { optional } : {}), ...(doc !== undefined ? { doc } : {}) });
const texts = (optional = false, doc?: string): ColumnDef => ({ type: "list", of: "text", ...(optional ? { optional } : {}), ...(doc !== undefined ? { doc } : {}) });
const bool = (optional = false, doc?: string): ColumnDef => ({ type: "bool", ...(optional ? { optional } : {}), ...(doc !== undefined ? { doc } : {}) });

/**
 * Each role's columns (§4.2): what a row of that table holds. A world's table of a role has these columns, and may have more; the
 * lint holds a ruleset's tables to them. A `tracks` table holds one number column for each track its classes name, besides these.
 */
export const D20_COLUMNS: Readonly<Record<D20TableRole, Record<string, ColumnDef>>> = {
  skills: {
    label: text(),
    ability: text(false, "The ability whose modifier the skill adds"),
    trained: bool(true, "Used only by those with a rank in it"),
    armor: bool(true, "Armour's check penalty applies"),
  },
  classes: {
    label: text(),
    hit_die: int(false, "Sides of the die each level of it rolls for hit points"),
    tracks: json(false, "The tracks table's column each progression reads: attack, each save, and any more a ruleset names"),
    skill_points: int(false, "Skill points each level, before the ruleset adds its own share"),
    class_skills: texts(true, "The skills rows that are its class skills"),
    proficiency: texts(true, "What its levels make its wielder proficient with: a weapons row's proficiency or the row itself"),
    features: json(true, "The traits rows each level gives, by level"),
  },
  tracks: {},
  traits: {
    label: text(),
    kind: text(false, "What it is: a feat, a race, a class feature, a template"),
    text: text(true, "What it does, in words"),
    modifiers: json(true, "Its modifiers"),
    grants: json(true, "What it grants besides: proficiency, class skills, a gauge's size"),
    requires: text(true, "A formula with self that should hold to take it: reported, never enforced"),
  },
  conditions: {
    label: text(),
    text: text(true, "What it does, in words"),
    modifiers: json(true, "Its modifiers"),
    flags: texts(true, "What holds while under it, as the procedures read them"),
  },
  sizes: {
    label: text(),
    order: int(false, "Its place from the smallest, for damage by size"),
    modifiers: json(true, "Its modifiers"),
  },
  weapons: {
    label: text(),
    damage: json(false, "Its damage dice by its wielder's size, or one notation for all"),
    threat: int(false, "The lowest natural die that threatens a critical"),
    multiplier: int(false, "What a critical multiplies its damage by"),
    range: int(true, "Its range increment, in the world's units"),
    proficiency: text(false, "What it takes to be proficient with it"),
    held: text(false, "How it is held or used: light, one, two, thrown, projectile"),
    types: texts(true, "Its damage types"),
    nonlethal: bool(true, "Its harm is nonlethal"),
    fire: texts(true, "The fire modes a weapon that fires has"),
    magazine: int(true, "Rounds its magazine holds"),
    area: int(true, "An area weapon's burst: its radius, in the world's units"),
    save: json(true, "The save of those in its area: {save, dc, half}"),
    modifiers: json(true, "Its own modifiers"),
  },
  armor: {
    label: text(),
    bonus: int(false, "What it adds to defence"),
    type: text(false, "The bonus's type: armour or shield"),
    max_dex: int(true, "The most of the Dexterity modifier that still counts to defence"),
    check: int(true, "Its check penalty, a number of 0 or less"),
    modifiers: json(true, "Its own modifiers besides"),
  },
  creatures: {
    name: text(),
    kind: text(),
    tier: text(true),
    fields: json(false, "The sheet's values, by field"),
    attacks: json(true, "Its own attacks"),
    cr: text(true, "Its challenge rating, a row of the challenges table"),
    carries: texts(true),
    description: text(true),
  },
  experience: {
    xp: int(false, "The experience the level needs; a ruleset with several tracks names its columns in `levels`"),
  },
  challenges: {
    xp: int(true, "What overcoming it is worth, shared among those who did"),
    by_level: json(true, "What it is worth to each who overcame it, by their level"),
  },
  difficulties: {
    label: text(),
    dc: int(),
    text: text(true),
  },
};

/** A table of a role's schema string (`DataTable.schema`). */
export function d20Schema(role: D20TableRole): string {
  return `lre-table/d20.${role}/v1`;
}

// ---------------------------------------------------------------- functions, actions, records

/** The formula functions the pack adds (§4.4), with their arguments: the authors' reference and Build's expression editor list them. */
export const D20_FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
  score: ["who", "ability"],
  mod: ["who", "ability"],
  bonus: ["who", "to"],
  bonus_without: ["who", "to", "types"],
  bonus_only: ["who", "to", "types"],
  limit: ["who", "name", "otherwise?"],
  levels: ["who"],
  class_level: ["who", "class"],
  class_sum: ["who", "track"],
  hit_dice: ["who"],
  ranks: ["who", "skill"],
  class_skill: ["who", "skill"],
  total: ["who", "name", "key?"],
  has_trait: ["who", "trait"],
  under: ["who", "condition"],
  size_mod: ["who", "to"],
  rest_minutes: ["hours?"],
};

/** The actions the pack registers (§5.1), each carried out by `act`. `d20_rest` because castlife's `rest` is the plain word. */
export const D20_ACTIONS = ["check", "save", "attack", "harm", "heal", "condition", "effect", "d20_rest", "reload", "award", "advance", "trait", "ranks", "stat_as"] as const;
export type D20ActionId = (typeof D20_ACTIONS)[number];

/** The records the pack's actions make: each says in words what was worked out and where its numbers came from. */
export const D20_EVENTS = {
  check: "d20.check",
  save: "d20.save",
  attack: "d20.attack",
  harm: "d20.harm",
  heal: "d20.heal",
  condition: "d20.condition",
  effect: "d20.effect",
  rest: "d20.rest",
  reload: "d20.reload",
  award: "d20.award",
  advance: "d20.advance",
  trait: "d20.trait",
  ranks: "d20.ranks",
  statAs: "d20.stat_as",
  /** What hit points put a creature in, or took it out of (§4.5). */
  state: "d20.state",
  /** What a fight's turn or the clock did of itself: a dying creature's point, a length run out (§4.5). */
  upkeep: "d20.upkeep",
} as const;
