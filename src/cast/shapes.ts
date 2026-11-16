// What the Cast page's routes take and answer (plan §7, §14), declared field by field so that the pages'
// types and the API reference say what a page sends and is sent. The parts of a character's record, the
// castings and the base's documents are the record's own lists (`./record.ts`), and each declaration is
// held to them, so that a part added there stops this compiling until the declaration says so.

import { type Exactly, type Holds, type Infer, shape } from "../app";
import type { Tier } from "./memory";
import { REACHES } from "./perceive";
import { type BasePart, BASE_PARTS, CASTINGS, type Casting, ROW_PARTS, type RowPart, SOURCE_KINDS, type SourceKind } from "./record";

const T = shape.text();
const N = shape.number();
const field = shape.field;
const nullable = shape.nullable;

const castRole = shape.named("CastRole", "How large a part a character plays.", shape.oneOf(...CASTINGS));
const memoryBand = shape.named("MemoryBand", "A memory's tier: top of mind, short term, long term.", shape.oneOf("top", "short", "long"));
const baseDocument = shape.named("BaseDocument", "The base's four documents.", shape.oneOf(...BASE_PARTS));
const sourceBindingKind = shape.named("SourceBindingKind", "What a source bound to a character points at.", shape.oneOf(...SOURCE_KINDS));
const entryPart = shape.named("EntryPart", "The parts of a character's record kept as rows tied to turns, the casting aside.", shape.oneOf(...ROW_PARTS.filter((p): p is Exclude<RowPart, "casting"> => p !== "casting")));
type RoleMirrored = Holds<Exactly<Infer<typeof castRole>, Casting>>;
type BandMirrored = Holds<Exactly<Infer<typeof memoryBand>, Tier>>;
type DocumentMirrored = Holds<Exactly<Infer<typeof baseDocument>, BasePart>>;
type BindingMirrored = Holds<Exactly<Infer<typeof sourceBindingKind>, SourceKind>>;
type PartMirrored = Holds<Exactly<Infer<typeof entryPart>, Exclude<RowPart, "casting">>>;

const entryCount = shape.named("EntryCount", "How many entries of a kind a character holds on the path read: standing, and struck.", shape.object({ held: N, struck: N }));
const counts = shape.named(
  "EntryCounts",
  "Each kind's counts; the carried mind files with how many of those standing are marked filed.",
  shape.object({
    growth: entryCount,
    mind: entryCount,
    memories: entryCount,
    relationships: entryCount,
    knowledge: entryCount,
    history: entryCount,
    perceptions: entryCount,
    files: shape.object({ held: N, struck: N, filed: field(N, "How many of those standing are marked filed.") }),
  }),
);
/** How many entries of a kind a character holds on the reading's path: standing, and struck. */
export type CastHeld = Infer<typeof entryCount>;
export type CastCounts = Infer<typeof counts>;
/** The parts of a character's record that hold entries, as the page names them. */
export type CastKind = keyof CastCounts;

const castingRow = shape.named(
  "CastingRow",
  "A casting in force: the player's pin, else the Author's; with the Author's line for the character, where it wrote one.",
  shape.object({ as: castRole, pinned: field(shape.yesNo(), "The player pinned it; it stands over the Author's."), line: nullable(T) }),
);
export type CastingShown = Infer<typeof castingRow>;

const memberRow = shape.named(
  "CastMemberRow",
  "A character as the cast lists it: its casting (null: none yet), where its record came from (carried by a migration, played on RPE), and its counts.",
  shape.object({
    id: T,
    name: T,
    chat: field(T, "The chat it was first cast in: this chat, or one this chat was branched from."),
    casting: field(nullable(castingRow), "Its casting at the reading; null when it has none there (in the cast, not yet cast)."),
    from: field(shape.object({ carried: shape.yesNo(), played: shape.yesNo() }), "Where its record on the path came from: writes on turns a migration's import wrote (carried), and writes on turns RPE played."),
    counts,
  }),
);
export type CastMemberShown = Infer<typeof memberRow>;

export const castReply = shape.named(
  "CastReply",
  "Every character the chat knows, with what each holds on the path read; `turn` null: at the chat's newest.",
  shape.object({
    chat: T,
    turn: field(nullable(shape.turnId()), "The turn read at; null: the chat's newest."),
    characters: field(shape.list(memberRow), "In the order they were made: this chat's, and those of the chats it was branched from."),
  }),
);
export type CastList = Infer<typeof castReply>;

