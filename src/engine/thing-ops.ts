// Item ops (ITEMS-SPEC §3.5, §5.3, §6.1): the one validator for every change to a thing, and the one
// location writer (`locate`), compiled to the event types the fold already has (`spawn`, `set`,
// `add`, `link`, `unlink`, the space pack's cell events, notes, and `engine.rename`), so a recorded
// chat folds as it always did. The categorical rules bite here, when an op is resolved and never in
// the fold: nothing rests in a person above the person ceiling (it lands where they stand, with a
// note), nothing goes into something smaller, a part never leaves what it is built into, and a
// Built-in thing moves only by a confirmed op; on the player's own paths a holder's room, its load
// and how deep things nest count too (`room`). A thing is made only when nothing it may be fits
// (find first); a vehicle is made by the vehicles pack (`vehicles.spawn`) and handed over where it
// stands. A person's saved sets are the gear pack's (`gear.set_op`). Removing a thing is the GM's
// despawn (`engine/edits`). Pure.

import { ownersIn } from "../shared/finance";
import { hashParts } from "../shared/hash";
import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { Got, GotHow, ItemOp, Rest, SetOp, Size, SizeClass, Spot, Support } from "../shared/things";
import { typeFields } from "../shared/items-build";
import { isSetOp, nameKey, sizeRank, SIZE_LABELS, thingsConfigOf } from "../shared/things";
import type { EntityDef, FieldDef } from "../shared/world";
import { accessFor, assignFor } from "./access";
import { calendarOf, formatClock } from "./calendar";
import { ENGINE_EVENTS } from "./engine-pack";
import { orgPower, orgTypeOf } from "./org";
import { labelOf, optionalQuery, optionalService, own, rowOf } from "./pack-kit";
import type { Advice, ReadContext, Rejection } from "./registry";
import { fieldDef, GONE_FIELD, isGone, kindIs, placeOfEntity } from "./scope";
import { typeRowOf } from "./thing-index";
import { findThings, meets } from "./thing-resolve";
import { carriersOf, contentsOf, holderOf, holdersOf, holdsOf, isThing, possessorOf, SHARED_SLOTS, sizeOf, sizeOfDef, slotOf, spotOf, supportOf, whoseOf } from "./things";
import { isDiscoverable, knows } from "./visibility";
import type { Working } from "./working";

/** How an op is resolved: who makes it, whether it was confirmed, and what its made things are salted by. */
export interface ItemOpOptions {
  /** Who makes the change (`made.by`): the writer (`story`, `curator`, `gm`) or a person. */
  by: string;
  /** Confirmed (a GM's edit, an answered chip): only then does a Built-in thing move. */
  confirmed: boolean;
  /** A GM's edit: it may merge a thing the world document defines. */
  gm: boolean;
  /** Made things' ids are drawn from it (the run's seed and the op's place in its edit). */
  salt: string;
  /** Whose knowledge a thing made beside a hidden one is weighed against (the player character by default). */
  viewer?: EntityId;
  /** The longest `why` kept; a longer one is cut. */
  whyMax?: number;
  /**
   * The player's own paths (an action, a ✎ fix): a holder's room and load and how deep things nest
   * count, from Gear 2 (`packs.gear.config.containers`); never the story's read, an agent's or the GM's.
   */
  room?: boolean;
  /** The caller takes advice: where the rules of things would refuse, the op applies and returns the advice (`ItemOpApplied.advice`) instead. */
  advise?: true;
}

/** What a thing being made adds to a holder, before it is in the world: its volume and weight, its count's. */
export interface Adding {
  volumeL: number;
  weightG: number;
}

/**
 * What an applied op did beyond its events: the thing it made, where the size rules put a thing other than asked, what the
 * engine advises on it when the caller opted in (`ItemOpOptions.advise`: the op applies and says what did not add up), and the
 * events that fill in values from the world itself (`filled`: recorded apart from the call's own, with the provenance of a default).
 */
export interface ItemOpApplied {
  made?: EntityId;
  placed?: Spot;
  advice?: Advice[];
  filled?: readonly LedgerEvent[];
}

/** A refused op; a make that found what it would make names it (`exists`). */
export type ItemOpRefusal = Rejection & { exists?: EntityId };

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A note for the GM about the op, on the thing it concerns. */
const note = (text: string, entity: EntityId): LedgerEvent => ({ type: ENGINE_EVENTS.note, data: { text, entity, visibility: "secret" } });

const sameSpot = (a: Spot | Support | null, b: Spot | Support): boolean => a !== null && ("place" in a ? "place" in b && a.place === b.place : "in" in a ? "in" in b && a.in === b.in : "on" in b && a.on === b.on);

/**
 * The one location writer (§3.3): the events that put `thing` at `to` and nowhere else. Out of every
 * holder but the one it goes into, off what it was on but the support it goes onto, off whoever wears
 * it, `place` set or cleared, and its cell laid or picked up (the space pack's). Nothing when it is
 * there already.
 */
export function locate(ctx: ReadContext, thing: EntityId, to: Spot | Support): LedgerEvent[] {
  const e = own(ctx.state.entities, thing);
  if (!e) return [];
  const into = "in" in to ? to.in : null;
  const onto = "on" in to ? to.on : null;
  const place = "place" in to ? to.place : null;
  const holder = e.relations.find((r) => r.type === "in")?.to ?? null;
  const support = e.relations.find((r) => r.type === "on")?.to ?? null;
  const at = typeof e.fields.place === "string" && e.fields.place !== "" ? e.fields.place : null;
  const there = into !== null ? holder === into && support === null && at === null : onto !== null ? support === onto && holder === null && at === null : at === place && holder === null && support === null;
  if (there) return [];
  const out: LedgerEvent[] = [];
  for (const r of e.relations) {
    if (r.type === "in" && r.to !== into) out.push({ type: "unlink", rel: "in", from: thing, to: r.to });
    if (r.type === "on" && r.to !== onto) out.push({ type: "unlink", rel: "on", from: thing, to: r.to });
    if ((r.type === "worn_by" || r.type === "equipped") && r.to !== into) out.push({ type: "unlink", rel: r.type, from: thing, to: r.to });
  }
  if (place !== null) {
    if (at !== place) out.push({ type: "set", entity: thing, field: "place", value: place });
    // Put down by whoever had it, it lies where they stood (a cell, with the grid system on).
    out.push(...(optionalService(ctx, "space.lay")?.(ctx, thing, place, possessorOf(ctx, thing)) ?? []));
    return out;
  }
  if (at !== null) out.push({ type: "set", entity: thing, field: "place", value: null });
  if (into !== null && holder !== into) out.push({ type: "link", rel: "in", from: thing, to: into });
  if (onto !== null && support !== onto) out.push({ type: "link", rel: "on", from: thing, to: onto });
  out.push(...(optionalService(ctx, "space.lay")?.(ctx, thing, null, null) ?? []));
  return out;
}

