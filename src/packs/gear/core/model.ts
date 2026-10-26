// Gear model (DESIGN §9.2, §9.3): containment, loads, kits as a template plus overrides, and use
// grants. Pure functions over the state; the services and effects in index.ts turn them into events.
//
// Representation (uniform at every level):
//   - an item is `in` its holder (a person, a container, a vehicle) or lies at a `place`;
//   - worn and equipped items are also `in` their wearer, plus a `worn_by`/`equipped` relation;
//   - a kit is a container with a `kit` row id and a `taken` map {piece name: count}; taking a
//     piece creates one override item (`piece`, `from_kit`), and completeness is derived;
//   - a use grant is a `uses` relation from the borrower to the thing, with `until`; the thing is
//     flagged `overdue` once the grant has expired.

import type { JsonObject } from "../../../shared/json";
import { fixedReason, type FixedReason } from "../../../shared/items-build";
import type { EntityId, KindId } from "../../../shared/ids";
import type { WorldDoc } from "../../../shared/world";
import type { ReadContext } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { numOf, objOf, strOf, own, rowOf } from "../../../engine/pack-kit";
import { kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";

export function holderOf(state: Readonly<WorldState>, id: EntityId): EntityId | null {
  return own(state.entities, id)?.relations.find((r) => r.type === "in")?.to ?? null;
}

/** Things directly `in` a holder, by id. */
export function contentsOf(state: Readonly<WorldState>, holder: EntityId): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.relations.some((r) => r.type === "in" && r.to === holder))
    .sort();
}

/** Whether `inner` is (transitively) inside `outer`. */
export function isInside(state: Readonly<WorldState>, inner: EntityId, outer: EntityId): boolean {
  let cur: EntityId | null = holderOf(state, inner);
  for (let guard = 0; cur && guard < 64; guard++) {
    if (cur === outer) return true;
    cur = holderOf(state, cur);
  }
  return false;
}

/** Everything a holder carries, transitively, depth first in id order. */
export function carriedBy(state: Readonly<WorldState>, holder: EntityId): EntityId[] {
  const out: EntityId[] = [];
  const visit = (h: EntityId, depth: number): void => {
    if (depth > 32) return;
    for (const id of contentsOf(state, h)) {
      out.push(id);
      visit(id, depth + 1);
    }
  };
  visit(holder, 0);
  return out;
}

/** Weight in grams of a thing and its contents. */
export function weightOf(state: Readonly<WorldState>, id: EntityId): number {
  const e = own(state.entities, id);
  if (!e) return 0;
  const bare = numOf(e.fields.weight_g) * Math.max(1, numOf(e.fields.qty, 1));
  return bare + contentsOf(state, id).reduce((a, c) => a + weightOf(state, c), 0);
}

/** Volume in liters a thing takes up inside a container (its own volume, contents included in it). */
export function volumeOf(state: Readonly<WorldState>, id: EntityId): number {
  const e = own(state.entities, id);
  return e ? numOf(e.fields.volume_l) * Math.max(1, numOf(e.fields.qty, 1)) : 0;
}

export interface Load {
  usedL: number;
  capacityL: number | null;
  usedKg: number;
  maxKg: number | null;
}

export function loadOf(state: Readonly<WorldState>, container: EntityId): Load {
  const e = own(state.entities, container);
  const items = contentsOf(state, container);
  return {
    usedL: items.reduce((a, i) => a + volumeOf(state, i), 0),
    capacityL: typeof e?.fields.capacity_l === "number" ? e.fields.capacity_l : null,
    usedKg: items.reduce((a, i) => a + weightOf(state, i), 0) / 1000,
    maxKg: typeof e?.fields.max_load_kg === "number" ? e.fields.max_load_kg : null,
  };
}

/** Why `item` can't go into `container` (capacity, load, a cycle), or null when it fits. */
export function fitProblem(state: Readonly<WorldState>, item: EntityId, container: EntityId): string | null {
  if (item === container || isInside(state, container, item)) return "can't put something inside itself";
  const load = loadOf(state, container);
  if (load.capacityL !== null && load.usedL + volumeOf(state, item) > load.capacityL + 1e-9) return "doesn't fit";
  if (load.maxKg !== null && load.usedKg + weightOf(state, item) / 1000 > load.maxKg + 1e-9) return "too heavy for it";
  return null;
}

// ---------------------------------------------------------------- what holds what

/** Why a thing can't be picked up and carried (`fixedReason`: a vehicle, a built-in part, a fixed thing), or null. */
export function fixedOf(ctx: ReadContext, id: EntityId): FixedReason | null {
  const e = own(ctx.state.entities, id);
  return e ? fixedReason(kindIs(ctx.registry, ctx.world, e.kind, "vehicle"), e.fields, ctx.world.tables) : null;
}

