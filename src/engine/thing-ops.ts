// Item ops (ITEMS-SPEC §3.5, §5.3, §6.1): the one validator for every change to a thing, and the one
// location writer (`locate`), compiled to the event types the fold already has (`spawn`, `set`,
// `add`, `link`, `unlink`, the space pack's cell events, notes, and `engine.rename`), so a recorded
// chat folds as it always did. The categorical rules bite here, when an op is resolved and never in
// the fold: nothing rests in a person above the person ceiling (it lands where they stand, with a
// note), nothing goes into something smaller, a part never leaves what it is built into, and a
// Built-in thing moves only by a confirmed op. A thing is made only when nothing it may be fits
// (find first). Removing a thing is the GM's despawn (`engine/edits`). Pure.

import { ownersIn } from "../shared/finance";
import { hashParts } from "../shared/hash";
import type { EntityId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { Got, GotHow, ItemOp, Rest, SizeClass, Spot } from "../shared/things";
import { typeFields } from "../shared/items-build";
import { sizeRank, SIZE_LABELS, THING_NAME_MAX } from "../shared/things";
import type { EntityDef } from "../shared/world";
import { accessFor, assignFor } from "./access";
import { ENGINE_EVENTS } from "./engine-pack";
import { orgPower, orgTypeOf } from "./org";
import { labelOf, optionalService, own } from "./pack-kit";
import type { ReadContext, Rejection } from "./registry";
import { fieldDef, GONE_FIELD, isGone, kindIs, placeOfEntity } from "./scope";
import { typeRowOf } from "./thing-index";
import { findThings } from "./thing-resolve";
import { contentsOf, holdersOf, holdsOf, isThing, possessorOf, sizeOf, sizeOfDef, spotOf, whoseOf } from "./things";
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
}

/** What an applied op did beyond its events: the thing it made, and where the size rules put a thing other than asked. */
export interface ItemOpApplied {
  made?: EntityId;
  placed?: Spot;
}

/** A refused op; a make that found what it would make names it (`exists`). */
export type ItemOpRefusal = Rejection & { exists?: EntityId };

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A note for the GM about the op, on the thing it concerns. */
const note = (text: string, entity: EntityId): LedgerEvent => ({ type: ENGINE_EVENTS.note, data: { text, entity, visibility: "secret" } });

const sameSpot = (a: Spot | null, b: Spot): boolean => a !== null && ("place" in a ? "place" in b && a.place === b.place : "in" in b && a.in === b.in);

/**
 * The one location writer (§3.3): the events that put `thing` at `to` and nowhere else. Out of every
 * holder but the one it goes into, off whoever wears it, `place` set or cleared, and its cell laid
 * or picked up (the space pack's). Nothing when it is there already.
 */
