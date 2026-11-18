// What waits for a character's own agent (plan §7.3, §7.4): the perceptions it has not taken in (`takenIn`, `memory.ts`), each with the
// turn it is of, and when it last dreamt (the row each dream keeps, `memories.ts`). Read from the record and nothing else, and counted
// only for turns RPE played: a turn a migration carried owes nothing of the kind (§15.2), as the perception counts have it. The cast's
// facts count by it and the Cast page shows it. Code decides nothing about what should be done with it.

import { type CastAt } from "./path";
import { untakenPerceptions } from "./memory";
import { perceivedTurn } from "./perceive";
import { type CastItem, type CastRecord, type Character, dreamItemId } from "./record";

/** A perception its own agent has not taken in, with the turn it is of and that turn's place on the reading's path (after every turn of it, for a turn not on it). */
export interface Untaken {
  item: CastItem;
  turn: string;
  index: number;
}

/** What waits for one character's own agent at a reading. */
export interface Waiting {
  character: Character;
  /** Its perceptions its own agent has not taken in, of turns RPE played, oldest first. */
  untaken: Untaken[];
  /** Its last dream: the turn it was had in and its story time (null in a chat that keeps no clock); null when it never dreamt. */
  dreamt: { turn: string; at: number | null } | null;
}

/** What waits for each of `characters` at the record's reading; `played` holds the turns of the reading's path RPE played. */
export function waitingOf(record: CastRecord, characters: readonly Character[], played: ReadonlySet<string>): Waiting[] {
  const { at } = record;
  return characters.map((character) => {
    const untaken = untakenPerceptions(record, character.id)
      .map((item): Untaken => {
        const turn = perceivedTurn(item);
        return { item, turn, index: at.order.get(turn) ?? at.turns.length };
      })
      .filter((u) => !at.order.has(u.turn) || played.has(u.turn))
      .sort((a, b) => a.index - b.index);
    const dream = record.items.get(dreamItemId(character.id));
    const last = dream === undefined || dream.dropped ? undefined : dream.rows.at(-1);
    return { character, untaken, dreamt: last === undefined ? null : { turn: last.turn, at: last.at } };
  });
}

/** The turns RPE played on the reading's path after the one at `index`, the turn read included. */
export function turnsSince(at: CastAt, played: ReadonlySet<string>, index: number): number {
  return at.turns.filter((t, i) => i > index && played.has(t)).length;
}
