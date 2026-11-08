// A scene as the author sets it (DEPTH-PLAN §4.4, §5.2): `story.scene`, an event of the story pack in
// a depth turn's record, before the scene's staging and beats. It names the scene (`Beat.scene`,
// `Staging.scene`), where and when it plays, and the effort each character in it plays at, the
// author's call per character and per scene: its own agent, played by the author from its mind, or
// handled as part of the world, each with the author's reason, which GM → Minds shows. A scene may run
// over several turns: each turn that plays it records its own `story.scene`, under the same id, with
// the cast as it stands that turn, and the one that ends it says so.
//
// It changes no world state, validates structurally (never against the state, so a rebased view
// never drops it) and stands alone, never grouped, like the narrative record's other events. Pure.

import type { DepthEffort } from "./depth-views";
import { hashParts } from "./hash";
import type { EntityId, PlaceId } from "./ids";
import { isRecord, type JsonObject } from "./json";
import type { PackEvent } from "./ledger";
import { isBlobHash } from "./stores";
import type { BlobRef, StoryTime } from "./story";

export const STORY_SCENE = "story.scene";

export const SCENE_EFFORTS: readonly DepthEffort[] = ["agent", "author", "world"];

/** The longest reason a cast entry keeps, in characters: the author's short account, which Minds shows beside the effort. Its whole thinking rides in the turn's reasoning and the scene's note. */
export const CAST_WHY_MAX = 600;

/** One character in the scene and the effort it plays at, with the author's reason. */
export interface SceneCast {
  who: EntityId;
  effort: DepthEffort;
  why: string;
}

/** `story.scene`'s data. */
export interface SceneData {
  /** The scene's id (`sceneId`): what its beats and staging name in `scene`. */
  scene: string;
  place: PlaceId;
  /** The story minute this turn's part of it starts. */
  at: StoryTime;
  /** Everyone present who isn't the player character, with the effort each plays at this turn. */
  cast: SceneCast[];
  /** This turn opens the scene; absent: it carries on a scene an earlier turn opened. */
  opens?: true;
  /** The scene ends with this turn, the author's call: the characters who lived it remember it whole. */
  ends?: true;
  /** The author's account of the scene, a blob: what the player wants from this moment, what the scene is, why each plays as it does. */
  note?: BlobRef;
}

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Why `data` isn't a well-formed `story.scene`, or null. Structural only. */
export function sceneProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a scene is an object";
  if (!nonBlank(data.scene)) return "a scene has an id";
  if (!nonBlank(data.place)) return "a scene names its place";
  if (typeof data.at !== "number" || !Number.isFinite(data.at)) return "a scene starts at a story minute";
  if (!Array.isArray(data.cast)) return "a scene lists its cast";
  const seen = new Set<string>();
  for (const c of data.cast) {
    if (!isRecord(c) || !nonBlank(c.who)) return "each of a scene's cast names who";
    if (typeof c.effort !== "string" || !(SCENE_EFFORTS as readonly string[]).includes(c.effort)) return `each of a scene's cast plays at one of ${SCENE_EFFORTS.join(", ")}`;
    if (typeof c.why !== "string" || c.why.length > CAST_WHY_MAX) return `a cast entry's reason is text of at most ${CAST_WHY_MAX} characters`;
    if (seen.has(c.who)) return `${c.who} is in a scene's cast twice`;
    seen.add(c.who);
  }
  if (data.opens !== undefined && data.opens !== true) return "a scene's opening is a flag";
  if (data.ends !== undefined && data.ends !== true) return "a scene's end is a flag";
  if (data.note !== undefined && !isBlobHash(data.note)) return "a scene's note is a stored text";
  return null;
}

/** `data` as a scene when well formed, else null. */
export function sceneOf(data: unknown): SceneData | null {
  return sceneProblem(data) === null ? (data as unknown as SceneData) : null;
}

/** A `story.scene` event: each reason trimmed to its bound. Never grouped. */
export function sceneEvent(s: SceneData): PackEvent {
  const cast = s.cast.map((c): JsonObject => {
    const why = c.why.trim();
    return { who: c.who, effort: c.effort, why: why.length > CAST_WHY_MAX ? `${why.slice(0, CAST_WHY_MAX - 1)}…` : why };
  });
  const data: JsonObject = { scene: s.scene, place: s.place, at: s.at, cast };
  if (s.opens) data.opens = true;
  if (s.ends) data.ends = true;
  if (s.note !== undefined) data.note = s.note;
  return { type: STORY_SCENE, data };
}

/** A new scene's id, from what makes it unique to its turn (the turn's token): `s` and 31 hex digits. */
export function sceneId(...parts: string[]): string {
  return `s${hashParts("lre.scene", ...parts).slice(1)}`;
}

/** The blobs a `story.scene` names (the sweep keeps them). */
export function sceneBlobs(data: unknown): string[] {
  return isRecord(data) && isBlobHash(data.note) ? [data.note] : [];
}