/** How many holders deep the things inside `thing` go below it (0 for nothing inside), so it never goes in deeper than its holders allow with them. */
function nestDepth(ctx: ReadContext, thing: EntityId, guard = 0): number {
  if (guard >= 32) return 0;
  let deepest = 0;
  for (const inner of contentsOf(ctx.state, thing)) deepest = Math.max(deepest, 1 + nestDepth(ctx, inner, guard + 1));
  return deepest;
}

/**
 * Why a holder that isn't a person can't take `adding` on the player's own paths (`room`, from
 * Gear 2 of whoever does it), or null: it would sit more holders deep than the world's depth
 * (`packs.gear.config.containers.depth`, what it holds counted with it), or, while capacity counts
 * (`refuse`), the holder's room or load can't spare it (the gear pack's `gear.room_problem`).
 */
function roomProblem(ctx: ReadContext, name: string, holder: EntityId, opts: ItemOpOptions, adding: EntityId | Adding): Rejection | null {
  if (opts.room !== true || kindIs(ctx.registry, ctx.world, own(ctx.state.entities, holder)?.kind ?? "", "person")) return null;
  const doer = own(ctx.state.entities, opts.by) ? opts.by : ctx.world.pov;
  if (ctx.levelOf(doer, "gear") < 2) return null;
  const rule = thingsConfigOf(ctx.world).containers;
  const depth = 1 + holdersOf(ctx.state, holder).length + (typeof adding === "string" ? nestDepth(ctx, adding) : 0);
  if (depth > rule.depth) return reject("too_deep", `${name} can't go in ${labelOf(ctx, holder)}: things are packed at most ${rule.depth} deep`);
  if (rule.capacity === "off") return null;
  const problem = optionalQuery(ctx, "gear.room_problem")?.(ctx, holder, adding) ?? null;
  return problem === null ? null : reject("no_room", `${name} ${problem}`);
}

/**
 * Where a thing of `size` called `name` may go when asked to go to `to` (§3.2, §5.3 step 4), or why
 * it can't: a part never leaves its holder (`moving`); a Built-in thing moves only by a confirmed
 * op; a vehicle goes only on another vehicle; nothing goes into what holds nothing, or into a holder
 * smaller than it; a thing above the person ceiling put on someone lands where they stand instead
 * (`noted`). A size nothing says counts as portable, as the story stated the move. On the player's
 * own paths a holder's room, load and depth count too (`roomProblem`): `adding` is the thing moved,
 * or what a thing being made adds.
 */
function landing<S extends Spot | Support>(ctx: ReadContext, name: string, size: SizeClass, to: S, opts: ItemOpOptions, moving: boolean, adding: EntityId | Adding): { spot: S | Spot; noted?: string; advice?: Advice[] } | Rejection {
  const advice: Advice[] = [];
  const dest = "place" in to ? to.place : "in" in to ? to.in : to.on;
  /** A rule of what a change means: refused, or with advice asked, applied as asked and advised (no note sentence is written then). */
  const bend = (rule: Rejection): Rejection | null => {
    if (opts.advise !== true) return rule;
    advice.push({ code: "rule_bent", values: { what: name, where: ref(ctx, dest), code: rule.code } });
    return null;
  };
  const asked = (): { spot: S | Spot; advice?: Advice[] } => ({ spot: to, ...(advice.length > 0 ? { advice } : {}) });
  if (moving && size === "part") {
    const refused = bend(reject("part", `${name} is built into what holds it`));
    if (refused) return refused;
  }
  if (moving && size === "builtin" && !opts.confirmed) {
    const refused = bend(reject("builtin", `${name} is built in: moving it needs a confirmed change`));
    if (refused) return refused;
  }
  if ("on" in to) {
    // What something is on only supports it: no room, size or capacity rule, and nothing to report.
    const support = own(ctx.state.entities, to.on);
    return !support || isGone(ctx.state, to.on) ? reject("missing_entity", `no support ${labelOf(ctx, to.on)}`) : asked();
  }
  if ("place" in to) return own(ctx.world.places, to.place) ? asked() : reject("missing_place", `no place ${labelOf(ctx, to.place)}`);
  const holder = own(ctx.state.entities, to.in);
  if (!holder || isGone(ctx.state, to.in)) return reject("missing_entity", `no holder ${labelOf(ctx, to.in)}`);
  const holds = holdsOf(ctx, to.in);
  if (holds === null) return bend(reject("cant_hold", `${holder.name} can't hold anything`)) ?? asked();
  if (size === "vehicle" && !kindIs(ctx.registry, ctx.world, holder.kind, "vehicle")) {
    const refused = bend(reject("cant_hold", `${name} is a vehicle: it goes only on another vehicle`));
    if (refused) return refused;
  }
  if (size === "unknown" || size === "part" || size === "vehicle" || sizeRank(size) <= sizeRank(holds)) {
    const problem = roomProblem(ctx, name, to.in, opts, adding);
    return problem === null ? asked() : (bend(problem) ?? asked());
  }
  if (kindIs(ctx.registry, ctx.world, holder.kind, "person")) {
    // Above what a person carries: with advice asked it stays in their hands, as asked, and says so.
    if (opts.advise === true) {
      advice.push({ code: "above_carry", values: { what: name, holder: ref(ctx, to.in), size: SIZE_LABELS[size] } });
      return asked();
    }
    const place = placeOfEntity(ctx.state, to.in);
    if (!place) return reject("too_big", `${name} is too big for ${holder.name} to carry, and ${holder.name} is nowhere`);
    return { spot: { place }, noted: `${name} is too big to carry (${SIZE_LABELS[size]}), so it is at ${labelOf(ctx, place)} rather than on ${holder.name}.` };
  }
  return bend(reject("too_big", `${name} is too big for ${holder.name}, which takes things up to ${SIZE_LABELS[holds]}`)) ?? asked();
}

/** A thing or a place as an advice names it: its name and its id, as the answers say a name. */
function ref(ctx: ReadContext, id: string): string {
  return `${labelOf(ctx, id)} [${id}]`;
}

/** The advice for an end that is not after now: what it is on, who has it, and the end as the world prints it. */
function endsBeforeNow(ctx: ReadContext, what: string, who: string, until: number): Advice {
  return { code: "ends_before_now", values: { what, who, until: formatClock(calendarOf(ctx.world), Math.round(until)) } };
}

/**
 * A condition changed with advice asked: applied as given, never held to the field's bounds (advised past them with the bounds),
 * and counted from what is recorded or the field's own default, which is returned apart as filled in; with neither, no number is
 * invented: nothing is applied, and the advice says it has no value to change.
 */
