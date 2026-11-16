// What the Story page's routes take and answer (plan §8.1, §14), declared field by field so that the
// pages' types and the API reference say what a page sends and is sent. The parts of the story record are
// the record's own list (`./record.ts`), and the declaration is held to it, so that a part added there
// stops this compiling until the declaration says so.

import { type Exactly, type Holds, type Infer, shape } from "../app";
import { type StoryPart, STORY_PARTS } from "./record";

const T = shape.text();
const N = shape.number();
const field = shape.field;
const nullable = shape.nullable;

const storyPartName = shape.named("StoryPartName", "The parts of the story record.", shape.oneOf(...STORY_PARTS));
type PartMirrored = Holds<Exactly<Infer<typeof storyPartName>, StoryPart>>;

/** The parts the answer gives as lists, each bounded: every part but the one premise. */
export const LIST_PARTS = STORY_PARTS.filter((p): p is Exclude<StoryPart, "premise"> => p !== "premise");
export type StoryListPart = (typeof LIST_PARTS)[number];
export const storyListPart = shape.named("StoryListName", "The parts the story route gives as bounded lists: every part but the one premise.", shape.oneOf(...LIST_PARTS));

const writeRow = shape.named(
  "StoryWriteRow",
  "One write of an item, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said.",
  shape.object({
    turn: field(nullable(shape.turnId()), "The turn it was written on; null for the player's own change, which belongs to no turn."),
    message: field(nullable(N), "The number of that turn's reply on the chat's path, from 0; null while the turn is on no path (open, or left behind)."),
    imported: field(shape.yesNo(), "That turn was written by a migration's import, not played on RPE."),
    by: field(nullable(T), "Who wrote it: an agent's definition (`author`), `player`, or the migration."),
    wrote: field(shape.record(shape.json()), "What it said, as the item's fields are shown: `close` and `drop` among them."),
  }),
);
export type StoryWriteShown = Infer<typeof writeRow>;

const itemRow = shape.named(
  "StoryItemRow",
  "An item of the story record as it stands on the path read: its fields, where it lies in the chat by message number (null: nowhere, or an end the record cannot place), its first write, whether it is closed or struck, and every write.",
  shape.object({
    id: T,
    part: storyPartName,
    fields: field(shape.record(shape.json()), "Every field its writes set, the latest of each: messages by their number on the chat's path (`first` and `last` as `from` and `to`), a due time as the engine shows a time."),
    from: field(nullable(N), "Where it lies in the chat, by message number: a beat's messages, a scene's or a chapter's span. Null for a part that lies nowhere, or an end the record cannot place."),
    to: nullable(N),
    turn: field(nullable(shape.turnId()), "Its first write: the turn; null when that write was the player's own change, which belongs to no turn."),
    message: field(nullable(N), "That turn's reply on the path."),
    imported: field(shape.yesNo(), "Whether a migration's import wrote that turn."),
    by: field(nullable(T), "Who wrote it."),
    closed: shape.yesNo(),
    struck: shape.yesNo(),
    writes: field(shape.list(writeRow), "Every write of it on the path, oldest first."),
  }),
);
export type StoryItemShown = Infer<typeof itemRow>;

const itemList = shape.named(
  "StoryItems",
  "A list of the record, bounded: what it gives, how many it holds in all, and how many it left out before and after what it gives.",
  shape.object({ items: shape.list(itemRow), total: N, before: N, after: N }),
);
export type StoryList = Infer<typeof itemList>;

const horizonEntry = shape.named(
  "HorizonEntryRow",
  "An entry of the Author's horizon, as the store keeps it: as the Author wrote it, with the level of the world it names now (none: words that name nothing).",
  shape.object({ at: T, ref: nullable(T), name: nullable(T), depth: field(shape.union(N, shape.literal("full")), "How deep the world state shows it: a whole number of levels, or `full`.") }),
);
export type StoryHorizonEntry = Infer<typeof horizonEntry>;

export const storyReply = shape.named(
  "StoryReply",
  "The story record of a chat: the timeline, the story model's parts as recorded, the Author's horizon and the futures.",
  shape.object({
    chat: T,
    turn: field(nullable(shape.turnId()), "The turn read at; null: the chat's newest."),
    now: field(nullable(T), "Story time at the reading, as the engine shows a time; null where the chat keeps none."),
    listed: field(N, "The most items one list gives at once: the setting `story.queryItems` for the chat."),
    timeline: field(shape.object({ chapter: itemList, scene: itemList, beat: itemList }), "Chapters and scenes by where they start, beats by where they lie; what the record cannot place last."),
    current: field(shape.object({ chapter: nullable(T), scene: nullable(T) }), "The chapter and the scene the chat is in now; null when it is in none (none yet, or the last one is closed)."),
    model: field(
      shape.object({ premise: nullable(itemRow), thread: itemList, arc: itemList, player: itemList, canon: itemList, retcon: itemList, record: itemList }),
      "The story model's parts as recorded, in the order first written: the premise, then each list.",
    ),
    horizon: shape.list(horizonEntry),
    futures: field(itemList, "The futures, today's drafts among them, in the order first written."),
  }),
);
export type StoryAnswer = Infer<typeof storyReply>;

