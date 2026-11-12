// The story record (DEPTH2-PLAN §4): a reply's record holds the story's part (`Rec.story`), what its
// turn and the jobs tied to it wrote: the beats it wrote, the beats it struck, each casting it set,
// each draft as it left it. Here a part is read and merged, and the story is walked along the chat's
// path. Pure: the backend gives the records on the path, each with its part, and what a turn under
// way has staged on top (`backend/story/record.ts`).
//
// Walking the path in order gives every beat as it stands (a struck one carrying why), each person's
// casting as it stands (the latest record that cast them), and each draft as it stands (the latest
// record that wrote it, and where on the path it was first opened). Reads are lenient: the part is
// outside every hash and any metadata writer can change it, so a damaged entry is left out, never the
// record. Nothing here is a limit: what a part may take is checked as it is written (`checks.ts`).

import { isRecord } from "../../shared/json";
import { BEAT_KINDS, BEAT_REACHES, type Beat, type BeatStrike, type Cast, CAST_STANDINGS, type Draft, DRAFT_STATES, DRAFT_TIERS, type Exposure, type Rec, type RecStory } from "../../shared/ledger";

/** A record's story part with every list, empty where it holds none. */
export type StoryPart = Required<RecStory>;

const isText = (v: unknown): v is string => typeof v === "string";
const isWord = (v: unknown): v is string => typeof v === "string" && v !== "";
const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.every(isWord);

function exposureOf(raw: unknown): Exposure | null {
  if (!isRecord(raw) || !isWord(raw.who)) return null;
  const reach = BEAT_REACHES.find((r) => r === raw.reach);
  if (reach === undefined) return null;
  return { who: raw.who, reach, ...(isText(raw.got) ? { got: raw.got } : {}), ...(isWord(raw.from) ? { from: raw.from } : {}) };
}

/** A stored beat, or null where it isn't one. A `struck` it holds is dropped: whether a beat stands is the path's to say (`walkStory`). */
export function beatOf(raw: unknown): Beat | null {
  if (!isRecord(raw) || !isWord(raw.id) || !isWord(raw.turn) || typeof raw.at !== "number" || !Number.isFinite(raw.at) || !(raw.where === null || isWord(raw.where)) || !isWord(raw.by)) return null;
  const kind = BEAT_KINDS.find((k) => k === raw.kind);
  if (kind === undefined || !isText(raw.what) || !isText(raw.surface) || !Array.isArray(raw.exposure) || !isRecord(raw.decidedBy) || !isWord(raw.decidedBy.agent)) return null;
  const exposure = raw.exposure.map(exposureOf);
  if (exposure.some((e) => e === null)) return null;
  return {
    id: raw.id,
    turn: raw.turn,
    at: raw.at,
    where: raw.where,
    by: raw.by,
    kind,
    what: raw.what,
    surface: raw.surface,
    ...(Array.isArray(raw.quotes) && raw.quotes.every(isText) ? { quotes: raw.quotes as string[] } : {}),
    ...(isWords(raw.to) ? { to: raw.to } : {}),
    exposure: exposure.filter((e): e is Exposure => e !== null),
    decidedBy: { agent: raw.decidedBy.agent, ...(isWord(raw.decidedBy.as) ? { as: raw.decidedBy.as } : {}) },
    ...(isWord(raw.settles) ? { settles: raw.settles } : {}),
    ...(isRecord(raw.past) && isWord(raw.past.from) && isWord(raw.past.to) ? { past: { from: raw.past.from, to: raw.past.to } } : {}),
  };
}

function strikeOf(raw: unknown): BeatStrike | null {
  return isRecord(raw) && isWord(raw.beat) && isText(raw.why) ? { beat: raw.beat, why: raw.why } : null;
}

function castOf(raw: unknown): Cast | null {
  if (!isRecord(raw) || !isWord(raw.entity)) return null;
  const standing = CAST_STANDINGS.find((s) => s === raw.standing);
  if (standing === undefined) return null;
  return { entity: raw.entity, standing, ...(raw.pinned === true ? { pinned: true } : {}), ...(isText(raw.why) ? { why: raw.why } : {}), ...(isWord(raw.digestedTo) ? { digestedTo: raw.digestedTo } : {}) };
}

function draftOf(raw: unknown): Draft | null {
  if (!isRecord(raw) || !isWord(raw.id) || !isText(raw.what) || !isWords(raw.who) || typeof raw.when !== "number" || !Number.isFinite(raw.when)) return null;
  const tier = DRAFT_TIERS.find((t) => t === raw.tier);
  const state = DRAFT_STATES.find((s) => s === raw.state);
  const basis = raw.basis;
  if (tier === undefined || state === undefined || !isRecord(basis) || !isWord(basis.messageId) || !Number.isInteger(basis.swipeId)) return null;
  return {
    id: raw.id,
    what: raw.what,
    tier,
    who: raw.who,
    ...(isWords(raw.where) ? { where: raw.where } : {}),
    when: raw.when,
    basis: { messageId: basis.messageId, swipeId: basis.swipeId as number, ...(Number.isInteger(basis.seq) ? { seq: basis.seq as number } : {}) },
    state,
    ...(isText(raw.notes) ? { notes: raw.notes } : {}),
  };
}