function conditionAdvised(w: Working, op: Extract<ItemOp, { do: "condition" }>, name: string, def: FieldDef | undefined): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, op.item);
  const recorded = typeof e?.fields.condition === "number" ? e.fields.condition : undefined;
  const start = recorded ?? (typeof def?.default === "number" ? def.default : undefined);
  if (start === undefined) return { advice: [{ code: "no_condition", values: { what: ref(ctx, op.item) } }] };
  const next = start + op.delta;
  const filled: LedgerEvent[] = recorded === undefined ? [{ type: "set", entity: op.item, field: "condition", value: start }] : [];
  const bad = applyAll(w, [...filled, { type: "add", entity: op.item, field: "condition", delta: op.delta }]);
  if (bad) return bad;
  const outside = (def?.min !== undefined && next < def.min) || (def?.max !== undefined && next > def.max);
  const advice: Advice[] = outside && def !== undefined ? [{ code: "off_the_sheet", values: { key: "condition", name, value: next, type: def.type, ...(def.min !== undefined ? { min: def.min } : {}), ...(def.max !== undefined ? { max: def.max } : {}) } }] : [];
  return { ...(filled.length > 0 ? { filled } : {}), ...(advice.length > 0 ? { advice } : {}) };
}

/** A why as kept: trimmed, and cut at the caller's length; none when it says nothing. */
function whyOf(why: string, opts: ItemOpOptions): string | undefined {
  const text = why.trim();
  if (text === "") return undefined;
  return opts.whyMax !== undefined && text.length > opts.whyMax ? text.slice(0, Math.max(0, opts.whyMax)) : text;
}

/** Applies events in order; the first rejection refuses the op. */
function applyAll(w: Working, events: readonly LedgerEvent[]): Rejection | null {
  for (const ev of events) {
    const rejection = w.apply(ev);
    if (rejection) return rejection;
  }
  return null;
}

/**
 * Moves a thing as asked, by the size rules, and writes who has it now (§3.3, §5.3 step 5): their
 * `got` (`how`, else what their right to it says: back with an owner clears it, a thing they may use
 * is fetched, or found while it was hidden from them, and one they may not use is taken), and the
 * end of the hold whoever had it held for its owner.
 */
function moveThing(w: Working, thing: EntityId, to: Spot | Support, opts: ItemOpOptions, why: string, how: GotHow | null): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, thing);
  if (!e) return reject("missing_entity", `no thing ${labelOf(ctx, thing)}`);
  // A thing both lying at a place and in a holder (from before one writer kept them apart) reads at its place, but a move there still takes it out of the holder.
  const twice = typeof e.fields.place === "string" && e.fields.place !== "" && e.relations.some((r) => r.type === "in");
  const resting = supportOf(ctx.state, thing);
  const already = "on" in to ? resting === to.on && holderOf(ctx.state, thing) === null : "place" in to ? resting === null && sameSpot(spotOf(ctx.state, thing), to) : sameSpot(spotOf(ctx.state, thing), to);
  if (already && !twice) return reject("no_change", `${e.name} is there already`);
  if ("in" in to && (to.in === thing || holdersOf(ctx.state, to.in).includes(thing))) return reject("cycle", `${e.name} can't go inside ${labelOf(ctx, to.in)}`);
  if ("on" in to && (to.on === thing || carriersOf(ctx.state, to.on).includes(thing))) return reject("cycle", `${e.name} can't go on ${labelOf(ctx, to.on)}`);
  const where = landing(ctx, e.name, sizeOf(ctx, thing).size, to, opts, true, thing);
  if ("code" in where) return where;
  const advice: Advice[] = [...(where.advice ?? [])];
  // Its own typed facts disagreed about where it was: it was at a place and in a holder at once.
  if (opts.advise === true && twice) advice.push({ code: "in_two_places", values: { what: ref(ctx, thing), holder: ref(ctx, e.relations.find((r) => r.type === "in")?.to ?? ""), where: ref(ctx, String(e.fields.place)) } });
  const before = possessorOf(ctx, thing);
  const hidden = isDiscoverable(ctx.world, ctx.state, thing);
  const laid = locate(ctx, thing, where.spot);
  const moved = applyAll(w, [...laid, ...(where.noted ? [note(where.noted, thing)] : [])]);
  if (moved) return moved;
  // A square code gave it (it lies where whoever put it down stood) is recorded apart, as a default.
  const squares = laid.filter((ev) => ev.type === "space.pos" && "data" in ev && ev.data.at !== null);
  const after = possessorOf(ctx, thing);
  const events: LedgerEvent[] = [];
  if (after !== before) {
    // Taken from the hands of someone who is not where it goes: noticed, never refused.
    if (opts.advise === true && before !== null) {
      const theirs = placeOfEntity(ctx.state, before);
      const there = "place" in where.spot ? where.spot.place : placeOfEntity(ctx.state, "in" in where.spot ? where.spot.in : where.spot.on);
      if (theirs !== null && there !== null && theirs !== there) advice.push({ code: "taken_from", values: { what: ref(ctx, thing), holder: ref(ctx, before), where: ref(ctx, theirs) } });
    }
    // A hold ends with the holding: whoever held it for its owner no longer does.
    if (before !== null && own(ctx.state.entities, before)?.relations.some((r) => r.type === "uses" && r.to === thing && r.fields?.basis === "hold")) events.push({ type: "unlink", rel: "uses", from: before, to: thing });
    if (after !== null) {
      const owners = ownersIn(own(ctx.state.entities, thing)?.fields ?? {}).map((o) => o.party);
      const kind: GotHow | null = how ?? (owners.includes(after) ? null : accessFor(ctx, after, thing).use === null ? "took" : hidden && !knows(ctx.state, after, thing) ? "found" : "fetched");
      const text = whyOf(why, opts);
      const got: Got | null = kind === null ? null : { how: kind, at: ctx.state.clock, ...(before !== null ? { from: before } : {}), ...(text !== undefined ? { why: text } : {}) };
      if (got !== null || own(ctx.state.entities, thing)?.fields.got !== undefined) events.push({ type: "set", entity: thing, field: "got", value: got as unknown as JsonValue });
    }
  }
  const done = applyAll(w, events);
  if (done) return done;
  return { ...(sameSpot(where.spot, to) || "on" in where.spot ? {} : { placed: where.spot }), ...(advice.length > 0 ? { advice } : {}), ...(squares.length > 0 ? { filled: squares } : {}) };
}

/** Every use grant on a thing, and its overdue flag, ended (it is back with its owner, or has a new one). */
function endGrants(ctx: ReadContext, thing: EntityId): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) for (const r of own(ctx.state.entities, id)?.relations ?? []) if (r.type === "uses" && r.to === thing) out.push({ type: "unlink", rel: "uses", from: id, to: thing });
  if (own(ctx.state.entities, thing)?.fields.overdue === true) out.push({ type: "set", entity: thing, field: "overdue", value: false });
  return out;
}

/**
 * The events that make a thing `owner`'s (or nobody's): its `owner`, or, for a thing whose owners
 * are a list (a vehicle, an asset with shares), that list replaced by the one owner, or emptied.
 */
