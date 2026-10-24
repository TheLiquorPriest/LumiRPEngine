// The GM character sheet's choices as the edits they send (the Character model, DESIGN §7): which
// page a GM entity opens, and one `lre.edit` op for each control. Pure, so tests read them.

import type { CharacterBed, PlaceRef } from "../../shared/character";
import type { EditOp } from "../../shared/protocol";
import type { GmEntity, GmView } from "../../shared/state-view";
import { bedValue } from "../character/bed-picker";
import { partyOf } from "../requests";

/** A person opens their character sheet; anything else, the entity sheet. */
export function gmPageFor(entity: Pick<GmEntity, "person">): "character" | "entity" {
  return entity.person ? "character" : "entity";
}

/** "Move them…": a move through the one move path to the place picked; none when they're already there. */
export function moveOp(entity: Pick<GmEntity, "id" | "place">, place: PlaceRef | null): EditOp | null {
  return place && place.id !== entity.place ? { op: "move", entity: entity.id, to: place.id } : null;
}

/** Home: their `home` set to the place picked, or cleared. */
export function homeOp(entity: Pick<GmEntity, "id">, place: PlaceRef | null): EditOp {
  return { op: "set", entity: entity.id, field: "home", value: place?.id ?? null };
}

/** Sleeps: their `bed` set to the place or thing picked, or cleared to sleep at home. */
export function bedOp(entity: Pick<GmEntity, "id">, bed: CharacterBed): EditOp {
  return { op: "set", entity: entity.id, field: "bed", value: bedValue(bed) };
}

/** "Travels with <player character>" switched on or off: the party link or unlink, or none when it's already so. */
export function partySwitchOp(entity: GmEntity, gm: Pick<GmView, "entities">, on: boolean): EditOp | null {
  const party = partyOf(entity, gm);
  return party && party.travels !== on ? party.op : null;
}
