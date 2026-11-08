// The world beyond view (DEPTH-PLAN §4.6): what the author opens off screen, and how it becomes canon.
//
//   story.draft    an episode simulated at its story time, not canon yet: the episode (each person's and
//                  each event's part, with its treatment and the author's reason), its beats dated to
//                  when they happen, the world changes it would make, and whom and what it holds from
//                  when. Immutable: an event in a basis-anchored layer entry at the frontier it read
//                  (§4.9), or in the record of a turn that re-dated it, so it is a candidate exactly
//                  where that is on the chain, comes back on a switch back, and a branch reads its
//                  parent's. Its beats are its own data, never `story.beat` events, so nothing reads
//                  them as canon until a settlement copies them. All it changes of the state is whom
//                  it holds from routine for its span (`holds`, read through `heldIn`): its people are
//                  in the episode then, so the Cast life planner places them nowhere else
//   story.settle   the draft made canon, now: beside it in its entry, the draft's beats as the author
//                  settled them (dated from its story time: the narrative is backdated) and the world
//                  changes it makes now, adjusted to every pin. It lands at the latest message whose
//                  beats it read (t2), and only while the live beats from its story time on are the
//                  ones it read (`EventTypeDef.later.pins`). It marks the draft settled in the story
//                  slice, so a chain settles a draft once
//   author.drop    the author's verdict that a draft won't happen (stale, or overtaken), which marks it
//                  dropped in the author slice; a chain never both settles and drops one
//
// Whether a draft is open, settled or dropped is read per chat and chain, never stored on it: settled
// where a live `story.settle` cites it, dropped where a live `author.drop` does (`draftsOn`). A draft's
// own words (its episode's reason, its parts' rationales, its summary) and its beats' are blobs it
// names; an older draft's inline words still read. A settlement's and a drop's are words, bounded. Pure.

import type { DepthTreatment } from "./depth-settings";
import { DEPTH_TREATMENTS } from "./depth-settings";
import { hashParts } from "./hash";
import type { EntityId, PlaceId } from "./ids";
import { hasOwn, isRecord, type JsonObject } from "./json";
import type { LedgerEvent, PackEvent } from "./ledger";
import { beatBlobs, beatId, beatOf, beatProblem, type Beat, type BlobRef, type StoryRef, type StoryTime } from "./story";
import { blobHash, isBlobHash } from "./stores";

export const STORY_DRAFT = "story.draft";
export const STORY_SETTLE = "story.settle";
export const AUTHOR_DROP = "author.drop";

/** The longest words one field keeps, in characters; the author's whole thinking rides with its entry's reasoning. */
export const EPISODE_WORDS_MAX = 2000;

/** One person's or one event's part in an episode, with its treatment (the Character Engine's effort off screen, §4.4) and the author's reason. */
export interface EpisodePart {
  subject: { who: EntityId } | { event: string };
  treatment: DepthTreatment;
  /** The author's words: why this treatment. The budget meter and the player read it. */
  rationale: string;
}

/** Something that happens over a span of story time, off screen (§4.6). */
export interface StoryEpisode {
  id: string;
  span: [StoryTime, StoryTime];
  places: PlaceId[];
  people: EntityId[];
  /** The author's reason it matters. */
  why: string;
  parts: EpisodePart[];
}

/** Whom or what a draft holds, from when (§4.6): its participants, the people it would have informed by then, the places and things its changes touch. */
export interface DraftTouch {
  ref: StoryRef;
  /** The story minute from which it holds them. */
  from: StoryTime;
}

/** `story.draft`'s data. */
export interface DraftData {
  id: string;
  episode: StoryEpisode;
  /** t1: when it happens in the story (its first beat's minute). */
  at: StoryTime;
  /** Each workspace file it read, path → its body's hash as read (§4.6): each mind file a play or the author's playing of someone showed, and each notebook file the author said it draws on. One whose body changes is what changed underneath it; nothing else is. */
  inputs: Record<string, string>;
  /** Its narrative, dated from `at`, each `by: {draft}`: canon only once a settlement copies it. */
  beats: Beat[];
  /** What it would change in the world, as decided on the state it read. */
  effects: LedgerEvent[];
  touches: DraftTouch[];
  /** The author's account of it, in words. */
  summary: string;
}

