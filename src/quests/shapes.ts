// What the quest routes take and answer (plan §8.3, §14), declared field by field so that the pages' types and the API reference say
// what a page is sent: the player's journal, the records in brief, and one record in full with its history.

import { type Infer, shape } from "../app";

const T = shape.text();
const field = shape.field;
const nullable = shape.nullable;

const kind = shape.oneOf("quest", "secret", "puzzle", "agenda");
const call = shape.oneOf("met", "failed", "open");

const stageRow = shape.named(
  "QuestStageRow",
  "A stage of a quest: its label, the condition that moves the quest past it in words, what the story called on it (null: nothing yet) and why, and whether the quest stands on it now.",
  shape.object({
    id: T,
    label: T,
    condition: T,
    state: field(nullable(call), "What the Author or the GM called on the stage; for a stage the world's quest was moved past and nothing was called on, how the move went (its outcome, or failed where it took the stage's failing way, else met); null where nothing was called and the quest has not moved on."),
    why: field(nullable(T), "The reason given with that call, or with the move."),
    current: field(nullable(shape.yesNo()), "Whether the quest stands on this stage now; null for a quest the story opened, which has no single place to stand."),
  }),
);

const closedRow = shape.named("QuestClosedRow", "How a quest closed: its outcome and the reason given.", shape.object({ outcome: T, why: nullable(T) }));

const record = {
  id: T,
  kind,
  name: T,
  world: field(shape.yesNo(), "The world defines the quest: its labels and conditions are as the world wrote them."),
  objective: field(nullable(T), "What it is."),
  why: field(nullable(T), "Why it matters."),
  stakes: nullable(T),
  rewards: nullable(T),
  stages: shape.list(stageRow),
  who: field(shape.list(T), "Who it involves, as tree refs."),
  where: field(shape.list(T), "Where it takes place, as tree refs."),
  things: field(shape.list(T), "What it involves, as tree refs."),
  closed: field(nullable(closedRow), "How it closed; null while it is open. A quest of the world's standing on an end stage the story never closed is closed as that stage ended it."),
} as const;

const journalRow = shape.named(
  "JournalQuestRow",
  "A quest the player may see, as his journal shows it: whole, with what it is and its stakes, or only its name and the stages the Author showed him.",
  shape.object({ ...record, whole: field(shape.yesNo(), "The player sees the whole quest; false: only its name and the stages named."), thread: field(nullable(T), "The thread of the story it belongs to, for a quest seen whole; never given for one seen by stages.") }),
);
export type JournalQuest = Infer<typeof journalRow>;

export const journalReply = shape.named(
  "Journal",
  "The player's journal: each quest he may see, at the chat's newest turn or as it stood at one of its turns. A quest set to show him nothing is absent: no row, no count.",
  shape.object({ chat: T, turn: field(nullable(shape.turnId()), "The turn read at; null: the chat's newest."), open: field(shape.whole({ least: 0 }), "How many of the quests he may see are open."), quests: shape.list(journalRow) }),
);
export type JournalAnswer = Infer<typeof journalReply>;

const recordRow = shape.named(
  "QuestRecordRow",
  "A quest of the chat as the record holds it, whatever the player may see (the Quests page keeps it behind its spoiler gate): what it is, its stages with their calls, who and where, its stakes, how it was shown to the player and where it came from.",
  shape.object({
    ...record,
    thread: nullable(T),
    visibility: field(nullable(shape.oneOf("public", "known_by", "secret")), "The quest's own visibility; null where it was not said."),
    shown: field(nullable(shape.union(shape.oneOf("all", "none"), shape.list(T))), "What the Author set the player to be shown: all, none, the stages named; null: as the quest's own visibility says."),
    open: shape.yesNo(),
  }),
);
export type QuestRecordRow = Infer<typeof recordRow>;

export const questsReply = shape.named("QuestRecords", "A page of the chat's quests, the world's and those opened in play, in the order they are kept.", shape.page(recordRow));
export type QuestsPage = Infer<typeof questsReply>;

export const questReply = shape.named(
  "QuestRecord",
  "One quest in full: its record, and every write made to it in the order made (the writes of a quest opened in play, and each move of the world's own quest from one stage to another, with how it went and the reason it came with).",
  shape.object({
    quest: recordRow,
    history: shape.list(shape.object({ turn: nullable(shape.turnId()), by: nullable(T), op: T, value: shape.record(shape.json()) })),
  }),
);
export type QuestAnswer = Infer<typeof questReply>;