export function locate(ctx: ReadContext, thing: EntityId, to: Spot): LedgerEvent[] {
  const e = own(ctx.state.entities, thing);
  if (!e) return [];
  const into = "in" in to ? to.in : null;
  const place = "place" in to ? to.place : null;
  const holder = e.relations.find((r) => r.type === "in")?.to ?? null;
  const at = typeof e.fields.place === "string" && e.fields.place !== "" ? e.fields.place : null;
  if (into !== null ? holder === into && at === null : at === place && holder === null) return [];
  const out: LedgerEvent[] = [];
  for (const r of e.relations) {
    if (r.type === "in" && r.to !== into) out.push({ type: "unlink", rel: "in", from: thing, to: r.to });
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
  out.push(...(optionalService(ctx, "space.lay")?.(ctx, thing, null, null) ?? []));
  return out;
}

/**
 * Where a thing of `size` called `name` may go when asked to go to `to` (§3.2, §5.3 step 4), or why
 * it can't: a part never leaves its holder (`moving`); a Built-in thing moves only by a confirmed
 * op; a vehicle goes only on another vehicle; nothing goes into what holds nothing, or into a holder
 * smaller than it; a thing above the person ceiling put on someone lands where they stand instead
 * (`noted`). A size nothing says counts as portable, as the story stated the move.
 */
function landing(ctx: ReadContext, name: string, size: SizeClass, to: Spot, opts: ItemOpOptions, moving: boolean): { spot: Spot; noted?: string } | Rejection {
  if (moving && size === "part") return reject("part", `${name} is built into what holds it`);
  if (moving && size === "builtin" && !opts.confirmed) return reject("builtin", `${name} is built in: moving it needs a confirmed change`);
  if ("place" in to) return own(ctx.world.places, to.place) ? { spot: to } : reject("missing_place", `no place ${labelOf(ctx, to.place)}`);
  const holder = own(ctx.state.entities, to.in);
  if (!holder || isGone(ctx.state, to.in)) return reject("missing_entity", `no holder ${labelOf(ctx, to.in)}`);
  const holds = holdsOf(ctx, to.in);
  if (holds === null) return reject("cant_hold", `${holder.name} can't hold anything`);
  if (size === "vehicle" && !kindIs(ctx.registry, ctx.world, holder.kind, "vehicle")) return reject("cant_hold", `${name} is a vehicle: it goes only on another vehicle`);
  if (size === "unknown" || size === "part" || size === "vehicle" || sizeRank(size) <= sizeRank(holds)) return { spot: to };
  if (kindIs(ctx.registry, ctx.world, holder.kind, "person")) {
    const place = placeOfEntity(ctx.state, to.in);
    if (!place) return reject("too_big", `${name} is too big for ${holder.name} to carry, and ${holder.name} is nowhere`);
    return { spot: { place }, noted: `${name} is too big to carry (${SIZE_LABELS[size]}), so it is at ${labelOf(ctx, place)} rather than on ${holder.name}.` };
  }
  return reject("too_big", `${name} is too big for ${holder.name}, which takes things up to ${SIZE_LABELS[holds]}`);
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
function moveThing(w: Working, thing: EntityId, to: Spot, opts: ItemOpOptions, why: string, how: GotHow | null): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, thing);
  if (!e) return reject("missing_entity", `no thing ${labelOf(ctx, thing)}`);
  // There already, and nowhere else: a thing both lying at a place and in a holder (from before one
  // writer kept them apart) reads at its place, but a move there still takes it out of the holder.
  if (sameSpot(spotOf(ctx.state, thing), to) && !(typeof e.fields.place === "string" && e.fields.place !== "" && e.relations.some((r) => r.type === "in"))) return reject("no_change", `${e.name} is there already`);
  if ("in" in to && (to.in === thing || holdersOf(ctx.state, to.in).includes(thing))) return reject("cycle", `${e.name} can't go inside ${labelOf(ctx, to.in)}`);
  const where = landing(ctx, e.name, sizeOf(ctx, thing).size, to, opts, true);
  if ("code" in where) return where;
  const before = possessorOf(ctx, thing);
  const hidden = isDiscoverable(ctx.world, ctx.state, thing);
  const moved = applyAll(w, [...locate(ctx, thing, where.spot), ...(where.noted ? [note(where.noted, thing)] : [])]);
  if (moved) return moved;
  const after = possessorOf(ctx, thing);
  const events: LedgerEvent[] = [];
  if (after !== before) {
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
  return sameSpot(where.spot, to) ? {} : { placed: where.spot };
}

/** Every use grant on a thing, and its overdue flag, ended (it is back with its owner, or has a new one). */
function endGrants(ctx: ReadContext, thing: EntityId): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) for (const r of own(ctx.state.entities, id)?.relations ?? []) if (r.type === "uses" && r.to === thing) out.push({ type: "unlink", rel: "uses", from: id, to: thing });
  if (own(ctx.state.entities, thing)?.fields.overdue === true) out.push({ type: "set", entity: thing, field: "overdue", value: false });
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

