// The items family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): what someone wears, carries and owns, where
// a thing is and who holds it, and a thing's condition, each read with the gear pack's own readers
// (`packs/gear/core/model.ts`: what holds what, kits, loans; `wornBy`) and ownership as the engine
// keeps it (`engine/access.ts`).
//
// - `items_inventory`: what a person wears and carries, each container's contents nested, what they
//   own elsewhere with where it is and what holds it, and what they have lent and borrowed. Under
//   `pov` the player character's own is what Play's Gear panel shows (`buildGearView`'s rules: the
//   things its Gear level shows, each detail from the level that shows it), each a thing it may know
//   of; someone else's only while they are with it, at its very place (the people tools' rule), and
//   only what it sees on them (`presentGearLines`): what they wear and hold, never what is in a bag
//   or a pocket; of anyone away, the note that it doesn't know. Under `everyone` and `gm`,
//   everything, each thing named as the view names it (marked, or with its visibility).
// - `items_holder`: what holds a thing (`holderOf`, outward), where it is (`placeOfEntity`), its
//   owners with their shares and who may use it (`accessOf`). Under `pov` a holder, owner or user it
//   may not name is left out (`held`: something holds it), and where it is reads "Somewhere" for a
//   place the player character can't see, or while something it may not name, or someone away from
//   it, holds the thing.
// - `items_condition`: a thing's condition and state as the world keeps them: its condition (with
//   its band's word), its status, every field the gear and vehicle packs keep a thing's state in
//   (fuel, mileage, engine hours, uses left, …), and a kit's pieces. Under `pov` each field the
//   player character may see (`canSeeField`), at its level in the field's domain; under `everyone`
//   a restricted field's label is marked, under `gm` it carries the field's visibility.

