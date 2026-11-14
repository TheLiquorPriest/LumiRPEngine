// Which turns a reading of the cast sees (plan §6.3), by the rule the story record reads by
// (`src/story/path.ts`, which this area may not import): at the chat's head, the turns on the chat's
// path as the store last compared it; inside a turn, the turns that turn was made after and the turn
// itself, so a turn sees its own rows before its reply is tied and no other reading does.

import type { UserStore } from "../store";

export interface CastAt {
  chat: string;
  /** The turn read at; null at the chat's head. */
  turn: string | null;
  /** The turns whose rows this reading sees, oldest first. */
  turns: readonly string[];
  /** Each of those turns' place in `turns`. */
  order: ReadonlyMap<string, number>;
  /** The number of a turn's reply on the chat's path, from 0; null while it is not on the path (a turn still open). */
  replyOf(turn: string): number | null;
}

/** The cast's path in `chat`, read at `turn` (null: the chat's head). */
export function castAt(user: UserStore, chat: string, turn: string | null): CastAt {
  const messages = user.path(chat);
  const replies = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.turn !== null) replies.set(m.turn, i);
  });
  const onPath = messages.flatMap((m) => (m.turn === null ? [] : [m.turn]));
  let turns = onPath;
  if (turn !== null) {
    const at = onPath.indexOf(turn);
    if (at >= 0) turns = onPath.slice(0, at + 1);
    else {
      // A turn not on the chat's path (open, or left behind): the turns it was made after, back to one that is.
      const chain: string[] = [];
      let id: string | null = turn;
      while (id !== null && !replies.has(id)) {
        chain.push(id);
        id = user.turn(id)?.parent ?? null;
      }
      turns = [...(id === null ? [] : onPath.slice(0, onPath.indexOf(id) + 1)), ...chain.reverse()];
    }
  }
  return { chat, turn, turns, order: new Map(turns.map((t, i) => [t, i])), replyOf: (t) => replies.get(t) ?? null };
}