function make(w: Working, op: Extract<ItemOp, { do: "make" }>, opts: ItemOpOptions): ItemOpApplied | ItemOpRefusal {
  const ctx = w.ctx;
  const name = op.name.trim();
  if (name === "" || name.length > THING_NAME_MAX) return reject("bad_name", `a name is 1–${THING_NAME_MAX} characters`);
  const problem = (op.owner !== undefined ? partyProblem(ctx, op.owner) : null) ?? (op.home !== undefined ? restProblem(ctx, op.home) : null);
  if (problem) return problem;
  if (op.qty !== undefined && !(Number.isInteger(op.qty) && op.qty >= 1)) return reject("bad_amount", "a quantity is a whole number of at least 1");
  // Find first (§6.1): a thing it may be where it is made (on whoever holds it, or anywhere around
  // the place, wherever the viewer is) stands for it.
  const near = "in" in op.at ? (kindIs(ctx.registry, ctx.world, own(ctx.state.entities, op.at.in)?.kind ?? "", "person") ? op.at.in : possessorOf(ctx, op.at.in)) : null;
  const place = "place" in op.at ? op.at.place : placeOfEntity(ctx.state, op.at.in);
  const viewer = opts.viewer ?? ctx.world.pov;
  const found = findThings(ctx, name, { actor: near ?? viewer, viewer, scope: near !== null ? "on" : "all", ...(op.owner !== undefined ? { owner: op.owner } : {}) }).filter((c) => c.full && (near !== null || (place !== null && placeOfEntity(ctx.state, c.id) === place)));
  const seen = found.find((c) => !c.secret);
  if (seen) return { ...reject("exists", `${labelOf(ctx, seen.id)} is already there`), exists: seen.id };
  const row = op.type !== undefined ? typeRowOf(ctx, { catalog: op.type }) : null;
  if (op.type !== undefined && !row) return reject("missing_type", `no type ${op.type} in the catalogs`);
  const typed = row && op.type !== undefined ? typeFields(row.table, op.type, row.row) : null;
  const kind = typed?.kind ?? "item";
  const fields: JsonObject = { ...typed?.fields };
  if (op.owner !== undefined) fields.owner = op.owner;
  if (op.size !== undefined) fields.size = op.size;
  if (op.home !== undefined) fields.home = restValue(op.home);
  if (op.qty !== undefined && op.qty !== 1) fields.qty = op.qty;
  const aliases = (op.aliases ?? []).map((a) => a.trim()).filter((a) => a !== "");
  if (aliases.length > 0) fields.aliases = aliases;
  if (op.hidden === true) fields.visibility = "discoverable";
  // A hidden one it may be (a player can't tell it is), weighed for Tidy up rather than found.
  const maybe = found.find((c) => c.secret);
  if (maybe) fields.maybe_same_as = maybe.id;
  if ("in" in op.at && !own(ctx.state.entities, op.at.in)) return reject("missing_entity", `no holder ${labelOf(ctx, op.at.in)}`);
  const where = landing(ctx, name, sizeOfDef(ctx, kind, fields).size, op.at, opts, false);
  if ("code" in where) return where;
  const id = madeId(ctx, name, opts.salt);
  fields.made = { by: opts.by, at: where.spot } as unknown as JsonValue;
  // Made on someone, it is theirs to have (`got`), as anything made in their hands.
  const holder = "in" in where.spot ? where.spot.in : null;
  const possessor = holder === null ? null : kindIs(ctx.registry, ctx.world, own(ctx.state.entities, holder)?.kind ?? "", "person") ? holder : possessorOf(ctx, holder);
  const why = whyOf(op.why, opts);
  if (possessor !== null) fields.got = { how: "made", at: ctx.state.clock, ...(why !== undefined ? { why } : {}) } as unknown as JsonValue;
  if ("place" in where.spot) fields.place = where.spot.place;
  const entity: EntityDef = { id, kind, name, tier: "background", fields, relations: holder !== null ? [{ type: "in", to: holder }] : [] };
  const rejection = applyAll(w, [{ type: "spawn", entity }, ...(where.noted ? [note(where.noted, id)] : [])]);
  if (rejection) return rejection;
  return sameSpot(where.spot, op.at) ? { made: id } : { made: id, placed: where.spot };
}

