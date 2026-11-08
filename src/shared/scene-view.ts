// The turn inspector's scene view (DEPTH-PLAN §7, §9.1): one depth reply's scene as its record
// holds it (the staging, the beats in order with who decided each and who perceived them, the points
// of view, each play's private take, and each passage with every draft and the GM's check of it),
// beside every model call its turn made (provenance, §9.0). The player's to read, whole: nothing is
// withheld (§1.4). Story times and places arrive as words the backend wrote, so the view computes
// nothing. Pure types.

import type { EntityId, MessageId } from "./ids";
import type { LoopbackModelCall } from "./loopback";
import type { BeatAct, ExposureChannel } from "./story";

/** Who decided a beat (§1.3), or where one that no turn decided came from. */
export type SceneDecider = "player" | "character" | "gm" | "author" | "draft" | "history" | "entry";

export const SCENE_DECIDER_LABEL: Readonly<Record<SceneDecider, string>> = Object.freeze({
  player: "The player",
  character: "Its character",
  gm: "The GM",
  author: "The author",
  draft: "A settled draft",
  history: "The history",
  entry: "An imported memory",
});

/** A reply with a scene, to pick: its number in the chat as the chat shows it (its #N, from 0), swipe, and story time in words. */
export interface SceneReplyRef {
  messageId: MessageId;
  swipeId: number;
  index: number;
  at: string | null;
}

/** Where someone was in the scene (`story.staging`): position and facing, what occupies them, what blocks their senses. */
export interface SceneStaging {
  who: EntityId;
  name: string;
  where: string;
  doing: string;
  occluded?: string;
  /** The beat it follows, by id; absent at the scene's start. */
  after?: string;
}

/** What reached someone of a beat: whole (the surface itself), or in part with their point of view; `pending` until their agent lives it. */
export interface SceneExposure {
  who: EntityId;
  name: string;
  channel: ExposureChannel;
  reach: "whole" | "partial";
  pov?: string;
  pending: boolean;
}

/** One beat in the order the scene decided it. */
export interface SceneBeat {
  id: string;
  at: string;
  place: string;
  act: BeatAct;
  actors: string[];
  decided: SceneDecider;
  what: string;
  surface: string;
  quotes?: string;
  exposure: SceneExposure[];
  /** The passage that rendered its moment, from 1; null when no passage did (nothing of it reached the player character). */
  passage: number | null;
  /** Decided by the author for what the narrator asked. */
  asked?: true;
  /** From a Continue of the reply. */
  continued?: true;
}

/** One draft of a passage and the GM's check of it: faithful, not, or null when no check could be read. */
export interface SceneDraft {
  text: string;
  faithful: boolean | null;
  notes?: string;
  reasoning?: string;
  checkReasoning?: string;
}

/** One passage of the reply: the beats of its moment, the text that streamed, every draft with its check, the narrator's asks, and where it departs when it streamed unfaithful. */
export interface ScenePassage {
  /** From 1, in the reply's order. */
  index: number;
  beats: string[];
  text: string;
  drafts: SceneDraft[];
  asked: { question: string; beats: string[] }[];
  departs?: string;
  continued?: true;
}

/** One play's private take (`minds.v2.take`): the working memory a character playing as its own agent kept of the moment, in the order the scene played it. */
export interface SceneTake {
  who: EntityId;
  name: string;
  at: string;
  /** The beat it played with this take, by its place among the scene's beats (from 1); null where it let the moment pass. */
  beat: number | null;
  /** How many beats it had just lived as it took the moment in. */
  lived: number;
  text: string;
}

/** GM → Depth → Turn: one reply's scene, the replies to pick from, and its turn's model calls. */
export interface DepthSceneView {
  /** The reply shown; null when the chat holds no depth reply. */
  reply: SceneReplyRef | null;
  /** The chain's replies with a scene, newest first. */
  replies: SceneReplyRef[];
  /** The player character the prose was rendered for (D-10). */
  pov: { id: EntityId; name: string } | null;
  staging: SceneStaging[];
  beats: SceneBeat[];
  told: ScenePassage[];
  /** Each play's take, in the order the scene played them. */
  takes: SceneTake[];
  /** Every model call the reply's turn made, each on its connection by name (by its id when Lumiverse no longer has it), while its generation's inspector record is kept; null when it isn't. */
  provenance: { calls: LoopbackModelCall[]; turnMs: number; firstContentMs: number | null } | null;
}
