// Real-time dialogue's state (DEPTH-PLAN §2.5): `story.talk`, an event of the story pack saying
// that from here the player talks with someone line by line (`on`), that the author judged the
// moment a conversation and waits on the player's tap (`offer`, while Settings → Depth → Real-time
// dialogue starts is "Only from the chip"), or that it ends here (`off`). The author writes it in a
// turn's record (its scene setup entering or ending it, its watch ending it); the player's tap on a
// chip (Talk, Leave) lands it as a basis-anchored layer entry at the chat's last message (§4.9).
//
// It changes no world state and is read by walking the chain with the fold's liveness
// (`engine/ledger/story.ts` `liveEventsOn`), so it is path-keyed as a beat is: a swipe of the turn
// that entered real time leaves it, a switch back brings it back, a branch carries it, and a tap
// made on one swipe of the last reply stays with that swipe. Validation is structural, and it is
// never grouped, like the narrative record's events. Pure.

import type { EntityId, MessageId } from "./ids";
import { isRecord, type JsonObject } from "./json";
import type { PackEvent } from "./ledger";
import type { StoryContainer } from "./story";

export const STORY_TALK = "story.talk";

/** `on`: real time runs from here; `offer`: the author offers it, and the player's tap starts it; `off`: it ends here. */
export const TALK_STATES = ["on", "offer", "off"] as const;
export type TalkState = (typeof TALK_STATES)[number];

/** Who decided it: the author, in a turn's record, or the player, by a chip's tap. */
export const TALK_DECIDERS = ["author", "player"] as const;
export type TalkDecider = (typeof TALK_DECIDERS)[number];

/** The longest reason a talk event keeps, in characters: the author's short account, which the thinking block and the chip show. Its whole thinking rides in the turn's reasoning. */
export const TALK_WHY_MAX = 600;

/** `story.talk`'s data. */
export interface Talk {
  /** The character the player talks with: one with its own agent, never the player character (D-10). */
  with: EntityId;
  state: TalkState;
  by: TalkDecider;
  /** The scene the conversation runs in (`Beat.scene`): each line's beats carry it, so the conversation reads as one scene. */
  scene?: string;
  /** The author's reason, in its words, at most `TALK_WHY_MAX` characters. */
  why?: string;
}

/** Real-time dialogue as it stands on a chain: running, or offered to the player. */
export interface TalkNow extends Talk {
  state: "on" | "offer";
  /** Where the `story.talk` that set it was read from. */
  from: StoryContainer;
}

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Why `data` isn't a well-formed `story.talk`, or null. Structural only, so it never fails on a rebased view. */
export function talkProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a talk is an object";
  if (!nonBlank(data.with)) return "a talk names whom the player talks with";
  if (typeof data.state !== "string" || !(TALK_STATES as readonly string[]).includes(data.state)) return `a talk's state is one of ${TALK_STATES.join(", ")}`;
  if (typeof data.by !== "string" || !(TALK_DECIDERS as readonly string[]).includes(data.by)) return `a talk is decided by ${TALK_DECIDERS.join(" or ")}`;
  if (data.scene !== undefined && !nonBlank(data.scene)) return "a talk's scene is an id";
  if (data.why !== undefined && (typeof data.why !== "string" || data.why.length > TALK_WHY_MAX)) return `a talk's reason is text of at most ${TALK_WHY_MAX} characters`;
  return null;
}

/** `data` as a talk when well formed, else null. */
export function talkOf(data: unknown): Talk | null {
  return talkProblem(data) === null ? (data as unknown as Talk) : null;
}

/** A `story.talk` event: the reason trimmed to its bound, nothing empty kept. Never grouped. */
export function talkEvent(t: Talk): PackEvent {
  const why = t.why?.trim() ?? "";
  const data: JsonObject = { with: t.with, state: t.state, by: t.by };
  if (t.scene !== undefined && t.scene.trim() !== "") data.scene = t.scene;
  if (why !== "") data.why = why.length > TALK_WHY_MAX ? `${why.slice(0, TALK_WHY_MAX - 1)}…` : why;
  return { type: STORY_TALK, data };
}

/**
 * Real-time dialogue on a chain, from its live `story.talk` events in fold order (`liveEventsOn`
 * with `STORY_TALK`): the last one, unless it ended there. An offer stands only while nothing has
 * played after it: on the chain's last reply (`lastReply`). A turn that ran past it without the
 * player's tap let it lapse.
 */
export function talkNow(live: readonly { event: { type: string; data?: unknown }; from: StoryContainer }[], lastReply: MessageId | null): TalkNow | null {
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    if (e === undefined || e.event.type !== STORY_TALK) continue;
    const t = talkOf(e.event.data);
    // A malformed talk never validated, so it never folded; one that did is read.
    if (t === null) continue;
    if (t.state === "off") return null;
    if (t.state === "offer" && e.from.messageId !== lastReply) return null;
    return { ...t, state: t.state, from: e.from };
  }
  return null;
}
