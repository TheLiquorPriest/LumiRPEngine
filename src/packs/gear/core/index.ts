// Gear & containers pack (DESIGN §9.3): own, hold, wear and store; equip slots; containers with
// volume and load limits; stacks; kits as template plus overrides; condition, wear, consumables;
// use grants (lending) with overdue semantics.
//
// Level contract (domain `gear`):
//   0  off: transfers are no-ops; nothing renders
//   1  notable items only render (transfers still apply: the data is uniform)
//   2  items, containers (volume/load limits), stacks; cash lives in a wallet
//   3  worn and equipped slots, kits, condition
//   4  wear per use, consumables
//
// Services: gear.transfer, gear.drop, gear.give, gear.spawn, gear.take_piece, gear.lend,
// gear.retrieve. Queries: has_item, gear.kit_status, gear.overdue.

import type { JsonObject, JsonValue } from "../../../shared/json";
import { hasOwn } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import { hashParts } from "../../../shared/hash";
import type { LedgerEvent } from "../../../shared/ledger";
import type { DataTable } from "../../../shared/tables";
import type { EffectSpec, EntityDef, KindDef, WorldCurrency, WorldDoc } from "../../../shared/world";
import { calendarOf, clockOfPhrase } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { bump, labelOf, numOf, optionalService, strOf, own, rowOf } from "../../../engine/pack-kit";
import type { FeedLine, PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { effectLists } from "../../../engine/ruleset-lint";
import { fieldDef, GONE_FIELD, isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { carriedBy, contentsOf, findPiece, fitProblem, fixedOf, goesIn, grants, hasItem, holderOf, holdProblem, holdsAs, isInside, kindGoesIn, kindHoldsAs, kitStatus, overdueFor, takenOf, weightOf, type Grant, type KitStatus } from "./model";
import { canSeeEntity, isDiscoverable, knows } from "../../../engine/visibility";
import { together } from "../../../engine/presence";
import type { FeedScope } from "../../../shared/world";
import type { EntityState } from "../../../engine/state";
import { buildGearView } from "./view";
import containers from "./tables/modern-us/containers.json";
import items from "./tables/modern-us/items.json";
import kits from "./tables/modern-us/kits.json";
import slots from "./tables/modern-us/slots.json";

/** What a thing reads as in a gear line: its name, a count above one, and from Gear 3 a kit's pieces present. */
function gearLabel(ctx: ReadContext, id: EntityId, level: number): string {
  const e = own(ctx.state.entities, id);
  if (!e) return id;
  const qty = numOf(e.fields.qty, 1);
  const kit = level >= 3 ? kitStatus(ctx, id) : null;
  return `${e.name}${qty > 1 ? ` ×${qty}` : ""}${kit ? ` (${kit.present} of its ${kit.total} pieces)` : ""}`;
}

/** What a holder wears or has equipped. */
function wornBy(ctx: ReadContext, who: EntityId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => own(ctx.state.entities, id)?.relations.some((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who));
}

/** Where a worn or equipped thing is on its holder, as a gear line groups it: a pocket isn't something worn. */
function wornAs(ctx: ReadContext, id: EntityId, who: EntityId): "pockets" | "hand" | "worn" {
  const r = own(ctx.state.entities, id)?.relations.find((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who);
  const slot = typeof r?.fields?.slot === "string" ? r.fields.slot : "";
  return slot === "pocket" || slot === "pocket_or_bag" ? "pockets" : r?.type === "equipped" || slot === "hand_held" ? "hand" : "worn";
}

/** The lead of each group of worn or equipped things in a Gear line. */
const WORN_LEAD: Record<"pockets" | "hand" | "worn", string> = { pockets: "In your pockets", hand: "In your hands", worn: "Wearing" };

/**
 * The Gear section (DESIGN §6, §6.11): what the POV carries (only notable things at Gear 1), from
 * Gear 3 what it wears, and what it has lent and borrowed; only what it can see. In `gm` scope,
 * something it carries without knowing (a thing planted on it) is added, marked.
 */
export function gearLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  const level = ctx.levelOf(pov, "gear");
  if (level === 0) return [];
  const see = (id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id);
  const carried = carriedBy(ctx.state, pov).filter((id) => own(ctx.state.entities, id)?.kind !== "account");
  // From Gear 3, what is worn, in a pocket or in hand is told where it is, and not again as carried.
  const worn = level >= 3 ? wornBy(ctx, pov).filter(see) : [];
  const shown = carried.filter((id) => see(id) && !worn.includes(id) && (level >= 2 || own(ctx.state.entities, id)?.fields.notable === true));
  const lines: FeedLine[] = [];
  for (const as of ["worn", "pockets", "hand"] as const) {
    const here = worn.filter((id) => wornAs(ctx, id, pov) === as);
    if (here.length > 0) lines.push({ text: `${WORN_LEAD[as]}: ${here.map((id) => gearLabel(ctx, id, level)).join(", ")}.`, known: "pov" });
  }
  if (shown.length > 0) lines.push({ text: `${worn.length > 0 ? "Also carrying" : "Carrying"}: ${shown.slice(0, 12).map((id) => gearLabel(ctx, id, level)).join(", ")}.`, known: "pov" });
  for (const g of grants(ctx.state)) {
    if (!see(g.thing)) continue;
    if (g.owner === pov) lines.push({ text: `You lent ${own(ctx.state.entities, g.thing)?.name ?? g.thing} to ${see(g.borrower) ? (own(ctx.state.entities, g.borrower)?.name ?? g.borrower) : "someone"}${g.overdue ? " (overdue: it should have come back by now)" : ""}.`, known: "pov" });
    else if (g.borrower === pov) lines.push({ text: `You borrowed ${own(ctx.state.entities, g.thing)?.name ?? g.thing}${g.overdue ? " (overdue: it should go back)" : ""}.`, known: "pov" });
  }
  if (scope === "gm") {
    const unknown = [...carried, ...wornBy(ctx, pov)].filter((id) => !see(id));
    if (unknown.length > 0) lines.push({ text: `On you without your knowing: ${unknown.map((id) => gearLabel(ctx, id, level)).join(", ")}.`, known: "gm" });
  }
  return lines;
}

/** At most this many things are told of each person with the POV. */
const PRESENT_GEAR_CAP = 6;

/**
 * The authored effects that move a thing through `transfer`, by the argument naming what they move
 * and the one naming what it goes into. A kit's piece comes from the kit (`gear.take_piece`), so it
 * names no thing; one the world puts in a kit is among the world's contents.
 */
const MOVES: Record<string, { thing?: string; into: string }> = { "gear.transfer": { thing: "item", into: "to" }, "gear.give": { thing: "item", into: "to" }, "gear.take_piece": { into: "to" } };

/**
 * The kinds of the world's own that it moves things of, and that it moves things into (DESIGN §7):
 * each thing it puts inside another entity, and each authored move (`MOVES`). Each kind keeps its
 * first case, in words. An argument names an action's parameter when one has the name, a binding
 * winning as `evalArg` reads it (its kind), else an entity (its own kind).
 */
function authoredMoves(world: WorldDoc): { things: Map<string, string>; holders: Map<string, string> } {
  const things = new Map<string, string>();
  const holders = new Map<string, string>();
  const note = (into: Map<string, string>, kind: string | undefined, why: string): void => {
    if (kind !== undefined && own(world.kinds, kind) && !into.has(kind)) into.set(kind, why);
  };
  for (const e of Object.values(world.entities)) {
    for (const rel of e.relations) {
      const holder = rel.type === "in" ? own(world.entities, rel.to) : undefined;
      if (!holder) continue;
      note(holders, holder.kind, `${holder.name} holds ${e.name}`);
      note(things, e.kind, `${holder.name} holds ${e.name}`);
    }
  }
  for (const { path, effects } of effectLists(world)) {
    const action = path.startsWith("actions.") ? own(world.actions, path.split(".")[1] ?? "") : undefined;
    const named = (arg: JsonValue | undefined): { kind: string | undefined; words: string } | null => {
      if (typeof arg !== "string" || arg.startsWith("=")) return null;
      const param = action ? own(action.params, arg) : undefined;
      if (param) return { kind: param.type === "ref" ? param.ref : undefined, words: `its ${param.label ?? arg}` };
      const e = own(world.entities, arg);
      return { kind: e?.kind, words: e?.name ?? arg };
    };
    for (const spec of effects) {
      const move = hasOwn(MOVES, spec.type) ? MOVES[spec.type] : undefined;
      if (!move) continue;
      const by = action?.label ?? path;
      const into = named(spec.args?.[move.into]);
      if (into) note(holders, into.kind, `${by} gives things to ${into.words}`);
      const thing = move.thing === undefined ? null : named(spec.args?.[move.thing]);
      if (thing) note(things, thing.kind, `${by} moves ${thing.words}`);
    }
  }
  return { things, holders };
}

/**
 * What each person with the POV that it can see visibly wears and carries (DESIGN §6.11): worn and
 * equipped things and what they hold in hand, never what is in a bag or a pocket. Only what the POV
 * can see. In `scene` scope, a thing on them the POV can't see but they can (by the visibility rules,
 * so never a secret one), marked as theirs to know; in `gm`, any other thing on them too.
 */
export function presentGearLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const pov = ctx.world.pov;
  if (ctx.levelOf(pov, "gear") === 0) return [];
  const see = (who: EntityId, id: EntityId): boolean => canSeeEntity(ctx.registry, ctx.world, ctx.state, who, id);
  const here = placeOfEntity(ctx.state, pov);
  const lines: FeedLine[] = [];
  for (const who of Object.keys(ctx.state.entities).sort()) {
    const person = own(ctx.state.entities, who);
    if (!person || who === pov || !kindIs(ctx.registry, ctx.world, person.kind, "person") || isGone(ctx.state, who) || !see(pov, who) || !together(ctx.world, here, placeOfEntity(ctx.state, who))) continue;
    const level = Math.max(1, ctx.levelOf(who, "gear"));
    const worn = wornBy(ctx, who);
    const held = contentsOf(ctx.state, who).filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && e.kind !== "account" && e.fields.slot !== "pocket" && !worn.includes(id);
    });
    const say = (ids: readonly EntityId[]): string => ids.slice(0, PRESENT_GEAR_CAP).map((id) => gearLabel(ctx, id, level)).join(", ");
    const wornSeen = worn.filter((id) => see(pov, id));
    const heldSeen = held.filter((id) => see(pov, id)).slice(0, Math.max(0, PRESENT_GEAR_CAP - wornSeen.length));
    const parts = [...(wornSeen.length > 0 ? [`wears ${say(wornSeen)}`] : []), ...(heldSeen.length > 0 ? [`carries ${say(heldSeen)}`] : [])];
    if (parts.length > 0) lines.push({ text: `${person.name} ${parts.join("; ")}.`, known: "pov" });
    if (scope === "player") continue;
    const hidden = [...worn, ...held].filter((id) => !see(pov, id));
    const theirs = hidden.filter((id) => see(who, id));
    const gms = hidden.filter((id) => !see(who, id));
    if (theirs.length > 0) lines.push({ text: `${person.name} has ${say(theirs)}.`, known: "scene", who: person.name });
    if (scope === "gm" && gms.length > 0) lines.push({ text: `${person.name} has ${say(gms)}.`, known: "gm" });
  }
  return lines;
}

