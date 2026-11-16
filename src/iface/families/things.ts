// Things and gear (the skill `items-and-wardrobe`): the item ops today's tools send that are not
// everyday operations of `world_apply` (a thing's condition, use, owner, who may use it, where it is
// kept, its names, two records merged, a thing lost or removed) and a person's saved outfits and
// loadouts. Each keeps today's tool name and runs today's things model (`engine/thing-ops`, the gear
// pack's sets). Where today's rules would refuse a change for what it means (a grant that ends in
// the past, a thing merged into what it holds, specs on what is not a vehicle, a set piece not to
// hand, more used than there is), it is applied all the same and the answer reports it.

import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { GRANT_BASES, type ItemOp, nameKey, PERMIT_SCOPES, type Rest, SET_KINDS, type SetKind, type SetPiece, setsOf, SIZES, type Size } from "../../shared/things";
import { vehicleSpecsOf } from "../../shared/vehicles";
import { isGone, kindDef } from "../../engine/scope";
import { applyItemOp } from "../../engine/thing-ops";
import { slotOf, spotOf } from "../../engine/things";
import { own } from "../../engine/pack-kit";
import { pieceProblem, saveFindings } from "../../packs/gear/core/sets";
import { oneOf, TEXT, TEXTS, WHOLE, YES_NO } from "../kit";
import { find, isUnread, itemOptions, named, notAs, notOneOf, type OpContext, textArg, type Unread } from "../ops";
import { BENT_RULES, putThing } from "../ops-things";
import { timeArg } from "../ops-time";
import { editChange, isAlready, itemChange, notApplicable, optionalId, type WriteDef, writeTool } from "./run";

const FAMILY = "things";

/** A choice argument that may be left out. */
function choiceArg<T extends string>(o: OpContext, field: string, choices: readonly T[]): T | Unread | undefined {
  const said = textArg(o.args, field);
  if (said === undefined) return undefined;
  const v = choices.find((c) => c === said.toLowerCase());
  return v ?? notOneOf(o, field, o.args[field] ?? null, choices);
}

/** A person's saved set as the call names it: its id, or its name as said ("her work clothes" is Work). */
function setOf(o: OpContext, who: EntityId): string | Unread {
  const said = textArg(o.args, "set") ?? "";
  const sets = setsOf(own(o.draft.w.state.entities, who)?.fields);
  if (hasOwn(sets, said)) return said;
  const key = nameKey(said);
  const id = Object.keys(sets).find((s) => sets[s]?.name.trim().toLowerCase() === said.toLowerCase()) ?? Object.keys(sets).find((s) => key !== null && nameKey(sets[s]?.name ?? "")?.words.every((w) => key.words.includes(w)) === true);
  return id ?? notOneOf(o, "set", o.args.set ?? null, Object.values(sets).map((s) => s.name));
}

const PROPS = {
  item: TEXT,
  who: TEXT,
  until: TEXT,
  by: TEXT,
};

const condition: WriteDef = {
  name: "item_condition",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, delta: WHOLE },
  required: ["item", "delta"],
  example: { item: "knife", delta: -20, source: { from: "prose", message: "m-0101" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const delta = o.args.delta;
    if (typeof delta !== "number" || !Number.isInteger(delta)) return notAs(o, "delta", delta ?? null, "delta");
    return itemChange(o, { do: "condition", item: item.id, delta }, "engine", item.id);
  },
};

const use: WriteDef = {
  name: "item_use",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, qty: WHOLE },
  required: ["item"],
  example: { item: "candle", qty: 1, source: { from: "prose", message: "m-0102" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const qty = o.args.qty;
    if (qty !== undefined && qty !== null && !(typeof qty === "number" && Number.isInteger(qty) && qty >= 1)) return notAs(o, "qty", qty, "qty");
    const stored = own(o.draft.w.state.entities, item.id)?.fields.qty;
    const held = typeof stored === "number" ? stored : 1;
    const used = typeof qty === "number" ? qty : 1;
    const failed = itemChange(o, { do: "use", item: item.id, ...(typeof qty === "number" ? { qty } : {}) }, "engine", item.id);
    // More used than there was: today's use takes the last of it out of the world, and says nothing.
    if (failed === undefined && used > held) o.reply.report("used_past_held", { n: o.n, op: o.op, what: named(o.reading, item.id), qty: used, held });
    return failed;
  },
};

