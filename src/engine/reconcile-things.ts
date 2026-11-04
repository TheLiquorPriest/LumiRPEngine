// The reconciler (ITEMS-SPEC §5.3): a reply's thing facts (§5.2) settled into item ops, each against
// the state the one before left. Narration is the authority (I8): a fact names a thing in the story's
// words, which the one resolver reads (`findThings`, secrets weighed and marked); one thing is acted
// on, several ask Which one?, and none is made when the story acts on it (a take, has, put, use_up,
// wear, or a give by someone other than the player character), find first, else only noted as not
// tracked. Each fact compiles to one op (or a make and the op it serves), applied through the item
// ops' one validator (`applyItemOp`), so the size rules, `got` and the hold and loan grants are the
// ops' own; the change type it lands under (§5.4) says its mode. A hidden thing in the scene the
// words name alone is found (`knows` plus the change), never made twice; one elsewhere is never moved:
// the thing made instead carries `maybe_same_as`. Deterministic and pure: everything is read from the
// working state and the fact.

import { ownersIn } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import type { HandoverBasis, ItemChange, ItemOp, SizeClass, Spot, ThingFact } from "../shared/things";
import { HANDOVER_BASES, isItemChange, isThingFact, nameTokens, sizeRank, thingsConfigOf } from "../shared/things";
import { reachOf } from "./access";
import { calendarOf, clockOfPhrase } from "./calendar";
import { businessAt, isStaff, orgPower, orgTypeOf } from "./org";
import { labelOf, optionalQuery, own } from "./pack-kit";
import { placeSaid } from "./place-names";
import type { ReadContext, Rejection } from "./registry";
import { isGone, kindIs, placeOfEntity } from "./scope";
import { typeRowOf } from "./thing-index";
import { applyItemOp, thingTypeFor, type ItemOpOptions } from "./thing-ops";
import { findThings, type ThingCandidate, type ThingScope } from "./thing-resolve";
import { holdersOf, holdsOf, isThing, possessorOf, sizeOf, whoseOf } from "./things";
import { canSeeEntity, isDiscoverable, knows } from "./visibility";
import type { Working } from "./working";

/** How a fact is settled: whose knowledge marks a candidate secret, what made things' ids are drawn from, and what the read may still make. */
export interface ReconcileOptions {
  /** The player character: a thing they can't see is weighed as a secret, and a hidden thing found is theirs to know. */
  viewer: EntityId;
  /** Made things' ids are drawn from it (the read's seed and the fact's place in it). */
  salt: string;
  /** Confirmed (an answered chip): only then does a Built-in thing move. */
  confirmed?: boolean;
  /** How many more things this read may make (the user's Things made from a reply less what it made before); absent, no bound. */
  makes?: number;
}

/** A thing a fact made: what the mode of its make reads (its size, and its type's price). */
export interface MadeThing {
  id: EntityId;
  name: string;
  size: SizeClass;
  /** The price of one of its type where it is made, in minor units; null when nothing prices it. */
  cents: number | null;
}

/** One fact settled: the change it makes and the type it lands under, Which one? when several things fit, or why it can't be kept. */
export type Reconciled =
  | {
      kind: "change";
      change: ItemChange;
      /** The things it acted on, made ones included. */
      items: EntityId[];
      made: MadeThing[];
      /** Hidden things the reply's words found. */
      found: EntityId[];
      /** A Built-in thing moved: it asks first, whatever the mode. */
      builtin?: true;
      /** It was brought along from away (`reachOf`), and where it was: a Brought along receipt. */
      brought?: { place: PlaceId | null };
      /** A handover's basis, as told or as §4.6 reads it. */
      basis?: HandoverBasis;
    }
  | { kind: "which"; field: "item" | "into" | "from"; candidates: EntityId[] }
  | { kind: "refused"; rejection: Rejection };

/** The ranks of things in the actor's scene (§5.1): on them, handed over, here loose, in holders here, fixtures here. */
const SCENE: Readonly<Record<string, true>> = { on: true, handed: true, loose: true, holders: true, fixtures: true };

