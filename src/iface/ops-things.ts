// The everyday operations on people and things (the skills `items-and-wardrobe`, `vehicles`,
// `places-and-maps`): `move`, `place`, `give`, `wear`, `store` and `spawn`. Each runs through
// today's things model and moves (`engine/thing-ops`, `engine/relocate`), which keep a thing's four
// facts apart. Where today's rules would refuse a change for what it means (a thing too big for
// what it goes into, a return to someone who is not its owner, a giver who does not hold it), the
// change is applied all the same and the answer reports it. A name that is not recorded is answered
// as not there, with its near matches: only `spawn` makes anything, and a name an operation names
// that no recorded thing goes by is never made for it.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { ownersIn } from "../shared/finance";
import type { EntityId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { type HandoverBasis, type ItemOp, PLACE_KINDS, type PlaceKind, type Spot } from "../shared/things";
import { reachOf } from "../engine/access";
import { applyEffects } from "../engine/effects";
import { own } from "../engine/pack-kit";
import { baseWorld, findPlaces, placeOp } from "../engine/places-in-play";
import { relocate } from "../engine/relocate";
import { createRng } from "../engine/rng";
import { placeOfEntity } from "../engine/scope";
import { putAwaySpot } from "../engine/thing-gm";
import { applyItemOp, type ItemOpApplied, type ItemOpRefusal, locate } from "../engine/thing-ops";
import { isThing, possessorOf, restOf, spotOf } from "../engine/things";
import { chatDraftOf, draftEvent } from "../engine/world-draft";
import { bestiaryOf, bestiaryRow } from "./bestiary";
import { find, findOptional, isUnread, itemOptions, named, notAs, notOneOf, type OpContext, type OpDef, textArg, type Unread, unknownFields } from "./ops";
import type { Found, Want } from "./reading";
import { PROVENANCE_PROPERTIES } from "./source";
import { textOf } from "./texts";
import { timeArg } from "./ops-time";

/** How a thing passed from one person to another, as the skill says it, to today's handover bases. */
export const HOW_GIVEN: Readonly<Record<string, HandoverBasis>> = { handed: "hold", lent: "loan", returned: "return", given: "gift", sold: "sale", traded: "trade", stolen: "theft" };

/** The refusals of today's things model that are about what a change means (its size rules, a part or a built-in, a cycle, an owner), never about whether it can be read: applied all the same, and reported. */
export const BENT_RULES: Readonly<Record<string, true>> = { part: true, builtin: true, cant_hold: true, too_big: true, too_deep: true, no_room: true, cycle: true, not_owner: true, no_slot: true };

/** Where a spot is, for an answer: a place's or a holder's name with its id. */
function spotName(o: OpContext, spot: Spot): string {
  return named(o.reading, "place" in spot ? spot.place : spot.in);
}

/**
 * Puts a thing at a spot through today's one location writer and its size rules; where those
 * rules would refuse (it does not fit, it is built in, it would sit inside itself), it is put there
 * all the same and the answer reports which rule it bent. A thing already there changes nothing,
 * and the answer says so.
 */
export function putThing(o: OpContext, thing: EntityId, to: Spot, why: string): Unread | undefined {
  const w = o.draft.w;
  const out = applyItemOp(w, { do: "move", item: thing, to, why }, itemOptions(o));
  if (!("code" in out)) {
    if (out.placed !== undefined) o.reply.report("placed_instead", { n: o.n, op: o.op, what: named(o.reading, thing), asked: spotName(o, to), where: spotName(o, out.placed) });
    return undefined;
  }
  if (out.code === "no_change") {
    o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, thing) });
    return undefined;
  }
  if (!BENT_RULES[out.code]) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
  const bad = o.draft.applyAll(locate(w.ctx, thing, to));
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  o.reply.report("rule_bent", { n: o.n, op: o.op, what: named(o.reading, thing), where: spotName(o, to), code: out.code });
  return undefined;
}

/** Moves a person (or a group, or anything that is not a thing) to a place, out of whatever holds them, through today's one move path. */
function movePerson(o: OpContext, who: EntityId, to: string, along: boolean): Unread | undefined {
  const events = relocate(o.draft.w.ctx, who, to, along ? { along: true } : {});
  if ("code" in events) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: events.code } };
  const bad = o.draft.applyAll(events);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

