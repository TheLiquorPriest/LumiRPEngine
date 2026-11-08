// How a scene was rendered (DEPTH-PLAN §1.3, §4.8): `story.passage`, one for each moment of a scene
// whose beats reached the player character. It records which beats its moment held, the text that
// streamed, each draft with the GM's check of it, what the narrator asked the author for, and,
// where a passage streamed though its last check failed, the line its chip shows. Each passage rides
// in the turn record's read part, after `pre`, where today's read of the reply went. A Re-narrate
// copies only `pre`, so it renders the same beats afresh and records prose of its own; a swipe
// that replaces a turn replaces its prose with the new swipe's.
//
// Where the narrator failed (a call that failed, or no passage after its redrafts), the scene went
// on deciding its moments, so the record keeps their beats as canon though no prose shows them:
// `story.unrendered`, after the prose, names each moment it didn't render and why, and the
// reply's chip says so, with Re-narrate, which renders them (§1.4: nothing hidden from the player).
//
// A passage is the rendering, never canon: it changes no world state, validates structurally (pack
// `story`), and nothing reads its text to decide anything. Its texts are blobs; `departs` and `why`
// are one line each, kept inline so the reply's chip is built from the record alone. Pure.

import type { EntityId, MessageId } from "./ids";
import { isRecord, type JsonObject } from "./json";
import type { Chip } from "./state-view";
import { isBlobHash } from "./stores";
import { type BlobRef, STORY_BEAT } from "./story";

export const STORY_PASSAGE = "story.passage";
export const STORY_UNRENDERED = "story.unrendered";

/** The longest `departs` line a passage keeps: one line, for a chip. */
export const DEPARTS_MAX = 400;

/** One draft of a passage and the GM's check of it (§1.3): faithful, not, or null when no check could be read. */
export interface PassageDraft {
  text: BlobRef;
  faithful: boolean | null;
  /** What the check found and said to change, in its words; or why no check could be read. */
  notes?: BlobRef;
  /** The narrator's own reasoning for this draft, where its provider gave one. */
  reasoning?: BlobRef;
  /** The check's reasoning, where its provider gave one. */
  checkReasoning?: BlobRef;
}

/** A detail the narrator asked for (§1.3: it asks, and the author decides it as a beat), and the beats the author decided for it. */
export interface PassageAsk {
  question: BlobRef;
  beats: string[];
}

export interface Passage {
  /** The scene's moment it renders, from 0 in the order the scene decided them. */
  moment: number;
  /** Which passage of the reply it is, from 0. */
  index: number;
  /** Every beat of its moment, in order, by id: those that reached the player character, his own (shown only as context) and any he couldn't perceive. */
  beats: string[];
  /** The player character it was rendered for (D-10). */
  pov: EntityId;
  /** The text that streamed: its last draft's. */
  text: BlobRef;
  /** How many of the turn's planned events run through its moment: what a Stop of a Re-narrate keeps of the copied plan. */
  through?: number;
  /** Each draft in order; the last is the one that streamed. */
  drafts: PassageDraft[];
  asked?: PassageAsk[];
  /** It streamed though its last check found it unfaithful, or no check could be read: where it departs, in one line for the reply's chip. */
  departs?: string;
  /** Nothing of its turn reached the player character but his own beats (LIVE3c L3c-5): it tells only where he is and what he's doing, its beats all of the turn's, so the reply is never empty; the reply's chip says so. */
  quiet?: true;
}

/** A moment the narrator didn't render: its mark in the turn, every beat of it in order by id, and how many of the turn's planned events run through it (as a passage's `through`). */
export interface UnrenderedMoment {
  moment: number;
  beats: string[];
  through?: number;
}

/** The moments of a scene the narrator didn't render, each one something reached the player character in (`pov`), and why it stopped rendering: one line. */
export interface Unrendered {
  moments: UnrenderedMoment[];
  pov: EntityId;
  why: string;
}

const isId = (v: unknown): v is string => typeof v === "string" && v !== "";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function draftProblem(v: unknown): string | null {
  if (!isRecord(v)) return "a passage's draft must be an object";
  if (!isBlobHash(v.text)) return "a draft's text must be a blob";
  if (v.faithful !== true && v.faithful !== false && v.faithful !== null) return "a draft's faithful is true, false or null";
  for (const key of ["notes", "reasoning", "checkReasoning"] as const) if (v[key] !== undefined && !isBlobHash(v[key])) return `a draft's ${key} must be a blob`;
  return null;
}