/** Each entry of a stored list that `read` reads; none where the list is missing or isn't one. */
function listOf<T>(raw: unknown, read: (entry: unknown) => T | null): T[] {
  return Array.isArray(raw) ? raw.map(read).filter((entry): entry is T => entry !== null) : [];
}

/** A record's story part as stored: every list, empty where the record holds none, each damaged entry left out. */
export function recStoryOf(rec: Pick<Rec, "story"> | null | undefined): StoryPart {
  const raw: unknown = rec?.story;
  const part = isRecord(raw) ? raw : {};
  return { beats: listOf(part.beats, beatOf), struck: listOf(part.struck, strikeOf), cast: listOf(part.cast, castOf), drafts: listOf(part.drafts, draftOf) };
}

/**
 * `added` kept after what `held` holds, as one record keeps both: a beat or a strike once by its
 * beat's id (the same beat written again is the one written), and each person's casting and each
 * draft as the later says it.
 */
export function withStory(held: RecStory, added: RecStory): StoryPart {
  const beats = [...(held.beats ?? [])];
  for (const beat of added.beats ?? []) if (!beats.some((b) => b.id === beat.id)) beats.push(beat);
  const struck = [...(held.struck ?? [])];
  for (const strike of added.struck ?? []) if (!struck.some((s) => s.beat === strike.beat)) struck.push(strike);
  const cast = [...(held.cast ?? []).filter((c) => !(added.cast ?? []).some((a) => a.entity === c.entity)), ...(added.cast ?? [])];
  const drafts = [...(held.drafts ?? []).filter((d) => !(added.drafts ?? []).some((a) => a.id === d.id)), ...(added.drafts ?? [])];
  return { beats, struck, cast, drafts };
}

/** The part as a record stores it: each list only where it holds something; null where it holds nothing at all. */
export function storedStory(part: RecStory): RecStory | null {
  const out: RecStory = {
    ...(part.beats?.length ? { beats: part.beats } : {}),
    ...(part.struck?.length ? { struck: part.struck } : {}),
    ...(part.cast?.length ? { cast: part.cast } : {}),
    ...(part.drafts?.length ? { drafts: part.drafts } : {}),
  };
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------- the path

/** One record on the chat's path that holds a story part: its reply, the swipe that shows it, and the record's number (`Rec.seq`). */
export interface StoryRecordAt {
  messageId: string;
  swipeId: number;
  seq: number;
  story: StoryPart;
}

/** A beat on the path, with the step it was written at: the position of its record among those walked, a turn's staged beats after them all. */
export interface PathBeat {
  beat: Beat;
  step: number;
}

/** A draft as it stands on the path, with the step it was first opened at. */
export interface PathDraft {
  draft: Draft;
  opened: number;
}

/** The story as the chat's path holds it: every beat in order, a struck one carrying why; each person's casting as it stands; each draft as it stands. */
export interface StoryPath {
  beats: PathBeat[];
  cast: Cast[];
  drafts: PathDraft[];
}

/** The story along `records`, the path's in order, with what a turn under way has staged (`staged`) after them all. */
export function walkStory(records: readonly StoryRecordAt[], staged: RecStory | null = null): StoryPath {
  const parts: StoryPart[] = [...records.map((r) => r.story), ...(staged ? [withStory({}, staged)] : [])];
  const why = new Map<string, string>();
  for (const part of parts) for (const strike of part.struck) if (!why.has(strike.beat)) why.set(strike.beat, strike.why);
  const beats: PathBeat[] = [];
  const seen = new Set<string>();
  const cast = new Map<string, Cast>();
  const drafts = new Map<string, PathDraft>();
  parts.forEach((part, step) => {
    for (const beat of part.beats) {
      if (seen.has(beat.id)) continue;
      seen.add(beat.id);
      const struck = why.get(beat.id);
      beats.push({ beat: struck === undefined ? beat : { ...beat, struck }, step });
    }
    for (const entry of part.cast) cast.set(entry.entity, entry);
    for (const draft of part.drafts) drafts.set(draft.id, { draft, opened: drafts.get(draft.id)?.opened ?? step });
  });
  return { beats, cast: [...cast.values()], drafts: [...drafts.values()] };
}

/** The beat `id` on the path, as it stands; null where the path holds none. */
export function beatOn(path: StoryPath, id: string): PathBeat | null {
  return path.beats.find((b) => b.beat.id === id) ?? null;
}

/** The draft `id` on the path, as it stands; null where the path holds none. */
export function draftOn(path: StoryPath, id: string): PathDraft | null {
  return path.drafts.find((d) => d.draft.id === id) ?? null;
}

/** Someone's casting as it stands on the path; null for one never cast, who is an extra. */
export function castOn(path: StoryPath, entity: string): Cast | null {
  return path.cast.find((c) => c.entity === entity) ?? null;
}
