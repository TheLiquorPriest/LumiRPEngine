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
    turn: shape.turnId(),
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
    turn: field(shape.turnId(), "Its first write: the turn."),
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
  shape.object({ at: T, ref: nullable(T), name: nullable(T) }),
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

/** The checks above hold, and are read by no one. */
export type Mirrors = [PartMirrored];