/** Moves someone or something to a place: a thing through the things model, anyone else through the move path. */
export function moveTo(o: OpContext, who: EntityId, place: string): Unread | undefined {
  return isThing(o.draft.w.ctx, who) ? putThing(o, who, { place }, textArg(o.args, "why") ?? "") : movePerson(o, who, place, false);
}

/** A square on a map, as `[column, row]` counted from 1 at the top left, as the map prints it; undefined when none is given. */
function squareArg(o: OpContext): [number, number] | Unread | undefined {
  const v = o.args.square;
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 1)) return [v[0] as number, v[1] as number];
  return notAs(o, "square", v, "square");
}

/**
 * Puts someone or something at a square, beside someone, or in a zone of the place's map, through
 * the grid's own placing; what the grid says of it (the way taken and its time, a square in a wall,
 * a shut door) is said in the answer, each sentence as the map's part words it.
 */
function placeOnMap(o: OpContext, who: EntityId, place: string): Unread | undefined {
  const square = squareArg(o);
  if (isUnread(square)) return square;
  const near = findOptional(o, "near", "entity");
  if (isUnread(near)) return near;
  const zone = textArg(o.args, "zone");
  if (square === undefined && near === undefined && zone === undefined) return undefined;
  const grid = o.call.deps.grid;
  const placed = grid.place({ state: { ...o.reading.state, world: o.draft.w.state }, env: o.call.deps.env, who, place, ...(square ? { square } : {}), ...(near ? { near: near.id } : {}), ...(zone !== undefined ? { zone } : {}) });
  if ("problem" in placed) return { line: placed.problem, fields: { n: o.n, op: o.op, ...placed.fields } };
  const bad = o.draft.applyAll(placed.events as unknown as LedgerEvent[]);
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  for (const said of placed.said ?? []) o.reply.line("on_map", { n: o.n, op: o.op, said });
  return undefined;
}

/** Words given for where something goes that name nothing there is, nor anything of another kind, with what says so. */
interface SaidWhere {
  field: string;
  words: string;
  unread: Unread;
}

/**
 * A name argument for where something goes (a support, a holder, a place), found as wanted on the
 * draft as it stands; or, for words that name nothing there is nor anything of another kind,
 * undefined, the words added to `said` to be kept on what goes there.
 */
function whereNamed(o: OpContext, field: string, want: Want, said: SaidWhere[]): Found | Unread | undefined {
  const r = findOptional(o, field, want);
  const words = o.args[field];
  if (!isUnread(r) || r.line !== "unknown" || r.fields.other !== "" || typeof words !== "string") return r;
  said.push({ field, words: words.trim(), unread: r });
  return undefined;
}

/** Words of where something was said to be, kept on it (`said_<field>`) and said once in the answer. */
function keepWords(o: OpContext, id: EntityId, said: readonly SaidWhere[]): Unread | undefined {
  if (said.length === 0) return undefined;
  const bad = o.draft.applyAll(said.map((s): LedgerEvent => ({ type: "set", entity: id, field: `said_${s.field}`, value: s.words })));
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  o.reply.line("said_where", { n: o.n, op: o.op, what: named(o.reading, id), said: textOf(said.map((s) => s.words)) });
  return undefined;
}

/** A place where code chooses one, kept only when the world as the chat plays it has that place: nothing is ever put somewhere that does not exist. */
function placeThere(o: OpContext, place: string | null): string | null {
  return place !== null && own(o.draft.w.world.places, place) !== undefined ? place : null;
}

/** Where someone acts when an operation names no one: the scene's place, else where the player character is. */
function actingPlace(o: OpContext): string | null {
  return scenePlace(o) ?? placeThere(o, placeOfEntity(o.draft.w.state, o.draft.w.world.pov));
}

/**
 * `in` named something that is not a place or something that holds things (the world, the groups, elsewhere): the answer says what
 * `in` takes and lists the near holders and the near places.
 */
function wrongIn(o: OpContext, said: string): Unread {
  const holders = o.reading.find(said, "holder");
  const places = o.reading.find(said, "place");
  const near = [...("near" in holders ? holders.near : []), ...("near" in places ? places.near : [])].map((x) => `${x.name} [${x.id}]`);
  return { line: "unknown", fields: { n: o.n, op: o.op, ...unknownFields(o.call.lines, "in", "in", said, near) } };
}