/** `story.settle`'s data. */
export interface SettleData {
  draft: string;
  /** The minute its beats are dated from: the draft's story time, or later where the author re-dated it. */
  at: StoryTime;
  /** The pins it read: the live beats from `at` on through its basis, as a digest (`pinsOf`), and how many. */
  pins: { digest: string; count: number };
  /** The author's reading of the pins and what it adjusted, in words. */
  why: string;
  /** The beats it made canon (its entry's own `story.beat` events), by id. */
  beats: string[];
}

/** `author.drop`'s data. */
export interface DropData {
  draft: string;
  why: string;
}

// ---------------------------------------------------------------- ids

/** A draft's id, from what makes it unique to the job that drafted it (its chat, its episode, the basis it read): `d` and 31 hex digits. */
export function draftId(...parts: string[]): string {
  return `d${hashParts("lre.draft", ...parts).slice(1)}`;
}

/** An episode's id, from what makes it unique to the poll that opened it: `e` and 31 hex digits. */
export function episodeId(...parts: string[]): string {
  return `e${hashParts("lre.episode", ...parts).slice(1)}`;
}

// ---------------------------------------------------------------- pins

/**
 * The pins a settlement reads (§4.6): every live beat on the chain from story minute `from` on, in
 * fold order, as a digest of their ids and how many. A beat a later turn decides, or an amendment or
 * strike since, changes the digest, so a settlement checked against other pins never lands.
 */
export function pinsOf(read: { readonly beats: readonly { readonly beat: Pick<Beat, "id" | "at"> }[] }, from: StoryTime): { digest: string; count: number } {
  const ids = read.beats.filter((p) => p.beat.at >= from).map((p) => p.beat.id);
  return { digest: hashParts("lre.pins", String(from), ...ids), count: ids.length };
}

/**
 * Draft `d` re-dated forward by `by` story minutes (§4.6: the invariant's third way, the author's
 * call when a scene reaches what it holds): the same episode, beats, world changes and holds, each
 * moved by `by`, under a new id (the old one's with its new minute) whose beats are its own. The old
 * one is dropped beside it.
 */
export function redatedDraft(d: DraftData, by: number): DraftData {
  const id = draftId(d.id, "redate", String(d.at + by));
  return {
    ...d,
    id,
    episode: { ...d.episode, span: [d.episode.span[0] + by, d.episode.span[1] + by] },
    at: d.at + by,
    beats: d.beats.map((b) => ({ ...b, id: beatId(id, b.id), at: b.at + by, by: { draft: id } })),
    touches: d.touches.map((t) => ({ ref: t.ref, from: t.from + by })),
  };
}

// ---------------------------------------------------------------- validation (structural)

const isId = (v: unknown): v is string => typeof v === "string" && v !== "";
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const words = (v: unknown, empty = false): v is string => typeof v === "string" && (empty || v.trim() !== "") && v.length <= EPISODE_WORDS_MAX;

function refOk(v: unknown): v is StoryRef {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && ["entity", "place", "thing", "fact"].includes(keys[0] as string) && isId(v[keys[0] as string]);
}

function partProblem(v: unknown): string | null {
  if (!isRecord(v) || !isRecord(v.subject)) return "an episode's part names its subject";
  const s = v.subject;
  const subject = Object.keys(s).length === 1 && (isId(s.who) || words(s.event));
  if (!subject) return "a part is about one person ({who}) or one event ({event}, in words)";
  if (typeof v.treatment !== "string" || !(DEPTH_TREATMENTS as readonly string[]).includes(v.treatment)) return `a part's treatment is one of ${DEPTH_TREATMENTS.join(", ")}`;
  return words(v.rationale, true) ? null : "a part's rationale is words";
}

/** Why `data` isn't a well-formed episode, or null. */
export function episodeProblem(data: unknown): string | null {
  if (!isRecord(data)) return "an episode is an object";
  if (!isId(data.id)) return "an episode has an id";
  const span = data.span;
  if (!Array.isArray(span) || span.length !== 2 || !span.every(isTime) || (span[0] as number) > (span[1] as number)) return "an episode spans two story minutes, in order";
  if (!Array.isArray(data.places) || !data.places.every(isId)) return "an episode's places are ids";
  if (!Array.isArray(data.people) || !data.people.every(isId)) return "an episode's people are ids";
  if (!words(data.why, true)) return "an episode's reason is words";
  if (!Array.isArray(data.parts) || data.parts.length === 0) return "an episode has at least one part";
  for (const p of data.parts) {
    const problem = partProblem(p);
    if (problem) return problem;
  }
  return null;
}

