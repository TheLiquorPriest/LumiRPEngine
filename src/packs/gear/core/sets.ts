// Saved sets (DESIGN §28.16): a person's outfits and loadouts, kept on them (`fields.sets`, by id: a
// name, a kind and its pieces, each a thing and the slot it goes in when that isn't its own), at
// most the world's `packs.gear.config.sets.max`. Saving keeps what they wear now of the kind (an
// outfit what dresses them; a loadout what they carry ready: in hand, holstered, sheathed, in a
// quiver, on their back or a shoulder, and arms, armor and ammunition worn), or the pieces given.
// Changing into one (Gear 3) puts each piece on in its slot through the item op `wear`, so what held
// a slot comes off and stays carried; whatever else of the kind they wear comes off too (an
// outfit's other clothes), and at home what came off goes back where it is kept (`restOf`, as Put
// away takes it). A piece they can't reach (gone, lost, someone else has it, not on them, here or a
// short walk away) is left and named. Every change is the item ops' own events. Pure.

import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { SET_KIND_LABEL, SET_NAME_MAX, setIdOf, setsOf, thingsConfigOf, type SavedSet, type SetKind, type SetOp, type SetPiece } from "../../../shared/things";
import { accessFor, reachOf } from "../../../engine/access";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { labelOf, own } from "../../../engine/pack-kit";
import { together } from "../../../engine/presence";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { isGone, kindIs, placeOfEntity, placeWithin } from "../../../engine/scope";
import { applyItemOp, type ItemOpOptions } from "../../../engine/thing-ops";
import { contentsOf, isThing, possessorOf, restOf, setKindOf, slotOf } from "../../../engine/things";
import { Working } from "../../../engine/working";
import type { GearSet, GearSetPiece } from "./view";

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** The slot a worn thing is in on `who`: its relation's, else its own; null when it isn't worn by them. */
function wornSlot(ctx: ReadContext, who: EntityId, thing: EntityId): string | null {
  const e = own(ctx.state.entities, thing);
  const r = e?.relations.find((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who);
  if (!e || !r) return null;
  return typeof r.fields?.slot === "string" && r.fields.slot !== "" ? r.fields.slot : slotOf(ctx, e.fields);
}

/** What `who` wears now (directly on them, in a slot that isn't a pocket), in id order: each thing, and its slot when that isn't its own; of one kind of set, or every kind. */
export function wornPieces(ctx: ReadContext, who: EntityId, kind?: SetKind): SetPiece[] {
  const out: SetPiece[] = [];
  for (const id of contentsOf(ctx.state, who)) {
    const e = own(ctx.state.entities, id);
    const slot = wornSlot(ctx, who, id);
    if (!e || slot === null || isGone(ctx.state, id)) continue;
    const of = setKindOf(ctx, e.fields, slot);
    if (of === null || (kind !== undefined && of !== kind)) continue;
    out.push({ item: id, ...(slot !== slotOf(ctx, e.fields) ? { slot } : {}) });
  }
  return out;
}

/** Why `who` can't put a set's piece on now, in words after its name, or null: gone, lost, someone else has it, it isn't theirs to use, or it is beyond a short walk. */
export function pieceProblem(ctx: ReadContext, who: EntityId, item: EntityId): string | null {
  const e = own(ctx.state.entities, item);
  if (!e || isGone(ctx.state, item) || !isThing(ctx, item)) return "is gone";
  if (e.fields.lost === true) return "is lost";
  const has = possessorOf(ctx, item);
  if (has !== null && has !== who) return `is with ${labelOf(ctx, has)}`;
  if (accessFor(ctx, who, item).use === null) return "isn't yours to use";
  return reachOf(ctx, who, item).reach === "away" ? "isn't with you or close by" : null;
}

/** Whether `who` is at home: where they are is within their home, in the same building or site. */
function atHome(ctx: ReadContext, who: EntityId): boolean {
  const home = own(ctx.state.entities, who)?.fields.home;
  const here = placeOfEntity(ctx.state, who);
  return typeof home === "string" && own(ctx.world.places, home) !== undefined && here !== null && placeWithin(ctx.world, here, home) && together(ctx.world, here, home);
}

/** A person's saved sets as Belongings shows them, by name: each piece with its name and whether it is out of reach, and whether all of it to hand is worn now. */
export function gearSets(ctx: ReadContext, who: EntityId): GearSet[] {
  const sets = setsOf(own(ctx.state.entities, who)?.fields);
  return Object.entries(sets)
    .map(([id, set]): GearSet => {
      const pieces = set.pieces.map((p): GearSetPiece => ({ item: p.item, name: own(ctx.state.entities, p.item)?.name ?? p.item, ...(p.slot !== undefined ? { slot: p.slot.replace(/_/g, " ") } : {}), ...(pieceProblem(ctx, who, p.item) !== null ? { missing: true as const } : {}) }));
      const reached = set.pieces.filter((p) => pieceProblem(ctx, who, p.item) === null);
      const worn = reached.length > 0 && reached.every((p) => {
        const slot = wornSlot(ctx, who, p.item);
        return slot !== null && slot === (p.slot ?? slotOf(ctx, own(ctx.state.entities, p.item)?.fields ?? {}));
      });
      return { id, name: set.name, kind: set.kind, pieces, ...(worn ? { on: true as const } : {}) };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The event that writes a person's sets whole. */
function written(who: EntityId, sets: Readonly<Record<string, SavedSet>>): LedgerEvent {
  return { type: "set", entity: who, field: "sets", value: sets as unknown as JsonValue };
}

/** Saved: what they wear now of its kind, or the pieces given, under its name (one of the same name is replaced); at most the world's number of sets. */
function saveSet(ctx: ReadContext, op: Extract<SetOp, { do: "set_save" }>): LedgerEvent[] | Rejection {
  const who = own(ctx.state.entities, op.who);
  const name = op.name.trim();
  if (name === "" || name.length > SET_NAME_MAX) return reject("bad_name", `a name is 1–${SET_NAME_MAX} characters`);
  if (!who) return reject("missing_entity", `no one ${labelOf(ctx, op.who)}`);
  const pieces = op.pieces ?? wornPieces(ctx, op.who, op.kind);
  const word = SET_KIND_LABEL[op.kind].toLowerCase();
  if (pieces.length === 0) return reject("nothing_worn", `${who.name} wears nothing to keep as ${word === "outfit" ? "an outfit" : "a loadout"}`);
  for (const p of pieces) if (!isThing(ctx, p.item) || isGone(ctx.state, p.item)) return reject("missing_entity", `no thing ${labelOf(ctx, p.item)}`);
  const sets = setsOf(who.fields);
  const id = setIdOf(name);
  const max = thingsConfigOf(ctx.world).sets.max;
  if (!Object.hasOwn(sets, id) && Object.keys(sets).length >= max) return reject("too_many", max === 0 ? "This world keeps no saved outfits" : `${who.name} keeps at most ${max} saved outfits and loadouts: drop one first`);
  const set: SavedSet = { name, kind: op.kind, pieces: pieces.map((p) => ({ item: p.item, ...(p.slot !== undefined ? { slot: p.slot } : {}) })) };
  if (JSON.stringify(sets[id]) === JSON.stringify(set)) return reject("no_change", `${name} is saved as it is`);
  return [written(op.who, { ...sets, [id]: set })];
}

/** Dropped: the set no longer kept. */
function dropSet(ctx: ReadContext, op: Extract<SetOp, { do: "set_drop" }>): LedgerEvent[] | Rejection {
  const who = own(ctx.state.entities, op.who);
  const sets = setsOf(who?.fields);
  if (!who || !Object.hasOwn(sets, op.set)) return reject("no_set", `${labelOf(ctx, op.who)} keeps no such outfit`);
  const { [op.set]: _dropped, ...rest } = sets;
  return [written(op.who, rest)];
}

/**
 * Changed into (Gear 3): each piece to hand put on in its slot, what else of the set's kind they
 * wear taken off, and at home what came off put back where it is kept; the pieces out of reach
 * named in a note. Refused when none of it is to hand.
 */
function applySet(ctx: ReadContext, op: Extract<SetOp, { do: "set_apply" }>, opts: ItemOpOptions): LedgerEvent[] | Rejection {
  const who = own(ctx.state.entities, op.who);
  if (!who || !kindIs(ctx.registry, ctx.world, who.kind, "person")) return reject("not_a_person", `${labelOf(ctx, op.who)} can't wear anything`);
  if (ctx.levelOf(op.who, "gear") < 3) return reject("level", "outfits are kept from Gear level 3");
  const set = setsOf(who.fields)[op.set];
  if (!set) return reject("no_set", `${who.name} keeps no such outfit`);
  const w = new Working(ctx.registry, ctx.world, ctx.state);
  const before = wornPieces(w.ctx, op.who).map((p) => p.item);
  const missing: string[] = [];
  const wearing = new Set<EntityId>();
  for (const piece of set.pieces) {
    const name = labelOf(w.ctx, piece.item);
    const problem = pieceProblem(w.ctx, op.who, piece.item);
    if (problem !== null) {
      missing.push(`${name} (${problem})`);
      continue;
    }
    const mark = w.lightMark();
    // In its slot as saved, else its own: one worn elsewhere (drawn, say) goes back to it.
    const slot = piece.slot ?? slotOf(w.ctx, own(w.state.entities, piece.item)?.fields ?? {});
    const out = applyItemOp(w, { do: "wear", item: piece.item, who: op.who, ...(slot !== null ? { slot } : {}) }, opts);
    if ("code" in out && out.code !== "no_change") {
      w.restore(mark);
      missing.push(`${name} (${out.reason})`);
      continue;
    }
    wearing.add(piece.item);
  }
  if (wearing.size === 0) return reject("none_to_hand", `None of ${set.name} is to hand: ${missing.join("; ")}`);
  // What else of its kind they wear comes off (an outfit's other clothes), staying carried.
  for (const p of wornPieces(w.ctx, op.who, set.kind)) {
    if (wearing.has(p.item)) continue;
    const mark = w.lightMark();
    if ("code" in applyItemOp(w, { do: "wear", item: p.item, who: op.who, off: true }, opts)) w.restore(mark);
  }
  // At home, what came off goes back where it is kept (a wardrobe, a gun safe), as Put away takes it.
  if (atHome(w.ctx, op.who)) {
    const worn = new Set(wornPieces(w.ctx, op.who).map((p) => p.item));
    for (const id of before) {
      if (worn.has(id)) continue;
      const rest = restOf(w.ctx, id).rest;
      if (rest === null || rest === "owner" || ("in" in rest && rest.in === op.who)) continue;
      const place = "place" in rest ? rest.place : placeOfEntity(w.state, rest.in);
      const home = own(w.state.entities, op.who)?.fields.home;
      if (place === null || typeof home !== "string" || !placeWithin(w.world, place, home) || !together(w.world, place, home)) continue;
      const mark = w.lightMark();
      if ("code" in applyItemOp(w, { do: "move", item: id, to: rest, why: "" }, opts)) w.restore(mark);
    }
  }
  const events = [...w.events];
  if (missing.length > 0) events.push({ type: ENGINE_EVENTS.note, data: { text: `Not to hand for ${set.name}: ${missing.join("; ")}.`, entity: op.who, visibility: op.who === ctx.world.pov ? "public" : "secret" } });
  return events;
}

/** A saved set's change (`gear.set_op`, the item ops `set_save`, `set_apply`, `set_drop`): its events, or why not. */
export function setOpEvents(ctx: ReadContext, op: SetOp, opts: ItemOpOptions): LedgerEvent[] | Rejection {
  if (!own(ctx.state.entities, op.who) || isGone(ctx.state, op.who)) return reject("missing_entity", `no one ${labelOf(ctx, op.who)}`);
  switch (op.do) {
    case "set_save":
      return saveSet(ctx, op);
    case "set_drop":
      return dropSet(ctx, op);
    case "set_apply":
      return applySet(ctx, op, opts);
  }
}