export const storyStrikeBody = shape.named(
  "StoryStrikeAsk",
  "An item of the record, by id, struck (true) or its strike taken back (false); with a strike, why, where the player says.",
  shape.object({ id: shape.text({ blank: false }), struck: shape.yesNo(), why: shape.optional(nullable(T)) }),
);
export type StoryStrike = Infer<typeof storyStrikeBody>;

export const storyStrikeReply = shape.named(
  "StoryStrikeReply",
  "What a strike, or taking one back, did: whether anything was recorded, and the item as it stands now, at the chat's newest turn.",
  shape.object({ changed: field(shape.yesNo(), "Whether anything was recorded: false when the item already stood so."), item: itemRow }),
);
export type StoryStruck = Infer<typeof storyStrikeReply>;

export const storyCorrectBody = shape.named(
  "StoryCorrectAsk",
  "An item of the record, by id, and the fields of it to correct, each as the item shows it (a message by its number, a time as the page shows it, names as a list): the player's own words, written as his own change after the chat's newest reply.",
  shape.object({ id: shape.text({ blank: false }), fields: field(shape.record(shape.json()), "The fields to set: the item's own, as `story_record` reads them for its part, `close` and `drop` among them.") }),
);
export type StoryCorrect = Infer<typeof storyCorrectBody>;

export const storyCorrectReply = shape.named(
  "StoryCorrectReply",
  "What a correction did: whether anything was recorded, what could not be read of it, and the item as it stands now, at the chat's newest turn.",
  shape.object({ changed: shape.yesNo(), said: field(shape.list(T), "Each thing sent that could not be read, was left out, or did not add up, in words."), item: itemRow }),
);
export type StoryCorrected = Infer<typeof storyCorrectReply>;

const timelineRow = shape.named(
  "StoryTimelineRow",
  "One entry of the timeline: a chapter, a scene or a beat, with the chapter and the scene it lies in and, for a beat, the messages it stands for.",
  shape.object({
    kind: shape.oneOf("chapter", "scene", "beat"),
    item: itemRow,
    chapter: field(nullable(T), "The id of the chapter it lies in; null for a chapter, or where none does."),
    scene: field(nullable(T), "The id of the scene it lies in; null for a chapter or a scene, or where none does."),
    messages: field(shape.list(shape.object({ number: N, id: T })), "A beat's messages, each by its number on the chat's path and its id; empty for a chapter or a scene (their span is in `item`)."),
  }),
);
export type StoryTimelineRow = Infer<typeof timelineRow>;

export const storyTimelineReply = shape.named("StoryTimeline", "A page of the timeline: chapters, scenes and beats as one list in the chat's order, oldest first.", shape.page(timelineRow));
export type StoryTimelinePage = Infer<typeof storyTimelineReply>;

export const storyCoverageReply = shape.named(
  "StoryCoverage",
  "What the record covers of the whole chat: every stretch of messages with the same marks, in and out of the prompt's window, and how many messages above the window's edge it does not cover.",
  shape.object({
    chat: T,
    messages: field(N, "How many messages the chat's path holds."),
    edge: field(nullable(N), "The number of the first message the prompt's window keeps; null where it keeps them all, or none is known."),
    hiddenReadable: field(shape.yesNo(), "The chat's setting: agents may read the messages the player hid, so an uncovered hidden message above the edge counts."),
    hidden: field(shape.list(N), "The numbers of the messages the player hid."),
    above: field(N, "How many messages above the window's edge the record does not cover: the window marker's count."),
    stretches: shape.list(
      shape.object({
        from: N,
        to: N,
        covered: field(shape.yesNo(), "Beats or a scene's summary lie over it."),
        beats: field(shape.yesNo(), "Beats lie over it."),
        summarized: field(shape.yesNo(), "It lies in a scene that has its summary."),
        window: field(shape.yesNo(), "It lies inside the prompt's window."),
      }),
    ),
  }),
);
export type StoryCoverageAnswer = Infer<typeof storyCoverageReply>;

export const storySoFarReply = shape.named(
  "StorySoFarReply",
  "The story so far as the next briefing gives it to the Author, worked out at the chat's head: its text, its size against its budget, and what it left out.",
  shape.object({
    text: field(T, "The block as laid out; empty when the window leaves nothing out or the record holds nothing for it."),
    tokens: field(N, "Its size in tokens."),
    budget: field(N, "The most tokens it may fill."),
    leftOut: field(shape.list(shape.object({ from: N, to: N, chapters: N, scenes: N, beats: N })), "Each stretch it had no room for, with what of the record it holds."),
  }),
);
export type StorySoFarAnswer = Infer<typeof storySoFarReply>;

/** The checks above hold, and are read by no one. */
export type Mirrors = [PartMirrored];
