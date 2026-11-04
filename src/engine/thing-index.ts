// The thing index (ITEMS-SPEC §5.1): one per state, so no reader scans every entity for what a
// holder holds, what lies at a place, what someone owns or what a name could mean. Inside a read pass
// (`readPass`) it is kept under the very state, entities and world it was read from, and dropped as
// soon as an event applies to that state; outside one it is read afresh, so nothing kept ever
// outlives a change. Never changed in place: readers get it whole. Pure.

import { ownersIn } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { TableRow } from "../shared/tables";
import { TYPE_TABLES, type TypeTable } from "../shared/items-build";
import { nameKey, nameSizeOf, thingsConfigOf, type NameKey } from "../shared/things";
import { own, rowOf } from "./pack-kit";
import { passMemo } from "./read-pass";
import type { ReadContext } from "./registry";
import { kindIs } from "./scope";
import type { WorldState } from "./state";

/** Where what is: holder → what is directly in it (`in`), each list in id order. */
export interface ContentsIndex {
  contents: ReadonlyMap<EntityId, readonly EntityId[]>;
}

/** One of a thing's names as the resolver compares it, and which name it is: its own, an alias, or its type row's. */
export interface ThingName extends NameKey {
  by: "name" | "alias" | "type";
}

export interface ThingIndex extends ContentsIndex {
  /** Place → the things lying loose there (their `place`, in nothing), in id order. */
  loose: ReadonlyMap<PlaceId, readonly EntityId[]>;
  /** Party → the things whose stated owners name it, in id order. */
  owned: ReadonlyMap<EntityId, readonly EntityId[]>;
  /** Head noun → the things one of whose names is it, in id order. */
  heads: ReadonlyMap<string, readonly EntityId[]>;
  /** Each thing's names: its own, then each alias, then its type row's (or, a row giving no other names, those the world's sizes by name give its kind). */
  names: ReadonlyMap<EntityId, readonly ThingName[]>;
  /** Every thing (an item or anything that extends one: containers, kits, vehicles), in id order. */
  things: readonly EntityId[];
}

/** A thing's type row: its `catalog` row in the gear items, containers or economy catalog, the first that has it. */
export function typeRowOf(ctx: Pick<ReadContext, "tables">, fields: Readonly<JsonObject>): { table: TypeTable; row: TableRow } | null {
  const id = fields.catalog;
  if (typeof id !== "string" || id === "") return null;
  for (const table of TYPE_TABLES) {
    const row = rowOf(ctx, table, id);
    if (row) return { table, row };
  }
  return null;
}

const push = <K>(map: Map<K, EntityId[]>, key: K, id: EntityId): void => {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
};

/** What holds what, from the state alone (accounts in wallets and riders in vehicles too). */
export function contentsIndex(state: Readonly<WorldState>): ContentsIndex {
  return passMemo([state, state.entities], "things.contents", () => {
    const contents = new Map<EntityId, EntityId[]>();
    for (const id of Object.keys(state.entities).sort()) for (const r of own(state.entities, id)?.relations ?? []) if (r.type === "in") push(contents, r.to, id);
    return { contents };
  });
}

/** The state's thing index (see the module's head). */
export function thingIndex(ctx: Pick<ReadContext, "registry" | "world" | "state" | "tables">): ThingIndex {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], "things.index", () => {
    const loose = new Map<PlaceId, EntityId[]>();
    const owned = new Map<EntityId, EntityId[]>();
    const heads = new Map<string, EntityId[]>();
    const names = new Map<EntityId, ThingName[]>();
    const things: EntityId[] = [];
    const isThing = new Map<string, boolean>();
    const byName = thingsConfigOf(ctx.world).sizes.byName;
    for (const id of Object.keys(ctx.state.entities).sort()) {
      const e = own(ctx.state.entities, id);
      if (!e) continue;
      let thing = isThing.get(e.kind);
      if (thing === undefined) {
        thing = kindIs(ctx.registry, ctx.world, e.kind, "item");
        isThing.set(e.kind, thing);
      }
      if (!thing) continue;
      things.push(id);
      if (typeof e.fields.place === "string" && e.fields.place !== "" && !e.relations.some((r) => r.type === "in")) push(loose, e.fields.place, id);
      for (const party of new Set(ownersIn(e.fields).map((o) => o.party))) push(owned, party, id);
      const aliases = Array.isArray(e.fields.aliases) ? e.fields.aliases.filter((a): a is string => typeof a === "string") : [];
      const type = typeRowOf(ctx, e.fields)?.row;
      const named: ThingName[] = [];
      const add = (text: string, by: ThingName["by"]): void => {
        const key = nameKey(text);
        if (key) named.push({ ...key, by });
      };
      add(e.name, "name");
      for (const alias of aliases) add(alias, "alias");
      // Its type row's name, and each other name the row goes by ("TV" for a television).
      const rowName = typeof type?.name === "string" ? type.name : null;
      if (rowName !== null) add(rowName, "type");
      const rowAliases = Array.isArray(type?.aliases) ? type.aliases.filter((a): a is string => typeof a === "string") : [];
      for (const alias of rowAliases) add(alias, "type");
      // A row that gives no other names (a world's own catalog), or none: the names the world's sizes by name give its kind ("fridge" for a refrigerator).
      if (rowAliases.length === 0) {
        const match = nameSizeOf(byName, [e.name, ...aliases, ...(rowName !== null ? [rowName] : [])]);
        for (const other of match ? [match.name, ...match.entry.also] : []) add(other, "type");
      }
      names.set(id, named);
      for (const head of new Set(named.flatMap((k) => k.heads))) push(heads, head, id);
    }
    return { ...contentsIndex(ctx.state), loose, owned, heads, names, things };
  });
}