/** Why `data` isn't a well-formed passage, or null. Structural only, so a passage never fails on a rebased view. */
export function passageProblem(data: unknown): string | null {
  if (!isRecord(data)) return "a passage must be an object";
  if (!isCount(data.moment) || !isCount(data.index)) return "a passage needs its moment and index";
  if (!Array.isArray(data.beats) || data.beats.length === 0 || !data.beats.every(isId)) return "a passage names the beats of its moment";
  if (!isId(data.pov)) return "a passage names the player character it was rendered for";
  if (!isBlobHash(data.text)) return "a passage's text must be a blob";
  if (data.through !== undefined && !isCount(data.through)) return "a passage's through must be a count";
  if (!Array.isArray(data.drafts) || data.drafts.length === 0) return "a passage keeps its drafts";
  for (const d of data.drafts) {
    const problem = draftProblem(d);
    if (problem) return problem;
  }
  if (data.asked !== undefined && !(Array.isArray(data.asked) && data.asked.every((a) => isRecord(a) && isBlobHash(a.question) && Array.isArray(a.beats) && a.beats.every(isId)))) return "a passage's asked must be questions (blobs) with the beats decided for them";
  if (data.departs !== undefined && !(typeof data.departs === "string" && data.departs.trim() !== "" && data.departs.length <= DEPARTS_MAX)) return `a passage's departs is one line of at most ${DEPARTS_MAX} characters`;
  if (data.quiet !== undefined && data.quiet !== true) return "a passage's quiet is true or absent";
  return null;
}

/** `data` as a passage when well formed, else null. */
export function passageOf(data: unknown): Passage | null {
  return passageProblem(data) === null ? (data as unknown as Passage) : null;
}

/** The event (pack `story`): never grouped, as every story event. */
export function passageEvent(p: Passage): { type: typeof STORY_PASSAGE; data: JsonObject } {
  return { type: STORY_PASSAGE, data: p as unknown as JsonObject };
}

/** Why `data` isn't a well-formed record of unrendered moments, or null. Structural only, as a passage's. */
export function unrenderedProblem(data: unknown): string | null {
  if (!isRecord(data)) return "unrendered moments must be an object";
  if (!Array.isArray(data.moments) || data.moments.length === 0) return "unrendered moments name at least one moment";
  for (const m of data.moments) {
    if (!isRecord(m) || !isCount(m.moment)) return "an unrendered moment needs its moment";
    if (!Array.isArray(m.beats) || m.beats.length === 0 || !m.beats.every(isId)) return "an unrendered moment names its beats";
    if (m.through !== undefined && !isCount(m.through)) return "an unrendered moment's through must be a count";
  }
  if (!isId(data.pov)) return "unrendered moments name the player character they were for";
  if (!(typeof data.why === "string" && data.why.trim() !== "" && data.why.length <= DEPARTS_MAX)) return `why the moments weren't rendered is one line of at most ${DEPARTS_MAX} characters`;
  return null;
}

/** `data` as unrendered moments when well formed, else null. */
export function unrenderedOf(data: unknown): Unrendered | null {
  return unrenderedProblem(data) === null ? (data as unknown as Unrendered) : null;
}

/** The event (pack `story`): never grouped, as every story event. */
export function unrenderedEvent(u: Unrendered): { type: typeof STORY_UNRENDERED; data: JsonObject } {
  return { type: STORY_UNRENDERED, data: u as unknown as JsonObject };
}

/** The well-formed records of unrendered moments among `events` (a record's read part), each moment once, in mark order. */
export function unrenderedIn(events: readonly { type: string; data?: unknown }[]): (UnrenderedMoment & { why: string })[] {
  const out = new Map<number, UnrenderedMoment & { why: string }>();
  for (const e of events) {
    const u = e.type === STORY_UNRENDERED ? unrenderedOf(e.data) : null;
    for (const m of u?.moments ?? []) if (!out.has(m.moment)) out.set(m.moment, { ...m, why: u?.why ?? "" });
  }
  return [...out.values()].sort((a, b) => a.moment - b.moment);
}