function ownerEvents(ctx: ReadContext, thing: EntityId, owner: EntityId | null): LedgerEvent[] {
  const e = own(ctx.state.entities, thing);
  if (!Array.isArray(e?.fields.owners)) return [{ type: "set", entity: thing, field: "owner", value: owner }];
  const out: LedgerEvent[] = [{ type: "set", entity: thing, field: "owners", value: owner === null ? [] : [{ party: owner, role: "owner" }] }];
  if (typeof e.fields.owner === "string") out.push({ type: "set", entity: thing, field: "owner", value: owner });
  return out;
}

/** Why an id the op names isn't a thing in the world, or null. */
function thingProblem(ctx: ReadContext, id: EntityId): Rejection | null {
  if (!own(ctx.state.entities, id) || isGone(ctx.state, id)) return reject("missing_entity", `no thing ${labelOf(ctx, id)}`);
  return isThing(ctx, id) ? null : reject("not_a_thing", `${labelOf(ctx, id)} isn't a thing`);
}

/** Why a party the op names (an owner, a grantee, a permitter) isn't one in the world, or null. */
function partyProblem(ctx: ReadContext, id: EntityId): Rejection | null {
  return own(ctx.state.entities, id) && !isGone(ctx.state, id) ? null : reject("missing_entity", `no one ${labelOf(ctx, id)}`);
}

/** A made thing's id: its name's slug and a digest of the salt, never one the state has. */
function madeId(ctx: ReadContext, name: string, salt: string): EntityId {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "thing";
  for (let n = 0; ; n++) {
    const id = `thing_${slug}_${hashParts("lre.thing", salt, name, String(n)).slice(0, 8)}`;
    if (!own(ctx.state.entities, id)) return id;
  }
}

/** A rest as a thing's `home` field stores it: a place's or a holder's id, or "owner". */
function restValue(rest: Rest): JsonValue {
  return rest === "owner" ? "owner" : "place" in rest ? rest.place : rest.in;
}

/** Why a rest can't be one: a place or a holder the world doesn't have. */
function restProblem(ctx: ReadContext, rest: Rest): Rejection | null {
  if (rest === "owner") return null;
  if ("place" in rest) return own(ctx.world.places, rest.place) ? null : reject("missing_place", `no place ${labelOf(ctx, rest.place)}`);
  return own(ctx.state.entities, rest.in) && holdsOf(ctx, rest.in) !== null ? null : reject("cant_hold", `${labelOf(ctx, rest.in)} can't hold anything`);
}

/**
 * A made thing's type (§5.3 step 3): a gear row of its noun naming it in full, else the price
 * catalog's row (`economy.thing_type`: goods, food and drink, never a service), else a gear row of
 * its noun; with the row's price where it is made, and whether it is food or drink. The reconciler's
 * makes read it, and so does `make` given neither a type nor a size.
 */
