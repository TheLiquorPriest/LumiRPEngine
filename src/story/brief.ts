// What the turn lane takes from the story record for the briefing (plan §8.1, §10.2).
//
// The story brief: the current scene, the threads the Author holds hot, the arcs of those the scene
// has on stage, the futures whose time has come by story time, and the player model. What goes in is
// decided by the Author's own marks, by who the scene has on stage and by due times; code ranks
// nothing and summarizes nothing. Its layout and every word around the record's own are the prompt
// part `.prompts/story-brief.md`.
//
// The record's parts for the story so far: the summaries written for chapters and scenes and every
// beat, each with the messages it stands for, in the shape `src/story/sofar` takes.

import type { JsonObject } from "rp-harness/contract";
import type { PathEntry, Store } from "../store";
import { coverageOf } from "./cover";
import { allSpans, itemView, namesOf, storyClock } from "./kit";
import { storyAt } from "./path";
import { nameKey, type SpanPart, type StoryItem, StoryRecord } from "./record";
import type { StoryBeat, StoryRecordParts, StorySoFarInput, StorySummary } from "./sofar/index";

/** Which record to read: whose, in which chat, at which turn (null: the chat's head). */
export interface StoryPoint {
  store: Store;
  user: string;
  chat: string;
  turn: string | null;
  /** The messages of the line the reading goes along, where it is not the chat's own (the path a generation was made on); the chat's path when left out. */
  messages?: readonly PathEntry[];
}

/** A list the layout shows under one heading: the heading's block is the object, its lines the items. */
export type BriefList = { items: JsonObject[] };

/** The fields of `.prompts/story-brief.md`; a part with nothing in it is left out, so the layout shows nothing of it. (A type, not an interface, so it is a template's fields.) */
export type StoryBriefFields = {
  scene?: JsonObject;
  threads?: BriefList;
  arcs?: BriefList;
  futures?: BriefList;
  player?: BriefList;
  /** Story time now, where the chat keeps a clock. */
  now?: string;
};

export interface StoryBrief {
  /** The block as laid out; empty when the record holds nothing for it. */
  text: string;
  fields: StoryBriefFields;
}

function readAt(point: StoryPoint): StoryRecord {
  return StoryRecord.read(point.store, point.user, storyAt(point.store.user(point.user), point.chat, point.turn, point.messages));
}

/**
 * An item as the layout reads it: a list held as an object's own value (`.`), so that a block on it
 * shows once and `{{name}}` puts the names in joined, as the template syntax has it.
 */
function laidOut(view: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(view).map(([key, value]) => [key, Array.isArray(value) ? { ".": value } : value]));
}

/** The story brief for a turn: the turn being answered, or the chat's head. */
export function storyBrief(point: StoryPoint & { layout: StorySoFarInput["layout"] }): StoryBrief {
  const record = readAt(point);
  const clock = storyClock(point.store, point.user, point.chat, point.turn);
  const spans = allSpans(record);
  const view = (item: StoryItem): JsonObject => laidOut(itemView(record, item, clock, spans));
  const current = record.current("scene");
  const scene = current !== null && current.closedBy === null ? current : null;
  const onStage = new Set((scene === null ? [] : namesOf(scene)).map(nameKey));
  const threads = record.of("thread").filter((t) => t.fields.hot === true && t.closedBy === null);
  const arcs = record.of("arc").filter((a) => namesOf(a).some((n) => onStage.has(nameKey(n))));
  const futures = clock === null ? [] : record.of("future").filter((f) => f.closedBy === null && typeof f.fields.due === "number" && f.fields.due <= clock.now);
  const player = record.of("player");
  const list = (items: StoryItem[]): BriefList | undefined => (items.length > 0 ? { items: items.map(view) } : undefined);
  const parts = { threads: list(threads), arcs: list(arcs), futures: list(futures), player: list(player) };
  const fields: StoryBriefFields = { ...(scene !== null ? { scene: view(scene) } : {}) };
  for (const [name, value] of Object.entries(parts)) if (value !== undefined) fields[name as keyof typeof parts] = value;
  if (Object.keys(fields).length === 0) return { text: "", fields };
  const now = clock === null ? null : clock.text(clock.now);
  if (now !== null) fields.now = now;
  return { text: point.layout.render(fields).text.trimEnd(), fields };
}


/** The written summaries of a timeline part, each with the messages it stands for; one whose messages were deleted stands where the turn that wrote it does, marked. One not placed yet (its turn is still open) is left out. */
function summaries(record: StoryRecord, part: SpanPart): StorySummary[] {
  const spans = record.spans(part);
  return record.of(part).flatMap((item): StorySummary[] => {
    const span = spans.get(item.id);
    const text = item.fields.summary;
    if (typeof text !== "string") return [];
    if (span?.from != null && span.to != null) return span.to < span.from ? [] : [{ from: span.from, to: span.to, text }];
    if (item.fields.first === undefined && item.fields.last === undefined) return [];
    const at = record.at.replyOf(item.rows.findLast((r) => typeof r.value.summary === "string")?.turn ?? item.touched);
    return at === null ? [] : [{ from: at, to: at, text, gone: true }];
  });
}

/**
 * What the story so far is drawn from: chapter and scene summaries and the beats, each where it lies in the chat (a beat that stands
 * for a stretch with the last message of it), what the record holds of messages that were deleted where the turn that wrote it stands,
 * marked, and the stretches of the chat the record covers nowhere.
 */
export function storyRecordParts(point: StoryPoint): StoryRecordParts {
  const record = readAt(point);
  const beats = record.of("beat").flatMap((beat): StoryBeat[] => {
    if (typeof beat.fields.text !== "string") return [];
    const { from, to } = record.beatSpan(beat);
    if (from !== null) return [{ at: from, ...(to !== null && to > from ? { to } : {}), text: beat.fields.text }];
    const at = beat.fields.message === undefined ? null : record.at.replyOf(beat.opened);
    return at === null ? [] : [{ at, text: beat.fields.text, gone: true }];
  });
  const uncovered = coverageOf(record)
    .stretches.filter((s) => !s.covered)
    .map((s) => ({ from: s.from, to: s.to }));
  return { chapters: summaries(record, "chapter"), scenes: summaries(record, "scene"), beats, uncovered };
}