/** The blobs a passage names (the sweep keeps them). */
export function passageBlobs(data: unknown): string[] {
  const p = passageOf(data);
  if (!p) return [];
  return [p.text, ...p.drafts.flatMap((d) => [d.text, ...(d.notes ? [d.notes] : []), ...(d.reasoning ? [d.reasoning] : []), ...(d.checkReasoning ? [d.checkReasoning] : [])]), ...(p.asked ?? []).map((a) => a.question)];
}

/** Each well-formed passage among `events` (a record's, or a Continue's entry's), in its order in the reply. */
export function passagesIn(events: readonly { type: string; data?: unknown }[]): Passage[] {
  const out: Passage[] = [];
  for (const e of events) {
    if (e.type !== STORY_PASSAGE) continue;
    const p = passageOf(e.data);
    if (p) out.push(p);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** A `departs` line as a passage keeps it: one line, trimmed, at most `DEPARTS_MAX` characters. */
export function departsLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= DEPARTS_MAX ? line : `${line.slice(0, DEPARTS_MAX - 1).trimEnd()}…`;
}

/**
 * The reply's chip when it doesn't render its beats faithfully (§1.3, §1.4, §7): a passage that
 * streamed though its last check found it unfaithful, or no check could be read (where each departs),
 * and the moments the narrator didn't render (how many, and why). Re-narrate renders the same beats
 * again, every moment of them; canon stays the beats. Null when every passage passed its check and
 * every moment was rendered. `events` are the reply's own (its record's, then its Continues'
 * entries'); an unrendered moment counts only where the record kept its beats (a Stop's cut drops it).
 */
export function unfaithfulChip(messageId: MessageId, swipeId: number, events: readonly { type: string; data?: unknown }[]): Chip | null {
  const off = passagesIn(events).flatMap((p, i) => (p.departs !== undefined ? [`Passage ${i + 1}: ${p.departs}`] : []));
  const kept = new Set(events.flatMap((e) => (e.type === STORY_BEAT && isRecord(e.data) && isId(e.data.id) ? [e.data.id] : [])));
  const unrendered = unrenderedIn(events).filter((m) => m.beats.some((id) => kept.has(id)));
  if (off.length === 0 && unrendered.length === 0) return null;
  const n = unrendered.length;
  const departs = off.length === 1 ? "A passage departs from its beats" : `The prose departs from its beats in ${off.length} places`;
  const missed = n === 1 ? "a moment wasn't rendered" : `${n} moments weren't rendered`;
  const why = [...new Set(unrendered.map((m) => m.why))].join("; ");
  return {
    id: `unfaithful:${messageId}:${swipeId}`,
    kind: "unfaithful",
    messageId,
    swipeId,
    label: n === 0 ? departs : off.length === 0 ? `${missed.charAt(0).toUpperCase()}${missed.slice(1)}` : `${departs}, and ${missed}`,
    detail: [...off, ...(n > 0 ? [`The narrator couldn't render ${n === 1 ? "the reply's last moment" : `the reply's last ${n} moments`} (${why}): their beats were decided, and the reply ends before them.`] : []), "The beats stay canon; Re-narrate renders them again."].join("\n"),
    actions: [{ id: "renarrate", label: "Re-narrate", style: "primary" }],
    expires: "next_send",
  };
}

/**
 * The reply's chip when nothing of its turn reached the player character but his own beats (LIVE3c
 * L3c-5): its passage is the quiet one, which tells only where he is and what he's doing, so the
 * reply is never empty. `name` names the player character it was rendered for. Null otherwise.
 */
export function unreachedChip(messageId: MessageId, swipeId: number, events: readonly { type: string; data?: unknown }[], name: (id: EntityId) => string): Chip | null {
  const quiet = passagesIn(events).find((p) => p.quiet === true);
  if (!quiet) return null;
  const who = name(quiet.pov);
  return {
    id: `unreached:${messageId}:${swipeId}`,
    kind: "degraded",
    messageId,
    swipeId,
    label: `Nothing reached ${who}`,
    detail: `Nothing this turn decided reached ${who} beyond what you wrote: no one answered, and nothing happened that ${who} could perceive. The reply tells only where ${who} is and what they're doing. Your next message plays on from here, or Swipe as… → Re-run the scene plays it again.`,
    actions: [],
    expires: "next_send",
  };
}