/** The words that make a thing no one's (today's `item_own`). */
const NOBODY: Readonly<Record<string, true>> = { nobody: true, "no one": true, none: true, null: true };

const ownership: WriteDef = {
  name: "item_own",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, owner: TEXT },
  required: ["item", "owner"],
  example: { item: "knife", owner: "bram", source: { from: "prose", message: "m-0103" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const said = textArg(o.args, "owner") ?? "";
    let owner: EntityId | null = null;
    if (!hasOwn(NOBODY, said.toLowerCase())) {
      const found = find(o, "owner", "entity");
      if (isUnread(found)) return found;
      owner = found.id;
    }
    return itemChange(o, { do: "own", item: item.id, owner, why: "" }, "engine", item.id);
  },
};

const grant: WriteDef = {
  name: "item_grant",
  family: FAMILY,
  lane: "engine",
  properties: { ...PROPS, basis: oneOf(GRANT_BASES) },
  required: ["item", "who"],
  example: { item: "knife", who: "odile", basis: "loan", until: "2031-03-02 08:00", by: "wren", source: { from: "prose", message: "m-0104" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    const basis = choiceArg(o, "basis", GRANT_BASES);
    if (isUnread(basis)) return basis;
    const by = optionalId(o, "by", "entity");
    if (isUnread(by)) return by;
    const until = timeArg(o, "until");
    if (isUnread(until)) return until;
    return itemChange(o, { do: "grant", item: item.id, who: who.id, ...(basis !== undefined ? { basis } : {}), ...(until !== undefined ? { until } : {}), ...(by !== undefined ? { by } : {}) }, "engine", item.id);
  },
};

const revoke: WriteDef = {
  name: "item_revoke",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, who: TEXT },
  required: ["item", "who"],
  example: { item: "knife", who: "odile", source: { from: "prose", message: "m-0105" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    return itemChange(o, { do: "revoke", item: item.id, who: who.id }, "engine", item.id);
  },
};

const permit: WriteDef = {
  name: "item_permit",
  family: FAMILY,
  lane: "engine",
  properties: { from: TEXT, to: TEXT, scope: oneOf(PERMIT_SCOPES), until: TEXT, by: TEXT },
  required: ["from", "to"],
  example: { from: "bram", to: "odile", scope: "home", source: { from: "prose", message: "m-0106" } },
  run(o) {
    const from = find(o, "from", "entity");
    if (isUnread(from)) return from;
    const to = find(o, "to", "entity");
    if (isUnread(to)) return to;
    const scope = choiceArg(o, "scope", PERMIT_SCOPES);
    if (isUnread(scope)) return scope;
    const by = optionalId(o, "by", "entity");
    if (isUnread(by)) return by;
    const until = timeArg(o, "until");
    if (isUnread(until)) return until;
    // Leave of one's own things changes nothing.
    if (from.id === to.id) {
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, from.id) });
      o.draft.record(o.n, o.op, "engine", o.prov, o.draft.w.events.length);
      return undefined;
    }
    return itemChange(o, { do: "permit", from: from.id, to: to.id, ...(scope !== undefined ? { scope } : {}), ...(until !== undefined ? { until } : {}), ...(by !== undefined ? { by } : {}) }, "engine", from.id);
  },
};

const unpermit: WriteDef = {
  name: "item_unpermit",
  family: FAMILY,
  lane: "engine",
  properties: { from: TEXT, to: TEXT },
  required: ["from", "to"],
  example: { from: "bram", to: "odile", source: { from: "prose", message: "m-0107" } },
  run(o) {
    const from = find(o, "from", "entity");
    if (isUnread(from)) return from;
    const to = find(o, "to", "entity");
    if (isUnread(to)) return to;
    return itemChange(o, { do: "unpermit", from: from.id, to: to.id }, "engine", from.id);
  },
};