/** Why `data` isn't a well-formed draft, or null. Structural only: a draft never fails on a rebased view. */
export function draftProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a draft is an object";
  if (!isId(data.id)) return "a draft has an id";
  const episode = episodeProblem(data.episode);
  if (episode) return episode;
  if (!isTime(data.at)) return "a draft has its story minute (at)";
  if (!isRecord(data.inputs) || !Object.values(data.inputs).every(isId)) return "a draft's inputs are digests by name";
  if (!Array.isArray(data.beats)) return "a draft lists its beats";
  for (const b of data.beats) {
    const problem = beatProblem(b);
    if (problem) return `a draft's beat: ${problem}`;
    if (!isRecord(b) || !isRecord(b.by) || b.by.draft !== data.id) return "a draft's beats are its own (by: {draft})";
  }
  if (!Array.isArray(data.effects) || !data.effects.every((e) => isRecord(e) && typeof e.type === "string")) return "a draft's effects are events";
  if (!Array.isArray(data.touches) || !data.touches.every((t) => isRecord(t) && refOk(t.ref) && isTime(t.from))) return "a draft's touches are refs, each from a story minute";
  return words(data.summary, true) ? null : "a draft's summary is words";
}

/** Why `data` isn't a well-formed settlement, or null. */
export function settleProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a settlement is an object";
  if (!isId(data.draft)) return "a settlement names its draft";
  if (!isTime(data.at)) return "a settlement dates its beats (at)";
  const pins = data.pins;
  if (!isRecord(pins) || !isId(pins.digest) || typeof pins.count !== "number" || !Number.isInteger(pins.count) || pins.count < 0) return "a settlement names the pins it read";
  if (!words(data.why, true)) return "a settlement's reading is words";
  return Array.isArray(data.beats) && data.beats.every(isId) ? null : "a settlement lists the beats it made canon, by id";
}

/** Why `data` isn't a well-formed drop, or null. */
export function dropProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a drop is an object";
  if (!isId(data.draft)) return "a drop names its draft";
  return words(data.why, true) ? null : "a drop's reason is words";
}

export function draftOf(data: unknown): DraftData | null {
  return draftProblem(data) === null ? (data as unknown as DraftData) : null;
}

export function settleOf(data: unknown): SettleData | null {
  return settleProblem(data) === null ? (data as unknown as SettleData) : null;
}

export function dropOf(data: unknown): DropData | null {
  return dropProblem(data) === null ? (data as unknown as DropData) : null;
}

// ---------------------------------------------------------------- events

const bounded = (s: string): string => {
  const t = s.trim();
  return t.length > EPISODE_WORDS_MAX ? `${t.slice(0, EPISODE_WORDS_MAX - 1)}…` : t;
};

/** A draft's text as its event keeps it (§4.6: the record cap; swipes sharing a text share its blob): the hash of its words; one already a blob's hash stays. */
const asBlob = (s: string): BlobRef => (isBlobHash(s as unknown) ? s : blobHash(s.trim()));

function episodeData(e: StoryEpisode): JsonObject {
  return {
    id: e.id,
    span: [e.span[0], e.span[1]],
    places: [...e.places],
    people: [...e.people],
    why: asBlob(e.why),
    parts: e.parts.map((p): JsonObject => ({ subject: "who" in p.subject ? { who: p.subject.who } : { event: bounded(p.subject.event) }, treatment: p.treatment, rationale: asBlob(p.rationale) })),
  };
}

/** The texts `draftEvent` keeps as blobs (its episode's reason, each part's rationale, its summary), trimmed as hashed, for the writer to put before its entry lands; none already a blob's hash. */
export function draftTexts(d: DraftData): string[] {
  return [d.episode.why, ...d.episode.parts.map((p) => p.rationale), d.summary].filter((s) => !isBlobHash(s as unknown)).map((s) => s.trim());
}

export function draftEvent(d: DraftData): PackEvent {
  return {
    type: STORY_DRAFT,
    data: {
      id: d.id,
      episode: episodeData(d.episode),
      at: d.at,
      inputs: { ...d.inputs },
      beats: d.beats as unknown as JsonObject[],
      effects: d.effects as unknown as JsonObject[],
      touches: d.touches as unknown as JsonObject[],
      summary: asBlob(d.summary),
    },
  };
}

