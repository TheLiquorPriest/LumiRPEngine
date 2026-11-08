// The narrative record (DEPTH-PLAN §4.2): the story itself, beat by beat, written by whoever decided
// each beat (the player's input as the author and the GM read it, a character agent, the GM, the
// author) or, for history written before depth, distilled by the bootstrap's historian (§8).
//
// Beats are `story.beat` events (pack `story`), in a turn's record or in a basis-anchored layer entry
// (`shared/layer.ts`); long texts are blobs and the events hold their hashes. They change no world
// state: what is on the active chain is read by walking it (`engine/ledger/story.ts`), with the same
// liveness the fold uses, so a swipe that replaces a turn replaces its beats with the new swipe's and
// a layer entry's beats fold wherever its basis is on the chain.

import { hashParts } from "./hash";
import type { EntityId, MessageId, PlaceId } from "./ids";
import { isRecord, type JsonObject } from "./json";
import { passageBlobs, STORY_PASSAGE } from "./passage";
import { sceneBlobs, STORY_SCENE } from "./scene";
import { isBlobHash } from "./stores";

/** The story minute: game minutes since the world's epoch (`WorldState.clock`). */
export type StoryTime = number;

/** A content-addressed blob's hash (`shared/stores.ts` `isBlobHash`). */
export type BlobRef = string;

/** Something a beat concerns: a person, a place, a thing, or a fact the GM filed (its id). */
export type StoryRef = { entity: EntityId } | { place: PlaceId } | { thing: string } | { fact: string };

export const STORY_BEAT = "story.beat";
export const STORY_STAGING = "story.staging";
export const STORY_STRIKE = "story.strike";

export const BEAT_ACTS = ["said", "did", "happened"] as const;
export type BeatAct = (typeof BEAT_ACTS)[number];

/** The ways a beat reaches someone, the most direct first: the senses, then being told, a message, a rumor, a record. */
export const EXPOSURE_CHANNELS = ["sight", "hearing", "touch", "told", "message", "rumor", "record"] as const;
export type ExposureChannel = (typeof EXPOSURE_CHANNELS)[number];

/** How fully a beat reaches someone. */
export const EXPOSURE_REACHES = ["whole", "partial"] as const;
export type ExposureReach = (typeof EXPOSURE_REACHES)[number];

export const BEAT_DECIDERS = ["player", "character", "gm", "author"] as const;
export type BeatDecider = (typeof BEAT_DECIDERS)[number];

/** Who was placed to perceive a beat, and what reached them (the author's call, as DM, from the staging). */
export interface Exposure {
  /** The player character included. */
  who: EntityId;
  /** How it reached them; where it reached them several ways, the most direct of them (`EXPOSURE_CHANNELS` order). */
  channel: ExposureChannel;
  /** The other ways it reached them besides `channel`, each once, in `EXPOSURE_CHANNELS` order (seen, and heard too); absent where it reached them only by `channel`. */
  also?: ExposureChannel[];
  reach: ExposureReach;
  /** Partial reach: what reached them, from the truth-blind point-of-view render. Whole reach is the beat's surface itself. */
  pov?: BlobRef;
  /** Reached them, not yet lived: their agent catches up later. Lived once a live `minds.v2.write` by them cites the beat in `lived`. */
  pending?: true;
}

/** Where a beat came from: the turn that decided it, a draft, the bootstrap's distillation, or an imported memory entry. */
export type BeatSource =
  | { turn: string; decided: BeatDecider }
  | { draft: string }
  | { bootstrap: { message: MessageId; swipe: string; span?: [number, number] } }
  | { entry: string };

/**
 * `story.beat`: one thing someone said or did, or that happened. Never a motive: a character's
 * private take stays in its own mind.
 */
