// The narrative record on a chain (DEPTH-PLAN §4.2): the live beats and staging, read by walking the
// chain with the fold's own liveness, no state needed. Story events change no world state, never
// fail on a rebased view (structural validation) and are never grouped, so a story event is live
// exactly where its record's events, its post entry or its layer entry folds: the active swipe's
// record unless tombstoned or past a pause, less undone refs; post entries live by P1 (a GM edit or
// ✎ fix that a rebased view works out again folds as that, without its stored events); and the live
// layer entries after each message (`liveLayer`). Then a live beat's `supersedes` and a live
// `story.strike` take the beats they name out.

import type { MessageId } from "../../shared/ids";
import type { FoldLayerEntry } from "../../shared/layer";
import type { EventRef, LedgerEvent, PathHash, Pause, Rec, Tombstone } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import type { EntityId } from "../../shared/ids";
import { beatOf, STORY_BEAT, STORY_STAGING, STORY_STRIKE, stagingOf, strikeOf, type Exposure, type PlacedBeat, type PlacedStaging, type Staging, type StoryContainer, type StoryRead } from "../../shared/story";
import type { ChainMessage } from "./chain";
import { liveLayer } from "./layer";
import { activeRecord, isLive, nextPath, turnPath } from "./path";

export interface StoryInput {
  chain: readonly ChainMessage[];
  tombstones: readonly Tombstone[];
  pauses: readonly Pause[];
  layer?: readonly FoldLayerEntry[];
  /** Read through this message (its layer entries included) and stop. */
  upTo?: MessageId;
}

const sameRef = (a: EventRef, b: EventRef): boolean => a.in === b.in && a.index === b.index && (a.in === "events" || (b.in === "post" && a.seq === b.seq));

/** One event met by `walkLive`: where it came from, its index in that list, and, from a layer entry, the entry's reasoning. */
type Visit = (ev: LedgerEvent, from: StoryContainer, k: number, reasoning?: string) => void;

/**
 * Every event whose container folds on the chain, in fold order (DEPTH-PLAN §4.9): the active
 * records' own events and live post entries (less undone refs; a GM edit or ✎ fix a rebased view
 * works out again is left out, as its stored events don't fold), then each message's live layer
 * entries. On a rebased view the fold may still drop a state-dependent event that no longer fits
 * (`FoldOutput.notes`, `layerDrops`); story events never do.
 */
function walkLive(input: StoryInput, visit: Visit): void {
  const live = liveLayer(input.chain, input.tombstones, input.layer);
  const pausedAt = new Set(input.pauses.map((p) => p.messageId));
  const layerAfter = (messageId: MessageId): void => {
    for (const e of live.at.get(messageId) ?? []) e.events.forEach((ev, k) => visit(ev, { layer: e.id, messageId }, k, e.reasoning));
  };
  let parent: PathHash = ROOT_PATH;
  let paused = false;
  for (const m of input.chain) {
    const path = nextPath(m, parent, input.tombstones);
    if (m.isUser) {
      if (!paused) layerAfter(m.id);
      if (pausedAt.has(m.id)) paused = true;
    } else if (!paused) {
      const rec = activeRecord(m, input.tombstones);
      if (rec) recordEvents(rec, m, parent, visit);
      layerAfter(m.id);
    }
    parent = path;
    if (m.id === input.upTo) break;
  }
}

export function storyOn(input: StoryInput): StoryRead {
  return storyAndEventsOn(input, NO_TYPES).story;
}

const NO_TYPES: ReadonlySet<string> = new Set();

/** A live event of one of the asked types (`liveEventsOn`). */
export interface LiveEvent {
  event: LedgerEvent;
  from: StoryContainer;
  /** Its index in its record's events, its post entry or its layer entry. */
  at: number;
  /** Its position among the events returned, in fold order. */
  index: number;
  /** The layer entry's reasoning, for one from the layer. */
  reasoning?: string;
}

/**
 * Whether the chain holds an event of `types` anywhere `walkLive` could meet one, live or not: in a
 * reply's shown record (its events or a post entry) or in a layer entry. Reading the records and
 * the layer hashes nothing, so a chain holding none, as a chat never on depth holds none of depth's
 * events, is never walked.
 */
function holdsAny(input: StoryInput, types: ReadonlySet<string>): boolean {
  const any = (events: readonly LedgerEvent[]): boolean => events.some((ev) => types.has(ev.type));
  if (input.layer?.some((e) => any(e.events))) return true;
  return input.chain.some((m) => {
    const rec = m.isUser ? undefined : m.ledger?.swipes[String(m.swipeId)];
    return rec !== undefined && (any(rec.events) || rec.post.some((p) => any(p.events)));
  });
}

/** The events of `types` whose containers fold on the chain, in fold order (`walkLive`): mind writes, notebook revisions, truth links; none without a walk where the chain holds none (`holdsAny`). */
export function liveEventsOn(input: StoryInput, types: ReadonlySet<string>): LiveEvent[] {
  const out: LiveEvent[] = [];
  if (!holdsAny(input, types)) return out;
  walkLive(input, (event, from, at, reasoning) => {
    if (types.has(event.type)) out.push({ event, from, at, index: out.length, ...(reasoning ? { reasoning } : {}) });
  });
  return out;
}