/** Words that never name a made thing: a leading article, quantity word or possessive pronoun. */
const LEADING = /^(?:(?:a|an|the|some|my|your|his|her|their|our|its|this|that|these|those)\s+)+/i;

const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : "");

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A change the state holds already: nothing to show or tell (the read's ALREADY_SO). */
const already = (reason: string): Reconciled => ({ kind: "refused", rejection: reject("already", reason) });
const refused = (code: string, reason: string): Reconciled => ({ kind: "refused", rejection: reject(code, reason) });

/** Why a fact can't land, from an op's refusal: a no-op is already so; anything else is not tracked. */
function refusedBy(r: Rejection): Reconciled {
  return r.code === "no_change" ? already(r.reason) : { kind: "refused", rejection: r };
}

/** The fact a proposal tells: for a change type the fact it was settled from (`fact`), else its own type (`item_condition` is both). */
export function factOf(p: JsonObject): ThingFact | null {
  const t = isItemChange(p.type) && isThingFact(p.fact) ? p.fact : p.type;
  return isThingFact(t) ? t : null;
}

const isPerson = (ctx: ReadContext, id: EntityId): boolean => {
  const e = own(ctx.state.entities, id);
  return !!e && !isGone(ctx.state, id) && kindIs(ctx.registry, ctx.world, e.kind, "person");
};

/** The people (or organizations) every word of `said` names ("Marcus" is Marcus Delgado). */
function partiesNamed(ctx: ReadContext, said: string): EntityId[] {
  const words = nameTokens(said);
  if (words.length === 0) return [];
  return Object.keys(ctx.state.entities)
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      if (!e || isGone(ctx.state, id) || !(kindIs(ctx.registry, ctx.world, e.kind, "person") || orgTypeOf(ctx, id) !== null)) return false;
      const theirs = nameTokens(e.name);
      return words.every((w) => theirs.includes(w));
    })
    .sort();
}

/** One thing, several, or none: `maybe` a hidden thing a thing made instead may be; `named` an id the words gave of a thing out of the fact's reach, which nothing made stands for. */
type Picked = { id: EntityId; secret: boolean } | { ambiguous: EntityId[] } | { none: true; maybe?: EntityId; named?: EntityId };

interface PickOptions {
  actor: EntityId;
  viewer: EntityId;
  scope: ThingScope;
  need?: "holder";
  /** Only candidates it keeps count. */
  keep?: (id: EntityId) => boolean;
}

/**
 * What the words stand for (§5.1). An id names that thing when the viewer can see it and it is within
 * the fact's reach (`scope`, `keep`); out of it, the words name none, and nothing is made in its place.
 * A hidden one's id reads as the words it is made of. Every candidate is weighed: when the viewer can
 * see any, only those count, so a hidden thing never hides a visible one by its name; with only
 * hidden ones, one in the scene the words name alone is found, and anywhere else, or several, the
 * words name none, the first of them what a thing made instead may be.
 */
function pick(ctx: ReadContext, words: string, o: PickOptions): Picked {
  const said = words.trim();
  if (said === "") return { none: true };
  if (own(ctx.state.entities, said) && isThing(ctx, said) && !isGone(ctx.state, said) && canSeeEntity(ctx.registry, ctx.world, ctx.state, o.viewer, said)) {
    const on = holdersOf(ctx.state, said).includes(o.actor);
    const here = on || (placeOfEntity(ctx.state, said) !== null && placeOfEntity(ctx.state, said) === placeOfEntity(ctx.state, o.actor));
    const reached = o.scope === "on" ? on : o.scope === "here" ? here : true;
    return reached && (o.keep?.(said) ?? true) && (o.need !== "holder" || holdsOf(ctx, said) !== null) ? { id: said, secret: false } : { none: true, named: said };
  }
  const all = findThings(ctx, said, { actor: o.actor, viewer: o.viewer, scope: o.scope, ...(o.need ? { need: o.need } : {}) }).filter((c) => o.keep?.(c.id) ?? true);
  const seen = all.filter((c) => !c.secret);
  const best = bestOf(seen.length > 0 ? seen : all);
  const only = best.length === 1 ? best[0] : undefined;
  if (seen.length > 0) return only ? { id: only.id, secret: false } : { ambiguous: best.map((c) => c.id) };
  if (only && SCENE[only.rank]) return { id: only.id, secret: true };
  return best[0] ? { none: true, maybe: best[0].id } : { none: true };
}

