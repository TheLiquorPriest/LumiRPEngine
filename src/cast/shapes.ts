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
    person: field(nullable(T), "The world's person it is, by the entity's id; null where none is known."),
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

const sourceFreshness = shape.named(
  "SourceFreshness",
  "A bound source read now in Lumiverse against the base: current; changed since the base was last drawn from it; unseen (bound after, or never drawn from); gone from Lumiverse; or unread (Lumiverse could not be asked).",
  shape.oneOf("current", "changed", "unseen", "gone", "unread"),
);
export type CastSourceFreshness = Infer<typeof sourceFreshness>;

const sourceBindingRow = shape.named(
  "SourceBindingRow",
  "A source bound to the character, as recorded (the text stays in Lumiverse), with its title as Lumiverse holds it now and how it stands against the base.",
  shape.object({ kind: sourceBindingKind, ref: T, defines: field(nullable(T), "Which side of the character it defines, in the binder's words."), created: N, title: field(nullable(T), "Its name or title in Lumiverse now; null when gone or unread."), state: sourceFreshness }),
);
export type CastSourceShown = Infer<typeof sourceBindingRow>;

const boundedFields = { total: field(N, "How many the record holds in all."), before: field(N, "How many older ones are left out before what is given."), after: field(N, "How many newer ones are left out after it.") } as const;
const entryItems = shape.named("EntryItems", "A list of entries, bounded: the newest the setting cast.queryItems allows after passing over `skip`, with what was left out on either side.", shape.object({ items: shape.list(entryRow), ...boundedFields }));
const memoryItems = shape.named("MemoryItems", "A list of memories, bounded as the entries are.", shape.object({ items: shape.list(memoryRow), ...boundedFields }));
const perceptionItems = shape.named("PerceptionItems", "A list of perceptions, bounded as the entries are.", shape.object({ items: shape.list(perceptionRow), ...boundedFields }));
const fileItems = shape.named("MindFileItems", "A list of carried mind files, bounded as the entries are.", shape.object({ items: shape.list(mindFileRow), ...boundedFields }));

const growthOver = shape.named(
  "GrowthOverBase",
  "A change a reflection proposed and the Author accepted, laid over the base: its words, what caused it, and its date in story time.",
  shape.object({ id: T, text: T, cause: nullable(T), date: nullable(T) }),
);

const baseNow = shape.named(
  "BaseNow",
  "The base as it stands, each document in its newest version, with the accepted growth laid over it (growth is layered over the base wherever the base is shown).",
  shape.object({ parts: shape.list(shape.object({ part: baseDocument, version: N, text: T })), growth: shape.list(growthOver) }),
);

export const characterReply = shape.named(
  "CharacterReply",
  "Everything on one character's record, by kind; `turn` null: at the chat's newest. Each list is bounded by cast.queryItems and read further back with `part` and `skip`.",
  shape.object({
    chat: T,
    turn: nullable(shape.turnId()),
    listed: field(N, "The most items of one list this answer gives (the setting cast.queryItems)."),
    character: memberRow,
    sources: field(shape.list(sourceBindingRow), "Each source bound to it, read live: its title now and how it stands against the base."),
    base: field(shape.list(baseVersionRow), "Every version of every part of the base, oldest first."),
    now: baseNow,
    castings: field(shape.list(writeRow), "The Author's castings of it on the path, oldest first."),
    away: field(nullable(entryRow), "While a principal is away: its whereabouts and intention as the Author recorded them (the entry's fields); null otherwise."),
    game: field(nullable(shape.record(shape.json())), "Its game side by reference to the world's person it is: where it is, what it holds, what it owns elsewhere, its values; null where the store holds no such person."),
    growth: entryItems,
    mind: field(entryItems, "What is on its mind; the carried mind files are under `files`."),
    memories: memoryItems,
    relationships: entryItems,
    knowledge: entryItems,
    history: entryItems,
    perceptions: perceptionItems,
    files: fileItems,
  }),
);
export type CastCharacter = Infer<typeof characterReply>;