const home: WriteDef = {
  name: "item_home",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, in: TEXT, at: TEXT, owner: YES_NO, clear: YES_NO },
  required: ["item"],
  example: { item: "cloak", in: "satchel", source: { from: "prose", message: "m-0108" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const ways = ["in", "at", "owner", "clear"];
    const given = ways.filter((f) => (f === "owner" || f === "clear" ? o.args[f] === true : textArg(o.args, f) !== undefined));
    if (given.length !== 1) return { line: "needs_one", fields: { n: o.n, op: o.op, fields: ways } };
    let rest: Rest | null;
    if (given[0] === "clear") rest = null;
    else if (given[0] === "owner") rest = "owner";
    else if (given[0] === "in") {
      // Anyone or anything: one the world's rules say holds nothing is where the thing is kept all the same, and the answer says so.
      const found = find(o, "in", "entity");
      if (isUnread(found)) return found;
      const holder = found.id;
      return itemChange(o, { do: "home", item: item.id, home: { in: holder } }, "engine", item.id, {
        bend: (code) => {
          if (!BENT_RULES[code]) return null;
          if (own(o.draft.w.state.entities, item.id)?.fields.home === holder) {
            o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, item.id) });
            return undefined;
          }
          const bad = o.draft.applyAll([{ type: "set", entity: item.id, field: "home", value: holder }]);
          if (bad) return notApplicable(o, bad.code);
          o.reply.report("rule_bent", { n: o.n, op: o.op, what: named(o.reading, item.id), where: named(o.reading, holder), code });
          return undefined;
        },
      });
    } else {
      const place = find(o, "at", "place");
      if (isUnread(place)) return place;
      rest = { place: place.id };
    }
    return itemChange(o, { do: "home", item: item.id, home: rest }, "engine", item.id);
  },
};

const label: WriteDef = {
  name: "item_label",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, name: TEXT, aliases: TEXTS, description: TEXT, size: oneOf(SIZES), specs: { type: "array", items: { type: "object", properties: { label: TEXT, value: TEXT }, required: ["label", "value"] } } },
  required: ["item"],
  example: { item: "knife", name: "Bone-handled knife", aliases: ["the bone knife"], source: { from: "prose", message: "m-0109" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    const size = choiceArg<Size>(o, "size", SIZES);
    if (isUnread(size)) return size;
    const name = textArg(o.args, "name");
    const aliases = Array.isArray(o.args.aliases) ? o.args.aliases.filter((a): a is string => typeof a === "string") : undefined;
    const description = typeof o.args.description === "string" ? o.args.description : undefined;
    const specs = o.args.specs === undefined ? null : vehicleSpecsOf(o.args.specs);
    if (o.args.specs !== undefined && specs === null) return notAs(o, "specs", o.args.specs, "specs");
    const rest = { item: item.id, ...(name !== undefined ? { name } : {}), ...(aliases !== undefined ? { aliases } : {}), ...(description !== undefined ? { description } : {}), ...(size !== undefined ? { size } : {}) };
    const op: ItemOp = { do: "label", ...rest, ...(specs !== null ? { specs } : {}) };
    return itemChange(o, op, "engine", item.id, {
      // Specs on what is not a vehicle: the rest of the label as asked, and the specs kept on it all the same.
      bend: (code) => {
        if (code !== "not_a_vehicle" || specs === null) return null;
        const w = o.draft.w;
        if (Object.keys(rest).length > 1) {
          const out = applyItemOp(w, { do: "label", ...rest }, itemOptions(o));
          if ("code" in out && !isAlready(out.code)) return notApplicable(o, out.code);
        }
        const value = specs.length > 0 ? specs.map((s) => ({ label: s.label, value: s.value })) : null;
        const bad = o.draft.applyAll([{ type: "set", entity: item.id, field: "specs", value }]);
        if (bad) return notApplicable(o, bad.code);
        const e = own(w.state.entities, item.id);
        o.reply.report("off_the_sheet", { n: o.n, op: o.op, key: "specs", name: named(o.reading, item.id), value: JSON.stringify(value), type: e ? (kindDef(o.reading.registry, o.reading.doc, e.kind)?.label ?? e.kind) : "" });
        return undefined;
      },
    });
  },
};