const TABLES: DataTable[] = [items, containers, kits, slots] as unknown as DataTable[];

/** A narrated quantity change's largest step when the item kind's `qty` field has no bound. */
const QTY_MAX_DELTA = 10;

export interface GearSpawn {
  name: string;
  owner: EntityId | null;
  /** Holder (`in`), or a place when none. */
  holder?: EntityId | null;
  place?: PlaceId | null;
  catalog?: string;
  category?: string;
  qty?: number;
  kind?: "item" | "container";
  /** Disambiguates spawns that share every other input. */
  salt?: string;
  /** A bought or received thing joins a matching stack its holder has (DESIGN §9.4 stacking) rather than making another. */
  stack?: boolean;
}

/** A thing the player says they have, made real for their action (DESIGN §9.4 player claims). */
export interface GearClaim {
  name: string;
  /** Who claims it: it is theirs, in their hands (`held`), or lies where they are (`here`). */
  by: EntityId;
  at: "held" | "here";
  kind: string;
  /** The economy catalog row that prices it, and its price category. */
  catalog?: string;
  category?: string;
  consumable: boolean;
  /** A gear item or container row it takes its weight, size and wear slot from. */
  like?: string;
  /** The claimer's own thing the world had elsewhere: brought to hand (or where they are) instead of made. */
  existing?: EntityId;
  /** The turn's seed and the action's place in it: the id's source, never the name alone. */
  salt: string;
}

type Events = LedgerEvent[] | Rejection;

declare module "../../../engine/registry" {
  interface ServiceMap {
    "gear.transfer": (ctx: ReadContext, item: EntityId, to: EntityId) => LedgerEvent[] | Rejection;
    "gear.drop": (ctx: ReadContext, item: EntityId, place: PlaceId) => LedgerEvent[] | Rejection;
    "gear.give": (ctx: ReadContext, item: EntityId, from: EntityId, to: EntityId) => LedgerEvent[] | Rejection;
    "gear.spawn": (ctx: ReadContext, spec: GearSpawn) => LedgerEvent[] | Rejection;
    "gear.claim": (ctx: ReadContext, claim: GearClaim) => { entity: EntityId; events: LedgerEvent[] } | Rejection;
    "gear.take_piece": (ctx: ReadContext, kit: EntityId, piece: string, to: EntityId) => LedgerEvent[] | Rejection;
    "gear.lend": (ctx: ReadContext, thing: EntityId, to: EntityId, until: number) => LedgerEvent[] | Rejection;
    "gear.retrieve": (ctx: ReadContext, thing: EntityId) => LedgerEvent[] | Rejection;
  }
  interface QueryMap {
    has_item: (ctx: ReadContext, holder: EntityId, what: string) => boolean;
    "gear.kit_status": (ctx: ReadContext, kit: EntityId) => KitStatus | null;
    "gear.overdue": (ctx: ReadContext, owner: EntityId) => Grant[];
    /** Why `holder` can't hold `thing` (DESIGN §7 containment), in words, or null when it can. */
    "gear.hold_problem": (ctx: ReadContext, thing: EntityId, holder: EntityId) => string | null;
    /** What a thing holds as, and where it may be put (DESIGN §7 containment). */
    "gear.containment": (ctx: ReadContext, id: EntityId) => { holds: "person" | "vehicle" | "container" | null; goes: "any" | "vehicle" | "nowhere" };
  }
}

export const ITEM: KindDef = {
  id: "item",
  label: "Item",
  extends: "thing",
  pack: "gear",
  fields: {
    notable: { type: "bool", label: "Notable", domain: "gear", level: 1 },
    qty: { type: "number", label: "Quantity", default: 1, min: 0, domain: "gear", level: 2, bound: { mode: "confirm", maxDelta: 10 } },
    weight_g: { type: "number", label: "Weight (g)", min: 0, domain: "gear", level: 2 },
    volume_l: { type: "number", label: "Volume (l)", min: 0, domain: "gear", level: 2 },
    catalog: { type: "text", label: "Catalog item", table: "economy.catalog" },
    category: { type: "text", label: "Category" },
    slot: { type: "text", label: "Equip slot", domain: "gear", level: 3 },
    condition: { type: "number", label: "Condition", default: 100, min: 0, max: 100, domain: "gear", level: 3, bands: [{ label: "broken", max: 10 }, { label: "worn", min: 10, max: 50 }, { label: "good", min: 50, max: 90 }, { label: "like new", min: 90 }], bound: { mode: "auto", maxDelta: 25 } },
    consumable: { type: "bool", label: "Consumable", domain: "gear", level: 4 },
    uses: { type: "number", label: "Uses left", min: 0, domain: "gear", level: 4 },
    overdue: { type: "bool", label: "Overdue", locked: true },
    piece: { type: "text", label: "Kit piece", locked: true },
    from_kit: { type: "ref", label: "From kit", locked: true },
    // Something built in or too big to lift (a mill stone, an installed relay): nobody picks it up or puts it anywhere (DESIGN §7).
    fixed: { type: "bool", label: "Fixed in place (can't be picked up)", locked: true },
  },
};

export const CONTAINER: KindDef = {
  id: "container",
  label: "Container",
  extends: "item",
  pack: "gear",
  fields: {
    capacity_l: { type: "number", label: "Capacity (l)", min: 0, domain: "gear", level: 2 },
    max_load_kg: { type: "number", label: "Max load (kg)", min: 0, domain: "gear", level: 2 },
    stock: { type: "text", label: "Contents category (sampled when first opened)" },
  },
};