/** The lists of a character's record the page reads further back: by the name each has in the answer. */
export const CHARACTER_LISTS = ["growth", "mind", "memories", "relationships", "knowledge", "history", "perceptions", "files"] as const;
export type CharacterList = (typeof CHARACTER_LISTS)[number];
export const characterListName = shape.named("CharacterListName", "The lists of a character's record the answer bounds.", shape.oneOf(...CHARACTER_LISTS));

export const castingBody = shape.named(
  "CastingAsk",
  "The owner sets how large a part a character plays. `as` names the casting; `pin` true pins it, so it stands over the Author's (a casting of his own from then on, until he takes the pin away); false sets it as his casting alone, which the Author may change next turn, and takes any pin away. `as` null with `pin` false takes the pin away and leaves the casting as it is. `line` is the line of the character's part, where he gives one.",
  shape.object({ as: nullable(castRole), pin: shape.yesNo(), line: shape.optional(nullable(T)) }),
);
export type CastingAsk = Infer<typeof castingBody>;

export const baseBody = shape.named(
  "BaseAsk",
  "The owner redraws documents of a character's base: each document given is written as the next version of its part, outside any turn; the others stand as they are.",
  shape.object({ seed: shape.optional(T), soul: shape.optional(T), inner_voice: shape.optional(T), background: shape.optional(T) }),
);
export type CastBaseAsk = Infer<typeof baseBody>;

export const sourceBody = shape.named(
  "SourceAsk",
  "The owner binds a source to a character, says again which side of it a bound source defines (`defines`; null: none), or takes the binding away (`drop`). A card, a persona, a memory entity or a lore entry Lumiverse does not hold is refused.",
  shape.object({ kind: sourceBindingKind, ref: shape.text({ blank: false }), defines: shape.optional(nullable(T)), drop: shape.optional(shape.yesNo()) }),
);
export type CastSourceAsk = Infer<typeof sourceBody>;

export const personBody = shape.named(
  "PersonAsk",
  "The owner says which of the world's people a character is, by the person's id or name; null takes the reference away.",
  shape.object({ person: nullable(shape.text({ blank: false })) }),
);
export type CastPersonAsk = Infer<typeof personBody>;

export const castEditedReply = shape.named(
  "CastEditedReply",
  "What the owner's edit of a character did: whether anything changed, the character as the cast lists it now, and what it could not do or left as it was, in the cast's words. The edit is his own change, which the Author is told of in the next briefing.",
  shape.object({ changed: field(shape.yesNo(), "False when the character already stood so."), character: memberRow, notes: shape.list(T) }),
);
export type CastEdited = Infer<typeof castEditedReply>;

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
  "Someone on stage at a turn, by the name the stage gives; the character the cast holds by that name (null: it holds none) with its casting; the perceptions of that turn it has, by id, struck ones left out: none listed is a gap on a turn RPE played; and, on a turn a migration carried, the old mind files carried with that character.",
  shape.object({
    name: T,
    character: field(nullable(T), "The cast's character of that name; null where the cast holds none."),
    casting: field(nullable(castRole), "Its casting in force at the turn; null: none."),
    perceptions: shape.list(T),
    files: field(shape.list(shape.object({ name: T, filed: shape.yesNo() })), "On a turn a migration carried: the old mind files carried with the character, by name (`minds` for the older minds pack's notes), each with whether it is marked filed; none on a turn RPE played."),
  }),
);
export type StagePersonShown = Infer<typeof stagePerson>;

const stageTurn = shape.named(
  "StageTurn",
  "One turn of the perception record: who was on stage, how the stage was read, and each one's perceptions of that turn or none; for a turn a migration carried, that the previous build played it, which owes no perception of RPE's, and the mind files carried with each.",
  shape.object({
    turn: shape.turnId(),
    message: field(nullable(N), "That turn's reply on the chat's path, from 0; null where it is on none."),
    carried: field(shape.yesNo(), "True for a turn a migration carried, which the previous build played: it owes no perception, and what its characters took from it is in the mind files carried with them."),
    read: stageReading,
    people: shape.list(stagePerson),
  }),
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