const writeRow = shape.named(
  "EntryWriteRow",
  "One write of an entry, as the record keeps it: its turn, that turn's reply on the path (null: on none), whether a migration wrote that turn, who wrote it, and what it said.",
  shape.object({
    turn: field(nullable(shape.turnId()), "The turn that wrote it; null for the player's own change, of no turn, placed after the newest reply."),
    message: field(nullable(N), "The number of that turn's reply on the chat's path, from 0; null while the turn is on no path (open, or left behind)."),
    imported: field(shape.yesNo(), "That turn was written by a migration's import, not played on RPE."),
    by: field(nullable(T), "Who wrote it: an agent's definition (`author`, a character's own), `player`, or the migration."),
    wrote: field(shape.record(shape.json()), "What it said: the fields it set, `drop` among them."),
  }),
);
export type CastWriteShown = Infer<typeof writeRow>;

const entryFields = {
  id: T,
  part: entryPart,
  fields: field(shape.record(shape.json()), "Every field its writes set, the latest of each: its words among them, as they were written."),
  date: field(nullable(T), "Story time of its first write, as the engine shows a time; null where the chat keeps none."),
  turn: field(nullable(shape.turnId()), "Its first write: the turn; null where the player wrote it, his own change of no turn, placed after the newest reply."),
  message: field(nullable(N), "That turn's reply on the path."),
  imported: field(shape.yesNo(), "Whether a migration's import wrote that turn."),
  by: field(nullable(T), "Who wrote it."),
  struck: shape.yesNo(),
  writes: field(shape.list(writeRow), "Every write of it on the path, oldest first."),
} as const;
const entryRow = shape.named("EntryRow", "An entry of a character's record as it stands on the path read: its fields, story time of its first write, its first write, whether it is struck, and every write of it.", shape.object(entryFields));
export type CastEntryShown = Infer<typeof entryRow>;

const memoryRow = shape.named(
  "MemoryRow",
  "A memory, with its tier, strength (0 to 1) and whether it has faded to its gist, at story time at the reading (none while struck).",
  shape.object({ ...entryFields, tier: nullable(memoryBand), strength: nullable(N), faint: shape.yesNo() }),
);
export type CastMemoryShown = Infer<typeof memoryRow>;

const perceptionRow = shape.named("PerceptionRow", "A perception, with the turn it is of and that turn's reply.", shape.object({ ...entryFields, of: shape.object({ turn: shape.turnId(), message: nullable(N) }) }));
export type CastPerceptionShown = Infer<typeof perceptionRow>;

const mindFileRow = shape.named(
  "MindFileRow",
  "A mind file a migration carried, word for word (null: its row holds no text), with its filed mark.",
  shape.object({ ...entryFields, file: T, text: field(nullable(T), "The file's text as carried, every byte; null where its row holds none."), filed: shape.yesNo() }),
);
export type CastFileShown = Infer<typeof mindFileRow>;

const baseVersionRow = shape.named(
  "BaseVersionRow",
  "A version of a part of the base; `standing` marks the one in force (it stands outside turns: a swipe changes none of it).",
  shape.object({ part: baseDocument, version: N, text: T, standing: field(shape.yesNo(), "The newest version of its part: the one in force."), turn: field(nullable(shape.turnId()), "The turn it was written in; null when written outside one."), by: nullable(T), created: N }),
);
export type CastBaseShown = Infer<typeof baseVersionRow>;

const sourceBindingRow = shape.named(
  "SourceBindingRow",
  "A source bound to the character, as recorded (the text stays in Lumiverse).",
  shape.object({ kind: sourceBindingKind, ref: T, defines: field(nullable(T), "Which side of the character it defines, in the binder's words."), created: N }),
);
export type CastSourceShown = Infer<typeof sourceBindingRow>;

export const characterReply = shape.named(
  "CharacterReply",
  "Everything on one character's record, by kind; `turn` null: at the chat's newest.",
  shape.object({
    chat: T,
    turn: nullable(shape.turnId()),
    character: memberRow,
    sources: shape.list(sourceBindingRow),
    base: field(shape.list(baseVersionRow), "Every version of every part of the base, oldest first."),
    castings: field(shape.list(writeRow), "The Author's castings of it on the path, oldest first."),
    growth: shape.list(entryRow),
    mind: field(shape.list(entryRow), "What is on its mind; the carried mind files are under `files`."),
    memories: shape.list(memoryRow),
    relationships: shape.list(entryRow),
    knowledge: shape.list(entryRow),
    history: shape.list(entryRow),
    perceptions: shape.list(perceptionRow),
    files: shape.list(mindFileRow),
  }),
);
export type CastCharacter = Infer<typeof characterReply>;

export const castStrikeBody = shape.named(
  "CastStrikeAsk",
  "An entry of the character's record, by id, struck (true) or its strike taken back (false); with a strike, why, where the player says.",
  shape.object({ id: shape.text({ blank: false }), struck: shape.yesNo(), why: shape.optional(shape.nullable(T)) }),
);
export type CastStrike = Infer<typeof castStrikeBody>;

