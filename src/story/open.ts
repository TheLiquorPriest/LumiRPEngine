// What a turn left open of the story (plan §8.1, §14 "what is still open"): for one turn, the threads its own changes touched that
// are still open after it, each with its state and stakes as the record holds them there, and the `next` of the turn record it
// wrote, all read at that turn of the path. Data only: the Turn page words it, and the quests' half of it is the quests'.
// A turn that was joined to another is refused by the store's own reading, naming the turn it joined: nothing is read here, and the
// refusal goes back to the route that asked.

import type { Store } from "../store";
import { StoreInputError } from "../store";
import { keyedItemId } from "./fold";
import { namesOf } from "./kit";
import { storyAt } from "./path";
import { StoryRecord } from "./record";

/** A thread as a turn left it: what the Author recorded of it, nothing worked out. */
export interface OpenThread {
  id: string;
  /** The thread's words. */
  text: string | null;
  kind: string | null;
  state: string | null;
  stakes: string | null;
  who: string[];
  /** Whether the Author holds it hot. */
  hot: boolean;
}

export interface LeftOpen {
  turn: string;
  /** The threads this turn's changes touched that are open after it, in the order they were made. */
  threads: OpenThread[];
  /** The `next` of the turn's own record; null when it wrote none, or none says a next. */
  next: string | null;
}

const words = (field: unknown): string | null => (typeof field === "string" && field.trim() !== "" ? field : null);

/** What `turn` of `chat` left open of the story. A turn that is not one of the chat's is refused as input the store cannot read. */
export function leftOpen(store: Store, user: string, chat: string, turn: string): LeftOpen {
  const u = store.user(user);
  if (u.turn(turn)?.chat !== chat) throw new StoreInputError(`turn ${turn} is not one of chat ${chat}'s`);
  const record = StoryRecord.read(store, user, storyAt(u, chat, turn));
  const threads = record
    .of("thread")
    .filter((t) => t.closedBy === null && t.rows.some((r) => r.turn === turn))
    .map((t): OpenThread => ({ id: t.id, text: words(t.fields.text), kind: words(t.fields.kind), state: words(t.fields.state), stakes: words(t.fields.stakes), who: namesOf(t), hot: t.fields.hot === true }));
  return { turn, threads, next: words(record.items.get(keyedItemId("record", turn))?.fields.next) };
}