export const KIT: KindDef = {
  id: "kit",
  label: "Kit",
  extends: "container",
  pack: "gear",
  fields: {
    kit: { type: "text", label: "Kit template", domain: "gear", level: 3 },
    pieces: { type: "list", label: "Pieces", domain: "gear", level: 3 },
    piece_count: { type: "number", label: "Piece count", domain: "gear", level: 3 },
  },
};

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** Cash words a handed-over "item" may be, with the amount each names in major units (null: not said). */
const CASH_WORDS: Record<string, number | null> = { cash: null, money: null, buck: null, bucks: null, change: null, coin: null, coins: null, banknote: null, banknotes: null, twenties: null, fifties: null, fiver: 5, tenner: 10, twenty: 20, fifty: 50, hundred: 100 };

/**
 * Money handed over as a give's "item", when the whole item is money: an optional article, then an
 * amount with the world's currency symbol or code or a money word ("$20", "20 USD", "12d", "20
 * dollars") or a cash word ("cash", "some money", "a twenty", "twenty bucks"), then optionally
 * "bill", "note" or "in cash" ("a $20 bill", "20 dollars in cash"). A priced thing ("my $300
 * jacket", "a $20 gift card") is no money. Its amount as written in major units, or null when the
 * text doesn't say; null overall when it isn't money. Extraction turns such a give into a transfer;
 * the give channel refuses it as money.
 */
export function cashGift(text: string, currency: WorldCurrency): { amount: number | null } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (t === "") return null;
  const quote = (s: string): string => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const article = "(?:(?:some|the|a|an|my|his|her|their) )?";
  const tail = "(?: (?:bills?|notes?|in cash))?";
  const unit = "(?:dollars?|bucks?|euros?|pounds?)";
  const n = "(\\d+(?:\\.\\d+)?)";
  const symbol = quote(currency.symbol);
  const code = quote(currency.code);
  const amounts = [...(symbol !== "" ? [`${symbol} ?${n}`, `${n} ?${symbol}`] : []), ...(code !== "" ? [`${n} ?${code}`] : []), `${n}[ -]${unit}`];
  for (const form of amounts) {
    const said = new RegExp(`^${article}${form}${tail}$`).exec(t)?.[1];
    if (said !== undefined) return { amount: Number(said) };
  }
  const word = new RegExp(`^${article}([a-z]+)(?:[ -]${unit})?${tail}$`).exec(t)?.[1];
  return word !== undefined && hasOwn(CASH_WORDS, word) ? { amount: CASH_WORDS[word] ?? null } : null;
}

/** The gear level that governs a move: the new holder's if it is a person, else the thing's owner's, else the POV's. */
function gearLevel(ctx: ReadContext, thing: EntityId, to?: EntityId): number {
  const toEntity = to ? own(ctx.state.entities, to) : undefined;
  if (to && toEntity && kindIs(ctx.registry, ctx.world, toEntity.kind, "person")) return ctx.levelOf(to, "gear");
  const owner = own(ctx.state.entities, thing)?.fields.owner;
  return ctx.levelOf(typeof owner === "string" && own(ctx.state.entities, owner) ? owner : ctx.world.pov, "gear");
}

/** Events that detach a thing from its holder and wearer, and clear its own place. */
function detach(ctx: ReadContext, thing: EntityId): LedgerEvent[] {
  const e = own(ctx.state.entities, thing);
  const out: LedgerEvent[] = [];
  if (!e) return out;
  for (const r of e.relations) if (r.type === "in" || r.type === "worn_by" || r.type === "equipped") out.push({ type: "unlink", rel: r.type, from: thing, to: r.to });
  return out;
}

const transfer = (ctx: ReadContext, item: EntityId, to: EntityId): Events => {
  if (!own(ctx.state.entities, item)) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (!own(ctx.state.entities, to)) return reject("missing_entity", `no holder ${labelOf(ctx, to)}`);
  const level = gearLevel(ctx, item, to);
  if (level === 0) return [];
  if (holderOf(ctx.state, item) === to) return [];
  if (item === to || isInside(ctx.state, to, item)) return reject("cycle", "can't put something inside itself");
  // Nobody carries a vehicle, a part built into one or a fixed thing, and only what holds things holds them (DESIGN §7).
  const cannot = holdProblem(ctx, item, to);
  if (cannot) return reject(fixedOf(ctx, item) === null ? "cant_hold" : "fixed", cannot);
  const target = own(ctx.state.entities, to);
  if (level >= 2 && target && !kindIs(ctx.registry, ctx.world, target.kind, "person")) {
    const problem = fitProblem(ctx.state, item, to);
    if (problem) return reject("no_room", `${labelOf(ctx, item)} ${problem}`);
  }
  const out = detach(ctx, item);
  if (typeof own(ctx.state.entities, item)?.fields.place === "string") out.push({ type: "set", entity: item, field: "place", value: null });
  out.push({ type: "link", rel: "in", from: item, to });
  // Picked up, it no longer lies in a cell (the space pack's positions, DESIGN §12).
  out.push(...(optionalService(ctx, "space.lay")?.(ctx, item, null, null) ?? []));
  return out;
};

const drop = (ctx: ReadContext, item: EntityId, place: PlaceId): Events => {
  if (!own(ctx.state.entities, item)) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (!own(ctx.world.places, place)) return reject("missing_place", `no place ${labelOf(ctx, place)}`);
  if (gearLevel(ctx, item) === 0) return [];
  // Put down by someone the grid system has on a cell, it lies on that cell.
  return [...detach(ctx, item), { type: "set", entity: item, field: "place", value: place }, ...(optionalService(ctx, "space.lay")?.(ctx, item, place, holderOf(ctx.state, item)) ?? [])];
};

/**
 * A thing's loans end once it is back with its owner or has a new owner (a narrated "Danny hands
 * the flashlight back" must not leave it lent and overdue): every `uses` grant on it goes, and its
 * overdue flag clears.
 */
function endLoans(ctx: ReadContext, thing: EntityId): LedgerEvent[] {
  const out: LedgerEvent[] = grants(ctx.state)
    .filter((g) => g.thing === thing)
    .map((g) => ({ type: "unlink", rel: "uses", from: g.borrower, to: thing }));
  if (own(ctx.state.entities, thing)?.fields.overdue === true) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  return out;
}

const give = (ctx: ReadContext, item: EntityId, from: EntityId, to: EntityId): Events => {
  const e = own(ctx.state.entities, item);
  if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (e.kind === "account") return reject("is_money", "cash changes hands as a transfer");
  if (from !== to && !isInside(ctx.state, item, from) && e.fields.owner !== from) return reject("not_held", `${labelOf(ctx, from)} doesn't have ${e.name}`);
  const moved = transfer(ctx, item, to);
  if (!Array.isArray(moved)) return moved;
  const owner: LedgerEvent[] = e.fields.owner === from || e.fields.owner === undefined ? [{ type: "set", entity: item, field: "owner", value: to }] : [];
  const loansEnd = e.fields.owner === to || owner.length > 0;
  return [...moved, ...owner, ...(loansEnd ? endLoans(ctx, item) : []), ...usedUp(ctx, item, from !== to)];
};

/** A stable spawned-entity id from the spawn's inputs (services have no rng). */
function spawnId(ctx: ReadContext, spec: GearSpawn): string {
  return `item:${hashParts(spec.name, spec.owner ?? "", spec.holder ?? "", spec.catalog ?? "", ctx.state.clock, spec.salt ?? "", Object.keys(ctx.state.entities).length).slice(0, 12)}`;
}

/**
 * The stack a bought or received thing joins: an item its holder has, carried or in a bag, not worn
 * and not gone, of the same catalog row (else, with no row, the same name), with the same owner.
 */
function stackFor(ctx: ReadContext, spec: GearSpawn): EntityId | null {
  if (!spec.holder || !own(ctx.state.entities, spec.holder)) return null;
  const name = spec.name.trim().toLowerCase();
  return (
    carriedBy(ctx.state, spec.holder).find((id) => {
      const e = own(ctx.state.entities, id);
      if (!e || e.kind !== "item" || isGone(ctx.state, id) || e.relations.some((r) => r.type === "worn_by" || r.type === "equipped")) return false;
      // Only a stack the player character can see: joining a hidden one would make the new thing vanish into it.
      if (!canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id)) return false;
      if ((e.fields.owner ?? null) !== (spec.owner ?? null)) return false;
      return spec.catalog ? e.fields.catalog === spec.catalog : e.fields.catalog === undefined && e.name.trim().toLowerCase() === name;
    }) ?? null
  );
}