const move: OpDef = {
  name: "move",
  lane: "engine",
  needs: ["who", "to"],
  takes: ["who", "to", "with", "square", "near", "zone", "why"],
  example: { op: "move", who: "bram", to: "market_square", with: ["odile"], source: { from: "prose", message: "m-0012" }, standing: "established" },
  run(o) {
    const from = o.draft.w.events.length;
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    const to = find(o, "to", "place");
    if (isUnread(to)) return to;
    const company: Found[] = [];
    const given = o.args.with;
    for (const said of Array.isArray(given) ? given : typeof given === "string" ? [given] : []) {
      // An entry that is no name is not skipped: it is refused naming `with` and what it takes.
      if (typeof said !== "string") return notAs(o, "with", said, "names");
      const r = find(o, "with", "entity", false, said);
      if (isUnread(r)) return r;
      company.push(r);
    }
    for (const [i, one] of [who, ...company].entries()) {
      const failed = isThing(o.draft.w.ctx, one.id) ? putThing(o, one.id, { place: to.id }, textArg(o.args, "why") ?? "") : movePerson(o, one.id, to.id, i > 0);
      if (failed) return failed;
    }
    const mapped = placeOnMap(o, who.id, to.id);
    if (mapped) return mapped;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const place: OpDef = {
  name: "place",
  lane: "engine",
  needs: ["what"],
  takes: ["what", "at", "on", "by", "square", "near", "zone", "why"],
  example: { op: "place", what: "lantern", on: "table", source: { from: "prose", message: "m-0013" } },
  run(o) {
    const w = o.draft.w;
    const from = w.events.length;
    const said: SaidWhere[] = [];
    const at = findOptional(o, "at", "place");
    if (isUnread(at)) return at;
    const on = whereNamed(o, "on", "thing", said);
    if (isUnread(on)) return on;
    const by = whereNamed(o, "by", "person", said);
    if (isUnread(by)) return by;
    // Where it is set down, the most exact first: on a thing, in someone's hands, at a place.
    const asked: Spot | null = on ? { in: on.id } : by ? { in: by.id } : at ? { place: at.id } : null;
    const what = find(o, "what", "entity");
    if (isUnread(what)) return what;
    const here = placeOfEntity(w.state, what.id);
    if (!isThing(w.ctx, what.id)) {
      // Someone set down somewhere: out of what holds them (a vehicle), at the place, as the move path puts them.
      const to = at?.id ?? here;
      if (to === null) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at"] } };
      const failed = movePerson(o, what.id, to, false) ?? placeOnMap(o, what.id, to);
      if (failed) return failed;
    } else {
      const spot: Spot | null = asked ?? (here !== null ? { place: here } : null);
      if (spot === null) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at"] } };
      // Said to be on or with something that names nothing, and lying where it is set down already: only the words are new.
      const now = spotOf(w.state, what.id);
      const still = said.length > 0 && now !== null && ("place" in now ? "place" in spot && now.place === spot.place : "in" in spot && now.in === spot.in);
      const failed = still ? undefined : putThing(o, what.id, spot, textArg(o.args, "why") ?? "");
      if (failed) return failed;
      if ("place" in spot) {
        const mapped = placeOnMap(o, what.id, spot.place);
        if (mapped) return mapped;
      }
    }
    const kept = keepWords(o, what.id, said);
    if (kept) return kept;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const give: OpDef = {
  name: "give",
  lane: "engine",
  needs: ["what", "to", "how"],
  takes: ["what", "to", "from", "how", "until", "why"],
  example: { op: "give", what: "knife", from: "wren", to: "bram", how: "lent", until: "2031-03-02 08:00", source: { from: "prose", message: "m-0014" } },
  run(o) {
    const w = o.draft.w;
    const from = w.events.length;
    const what = find(o, "what", "thing");
    if (isUnread(what)) return what;
    const to = find(o, "to", "person");
    if (isUnread(to)) return to;
    const giver = findOptional(o, "from", "entity");
    if (isUnread(giver)) return giver;
    const how = textArg(o.args, "how");
    if (how === undefined || !Object.hasOwn(HOW_GIVEN, how)) return notOneOf(o, "how", o.args.how ?? null, Object.keys(HOW_GIVEN));
    let basis = HOW_GIVEN[how] as HandoverBasis;
    let until = timeArg(o, "until");
    if (isUnread(until)) return until;
    if (until !== undefined && !(until > w.state.clock)) {
      o.reply.report("past_until", { n: o.n, op: o.op, until: String(o.args.until) });
      until = undefined;
    }
    const holder = possessorOf(w.ctx, what.id);
    if (giver !== undefined && holder !== giver.id) o.reply.report("not_holding", { n: o.n, op: o.op, from: named(o.reading, giver.id), what: named(o.reading, what.id), holder: holder === null ? "" : named(o.reading, holder) });
    // A return to someone who is not among its owners hands it over to hold; whose it is stays as it was.
    if (basis === "return" && !ownersIn(own(w.state.entities, what.id)?.fields ?? {}).some((x) => x.party === to.id)) {
      o.reply.report("not_owner", { n: o.n, op: o.op, to: named(o.reading, to.id), what: named(o.reading, what.id) });
      basis = "hold";
    }
    const why = textArg(o.args, "why") ?? "";
    const op: ItemOp = { do: "hand", item: what.id, to: to.id, basis, why, ...(until !== undefined ? { until } : {}) };
    const out = applyItemOp(w, op, itemOptions(o));
    if ("code" in out) {
      if (out.code === "no_change") o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, what.id) });
      else if (BENT_RULES[out.code]) {
        // A vehicle taken by hand, a thing too big to carry: it goes to them all the same, as held.
        const failed = putThing(o, what.id, { in: to.id }, why);
        if (failed) return failed;
        o.reply.report("rule_bent", { n: o.n, op: o.op, what: named(o.reading, what.id), where: named(o.reading, to.id), code: out.code });
      } else return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
    } else if (out.placed !== undefined) o.reply.report("placed_instead", { n: o.n, op: o.op, what: named(o.reading, what.id), asked: named(o.reading, to.id), where: spotName(o, out.placed) });
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A slot as the call says it: "ready" (in hand), or a slot of the world's gear, as a key. */
function slotOf(said: string | undefined): string | undefined {
  if (said === undefined) return undefined;
  const key = said.toLowerCase().replace(/[\s-]+/g, "_");
  return key === "ready" || key === "hand" || key === "in_hand" ? "hand_held" : key;
}

const wear: OpDef = {
  name: "wear",
  lane: "engine",
  needs: ["what", "who"],
  takes: ["what", "who", "off", "slot"],
  example: { op: "wear", what: "cloak", who: "wren", off: true, source: { from: "prose", message: "m-0015" } },
  run(o) {
    const w = o.draft.w;
    const from = w.events.length;
    const what = find(o, "what", "thing");
    if (isUnread(what)) return what;
    const who = find(o, "who", "person");
    if (isUnread(who)) return who;
    const slot = slotOf(textArg(o.args, "slot"));
    // Put on from out of reach (someone else has it, or it is beyond a short walk): on them all the same, and reported, as a change of clothes reports a piece not to hand.
    const holder = possessorOf(w.ctx, what.id);
    const away = o.args.off !== true && holder !== who.id && (holder !== null || reachOf(w.ctx, who.id, what.id).reach === "away");
    const out = applyItemOp(w, { do: "wear", item: what.id, who: who.id, ...(o.args.off === true ? { off: true } : {}), ...(slot !== undefined ? { slot } : {}) }, itemOptions(o));
    if ("code" in out) {
      if (out.code === "no_change" || out.code === "not_worn") o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, what.id) });
      else if (out.code === "bad_slot") return notOneOf(o, "slot", o.args.slot ?? null, Object.keys(w.ctx.tables.get("gear.slots")?.rows ?? {}).concat("ready"));
      else if (BENT_RULES[out.code]) {
        // Not worn in any slot of its own: it is on them all the same, carried.
        const failed = putThing(o, what.id, { in: who.id }, "");
        if (failed) return failed;
        o.reply.report("not_wearable", { n: o.n, op: o.op, what: named(o.reading, what.id), who: named(o.reading, who.id), code: out.code });
      } else return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
    }
    if (away) o.reply.report("not_to_hand", { n: o.n, op: o.op, what: named(o.reading, what.id), who: named(o.reading, who.id), brought: true });
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** Puts someone into a holder (a vehicle, a cart, a room built as a thing): out of what holds them now, no place of their own, inside it. */
function putPerson(o: OpContext, who: EntityId, into: EntityId): Unread | undefined {
  const w = o.draft.w;
  const e = own(w.state.entities, who);
  if (!e) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: "missing_entity" } };
  if (e.relations.some((r) => r.type === "in" && r.to === into)) {
    o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, who) });
    return undefined;
  }
  const events: LedgerEvent[] = e.relations.filter((r) => r.type === "in").map((r) => ({ type: "unlink", rel: "in", from: who, to: r.to }));
  if (typeof e.fields.place === "string") events.push({ type: "set", entity: who, field: "place", value: null });
  events.push({ type: "link", rel: "in", from: who, to: into });
  const bad = o.draft.applyAll(events);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