/** The best candidates: full matches before head-only ones, then the nearest, as the resolver ranks them. */
function bestOf(candidates: readonly ThingCandidate[]): ThingCandidate[] {
  const first = candidates[0];
  return first ? candidates.filter((c) => c.full === first.full && c.rank === first.rank) : [];
}

/**
 * A made thing's name from the story's words: no leading article or possessive pronoun, nor the
 * name of whose it is ("Danny's truck keys" is "Truck keys"), its first letter capital.
 */
export function madeName(ctx: ReadContext, words: string): string {
  let text = words.trim().replace(LEADING, "");
  const possessive = /^(.+?)['’]s?\s+(\S.*)$/su.exec(text);
  if (possessive && partiesNamed(ctx, possessive[1] ?? "").length > 0) text = (possessive[2] ?? "").replace(LEADING, "");
  const name = text.replace(/\s+/g, " ").trim() || words.trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What a fact applies on `w`: its ops in order, each validated against what the ones before it left, and what they made and found. */
class Settling {
  readonly made: MadeThing[] = [];
  readonly found: EntityId[] = [];
  readonly items: EntityId[] = [];
  builtin = false;
  constructor(
    readonly w: Working,
    readonly opts: ReconcileOptions,
    readonly why: string,
  ) {}

  /** One op, applied, or its refusal. */
  apply(op: Exclude<ItemOp, { do: "remove" }>): Rejection | { made?: EntityId; placed?: Spot } {
    const options: ItemOpOptions = { by: "story", confirmed: this.opts.confirmed === true, gm: false, salt: `${this.opts.salt}:${this.made.length}`, viewer: this.opts.viewer };
    const out = applyItemOp(this.w, op, options);
    if ("code" in out) return out;
    if ("item" in op && !this.items.includes(op.item)) this.items.push(op.item);
    return out;
  }

  /** A thing made where the story has it (§5.3 step 3), find first, within what the read may still make. */
  make(words: string, at: Spot, extra: { owner?: EntityId; maybe?: EntityId; named?: EntityId } = {}): Rejection | EntityId {
    const ctx = this.w.ctx;
    // An id of a thing out of the fact's reach is that thing, not one to make: it can't be had as told.
    if (extra.named !== undefined) return reject("not_here", `${labelOf(ctx, extra.named)} isn't where that could happen`);
    if (this.opts.makes !== undefined && this.made.length >= this.opts.makes) return reject("thing_cap", "the reply has made as many things as one reply may (Settings → Changes from the reply)");
    const name = madeName(ctx, words);
    const typed = thingTypeFor(ctx, name, "place" in at ? at.place : placeOfEntity(ctx.state, at.in));
    const out = this.apply({ do: "make", name, at, why: this.why, ...(typed.type !== undefined ? { type: typed.type } : {}), ...(extra.owner !== undefined ? { owner: extra.owner } : {}) });
    if ("code" in out) return out;
    const id = out.made;
    if (id === undefined) return reject("not_made", `${name} wasn't made`);
    // A hidden thing it may be, for Tidy up: the read never moves a hidden thing from elsewhere.
    if (extra.maybe !== undefined && own(ctx.state.entities, id)?.fields.maybe_same_as === undefined) {
      const marked = this.w.apply({ type: "set", entity: id, field: "maybe_same_as", value: extra.maybe });
      if (marked) return marked;
    }
    this.items.push(id);
    this.made.push({ id, name, size: sizeOf(ctx, id).size, cents: typed.cents });
    return id;
  }

  /** A hidden thing found: the viewer, and whoever found it, knows it from now on. */
  know(thing: EntityId, who: readonly EntityId[]): Rejection | null {
    const ctx = this.w.ctx;
    for (const p of new Set([this.opts.viewer, ...who])) {
      if (knows(ctx.state, p, thing) || !own(ctx.state.entities, p)) continue;
      const rejection = this.w.apply({ type: "link", rel: "knows", from: p, to: thing });
      if (rejection) return rejection;
    }
    if (!this.found.includes(thing)) this.found.push(thing);
    return null;
  }

  /** Moves `thing` to `to` as the fact tells (§5.3 step 2), a hidden thing found told to whoever found it. */
  move(thing: EntityId, to: Spot, finder: EntityId, secret: boolean): Rejection | null {
    const ctx = this.w.ctx;
    if (sizeOf(ctx, thing).size === "builtin") this.builtin = true;
    const where = (): string => JSON.stringify([own(ctx.state.entities, thing)?.fields.place ?? null, holdersOf(ctx.state, thing)[0] ?? null]);
    const before = where();
    const out = this.apply({ do: "move", item: thing, to, why: this.why });
    if ("code" in out) return out;
    // The size rules put it where it was (too big to carry, lying where they stand already): nothing moved.
    if (out.placed && where() === before) return reject("too_big", `${labelOf(ctx, thing)} is too big to carry`);
    return secret ? this.know(thing, [finder]) : null;
  }

  done(change: ItemChange, extra: { brought?: { place: PlaceId | null }; basis?: HandoverBasis } = {}): Reconciled {
    return { kind: "change", change: this.made.length > 0 ? "item_make" : change, items: this.items, made: this.made, found: this.found, ...(this.builtin ? { builtin: true as const } : {}), ...extra };
  }

  /** The fact's change, or why it can't land. */
  after(r: Rejection | { made?: EntityId; placed?: Spot } | null, change: ItemChange, extra: { brought?: { place: PlaceId | null }; basis?: HandoverBasis } = {}): Reconciled {
    return r !== null && "code" in r ? refusedBy(r) : this.done(change, extra);
  }
}

/** Whether a thing is too big for a person to hold: a vehicle, a part, or above the person ceiling. */
function tooBigToHold(ctx: ReadContext, id: EntityId): boolean {
  const size = sizeOf(ctx, id).size;
  if (size === "vehicle" || size === "part") return true;
  return size !== "unknown" && sizeRank(size) > sizeRank(thingsConfigOf(ctx.world).sizes.ceiling);
}

/** The holder or person a take's `from` names, Which one? for several holders, or null when it names none. */
function fromOf(ctx: ReadContext, said: string, actor: EntityId, viewer: EntityId): { person: EntityId } | { holder: EntityId } | { which: EntityId[] } | null {
  if (said === "") return null;
  if (isPerson(ctx, said)) return { person: said };
  const people = partiesNamed(ctx, said).filter((id) => isPerson(ctx, id));
  if (people.length === 1 && people[0] !== undefined) return { person: people[0] };
  const holder = pick(ctx, said, { actor, viewer, scope: "here", need: "holder" });
  if ("id" in holder) return { holder: holder.id };
  return "ambiguous" in holder ? { which: holder.ambiguous } : null;
}

/**
 * Settles one thing fact on `w` (§5.3): resolved, its op picked, made when the story acts on a thing
 * the world lacks, the size rules and the bookkeeping applied by the ops, and the change type it lands
 * under. The proposal is the fact (`type` a thing fact), or a change it was settled into (`type` a
 * change type, `fact` the fact's); a pick on a Which one? names the thing by id. On a refusal or a
 * Which one?, `w` is left as it was.
 */
export function reconcileFact(w: Working, p: JsonObject, opts: ReconcileOptions): Reconciled {
  const fact = factOf(p);
  if (!fact) return refused("not_a_fact", `${String(p.type)} isn't a change to a thing`);
  const mark = w.mark();
  const out = settle(w, fact, p, opts);
  if (out.kind !== "change") w.restore(mark);
  return out;
}

function settle(w: Working, fact: ThingFact, p: JsonObject, opts: ReconcileOptions): Reconciled {
  const ctx = w.ctx;
  const viewer = opts.viewer;
  const s = new Settling(w, opts, str(p.why));
  const item = str(p.item);
  if (item === "") return refused("bad_proposal", "it names no thing");
  if (fact === "give") return give(s, p, item);
  if (fact === "put") return put(s, p, item, str(p.entity) || viewer);
  if (fact === "owner") return owner(s, p, item);
  const actor = str(p.entity) || viewer;
  if (!own(ctx.state.entities, actor)) return refused("missing_entity", `no one ${labelOf(ctx, actor)}`);
  const maybe = (found: Picked): { maybe?: EntityId; named?: EntityId } => ("none" in found ? { ...(found.maybe !== undefined ? { maybe: found.maybe } : {}), ...(found.named !== undefined ? { named: found.named } : {}) } : {});
  switch (fact) {
    case "take": {
      const from = fromOf(ctx, str(p.from), actor, viewer);
      if (from && "which" in from) return { kind: "which", field: "from", candidates: from.which };
      // Picked up where they are, never what they hold already; out of the holder or off the person the words name.
      const inside = (id: EntityId): boolean => !from || holdersOf(ctx.state, id).includes("person" in from ? from.person : from.holder);
      const found = pick(ctx, item, { actor, viewer, scope: "here", keep: (id) => !holdersOf(ctx.state, id).includes(actor) && inside(id) });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if ("id" in found) return s.after(s.move(found.id, { in: actor }, actor, found.secret), "item_move");
      if ("id" in pick(ctx, item, { actor, viewer, scope: "on" })) return already(`${labelOf(ctx, actor)} has it already`);
      // What they took that nobody tracked yet comes into being in their hands.
      const made = s.make(item, { in: actor }, maybe(found));
      return typeof made === "string" ? s.done("item_make") : refusedBy(made);
    }
    case "drop": {
      const found = pick(ctx, item, { actor, viewer, scope: "on" });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if (!("id" in found)) return refused("not_held", `${labelOf(ctx, actor)} doesn't have it`);
      const place = placeOfEntity(ctx.state, actor);
      if (place === null) return refused("no_place", `${labelOf(ctx, actor)} is nowhere`);
      return s.after(s.move(found.id, { place }, actor, found.secret), "item_move");
    }
    case "has": {
      const found = pick(ctx, item, { actor, viewer, scope: "all" });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if ("id" in found) {
        if (holdersOf(ctx.state, found.id).includes(actor)) return already(`${labelOf(ctx, actor)} has it already`);
        // Furniture, a fixture or a vehicle is used where it is: having it moves nothing.
        if (tooBigToHold(ctx, found.id)) return already(`${labelOf(ctx, found.id)} is used where it is`);
        const reach = reachOf(ctx, actor, found.id);
        return s.after(s.move(found.id, { in: actor }, actor, found.secret), "item_move", reach.reach === "away" ? { brought: { place: reach.place } } : {});
      }
      const made = s.make(item, { in: actor }, maybe(found));
      return typeof made === "string" ? s.done("item_make") : refusedBy(made);
    }
    case "use_up": {
      const n = p.qty === undefined ? 1 : p.qty;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return refused("bad_amount", "using up is a whole number of at least 1");
      const found = pick(ctx, item, { actor, viewer, scope: "here" });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if ("id" in found) {
        const known = found.secret ? s.know(found.id, [actor]) : null;
        return s.after(known ?? s.apply({ do: "use", item: found.id, qty: n }), "item_use");
      }
      // Used up, it came into being in their hands first.
      const made = s.make(item, { in: actor }, maybe(found));
      return typeof made === "string" ? s.after(s.apply({ do: "use", item: made, qty: n }), "item_make") : refusedBy(made);
    }
    case "wear": {
      if (ctx.levelOf(actor, "gear") < 3) return refused("level", "slots are tracked from Gear level 3");
      const off = p.off === true;
      const found = pick(ctx, item, { actor, viewer, scope: off ? "on" : "here" });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if ("id" in found) {
        const known = found.secret ? s.know(found.id, [actor]) : null;
        return s.after(known ?? s.apply({ do: "wear", item: found.id, who: actor, ...(off ? { off: true } : {}) }), "item_wear");
      }
      if (off) return refused("not_worn", `${labelOf(ctx, actor)} isn't wearing it`);
      const made = s.make(item, { in: actor }, maybe(found));
      if (typeof made !== "string") return refusedBy(made);
      // Worn when its type says how; else it is only theirs to hold.
      const slot = own(ctx.state.entities, made)?.fields.slot;
      return typeof slot === "string" && slot !== "" && slot !== "none" ? s.after(s.apply({ do: "wear", item: made, who: actor }), "item_make") : s.done("item_make");
    }
    case "lose": {
      const found = pick(ctx, item, { actor, viewer, scope: "all", keep: (id) => holdersOf(ctx.state, id).includes(actor) || whoseOf(ctx, id).owners.includes(actor) });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if (!("id" in found)) return refused("not_held", `${labelOf(ctx, actor)} doesn't have it`);
      const by = str(p.by);
      if (by !== "" && !own(ctx.state.entities, by)) return refused("missing_entity", `no thief ${labelOf(ctx, by)}`);
      return s.after(s.apply({ do: "lose", item: found.id, ...(by !== "" ? { by } : {}) }), "item_lose");
    }
    case "item_condition": {
      if (typeof p.delta !== "number" || !Number.isInteger(p.delta) || p.delta === 0) return refused("bad_amount", "an item's condition moves by a whole, non-zero number");
      const found = pick(ctx, item, { actor, viewer, scope: "here" });
      if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
      if (!("id" in found)) return refused("missing_entity", "the world has no such thing here");
      const known = found.secret ? s.know(found.id, [actor]) : null;
      return s.after(known ?? s.apply({ do: "condition", item: found.id, delta: p.delta }), "item_condition");
    }
  }
}

/** A stated change of owner (§5.2 `owner`): the thing named, anywhere, made the new owner's (or nobody's). */
function owner(s: Settling, p: JsonObject, item: string): Reconciled {
  const ctx = s.w.ctx;
  const viewer = s.opts.viewer;
  const said = str(p.owner);
  const nobody = said === "" || /^(?:null|none|nobody|no one)$/i.test(said);
  if (!nobody && !own(ctx.state.entities, said)) return refused("missing_entity", `no one ${labelOf(ctx, said)}`);
  const found = pick(ctx, item, { actor: !nobody && isPerson(ctx, said) ? said : viewer, viewer, scope: "all" });
  if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
  if (!("id" in found)) return refused("missing_entity", "the world has no such thing to own");
  const to = nobody ? null : said;
  const owners = ownersIn(own(ctx.state.entities, found.id)?.fields ?? {}).map((o) => o.party);
  if (to === null ? owners.length === 0 : owners.length === 1 && owners[0] === to) return already("it is so already");
  const known = found.secret ? s.know(found.id, to !== null ? [to] : []) : null;
  return s.after(known ?? s.apply({ do: "own", item: found.id, owner: to, why: s.why }), "item_own");
}

/** Where a put leaves the thing (§5.2 `put`): in a holder the words name (made when the world lacks it and its type holds things), at a place they name, else where the actor stands. */
function put(s: Settling, p: JsonObject, item: string, actor: EntityId): Reconciled {
  const ctx = s.w.ctx;
  const viewer = s.opts.viewer;
  if (!own(ctx.state.entities, actor)) return refused("missing_entity", `no one ${labelOf(ctx, actor)}`);
  const here = placeOfEntity(ctx.state, actor);
  const into = str(p.into);
  const at = str(p.at);
  let to: Spot | null = null;
  let makeHolder: { maybe?: EntityId } | null = null;
  if (into !== "") {
    const holder = pick(ctx, into, { actor, viewer, scope: "here", need: "holder" });
    if ("ambiguous" in holder) return { kind: "which", field: "into", candidates: holder.ambiguous };
    if ("id" in holder) {
      to = { in: holder.id };
      const known = holder.secret ? s.know(holder.id, [actor]) : null;
      if (known) return refusedBy(known);
    } else if (here === null) return refused("no_place", `${labelOf(ctx, actor)} is nowhere`);
    else makeHolder = holder.maybe !== undefined ? { maybe: holder.maybe } : {};
  } else if (at !== "") {
    const place = placeSaid(ctx.registry, ctx.world, ctx.state, at);
    const holder = place === null ? pick(ctx, at, { actor, viewer, scope: "here", need: "holder" }) : null;
    if (holder && "ambiguous" in holder) return { kind: "which", field: "into", candidates: holder.ambiguous };
    if (place !== null) to = { place };
    else if (holder && "id" in holder) to = { in: holder.id };
    else return refused("missing_place", "the world has no such place");
  } else if (here === null) return refused("no_place", `${labelOf(ctx, actor)} is nowhere`);
  else to = { place: here };
  const found = pick(ctx, item, { actor, viewer, scope: "here" });
  if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
  // A holder the world lacks comes into being where the actor stands, when its type holds things (a fridge, a dresser).
  if (makeHolder !== null && here !== null) {
    const made = s.make(into, { place: here }, makeHolder);
    if (typeof made !== "string") return refusedBy(made);
    if (holdsOf(ctx, made) === null) return refused("cant_hold", `${labelOf(ctx, made)} can't hold anything`);
    to = { in: made };
  }
  if (to === null) return refused("missing_place", "it names nowhere to put it");
  if ("id" in found) return s.after(s.move(found.id, to, actor, found.secret), "item_move");
  const made = s.make(item, to, "none" in found ? { ...(found.maybe !== undefined ? { maybe: found.maybe } : {}), ...(found.named !== undefined ? { named: found.named } : {}) } : {});
  return typeof made === "string" ? s.done("item_make") : refusedBy(made);
}

/**
 * A give's basis when the story doesn't say (§4.6): back to its owner (or one of an owning
 * household's or group's own) is a return; food or drink to have now is a gift; anything else is
 * held for its owner. A return told to someone it isn't theirs is read as held, the safe reading:
 * the owner stays.
 */
function basisOf(ctx: ReadContext, owners: readonly EntityId[], to: EntityId, said: unknown, food: boolean): HandoverBasis {
  const back = owners.some((o) => o === to || (orgTypeOf(ctx, o) !== null && orgPower(ctx, to, o, "assets.use") !== null));
  if ((HANDOVER_BASES as readonly unknown[]).includes(said)) return said === "return" && !back ? "hold" : (said as HandoverBasis);
  if (back) return "return";
  return food ? "gift" : "hold";
}

/** The change type a handover lands under (§5.4): a change of owner, a theft (a take without a right), or a handover that keeps the owner. */
export function handChange(basis: HandoverBasis): ItemChange {
  if (basis === "gift" || basis === "sale" || basis === "trade") return "item_own";
  return basis === "theft" ? "item_move" : "item_hand";
}

/** The change type each thing fact lands under when it acts on a thing the world has (§5.4). */
const FACT_TYPE: Readonly<Record<ThingFact, ItemChange>> = { take: "item_move", drop: "item_move", put: "item_move", has: "item_move", give: "item_hand", owner: "item_own", use_up: "item_use", wear: "item_wear", lose: "item_lose", item_condition: "item_condition" };

/**
 * The change type a thing fact lands under, read from the fact alone (§5.4), for one nothing settles
 * (it names someone the player character doesn't know): a take, drop, put or has moves; a give hands
 * over, or changes the owner as a stated gift, sale or trade, or moves as a theft; an owner, a use, a
 * wearing, a loss and a condition are each their own. A change type's own proposal is that type.
 */
export function factChange(p: JsonObject): ItemChange | null {
  if (isItemChange(p.type)) return p.type;
  const fact = factOf(p);
  if (fact === null) return null;
  return fact === "give" && (HANDOVER_BASES as readonly unknown[]).includes(p.basis) ? handChange(p.basis as HandoverBasis) : FACT_TYPE[fact];
}

/**
 * A handover (§4.6): the thing the giver has by those words (or has here), handed over on its
 * basis: hold, loan or return keep the owner (a loan grant for a receiver who isn't it, a hold grant
 * for one who may not use it already, a return ends the grants); gift, sale and trade make the
 * receiver its owner. A thing the world lacks that someone other than the player character hands
 * over is made, written at making as the giver's, or the business's they work for (its staff, or an
 * owner who runs it) when it happens at its place, then held (food or drink, or a stated gift, sale
 * or trade: the receiver's from the start).
 */
function give(s: Settling, p: JsonObject, item: string): Reconciled {
  const ctx = s.w.ctx;
  const viewer = s.opts.viewer;
  const to = str(p.to);
  if (!isPerson(ctx, to)) return refused("not_a_person", `${labelOf(ctx, to)} can't be handed anything`);
  const from = str(p.from);
  if (from !== "" && !own(ctx.state.entities, from)) return refused("missing_entity", `no giver ${labelOf(ctx, from)}`);
  // What the giver has, or lies here: never what the receiver holds already, nor what someone else has on them.
  const keep = (id: EntityId): boolean => {
    const by = possessorOf(ctx, id);
    return by !== to && (from === "" || by === null || by === from);
  };
  const found = pick(ctx, item, { actor: from !== "" ? from : to, viewer, scope: "here", keep });
  if ("ambiguous" in found) return { kind: "which", field: "item", candidates: found.ambiguous };
  const until = typeof p.until === "string" && p.until.trim() !== "" ? clockOfPhrase(calendarOf(ctx.world), ctx.state.clock, p.until) : typeof p.until === "number" && p.until > ctx.state.clock ? p.until : null;
  const loan = (basis: HandoverBasis): { until?: number } => (basis === "loan" && until !== null ? { until } : {});
  if ("id" in found) {
    const thing = own(ctx.state.entities, found.id);
    if (thing?.kind === "account") return refused("is_money", "money changes hands as a transfer");
    const type = typeRowOf(ctx, thing?.fields ?? {})?.row.name;
    const food = optionalQuery(ctx, "economy.thing_type")?.(ctx, typeof type === "string" ? type : (thing?.name ?? ""), placeOfEntity(ctx.state, found.id))?.food === true;
    const basis = basisOf(ctx, ownersIn(thing?.fields ?? {}).map((o) => o.party), to, p.basis, food);
    if (sizeOf(ctx, found.id).size === "builtin") s.builtin = true;
    const handed = s.apply({ do: "hand", item: found.id, to, basis, ...loan(basis), why: s.why });
    if ("code" in handed) return refusedBy(handed);
    const known = found.secret ? s.know(found.id, [to, ...(from !== "" ? [from] : [])]) : null;
    return s.after(known, handChange(basis), { basis });
  }
  // Only someone other than the player character hands over what the world lacks: the player character can't give what it doesn't have.
  if (from === "" || from === viewer || !isPerson(ctx, from)) return refused("missing_entity", "the world has no such thing to hand over");
  const place = placeOfEntity(ctx.state, from);
  const food = thingTypeFor(ctx, madeName(ctx, item), place).food;
  const told = basisOf(ctx, [], to, p.basis, food);
  const keeps = told === "gift" || told === "sale" || told === "trade";
  const basis: HandoverBasis = keeps ? told : told === "loan" ? "loan" : "hold";
  // Written at making (§4.6): the receiver's when it is theirs to keep; else the giver's, or the business they work for at its place.
  const business = businessAt(ctx, place);
  const ownerOf = keeps ? to : business !== null && (isStaff(ctx, from, business) !== null || orgPower(ctx, from, business, "assets.use") !== null) ? business : from;
  const made = s.make(item, { in: from }, { owner: ownerOf, ...("none" in found && found.maybe !== undefined ? { maybe: found.maybe } : {}), ...("none" in found && found.named !== undefined ? { named: found.named } : {}) });
  if (typeof made !== "string") return refusedBy(made);
  return s.after(s.apply({ do: "hand", item: made, to, basis, ...loan(basis), why: s.why }), "item_make", { basis });
}
