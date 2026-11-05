// Build's Things as plain data (ITEMS-SPEC §10.1): which world-home list an entity is in (People,
// Organizations, Things, Money), and who opens on a thing's page; the By place tree and the By
// owner groups over the rows `lre.things` answers; and the draft changes the Things pages make: a
// new thing from Add's four fields (a vehicle by its class), a thing moved, made someone's, kept
// somewhere, given or lent, someone let use it or no longer, and a thing removed with what it held
// left where it was. Each is a draft patch (RFC 6902) of only what it changes, so an edit made
// elsewhere to anything else stands.

import { pointerOf } from "../../shared/json-patch";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonPatchOp } from "../../shared/protocol";
import type { OwnerGroup, PartyRef, ThingRow, ThingType, WhereStep } from "../../shared/thing-view";
import type { GrantBasis, Size, Spot, ThingIs } from "../../shared/things";
import { makeFieldsOf } from "../../shared/things";
import type { VehiclePick } from "../../shared/vehicles";
import { typeFields } from "../../shared/items-build";
import type { TableRow } from "../../shared/tables";
import type { WorldDoc } from "../../shared/world";
import type { EntityGroup } from "../app";
import type { IconName } from "../icons";
import { entityPatch } from "./character-model";
import { deriveId, newItem } from "./schema";
import { kindIs } from "./selector-editor";

// ---------------------------------------------------------------- the world home's lists

/** Each entity list as the world home names it. */
export const GROUP_INFO: Readonly<Record<EntityGroup, { label: string; hint: string; noun: string; icon: IconName }>> = {
  people: { label: "People", hint: "Characters: the player character and everyone else", noun: "person", icon: "user" },
  orgs: { label: "Organizations", hint: "Companies, households, groups and trusts", noun: "organization", icon: "users" },
  things: { label: "Things", hint: "What people have and places hold, by place and by owner", noun: "thing", icon: "box" },
  money: { label: "Money", hint: "Accounts, cards, flows, jobs, holdings, properties and invoices", noun: "money record", icon: "wallet" },
};

/** The kinds an organization is (ORG-SPEC): a business, a household, a trust, the party, or any other group. */
const ORG_KINDS: readonly string[] = ["business", "household", "trust", "party", "group"];

/** The money records' kinds (ITEMS-SPEC §10.1: they list only under Money). */
const MONEY_KINDS: readonly string[] = ["account", "card", "flow", "job", "holding", "property", "invoice"];

/** The list an entity of `kind` is in (`doc` with the packs' kinds): a person, a thing, an organization or a money record; null for any other kind, listed only under All entities. */
export function entityGroup(doc: WorldDoc, kind: string): EntityGroup | null {
  if (kindIs(doc, kind, "person")) return "people";
  if (kindIs(doc, kind, "item")) return "things";
  if (ORG_KINDS.some((k) => kindIs(doc, kind, k))) return "orgs";
  if (MONEY_KINDS.some((k) => kindIs(doc, kind, k))) return "money";
  return null;
}

/** The draft's entities in the world home's lists (`doc` with the packs' kinds): each list's ids, by id. */
export function entityGroups(doc: WorldDoc): Record<EntityGroup, string[]> {
  const out: Record<EntityGroup, string[]> = { people: [], orgs: [], things: [], money: [] };
  for (const id of Object.keys(doc.entities).sort()) {
    const group = entityGroup(doc, doc.entities[id]?.kind ?? "");
    if (group !== null) out[group].push(id);
  }
  return out;
}

/** Whether Build opens an item on a thing's page: a thing in the draft's entities. */
export function opensThingPage(doc: WorldDoc, collection: string, id: string | null): boolean {
  if (collection !== "entities" || id === null || id.startsWith("new:")) return false;
  const e = hasOwn(doc.entities, id) ? doc.entities[id] : undefined;
  return e !== undefined && kindIs(doc, e.kind, "item");
}

// ---------------------------------------------------------------- By place

/** A thing in the tree, or someone holding things (a person, or a holder that isn't a thing), with what is in it. */
export type TreeNode = { thing: ThingRow; children: TreeNode[] } | { holder: WhereStep; children: TreeNode[] };