const store: OpDef = {
  name: "store",
  lane: "engine",
  needs: ["what"],
  takes: ["what", "in", "away", "driving", "why"],
  example: { op: "store", what: "knife", in: "satchel", source: { from: "prose", message: "m-0016" } },
  run(o) {
    const w = o.draft.w;
    const from = w.events.length;
    const away = o.args.away === true;
    const said: SaidWhere[] = [];
    const into = away ? undefined : o.args.in === undefined || o.args.in === null ? find(o, "in", "point") : whereNamed(o, "in", "point", said);
    if (isUnread(into)) return into;
    if (into !== undefined && !into.ref.startsWith("place:") && !into.ref.startsWith("entity:")) return wrongIn(o, String(o.args.in));
    const isPlace = into?.ref.startsWith("place:") === true;
    const target: Spot | null = into === undefined ? null : isPlace ? { place: into.id } : { in: into.id };
    const what = find(o, "what", "entity");
    if (isUnread(what)) return what;
    const why = textArg(o.args, "why") ?? "";
    if (away) {
      const to = putAwaySpot(w.ctx, what.id);
      if (to === null) {
        // Where it is kept already, nothing needed changing; with nowhere it is kept, it could not be put away.
        const rest = restOf(w.ctx, what.id).rest;
        const here = spotOf(w.state, what.id);
        const owners = ownersIn(own(w.state.entities, what.id)?.fields ?? {}).map((x) => x.party);
        const there = rest !== null && here !== null && (rest === "owner" ? "in" in here && owners.includes(here.in) : "place" in rest ? "place" in here && here.place === rest.place : "in" in here && here.in === rest.in);
        if (there) o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, what.id) });
        else o.reply.report("kept_nowhere", { n: o.n, op: o.op, what: named(o.reading, what.id) });
      } else {
        const failed = putThing(o, what.id, to, why);
        if (failed) return failed;
      }
    } else if (into !== undefined) {
      const thing = isThing(w.ctx, what.id);
      const failed = isPlace ? (thing ? putThing(o, what.id, { place: into.id }, why) : movePerson(o, what.id, into.id, false)) : thing ? putThing(o, what.id, { in: into.id }, why) : putPerson(o, what.id, into.id);
      if (failed) return failed;
      // Who takes the driver's place is kept on the vehicle: the vehicles skill asks for it, and nothing else holds it.
      if (o.args.driving === true && !isPlace && !thing) {
        const bad = o.draft.applyAll([{ type: "set", entity: into.id, field: "driver", value: what.id }]);
        if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
      }
    }
    const kept = keepWords(o, what.id, said);
    if (kept) return kept;
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A fresh id for something made, from its name: never one the state has for someone, something or a place. */
function freshId(o: OpContext, base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "made";
  const taken = (id: string): boolean => own(o.draft.w.state.entities, id) !== undefined || own(o.draft.w.ctx.world.places, id) !== undefined;
  if (!taken(slug)) return slug;
  for (let i = 2; ; i++) if (!taken(`${slug}_${i}`)) return `${slug}_${i}`;
}