const spawn = (ctx: ReadContext, spec: GearSpawn): Events => {
  const stack = spec.stack ? stackFor(ctx, spec) : null;
  // A stored count grows by what came, so the entry folds right over another parent (a rebase, a
  // swipe of an earlier message); an unstored one (1 by default) is set, as `change` does.
  if (stack) {
    const stored = own(ctx.state.entities, stack)?.fields.qty;
    return [typeof stored === "number" ? { type: "add", entity: stack, field: "qty", delta: spec.qty ?? 1 } : { type: "set", entity: stack, field: "qty", value: 1 + (spec.qty ?? 1) }];
  }
  const row = spec.catalog ? (rowOf(ctx, "gear.items", spec.catalog) ?? rowOf(ctx, "gear.containers", spec.catalog)) : undefined;
  // What comes into play (found, bought, handed over) is notable, so Gear 1 shows it as it shows authored notable things.
  const fields: JsonObject = { notable: true };
  if (spec.owner) fields.owner = spec.owner;
  if (spec.catalog) fields.catalog = spec.catalog;
  if (spec.category ?? row?.category) fields.category = spec.category ?? strOf(row?.category);
  if (spec.qty !== undefined && spec.qty !== 1) fields.qty = spec.qty;
  if (row) {
    if (typeof row.weight_g === "number") fields.weight_g = row.weight_g;
    if (typeof row.empty_weight_g === "number") fields.weight_g = row.empty_weight_g;
    if (typeof row.volume_l === "number") fields.volume_l = row.volume_l;
    if (typeof row.capacity_l === "number") fields.capacity_l = row.capacity_l;
    if (typeof row.max_load_kg === "number") fields.max_load_kg = row.max_load_kg;
    if (typeof row.equip_slot === "string" && row.equip_slot !== "none") fields.slot = row.equip_slot;
  }
  const id = spawnId(ctx, spec);
  const relations = spec.holder && own(ctx.state.entities, spec.holder) ? [{ type: "in", to: spec.holder }] : [];
  if (relations.length === 0 && spec.place) fields.place = spec.place;
  const kind = spec.kind ?? (row && typeof row.capacity_l === "number" ? "container" : "item");
  const entity: EntityDef = { id, kind, name: spec.name, tier: "background", fields, relations };
  return [{ type: "spawn", entity }];
};

/**
 * A claimed consumable is cleared once handed over or used up (DESIGN §9.4 player claims), at any
 * gear level: it leaves the world as a GM's Remove leaves a thing (`gone`), its holder and owner
 * kept, so what the gift or the use did stands and a rule that reads them still sees it.
 */
function usedUp(ctx: ReadContext, item: EntityId, done: boolean): LedgerEvent[] {
  const e = own(ctx.state.entities, item);
  return done && e?.fields.claimed === true && e.fields.consumable === true && e.fields[GONE_FIELD] !== true ? [{ type: "set", entity: item, field: GONE_FIELD, value: true }] : [];
}

/**
 * A search (DESIGN §7 discoverable things): what `who` finds that is `discoverable` and not known to
 * them yet, each then known for good (`knows`). With a `target` it is what lies directly in it (a
 * container opened or searched); without, what lies loose where they stand, containers included but
 * never what is in them or on anyone. Finding nothing is no failure: the room is searched.
 */
function search(ctx: ReadContext, who: EntityId, target: EntityId | null): Events {
  if (!own(ctx.state.entities, who)) return reject("missing_entity", `no searcher ${labelOf(ctx, who)}`);
  const place = placeOfEntity(ctx.state, who);
  if (target !== null) {
    if (!own(ctx.state.entities, target)) return reject("missing_entity", `no ${labelOf(ctx, target)} to search`);
    if (placeOfEntity(ctx.state, target) !== place) return reject("not_here", `${labelOf(ctx, target)} isn't here`);
  } else if (!place) return reject("no_place", `${labelOf(ctx, who)} is nowhere`);
  const found = target !== null ? contentsOf(ctx.state, target) : Object.keys(ctx.state.entities).filter((id) => holderOf(ctx.state, id) === null && own(ctx.state.entities, id)?.fields.place === place).sort();
  return found.filter((id) => id !== who && !isGone(ctx.state, id) && isDiscoverable(ctx.world, ctx.state, id) && !knows(ctx.state, who, id)).map((id) => ({ type: "link" as const, rel: "knows", from: who, to: id }));
}

/**
 * The thing a narrated hand-over names (DESIGN §9.4 `give`): an id as given, else the one thing
 * the giver holds by that name, any case and without a leading article, so "the brass key" is the
 * key they carry rather than a new one. A name that fits none or several stays as it was.
 */
function heldItem(ctx: ReadContext, item: string, from: EntityId): string {
  if (own(ctx.state.entities, item) || from === "") return item;
  const name = item.trim().replace(/^(?:a|an|the|my|his|her|their|your|our)\s+/i, "").toLowerCase();
  // Only what the player character can see: a hidden thing by that name is none, so it neither hides a visible one nor tells of itself.
  const fits = carriedBy(ctx.state, from).filter((id) => !isGone(ctx.state, id) && canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id) && own(ctx.state.entities, id)?.name.trim().toLowerCase() === name);
  return fits.length === 1 && fits[0] !== undefined ? fits[0] : item;
}

/** The most of a thing one reply may use up, and the most it may move an item's condition (its field's bound): the reply's read is weak at counts. */
const USE_UP_MAX = 10;
const CONDITION_STEP_MAX = 25;

/** The one thing lying loose where `who` is by that name (any case, no leading article), as `heldItem` reads a held one; the name itself when none or several fit. */
function lyingNamed(ctx: ReadContext, item: string, who: EntityId): string {
  const place = placeOfEntity(ctx.state, who);
  const name = item.trim().replace(/^(?:a|an|the|my|his|her|their|your|our)\s+/i, "").toLowerCase();
  // Only what the player character can see: a hidden or undiscovered thing by that name reads as none, so nothing tells of it.
  const fits = Object.keys(ctx.state.entities).filter((id) => !isGone(ctx.state, id) && !heldByPerson(ctx, id) && placeOfEntity(ctx.state, id) === place && canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id) && own(ctx.state.entities, id)?.name.trim().toLowerCase() === name);
  return fits.length === 1 && fits[0] !== undefined ? fits[0] : item;
}

/** Whether someone has the thing on them, at any depth (a pocket, a bag): picking it up would be taking it from them. */
function heldByPerson(ctx: ReadContext, id: EntityId): boolean {
  let cur = holderOf(ctx.state, id);
  for (let guard = 0; cur && guard < 32; guard++) {
    const e = own(ctx.state.entities, cur);
    if (e && kindIs(ctx.registry, ctx.world, e.kind, "person")) return true;
    cur = holderOf(ctx.state, cur);
  }
  return false;
}

/** A claimed thing's id: from the turn's seed, the action's place and the name, never the name alone, and never one the state has. */
function claimId(ctx: ReadContext, c: GearClaim): EntityId {
  for (let n = 0; ; n++) {
    const id = `item:claim_${hashParts("lre.claim", c.salt, c.name, String(n)).slice(0, 12)}`;
    if (!own(ctx.state.entities, id)) return id;
  }
}

/**
 * A thing the player says they have, as a new entity marked `claimed` (DESIGN §9.4 player claims):
 * theirs and in their hands, or lying where they are. A thing of its catalog row (else its name)
 * the claimer already holds stands for it: an earlier action of the turn made it (a Buy).
 */