export function thingTypeFor(ctx: ReadContext, name: string, place: PlaceId | null): { type?: string; cents: number | null; food: boolean } {
  const key = nameKey(name);
  if (!key) return { cents: null, food: false };
  let full: string | undefined;
  let head: { id: string; score: number } | undefined;
  for (const table of ["gear.items", "gear.containers"]) {
    for (const [id, row] of Object.entries(ctx.tables.get(table)?.rows ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const rowKey = nameKey(typeof row.name === "string" ? row.name : id);
      const m = rowKey ? meets(key, rowKey) : null;
      if (!m || !rowKey) continue;
      if (m === "full" && full === undefined) full = id;
      const score = key.words.filter((w) => rowKey.words.includes(w)).length;
      if (!head || score > head.score) head = { id, score };
    }
  }
  const gearCents = (id: string): number | null => {
    const band = typeRowOf(ctx, { catalog: id })?.row.price_cents;
    const typical = band && typeof band === "object" && !Array.isArray(band) ? (band as JsonObject).typical : undefined;
    return typeof typical === "number" ? typical : null;
  };
  if (full !== undefined) return { type: full, cents: gearCents(full), food: false };
  const sold = optionalQuery(ctx, "economy.thing_type")?.(ctx, name, place) ?? null;
  if (sold) return { type: sold.catalog, cents: sold.cents, food: sold.food };
  return head ? { type: head.id, cents: gearCents(head.id), food: false } : { cents: null, food: false };
}

/**
 * A vehicle made (§28.8, `make` with a `class`): the vehicles pack makes it of its class (`vehicles.spawn`), its owner's, with its
 * details, standing where it is made: at the place, on a vehicle it rides on, or where the person it is made on stands. With no
 * advice asked, one of its name already standing there is found, not made again; with it, a new one is made and the ones there
 * are named in the advice. With advice asked, a world with no vehicles pack makes it as a plain thing with its class kept, and
 * someone it is made on who is nowhere has it made with no place; each says so.
 */
function makeVehicle(w: Working, op: Extract<ItemOp, { do: "make" }>, vehicleClass: string, opts: ItemOpOptions): ItemOpApplied | ItemOpRefusal {
  const ctx = w.ctx;
  const advising = opts.advise === true;
  const spawn = optionalService(ctx, "vehicles.spawn");
  const name = op.name.trim();
  if (!spawn) {
    if (!advising) return reject("no_vehicles", "this world plays no vehicles");
    const { class: _class, ...plain } = op;
    const made = make(w, plain, opts, vehicleClass);
    if ("code" in made) return made;
    return { ...made, advice: [...(made.advice ?? []), { code: "made_as_thing", values: { name, class: vehicleClass } }] };
  }
  const problem = (op.owner !== undefined ? partyProblem(ctx, op.owner) : null) ?? (op.home !== undefined && op.home !== "owner" && "place" in op.home ? restProblem(ctx, op.home) : null);
  if (problem) return problem;
  const advice: Advice[] = [];
  let at: Spot | undefined;
  if (op.at === undefined) at = undefined;
  else if ("place" in op.at) {
    if (!own(ctx.world.places, op.at.place)) return { ...reject("missing_place", `no place ${labelOf(ctx, op.at.place)}`), said: op.at.place, choices: Object.keys(ctx.world.places) };
    at = op.at;
  } else {
    const holder = own(ctx.state.entities, op.at.in);
    if (!holder || isGone(ctx.state, op.at.in)) return { ...reject("missing_entity", `no holder ${labelOf(ctx, op.at.in)}`), said: op.at.in, choices: Object.keys(ctx.state.entities) };
    const place = placeOfEntity(ctx.state, op.at.in);
    if (kindIs(ctx.registry, ctx.world, holder.kind, "vehicle")) at = op.at;
    else if (place !== null) at = { place };
    else if (advising) {
      at = undefined;
      advice.push({ code: "holder_nowhere", values: { name, holder: ref(ctx, op.at.in) } });
    } else return reject("missing_place", `${holder.name} is nowhere`);
  }
  const place = at === undefined ? null : "place" in at ? at.place : placeOfEntity(ctx.state, at.in);
  const viewer = opts.viewer ?? ctx.world.pov;
  const same = name === "" || place === null ? [] : findThings(ctx, name, { actor: viewer, viewer, scope: "all" }).filter((c) => c.full && sizeOf(ctx, c.id).size === "vehicle" && placeOfEntity(ctx.state, c.id) === place);
  const seen = same.find((c) => !c.secret);
  if (seen && !advising) return { ...reject("exists", `${labelOf(ctx, seen.id)} is already there`), exists: seen.id };
  if (advising && same.length > 0) advice.push({ code: "same_name", values: { name, same: same.map((c) => ref(ctx, c.id)).join(", ") } });
  const fields: JsonObject = { made: { by: opts.by, ...(at !== undefined ? { at } : {}) } as unknown as JsonValue };
  const description = op.description?.trim() ?? "";
  if (description !== "") fields.description = description;
  const aliases = (op.aliases ?? []).map((a) => a.trim()).filter((a) => a !== "");
  if (aliases.length > 0) fields.aliases = aliases;
  const home = op.home !== undefined && op.home !== "owner" && "place" in op.home ? op.home.place : undefined;
  const made = spawn(ctx, { class: vehicleClass, ...(name !== "" ? { name } : {}), owner: op.owner ?? null, ...(at === undefined ? {} : "in" in at ? { holder: at.in } : { place: at.place }), ...(home !== undefined ? { home } : {}), ...(op.details !== undefined ? { details: op.details } : {}), salt: opts.salt, fields });
  if ("code" in made) return made;
  const rejection = applyAll(w, made.events);
  if (rejection) return rejection;
  return { made: made.entity, ...(at !== undefined && op.at !== undefined && !sameSpot(at, op.at) ? { placed: at } : {}), ...(advice.length > 0 ? { advice } : {}) };
}

/**
 * A thing made (§5.3). Nothing about it is read from its name: no type, size, weight or room is guessed from words, and a name
 * is any length. A type it is given comes back apart (`filled`): the row's values, for the caller to record as filled in. With no
 * advice asked, a thing of its name already there stands for it (`exists`); with it, a new one is made and the ones there are named
 * in the advice. With no spot (`at`), it is made with no place and no holder. `kept` is the class of a vehicle made as a plain thing.
 */
function make(w: Working, op: Extract<ItemOp, { do: "make" }>, opts: ItemOpOptions, kept?: string): ItemOpApplied | ItemOpRefusal {
  if (op.class !== undefined) return makeVehicle(w, op, op.class, opts);
  const ctx = w.ctx;
  const advising = opts.advise === true;
  const name = op.name.trim();
  if (name === "") return reject("bad_name", "a name is not empty");
  const problem = (op.owner !== undefined ? partyProblem(ctx, op.owner) : null) ?? (op.home !== undefined ? restProblem(ctx, op.home) : null);
  if (problem) return problem;
  if (op.qty !== undefined && !(Number.isInteger(op.qty) && op.qty >= 1)) return reject("bad_amount", "a quantity is a whole number of at least 1");
  const at = op.at;
  if (at !== undefined && "in" in at && !own(ctx.state.entities, at.in)) return { ...reject("missing_entity", `no holder ${labelOf(ctx, at.in)}`), said: at.in, choices: Object.keys(ctx.state.entities) };
  // The things of that name where it is made (on whoever holds it, or anywhere around the place, wherever the viewer is).
  const near = at !== undefined && "in" in at ? (kindIs(ctx.registry, ctx.world, own(ctx.state.entities, at.in)?.kind ?? "", "person") ? at.in : possessorOf(ctx, at.in)) : null;
  const place = at === undefined ? null : "place" in at ? at.place : placeOfEntity(ctx.state, at.in);
  const viewer = opts.viewer ?? ctx.world.pov;
  const found = at === undefined ? [] : findThings(ctx, name, { actor: near ?? viewer, viewer, scope: near !== null ? "on" : "all", ...(op.owner !== undefined ? { owner: op.owner } : {}) }).filter((c) => c.full && (near !== null || (place !== null && placeOfEntity(ctx.state, c.id) === place)));
  const seen = found.find((c) => !c.secret);
  if (seen && !advising) return { ...reject("exists", `${labelOf(ctx, seen.id)} is already there`), exists: seen.id };
  const advice: Advice[] = [];
  if (advising && found.length > 0) advice.push({ code: "same_name", values: { name, same: found.map((c) => ref(ctx, c.id)).join(", ") } });
  // A type is the caller's to give: none is read from the words of a name.
  const row = op.type !== undefined ? typeRowOf(ctx, { catalog: op.type }) : null;
  if (op.type !== undefined && !row) return reject("missing_type", `no type ${op.type} in the catalogs`);
  const typed = row && op.type !== undefined ? typeFields(row.table, op.type, row.row) : null;
  // Said to hold things, a thing of no type of its own is a container.
  const kind = typed?.kind ?? (op.holds !== undefined ? "container" : "item");
  // What the call says, apart from what its type's row gives.
  const fields: JsonObject = {};
  if (op.owner !== undefined) fields.owner = op.owner;
  if (op.size !== undefined) fields.size = op.size;
  if (op.holds !== undefined) fields.holds = op.holds;
  if (op.category !== undefined) fields.category = op.category;
  const description = op.description?.trim() ?? "";
  if (description !== "") fields.description = description;
  if (op.home !== undefined) fields.home = restValue(op.home);
  if (op.qty !== undefined && op.qty !== 1) fields.qty = op.qty;
  const aliases = (op.aliases ?? []).map((a) => a.trim()).filter((a) => a !== "");
  if (aliases.length > 0) fields.aliases = aliases;
  if (op.hidden === true) fields.visibility = "discoverable";
  if (kept !== undefined) fields.vehicle_class = kept;
  // A hidden one it may be (a player can't tell it is), weighed for Tidy up rather than found: only for a caller that takes no advice.
  const maybe = found.find((c) => c.secret);
  if (maybe && !advising) fields.maybe_same_as = maybe.id;
  const rowFields = Object.fromEntries(Object.entries(typed?.fields ?? {}).filter(([key]) => !Object.hasOwn(fields, key)));
  const whole = { ...rowFields, ...fields };
  const count = op.qty ?? 1;
  const adding: Adding = { volumeL: (typeof whole.volume_l === "number" ? whole.volume_l : 0) * count, weightG: (typeof whole.weight_g === "number" ? whole.weight_g : 0) * count };
  const where = at === undefined ? null : landing(ctx, name, sizeOfDef(ctx, kind, whole, name).size, at, opts, false, adding);
  if (where !== null && "code" in where) return where;
  const id = madeId(ctx, name, opts.salt);
  fields.made = { by: opts.by, ...(where !== null ? { at: where.spot } : {}) } as unknown as JsonValue;
  // Made on someone, it is theirs to have (`got`), as anything made in their hands.
  const spot = where?.spot;
  const holder = spot !== undefined && "in" in spot ? spot.in : null;
  const possessor = holder === null ? null : kindIs(ctx.registry, ctx.world, own(ctx.state.entities, holder)?.kind ?? "", "person") ? holder : possessorOf(ctx, holder);
  const why = whyOf(op.why, opts);
  if (possessor !== null) fields.got = { how: "made", at: ctx.state.clock, ...(why !== undefined ? { why } : {}) } as unknown as JsonValue;
  if (spot !== undefined && "place" in spot) fields.place = spot.place;
  const entity: EntityDef = { id, kind, name, tier: "background", fields, relations: holder !== null ? [{ type: "in", to: holder }] : [] };
  // The row's values are set after it is made, each its own change, so the caller records them as filled in.
  const filled: LedgerEvent[] = Object.entries(rowFields).map(([field, value]): LedgerEvent => ({ type: "set", entity: id, field, value }));
  const rejection = applyAll(w, [{ type: "spawn", entity }, ...(where?.noted ? [note(where.noted, id)] : []), ...filled]);
  if (rejection) return rejection;
  if (where?.advice !== undefined) advice.push(...where.advice);
  return { made: id, ...(spot !== undefined && at !== undefined && !sameSpot(spot, at) ? { placed: spot } : {}), ...(advice.length > 0 ? { advice } : {}), ...(filled.length > 0 ? { filled } : {}) };
}

/** The grant a hold or a loan brings: a loan to one who isn't an owner; a hold only to one who may not use it already (§3.4), so staff handed the shop's tool at the shop hold it as staff and no more. */
function handGrant(ctx: ReadContext, op: Extract<ItemOp, { do: "hand" }>, by: EntityId | null): LedgerEvent[] {
  if (!((op.basis === "loan" && !whoseOf(ctx, op.item).owners.includes(op.to)) || (op.basis === "hold" && accessFor(ctx, op.to, op.item).use === null))) return [];
  return [{ type: "link", rel: "uses", from: op.to, to: op.item, fields: { basis: op.basis, ...(by !== null ? { by } : {}) }, ...(op.until !== undefined ? { until: Math.round(op.until) } : {}) }];
}

function hand(w: Working, op: Extract<ItemOp, { do: "hand" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const advising = opts.advise === true;
  const to = own(ctx.state.entities, op.to);
  if (!to || isGone(ctx.state, op.to) || !kindIs(ctx.registry, ctx.world, to.kind, "person")) return reject("not_a_person", `${labelOf(ctx, op.to)} can't be handed anything`);
  const advice: Advice[] = [];
  // With advice asked, an end not after now is recorded as given and advised, never refused.
  if (op.until !== undefined && !(op.until > ctx.state.clock)) {
    if (!advising) return reject("bad_until", "a loan's end is after now");
    advice.push(endsBeforeNow(ctx, ref(ctx, op.item), ref(ctx, op.to), op.until));
  }
  const e = own(ctx.state.entities, op.item);
  if (!e) return reject("missing_entity", `no thing ${labelOf(ctx, op.item)}`);
  const giver = possessorOf(ctx, op.item);
  const owners = ownersIn(e.fields).map((o) => o.party);
  // A return goes back to the owner, or to one of an owning household's or group's own; to anyone else, with advice asked, it is recorded as a return all the same.
  const owed = op.basis !== "return" || owners.some((o) => o === op.to || (orgTypeOf(ctx, o) !== null && orgPower(ctx, op.to, o, "assets.use") !== null));
  if (!owed) {
    if (!advising) return reject("not_owner", `${e.name} goes back to its owner, not ${to.name}`);
    advice.push({ code: "returned_not_owner", values: { what: ref(ctx, op.item), to: ref(ctx, op.to) } });
  }
  const newOwner = op.basis === "gift" || op.basis === "sale" || op.basis === "trade";
  const owning = newOwner && !(owners.length === 1 && owners[0] === op.to) ? ownerEvents(ctx, op.item, op.to) : [];
  // A vehicle changes hands where it stands (§28.8): its basis applies in place, nobody carrying it.
  if (sizeOf(ctx, op.item).size === "vehicle") {
    if (op.basis === "theft" && !advising) return reject("cant_hold", `${e.name} is a vehicle: it is taken by driving it off, not by hand`);
    const by = own(ctx.state.entities, opts.by) ? opts.by : (owners.find((o) => own(ctx.state.entities, o) !== undefined) ?? null);
    // A theft takes it as someone who holds it, owner unchanged.
    const events = newOwner || op.basis === "return" ? [...endGrants(ctx, op.item), ...owning] : op.basis === "theft" ? [{ type: "link" as const, rel: "uses", from: op.to, to: op.item, fields: { basis: "hold", ...(by !== null ? { by } : {}) } }] : handGrant(ctx, op, by);
    if (events.length === 0) return reject("no_change", `${to.name} may use ${e.name} already`);
    const bad = applyAll(w, events);
    if (bad) return bad;
    if (advising) advice.push({ code: "not_taken_in_hand", values: { what: ref(ctx, op.item) } });
    return advice.length > 0 ? { advice } : {};
  }
  const how: Record<typeof op.basis, GotHow | null> = { hold: "holding", loan: "loan", return: null, gift: "given", sale: "bought", trade: "bought", theft: "took" };
  const moved = moveThing(w, op.item, { in: op.to }, opts, op.why, how[op.basis]);
  if ("code" in moved) return moved;
  const events = newOwner || op.basis === "return" ? [...endGrants(ctx, op.item), ...owning] : handGrant(ctx, op, giver);
  const bad = applyAll(w, events);
  if (bad) return bad;
  const all = [...(moved.advice ?? []), ...advice];
  return { ...moved, ...(all.length > 0 ? { advice: all } : {}) };
}

function grant(w: Working, op: Extract<ItemOp, { do: "grant" | "revoke" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const missing = partyProblem(ctx, op.who) ?? (op.by !== undefined ? partyProblem(ctx, op.by) : null);
  if (missing) return missing;
  if (op.do === "revoke") return applyAll(w, [{ type: "unlink", rel: "uses", from: op.who, to: op.item }]) ?? {};
  // With advice asked, an end not after now is recorded as given and advised, never refused.
  const past = op.until !== undefined && !(op.until > ctx.state.clock);
  if (past && opts.advise !== true) return reject("bad_until", "a grant's end is after now");
  const basis = op.basis ?? (op.until !== undefined ? "loan" : "assign");
  const events: LedgerEvent[] = [{ type: "link", rel: "uses", from: op.who, to: op.item, fields: { basis, ...(op.by !== undefined ? { by: op.by } : {}) }, ...(op.until !== undefined ? { until: Math.round(op.until) } : {}) }];
  // From someone it isn't theirs to lend, it lands with its giver, flagged for the GM (§3.4).
  if (op.by !== undefined && assignFor(ctx, op.by, op.item) === null) events.push(note(`${labelOf(ctx, op.by)} let ${labelOf(ctx, op.who)} use ${labelOf(ctx, op.item)}, though it isn't theirs to lend.`, op.item));
  const bad = applyAll(w, events);
  if (bad) return bad;
  return past && op.until !== undefined ? { advice: [endsBeforeNow(ctx, ref(ctx, op.item), ref(ctx, op.who), op.until)] } : {};
}

function permit(w: Working, op: Extract<ItemOp, { do: "permit" | "unpermit" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const missing = partyProblem(ctx, op.from) ?? partyProblem(ctx, op.to) ?? (op.by !== undefined ? partyProblem(ctx, op.by) : null);
  if (missing) return missing;
  if (op.from === op.to) return reject("self", `${labelOf(ctx, op.from)} needs no leave of their own`);
  if (op.do === "unpermit") return applyAll(w, [{ type: "unlink", rel: "permits", from: op.from, to: op.to }]) ?? {};
  // With advice asked, an end not after now is recorded as given and advised, never refused.
  const past = op.until !== undefined && !(op.until > ctx.state.clock);
  if (past && opts.advise !== true) return reject("bad_until", "a permission's end is after now");
  const events: LedgerEvent[] = [{ type: "link", rel: "permits", from: op.from, to: op.to, fields: { scope: op.scope ?? "all", ...(op.by !== undefined ? { by: op.by } : {}) }, ...(op.until !== undefined ? { until: Math.round(op.until) } : {}) }];
  // Given on an organization's behalf by someone without the say over its things: flagged for the GM.
  if (op.by !== undefined && op.by !== op.from && (orgTypeOf(ctx, op.from) === null || orgPower(ctx, op.by, op.from, "assets.assign") === null)) events.push(note(`${labelOf(ctx, op.by)} let ${labelOf(ctx, op.to)} use what is ${labelOf(ctx, op.from)}'s, without the say to.`, op.from));
  const bad = applyAll(w, events);
  if (bad) return bad;
  return past && op.until !== undefined ? { advice: [endsBeforeNow(ctx, ref(ctx, op.from), ref(ctx, op.to), op.until)] } : {};
}

function wear(w: Working, op: Extract<ItemOp, { do: "wear" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, op.item);
  const who = own(ctx.state.entities, op.who);
  if (!e || !who || !kindIs(ctx.registry, ctx.world, who.kind, "person")) return reject("not_a_person", `${labelOf(ctx, op.who)} can't wear anything`);
  const worn = e.relations.filter((r) => (r.type === "worn_by" || r.type === "equipped") && r.to === op.who);
  const unworn = worn.map((r): LedgerEvent => ({ type: "unlink", rel: r.type, from: op.item, to: op.who }));
  if (op.off === true) return worn.length === 0 ? reject("not_worn", `${who.name} isn't wearing ${e.name}`) : (applyAll(w, unworn) ?? {});
  // The slot it goes in: the one asked (`slot`: "hand_held" readies it in hand), else its own.
  const ownSlot = slotOf(ctx, e.fields);
  const slot = op.slot ?? ownSlot;
  if (slot === null || slot === "none") return reject("no_slot", `${e.name} isn't worn`);
  if (op.slot !== undefined && op.slot !== ownSlot && op.slot !== "hand_held" && rowOf(ctx, "gear.slots", op.slot) === undefined) return reject("bad_slot", `there is no ${op.slot.replace(/_/g, " ")} slot`);
  // Worn already: in that slot it is so; in another, it moves to this one.
  if (worn.length > 0 && (op.slot === undefined || worn.some((r) => r.fields?.slot === slot))) return reject("no_change", `${who.name} already wears ${e.name}`);
  let carried: Advice[] = [];
  if (holdersOf(ctx.state, op.item)[0] !== op.who) {
    const moved = moveThing(w, op.item, { in: op.who }, opts, "", null);
    if ("code" in moved) return moved;
    if (moved.placed) return reject("too_big", `${e.name} is too big to wear`);
    carried = moved.advice ?? [];
  }
  // Whatever holds the slot already comes off and stays carried (§10.3); pockets and hands hold several.
  const rel = slot === "hand_held" ? "equipped" : "worn_by";
  const taken = hasOwn(SHARED_SLOTS, slot) ? [] : Object.keys(ctx.state.entities).sort().filter((id) => id !== op.item && own(ctx.state.entities, id)?.relations.some((r) => r.type === rel && r.to === op.who && r.fields?.slot === slot));
  const bad = applyAll(w, [...unworn, ...taken.map((id): LedgerEvent => ({ type: "unlink", rel, from: id, to: op.who })), { type: "link", rel, from: op.item, to: op.who, fields: { slot } }]);
  if (bad) return bad;
  return carried.length > 0 ? { advice: carried } : {};
}

function merge(w: Working, op: Extract<ItemOp, { do: "merge" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  if (op.keep === op.drop) return reject("self", "a thing merges with another");
  const missing = thingProblem(ctx, op.keep);
  if (missing) return missing;
  // Things made in play only: merging one the world document defines is the GM's (§6.1).
  if (own(ctx.world.entities, op.drop) && !opts.gm) return reject("authored", `${labelOf(ctx, op.drop)} is the world's own: merging it is the GM's`);
  const drop = own(ctx.state.entities, op.drop);
  const keep = own(ctx.state.entities, op.keep);
  if (!drop || !keep) return reject("missing_entity", `no thing ${labelOf(ctx, op.drop)}`);
  // What is inside the dropped one goes into the one kept, so the kept one may not be among it.
  if (holdersOf(ctx.state, op.keep).includes(op.drop)) return reject("cycle", `${drop.name} holds ${keep.name}, so it can't merge into it`);
  // Its quantity, its grants and what is inside it go to the one kept.
  const qty = typeof drop.fields.qty === "number" ? drop.fields.qty : 1;
  const events: LedgerEvent[] = [typeof keep.fields.qty === "number" ? { type: "add", entity: op.keep, field: "qty", delta: qty } : { type: "set", entity: op.keep, field: "qty", value: 1 + qty }];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    for (const r of own(ctx.state.entities, id)?.relations ?? []) {
      if (r.type === "uses" && r.to === op.drop) events.push({ type: "unlink", rel: "uses", from: id, to: op.drop }, { type: "link", rel: "uses", from: id, to: op.keep, ...(r.fields ? { fields: r.fields } : {}), ...(r.until !== undefined ? { until: r.until } : {}) });
    }
  }
  const granted = applyAll(w, events);
  if (granted) return granted;
  for (const inner of [...contentsOf(ctx.state, op.drop)]) {
    const moved = applyAll(w, locate(ctx, inner, { in: op.keep }));
    if (moved) return moved;
  }
  const tail: LedgerEvent[] = [{ type: "set", entity: op.drop, field: "merged_into", value: op.keep }, { type: "set", entity: op.drop, field: GONE_FIELD, value: true }];
  if (keep.fields.maybe_same_as === op.drop) tail.push({ type: "set", entity: op.keep, field: "maybe_same_as", value: null });
  return applyAll(w, tail) ?? {};
}

function lose(w: Working, op: Extract<ItemOp, { do: "lose" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, op.item);
  if (!e) return reject("missing_entity", `no thing ${labelOf(ctx, op.item)}`);
  if (e.fields.lost === true) return reject("already_lost", `${e.name} is already lost`);
  // Stolen: into the thief's hands, still its owner's.
  if (op.by !== undefined) {
    const thief = own(ctx.state.entities, op.by);
    if (!thief || !kindIs(ctx.registry, ctx.world, thief.kind, "person")) return reject("not_a_person", `${labelOf(ctx, op.by)} can't take anything`);
    return moveThing(w, op.item, { in: op.by }, opts, "", "took");
  }
  // Lost: whereabouts unknown, and the cash in it with it.
  const events: LedgerEvent[] = [];
  const money = optionalService(ctx, "economy.lose");
  if (money) {
    const lost = money(ctx, op.item);
    if (!Array.isArray(lost)) return lost;
    events.push(...lost);
  }
  for (const r of e.relations) if (r.type === "in" || r.type === "worn_by" || r.type === "equipped") events.push({ type: "unlink", rel: r.type, from: op.item, to: r.to });
  events.push({ type: "set", entity: op.item, field: "lost", value: true });
  if (typeof e.fields.place === "string") events.push({ type: "set", entity: op.item, field: "place", value: null });
  return applyAll(w, events) ?? {};
}

function label(w: Working, op: Extract<ItemOp, { do: "label" }>): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, op.item);
  if (!e) return reject("missing_entity", `no thing ${labelOf(ctx, op.item)}`);
  const events: LedgerEvent[] = [];
  if (op.name !== undefined) {
    const name = op.name.trim();
    if (name === "") return reject("bad_name", "a name is not empty");
    if (name !== e.name) events.push({ type: ENGINE_EVENTS.rename, data: { entity: op.item, name, was: e.name } });
  }
  const aliases = op.aliases?.map((a) => a.trim()).filter((a) => a !== "");
  if (aliases !== undefined && JSON.stringify(aliases) !== JSON.stringify(e.fields.aliases ?? [])) events.push({ type: "set", entity: op.item, field: "aliases", value: aliases });
  if (op.description !== undefined && op.description.trim() !== (e.fields.description ?? "")) events.push({ type: "set", entity: op.item, field: "description", value: op.description.trim() });
  if (op.size !== undefined && op.size !== e.fields.size) events.push({ type: "set", entity: op.item, field: "size", value: op.size });
  // A vehicle's free specs, the whole list at once; an empty one clears them.
  if (op.specs !== undefined) {
    if (!kindIs(ctx.registry, ctx.world, e.kind, "vehicle")) return reject("not_a_vehicle", `${e.name} isn't a vehicle; only a vehicle has specs`);
    const specs = op.specs.length > 0 ? op.specs.map((s) => ({ label: s.label, value: s.value })) : null;
    if (JSON.stringify(specs) !== JSON.stringify(e.fields.specs ?? null)) events.push({ type: "set", entity: op.item, field: "specs", value: specs });
  }
  if (events.length === 0) return reject("no_change", "nothing to change");
  return applyAll(w, events) ?? {};
}

/**
 * A person's saved sets changed (§28.16): the gear pack's (`gear.set_op`), whose events apply here
 * as any op's; without the gear pack there are none.
 */
function setOp(w: Working, op: SetOp, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const sets = optionalService(w.ctx, "gear.set_op");
  if (!sets) return reject("no_sets", "saved outfits are the gear pack's");
  const events = sets(w.ctx, op, opts);
  if (!Array.isArray(events)) return events;
  return applyAll(w, events) ?? {};
}

/**
 * Applies one item op to the working state (§3.5): its events, each validated against the state the
 * ones before it left, or the op's refusal; with what it made and where the size rules put a thing
 * other than asked. Removing a thing from the world is the GM's despawn (`engine/edits`).
 */
export function applyItemOp(w: Working, op: Exclude<ItemOp, { do: "remove" }>, opts: ItemOpOptions): ItemOpApplied | ItemOpRefusal {
  const ctx = w.ctx;
  if (op.do === "make") return make(w, op, opts);
  if (isSetOp(op)) return setOp(w, op, opts);
  if ("from" in op) return permit(w, op, opts);
  const missing = thingProblem(ctx, op.do === "merge" ? op.drop : op.item);
  if (missing) return missing;
  switch (op.do) {
    case "move":
      return moveThing(w, op.item, op.to, opts, op.why, null);
    case "hand":
      return hand(w, op, opts);
    case "own": {
      const e = own(ctx.state.entities, op.item);
      if (op.owner !== null) {
        const party = partyProblem(ctx, op.owner);
        if (party) return party;
      }
      // Owners kept as a list (a vehicle, an asset with shares) become the one owner, or none.
      const owners = ownersIn(e?.fields ?? {}).map((o) => o.party);
      if (op.owner === null ? owners.length === 0 : owners.length === 1 && owners[0] === op.owner) return reject("no_change", "it is so already");
      return applyAll(w, [...ownerEvents(ctx, op.item, op.owner), ...endGrants(ctx, op.item)]) ?? {};
    }
    case "grant":
    case "revoke":
      return grant(w, op, opts);
    case "home": {
      const bad = op.home !== null ? restProblem(ctx, op.home) : null;
      if (bad) return bad;
      const value = op.home === null ? null : restValue(op.home);
      if ((own(ctx.state.entities, op.item)?.fields.home ?? null) === value) return reject("no_change", "it rests there already");
      return applyAll(w, [{ type: "set", entity: op.item, field: "home", value }]) ?? {};
    }
    case "use": {
      const n = op.qty ?? 1;
      if (!(Number.isInteger(n) && n >= 1)) return reject("bad_amount", "using up is a whole number of at least 1");
      const stored = own(ctx.state.entities, op.item)?.fields.qty;
      const left = (typeof stored === "number" ? stored : 1) - n;
      // The last of it leaves the world (`gone`), holder and owner kept; `add` counts down from whatever the parent holds when it folds.
      return applyAll(w, [left > 0 ? { type: "add", entity: op.item, field: "qty", delta: -n } : { type: "set", entity: op.item, field: GONE_FIELD, value: true }]) ?? {};
    }
    case "wear":
      return wear(w, op, opts);
    case "condition": {
      const e = own(ctx.state.entities, op.item);
      const def = e ? fieldDef(ctx.registry, ctx.world, e.kind, "condition") : undefined;
      if (opts.advise === true) return conditionAdvised(w, op, e?.name ?? labelOf(ctx, op.item), def);
      const now = typeof e?.fields.condition === "number" ? e.fields.condition : typeof def?.default === "number" ? def.default : 100;
      const next = Math.min(def?.max ?? Infinity, Math.max(def?.min ?? -Infinity, now + op.delta));
      if (next === now) return reject("no_change", "its condition stays as it is");
      // An absent condition starts from its default: set it, since an `add` would count from nothing.
      return applyAll(w, [typeof e?.fields.condition === "number" ? { type: "add", entity: op.item, field: "condition", delta: next - now } : { type: "set", entity: op.item, field: "condition", value: next }]) ?? {};
    }
    case "lose":
      return lose(w, op, opts);
    case "label":
      return label(w, op);
    case "merge":
      return merge(w, op, opts);
  }
}