export function settleEvent(s: SettleData): PackEvent {
  return { type: STORY_SETTLE, data: { draft: s.draft, at: s.at, pins: { digest: s.pins.digest, count: s.pins.count }, why: bounded(s.why), beats: [...s.beats] } };
}

export function dropEvent(d: DropData): PackEvent {
  return { type: AUTHOR_DROP, data: { draft: d.draft, why: bounded(d.why) } };
}

/** The blobs a draft names (the sweep keeps them): its beats', its episode's reason, its parts' rationales and its summary (an old draft's inline words name none). A settlement and a drop keep their words inline. */
export function episodeBlobs(type: unknown, data: unknown): string[] {
  if (type !== STORY_DRAFT || !isRecord(data) || !Array.isArray(data.beats)) return [];
  const beats = data.beats.flatMap((raw) => {
    const b = beatOf(raw);
    return b ? beatBlobs(b) : [];
  });
  const ep = isRecord(data.episode) ? data.episode : {};
  const texts = [ep.why, ...(Array.isArray(ep.parts) ? ep.parts.map((p) => (isRecord(p) ? p.rationale : undefined)) : []), data.summary].filter(isBlobHash);
  return [...beats, ...texts];
}

// ---------------------------------------------------------------- the bookkeeping a chain folds

/** Whether a state's story slice marks draft `id` settled (`story.settle`). */
export function settledIn(storySlice: unknown, id: string): boolean {
  return isRecord(storySlice) && isRecord(storySlice.settled) && hasOwn(storySlice.settled, id);
}

/** Whether a state's author slice marks draft `id` dropped (`author.drop`). */
export function droppedIn(authorSlice: unknown, id: string): boolean {
  return isRecord(authorSlice) && isRecord(authorSlice.dropped) && hasOwn(authorSlice.dropped, id);
}

/** Whom a draft holds from routine, and when (the story slice's `holds`, by draft id): its people, for its episode's span. */
export interface DraftHold {
  who: EntityId[];
  from: StoryTime;
  until: StoryTime;
}

/** What `story.draft` keeps in the story slice (§4.6, Routines and drafts): its people and the people its parts are about, for its episode's span. */
export function holdOf(d: DraftData): DraftHold {
  const who = new Set([...d.episode.people, ...d.episode.parts.flatMap((p) => ("who" in p.subject ? [p.subject.who] : []))]);
  return { who: [...who], from: d.episode.span[0], until: d.episode.span[1] };
}

/**
 * Whether a draft on the chain holds `who` from routine at story minute `at` (§4.6): its episode's
 * span holds its people, open or settled (a settled one's episode is canon for its span), unless the
 * author dropped it. The Cast life planner places no one it holds.
 */
export function heldIn(storySlice: unknown, authorSlice: unknown, who: EntityId, at: StoryTime): boolean {
  if (!isRecord(storySlice) || !isRecord(storySlice.holds)) return false;
  for (const [id, h] of Object.entries(storySlice.holds)) {
    if (!isRecord(h) || !Array.isArray(h.who) || !h.who.includes(who)) continue;
    if (typeof h.from !== "number" || typeof h.until !== "number" || at < h.from || at >= h.until) continue;
    if (!droppedIn(authorSlice, id)) return true;
  }
  return false;
}

/**
 * The holds a dropped draft had on `who` over story minute `at` (§4.6), earliest first: a dropped
 * draft never happened, so the Cast life planner puts whoever it held where their routine would have
 * them had it never been.
 */
export function droppedHolds(storySlice: unknown, authorSlice: unknown, who: EntityId, at: StoryTime): DraftHold[] {
  if (!isRecord(storySlice) || !isRecord(storySlice.holds)) return [];
  const out: DraftHold[] = [];
  for (const [id, h] of Object.entries(storySlice.holds)) {
    if (!isRecord(h) || !Array.isArray(h.who) || !h.who.includes(who)) continue;
    if (typeof h.from !== "number" || typeof h.until !== "number" || at < h.from || at >= h.until) continue;
    if (droppedIn(authorSlice, id)) out.push({ who: [who], from: h.from, until: h.until });
  }
  return out.sort((a, b) => a.from - b.from);
}