/** What a kind of thing holds as (DESIGN §7): a person carries, a vehicle and a container (a bag, a safe, a kit) hold; any other kind holds nothing. */
export function kindHoldsAs(reg: Registry, world: WorldDoc, kind: KindId): "person" | "vehicle" | "container" | null {
  if (kindIs(reg, world, kind, "person")) return "person";
  if (kindIs(reg, world, kind, "vehicle")) return "vehicle";
  return kindIs(reg, world, kind, "container") ? "container" : null;
}

/** What a thing holds as, by its kind (`kindHoldsAs`); null for no such thing. */
export function holdsAs(ctx: ReadContext, id: EntityId): "person" | "vehicle" | "container" | null {
  const e = own(ctx.state.entities, id);
  return e ? kindHoldsAs(ctx.registry, ctx.world, e.kind) : null;
}

/**
 * Where a kind of thing may be put (DESIGN §7), before what one of them is fixed to: inside anything
 * that holds (a thing, or the one money record a holder carries, a cash account); only in a vehicle
 * (a person riding, a vehicle carried on another); or nowhere (what isn't a thing: a job, a flow, a group).
 */
export function kindGoesIn(reg: Registry, world: WorldDoc, kind: KindId): "any" | "vehicle" | "nowhere" {
  if (kindIs(reg, world, kind, "person") || kindIs(reg, world, kind, "vehicle")) return "vehicle";
  return kindIs(reg, world, kind, "item") || kind === "account" ? "any" : "nowhere";
}

/** Where a thing may be put: as its kind goes (`kindGoesIn`), and nowhere once it stays put (a built-in part, a fixed thing: `fixedOf`). */
export function goesIn(ctx: ReadContext, id: EntityId): "any" | "vehicle" | "nowhere" {
  const e = own(ctx.state.entities, id);
  if (!e) return "nowhere";
  const goes = kindGoesIn(ctx.registry, ctx.world, e.kind);
  return goes === "any" && fixedOf(ctx, id) !== null ? "nowhere" : goes;
}

/** Why `holder` can't hold `thing`, in words, or null when it can: what holds and what goes where (`holdsAs`, `goesIn`). */
export function holdProblem(ctx: ReadContext, thing: EntityId, holder: EntityId): string | null {
  const e = own(ctx.state.entities, thing);
  const h = own(ctx.state.entities, holder);
  if (!e || !h) return null;
  const as = holdsAs(ctx, holder);
  if (as === null) return `${h.name} can't hold anything`;
  const goes = goesIn(ctx, thing);
  const fixed = fixedOf(ctx, thing);
  if (goes === "nowhere") return fixed === "part" ? `${e.name} is built into what holds it` : fixed === "fixed" ? `${e.name} is fixed in place` : `${e.name} isn't a thing that goes inside anything`;
  if (goes === "vehicle" && as !== "vehicle") return fixed === "vehicle" ? `${e.name} is a vehicle: it can only be carried on another vehicle` : `${e.name} can only ride in a vehicle`;
  return null;
}

// ---------------------------------------------------------------- kits

export interface KitPiece {
  name: string;
  qty: number;
  weightG: number;
}

export interface KitStatus {
  present: number;
  total: number;
  complete: boolean;
  /** `name ×n` for pieces short of their template quantity. */
  missing: string[];
  pieces: { name: string; present: number; qty: number }[];
}

/** A kit's template: inline `pieces` [{name, qty}] (with `piece_count`), else its `kit` row of `gear.kits`. */
export function kitTemplate(ctx: Pick<ReadContext, "tables" | "state">, kit: EntityId): { name: string; pieces: KitPiece[]; total: number } | null {
  const f = own(ctx.state.entities, kit)?.fields;
  if (!f) return null;
  const row = Array.isArray(f.pieces) ? f : rowOf(ctx, "gear.kits", strOf(f.kit));
  if (!row) return null;
  const pieces: KitPiece[] = [];
  if (Array.isArray(row.pieces)) {
    for (const p of row.pieces) {
      const o = objOf(p);
      pieces.push({ name: strOf(o.name), qty: numOf(o.qty, 1), weightG: numOf(o.weight_g_each) });
    }
  }
  const total = typeof row.piece_count === "number" ? row.piece_count : pieces.reduce((a, p) => a + p.qty, 0);
  return { name: strOf(row.name, own(ctx.state.entities, kit)?.name ?? kit), pieces, total };
}

/** Taken counts by piece name. */
export function takenOf(state: Readonly<WorldState>, kit: EntityId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(objOf(own(state.entities, kit)?.fields.taken))) if (typeof v === "number") out[k] = v;
  return out;
}

