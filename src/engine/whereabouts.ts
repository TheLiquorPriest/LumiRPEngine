// Where everyone is (plan §18.1 row 0.5): for each place, who stands there by their own `place`, and for each holder what is in it
// (`in`), kept with the state it was read from, so the POV's company and the people a place teaches look only where they are asked
// about and never walk every entity of the world for a move. It is read from the state once, then kept as the state changes: every
// move the core event types make re-reads the one entity it moves (`observing` calls `moved`), and anything else that could move
// someone (a pack's event, a marker) drops it (`forgetWhereabouts`), so the next question reads it afresh. A copy of the state, whose
// record of entities is another object, reads its own. What it answers is what `placeOfEntity` gives every entity, by the same rule:
// its own `place`, else the place of what holds it, as many holders up as `engine.maxHolderDepth` says.

import type { EntityId, PlaceId } from "../shared/ids";
import type { EntityState } from "./state";
import { walkLimits } from "./scope";

type Entities = Record<EntityId, EntityState>;

interface Whereabouts {
  /** The record it was read from: a state whose record is another object reads its own. */
  entities: Entities;
  /** Each entity's anchor: `p:<place>` for its own place, `h:<holder>` for what holds it. */
  anchor: Map<EntityId, string>;
  /** Who is at each anchor. */
  at: Map<string, Set<EntityId>>;
  /** Each entity's place in the record's order, so an answer lists them as a walk of the record would. */
  order: Map<EntityId, number>;
  next: number;
  /** While a trial runs on the state (`markWhereabouts`): each anchor it changed, with the one before, to put back. */
  undo: [EntityId, string | undefined][] | null;
}

const kept = new WeakMap<object, Whereabouts>();

function anchorOf(e: EntityState | undefined): string | undefined {
  if (!e) return undefined;
  const place = e.fields.place;
  if (typeof place === "string" && place !== "") return `p:${place}`;
  const holder = e.relations.find((r) => r.type === "in" || r.type === "on")?.to;
  return holder ? `h:${holder}` : undefined;
}

function put(w: Whereabouts, id: EntityId, anchor: string | undefined): void {
  const was = w.anchor.get(id);
  if (was === anchor) return;
  if (w.undo) w.undo.push([id, was]);
  if (was !== undefined) w.at.get(was)?.delete(id);
  if (anchor === undefined) {
    w.anchor.delete(id);
    return;
  }
  w.anchor.set(id, anchor);
  let set = w.at.get(anchor);
  if (!set) {
    set = new Set();
    w.at.set(anchor, set);
  }
  set.add(id);
}

function whereabouts(state: { entities: Entities }): Whereabouts {
  const hit = kept.get(state);
  if (hit && hit.entities === state.entities) return hit;
  const w: Whereabouts = { entities: state.entities, anchor: new Map(), at: new Map(), order: new Map(), next: 0, undo: null };
  for (const id of Object.keys(state.entities)) {
    w.order.set(id, w.next++);
    put(w, id, anchorOf(state.entities[id]));
  }
  kept.set(state, w);
  return w;
}

/** The entities whose place is `place`, in the record's order: `placeOfEntity` gives each of them `place`, and no other entity. */
export function entitiesAt(state: { entities: Entities }, place: PlaceId): EntityId[] {
  const w = whereabouts(state);
  const out: EntityId[] = [];
  const limit = walkLimits().holderDepth;
  let level = [...(w.at.get(`p:${place}`) ?? [])];
  for (let depth = 0; level.length > 0 && depth < limit; depth++) {
    out.push(...level);
    const next: EntityId[] = [];
    for (const id of level) for (const inside of w.at.get(`h:${id}`) ?? []) next.push(inside);
    level = next;
  }
  return out.sort((a, b) => (w.order.get(a) ?? 0) - (w.order.get(b) ?? 0));
}

/** An entity that may have moved, been made or gone: read again where the state keeps where everyone is. */
export function moved(state: { entities: Entities }, id: EntityId | null): void {
  const w = kept.get(state);
  if (!w || w.entities !== state.entities || id === null) return;
  const e = Object.hasOwn(state.entities, id) ? state.entities[id] : undefined;
  if (e && !w.order.has(id)) w.order.set(id, w.next++);
  put(w, id, anchorOf(e));
}

/** Lets go of where everyone is in a state something else may have moved anyone in: the next question reads it afresh. */
export function forgetWhereabouts(state: object): void {
  kept.delete(state);
}

/** States a trial began on while nothing was kept of where everyone is: whatever is read during it goes with the trial. */
const unkept = new WeakSet<object>();

/** Starts a trial on the state: every change to where everyone is is noted, to be put back (`backWhereabouts`) or kept (`keepWhereabouts`). */
export function markWhereabouts(state: { entities: Entities }): void {
  const w = kept.get(state);
  if (w && w.entities === state.entities) w.undo = [];
  else {
    kept.delete(state);
    unkept.add(state);
  }
}

/** Puts back what a trial changed of where everyone is. */
export function backWhereabouts(state: object): void {
  if (unkept.delete(state)) {
    kept.delete(state);
    return;
  }
  const w = kept.get(state);
  if (!w || !w.undo) return;
  const undo = w.undo;
  w.undo = null;
  for (let i = undo.length - 1; i >= 0; i--) {
    const [id, was] = undo[i] as [EntityId, string | undefined];
    put(w, id, was);
  }
}

/** Keeps what a trial changed of where everyone is. */
export function keepWhereabouts(state: object): void {
  unkept.delete(state);
  const w = kept.get(state);
  if (w) w.undo = null;
}