/** Where something is made, as the call says it, and the words of each way of saying where that named nothing there is, with what says so. */
interface SpawnSpot {
  spot: Spot | null;
  said: SaidWhere[];
}

/**
 * Where something is made, as the call says it: `on` a thing, `in` someone, something or a place,
 * else `at` a place; null when it says nowhere. Each is read on the draft as it stands, so it may
 * name what an earlier operation of the call made. Words that name nothing there is, nor anything
 * of another kind, are kept, and the next way of saying where is read.
 */
function spawnSpot(o: OpContext): SpawnSpot | Unread {
  const said: SaidWhere[] = [];
  const on = whereNamed(o, "on", "thing", said);
  if (isUnread(on)) return on;
  if (on) return { spot: { in: on.id }, said };
  const into = whereNamed(o, "in", "point", said);
  if (isUnread(into)) return into;
  if (into?.ref.startsWith("entity:")) return { spot: { in: into.id }, said };
  if (into?.ref.startsWith("place:")) return { spot: { place: into.id }, said };
  if (into) return wrongIn(o, String(o.args.in));
  const at = whereNamed(o, "at", "place", said);
  if (isUnread(at)) return at;
  return { spot: at ? { place: at.id } : null, said };
}

/** The scene's place, as the horizon stands when the operation runs: where its first entry that names a place, someone or something is. */
function scenePlace(o: OpContext): string | null {
  for (const ref of o.draft.storeState.horizon) {
    const place = placeThere(o, ref.startsWith("place:") ? ref.slice("place:".length) : ref.startsWith("entity:") ? placeOfEntity(o.draft.w.state, ref.slice("entity:".length)) : null);
    if (place !== null) return place;
  }
  return null;
}