function hand(w: Working, op: Extract<ItemOp, { do: "hand" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const to = own(ctx.state.entities, op.to);
  if (!to || isGone(ctx.state, op.to) || !kindIs(ctx.registry, ctx.world, to.kind, "person")) return reject("not_a_person", `${labelOf(ctx, op.to)} can't be handed anything`);
  if (op.until !== undefined && !(op.until > ctx.state.clock)) return reject("bad_until", "a loan's end is after now");
  const e = own(ctx.state.entities, op.item);
  if (!e) return reject("missing_entity", `no thing ${labelOf(ctx, op.item)}`);
  const giver = possessorOf(ctx, op.item);
  const owners = ownersIn(e.fields).map((o) => o.party);
  // A return goes back to the owner, or to one of an owning household's or group's own.
  if (op.basis === "return" && !owners.some((o) => o === op.to || (orgTypeOf(ctx, o) !== null && orgPower(ctx, op.to, o, "assets.use") !== null))) return reject("not_owner", `${e.name} goes back to its owner, not ${to.name}`);
  const how: Record<typeof op.basis, GotHow | null> = { hold: "holding", loan: "loan", return: null, gift: "given", sale: "bought", trade: "bought", theft: "took" };
  const moved = moveThing(w, op.item, { in: op.to }, opts, op.why, how[op.basis]);
  if ("code" in moved) return moved;
  const events: LedgerEvent[] = [];
  if (op.basis === "gift" || op.basis === "sale" || op.basis === "trade") {
    events.push(...endGrants(ctx, op.item));
    if (!(owners.length === 1 && owners[0] === op.to)) events.push({ type: "set", entity: op.item, field: "owner", value: op.to });
  } else if (op.basis === "return") events.push(...endGrants(ctx, op.item));
  // A loan is the receiver's to use till it ends. A hold grants use only to one who may not use it
  // already (§3.4): staff handed the shop's tool at the shop hold it as staff, so it is no more theirs
  // to use away from the shop than before.
  else if ((op.basis === "loan" && !whoseOf(ctx, op.item).owners.includes(op.to)) || (op.basis === "hold" && accessFor(ctx, op.to, op.item).use === null)) events.push({ type: "link", rel: "uses", from: op.to, to: op.item, fields: { basis: op.basis, ...(giver !== null ? { by: giver } : {}) }, ...(op.until !== undefined ? { until: Math.round(op.until) } : {}) });
  return applyAll(w, events) ?? moved;
}

function grant(w: Working, op: Extract<ItemOp, { do: "grant" | "revoke" }>): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const missing = partyProblem(ctx, op.who) ?? (op.by !== undefined ? partyProblem(ctx, op.by) : null);
  if (missing) return missing;
  if (op.do === "revoke") return applyAll(w, [{ type: "unlink", rel: "uses", from: op.who, to: op.item }]) ?? {};
  if (op.until !== undefined && !(op.until > ctx.state.clock)) return reject("bad_until", "a grant's end is after now");
  const basis = op.basis ?? (op.until !== undefined ? "loan" : "assign");
  const events: LedgerEvent[] = [{ type: "link", rel: "uses", from: op.who, to: op.item, fields: { basis, ...(op.by !== undefined ? { by: op.by } : {}) }, ...(op.until !== undefined ? { until: Math.round(op.until) } : {}) }];
  // From someone it isn't theirs to lend, it lands with its giver, flagged for the GM (§3.4).
  if (op.by !== undefined && assignFor(ctx, op.by, op.item) === null) events.push(note(`${labelOf(ctx, op.by)} let ${labelOf(ctx, op.who)} use ${labelOf(ctx, op.item)}, though it isn't theirs to lend.`, op.item));
  return applyAll(w, events) ?? {};
}

