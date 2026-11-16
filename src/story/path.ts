// Which turns a reading of the story record sees, and where their messages stand (plan §6.3, §8.1).
// At the chat's head it is the turns on the chat's path as the store last compared it; inside a turn
// it is the turns that turn was made after, and the turn itself, so a turn sees its own writes before
// its reply is tied and no other reading does. A message's number is its place in the chat's path,
// counted from 0, the numbering the story so far and the chat tools use.

import type { PathEntry, UserStore } from "../store";

export interface StoryAt {
  chat: string;
  /** The turn read at; null at the chat's head. */
  turn: string | null;
  /** The turns whose writes this reading sees, oldest first. */
  turns: readonly string[];
  /** Each of those turns' place in `turns`. */
  order: ReadonlyMap<string, number>;
  /** The chat's messages as the store last compared them, in order. */
  messages: readonly PathEntry[];
  /** A message's number by its id; null for a message not on the chat's path. */
  number(message: string): number | null;
  /** The number of a turn's reply; null while it is not on the chat's path (a turn still open). */
  replyOf(turn: string): number | null;
  /** The number of the first message a turn answered: the one after the reply before it. Null when that is not known. */
  startOf(turn: string): number | null;
}

/**
 * The story's path in `chat`, read at `turn` (null: the chat's head). `given` is the messages of a line the caller reads along that
 * is not the chat's own (the path a generation was made on, a swipe's own line): the numbers and the replies are then those of that
 * line; left out, it is the chat's path as the store last compared it.
 */
export function storyAt(user: UserStore, chat: string, turn: string | null, given?: readonly PathEntry[]): StoryAt {
  const messages = given ?? user.path(chat);
  const numbers = new Map(messages.map((m, i) => [m.message, i]));
  // The chat's line of turns, each at the reply it stands at (`UserStore.line`): a turn a branch shares stays on it after a continue.
  const line = given === undefined ? user.line(chat) : messages.flatMap((m, i) => (m.turn !== null && !m.user ? [{ turn: m.turn, at: i }] : []));
  const replies = new Map(line.map((l) => [l.turn, l.at]));
  const onPath = line.map((l) => l.turn);
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
  const order = new Map(turns.map((t, i) => [t, i]));
  const replyOf = (t: string): number | null => replies.get(t) ?? null;
  return {
    chat,
    turn,
    turns,
    order,
    messages,
    number: (message) => numbers.get(message) ?? null,
    replyOf,
    startOf(t) {
      const reply = replyOf(t);
      if (reply !== null) {
        let before = reply - 1;
        while (before >= 0 && messages[before]?.user === true) before--;
        return before + 1;
      }
      const place = order.get(t);
      if (place === undefined) return null;
      if (place === 0) return 0;
      const prev = replyOf(turns[place - 1] ?? "");
      return prev === null ? null : prev + 1;
    },
  };
}
