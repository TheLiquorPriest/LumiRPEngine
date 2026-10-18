// The touched record (DESIGN §4.3 `migrate`): which parts of entities' definitions applied events
// have written since the chat started (fields, relations by type and target, tier, agent flag,
// level overrides, classes and tags, entities play created, account balances), so an Upgrade's
// merge takes a revision's value by default only where nothing in play wrote it. "Never changed"
// comes from the ledger, not from comparing values: a field that changed and changed back still
// counts.
//
// It is written inside the apply of every event type that declares `touches` (the registry wraps
// them all), and by `resolve` markers for an entity's levels, so both folds keep it alike, no turn
// writes an event for it and an old chat rebuilds it on replay. A materialization's postings don't
// count: they post the authored opening balance itself. A taken value is forgotten again, since the
// chat then holds the revision's value. Names only, never values.

import type { EntityId, FieldId, RelationTypeId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { own } from "./pack-kit";
import type { EventTypeDef, Touch, TouchAspect } from "./registry";
import type { WorldState } from "./state";

/** The record lives in the engine pack's state, beside its other bookkeeping. */
const PACK = "engine";
const SLICE = "touched";

function record(state: Readonly<WorldState>): JsonObject | undefined {
  const v = state.packs[PACK]?.[SLICE];
  return isRecord(v) ? (v as JsonObject) : undefined;
}

function entryOf(state: Readonly<WorldState>, id: EntityId): JsonObject | undefined {
  const all = record(state);
  const v = all ? own(all, id) : undefined;
  return isRecord(v) ? (v as JsonObject) : undefined;
}

function objectAt(parent: JsonObject, key: string): JsonObject {
  const v = own(parent, key);
  if (isRecord(v)) return v as JsonObject;
  const fresh: JsonObject = {};
  parent[key] = fresh;
  return fresh;
}

function writable(state: WorldState, id: EntityId): JsonObject {
  const slice = state.packs[PACK] ?? {};
  state.packs[PACK] = slice;
  return objectAt(objectAt(slice, SLICE), id);
}

/** Records one touch; an entity that isn't in the state (an outside account) has no record. */
export function touch(state: WorldState, t: Touch): void {
  if (!own(state.entities, t.entity)) return;
  const e = writable(state, t.entity);
  if ("field" in t) objectAt(e, "fields")[t.field] = true;
  else if ("rel" in t) objectAt(objectAt(e, "relations"), t.rel)[t.to] = true;
  else e[t.aspect] = true;
}

/** Whether an applied event wrote this field of the entity. */
export function touchedField(state: Readonly<WorldState>, id: EntityId, field: FieldId): boolean {
  const fields = entryOf(state, id)?.fields;
  return isRecord(fields) && own(fields, field) === true;
}

/** Whether an applied event wrote the entity's relation of this type to `to`. */
export function touchedRelation(state: Readonly<WorldState>, id: EntityId, rel: RelationTypeId, to: string): boolean {
  const relations = entryOf(state, id)?.relations;
  const targets = isRecord(relations) ? own(relations, rel) : undefined;
  return isRecord(targets) && own(targets, to) === true;
}

/** Whether an applied event wrote any of the entity's relations of this type (for `in`: what holds it). */
export function touchedAnyRelation(state: Readonly<WorldState>, id: EntityId, rel: RelationTypeId): boolean {
  const relations = entryOf(state, id)?.relations;
  const targets = isRecord(relations) ? own(relations, rel) : undefined;
  return isRecord(targets) && Object.values(targets).includes(true);
}

export function touchedAspect(state: Readonly<WorldState>, id: EntityId, aspect: TouchAspect): boolean {
  return entryOf(state, id)?.[aspect] === true;
}

/** Whether anything in play wrote the entity's definition at all. */
export function touchedAtAll(state: Readonly<WorldState>, id: EntityId): boolean {
  const e = entryOf(state, id);
  return e !== undefined && Object.keys(e).length > 0;
}

/** Forgets one touch (an Upgrade took the revision's value), or the whole entity's record. */
export function forget(state: WorldState, id: EntityId, what: { field: FieldId } | { rel: RelationTypeId; to: string } | { aspect: TouchAspect } | "all"): void {
  const all = record(state);
  const e = entryOf(state, id);
  if (!all || !e) return;
  if (what === "all") delete all[id];
  else if ("field" in what) {
    const fields = e.fields;
    if (isRecord(fields)) {
      delete fields[what.field];
      if (Object.keys(fields).length === 0) delete e.fields;
    }
  } else if ("rel" in what) {
    const relations = e.relations;
    const targets = isRecord(relations) ? own(relations, what.rel) : undefined;
    if (isRecord(relations) && isRecord(targets)) {
      delete targets[what.to];
      if (Object.keys(targets).length === 0) delete relations[what.rel];
      if (Object.keys(relations).length === 0) delete e.relations;
    }
  } else delete e[what.aspect];
  if (Object.keys(e).length === 0) delete all[id];
}

/** The accounts a materialization posts to that no earlier event had posted to: its opening postings. */
function openedAccounts(state: Readonly<WorldState>, e: LedgerEvent): EntityId[] {
  if (e.type !== "materialize") return [];
  const out = new Set<EntityId>();
  for (const inner of e.events) {
    if (inner.type !== "post") {
      for (const id of openedAccounts(state, inner)) out.add(id);
      continue;
    }
    for (const line of inner.lines) if (!touchedAspect(state, line.account, "posted")) out.add(line.account);
  }
  return [...out];
}

/**
 * An event type whose apply also keeps the touched record: what it declares it writes, recorded
 * after it applied. A materialization's own touches come from its nested events, minus the balances
 * its postings open.
 */
export function touching(def: EventTypeDef): EventTypeDef {
  if (def.type === "materialize") {
    return {
      ...def,
      apply: (e, state, ctx) => {
        const opened = openedAccounts(state, e);
        def.apply(e, state, ctx);
        for (const id of opened) forget(state, id, { aspect: "posted" });
      },
    };
  }
  const touches = def.touches;
  if (!touches) return def;
  return {
    ...def,
    apply: (e, state, ctx) => {
      def.apply(e, state, ctx);
      for (const t of touches.call(def, e)) touch(state, t);
    },
  };
}

/** Drops the touched record from a state copy: what the world itself is, for comparing two folds of it. */
export function dropTouches(state: WorldState): void {
  const slice = state.packs[PACK];
  if (!slice) return;
  delete slice[SLICE];
  if (Object.keys(slice).length === 0) delete state.packs[PACK];
}