const merge: WriteDef = {
  name: "item_merge",
  family: FAMILY,
  lane: "engine",
  properties: { keep: TEXT, drop: TEXT },
  required: ["keep", "drop"],
  example: { keep: "knife", drop: "spare knife", source: { from: "prose", message: "m-0110" } },
  run(o) {
    const keep = find(o, "keep", "thing");
    if (isUnread(keep)) return keep;
    const drop = find(o, "drop", "thing");
    if (isUnread(drop)) return drop;
    const op: ItemOp = { do: "merge", keep: keep.id, drop: drop.id };
    return itemChange(o, op, "engine", keep.id, {
      // The one kept is inside the one dropped: it comes out to where that one is, as a thing is put anywhere, and they merge.
      bend: (code) => {
        if (code !== "cycle") return null;
        const w = o.draft.w;
        const spot = spotOf(w.state, drop.id);
        if (spot === null) return null;
        const failed = putThing(o, keep.id, spot, "");
        if (failed) return failed;
        const out = applyItemOp(w, op, itemOptions(o));
        if ("code" in out) return notApplicable(o, out.code);
        o.reply.report("rule_bent", { n: o.n, op: o.op, what: named(o.reading, keep.id), where: named(o.reading, "place" in spot ? spot.place : spot.in), code });
        return undefined;
      },
    });
  },
};

const lose: WriteDef = {
  name: "item_lose",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, by: TEXT },
  required: ["item"],
  example: { item: "purse", by: "tam", source: { from: "prose", message: "m-0111" } },
  run(o) {
    const item = find(o, "item", "thing");
    if (isUnread(item)) return item;
    // Taken by what is not a person is, for this tool, someone who does not exist: the answer gives the nearest people and the operations that record what was meant.
    const by = optionalId(o, "by", "person");
    if (isUnread(by)) return by.line === "unknown" ? { ...by, line: "unknown_by" } : by;
    return itemChange(o, { do: "lose", item: item.id, ...(by !== undefined ? { by } : {}) }, "engine", item.id, { ...(by !== undefined ? { asked: by } : {}) });
  },
};

const remove: WriteDef = {
  name: "item_remove",
  family: FAMILY,
  lane: "engine",
  properties: { item: TEXT, why: TEXT },
  required: ["item", "why"],
  example: { item: "cask", why: "smashed to staves", source: { from: "prose", message: "m-0112" } },
  run(o) {
    const item = find(o, "item", "thing", true);
    if (isUnread(item)) return item;
    const from = o.draft.w.events.length;
    const refused = editChange(o, { op: "item", change: { do: "remove", item: item.id, why: textArg(o.args, "why") ?? "" } });
    if (refused !== null) {
      if (!isAlready(refused.code)) return notApplicable(o, refused.code);
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, item.id) });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const setSave: WriteDef = {
  name: "set_save",
  family: FAMILY,
  lane: "engine",
  properties: { who: TEXT, name: TEXT, kind: oneOf(SET_KINDS), pieces: TEXTS },
  required: ["who", "name", "kind"],
  example: { who: "wren", name: "Travelling", kind: "outfit", pieces: ["cloak"], source: { from: "prose", message: "m-0113" } },
  run(o) {
    const who = find(o, "who", "person");
    if (isUnread(who)) return who;
    const kind = choiceArg<SetKind>(o, "kind", SET_KINDS);
    if (kind === undefined || isUnread(kind)) return kind ?? notOneOf(o, "kind", null, SET_KINDS);
    const pieces: SetPiece[] = [];
    for (const said of Array.isArray(o.args.pieces) ? o.args.pieces : []) {
      const piece = find(o, "pieces", "thing", false, said);
      if (isUnread(piece)) return piece;
      pieces.push({ item: piece.id });
    }
    const name = textArg(o.args, "name");
    if (name === undefined) return notAs(o, "name", o.args.name ?? null, "name");
    const op = { do: "set_save" as const, who: who.id, name, kind, ...(pieces.length > 0 ? { pieces } : {}) };
    // Neither a set with nothing in it nor one past the world's number of sets is refused: each is saved, and the answer says so.
    const found = saveFindings(o.draft.w.ctx, op);
    const failed = itemChange(o, op, "engine", who.id);
    if (failed === undefined) for (const f of found) o.reply.report(f.code === "nothing_worn" ? "set_nothing_worn" : "set_past_max", { n: o.n, op: o.op, who: named(o.reading, who.id), name, ...f.values });
    return failed;
  },
};

