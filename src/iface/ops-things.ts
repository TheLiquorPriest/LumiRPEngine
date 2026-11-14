// The everyday operations on people and things (the skills `items-and-wardrobe`, `vehicles`,
// `places-and-maps`): `move`, `place`, `give`, `wear`, `store` and `spawn`. Each runs through
// today's things model and moves (`engine/thing-ops`, `engine/relocate`), which keep a thing's four
// facts apart. Where today's rules would refuse a change for what it means (a thing too big for
// what it goes into, a return to someone who is not its owner, a giver who does not hold it), the
// change is applied all the same and the answer reports it.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { ownersIn } from "../shared/finance";
import type { EntityId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import { HANDOVER_BASES, type HandoverBasis, type ItemOp, type Spot } from "../shared/things";
import { applyEffects } from "../engine/effects";
import { own } from "../engine/pack-kit";
import { relocate } from "../engine/relocate";
import { createRng } from "../engine/rng";
import { placeOfEntity } from "../engine/scope";
import { putAwaySpot } from "../engine/thing-gm";
import { applyItemOp, locate } from "../engine/thing-ops";
import { isThing, possessorOf } from "../engine/things";
import { bestiaryRow } from "./bestiary";
import { find, findOptional, isUnread, itemOptions, named, notOneOf, type OpContext, type OpDef, textArg, type Unread } from "./ops";
import { timeArg } from "./ops-time";

/** How a thing passed from one person to another, as the skill says it, to today's handover bases. */
export const HOW_GIVEN: Readonly<Record<string, HandoverBasis>> = { handed: "hold", lent: "loan", returned: "return", given: "gift", sold: "sale", traded: "trade", stolen: "theft" };

/** The refusals of today's things model that are about what a change means, never about whether it can be read: applied all the same, and reported. */
const BENT_RULES: Readonly<Record<string, true>> = { part: true, builtin: true, cant_hold: true, too_big: true, too_deep: true, no_room: true, cycle: true, not_owner: true, no_slot: true };

/** Where a spot is, for an answer: a place's or a holder's name with its id. */
function spotName(o: OpContext, spot: Spot): string {
  return named(o.reading, "place" in spot ? spot.place : spot.in);
}

/**
 * Puts a thing at a spot through today's one location writer and its size rules; where those
 * rules would refuse (it does not fit, it is built in, it would sit inside itself), it is put there
 * all the same and the answer reports which rule it bent. A thing already there changes nothing,
 * and that is reported too.
 */
function putThing(o: OpContext, thing: EntityId, to: Spot, why: string): Unread | undefined {
  const w = o.draft.w;
  const out = applyItemOp(w, { do: "move", item: thing, to, why }, itemOptions(o));
  if (!("code" in out)) {
    if (out.placed !== undefined) o.reply.report("placed_instead", { n: o.n, op: o.op, what: named(o.reading, thing), asked: spotName(o, to), where: spotName(o, out.placed) });
    return undefined;
  }
  if (out.code === "no_change") {
    o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, thing) });
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

/** A square on a map, as `[column, row]`; undefined when none is given. */
function squareArg(o: OpContext): [number, number] | Unread | undefined {
  const v = o.args.square;
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0)) return [v[0] as number, v[1] as number];
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "square", value: JSON.stringify(v), choices: ["[column, row]"] } };
}

/** Puts someone or something at a square, beside someone, or in a zone of the place's map, through the grid's own placing. */
function placeOnMap(o: OpContext, who: EntityId, place: string): Unread | undefined {
  const square = squareArg(o);
  if (isUnread(square)) return square;
  const near = findOptional(o, "near", "entity");
  if (isUnread(near)) return near;
  const zone = textArg(o.args, "zone");
  if (square === undefined && near === undefined && zone === undefined) return undefined;
  const grid = o.call.deps.grid;
  if (grid === undefined) return { line: "no_grid", fields: { n: o.n, op: o.op } };
  const placed = grid.place({ state: { ...o.reading.state, world: o.draft.w.state }, env: o.call.deps.env, who, place, ...(square ? { square } : {}), ...(near ? { near: near.id } : {}), ...(zone !== undefined ? { zone } : {}) });
  if ("problem" in placed) return { line: placed.problem, fields: { n: o.n, op: o.op, ...placed.fields } };
  const bad = o.draft.applyAll(placed.events as unknown as LedgerEvent[]);
  return bad ? { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } } : undefined;
}