/** Completeness, derived: template − taken + override pieces currently back in the kit. */
export function kitStatus(ctx: Pick<ReadContext, "tables" | "state">, kit: EntityId): KitStatus | null {
  const e = own(ctx.state.entities, kit);
  const template = e ? kitTemplate(ctx, kit) : null;
  if (!template) return null;
  const taken = takenOf(ctx.state, kit);
  const back: Record<string, number> = {};
  for (const id of contentsOf(ctx.state, kit)) {
    const item = own(ctx.state.entities, id);
    if (item?.fields.from_kit === kit && typeof item.fields.piece === "string") back[item.fields.piece] = (own(back, item.fields.piece) ?? 0) + Math.max(1, numOf(item.fields.qty, 1));
  }
  const pieces = template.pieces.map((p) => ({ name: p.name, qty: p.qty, present: Math.max(0, p.qty - (own(taken, p.name) ?? 0) + (own(back, p.name) ?? 0)) }));
  const present = template.total - template.pieces.reduce((a, p) => a + p.qty, 0) + pieces.reduce((a, p) => a + p.present, 0);
  const missing = pieces.filter((p) => p.present < p.qty).map((p) => `${p.name} ×${p.qty - p.present}`);
  return { present, total: template.total, complete: missing.length === 0, missing, pieces };
}

const PIECE_FILLER = new Set(["a", "an", "the", "of", "my", "your", "some", "one", "set", "and", "with"]);

/** A name's words for piece matching: lowercase letters and digits, filler dropped, plurals singular. */
function pieceWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !PIECE_FILLER.has(w))
    .map((w) => (/(?:ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * The template piece a free-text name refers to: an exact name, else the first containing it, else
 * the piece holding the most of its words, in any order ("metric combination wrench", "combination
 * wrench, metric (the 13 mm)"). Half the said words must be in the name, one of them not a number.
 * Ties go to the shorter name, then template order.
 */
export function findPiece(ctx: Pick<ReadContext, "tables" | "state">, kit: EntityId, name: string): KitPiece | null {
  const template = kitTemplate(ctx, kit);
  if (!template) return null;
  const lower = name.trim().toLowerCase();
  if (lower === "") return null;
  const direct = template.pieces.find((p) => p.name.toLowerCase() === lower) ?? template.pieces.find((p) => p.name.toLowerCase().includes(lower));
  if (direct) return direct;
  const said = [...new Set(pieceWords(name))];
  if (said.length === 0) return null;
  let best: { piece: KitPiece; hits: number; size: number } | null = null;
  for (const piece of template.pieces) {
    const words = new Set(pieceWords(piece.name));
    const hit = said.filter((w) => words.has(w));
    if (hit.length * 2 < said.length || !hit.some((w) => /[a-z]/.test(w))) continue;
    if (!best || hit.length > best.hits || (hit.length === best.hits && words.size < best.size)) best = { piece, hits: hit.length, size: words.size };
  }
  return best?.piece ?? null;
}

// ---------------------------------------------------------------- use grants

export interface Grant {
  thing: EntityId;
  borrower: EntityId;
  owner: EntityId | null;
  until: number | null;
  overdue: boolean;
}

/** Every use grant (`uses` from borrower to thing), in borrower then thing order. */
export function grants(state: Readonly<WorldState>): Grant[] {
  const out: Grant[] = [];
  for (const borrower of Object.keys(state.entities).sort()) {
    for (const r of own(state.entities, borrower)?.relations ?? []) {
      if (r.type !== "uses") continue;
      const thing = own(state.entities, r.to);
      if (!thing) continue;
      const owner = typeof thing.fields.owner === "string" ? thing.fields.owner : null;
      out.push({ thing: r.to, borrower, owner, until: r.until ?? null, overdue: r.until !== undefined && r.until <= state.clock });
    }
  }
  return out;
}

/** Things lent out by `owner` whose grants have expired: the owner's retrieval tasks. */
export function overdueFor(state: Readonly<WorldState>, owner: EntityId): Grant[] {
  return grants(state).filter((g) => g.owner === owner && g.overdue);
}

// ---------------------------------------------------------------- has_item

/** Whether `holder` carries (transitively) a thing matching `what`: a kind (with inheritance), a catalog id, a category or a name. */
export function hasItem(ctx: ReadContext, holder: EntityId, what: string): boolean {
  const lower = what.toLowerCase();
  for (const id of carriedBy(ctx.state, holder)) {
    const e = own(ctx.state.entities, id);
    if (!e) continue;
    if (kindIs(ctx.registry, ctx.world, e.kind, what)) return true;
    const f: JsonObject = e.fields;
    if (f.catalog === what || f.category === what || e.name.toLowerCase().includes(lower)) return true;
    if (typeof f.kit === "string" || Array.isArray(f.pieces)) {
      const status = kitStatus(ctx, id);
      if (status?.pieces.some((p) => p.present > 0 && p.name.toLowerCase().includes(lower))) return true;
    }
  }
  return false;
}