import { accessOf, owns } from "../../../../engine/access";
import { numOf, own, strOf } from "../../../../engine/pack-kit";
import { bandOf, fieldDef, kindFields, kindIs, placeOfEntity } from "../../../../engine/scope";
import { visibilityOf } from "../../../../engine/visibility";
import { wornBy } from "../../../../packs/gear/core/index";
import { contentsOf, grants, holderOf, isInside, kitStatus } from "../../../../packs/gear/core/model";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { EntityId } from "../../../../shared/ids";
import { hasOwn, type JsonValue } from "../../../../shared/json";
import type { FieldDef } from "../../../../shared/world";
import type { ToolReadView, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { resolvePerson, resolveThing } from "../resolve";
import { needText, objectSchema, text } from "../schema";
import { beyondPov, type PlaceShown, placeShown } from "./people";
import { clockWords } from "./time";

const INVENTORY = "items_inventory";
const HOLDER = "items_holder";
const CONDITION = "items_condition";

/**
 * A field of a thing as the world keeps it, as a view reads it: its label (marked under `everyone`
 * when the field is restricted), its value (a place or someone it names, as the view names them),
 * the word of the band the value falls in, and under `gm` a restricted field's visibility.
 */
interface FieldRead {
  field: string;
  label: string;
  value: JsonValue | PlaceShown;
  band?: string;
  visibility?: string;
}

/** A kit's pieces (`kitStatus`): whether it is whole, how many of its pieces are in it, and which are missing. */
interface KitRead {
  complete: boolean;
  present: number;
  total: number;
  missing?: string[];
}

/** A thing as an inventory lists it: how many, the slot a worn one is in, its condition, a kit's pieces, whether it is lost, and what it holds. */
interface Listed extends ViewRef {
  qty?: number;
  slot?: string;
  condition?: FieldRead;
  kit?: KitRead;
  lost?: true;
  contents?: Listed[];
}

/** A thing someone owns that isn't on them: where it is, and what holds it (`held`: something the view may not name). */
interface Stored extends Listed {
  at: PlaceShown | null;
  in?: ViewRef[];
  held?: true;
}

/** A thing lent out (`grants`): who has it (null for someone the view may not name), until when, and whether it is overdue. */
interface Lent {
  thing: ViewRef;
  to: ViewRef | null;
  until?: string;
  overdue: boolean;
}

/** A thing borrowed: whose it is (null for someone the view may not name, or no one's), until when, and whether it is overdue. */
interface Borrowed {
  thing: ViewRef;
  from: ViewRef | null;
  until?: string;
  overdue: boolean;
}

interface InventoryAnswer {
  person: ViewRef;
  worn: Listed[];
  carried: Listed[];
  /** Absent under `pov` for someone else: what they own elsewhere and their loans aren't the player character's to see. */
  elsewhere?: Stored[];
  lent?: Lent[];
  borrowed?: Borrowed[];
}

/** An owner as the view names them, with their role and their share of its worth in percent. */
interface Share extends ViewRef {
  role: string;
  share: number;
}

/** Someone a grant lets use the thing, until when when it ends. */
interface User extends ViewRef {
  until?: string;
}

interface HolderAnswer {
  thing: ViewRef;
  /** What holds it, its holder first and outward. */
  in: ViewRef[];
  /** Something the view may not name holds it, or holds what does. */
  held?: true;
  /** How its holder has it on, when worn or equipped, and in which slot. */
  worn?: "worn" | "equipped";
  slot?: string;
  place: PlaceShown | null;
  owners: Share[];
  /** Owned, but only by someone the view may not name. */
  owned?: true;
  users: User[];
}

interface ConditionAnswer {
  thing: ViewRef;
  fields: FieldRead[];
  kit?: KitRead;
}

/** The fields a condition read tells wherever a kind keeps them: how worn a thing is, and whether it works. */
const CONDITION_FIELDS: Readonly<Record<string, true>> = { condition: true, status: true };
/** The domains whose fields keep a thing's state: the gear pack's and the vehicle pack's. */
const CONDITION_DOMAINS: Readonly<Record<string, true>> = { gear: true, vehicles: true };

/** Whether an entity is something an inventory lists: not a person, and not money (an account: the cash in a wallet). */
function isThing(view: ToolReadView, id: EntityId): boolean {
  const e = own(view.state.entities, id);
  return e !== undefined && e.kind !== "account" && !view.isPerson(id);
}

/** Whether someone is with the player character: at its very place, as Play's Scene has them (the people tools' rule). */
function withPov(view: ToolReadView, id: EntityId): boolean {
  const at = placeOfEntity(view.state, id);
  return at !== null && at === placeOfEntity(view.state, view.pov);
}

/** What holds a thing, its holder first and outward (`holderOf`). */
function holdersOf(view: ToolReadView, id: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (let at = holderOf(view.state, id); at !== null && at !== id && !out.includes(at); at = holderOf(view.state, at)) out.push(at);
  return out;
}

/** What holds a thing as far out as the view may name each, and whether something it may not name holds it. */
function heldIn(view: ToolReadView, id: EntityId): { in: ViewRef[]; held: boolean } {
  const refs: ViewRef[] = [];
  for (const holder of holdersOf(view, id)) {
    const ref = view.entity(holder);
    if (!ref) return { in: refs, held: true };
    refs.push(ref);
  }
  return { in: refs, held: false };
}

/**
 * Where a thing is (`placeOfEntity`) as the view may say: under `pov` only somewhere for a place the
 * player character can't see, and while something it may not name, or someone away from it, holds
 * the thing: where someone away is now, the player character doesn't know.
 */
function whereIs(view: ToolReadView, id: EntityId): PlaceShown | null {
  const at = placeOfEntity(view.state, id);
  if (at === null) return null;
  const unknown = view.knowledge === "pov" && holdersOf(view, id).some((h) => h !== view.pov && (!view.seesEntity(h) || (view.isPerson(h) && !withPov(view, h))));
  return unknown ? { name: view.hiddenPlace } : placeShown(view, at);
}

/** How a thing is on `who` when they wear it or have it equipped, and the slot it is in. */
function wornOn(view: ToolReadView, id: EntityId, who: EntityId): { as: "worn" | "equipped"; slot?: string } | null {
  const e = own(view.state.entities, id);
  const r = e?.relations.find((x) => (x.type === "worn_by" || x.type === "equipped") && x.to === who);
  if (!e || !r) return null;
  const slot = strOf(r.fields?.slot) || strOf(e.fields.slot);
  return { as: r.type === "equipped" ? "equipped" : "worn", slot: slot === "" ? undefined : slot.replace(/_/g, " ") };
}

/** What a reference field names, as the view names it: a place, or an entity (null for one it may not name); an id that names neither, as written. */
function refValue(view: ToolReadView, id: string): PlaceShown | string | null {
  if (own(view.world.places, id)) return placeShown(view, id);
  return own(view.state.entities, id) ? view.entity(id) : id;
}

/**
 * A field of a thing as the world keeps it (`FieldRead`), or null when it keeps no value there or
 * the view may not read it: under `pov` one the player character may see (`canSeeField`), at its
 * level in the field's domain, naming nothing it may not.
 */
function fieldRead(view: ToolReadView, id: EntityId, field: string, def: FieldDef): FieldRead | null {
  const e = own(view.state.entities, id);
  const value = e ? own(e.fields, field) : undefined;
  if (value === undefined || value === null || def.derived !== undefined) return null;
  if (view.knowledge === "pov" && (!view.seesField(id, field) || (def.domain !== undefined && view.ctx.levelOf(view.pov, def.domain) < (def.level ?? 1)))) return null;
  const shown = def.type === "ref" && typeof value === "string" ? refValue(view, value) : value;
  if (shown === null) return null;
  const visibility = view.knowledge === "gm" ? visibilityOf(def.visibility) : "public";
  return { field, label: view.mark(def.label ?? field, view.fieldSecrecy(id, field)), value: shown, band: typeof value === "number" ? bandOf(def.bands, value)?.label : undefined, visibility: visibility === "public" ? undefined : visibility };
}

/** How an inventory lists things: the ones it names, and which details it tells of each. */
interface Lister {
  view: ToolReadView;
  /** A thing as the list names it; null for one it leaves out. */
  ref(id: EntityId): ViewRef | null;
  qty: boolean;
  condition: boolean;
  kit: boolean;
  /** A kit's missing pieces, besides how many are in it. */
  missing: boolean;
  contents: boolean;
}

/** A thing as `l` lists it, with what it holds when `l` tells that; null for one it leaves out or has listed already. */
function listed(l: Lister, id: EntityId, seen: Set<EntityId>): Listed | null {
  const { view } = l;
  const e = own(view.state.entities, id);
  const ref = seen.has(id) ? null : l.ref(id);
  if (!e || !ref) return null;
  seen.add(id);
  const qty = numOf(e.fields.qty, 1);
  const def = l.condition ? fieldDef(view.registry, view.world, e.kind, "condition") : undefined;
  const kit = l.kit ? kitStatus(view.ctx, id) : null;
  const contents = l.contents ? contentsOf(view.state, id).flatMap((c) => listed(l, c, seen) ?? []) : [];
  return {
    ...ref,
    qty: l.qty && qty !== 1 ? qty : undefined,
    condition: def ? (fieldRead(view, id, "condition", def) ?? undefined) : undefined,
    kit: kit ? { complete: kit.complete, present: kit.present, total: kit.total, missing: l.missing ? kit.missing : undefined } : undefined,
    lost: e.fields.lost === true ? true : undefined,
    contents: contents.length > 0 ? contents : undefined,
  };
}

/**
 * Someone else's inventory as the player character sees it on them where it is with them
 * (`presentGearLines`): what they wear or have equipped and what they hold, never what is in a bag
 * or a pocket, each named as a line names it (a count, and a kit's pieces at their Gear level).
 */
function seenOn(view: ToolReadView, person: ViewRef): InventoryAnswer {
  if (view.ctx.levelOf(view.pov, "gear") === 0) return { person, worn: [], carried: [] };
  const l: Lister = { view, ref: (id) => (isThing(view, id) ? view.entity(id) : null), qty: true, condition: false, kit: Math.max(1, view.ctx.levelOf(person.id, "gear")) >= 3, missing: false, contents: false };
  const seen = new Set<EntityId>();
  const worn = wornBy(view.ctx, person.id);
  const held = contentsOf(view.state, person.id).filter((id) => own(view.state.entities, id)?.fields.slot !== "pocket" && !worn.includes(id));
  return { person, worn: worn.flatMap((id) => listed(l, id, seen) ?? []), carried: held.flatMap((id) => listed(l, id, seen) ?? []) };
}

/**
 * A person's whole inventory: what they wear and carry, what they own elsewhere (an item they own,
 * by any of the ways the engine keeps ownership: `owns`), and their loans. Under `pov`, the player
 * character's own, only what Play's Gear panel shows, each detail from the Gear level that shows it
 * (`buildGearView`).
 */
function inventory(view: ToolReadView, person: ViewRef): InventoryAnswer {
  const who = person.id;
  const level = view.ctx.levelOf(view.pov, "gear");
  const pov = view.knowledge === "pov";
  const ref = (id: EntityId): ViewRef | null => (isThing(view, id) && (!pov || level >= 2 || own(view.state.entities, id)?.fields.notable === true) ? view.entity(id) : null);
  const detail = !pov || level >= 3;
  const l: Lister = { view, ref, qty: !pov || level >= 2, condition: detail, kit: detail, missing: detail, contents: true };
  const seen = new Set<EntityId>();
  // What is worn, and the slot it is worn in, from the Gear level that tells them; below it, worn things are carried.
  const wornIds = detail ? wornBy(view.ctx, who) : [];
  const worn = wornIds.flatMap((id) => {
    const node = listed(l, id, seen);
    return node ? [{ ...node, slot: wornOn(view, id, who)?.slot }] : [];
  });
  const carried = contentsOf(view.state, who)
    .filter((id) => !wornIds.includes(id))
    .flatMap((id) => listed(l, id, seen) ?? []);
  const owned = Object.keys(view.state.entities)
    .sort()
    .filter((id) => kindIs(view.registry, view.world, own(view.state.entities, id)?.kind ?? "", "item") && owns(view.state, who, id));
  const elsewhere: Stored[] = [];
  for (const id of owned) {
    // A thing in another of their things the list names is listed in what holds it.
    const holder = holderOf(view.state, id);
    if (holder !== null && owned.includes(holder) && ref(holder) !== null) continue;
    const node = listed(l, id, seen);
    if (!node) continue;
    if (isInside(view.state, id, who)) {
      carried.push(node);
      continue;
    }
    const held = heldIn(view, id);
    elsewhere.push({ ...node, at: whereIs(view, id), in: held.in.length > 0 ? held.in : undefined, held: held.held || undefined });
  }
  const loans = grants(view.state);
  const lent = loans
    .filter((g) => g.owner === who)
    .flatMap((g): Lent[] => {
      const thing = ref(g.thing);
      return thing ? [{ thing, to: view.entity(g.borrower), until: g.until === null ? undefined : clockWords(view, g.until), overdue: g.overdue }] : [];
    });
  const borrowed = loans
    .filter((g) => g.borrower === who)
    .flatMap((g): Borrowed[] => {
      const thing = ref(g.thing);
      return thing ? [{ thing, from: g.owner === null ? null : view.entity(g.owner), until: g.until === null ? undefined : clockWords(view, g.until), overdue: g.overdue }] : [];
    });
  return { person, worn, carried, elsewhere, lent, borrowed };
}

/** Where a thing is and who holds it, owns it and may use it, as the view may name them. */
function holderRead(view: ToolReadView, thing: ViewRef): HolderAnswer {
  const held = heldIn(view, thing.id);
  const holder = holderOf(view.state, thing.id);
  const worn = holder !== null && held.in.length > 0 ? wornOn(view, thing.id, holder) : null;
  const access = accessOf(view.state, thing.id);
  const owners = access.owners.flatMap((o): Share[] => {
    const ref = view.entity(o.party);
    return ref ? [{ ...ref, role: o.role, share: Math.round(o.worth * 100) / 100 }] : [];
  });
  const users = access.users.flatMap((u): User[] => {
    const ref = view.entity(u.who);
    return ref ? [{ ...ref, until: u.until === undefined ? undefined : clockWords(view, u.until) }] : [];
  });
  return {
    thing,
    in: held.in,
    held: held.held || undefined,
    worn: worn?.as,
    slot: worn?.slot,
    place: whereIs(view, thing.id),
    owners,
    owned: owners.length === 0 && access.owners.length > 0 ? true : undefined,
    users,
  };
}

/** A thing's condition and state: each field of its kind a condition read tells (`CONDITION_FIELDS`, `CONDITION_DOMAINS`) that it keeps a value in and the view may read, in its kind's order, and a kit's pieces. */
function conditionRead(view: ToolReadView, thing: ViewRef): ConditionAnswer {
  const e = own(view.state.entities, thing.id);
  const fields = e ? Object.entries(kindFields(view.registry, view.world, e.kind)).flatMap(([field, def]) => (hasOwn(CONDITION_FIELDS, field) || (def.domain !== undefined && hasOwn(CONDITION_DOMAINS, def.domain)) ? (fieldRead(view, thing.id, field, def) ?? []) : [])) : [];
  // A kit's pieces show from Gear 3, as Play's Gear panel shows them.
  const kit = view.knowledge !== "pov" || view.ctx.levelOf(view.pov, "gear") >= 3 ? kitStatus(view.ctx, thing.id) : null;
  return { thing, fields, kit: kit ? { complete: kit.complete, present: kit.present, total: kit.total, missing: kit.missing } : undefined };
}

/** The items family, in the order of its texts (`shared/agent-tools-read.ts`). */
export const ITEMS_TOOLS: readonly ToolDefinition[] = [
  {
    name: INVENTORY,
    family: "items",
    tier: "read",
    parameters: () => objectSchema({ person: text() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, INVENTORY, args, "person");
      if (typeof said !== "string") return said;
      return view.read(() => {
        const r = resolvePerson(view, said);
        if ("refused" in r) return r.refused;
        const person = view.entity(r.id);
        if (!person) return view.refuse(TOOL_NOTE.noPerson, { name: said });
        if (view.knowledge !== "pov" || r.id === view.pov) return view.answer(inventory(view, person));
        // What someone has on them, the player character sees only while they are with it.
        return withPov(view, r.id) ? view.answer(seenOn(view, person)) : beyondPov(view);
      });
    },
  },
  {
    name: HOLDER,
    family: "items",
    tier: "read",
    parameters: () => objectSchema({ thing: text() }, ["thing"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, HOLDER, args, "thing");
      if (typeof said !== "string") return said;
      return view.read(() => {
        const r = resolveThing(view, said);
        if ("refused" in r) return r.refused;
        const thing = view.entity(r.id);
        return thing ? view.answer(holderRead(view, thing)) : view.refuse(TOOL_NOTE.noThing, { name: said });
      });
    },
  },
  {
    name: CONDITION,
    family: "items",
    tier: "read",
    parameters: () => objectSchema({ thing: text() }, ["thing"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, CONDITION, args, "thing");
      if (typeof said !== "string") return said;
      return view.read(() => {
        const r = resolveThing(view, said);
        if ("refused" in r) return r.refused;
        const thing = view.entity(r.id);
        return thing ? view.answer(conditionRead(view, thing)) : view.refuse(TOOL_NOTE.noThing, { name: said });
      });
    },
  },
];