export const castStrikeReply = shape.named(
  "CastStrikeReply",
  "What a strike, or taking one back, did: whether anything was recorded, the entry now, the knowledge struck with it, the secrets let go; for a strike taken back, the knowledge standing again with it and the secrets held again; and what it could not do, in the cast's words.",
  shape.object({
    changed: field(shape.yesNo(), "Whether anything was recorded: false when the entry already stood so."),
    entry: field(entryRow, "The entry as it stands now, at the chat's newest turn."),
    alsoStruck: field(shape.list(T), "The knowledge a struck perception gave, struck with it, by id."),
    letGo: field(shape.list(T), "The secrets whose holding the strike took back, by their fact's id."),
    alsoStood: field(shape.list(T), "A perception's strike taken back: the knowledge its strike struck with it, standing again with it, by id."),
    heldAgain: field(shape.list(T), "A strike taken back: the secrets the knowledge standing again gives, held again, by their fact's id."),
    notes: field(shape.list(T), "What it could not do, and what it left as it was (knowledge struck apart, and the secret it gave), in the cast's words."),
  }),
);
export type CastStruck = Infer<typeof castStrikeReply>;

const stageReading = shape.named("StageReading", "How a turn's stage was read: from the open scene and who the state places in its place (scene), from where the owner's character stands when no scene was recorded (owner), or not recorded at all (none).", shape.oneOf("scene", "owner", "none"));

const stagePerson = shape.named(
  "StagePerson",
  "Someone on stage at a turn, by the name the stage gives; the character the cast holds by that name (null: it holds none) with its casting; and the perceptions of that turn it has, by id, struck ones left out: none listed is a gap.",
  shape.object({ name: T, character: field(nullable(T), "The cast's character of that name; null where the cast holds none."), casting: field(nullable(castRole), "Its casting in force at the turn; null: none."), perceptions: shape.list(T) }),
);
export type StagePersonShown = Infer<typeof stagePerson>;

const stageTurn = shape.named(
  "StageTurn",
  "One turn of the perception record: who was on stage, how the stage was read, and each one's perceptions of that turn or none.",
  shape.object({ turn: shape.turnId(), message: field(nullable(N), "That turn's reply on the chat's path, from 0; null where it is on none."), read: stageReading, people: shape.list(stagePerson) }),
);
export type StageTurnShown = Infer<typeof stageTurn>;

export const perceptionRecordReply = shape.named(
  "PerceptionRecordReply",
  "The perception record of a turn or a stretch of turns ending at it, oldest first: for each, who was on stage with how that was read, and which of them have a perception of it.",
  shape.object({ chat: T, turns: shape.list(stageTurn) }),
);
export type PerceptionRecord = Infer<typeof perceptionRecordReply>;

export const perceptionBody = shape.named(
  "PerceptionAsk",
  "A perception the player writes, corrects or strikes for a character: with `id` it corrects (or, with `drop`, strikes) that one; without, it writes a new one of the turn named (`turn`), else of the chat's newest. `knows` as an empty list says the character now knows nothing from it. His own change, placed after the newest reply.",
  shape.object({
    id: shape.optional(shape.text({ blank: false })),
    turn: shape.optional(shape.turnId(), "The turn the perception is of; left out, the chat's newest."),
    reach: shape.optional(shape.oneOf(...REACHES)),
    moment: shape.optional(T),
    content: shape.optional(T),
    missed: shape.optional(T),
    knows: shape.optional(shape.list(T)),
    told_by: shape.optional(T),
    reliability: shape.optional(T),
    drop: shape.optional(shape.yesNo()),
    why: shape.optional(T),
  }),
);
export type CastPerceptionAsk = Infer<typeof perceptionBody>;

export const perceptionWrittenReply = shape.named(
  "PerceptionWrittenReply",
  "What writing, correcting or striking a perception did: its id, the knowledge it gave, written now, the knowledge struck with it, the secrets let go, and what could not be done, in the cast's words.",
  shape.object({
    id: field(nullable(T), "The perception's id; null where nothing was written."),
    entry: field(nullable(perceptionRow), "The perception as it stands now at the chat's newest."),
    knowledge: field(shape.list(T), "The knowledge written with it, by id."),
    struck: field(shape.list(T), "The knowledge struck with it, by id."),
    letGo: field(shape.list(T), "The secrets whose holding it let go."),
    notes: field(shape.list(T), "What it left out or could not do, in the cast's words."),
  }),
);
export type CastPerceptionWritten = Infer<typeof perceptionWrittenReply>;

/** The checks above hold, and are read by no one. */
export type Mirrors = [RoleMirrored, BandMirrored, DocumentMirrored, BindingMirrored, PartMirrored];