/**
 * A thing made at a spot by today's things model. Where its rules would refuse the holder (it holds
 * nothing, or nothing that big), the thing is made where the holder is and put in it all the same,
 * and the answer reports the rule it bent. A thing of that name already there stands for it.
 */
function makeThing(o: OpContext, op: Extract<ItemOp, { do: "make" }>): EntityId | undefined | Unread {
  const w = o.draft.w;
  const made = (out: ItemOpApplied | ItemOpRefusal, spot: Spot): EntityId | undefined | Unread => {
    if (!("code" in out)) {
      if (out.placed !== undefined) o.reply.report("placed_instead", { n: o.n, op: o.op, what: op.name, asked: spotName(o, spot), where: spotName(o, out.placed) });
      return out.made;
    }
    // Today's find-first: what the words name is there already, and that one stands for it.
    if (out.code === "exists" && out.exists !== undefined) {
      o.reply.line("exists", { n: o.n, op: o.op, name: named(o.reading, out.exists) });
      return out.exists;
    }
    if (out.code === "missing_type") return notOneOf(o, "type", o.args.type ?? null, []);
    return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
  };
  const out = applyItemOp(w, op, itemOptions(o));
  if (!("code" in out && BENT_RULES[out.code] && "in" in op.at)) return made(out, op.at);
  const place = placeOfEntity(w.state, op.at.in);
  // What holds nothing and stands nowhere (a weather region is no place) leaves the thing nowhere to be made: a place may have been meant.
  if (place === null) return { line: "holds_nothing", fields: { n: o.n, op: o.op, what: op.name, holder: `${named(o.reading, op.at.in)} (${o.reading.whatOf(op.at.in)})` }, want: "place" };
  const there = made(applyItemOp(w, { ...op, at: { place } }, itemOptions(o)), { place });
  if (isUnread(there)) return there;
  if (there === undefined) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
  return putThing(o, there, op.at, op.why) ?? there;
}

/** The kinds a place is made as: `place`, a place of the chat's own world, inside another or in none; a room, a spot or a venue, made in play inside a place. */
export const PLACE_SPAWN_KINDS: readonly string[] = ["place", ...PLACE_KINDS];

/** What `spawn` reads of a place: its name and kind, where it is, its description, its fields, and why a place made in play was made. */
const PLACE_READS: readonly string[] = ["op", "name", "kind", "at", "in", "description", "fields", "why", ...Object.keys(PROVENANCE_PROPERTIES)];

/**
 * A place made by `spawn`, inside the place `at` (or `in`) names, which an earlier operation of the
 * call may have made, with the fields the call gives. A `place` is written into this chat's own
 * world, as today's world_place writes one, so it needs nothing to be in: the first place of a world
 * with none. A room, a spot or a venue is made in play inside a place (today's place ops, with the
 * world's cap on them). A place of that name already in the same place stands for it, and the answer
 * says so; what a place has none of (a tier, an owner) is said not to be kept.
 */
