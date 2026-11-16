// Who was on stage at a turn, and where: the scene the story record holds open there (plan §7.3,
// §8.1), as the Author recorded it. The cast's facts count by it, and the views an agent is given of
// the character it plays take its people and its place as what is present. Nothing is guessed: a turn
// whose reading holds no open scene had no stage recorded, and counts nobody. The same scene names the
// stretch of the chat an agent can ask for as `scene` (`chat:history[scene]`).

import type { HistoryRange } from "rp-harness/contract";
import type { Store } from "../store";
import { namesOf } from "../story/kit";
import { storyAt } from "../story/path";
import { storySliceOf } from "../story/fold";
import { StoryRecord } from "../story/record";

/** The open scene at a turn: who it has on stage, by the names the Author gave, and its place in the Author's words. */
export interface Stage {
  who: string[];
  place: string | null;
}

function stageOf(record: StoryRecord): Stage | null {
  const scene = record.current("scene");
  if (scene === null || scene.closedBy !== null) return null;
  const place = scene.fields.place;
  return { who: namesOf(scene), place: typeof place === "string" && place.trim() !== "" ? place : null };
}

/** The stage at one reading of the chat: at `turn`, or at its head when null. Null when no scene is open there. */
export function stageAt(store: Store, user: string, chat: string, turn: string | null): Stage | null {
  return stageOf(StoryRecord.read(store, user, storyAt(store.user(user), chat, turn)));
}

/**
 * The stretches of a chat RPE names for agents (`ChatInfo.ranges`): `scene`, from the first message of the scene the story record
 * holds open at the chat's head to the end of the chat's path as RPE last compared it. None while no scene is open, or for a scene
 * whose start the record cannot place.
 */
export function namedStretches(store: Store, user: string, chat: string): Record<string, HistoryRange> {
  if (store.user(user).chat(chat) === null) return {};
  const record = StoryRecord.read(store, user, storyAt(store.user(user), chat, null));
  const scene = record.current("scene");
  const from = scene === null || scene.closedBy !== null ? null : record.startOf(scene);
  return from === null ? {} : { scene: { from, to: record.at.messages.length } };
}

/**
 * The stage at each of `turns`; a turn with none recorded is left out. The readings of turns on one line of the chat are each read
 * from the state the store folded at that turn, laid over the line of the deepest one, so the line's messages are worked out once.
 */
export function stagesAt(store: Store, user: string, chat: string, turns: readonly string[]): Map<string, Stage> {
  const out = new Map<string, Stage>();
  const u = store.user(user);
  if (u.chat(chat) === null) return out;
  const left = new Set(turns);
  for (const deepest of [...turns].reverse()) {
    if (!left.has(deepest)) continue;
    const at = storyAt(u, chat, deepest);
    for (const turn of at.turns) {
      if (!left.delete(turn)) continue;
      const stage = stageOf(new StoryRecord(at, storySliceOf(u.stateAt(turn).state)));
      if (stage !== null) out.set(turn, stage);
    }
    // A turn asked for that its own reading does not hold (one the store has no line to) has no stage.
    left.delete(deepest);
  }
  return out;
}