/** `storyOn` and `liveEventsOn` in one walk of the chain: the narrative record, and the live events of `types` (real-time dialogue's `story.talk`, a reader's own records). */
export function storyAndEventsOn(input: StoryInput, types: ReadonlySet<string>): { story: StoryRead; events: LiveEvent[] } {
  const beats: PlacedBeat[] = [];
  const staging: PlacedStaging[] = [];
  const strikes: { beats: string[]; from: StoryContainer }[] = [];
  const events: LiveEvent[] = [];
  let index = 0;
  walkLive(input, (ev, from, at, reasoning) => {
    if (types.has(ev.type)) events.push({ event: ev, from, at, index: events.length, ...(reasoning ? { reasoning } : {}) });
    if (ev.type !== STORY_BEAT && ev.type !== STORY_STAGING && ev.type !== STORY_STRIKE) return;
    // A grouped story event never validates, so it never folds.
    if (ev.group !== undefined || ev.tiedTo !== undefined || !("data" in ev)) return;
    if (ev.type === STORY_BEAT) {
      const beat = beatOf(ev.data);
      if (beat) beats.push({ beat, from, index: index++ });
    } else if (ev.type === STORY_STAGING) {
      const s = stagingOf(ev.data);
      if (s) staging.push({ staging: s, from, index: index++ });
    } else {
      const s = strikeOf(ev.data);
      if (s) {
        strikes.push({ beats: s.beats, from });
        index++;
      }
    }
  });
  return { story: settle(beats, staging, strikes), events };
}

/** A record's events that fold, in fold order: its own events, then its live post entries by seq. */
function recordEvents(rec: Rec, m: ChainMessage, parent: PathHash, visit: Visit): void {
  const recPath = turnPath(rec);
  const view = recPath !== null && (recPath !== parent || rec.readElsewhere === true);
  const converted = rec.keep?.[parent]?.convert ?? [];
  const from: StoryContainer = { rec: rec.seq, messageId: m.id, swipeId: m.swipeId };
  rec.events.forEach((ev, k) => {
    if (!rec.undone.some((u) => sameRef(u, { in: "events", index: k }))) visit(ev, from, k);
  });
  const post = rec.post.filter((p) => isLive(p.at, parent, recPath)).sort((a, b) => a.seq - b.seq);
  for (const p of post) {
    const own = (u: EventRef): boolean => u.in === "post" && u.seq === p.seq;
    // On a view, a GM edit or ✎ fix that keeps its request folds as that request worked out again, not as stored.
    if (view && p.kind === "fix" && p.edit !== undefined && !rec.undone.some(own) && !converted.some(own)) continue;
    const at: StoryContainer = { post: p.seq, messageId: m.id, swipeId: m.swipeId };
    p.events.forEach((ev, k) => {
      if (!rec.undone.some((u) => sameRef(u, { in: "post", seq: p.seq, index: k }))) visit(ev, at, k);
    });
  }
}

/** Takes out the beats a live beat superseded or a live strike struck, and the second of any id met twice. */
function settle(all: PlacedBeat[], staging: PlacedStaging[], strikes: { beats: string[]; from: StoryContainer }[]): StoryRead {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const first: PlacedBeat[] = [];
  for (const b of all) {
    if (seen.has(b.beat.id)) {
      duplicates.push(b.beat.id);
      continue;
    }
    seen.add(b.beat.id);
    first.push(b);
  }
  const replaced = new Map<string, string | { strike: StoryContainer }>();
  for (const b of first) for (const id of b.beat.supersedes ?? []) if (id !== b.beat.id && !replaced.has(id)) replaced.set(id, b.beat.id);
  for (const s of strikes) for (const id of s.beats) if (!replaced.has(id)) replaced.set(id, { strike: s.from });
  return {
    beats: first.filter((b) => !replaced.has(b.beat.id)),
    staging,
    replaced: [...replaced].filter(([id]) => seen.has(id)).map(([id, by]) => ({ id, by })),
    duplicates,
  };
}

/** Beats in story order: by story minute, then their order in the scene, then fold order (a settled draft's backdated beats land late but read in their place). */
export function inStoryOrder(beats: readonly PlacedBeat[]): PlacedBeat[] {
  return [...beats].sort((a, b) => a.beat.at - b.beat.at || a.beat.order - b.beat.order || a.index - b.index);
}

/** The beats that reached `who`, each with what reached them, in fold order. */
export function beatsReaching(read: StoryRead, who: EntityId): { placed: PlacedBeat; exposure: Exposure }[] {
  const out: { placed: PlacedBeat; exposure: Exposure }[] = [];
  for (const placed of read.beats) {
    const exposure = placed.beat.exposure.find((x) => x.who === who);
    if (exposure) out.push({ placed, exposure });
  }
  return out;
}

/** Each person's latest staging before fold position `index`, in `scene` when given: what a beat at `index` is read against. */
export function stagingBefore(read: StoryRead, index: number, scene?: string): Map<EntityId, Staging> {
  const out = new Map<EntityId, Staging>();
  for (const s of read.staging) {
    if (s.index >= index) break;
    if (scene !== undefined && s.staging.scene !== scene) continue;
    out.set(s.staging.who, s.staging);
  }
  return out;
}