/** One place's things in By place: the place's path (empty for nowhere), and its tree. */
export interface PlaceSection {
  path: WhereStep[];
  nodes: TreeNode[];
}

const nodeName = (n: TreeNode): string => ("thing" in n ? n.thing.name : n.holder.name);

function sortTree(nodes: TreeNode[]): void {
  // Things first, then who holds things, each by name.
  nodes.sort((a, b) => Number("holder" in a) - Number("holder" in b) || nodeName(a).localeCompare(nodeName(b)));
  for (const n of nodes) sortTree(n.children);
}

/**
 * By place (ITEMS-SPEC §10.1): each place that has things, by its path, with the things lying there
 * and what is in them, nested as they hold one another, and the people there with what they carry.
 * `within` keeps the places inside one place; `people: false` leaves out what people carry (a
 * place's page lists its furnishings and loose things).
 */
export function placeSections(rows: readonly ThingRow[], opts: { within?: string; people?: boolean } = {}): PlaceSection[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sections = new Map<string, PlaceSection>();
  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    const cut = row.where.findLastIndex((s) => s.is === "place");
    const path = row.where.slice(0, cut + 1);
    const chain = row.where.slice(cut + 1);
    if (opts.within !== undefined && !path.some((s) => s.id === opts.within)) continue;
    if (opts.people === false && chain.some((s) => s.is === "person")) continue;
    const key = path.at(-1)?.id ?? "";
    let section = sections.get(key);
    if (!section) {
      section = { path, nodes: [] };
      sections.set(key, section);
    }
    let siblings = section.nodes;
    for (const step of chain) {
      let node = nodes.get(step.id);
      if (!node) {
        const held = byId.get(step.id);
        node = held ? { thing: held, children: [] } : { holder: step, children: [] };
        nodes.set(step.id, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
    if (!nodes.has(row.id)) {
      const node: TreeNode = { thing: row, children: [] };
      nodes.set(row.id, node);
      siblings.push(node);
    }
  }
  const out = [...sections.values()];
  for (const s of out) sortTree(s.nodes);
  return out.sort((a, b) => Number(a.path.length === 0) - Number(b.path.length === 0) || a.path.map((s) => s.name).join(" › ").localeCompare(b.path.map((s) => s.name).join(" › ")));
}

/** How many things a tree holds, all the way down. */
export function treeCount(nodes: readonly TreeNode[]): number {
  return nodes.reduce((n, node) => n + ("thing" in node ? 1 : 0) + treeCount(node.children), 0);
}

// ---------------------------------------------------------------- By owner

/** One owner's things in a bucket: with them, at home (an organization's: at its places), elsewhere. */
export interface OwnerBucket {
  key: "on" | "home" | "away";
  label: string;
  ids: readonly string[];
}

/** An owner's buckets as By owner words them: a person's On them, At home and Elsewhere; an organization's With someone, At its places and Elsewhere. */
export function ownerBuckets(group: OwnerGroup): OwnerBucket[] {
  const person = group.owner?.is === "person";
  const household = group.owner?.is === "household";
  return [
    { key: "on", label: person ? "On them" : "With someone", ids: group.on },
    { key: "home", label: person || household ? "At home" : "At its places", ids: group.home },
    { key: "away", label: "Elsewhere", ids: group.away },
  ];
}

/** An owner's counts in one line: "On them 6 · At home 9 · Elsewhere 2", leaving out an empty bucket. */
export function ownerCounts(group: OwnerGroup): string {
  return ownerBuckets(group)
    .filter((b) => b.ids.length > 0)
    .map((b) => `${b.label} ${b.ids.length}`)
    .join(" · ");
}

/** What a party's page is: a person's Character page, an organization's entity page, a place's page. */
export function partyRoute(party: PartyRef): { collection: "entities" | "places"; id: string } | null {
  if (party.is === "other") return null;
  return { collection: party.is === "place" ? "places" : "entities", id: party.id };
}

// ---------------------------------------------------------------- draft changes

const fieldsOf = (entity: JsonObject): JsonObject => (isRecord(entity.fields) ? entity.fields : {});
const relationsOf = (entity: JsonObject): JsonValue[] => (Array.isArray(entity.relations) ? entity.relations : []);

/** The draft's own entity, as an editor holds it. */
export function draftEntity(doc: WorldDoc, id: string): JsonObject | null {
  const e = hasOwn(doc.entities, id) ? doc.entities[id] : undefined;
  return e ? (structuredClone(e) as unknown as JsonObject) : null;
}

/**
 * A thing put somewhere (ITEMS-SPEC §3.3, one location writer): lying at a place (in nothing, and
 * off whoever wore it), or in a holder (lying nowhere); its grid cell goes with where it was.
 */
export function withWhere(entity: JsonObject, to: Spot): JsonObject {
  const into = "in" in to ? to.in : null;
  const fields = { ...fieldsOf(entity) };
  const was = typeof fields.place === "string" ? fields.place : null;
  if ("place" in to) fields.place = to.place;
  else delete fields.place;
  if (("place" in to ? to.place : null) !== was) {
    delete fields.x;
    delete fields.y;
  }
  const kept = relationsOf(entity).filter((r) => !(isRecord(r) && (r.type === "in" || ((r.type === "worn_by" || r.type === "equipped") && r.to !== into))));
  return { ...entity, fields, relations: into !== null ? [...kept, { type: "in", to: into }] : kept };
}

/** Where a thing is in the draft: its place first, as the engine reads it, else what holds it. */
export function spotOfEntity(entity: JsonObject): Spot | null {
  const place = fieldsOf(entity).place;
  if (typeof place === "string" && place !== "") return { place };
  const holder = relationsOf(entity).find((r): r is JsonObject => isRecord(r) && r.type === "in" && typeof r.to === "string");
  return holder ? { in: String(holder.to) } : null;
}

/** A thing made someone's, or nobody's (`null`). */
export function withOwner(entity: JsonObject, owner: string | null): JsonObject {
  const fields = { ...fieldsOf(entity) };
  if (owner === null) delete fields.owner;
  else fields.owner = owner;
  return { ...entity, fields };
}

/** Where a thing is kept: on its owner (`"owner"`), a place or a holder by id, or where it is (`null`, its `home` cleared). */
export function withKept(entity: JsonObject, kept: string | null): JsonObject {
  const fields = { ...fieldsOf(entity) };
  if (kept === null) delete fields.home;
  else fields.home = kept;
  return { ...entity, fields };
}

/** A field of a thing set, or cleared (`undefined`). */
export function withField(entity: JsonObject, field: string, value: JsonValue | undefined): JsonObject {
  const fields = { ...fieldsOf(entity) };
  if (value === undefined) delete fields[field];
  else fields[field] = value;
  return { ...entity, fields };
}

/** Lets `who` use a thing (a `uses` from them, ITEMS-SPEC §3.5): its basis, and when it ends (a minute of the world's clock), if it does. */
export function grantOps(who: string, thing: string, basis: GrantBasis, until?: number): JsonPatchOp[] {
  return [{ op: "add", path: pointerOf(["entities", who, "relations", "-"]), value: { type: "uses", to: thing, fields: { basis }, ...(until !== undefined ? { until } : {}) } }];
}

/** Ends every use grant from `who` to a thing in the draft. */
export function revokeOps(doc: WorldDoc, who: string, thing: string): JsonPatchOp[] {
  const relations = hasOwn(doc.entities, who) ? (doc.entities[who]?.relations ?? []) : [];
  const out: JsonPatchOp[] = [];
  // Highest index first, so each removal leaves the next one's index as it was.
  for (let i = relations.length - 1; i >= 0; i--) if (relations[i]?.type === "uses" && relations[i]?.to === thing) out.push({ op: "remove", path: pointerOf(["entities", who, "relations", String(i)]) });
  return out;
}

/**
 * A thing given to someone, for keeps (the Character page's Give): theirs, and with them when they
 * can carry it (`carries`); a thing too big to carry stays where it is.
 */
export function giveOps(doc: WorldDoc, thing: string, to: string, carries: boolean): JsonPatchOp[] {
  const before = draftEntity(doc, thing);
  if (!before) return [];
  const owned = withOwner(before, to);
  return entityPatch(thing, before, carries ? withWhere(owned, { in: to }) : owned);
}

/** A thing lent to someone (the Character page's Lend): with them when they can carry it, still its owner's, and theirs to use on a loan. */
export function lendOps(doc: WorldDoc, thing: string, to: string, carries: boolean): JsonPatchOp[] {
  const before = draftEntity(doc, thing);
  if (!before) return [];
  return [...(carries ? entityPatch(thing, before, withWhere(before, { in: to })) : []), ...revokeOps(doc, to, thing), ...grantOps(to, thing, "loan")];
}

/** A thing moved (Move…): at a place or in a holder. */
export function moveOps(doc: WorldDoc, thing: string, to: Spot): JsonPatchOp[] {
  const before = draftEntity(doc, thing);
  return before ? entityPatch(thing, before, withWhere(before, to)) : [];
}

/**
 * A thing removed from the draft (Remove), with what it held left where it was (at its place, or in
 * what held it) and every use grant to it ended. Anything else naming it shows in Problems.
 */
export function removeOps(doc: WorldDoc, thing: string): JsonPatchOp[] {
  const gone = draftEntity(doc, thing);
  if (!gone) return [];
  const where = spotOfEntity(gone);
  const ops: JsonPatchOp[] = [];
  for (const [id, e] of Object.entries(doc.entities)) {
    if (id === thing) continue;
    if (e.relations.some((r) => r.type === "in" && r.to === thing)) {
      const before = e as unknown as JsonObject;
      const after = where ? withWhere(before, where) : { ...before, relations: relationsOf(before).filter((r) => !(isRecord(r) && r.type === "in" && r.to === thing)) };
      ops.push(...entityPatch(id, before, after));
    } else ops.push(...revokeOps(doc, id, thing));
  }
  return [...ops, { op: "remove", path: pointerOf(["entities", thing]) }];
}

/** Add a thing's four fields (ITEMS-SPEC §10.1), and where it is kept when that was changed. */
export interface NewThing {
  name: string;
  /** Its catalog type, with the row it names; null for something else. */
  type: { type: ThingType; row: TableRow } | null;
  /** Its size, for something else (a type gives its own). */
  size: Size | null;
  /** What it is said to be when no type says it (Add's kind chips): a category, or a holder; null or absent, a plain thing. */
  is?: ThingIs | null;
  /** A vehicle, by its class, with its make, model and year: the vehicles pack's kind. */
  vehicle?: VehiclePick | null;
  where: Spot;
  /** Its owner; null for nobody. */
  owner: string | null;
  /** Where it is kept, when not where it is: "owner", or a place's or a holder's id. */
  kept: string | null;
}

/** A vehicle's own fields from a pick: its class, and the make, model and year it was given. */
function vehicleFields(pick: VehiclePick): JsonObject {
  return { class: pick.id, ...(pick.make.trim() !== "" ? { make: pick.make.trim() } : {}), ...(pick.model.trim() !== "" ? { model: pick.model.trim() } : {}), ...(pick.year > 0 ? { year: pick.year } : {}) };
}

/**
 * The thing Add a thing makes: an id from its name, free in the draft; its kind and fields from its
 * type, or a vehicle's from its class, or else what it is said to be (a category, or a holder);
 * where it is; whose.
 */
export function newThing(doc: WorldDoc, input: NewThing): { id: string; value: JsonObject } {
  const name = input.name.trim();
  const id = deriveId(name, new Set(Object.keys(doc.entities)));
  const said = input.is ? makeFieldsOf(input.is) : {};
  const typed = input.vehicle ? { kind: "vehicle", fields: vehicleFields(input.vehicle) } : input.type ? typeFields(input.type.type.table, input.type.type.id, input.type.row) : { kind: said.holds !== undefined ? "container" : "item", fields: said.category !== undefined ? { category: said.category } : {} };
  const fields: JsonObject = { ...typed.fields };
  if (input.type === null && !input.vehicle && input.size !== null) fields.size = input.size;
  if (input.owner !== null) fields.owner = input.owner;
  if (input.kept !== null) fields.home = input.kept;
  const blank: JsonObject = { ...newItem("entities", id, doc, name), kind: typed.kind, fields };
  return { id, value: withWhere(blank, input.where) };
}