const claim = (ctx: ReadContext, c: GearClaim): { entity: EntityId; events: LedgerEvent[] } | Rejection => {
  if (!own(ctx.state.entities, c.by)) return reject("missing_entity", `no claimer ${labelOf(ctx, c.by)}`);
  const name = c.name.trim();
  // A tracking gap closed: their own thing comes to them as the story has it, never a second one.
  if (c.existing && own(ctx.state.entities, c.existing)) {
    const place = placeOfEntity(ctx.state, c.by);
    const moved = c.at === "held" ? transfer(ctx, c.existing, c.by) : place ? drop(ctx, c.existing, place) : reject("no_place", `${labelOf(ctx, c.by)} is nowhere`);
    return Array.isArray(moved) ? { entity: c.existing, events: moved } : moved;
  }
  if (c.at === "held") {
    const held = carriedBy(ctx.state, c.by).find((id) => {
      const e = own(ctx.state.entities, id);
      return e !== undefined && !isGone(ctx.state, id) && (c.catalog ? e.fields.catalog === c.catalog : e.name.trim().toLowerCase() === name.toLowerCase());
    });
    if (held) return { entity: held, events: [] };
  }
  const place = placeOfEntity(ctx.state, c.by);
  if (c.at === "here" && !place) return reject("no_place", `${labelOf(ctx, c.by)} is nowhere`);
  const row = c.like ? (rowOf(ctx, "gear.items", c.like) ?? rowOf(ctx, "gear.containers", c.like)) : undefined;
  // Notable, so Gear 1 shows what the player said they have.
  const fields: JsonObject = { claimed: true, notable: true };
  if (c.at === "held") fields.owner = c.by;
  else if (place) fields.place = place;
  if (c.catalog) fields.catalog = c.catalog;
  if (c.category) fields.category = c.category;
  if (c.consumable) fields.consumable = true;
  if (row) {
    if (typeof row.weight_g === "number") fields.weight_g = row.weight_g;
    if (typeof row.empty_weight_g === "number") fields.weight_g = row.empty_weight_g;
    if (typeof row.volume_l === "number") fields.volume_l = row.volume_l;
    if (typeof row.equip_slot === "string" && row.equip_slot !== "none") fields.slot = row.equip_slot;
  }
  const id = claimId(ctx, c);
  return { entity: id, events: [{ type: "spawn", entity: { id, kind: c.kind, name, tier: "background", fields, relations: c.at === "held" ? [{ type: "in", to: c.by }] : [] } }] };
};

const takePiece = (ctx: ReadContext, kit: EntityId, piece: string, to: EntityId): Events => {
  const k = own(ctx.state.entities, kit);
  if (!k) return reject("missing_entity", `no kit ${labelOf(ctx, kit)}`);
  const status = kitStatus(ctx, kit);
  const p = findPiece(ctx, kit, piece);
  if (!status || !p) return reject("no_piece", `${k.name} has no ${piece}`);
  // A piece that was taken before and put back is an override item already: just move it.
  const back = contentsOf(ctx.state, kit).find((id) => own(ctx.state.entities, id)?.fields.from_kit === kit && own(ctx.state.entities, id)?.fields.piece === p.name);
  if (back) return transfer(ctx, back, to);
  const present = status.pieces.find((x) => x.name === p.name)?.present ?? 0;
  if (present <= 0) return reject("no_piece", `no ${p.name} left in ${k.name}`);
  const taken = takenOf(ctx.state, kit);
  const spawned = spawn(ctx, { name: p.name, owner: typeof k.fields.owner === "string" ? k.fields.owner : null, holder: to, salt: `${kit}:${p.name}:${own(taken, p.name) ?? 0}` });
  if (!Array.isArray(spawned)) return spawned;
  const first = spawned[0];
  if (first?.type === "spawn") {
    first.entity.fields.piece = p.name;
    first.entity.fields.from_kit = kit;
    first.entity.fields.weight_g = p.weightG;
  }
  return [...spawned, { type: "set", entity: kit, field: "taken", value: { ...taken, [p.name]: (own(taken, p.name) ?? 0) + 1 } }];
};

const lend = (ctx: ReadContext, thing: EntityId, to: EntityId, until: number): Events => {
  const e = own(ctx.state.entities, thing);
  if (!e) return reject("missing_entity", `no ${labelOf(ctx, thing)}`);
  if (!own(ctx.state.entities, to)) return reject("missing_entity", `no ${labelOf(ctx, to)}`);
  if (!Number.isFinite(until) || until <= ctx.state.clock) return reject("bad_until", "a loan needs a future end");
  const out: LedgerEvent[] = [];
  // A vehicle (or anything with a place of its own) stays where it is; carried things change hands.
  if (typeof e.fields.place !== "string" || holderOf(ctx.state, thing)) {
    const moved = transfer(ctx, thing, to);
    if (!Array.isArray(moved)) return moved;
    out.push(...moved);
  }
  if (e.fields.overdue === true) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  out.push({ type: "link", rel: "uses", from: to, to: thing, until: Math.round(until) });
  return out;
};

const retrieve = (ctx: ReadContext, thing: EntityId): Events => {
  const e = own(ctx.state.entities, thing);
  if (!e) return reject("missing_entity", `no ${labelOf(ctx, thing)}`);
  const out: LedgerEvent[] = [];
  for (const g of grants(ctx.state)) if (g.thing === thing) out.push({ type: "unlink", rel: "uses", from: g.borrower, to: thing });
  const owner = typeof e.fields.owner === "string" ? e.fields.owner : null;
  // Things with a home base (vehicles) go back there; carried things go back to their owner.
  if (typeof e.fields.home === "string" && own(ctx.world.places, e.fields.home)) out.push(...detach(ctx, thing), { type: "set", entity: thing, field: "place", value: e.fields.home });
  else if (owner && own(ctx.state.entities, owner)) {
    const moved = transfer(ctx, thing, owner);
    if (Array.isArray(moved)) out.push(...moved);
  }
  // Cleared whenever the thing was lent too: an expiry flagged in the same slot lands before this.
  if (e.fields.overdue === true || out.some((x) => x.type === "unlink")) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  return out;
};

const wear = (ctx: ReadContext, item: EntityId, wearer: EntityId, slot?: string): Events => {
  const e = own(ctx.state.entities, item);
  if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
  if (ctx.levelOf(wearer, "gear") < 3) return reject("level", "slots are tracked from Gear level 3");
  const s = slot ?? strOf(e.fields.slot);
  if (!s || s === "none") return reject("no_slot", `${e.name} isn't worn`);
  const rel = s === "hand_held" ? "equipped" : "worn_by";
  const occupied = Object.keys(ctx.state.entities).find((id) => id !== item && own(ctx.state.entities, id)?.relations.some((r) => r.type === rel && r.to === wearer && r.fields?.slot === s));
  if (occupied && s !== "pocket" && s !== "pocket_or_bag") return reject("slot_taken", `${labelOf(ctx, occupied)} is already in the ${s.replace(/_/g, " ")} slot`);
  const out: LedgerEvent[] = [];
  if (holderOf(ctx.state, item) !== wearer) {
    const moved = transfer(ctx, item, wearer);
    if (!Array.isArray(moved)) return moved;
    out.push(...moved);
  }
  out.push({ type: "link", rel, from: item, to: wearer, fields: { slot: s } });
  return out;
};