function permit(w: Working, op: Extract<ItemOp, { do: "permit" | "unpermit" }>): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const missing = partyProblem(ctx, op.from) ?? partyProblem(ctx, op.to) ?? (op.by !== undefined ? partyProblem(ctx, op.by) : null);
  if (missing) return missing;
  if (op.from === op.to) return reject("self", `${labelOf(ctx, op.from)} needs no leave of their own`);
  if (op.do === "unpermit") return applyAll(w, [{ type: "unlink", rel: "permits", from: op.from, to: op.to }]) ?? {};
  if (op.until !== undefined && !(op.until > ctx.state.clock)) return reject("bad_until", "a permission's end is after now");
  const events: LedgerEvent[] = [{ type: "link", rel: "permits", from: op.from, to: op.to, fields: { scope: op.scope ?? "all", ...(op.by !== undefined ? { by: op.by } : {}) }, ...(op.until !== undefined ? { until: Math.round(op.until) } : {}) }];
  // Given on an organization's behalf by someone without the say over its things: flagged for the GM.
  if (op.by !== undefined && op.by !== op.from && (orgTypeOf(ctx, op.from) === null || orgPower(ctx, op.by, op.from, "assets.assign") === null)) events.push(note(`${labelOf(ctx, op.by)} let ${labelOf(ctx, op.to)} use what is ${labelOf(ctx, op.from)}'s, without the say to.`, op.from));
  return applyAll(w, events) ?? {};
}

function wear(w: Working, op: Extract<ItemOp, { do: "wear" }>, opts: ItemOpOptions): ItemOpApplied | Rejection {
  const ctx = w.ctx;
  const e = own(ctx.state.entities, op.item);
  const who = own(ctx.state.entities, op.who);
  if (!e || !who || !kindIs(ctx.registry, ctx.world, who.kind, "person")) return reject("not_a_person", `${labelOf(ctx, op.who)} can't wear anything`);
  const worn = e.relations.filter((r) => (r.type === "worn_by" || r.type === "equipped") && r.to === op.who);
  if (op.off === true) return worn.length === 0 ? reject("not_worn", `${who.name} isn't wearing ${e.name}`) : (applyAll(w, worn.map((r) => ({ type: "unlink" as const, rel: r.type, from: op.item, to: op.who }))) ?? {});
  if (worn.length > 0) return reject("no_change", `${who.name} already wears ${e.name}`);
  const slot = typeof e.fields.slot === "string" ? e.fields.slot : typeRowOf(ctx, e.fields)?.row.equip_slot;
  if (typeof slot !== "string" || slot === "" || slot === "none") return reject("no_slot", `${e.name} isn't worn`);
  if (holdersOf(ctx.state, op.item)[0] !== op.who) {
    const moved = moveThing(w, op.item, { in: op.who }, opts, "", null);
    if ("code" in moved) return moved;
    if (moved.placed) return reject("too_big", `${e.name} is too big to wear`);
  }
  return applyAll(w, [{ type: "link", rel: slot === "hand_held" ? "equipped" : "worn_by", from: op.item, to: op.who, fields: { slot } }]) ?? {};
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
    if (name === "" || name.length > THING_NAME_MAX) return reject("bad_name", `a name is 1–${THING_NAME_MAX} characters`);
    if (name !== e.name) events.push({ type: ENGINE_EVENTS.rename, data: { entity: op.item, name, was: e.name } });
  }
  const aliases = op.aliases?.map((a) => a.trim()).filter((a) => a !== "");
  if (aliases !== undefined && JSON.stringify(aliases) !== JSON.stringify(e.fields.aliases ?? [])) events.push({ type: "set", entity: op.item, field: "aliases", value: aliases });
  if (op.description !== undefined && op.description.trim() !== (e.fields.description ?? "")) events.push({ type: "set", entity: op.item, field: "description", value: op.description.trim() });
  if (op.size !== undefined && op.size !== e.fields.size) events.push({ type: "set", entity: op.item, field: "size", value: op.size });
  if (events.length === 0) return reject("no_change", "nothing to change");
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
  if ("from" in op) return permit(w, op);
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
      if (Array.isArray(e?.fields.owners)) return reject("shared", `${labelOf(ctx, op.item)} has owners with shares: change them in its owners`);
      const owners = ownersIn(e?.fields ?? {}).map((o) => o.party);
      if (op.owner === null ? owners.length === 0 : owners.length === 1 && owners[0] === op.owner) return reject("no_change", "it is so already");
      return applyAll(w, [{ type: "set", entity: op.item, field: "owner", value: op.owner }, ...endGrants(ctx, op.item)]) ?? {};
    }
    case "grant":
    case "revoke":
      return grant(w, op);
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