function spawnPlace(o: OpContext, name: string, kind: string): Unread | undefined {
  const w = o.draft.w;
  const field = o.args.at !== undefined && o.args.at !== null ? "at" : o.args.in !== undefined && o.args.in !== null ? "in" : null;
  const within = field === null ? undefined : find(o, field, "place");
  if (isUnread(within)) return within;
  const description = textArg(o.args, "description");
  const given = o.args.fields;
  if (given !== undefined && given !== null && !isRecord(given)) return notAs(o, "fields", given, "fields");
  const fields: JsonObject = isRecord(given) ? given : {};
  const from = w.events.length;
  let made: string | undefined;
  if (kind === "place") {
    const parent = within?.id ?? null;
    const twin = findPlaces(w.ctx, name, parent !== null ? { parent } : {}).find((h) => h.matched !== "head" && h.parent === parent);
    if (twin) {
      o.reply.line("exists", { n: o.n, op: o.op, name: named(o.reading, twin.id) });
      made = twin.id;
    } else {
      made = freshId(o, name);
      const value: JsonObject = { id: made, name, ...(parent !== null ? { parent } : {}), fields: { ...fields, ...(description !== undefined ? { description } : {}) } };
      const bad = o.draft.applyAll([draftEvent(baseWorld(w.ctx.world), chatDraftOf(w.state), { collection: "places", id: made, value })]);
      if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
    }
  } else {
    if (within === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at"] } };
    const out = placeOp(w.ctx, { do: "make", name, parent: within.id, as: kind as PlaceKind, why: textArg(o.args, "why") ?? "", ...(description !== undefined ? { description } : {}) }, { by: o.call.agent.definition, salt: o.draft.seed(o.n) });
    if ("code" in out) {
      if (out.code !== "exists" || out.exists === undefined) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
      o.reply.line("exists", { n: o.n, op: o.op, name: named(o.reading, out.exists) });
      made = out.exists;
    } else {
      // The call's fields go on the place with what today's place op writes (its description, aliases, entry), which stands where both name one.
      const events = out.events.map((e): LedgerEvent => ("data" in e && isRecord(e.data.def) ? { ...e, data: { ...e.data, def: { ...e.data.def, fields: { ...fields, ...(isRecord(e.data.def.fields) ? e.data.def.fields : {}) } } } } : e));
      const bad = o.draft.applyAll(events);
      if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
      made = out.made;
    }
  }
  const unread = Object.keys(o.args).filter((k) => !PLACE_READS.includes(k));
  if (unread.length > 0) o.reply.line("place_unread", { n: o.n, op: o.op, unread: textOf(unread) });
  o.draft.record(o.n, o.op, "engine", o.prov, from, made !== undefined ? { made } : {});
  return undefined;
}

const spawn: OpDef = {
  name: "spawn",
  lane: "engine",
  needs: ["name"],
  takes: ["name", "kind", "at", "in", "on", "tier", "fields", "bestiary", "type", "class", "qty", "owner", "description", "why"],
  example: { op: "spawn", name: "Gate guard", bestiary: "town_guard", at: "market_square", source: { from: "default" }, standing: "assumed" },
  run(o) {
    const name = textArg(o.args, "name");
    if (name === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["name"] } };
    // How many to make is a whole number of at least 1, never taken as 1 for what is not.
    const many = o.args.qty;
    if (many !== undefined && many !== null && !(typeof many === "number" && Number.isInteger(many) && many >= 1)) return notAs(o, "qty", many, "qty");
    const said = textArg(o.args, "kind");
    // A world's own kind of that name is its own; only a name no kind has makes a place.
    if (said !== undefined && PLACE_SPAWN_KINDS.includes(said) && !(own(o.reading.doc.kinds, said) ?? o.reading.registry.kinds.get(said))) return spawnPlace(o, name, said);
    const w = o.draft.w;
    const where = spawnSpot(o);
    if (isUnread(where)) return where;
    const owner = findOptional(o, "owner", "entity");
    if (isUnread(owner)) return owner;
    // Said to be somewhere in words that name nothing there is: made where its owner is, else at the scene's place; with no place either, those words cannot be read.
    let spot = where.spot;
    const [first] = where.said;
    // Where code puts it, no call said: the spawn is recorded as assumed, the call's own words kept on it.
    const chosen = spot === null && first !== undefined;
    if (chosen) {
      const place = placeThere(o, owner ? placeOfEntity(w.state, owner.id) : null) ?? scenePlace(o);
      if (place === null) return first.unread;
      spot = { place };
    }
    // The words are kept on what is made, as where it was said to be.
    const saidWhere: JsonObject = Object.fromEntries(where.said.map((s) => [`said_${s.field}`, s.words]));
    const asked = textArg(o.args, "bestiary");
    const row = asked === undefined ? undefined : bestiaryRow(o.reading.doc, asked);
    if (asked !== undefined && row === undefined) return { line: "unknown", fields: { n: o.n, op: o.op, ...unknownFields(o.call.lines, "bestiary", "bestiary", asked, bestiaryOf(o.reading.doc).map((r) => `${r.name} [${r.id}]`)) } };
    const kind = said ?? row?.kind ?? "item";
    if (!(own(o.reading.doc.kinds, kind) ?? o.reading.registry.kinds.get(kind))) return notOneOf(o, "kind", kind, kindChoices(o));
    const fields = o.args.fields;
    if (fields !== undefined && (typeof fields !== "object" || fields === null || Array.isArray(fields))) return notAs(o, "fields", fields, "fields");
    const from = w.events.length;
    let made: string | undefined;
    if (isThingKind(o, kind) && row === undefined) {
      if (spot === null) return { line: "spawn_nowhere", fields: { n: o.n, op: o.op, name, kind } };
      const qty = typeof o.args.qty === "number" ? o.args.qty : undefined;
      const type = textArg(o.args, "type");
      const vclass = textArg(o.args, "class");
      const description = textArg(o.args, "description");
      const thing = makeThing(o, { do: "make", name, at: spot, why: textArg(o.args, "why") ?? "", ...(type !== undefined ? { type } : {}), ...(vclass !== undefined ? { class: vclass } : {}), ...(owner ? { owner: owner.id } : {}), ...(qty !== undefined ? { qty } : {}), ...(description !== undefined ? { description } : {}) });
      if (isUnread(thing)) return thing;
      made = thing;
      const set = { ...((fields as JsonObject | undefined) ?? {}), ...saidWhere };
      if (thing !== undefined && Object.keys(set).length > 0) {
        const bad = o.draft.applyAll(Object.entries(set).map(([field, value]): LedgerEvent => ({ type: "set", entity: thing, field, value })));
        if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
      }
    } else {
      // A person, a group or anything else that is not a thing: today's core `spawn` effect, its sheet from the bestiary row and the call.
      const id = freshId(o, name);
      made = id;
      const holder = spot !== null && "in" in spot ? spot.in : null;
      const at = spot === null ? null : "place" in spot ? spot.place : placeOfEntity(w.state, spot.in);
      const args: Record<string, JsonValue> = { id, kind, name, fields: { ...(row?.fields ?? {}), ...((fields as JsonObject | undefined) ?? {}), ...saidWhere }, ...(holder !== null ? { relations: [{ type: "in", to: holder }] } : {}) };
      const tier = textArg(o.args, "tier") ?? row?.tier;
      if (tier !== undefined) args.tier = tier;
      if (at !== null && holder === null) args.place = at;
      const description = textArg(o.args, "description") ?? row?.description;
      if (description !== undefined) (args.fields as JsonObject).description = description;
      const out = applyEffects(o.reading.registry, w, [{ type: "spawn", args }], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
      const failed = out.rejected[0];
      if (failed) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: failed.rejection.code } };
    }
    if (first !== undefined && spot !== null) o.reply.line("made_where_said", { n: o.n, op: o.op, what: name, where: spotName(o, spot), said: textOf(where.said.map((s) => s.words)), assumed: chosen });
    o.draft.record(o.n, o.op, "engine", chosen ? { ...o.prov, standing: "assumed" } : o.prov, from, made !== undefined ? { made } : {});
    return undefined;
  },
};

/** Whether a kind is a thing's: an item, or one built on it (a container, a kit, a vehicle). */
function isThingKind(o: OpContext, kind: string): boolean {
  for (let k: string | undefined = kind, guard = 0; k !== undefined && guard < 16; guard++) {
    if (k === "item") return true;
    k = (own(o.reading.doc.kinds, k) ?? o.reading.registry.kinds.get(k))?.extends;
  }
  return false;
}

/** Every kind spawn makes, the world's own first, then the packs', then a place's; each with its label where the label says more than its name (region: Weather region). */
function kindChoices(o: OpContext): string[] {
  const { doc, registry } = o.reading;
  const kinds = [...new Set([...Object.keys(doc.kinds), ...registry.kinds.keys()])].map((k) => {
    const label = (own(doc.kinds, k) ?? registry.kinds.get(k))?.label;
    return label !== undefined && label.toLowerCase() !== k.replace(/_/g, " ").toLowerCase() ? `${k} (${label})` : k;
  });
  return [...kinds, ...PLACE_SPAWN_KINDS];
}

/** The operations on people and things, by name. */
export const THING_OPS: readonly OpDef[] = [move, place, give, wear, store, spawn];