const move: OpDef = {
  name: "move",
  lane: "engine",
  needs: ["who", "to"],
  takes: ["who", "to", "with", "square", "near", "zone", "why"],
  example: { op: "move", who: "bram", to: "market_square", with: ["odile"], source: { from: "prose", message: "m-0012" }, standing: "established" },
  run(o) {
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    const to = find(o, "to", "place");
    if (isUnread(to)) return to;
    const company: EntityId[] = [];
    const given = o.args.with;
    for (const said of Array.isArray(given) ? given : typeof given === "string" ? [given] : []) {
      if (typeof said !== "string") continue;
      const r = find(o, "with", "entity", false, said);
      if (isUnread(r)) return r;
      company.push(r.id);
    }
    const from = o.draft.w.events.length;
    for (const [i, id] of [who.id, ...company].entries()) {
      const failed = isThing(o.draft.w.ctx, id) ? putThing(o, id, { place: to.id }, textArg(o.args, "why") ?? "") : movePerson(o, id, to.id, i > 0);
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
    const what = find(o, "what", "entity");
    if (isUnread(what)) return what;
    const at = findOptional(o, "at", "place");
    if (isUnread(at)) return at;
    const on = findOptional(o, "on", "thing");
    if (isUnread(on)) return on;
    const by = findOptional(o, "by", "person");
    if (isUnread(by)) return by;
    const w = o.draft.w;
    const from = w.events.length;
    const here = placeOfEntity(w.state, what.id);
    if (!isThing(w.ctx, what.id)) {
      // Someone set down somewhere: out of what holds them (a vehicle), at the place, as the move path puts them.
      const to = at?.id ?? here;
      if (to === null) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at"] } };
      const failed = movePerson(o, what.id, to, false) ?? placeOnMap(o, what.id, to);
      if (failed) return failed;
    } else {
      const spot: Spot | null = at ? { place: at.id } : on ? { in: on.id } : by ? { in: by.id } : here !== null ? { place: here } : null;
      if (spot === null) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at"] } };
      const failed = putThing(o, what.id, spot, textArg(o.args, "why") ?? "");
      if (failed) return failed;
      if ("place" in spot) {
        const mapped = placeOnMap(o, what.id, spot.place);
        if (mapped) return mapped;
      }
    }
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
    const what = find(o, "what", "thing");
    if (isUnread(what)) return what;
    const to = find(o, "to", "person");
    if (isUnread(to)) return to;
    const giver = findOptional(o, "from", "entity");
    if (isUnread(giver)) return giver;
    const how = textArg(o.args, "how");
    if (how === undefined || !Object.hasOwn(HOW_GIVEN, how)) return notOneOf(o, "how", o.args.how ?? null, Object.keys(HOW_GIVEN));
    let basis = HOW_GIVEN[how] as HandoverBasis;
    const w = o.draft.w;
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
    const from = w.events.length;
    const why = textArg(o.args, "why") ?? "";
    const op: ItemOp = { do: "hand", item: what.id, to: to.id, basis, why, ...(until !== undefined ? { until } : {}) };
    const out = applyItemOp(w, op, itemOptions(o));
    if ("code" in out) {
      if (out.code === "no_change") o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, what.id) });
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
    const what = find(o, "what", "thing");
    if (isUnread(what)) return what;
    const who = find(o, "who", "person");
    if (isUnread(who)) return who;
    const slot = slotOf(textArg(o.args, "slot"));
    const w = o.draft.w;
    const from = w.events.length;
    const out = applyItemOp(w, { do: "wear", item: what.id, who: who.id, ...(o.args.off === true ? { off: true } : {}), ...(slot !== undefined ? { slot } : {}) }, itemOptions(o));
    if ("code" in out) {
      if (out.code === "no_change" || out.code === "not_worn") o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, what.id) });
      else if (out.code === "bad_slot") return notOneOf(o, "slot", o.args.slot ?? null, Object.keys(w.ctx.tables.get("gear.slots")?.rows ?? {}).concat("ready"));
      else if (BENT_RULES[out.code]) {
        // Not worn in any slot of its own: it is on them all the same, carried.
        const failed = putThing(o, what.id, { in: who.id }, "");
        if (failed) return failed;
        o.reply.report("not_wearable", { n: o.n, op: o.op, what: named(o.reading, what.id), who: named(o.reading, who.id), code: out.code });
      } else return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
    }
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
    o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, who) });
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
    const what = find(o, "what", "entity");
    if (isUnread(what)) return what;
    const w = o.draft.w;
    const from = w.events.length;
    const why = textArg(o.args, "why") ?? "";
    if (o.args.away === true) {
      const to = putAwaySpot(w.ctx, what.id);
      if (to === null) o.reply.report("kept_nowhere", { n: o.n, op: o.op, what: named(o.reading, what.id) });
      else {
        const failed = putThing(o, what.id, to, why);
        if (failed) return failed;
      }
    } else {
      const into = find(o, "in", "point");
      if (isUnread(into)) return into;
      const isPlace = into.ref.startsWith("place:");
      if (!isPlace && !into.ref.startsWith("entity:")) return { line: "unknown", fields: { n: o.n, op: o.op, field: "in", name: String(o.args.in), wanted: "holder", near: [] } };
      const thing = isThing(w.ctx, what.id);
      const failed = isPlace ? (thing ? putThing(o, what.id, { place: into.id }, why) : movePerson(o, what.id, into.id, false)) : thing ? putThing(o, what.id, { in: into.id }, why) : putPerson(o, what.id, into.id);
      if (failed) return failed;
      // Who takes the driver's place is kept on the vehicle: the vehicles skill asks for it, and nothing else holds it.
      if (o.args.driving === true && !isPlace && !thing) {
        const bad = o.draft.applyAll([{ type: "set", entity: into.id, field: "driver", value: what.id }]);
        if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
      }
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A fresh id for something made, from its name: never one the state has. */
function freshId(o: OpContext, base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "made";
  const taken = (id: string): boolean => own(o.draft.w.state.entities, id) !== undefined;
  if (!taken(slug)) return slug;
  for (let i = 2; ; i++) if (!taken(`${slug}_${i}`)) return `${slug}_${i}`;
}

const spawn: OpDef = {
  name: "spawn",
  lane: "engine",
  needs: ["name"],
  takes: ["name", "kind", "at", "in", "tier", "fields", "bestiary", "type", "class", "qty", "owner", "description", "why"],
  example: { op: "spawn", name: "Gate guard", bestiary: "town_guard", at: "market_square", source: { from: "default" }, standing: "assumed" },
  run(o) {
    const name = textArg(o.args, "name");
    if (name === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["name"] } };
    const w = o.draft.w;
    const at = findOptional(o, "at", "place");
    if (isUnread(at)) return at;
    const holder = findOptional(o, "in", "holder");
    if (isUnread(holder)) return holder;
    const owner = findOptional(o, "owner", "entity");
    if (isUnread(owner)) return owner;
    const said = textArg(o.args, "bestiary");
    const row = said === undefined ? undefined : bestiaryRow(o.reading.doc, said);
    if (said !== undefined && row === undefined) return { line: "unknown", fields: { n: o.n, op: o.op, field: "bestiary", name: said, wanted: "bestiary row", near: [] } };
    const kind = textArg(o.args, "kind") ?? row?.kind ?? "item";
    if (!(own(o.reading.doc.kinds, kind) ?? o.reading.registry.kinds.get(kind))) return notOneOf(o, "kind", kind, [...new Set([...Object.keys(o.reading.doc.kinds), ...o.reading.registry.kinds.keys()])]);
    const fields = o.args.fields;
    if (fields !== undefined && (typeof fields !== "object" || fields === null || Array.isArray(fields))) return notOneOf(o, "fields", fields, ["an object of field: value"]);
    const from = w.events.length;
    const item = isThingKind(o, kind);
    let made: string | undefined;
    if (item && row === undefined) {
      const spot: Spot | null = holder ? { in: holder.id } : at ? { place: at.id } : null;
      if (spot === null) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at", "in"] } };
      const qty = typeof o.args.qty === "number" && Number.isInteger(o.args.qty) && o.args.qty >= 1 ? o.args.qty : undefined;
      const type = textArg(o.args, "type");
      const vclass = textArg(o.args, "class");
      const description = textArg(o.args, "description");
      const out = applyItemOp(w, { do: "make", name, at: spot, why: textArg(o.args, "why") ?? "", ...(type !== undefined ? { type } : {}), ...(vclass !== undefined ? { class: vclass } : {}), ...(owner ? { owner: owner.id } : {}), ...(qty !== undefined ? { qty } : {}), ...(description !== undefined ? { description } : {}) }, itemOptions(o));
      if ("code" in out) {
        // Today's find-first: what the words name is there already, and that one stands for it.
        if (out.code === "exists" && out.exists !== undefined) {
          o.reply.report("exists", { n: o.n, op: o.op, name: named(o.reading, out.exists) });
          made = out.exists;
        } else if (out.code === "missing_type") return notOneOf(o, "type", o.args.type ?? null, []);
        else return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
      } else {
        made = out.made;
        if (out.placed !== undefined) o.reply.report("placed_instead", { n: o.n, op: o.op, what: name, asked: spotName(o, spot), where: spotName(o, out.placed) });
      }
      if (made !== undefined && fields !== undefined) {
        const bad = o.draft.applyAll(Object.entries(fields as JsonObject).map(([field, value]): LedgerEvent => ({ type: "set", entity: made as string, field, value })));
        if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
      }
    } else {
      // A person, a group or anything else that is not a thing: today's core `spawn` effect, its sheet from the bestiary row and the call.
      const id = freshId(o, name);
      const where = at?.id ?? (holder ? placeOfEntity(w.state, holder.id) : null);
      const args: Record<string, JsonValue> = { id, kind, name, fields: { ...(row?.fields ?? {}), ...((fields as JsonObject | undefined) ?? {}) }, ...(holder ? { relations: [{ type: "in", to: holder.id }] } : {}) };
      const tier = textArg(o.args, "tier") ?? row?.tier;
      if (tier !== undefined) args.tier = tier;
      if (where !== null && !holder) args.place = where;
      const description = textArg(o.args, "description") ?? row?.description;
      if (description !== undefined) (args.fields as JsonObject).description = description;
      const out = applyEffects(o.reading.registry, w, [{ type: "spawn", args }], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
      const failed = out.rejected[0];
      if (failed) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: failed.rejection.code } };
      made = id;
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from, made !== undefined ? { made } : {});
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

/** The operations on people and things, by name. */
export const THING_OPS: readonly OpDef[] = [move, place, give, wear, store, spawn];
