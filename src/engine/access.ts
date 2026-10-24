// Who owns or may use a thing (DESIGN §6.11): the four shapes ownership is stored in brought
// together for every kind of thing (items, vehicles, property, accounts). An `owner` field (one
// party) or an `owners` list (parties with a role and share, `ownersIn`); a holder (a card's
// `holder`, `heldBy`); a `uses` relation from a person to the thing, with an optional `until`
// (assigned without one, lent with one); and a `home` place. A group owner counts its members. Pure.

import { heldBy, ownersIn, worthShares, type Owner } from "../shared/finance";
import type { EntityId, PlaceId } from "../shared/ids";
import { own } from "./pack-kit";
import { isMemberOf } from "./selector";
import type { WorldState } from "./state";

export interface UseGrant {
  who: EntityId;
  /** When the grant ends (a lend); absent, it stands (an assignment). */
  until?: number;
}

export interface Access {
  /** Its owners, each with their role and their share of its worth in percent. */
  owners: (Owner & { worth: number })[];
  /** Who may use it by a grant still in force. */
  users: UseGrant[];
  /** Where it belongs when not in use (a vehicle's home base), when it has one. */
  home: PlaceId | null;
}

/** Who owns and may use `id`. */
export function accessOf(state: Readonly<WorldState>, id: EntityId): Access {
  const e = own(state.entities, id);
  if (!e) return { owners: [], users: [], home: null };
  const owners = ownersIn(e.fields);
  const worth = worthShares(owners);
  const users: UseGrant[] = [];
  for (const [who, other] of Object.entries(state.entities)) {
    for (const r of other.relations) {
      if (r.type !== "uses" || r.to !== id) continue;
      if (typeof r.until === "number" && r.until < state.clock) continue;
      users.push(typeof r.until === "number" ? { who, until: r.until } : { who });
    }
  }
  return { owners: owners.map((o) => ({ ...o, worth: worth[o.party] ?? 0 })), users, home: typeof e.fields.home === "string" && e.fields.home !== "" ? e.fields.home : null };
}

/** Whether `who` owns `id`: on its owners, its holder, or a member of a group that owns it. */
export function owns(state: Readonly<WorldState>, who: EntityId, id: EntityId): boolean {
  const e = own(state.entities, id);
  if (!e) return false;
  if (heldBy(state.entities, id, who)) return true;
  return ownersIn(e.fields).some((o) => isMemberOf(state, who, o.party));
}

/** Whether `who` may use `id`: they own it, or a grant in force lets them. */
export function mayUse(state: Readonly<WorldState>, who: EntityId, id: EntityId): boolean {
  return owns(state, who, id) || accessOf(state, id).users.some((u) => u.who === who);
}
