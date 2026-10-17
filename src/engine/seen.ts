// The POV's own observations (DESIGN §7), the `space.seen` slice: every place it has been, with its
// first and last visit, and where and when it last saw each person it was with. The slice is written
// inside the apply of events that can move someone (a `place` set, an `in` link or unlink, a spawn),
// so both folds keep it alike and an old chat rebuilds it on replay; no turn writes an event for it.
// A visit counts for the places around the one visited: being in the kitchen is being in the manor.
// Only people the POV could see then are recorded, and the times are the clock when they parted or
// met. A coarsened record (a Timelapse, a catch-up) moves everyone once, to where they end up, so it
// carries what that would get wrong as one `engine.observed` event at its end (`lostObservations`).

import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, PlaceId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import type { EventTypeDef, ReadContext } from "./registry";
import type { Registry } from "./registry-impl";
import { kindIs, placeOfEntity } from "./scope";
import type { WorldState } from "./state";
import { own, sliceRecord } from "./pack-kit";

/** The slice lives in the space pack's state, beside its routes: the map reads it too. */
const PACK = "space";
const SLICE = "seen";
/** How far up the place tree a visit is counted. */
const PARENT_DEPTH = 32;

export interface PlaceVisit {
  first: number;
  last: number;
}

export interface Sighting {
  place: PlaceId;
  at: number;
}

/** Whether the POV can see someone, as the visibility rules decide (`canSeeEntity`). */
export type SeesEntity = (reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: EntityId) => boolean;

function entries(state: Readonly<WorldState>, key: "places" | "people"): JsonObject {
  const seen = state.packs[PACK]?.[SLICE];
  const list = isRecord(seen) ? seen[key] : undefined;
  return isRecord(list) ? (list as JsonObject) : {};
}

/** When the POV first and last was at a place (or somewhere inside it), or null when it never was. */
export function placeVisit(state: Readonly<WorldState>, place: PlaceId): PlaceVisit | null {
  const v = own(entries(state, "places"), place);
  return isRecord(v) && typeof v.first === "number" && typeof v.last === "number" ? { first: v.first, last: v.last } : null;
}

/** Where and when the POV last saw a person, or null when it never was with them. */
export function lastSighting(state: Readonly<WorldState>, id: EntityId): Sighting | null {
  const v = own(entries(state, "people"), id);
  return isRecord(v) && typeof v.place === "string" && typeof v.at === "number" ? { place: v.place, at: v.at } : null;
}

function writable(state: WorldState, key: "places" | "people"): JsonObject {
  const seen = sliceRecord(state, PACK, SLICE);
  const v = seen[key];
  if (isRecord(v)) return v as JsonObject;
  const fresh: JsonObject = {};
  seen[key] = fresh;
  return fresh;
}

/** A visit at `at` to a place and every place around it. */
function visit(state: WorldState, world: WorldDoc, place: PlaceId, at: number): void {
  const places = writable(state, "places");
  let cur: PlaceId | undefined = place;
  for (let depth = 0; cur !== undefined && depth < PARENT_DEPTH && own(world.places, cur); depth++) {
    places[cur] = { first: placeVisit(state, cur)?.first ?? at, last: at };
    cur = own(world.places, cur)?.parent;
  }
}

/** The POV's place and the people there it can see. */
function company(state: Readonly<WorldState>, ctx: ReadContext, sees: SeesEntity): { here: PlaceId | null; people: EntityId[] } {
  const pov = ctx.world.pov;
  const here = placeOfEntity(state, pov);
  if (here === null) return { here, people: [] };
  const people: EntityId[] = [];
  for (const [id, e] of Object.entries(state.entities)) {
    if (id === pov || placeOfEntity(state, id) !== here || !kindIs(ctx.registry, ctx.world, e.kind, "person")) continue;
    if (sees(ctx.registry, ctx.world, state, pov, id)) people.push(id);
  }
  return { here, people };
}

function movesSomeone(e: LedgerEvent): boolean {
  if (e.type === "set") return e.field === "place";
  if (e.type === "link" || e.type === "unlink") return e.rel === "in";
  return e.type === "spawn";
}

/**
 * A core event type whose apply also keeps the POV's observations: who parted from the POV and who
 * joined it as the event applied, and the places it left and reached, at the clock it applied at.
 */
export function observing(def: EventTypeDef, sees: SeesEntity): EventTypeDef {
  if (def.type !== "set" && def.type !== "link" && def.type !== "unlink" && def.type !== "spawn") return def;
  return {
    ...def,
    apply: (e, state, ctx) => {
      if (!movesSomeone(e)) return def.apply(e, state, ctx);
      const before = company(state, ctx, sees);
      def.apply(e, state, ctx);
      const after = company(state, ctx, sees);
      const at = state.clock;
      if (before.here !== after.here) {
        if (before.here !== null) visit(state, ctx.world, before.here, at);
        if (after.here !== null) visit(state, ctx.world, after.here, at);
      }
      const parted = before.here === null ? [] : before.people.filter((id) => !after.people.includes(id));
      const met = after.here === null ? [] : after.people.filter((id) => before.here !== after.here || !before.people.includes(id));
      if (parted.length === 0 && met.length === 0) return;
      const people = writable(state, "people");
      for (const id of parted) people[id] = { place: before.here, at };
      for (const id of met) people[id] = { place: after.here, at };
    },
  };
}

/** A chat's first observation: the place the POV starts in, and the places around it. */
export function seedObservations(world: WorldDoc, state: WorldState): void {
  const here = placeOfEntity(state, world.pov);
  if (here !== null) visit(state, world, here, state.clock);
}

/** The state without the POV's observations: what the world itself is, for comparing two folds of it. */
export function unobserved(state: Readonly<WorldState>): WorldState {
  const copy = structuredClone(state) as WorldState;
  const slice = copy.packs[PACK];
  if (slice) {
    delete slice[SLICE];
    if (Object.keys(slice).length === 0) delete copy.packs[PACK];
  }
  return copy;
}

/**
 * What folding a coarse record gets wrong of the POV's observations, against folding the full one:
 * per place and person, the full fold's entry, or null where the coarse fold has one the full one
 * doesn't. Null when nothing differs.
 */
export function lostObservations(full: Readonly<WorldState>, coarse: Readonly<WorldState>): JsonObject | null {
  const out: JsonObject = {};
  for (const key of ["places", "people"] as const) {
    const want = entries(full, key);
    const got = entries(coarse, key);
    const diff: JsonObject = {};
    for (const [id, v] of Object.entries(want)) if (JSON.stringify(v) !== JSON.stringify(own(got, id))) diff[id] = v;
    for (const id of Object.keys(got)) if (!own(want, id)) diff[id] = null;
    if (Object.keys(diff).length > 0) out[key] = diff;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Applies `lostObservations`: each entry written, each null removed. */
export function restoreObservations(state: WorldState, data: JsonObject): void {
  for (const key of ["places", "people"] as const) {
    const diff = data[key];
    if (!isRecord(diff)) continue;
    const list = writable(state, key);
    for (const [id, v] of Object.entries(diff)) {
      if (v === null) delete list[id];
      else if (isRecord(v)) list[id] = structuredClone(v);
    }
  }
}