export const gearPack: PackDef = {
  id: "gear",
  label: "Gear & containers",
  version: 1,
  domain: "gear",
  requires: ["space"],
  register(r) {
    for (const t of TABLES) r.table({ id: t.id, schema: t.schema, columns: t.columns, defaults: t });
    r.kind(ITEM);
    r.kind(CONTAINER);
    r.kind(KIT);
    r.relation({ id: "worn_by", label: "Worn by", from: "item", to: "*", cardinality: "many_one", symmetric: false, fields: { slot: { type: "text" } }, pack: "gear" });
    r.relation({ id: "equipped", label: "Equipped by", from: "item", to: "*", cardinality: "many_one", symmetric: false, fields: { slot: { type: "text" } }, pack: "gear" });
    r.relation({ id: "uses", label: "Uses (granted until)", from: "*", to: "*", cardinality: "many_many", symmetric: false, fields: {}, pack: "gear" });

    r.service("gear.transfer", transfer);
    r.service("gear.drop", drop);
    r.service("gear.give", give);
    r.service("gear.spawn", spawn);
    r.service("gear.claim", claim);
    r.service("gear.take_piece", takePiece);
    r.service("gear.lend", lend);
    r.service("gear.retrieve", retrieve);
    r.query("has_item", hasItem);
    r.query("gear.kit_status", kitStatus);
    r.query("gear.overdue", (ctx, owner) => overdueFor(ctx.state, owner));
    r.query("gear.hold_problem", holdProblem);
    r.query("gear.containment", (ctx, id) => ({ holds: holdsAs(ctx, id), goes: goesIn(ctx, id) }));

    r.formula("has_item", (ctx, holder, what) => hasItem(ctx, String(holder ?? ""), String(what ?? "")));
    r.formula("carries", (ctx, holder, item) => isInside(ctx.state, String(item ?? ""), String(holder ?? "")));
    // Whether it can be picked up at all: not a vehicle, a part built into one, or a fixed thing (DESIGN §7).
    r.formula("movable", (ctx, thing) => fixedOf(ctx, String(thing ?? "")) === null);
    r.formula("carried_kg", (ctx, holder) => carriedBy(ctx.state, String(holder ?? "")).filter((id) => holderOf(ctx.state, id) === holder).reduce((a, id) => a + weightOf(ctx.state, id), 0) / 1000);
    r.formula("kit_present", (ctx, kit) => kitStatus(ctx, String(kit ?? ""))?.present ?? 0);
    r.formula("kit_complete", (ctx, kit) => kitStatus(ctx, String(kit ?? ""))?.complete ?? false);
    r.formula("lent_out", (ctx, thing) => grants(ctx.state).some((g) => g.thing === thing));

    const wrap = (type: string, args: readonly string[], f: (args: Record<string, JsonValue>, ctx: ReadContext) => Events): void => r.effect({ type, args, resolve: (a, ctx) => f(a, ctx) });
    wrap("gear.transfer", ["item", "to"], (a, ctx) => {
      const item = strOf(a.item);
      const to = strOf(a.to);
      const moved = transfer(ctx, item, to);
      return Array.isArray(moved) && own(ctx.state.entities, item)?.fields.owner === to ? [...moved, ...endLoans(ctx, item)] : moved;
    });
    wrap("gear.drop", ["item", "place?"], (a, ctx) => drop(ctx, strOf(a.item), strOf(a.place) || (placeOfEntity(ctx.state, strOf(a.item)) ?? "")));
    wrap("gear.give", ["item", "from", "to"], (a, ctx) => give(ctx, strOf(a.item), strOf(a.from), strOf(a.to)));
    // An NPC hands over something the world hadn't tracked yet: it comes into being, held by the recipient.
    wrap("gear.receive", ["name", "to", "from?"], (a, ctx) => spawn(ctx, { name: strOf(a.name), owner: strOf(a.to), holder: strOf(a.to), salt: `give:${strOf(a.from)}:${ctx.state.clock}`, stack: true }));
    wrap("gear.search", ["who", "target?"], (a, ctx) => search(ctx, strOf(a.who) || ctx.world.pov, strOf(a.target) || null));
    wrap("gear.take_piece", ["kit", "piece", "to"], (a, ctx) => takePiece(ctx, strOf(a.kit), strOf(a.piece), strOf(a.to)));
    // A loan's end: the time the player said (`said`: "7 tonight", "tomorrow", "for 3 hours"), else
    // `until` (a clock, from the days). A said time nothing in it reads as falls back to the days;
    // with no days either, there is no end and no loan.
    wrap("gear.lend", ["item", "to", "until?", "said?"], (a, ctx) => {
      const said = strOf(a.said);
      const at = said !== "" ? clockOfPhrase(calendarOf(ctx.world), ctx.state.clock, said) : null;
      const until = at ?? numOf(a.until, NaN);
      if (said !== "" && at === null && !(until > ctx.state.clock)) return reject("bad_until", `"${said}" names no time; say how many days or until when`);
      return lend(ctx, strOf(a.item), strOf(a.to), until);
    });
    wrap("gear.retrieve", ["item"], (a, ctx) => retrieve(ctx, strOf(a.item)));
    wrap("gear.wear", ["item", "wearer", "slot?"], (a, ctx) => wear(ctx, strOf(a.item), strOf(a.wearer), typeof a.slot === "string" ? a.slot : undefined));
    wrap("gear.remove", ["item"], (a, ctx) => {
      const item = strOf(a.item);
      const e = own(ctx.state.entities, item);
      if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
      return e.relations.filter((x) => x.type === "worn_by" || x.type === "equipped").map((x) => ({ type: "unlink" as const, rel: x.type, from: item, to: x.to }));
    });
    r.effect({
      type: "gear.use",
      args: ["item", "user?"],
      resolve(args, ctx) {
        const item = strOf(args.item);
        const user = strOf(args.user) || ctx.world.pov;
        const e = own(ctx.state.entities, item);
        if (!e) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
        const level = ctx.levelOf(user, "gear");
        const out: LedgerEvent[] = [];
        if (level >= 4) {
          if (e.fields.consumable === true || typeof e.fields.uses === "number") {
            const uses = numOf(e.fields.uses, 1);
            if (uses <= 0) return reject("used_up", `${e.name} is used up`);
            out.push(bump(ctx.state, item, "uses", -1, uses));
          }
          const wearBy = ctx.rng.int(0, 2);
          const condition = numOf(e.fields.condition, 100);
          if (wearBy > 0 && condition > 0) out.push(bump(ctx.state, item, "condition", -Math.min(wearBy, condition), condition));
        }
        // A claimed consumable is used up, at any gear level (DESIGN §9.4).
        out.push(...usedUp(ctx, item, true));
        return out;
      },
    });

    // Things in cells (DESIGN §11): with the grid system on, taking or using one lying in a cell
    // needs you on or next to it (`reach`); off, `reach` is being at the same place.
    // Never a vehicle, a part built into one or a fixed thing (`movable`, DESIGN §7): only what can be lifted is offered or taken.
    r.action({ id: "take", label: "Take", description: "Pick up something that is here.", pack: "gear", params: { item: { type: "ref", ref: "item", claim: "here" } }, requires: ["place(item) == here", "not carries(self, item)", "reach(self, item)", "movable(item)"], outcomes: { default: [{ type: "gear.transfer", args: { item: "item", to: "self" } }] }, duration: "1", lexicon: ["take", "pick up", "grab"], observable: "picks something up" });
    // Losing something: it leaves its holder and the world (whereabouts unknown); cash inside goes with it.
    r.effect({
      type: "gear.lose",
      args: ["item", "thief?"],
      resolve(args, ctx) {
        const item = strOf(args.item);
        const e = own(ctx.state.entities, item);
        if (!e) return reject("missing_entity", `no ${labelOf(ctx, item)}`);
        if (e.fields.lost === true) return reject("already_lost", `${e.name} is already lost`);
        const out: LedgerEvent[] = [];
        const lose = optionalService(ctx, "economy.lose");
        if (lose) {
          const money = lose(ctx, item, strOf(args.thief) || undefined);
          if (!Array.isArray(money)) return money;
          out.push(...money);
        }
        for (const r of e.relations) if (r.type === "in" || r.type === "worn_by" || r.type === "equipped") out.push({ type: "unlink", rel: r.type, from: item, to: r.to });
        out.push({ type: "set", entity: item, field: "lost", value: true });
        if (typeof e.fields.place === "string") out.push({ type: "set", entity: item, field: "place", value: null });
        return out;
      },
    });
    r.action({ id: "lose", label: "Lose something", description: "Something you own or carry is lost or gone, whereabouts unknown.", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["item.owner == self or carries(self, item)", "item.lost != true"], outcomes: { default: [{ type: "gear.lose", args: { item: "item" } }] }, duration: "1", lexicon: ["lost my", "lose", "can't find my", "is gone", "is missing"], observable: "searches their pockets" });
    r.action({ id: "drop", label: "Drop", description: "Put down something you carry, here.", pack: "gear", params: { item: { type: "ref", ref: "item", claim: "held" } }, requires: ["carries(self, item)"], outcomes: { default: [{ type: "gear.drop", args: { item: "item", place: "=here" } }] }, duration: "1", lexicon: ["drop", "put down", "leave"], observable: "puts something down" });
    // Search or examine (DESIGN §3, §7): finds the `discoverable` things lying here, or in a container
    // searched or opened. A world that wants a roll for it authors its own `search` action with a check
    // whose passing outcomes run `gear.search`; it replaces this one by id.
    r.action({ id: "search", label: "Search", description: "Search where you are, or look through a container, for what isn't in plain sight.", pack: "gear", params: { target: { type: "ref", ref: "item", optional: true, label: "What to look through (none: around here)" } }, requires: [], outcomes: { default: [{ type: "gear.search", args: { who: "self", target: "=params.target" } }] }, duration: "5", lexicon: ["search", "look around", "examine", "look through", "look inside", "open", "rummage"], observable: "searches the place" });
    r.action({ id: "give", label: "Give", description: "Hand something you carry to someone here, for keeps.", pack: "gear", params: { item: { type: "ref", ref: "item", claim: "held" }, to: { type: "ref", ref: "person" } }, requires: ["carries(self, item)", "at(to, here)"], outcomes: { default: [{ type: "gear.give", args: { item: "item", from: "self", to: "to" } }] }, duration: "1", lexicon: ["give", "hand", "pass"], observable: "hands something over" });
    // Days or a said end, at least one: interpret fills whichever the player said ("until 7 tonight");
    // the palette always sends days.
    r.action({ id: "lend", label: "Lend", description: "Lend something of yours to someone, for some days or until a time.", pack: "gear", params: { item: { type: "ref", ref: "item" }, to: { type: "ref", ref: "person" }, days: { type: "number", optional: true }, until: { type: "text", optional: true, label: "Until (a time: 7 pm, tonight, tomorrow)" } }, requires: ["item.owner == self", "days > 0 or params.until != null", "at(to, here) or at(item, here)"], outcomes: { default: [{ type: "gear.lend", args: { item: "item", to: "to", until: "=days > 0 ? clock + days(days) : 0", said: "=params.until" } }] }, duration: "2", lexicon: ["lend", "loan", "let borrow"], observable: "lends something" });
    r.action({ id: "reclaim", label: "Take back", description: "Take back something of yours that you lent out.", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["item.owner == self", "lent_out(item)"], outcomes: { default: [{ type: "gear.retrieve", args: { item: "item" } }] }, duration: "5", lexicon: ["take back", "get back", "reclaim"], observable: "takes something back" });
    r.action({ id: "wear", label: "Wear or equip", description: "Put on or equip clothing, armor or gear.", pack: "gear", params: { item: { type: "ref", ref: "item", claim: "held" } }, requires: ["carries(self, item) or (place(item) == here and reach(self, item))", "level.gear >= 3", "movable(item)"], outcomes: { default: [{ type: "gear.wear", args: { item: "item", wearer: "self" } }] }, duration: "2", lexicon: ["wear", "put on", "equip"], observable: "puts something on" });
    r.action({ id: "remove", label: "Take off", description: "Take off something you wear or have equipped.", pack: "gear", params: { item: { type: "ref", ref: "item" } }, requires: ["carries(self, item)"], outcomes: { default: [{ type: "gear.remove", args: { item: "item" } }] }, duration: "2", lexicon: ["take off", "remove", "unequip"], observable: "takes something off" });
    r.action({ id: "use", label: "Use", description: "Use an item you carry or can reach.", pack: "gear", params: { item: { type: "ref", ref: "item", claim: "held" } }, requires: ["carries(self, item) or (on_grid(item) and reach(self, item))"], outcomes: { default: [{ type: "gear.use", args: { item: "item", user: "self" } }] }, duration: "5", lexicon: ["use", "apply"], observable: "uses something" });
    r.action({ id: "take_piece", label: "Take from a kit", description: "Take one piece, such as a tool or a part, out of a kit.", pack: "gear", params: { kit: { type: "ref", ref: "kit" }, piece: { type: "text" } }, requires: ["(place(kit) == here and reach(self, kit)) or carries(self, kit)", "level.gear >= 3"], outcomes: { default: [{ type: "gear.take_piece", args: { kit: "kit", piece: "=piece", to: "self" } }] }, duration: "1", lexicon: ["take the", "grab a", "get a"], observable: "takes a tool" });

    r.process({
      id: "gear.grants",
      domain: "gear",
      minLevel: 1,
      step(slot, ctx) {
        const out: LedgerEvent[] = [];
        for (const g of grants(ctx.state)) {
          const thing = own(ctx.state.entities, g.thing);
          if (!thing || g.until === null || g.until > slot.end || thing.fields.overdue === true) continue;
          out.push({ type: "set", entity: g.thing, field: "overdue", value: true });
          const borrower = own(ctx.state.entities, g.borrower)?.name ?? g.borrower;
          out.push({ type: ENGINE_EVENTS.signal, data: { class: "overdue", text: `${thing.name} is overdue from ${borrower}.`, ...(g.owner ? { entity: g.owner } : {}) } });
        }
        return out;
      },
    });

    r.materializer({
      domain: "gear",
      version: 1,
      materialize(entity, ctx, rng) {
        const e = own(ctx.state.entities, entity);
        if (!e || ctx.levelOf(entity, "gear") < 2) return [];
        const out: LedgerEvent[] = [];
        if (kindIs(ctx.registry, ctx.world, e.kind, "person")) {
          // Everyone carries a wallet at Gear 2+, so cash has a place to live.
          const hasWallet = carriedBy(ctx.state, entity).some((id) => own(ctx.state.entities, id)?.fields.catalog === "wallet" || /wallet|purse/i.test(own(ctx.state.entities, id)?.name ?? ""));
          if (!hasWallet) {
            const w = spawn(ctx, { name: "Wallet", owner: entity, holder: entity, catalog: "wallet", kind: "container", salt: "materialize" });
            if (Array.isArray(w)) out.push(...w);
          }
          return out;
        }
        const stock = e.fields.stock;
        // `stock` is the author asking for more of its kind: it adds to whatever the world put inside.
        if (typeof stock === "string" && e.fields.sampled !== true) {
          const rows = Object.entries(ctx.tables.get("gear.items")?.rows ?? {}).filter(([, row]) => row.category === stock).map(([id]) => id).sort();
          const n = rows.length === 0 ? 0 : rng.int(2, 4);
          for (let i = 0; i < n; i++) {
            const id = rng.pick(rows);
            const row = rowOf(ctx, "gear.items", id);
            const made = spawn(ctx, { name: strOf(row?.name, id), owner: typeof e.fields.owner === "string" ? e.fields.owner : null, holder: entity, catalog: id, salt: `stock:${i}` });
            if (Array.isArray(made)) out.push(...made);
          }
          out.push({ type: "set", entity, field: "sampled", value: true });
        }
        return out;
      },
    });

    r.renderer({ slot: "gear", label: "What your character carries and wears", render: (ctx) => gearLines(ctx, "player").map((l) => l.text), feed: gearLines });
    // What the people with the POV visibly wear and carry (DESIGN §6.11), beside them in People.
    r.renderer({ slot: "people", source: "present_gear", label: "What the people here wear and carry", render: (ctx) => presentGearLines(ctx, "player").map((l) => l.text), feed: presentGearLines });

    r.view({ panel: "gear.gear", build: (ctx) => buildGearView(ctx) as unknown as JsonValue });

    r.proposal({
      type: "give",
      boundField: "ref",
      validate(p, ctx) {
        const item = heldItem(ctx, strOf(p.item), strOf(p.from));
        const e = own(ctx.state.entities, item);
        if (!own(ctx.state.entities, strOf(p.to))) return reject("missing_entity", `no recipient ${labelOf(ctx, strOf(p.to))}`);
        if (!e) {
          // Money handed over is a transfer, never a new item called "$20" or "cash".
          if (cashGift(item, ctx.world.currency)) return reject("is_money", "a cash give is a transfer");
          // Only an NPC can hand over something untracked; the POV can't give what it doesn't have.
          const from = strOf(p.from);
          return item !== "" && from !== "" && from !== ctx.world.pov && own(ctx.state.entities, from) ? null : reject("missing_entity", `no item ${labelOf(ctx, item)}`);
        }
        if (e.kind === "account") return reject("is_money", "a cash give is a transfer");
        return null;
      },
      toEffects: (p, ctx) => {
        const item = heldItem(ctx, strOf(p.item), strOf(p.from));
        return own(ctx.state.entities, item) ? [{ type: "gear.give", args: { item, from: strOf(p.from), to: strOf(p.to) } }] : [{ type: "gear.receive", args: { name: item, from: strOf(p.from), to: strOf(p.to) } }];
      },
    });
    // The reply's item changes (DESIGN §9.4): each names someone and a thing the world has, by id or by
    // a name the one it can mean holds or has here (`heldItem`), and is checked against where the
    // thing is now; what can't happen is refused like any change, never made up.
    const itemFor = (p: JsonObject, ctx: ReadContext, who: EntityId, near: boolean): { id: EntityId; e: EntityState } | Rejection => {
      if (!own(ctx.state.entities, who)) return reject("missing_entity", `no one ${labelOf(ctx, who)}`);
      const named = heldItem(ctx, strOf(p.item), who);
      const id = near && !own(ctx.state.entities, named) ? lyingNamed(ctx, strOf(p.item), who) : named;
      const e = own(ctx.state.entities, id);
      // A thing the player character can't see reads as one nothing has: its refusal can't tell it exists.
      if (!e || isGone(ctx.state, id) || !kindIs(ctx.registry, ctx.world, e.kind, "item") || !canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id)) return reject("missing_entity", `no item ${labelOf(ctx, strOf(p.item))}`);
      if (e.kind === "account") return reject("is_money", "money changes hands as a transfer");
      return { id, e };
    };
    r.proposal({
      type: "take",
      boundField: "ref",
      validate(p, ctx) {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, true);
        if ("code" in found) return found;
        if (isInside(ctx.state, found.id, who)) return reject("already_held", `${labelOf(ctx, who)} already has ${found.e.name}`);
        // Picked up where they are, and not out of someone else's hands: that is a give or a theft.
        if (placeOfEntity(ctx.state, found.id) !== placeOfEntity(ctx.state, who) || heldByPerson(ctx, found.id)) return reject("not_here", `${found.e.name} isn't lying where ${labelOf(ctx, who)} is`);
        const cannot = holdProblem(ctx, found.id, who);
        if (cannot) return reject("fixed", cannot);
        return null;
      },
      toEffects: (p, ctx) => {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, true);
        return "code" in found ? [] : [{ type: "gear.transfer", args: { item: found.id, to: who } }];
      },
    });
    r.proposal({
      type: "drop",
      boundField: "ref",
      validate(p, ctx) {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, false);
        if ("code" in found) return found;
        if (!isInside(ctx.state, found.id, who)) return reject("not_held", `${labelOf(ctx, who)} doesn't have ${found.e.name}`);
        return placeOfEntity(ctx.state, who) ? null : reject("no_place", `${labelOf(ctx, who)} is nowhere`);
      },
      toEffects: (p, ctx) => {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, false);
        return "code" in found ? [] : [{ type: "gear.drop", args: { item: found.id, place: placeOfEntity(ctx.state, who) ?? "" } }];
      },
    });
    r.proposal({
      type: "use_up",
      boundField: "number",
      validate(p, ctx) {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, false);
        if ("code" in found) return found;
        if (!isInside(ctx.state, found.id, who)) return reject("not_held", `${labelOf(ctx, who)} doesn't have ${found.e.name}`);
        const n = p.qty === undefined ? 1 : p.qty;
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > USE_UP_MAX) return reject("bound", `using up is a whole number from 1 to ${USE_UP_MAX} at a time`);
        return null;
      },
      toEffects: (p, ctx) => {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, false);
        if ("code" in found) return [];
        const left = numOf(found.e.fields.qty, 1) - numOf(p.qty, 1);
        // The last of it leaves the world as a used-up claim does (`gone`), holder and owner kept.
        // `add` counts down from whatever the parent holds when the entry folds (`change`), never a stale total.
        const step: EffectSpec = left > 0 ? { type: "add", args: { entity: found.id, field: "qty", delta: -numOf(p.qty, 1) } } : { type: "set", args: { entity: found.id, field: GONE_FIELD, value: true } };
        return [step];
      },
    });
    r.proposal({
      type: "wear",
      boundField: "ref",
      validate(p, ctx) {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, true);
        if ("code" in found) return found;
        const worn = found.e.relations.some((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who);
        if (p.off === true) return worn ? null : reject("not_worn", `${labelOf(ctx, who)} isn't wearing ${found.e.name}`);
        if (worn) return reject("already_worn", `${labelOf(ctx, who)} already wears ${found.e.name}`);
        return isInside(ctx.state, found.id, who) || placeOfEntity(ctx.state, found.id) === placeOfEntity(ctx.state, who) ? null : reject("not_held", `${labelOf(ctx, who)} doesn't have ${found.e.name}`);
      },
      toEffects: (p, ctx) => {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, true);
        if ("code" in found) return [];
        return p.off === true ? [{ type: "gear.remove", args: { item: found.id } }] : [{ type: "gear.wear", args: { item: found.id, wearer: who } }];
      },
    });
    r.proposal({
      type: "lose",
      boundField: "ref",
      validate(p, ctx) {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, false);
        if ("code" in found) return found;
        if (!isInside(ctx.state, found.id, who) && found.e.fields.owner !== who) return reject("not_held", `${labelOf(ctx, who)} doesn't have ${found.e.name}`);
        const by = strOf(p.by);
        return by === "" || own(ctx.state.entities, by) ? null : reject("missing_entity", `no thief ${labelOf(ctx, by)}`);
      },
      // Stolen (`by`): it goes into the thief's hands, still the owner's; else lost, whereabouts unknown.
      toEffects: (p, ctx) => {
        const who = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, who, false);
        if ("code" in found) return [];
        return strOf(p.by) !== "" ? [{ type: "gear.transfer", args: { item: found.id, to: strOf(p.by) } }] : [{ type: "gear.lose", args: { item: found.id } }];
      },
    });
    r.proposal({
      type: "item_condition",
      boundField: "number",
      validate(p, ctx) {
        const holder = strOf(p.entity) || ctx.world.pov;
        const found = itemFor(p, ctx, holder, true);
        if ("code" in found) return found;
        if (typeof p.delta !== "number" || !Number.isInteger(p.delta) || p.delta === 0 || Math.abs(p.delta) > CONDITION_STEP_MAX) return reject("bound", `an item's condition moves by a whole number up to ${CONDITION_STEP_MAX} a reply`);
        return null;
      },
      toEffects: (p, ctx) => {
        const found = itemFor(p, ctx, strOf(p.entity) || ctx.world.pov, true);
        return "code" in found ? [] : [{ type: "add", args: { entity: found.id, field: "condition", delta: numOf(p.delta, 0) } }];
      },
    });
    r.proposal({
      type: "quantity",
      boundField: "number",
      validate(p, ctx) {
        const item = strOf(p.item);
        const e = own(ctx.state.entities, item);
        if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "item")) return reject("missing_entity", `no item ${labelOf(ctx, item)}`);
        const delta = p.delta;
        if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) return reject("bad_proposal", "quantity needs a whole, non-zero delta");
        const who = strOf(p.entity);
        if (who !== "" && who !== e.fields.owner && !isInside(ctx.state, item, who)) return reject("not_holder", `${labelOf(ctx, who)} doesn't have ${e.name}`);
        // Capped per field: the item kind's `qty` bound, else the default.
        const cap = Math.abs(fieldDef(ctx.registry, ctx.world, e.kind, "qty")?.bound?.maxDelta ?? QTY_MAX_DELTA);
        return Math.abs(delta) > cap ? reject("over_bound", `a reply can change a quantity by at most ${cap}`) : null;
      },
      toEffects: (p) => [{ type: "add", args: { entity: strOf(p.item), field: "qty", delta: numOf(p.delta) } }],
    });

    r.lint({
      code: "gear.kits",
      check(world) {
        const issues = [];
        const table = world.tables["gear.kits"];
        for (const e of Object.values(world.entities)) {
          if (typeof e.fields.kit === "string" && table && !own(table.rows, e.fields.kit)) issues.push({ severity: "error" as const, code: "gear.kits", message: `${e.name} names an unknown kit ${e.fields.kit}.`, path: `entities.${e.id}.fields.kit` });
        }
        return issues;
      },
    });

    r.lint({
      code: "gear.holders",
      check(world, registry) {
        if (!registry) return [];
        // Only a person, a vehicle or a container holds things (`kindHoldsAs`, DESIGN §7): a kind of the
        // world's own it moves things into that is none of those is refused every transfer, gift and Put
        // inside into it. Said once per kind.
        return [...authoredMoves(world).holders]
          .filter(([kind]) => kindHoldsAs(registry, world, kind) === null)
          .map(([kind, why]) => ({
            severity: "warning" as const,
            code: "gear.holders",
            path: `kinds.${kind}`,
            message: `Kind ${own(world.kinds, kind)?.label ?? kind} (${kind}) holds things in this world (${why}) but isn't a container, a vehicle or a person, so nothing can be put in it: a transfer, a gift or a GM's Put inside into it is refused. Set its Extends to container, or to a kind built on one.`,
          }));
      },
    });

    r.lint({
      code: "gear.contents",
      check(world, registry) {
        if (!registry) return [];
        // Only a thing goes inside anything (`kindGoesIn`, DESIGN §7): an item or a kind built on one, a
        // cash account, and a person or a vehicle into a vehicle. A kind of the world's own it moves things
        // of that is none of those is never taken, given or put anywhere. Said once per kind.
        return [...authoredMoves(world).things]
          .filter(([kind]) => kindGoesIn(registry, world, kind) === "nowhere")
          .map(([kind, why]) => ({
            severity: "warning" as const,
            code: "gear.contents",
            path: `kinds.${kind}`,
            message: `Kind ${own(world.kinds, kind)?.label ?? kind} (${kind}) is moved in this world (${why}) but isn't built on Item (nor is it a person, a vehicle or a cash account), so nothing can take it, give it or put it in anything: Take never offers it, and a transfer, a gift or a GM's Put inside of it is refused. Set its Extends to item, or to a kind built on one.`,
          }));
      },
    });
  },
};

export default gearPack;
