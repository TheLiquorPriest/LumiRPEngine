// A place's base written by the owner (plan §7.1, §14): his words for what the place is and looks like, a change of the places' area
// with source `player`, placed by the store's write target for a change made outside any turn (after the chat's newest reply, on its own
// line, so a swipe of that reply keeps it), drawn against the entries bound to the place as they stand. He undoes it from the review card.

import { type Store } from "../store";
import { PLACE_OPS } from "./fold";

/** Who writes: the user and the chat; the owner is `player`. */
export interface PlaceWriter {
  user: string;
  chat: string;
  turn: string | null;
  by: string | null;
}

/** Records a base as a change of the area, inside the caller's queued write; the id of the change that holds it. */
export function writeBase(store: Store, writer: PlaceWriter, place: string, text: string, drawn: Record<string, string>): number {
  const u = store.user(writer.user);
  const target = u.writeTarget({ chat: writer.chat, turn: writer.turn, job: null });
  const { changes } = u.record(target, [{ lane: "engine", op: PLACE_OPS.base, value: { place, text, drawn }, by: writer.by, handle: null, source: writer.by === "player" ? "player" : null }]);
  const [one] = changes;
  if (one === undefined) throw new Error("the store recorded no change for a place's base");
  return one.id;
}