/**
 * A piece of a set not to hand put on them all the same, brought from wherever it is, as `wear`
 * brings it; one with no place on the body (or a slot the world no longer has) is carried, as the
 * `wear` operation carries it.
 */
function putOn(o: OpContext, piece: SetPiece, who: EntityId): Unread | undefined {
  const w = o.draft.w;
  const slot = piece.slot ?? slotOf(w.ctx, own(w.state.entities, piece.item)?.fields ?? {});
  const out = applyItemOp(w, { do: "wear", item: piece.item, who, ...(slot !== null ? { slot } : {}) }, itemOptions(o));
  if (!("code" in out) || isAlready(out.code)) return undefined;
  if (!BENT_RULES[out.code] && out.code !== "bad_slot") return notApplicable(o, out.code);
  const failed = putThing(o, piece.item, { in: who }, "");
  if (failed) return failed;
  o.reply.report("not_wearable", { n: o.n, op: o.op, what: named(o.reading, piece.item), who: named(o.reading, who), code: out.code });
  return undefined;
}

const setApply: WriteDef = {
  name: "set_apply",
  family: FAMILY,
  lane: "engine",
  properties: { who: TEXT, set: TEXT },
  required: ["who", "set"],
  example: { who: "wren", set: "Travelling", source: { from: "prose", message: "m-0114" } },
  run(o) {
    const who = find(o, "who", "person");
    if (isUnread(who)) return who;
    const set = setOf(o, who.id);
    if (isUnread(set)) return set;
    const w = o.draft.w;
    const from = w.events.length;
    // Today's change of clothes leaves out each piece not to hand, by today's own test of it, and
    // only writes it in a note: each is put on them first, and reported; one gone or lost cannot
    // be, and that is reported too.
    for (const piece of setsOf(own(w.state.entities, who.id)?.fields)[set]?.pieces ?? []) {
      if (pieceProblem(w.ctx, who.id, piece.item) === null) continue;
      const thing = own(w.state.entities, piece.item);
      const there = thing !== undefined && !isGone(w.state, piece.item) && thing.fields.lost !== true;
      if (there) {
        const failed = putOn(o, piece, who.id);
        if (failed) return failed;
      }
      o.reply.report("not_to_hand", { n: o.n, op: o.op, what: named(o.reading, piece.item), who: named(o.reading, who.id), brought: there });
    }
    const out = applyItemOp(w, { do: "set_apply", who: who.id, set }, itemOptions(o));
    // None of it to hand now: every piece is gone or lost, each reported, and nothing else changes.
    if ("code" in out && out.code !== "none_to_hand") {
      if (!isAlready(out.code)) return notApplicable(o, out.code);
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, who.id) });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const setDrop: WriteDef = {
  name: "set_drop",
  family: FAMILY,
  lane: "engine",
  properties: { who: TEXT, set: TEXT },
  required: ["who", "set"],
  example: { who: "wren", set: "Travelling", source: { from: "prose", message: "m-0115" } },
  run(o) {
    const who = find(o, "who", "person");
    if (isUnread(who)) return who;
    const set = setOf(o, who.id);
    if (isUnread(set)) return set;
    return itemChange(o, { do: "set_drop", who: who.id, set }, "engine", who.id);
  },
};

/** The family's tools, as RPH's search finds them. */
export const THING_TOOLS = [condition, use, ownership, grant, revoke, permit, unpermit, home, label, merge, lose, remove, setSave, setApply, setDrop].map(writeTool);
