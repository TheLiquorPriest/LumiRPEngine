// The story's facts (plan §5.4 "Facts", §8.1 "Covered"), given to the turn lane's facts registry the
// way the cast's are (`FactSource` in `src/turn/facts.ts`):
//   history.leaving.uncovered  messages the prompt holds now that the history window leaves out once
//                              the chat has grown by one exchange, and the record does not cover
//   history.unsummarized       messages the window has left out of the prompt that have beats
//                              recorded and lie in no scene with its summary
// Each counts, and gives the first and last of what it counts as the chat numbers them (`range`:
// both as its own value, and each as `from` and `to`), so a rule's text can name the stretch. The
// window is worked out exactly as the prompt's is, on the user's settings for the chat. Code decides
// nothing with these: the rule that names one says what matters.

import type { FactDef, FactValue, Scope } from "rp-harness/contract";
import type { Store } from "../store";
import { storyCoverage } from "./cover";
import { windowStart, type WindowSettings } from "./window/index";

/** Every fixed value of the story's facts, each a setting with this default. */
export const STORY_FACT_DEFAULTS = Object.freeze({
  /** How many messages the chat is taken to grow by before the next turn's prompt: this turn's reply and the player's next message. */
  ahead: 2,
});

export type StoryFactSettings = { -readonly [K in keyof typeof STORY_FACT_DEFAULTS]: number };

const LEAVING = "history.leaving.uncovered";
const UNSUMMARIZED = "history.unsummarized";

/** The story's facts as the Rules page lists them. */
export const STORY_FACT_DEFS: readonly FactDef[] = [
  { name: LEAVING, counts: "Messages still in the prompt that leave it once the chat has grown by one exchange, and that the story record does not cover. Range: the first and last of them.", fields: ["range"] },
  { name: UNSUMMARIZED, counts: "Messages already left out of the prompt that have beats recorded and lie in no scene with its summary. Range: the first and last of them.", fields: ["range"] },
];

/** The story's facts, in the shape the turn lane's facts registry takes an area's (`FactSource`). */
export interface StoryFacts {
  area: "story";
  defs: readonly FactDef[];
  read(scope: Scope, names: readonly string[]): Promise<Record<string, FactValue>>;
}

export interface StoryFactsDeps {
  store: Store;
  /** The history window's settings for the scope's chat, as the prompt's window is cut by. */
  window(scope: Scope): Promise<WindowSettings>;
  /** Settings over `STORY_FACT_DEFAULTS`. */
  settings?: Partial<StoryFactSettings>;
}

/** A count of messages by their places, with the first and last of them. */
function counted(places: readonly number[]): FactValue {
  const from = places[0];
  const to = places.at(-1);
  return from === undefined || to === undefined ? { count: 0 } : { count: places.length, fields: { range: { ".": [from, to], from, to } } };
}

/** `history.leaving.uncovered` and `history.unsummarized`, counted from the record on the scope's path and the window over the chat. */
export function storyFacts(deps: StoryFactsDeps): StoryFacts {
  const { ahead } = { ...STORY_FACT_DEFAULTS, ...(deps.settings ?? {}) };
  return {
    area: "story",
    defs: STORY_FACT_DEFS,
    async read(scope, names) {
      const user = deps.store.user(scope.user);
      // A chat RPE has not met yet has no messages on its path: every count is 0.
      const messages = user.chat(scope.chat) === null ? [] : user.path(scope.chat);
      const { covered, unsummarized } = messages.length === 0 ? { covered: new Set<string>(), unsummarized: new Set<string>() } : storyCoverage({ store: deps.store, user: scope.user, chat: scope.chat, turn: scope.turn ?? null });
      const settings = await deps.window(scope);
      const isCovered = (place: number): boolean => covered.has(messages[place]?.message ?? "");
      const now = windowStart(messages.length, settings, isCovered);
      const out: Record<string, FactValue> = {};
      if (names.includes(LEAVING)) {
        const next = Math.min(messages.length, windowStart(messages.length + ahead, settings, isCovered));
        const leaving: number[] = [];
        for (let i = now; i < next; i++) if (!isCovered(i)) leaving.push(i);
        out[LEAVING] = counted(leaving);
      }
      if (names.includes(UNSUMMARIZED)) {
        const left: number[] = [];
        for (let i = 0; i < now; i++) if (unsummarized.has(messages[i]?.message ?? "")) left.push(i);
        out[UNSUMMARIZED] = counted(left);
      }
      return out;
    },
  };
}