export interface Beat {
  /** Unique within the chat's chain (`beatId`): minds cite it in `lived`, amendments in `supersedes`. A Re-narrate copies a turn's beats with their ids. */
  id: string;
  /** The story minute it happened (backdated for a settled draft; approximate where `approx`). */
  at: StoryTime;
  /** True when `at` was read from prose ("the next morning") rather than the ledger's clock. */
  approx?: true;
  /** Its place in its scene, set by the author; acts at the same moment share one. */
  order: number;
  /** The scene it belongs to (the staging it is read against); absent: the record or entry it rides in. */
  scene?: string;
  place: PlaceId;
  actors: EntityId[];
  act: BeatAct;
  /** The people, places, things and facts it concerns. */
  about: StoryRef[];
  /** Plain words, truth-aware: who did what to whom, and any outcome the GM resolved. The point-of-view render never reads it. */
  what: BlobRef;
  /** What its actors did and said, plainly, as they did it: never as anyone perceived it, and nothing they couldn't know of it (no outcome). Each actor lives it as its own act (`reachOf`); without one, they live the surface. */
  deed?: BlobRef;
  /** What was there to sense, as anyone there could sense it, from no one's side: sights, sounds, words said aloud; no motive, nothing hidden. How far it reached each person is their exposure's. */
  surface: BlobRef;
  /** Exact words spoken or written. */
  quotes?: BlobRef;
  addressed?: EntityId[];
  exposure: Exposure[];
  by: BeatSource;
  /** Beats this one amends (a `fix` of a directive, a spot check's correction, a retcon): they stop being read where this one is live. */
  supersedes?: string[];
  /** The writer's own doubt (the historian's, mostly), which spot checks sample first. */
  uncertain?: BlobRef;
}

/** `story.staging`: per scene, per person present; set by the author, updated by each beat that moves someone. */
export interface Staging {
  who: EntityId;
  /** The scene it stages (as `Beat.scene`). */
  scene?: string;
  /** The beat it follows, by id: absent at the scene's start. */
  after?: string;
  /** Position and facing, in plain words. */
  where: BlobRef;
  /** Their activity, and what occupies their eyes and hands. */
  doing: BlobRef;
  /** What blocks their view or hearing. */
  occluded?: BlobRef;
}

/** `story.strike`: beats that stop being read where it is live, with nothing in their place (an edit that took a confession out). */
export interface Strike {
  beats: string[];
  why?: BlobRef;
}

/** Where a live beat or staging was read from on the active chain. */
export type StoryContainer =
  /** A turn record's own events (planned or read), by the record's seq. */
  | { rec: number; messageId: MessageId; swipeId: number }
  /** A post entry on a record. */
  | { post: number; messageId: MessageId; swipeId: number }
  /** A basis-anchored layer entry, by its id, folding after `messageId`. */
  | { layer: string; messageId: MessageId };

export interface PlacedBeat {
  beat: Beat;
  from: StoryContainer;
  /** Its position in fold order on this chain (0-based). */
  index: number;
}

export interface PlacedStaging {
  staging: Staging;
  from: StoryContainer;
  /** Its position in fold order, shared with beats: a staging applies to the beats after it. */
  index: number;
}

/** The narrative record on one chain, in fold order (`engine/ledger/story.ts` `storyOn`). */
export interface StoryRead {
  /** Live beats not superseded or struck, in fold order. */
  beats: PlacedBeat[];
  staging: PlacedStaging[];
  /** Beat ids a live beat superseded or a live strike struck, with what did it. */
  replaced: { id: string; by: string | { strike: StoryContainer } }[];
  /** Beat ids met more than once on the chain (a writer's mistake): the first is kept. */
  duplicates: string[];
}

// ---------------------------------------------------------------- reading the events

/** A beat's id from what makes it unique to its writer (a turn token and its index, a source message and span): `b` and 31 hex digits. */
export function beatId(...parts: string[]): string {
  return `b${hashParts("lre.beat", ...parts).slice(1)}`;
}

const isId = (v: unknown): v is string => typeof v === "string" && v !== "";
const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isId);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function refOk(v: unknown): v is StoryRef {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && ["entity", "place", "thing", "fact"].includes(keys[0] as string) && isId(v[keys[0] as string]);
}

