// The story's beats as the cast reads them (plan §7.1, History: "dated entries linked to beats"): a history entry names the beats it
// comes from by id, and each id is checked against the story record at the call's own point and shown with the beat's words for when.
// The cast may not import the story, so the beats are read through the store's named read of the story's area (`beats`), over the same
// folded state the cast's own record is read from.

import type { Store } from "../store";
import type { CastAt } from "./path";

/** A beat of the story record: its id, its words (empty where it has none), and its words for when (null where it has none). */
export interface Beat {
  id: string;
  text: string;
  time: string | null;
}

/** The area the beats are read from. */
const STORY = "story";

/**
 * The story's beats not struck at a point, in the order they were recorded: the chat's head, or a turn, with what a job wrote so far
 * on top where `job` is given (as `CastRecord.read` reads the cast). Null where the store holds no story area, so no beat can be
 * checked and none is linked.
 */
export function beatsAt(store: Store, user: string, at: CastAt, job: string | null): Beat[] | null {
  if (store.env.areas?.owns(`${STORY}.write`) !== true) return null;
  const u = store.user(user);
  const folded = at.turn === null ? u.headFor(at.chat, job) : job === null ? u.stateAt(at.turn) : u.stateFor(at.turn, job);
  return store.readArea(folded.state, STORY, "beats") as unknown as Beat[];
}

/** What a list of beat ids names: each id as it stands in `beats` (compared without regard to case), the ones that are none of them separately. */
export function resolveBeats(beats: readonly Beat[], said: readonly string[]): { linked: string[]; unknown: string[] } {
  const byId = new Map(beats.map((b) => [b.id.toLowerCase(), b.id]));
  const linked: string[] = [];
  const unknown: string[] = [];
  for (const id of said) {
    const found = byId.get(id.trim().toLowerCase());
    if (found === undefined) unknown.push(id);
    else if (!linked.includes(found)) linked.push(found);
  }
  return { linked, unknown };
}
