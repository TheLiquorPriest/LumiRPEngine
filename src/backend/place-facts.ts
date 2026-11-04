// The read's place facts (ITEMS-SPEC §5.2 `location` + `parent`, §6.2): a move to a place the world
// lacks, with the place it is in or part of, makes the place, as a `place_make` change; the Curator's
// own `place_make` facts settle the same way. Settled in reply order before anything else reads the
// reply's changes, each against the places the ones before it made, so a later change naming the new
// place ("Danny joins him in the booth") finds it, and none names it as a place the POV doesn't know.

import type { JsonObject } from "../shared/json";
import { placeCapsOf, type WorldDoc } from "../shared/world";
import { placeSaid } from "../engine/place-names";
import { placeFactEntity, placeOp, settlePlaceFact } from "../engine/places-in-play";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { Working } from "../engine/working";

/** A place fact the read can't keep, with why: a receipt, as a thing fact's is. */
export interface PlaceDecline {
  proposal: JsonObject;
  reason: string;
  code: string;
}

export interface PlacedFacts {
  /** The reply's changes, each place fact settled: a move (`location`) or a place made (`place_make`). */
  proposals: JsonObject[];
  /** The state with the places the read makes, which a later change naming one reads against (nothing else of the read applied). */
  working: Working;
  /** The `place_make` changes that make a venue (a new place in town): they ask first, whatever the mode, unless pinned (§5.4). */
  venues: Set<JsonObject>;
  declines: PlaceDecline[];
}

/** Whether a change is a place fact: a move that says what the place it names is in, or a place to make. */
function isPlaceFact(p: JsonObject): boolean {
  return p.type === "place_make" || (p.type === "location" && typeof p.parent === "string" && p.parent.trim() !== "");
}

/**
 * Settles each place fact (§6.2): a move whose place the POV can find (`placeSaid`) is that move,
 * without its parent; else, under a parent it can see, a place there by that name (found first, a
 * hidden one too) is the move's, and anything else makes the place, as `place_make`, which carries the
 * move with it. A reply makes at most the world's places per reply (`placeCapsOf(world).turn`); past it,
 * and where it can't be made (the per-chat cap, no parent), the fact is a Not tracked receipt. A
 * `place_make` that only finds its place and moves no one changes nothing, and is left out.
 */
export function settlePlaceFacts(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, proposals: readonly JsonObject[]): PlacedFacts {
  const w = new Working(reg, world, state);
  const out: PlacedFacts = { proposals: [], working: w, venues: new Set(), declines: [] };
  const perTurn = placeCapsOf(w.world).turn;
  let made = 0;
  for (const p of proposals) {
    if (!isPlaceFact(p)) {
      out.proposals.push(p);
      continue;
    }
    const { parent: _parent, ...move } = p;
    if (p.type === "location" && typeof p.place === "string" && placeSaid(reg, w.world, w.state, p.place) !== null) {
      out.proposals.push(move);
      continue;
    }
    const settled = settlePlaceFact(w.ctx, p);
    if (settled.kind === "refused") {
      out.declines.push({ proposal: p, reason: settled.rejection.reason, code: settled.rejection.code });
      continue;
    }
    const entity = placeFactEntity(p);
    if (settled.kind === "found") {
      if (entity !== null || p.type === "location") out.proposals.push({ ...move, type: "location", place: settled.place });
      continue;
    }
    if (made >= perTurn) {
      out.declines.push({ proposal: p, reason: perTurn === 0 ? "this world makes no places from a reply" : `this reply made ${perTurn} new ${perTurn === 1 ? "place" : "places"} already, all its world allows one`, code: "place_cap" });
      continue;
    }
    const op = settled.op;
    const placed = placeOp(w.ctx, op, { by: typeof p.by === "string" && p.by !== "" ? p.by : "story", salt: "read" });
    if ("code" in placed) {
      out.declines.push({ proposal: p, reason: placed.reason, code: placed.code });
      continue;
    }
    w.applyAll(placed.events);
    made++;
    const change: JsonObject = { ...move, type: "place_make", place: op.name, parent: op.parent, as: op.as };
    if (op.as === "venue") out.venues.add(change);
    out.proposals.push(change);
  }
  return out;
}