function exposureProblem(v: unknown): string | null {
  if (!isRecord(v)) return "an exposure must be an object";
  if (!isId(v.who)) return "an exposure needs who";
  if (!(EXPOSURE_CHANNELS as readonly unknown[]).includes(v.channel)) return `exposure channel must be one of ${EXPOSURE_CHANNELS.join(", ")}`;
  if (v.also !== undefined && !(Array.isArray(v.also) && v.also.length > 0 && v.also.every((c) => c !== v.channel && (EXPOSURE_CHANNELS as readonly unknown[]).includes(c)) && new Set(v.also).size === v.also.length)) return "an exposure's also must be other channels than its own, each once";
  if (!(EXPOSURE_REACHES as readonly unknown[]).includes(v.reach)) return "exposure reach must be whole or partial";
  if (v.pov !== undefined && !isBlobHash(v.pov)) return "an exposure's pov must be a blob";
  if (v.pending !== undefined && v.pending !== true) return "an exposure's pending is true or absent";
  return null;
}

function sourceOk(v: unknown): v is BeatSource {
  if (!isRecord(v)) return false;
  if ("turn" in v) return isId(v.turn) && (BEAT_DECIDERS as readonly unknown[]).includes(v.decided);
  if ("draft" in v) return isId(v.draft);
  if ("entry" in v) return isId(v.entry);
  if (!("bootstrap" in v) || !isRecord(v.bootstrap)) return false;
  const b = v.bootstrap;
  const span = b.span;
  return isId(b.message) && isId(b.swipe) && (span === undefined || (Array.isArray(span) && span.length === 2 && span.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)));
}

/** Why `data` isn't a well-formed beat, or null. Structural only, so a beat never fails on a rebased view. */
export function beatProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a beat must be an object";
  const d = data;
  if (!isId(d.id)) return "a beat needs an id";
  if (!isTime(d.at)) return "a beat needs its story minute (at)";
  if (d.approx !== undefined && d.approx !== true) return "a beat's approx is true or absent";
  if (!isTime(d.order)) return "a beat needs its order in the scene";
  if (d.scene !== undefined && !isId(d.scene)) return "a beat's scene must be an id";
  if (!isId(d.place)) return "a beat needs a place";
  if (!isIdList(d.actors)) return "a beat's actors must be ids";
  if (!(BEAT_ACTS as readonly unknown[]).includes(d.act)) return `a beat's act must be one of ${BEAT_ACTS.join(", ")}`;
  if (!Array.isArray(d.about) || !d.about.every(refOk)) return "a beat's about must be refs ({entity}, {place}, {thing} or {fact})";
  if (!isBlobHash(d.what) || !isBlobHash(d.surface)) return "a beat's what and surface must be blobs";
  if (d.deed !== undefined && !isBlobHash(d.deed)) return "a beat's deed must be a blob";
  if (d.quotes !== undefined && !isBlobHash(d.quotes)) return "a beat's quotes must be a blob";
  if (d.uncertain !== undefined && !isBlobHash(d.uncertain)) return "a beat's uncertain must be a blob";
  if (d.addressed !== undefined && !isIdList(d.addressed)) return "a beat's addressed must be ids";
  if (!Array.isArray(d.exposure)) return "a beat needs its exposure";
  const exposed = new Set<unknown>();
  for (const x of d.exposure) {
    const problem = exposureProblem(x);
    if (problem) return problem;
    if (isRecord(x)) exposed.add(x.who);
  }
  if (exposed.size !== d.exposure.length) return "a beat names each person in its exposure once";
  if (!sourceOk(d.by)) return "a beat needs its source (by)";
  if (d.supersedes !== undefined && !isIdList(d.supersedes)) return "a beat's supersedes must be beat ids";
  return null;
}

/** `data` as a beat when well formed, else null. */
export function beatOf(data: unknown): Beat | null {
  return beatProblem(data) === null ? (data as unknown as Beat) : null;
}

/** Why `data` isn't a well-formed staging, or null. */
export function stagingProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a staging must be an object";
  if (!isId(data.who)) return "a staging needs who";
  if (data.scene !== undefined && !isId(data.scene)) return "a staging's scene must be an id";
  if (data.after !== undefined && !isId(data.after)) return "a staging's after must be a beat id";
  if (!isBlobHash(data.where) || !isBlobHash(data.doing)) return "a staging's where and doing must be blobs";
  if (data.occluded !== undefined && !isBlobHash(data.occluded)) return "a staging's occluded must be a blob";
  return null;
}

export function stagingOf(data: unknown): Staging | null {
  return stagingProblem(data) === null ? (data as unknown as Staging) : null;
}

/** Why `data` isn't a well-formed strike, or null. */
export function strikeProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a strike must be an object";
  if (!isIdList(data.beats) || data.beats.length === 0) return "a strike names the beats it strikes";
  if (data.why !== undefined && !isBlobHash(data.why)) return "a strike's why must be a blob";
  return null;
}

export function strikeOf(data: unknown): Strike | null {
  return strikeProblem(data) === null ? (data as unknown as Strike) : null;
}

/** The events (pack `story`): never grouped, so a rebased view never drops one with a unit around it. */
export function beatEvent(beat: Beat): { type: typeof STORY_BEAT; data: JsonObject } {
  return { type: STORY_BEAT, data: beat as unknown as JsonObject };
}

export function stagingEvent(staging: Staging): { type: typeof STORY_STAGING; data: JsonObject } {
  return { type: STORY_STAGING, data: staging as unknown as JsonObject };
}

export function strikeEvent(strike: Strike): { type: typeof STORY_STRIKE; data: JsonObject } {
  return { type: STORY_STRIKE, data: strike as unknown as JsonObject };
}

/** Everyone a beat names as taking part or perceiving: actors, addressed, exposed. */
export function beatPeople(beat: Beat): EntityId[] {
  return [...new Set([...beat.actors, ...(beat.addressed ?? []), ...beat.exposure.map((x) => x.who)])];
}

/** Every way an exposure reached its person, the most direct first: its `channel`, then the others (`also`). */
export function exposureChannels(x: Pick<Exposure, "channel" | "also">): ExposureChannel[] {
  return [x.channel, ...(x.also ?? [])];
}

/**
 * `x` added to a beat's exposure, merged into its person's entry where they have one already (a beat
 * names each person once, `beatProblem`): every way it reached them, the most direct as `channel` and
 * the rest as `also` (`EXPOSURE_CHANNELS` order); whole where either reached them whole, with a point
 * of view kept only for a reach still partial; pending where either was.
 */
export function addExposure(exposure: Exposure[], x: Exposure): void {
  const i = exposure.findIndex((y) => y.who === x.who);
  const had = exposure[i];
  if (!had) {
    exposure.push(x);
    return;
  }
  const ways = new Set([...exposureChannels(had), ...exposureChannels(x)]);
  const [channel = had.channel, ...also] = EXPOSURE_CHANNELS.filter((c) => ways.has(c));
  const reach = had.reach === "whole" || x.reach === "whole" ? "whole" : "partial";
  const pov = reach === "partial" ? (had.pov ?? x.pov) : undefined;
  exposure[i] = { who: had.who, channel, ...(also.length > 0 ? { also } : {}), reach, ...(pov !== undefined ? { pov } : {}), ...(had.pending || x.pending ? { pending: true as const } : {}) };
}

/** The blobs a beat names: its texts and the points of view of its exposure. */
export function beatBlobs(b: Beat): string[] {
  return [b.what, ...(b.deed ? [b.deed] : []), b.surface, ...(b.quotes ? [b.quotes] : []), ...(b.uncertain ? [b.uncertain] : []), ...b.exposure.flatMap((x) => (x.pov ? [x.pov] : []))];
}

/** The blobs a beat, staging, strike, passage (`shared/passage.ts`) or scene (`shared/scene.ts`) names (the sweep keeps them). */
export function storyBlobs(type: string, data: unknown): string[] {
  if (type === STORY_BEAT) {
    const b = beatOf(data);
    return b ? beatBlobs(b) : [];
  }
  if (type === STORY_STAGING) {
    const s = stagingOf(data);
    return s ? [s.where, s.doing, ...(s.occluded ? [s.occluded] : [])] : [];
  }
  if (type === STORY_STRIKE) {
    const s = strikeOf(data);
    return s?.why ? [s.why] : [];
  }
  if (type === STORY_PASSAGE) return passageBlobs(data);
  if (type === STORY_SCENE) return sceneBlobs(data);
  return [];
}
