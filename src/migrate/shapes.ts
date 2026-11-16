// What the Migration page's routes answer (plan §14, §15.5, §15.6; R-327), declared field by field: a summary of the last
// real run and of the page's own rehearsal, the folders a rehearsal reads, the backup, what waits on the user, the swap's
// and going back's steps with the permissions; then, a page at a time, a report's rows, its chats by name with their check,
// a chat's differences and the things it found; the report's printed text; and the report whole, only to be saved as a
// file. What was carried of a chat and what today's build put in Lumiverse are documents the migration stored as JSON and
// carries as they are. Every part the page reads is held to the migration's own types.

import type { OldListed, OldRecord } from "./old-records";
import { type Exactly, type Holds, type Infer, shape } from "../app";
import type { MigrationPage, PageChat, PageChatOne, PageRow, RehearsalShown, ReportSummary, Waiting } from "./page";
import type { Difference, Item } from "./report";

const T = shape.text();
const N = shape.number();
const field = shape.field;
const nullable = shape.nullable;
const json = shape.json();

const outcome = shape.named(
  "ChatImportOutcome",
  "What came of a chat the last run looked at, in the run's own words.",
  shape.oneOf(
    "imported",
    "replaced",
    "played on RPE: left alone",
    "a chat made from it was played on RPE: left alone",
    "gone from Lumiverse: removed",
    "gone from Lumiverse, played on RPE: left alone",
    "gone from Lumiverse, a chat made from it was played on RPE: left alone",
    "not imported",
  ),
);

const difference = shape.named(
  "FoldDifference",
  "Where RPE's fold of a chat differs from today's: at a swipe (its message and number) or at the chat's head; the values that differ, by path; and whether today's state there is kept as the turn's start.",
  shape.object({ at: shape.union(shape.object({ message: T, swipe: N }), shape.literal("head")), turn: shape.turnId(), values: shape.list(T), kept: shape.yesNo() }),
);

const summary = shape.named(
  "MigrationSummaryShown",
  "A migration report in brief: a rehearsal or the real run, when it read today's data, why the real run would not start on it (after a real run: what of it did not balance), how much of each part there is to page through, the disk it takes and the backup a real run took.",
  shape.object({
    mode: shape.oneOf("rehearsal", "real run"),
    at: T,
    refusals: shape.list(T),
    counts: shape.object({ rows: N, chats: N, items: N, notClassified: N, unreadable: N, differences: N, offRpe: N }),
    disk: shape.object({ backup: N, import: N, total: N, free: nullable(N) }),
    backup: nullable(shape.object({ path: T, bytes: N, sha256: T })),
  }),
);

const rehearsalShown = shape.named(
  "RehearsalShown",
  "The rehearsal started from the page, held in memory by the running RPE: none since it started, under way since a time (ms), read (in brief), or failed with why.",
  shape.union(
    shape.object({ state: shape.literal("none") }),
    shape.object({ state: shape.literal("running"), since: N }),
    shape.object({ state: shape.literal("ready"), summary }),
    shape.object({ state: shape.literal("failed"), why: T }),
  ),
);

const waiting = shape.named(
  "WaitingOnUser",
  "One thing the last run left waiting on the user, by what it is.",
  shape.union(
    shape.object({ kind: shape.literal("guidance"), path: T }),
    shape.object({ kind: shape.literal("connection"), setting: T, connection: T }),
    shape.object({ kind: shape.literal("chat"), chat: T, questions: N, staged: N, chips: N, reviewCards: N, rollback: shape.yesNo() }),
    shape.object({ kind: shape.literal("own"), agents: N, skills: N, texts: N }),
    shape.object({ kind: shape.literal("filing"), chat: T, characters: N, notes: shape.yesNo() }),
  ),
);

const folders = shape.object({ configDir: T, dataDir: T });

export const migrationReply = shape.named(
  "MigrationReply",
  "The Migration page's summary: the last real run and the page's rehearsal in brief; the folders a rehearsal reads; the backup with its checksum and whether it is still there; what is waiting on the user; the swap's steps; going back's steps with the permissions the previous build asks for; and what today's build put in Lumiverse. Before any run as after.",
  shape.object({
    run: field(nullable(summary), "Null before any real run."),
    rehearsal: rehearsalShown,
    sources: field(shape.object({ lumiverse: nullable(T), runtime: nullable(folders) }), "The folders a rehearsal from the page reads: the last run's, else Lumiverse's database's folder as RPE's config names it and today's runtime's own."),
    backup: field(nullable(shape.object({ path: T, bytes: N, sha256: T, present: field(shape.yesNo(), "Whether a file of that size is still there.") })), "The backup the last run took before it wrote anything."),
    waiting: field(shape.list(waiting), "In the order the plan lists it: GUIDANCE.md first."),
    swap: shape.list(T),
    goingBack: shape.object({ steps: shape.list(T), permissions: shape.list(T) }),
    lumiverse: field(nullable(json), "What today's build put in Lumiverse, left as it is until the user says they will not go back."),
  }),
);
export type MigrationShown = Infer<typeof migrationReply>;

const ends = shape.object({ found: N, carried: N, attached: N, archived: N, backup: N });

const rowShown = shape.named(
  "MigrationRowShown",
  "A row of the plan's table as a report counts it: what it holds, how it is found, its things' ends (found, carried, attached, archived, kept in the backup only), those with no place and why, their bytes and digest, what it counts inside other rows' things (a document the migration kept as JSON), and after a real run where its things now are.",
  shape.object({
    row: T,
    what: T,
    found: shape.oneOf("own", "inside", "not read"),
    why: shape.optional(T),
    count: ends,
    stranded: nullable(shape.object({ count: N, why: shape.list(T) })),
    bytes: N,
    digest: T,
    inside: nullable(json),
    landed: nullable(T),
  }),
);
export const migrationRowsReply = shape.named("MigrationRowsReply", "A page of a report's rows, in the plan's order.", shape.page(rowShown));

const chatShown = shape.named(
  "MigrationChatShown",
  "One chat of a report: its name in Lumiverse (null where Lumiverse's database can't be read), what today's readers found of it, what the real run did with it and why, its own turns imported, the messages it shares with the chat it was made from, its check (matched at the head and at how many swipes, where its swipes were placed, how many differences), and whether it is still off RPE.",
  shape.object({
    chat: T,
    name: nullable(T),
    engine: nullable(shape.oneOf("classic", "agents", "harness")),
    turns: N,
    replies: N,
    journal: nullable(shape.oneOf("read", "none", "unreadable", "malformed", "from another run of this chat", "not opened")),
    waiting: nullable(shape.object({ questions: N, staged: N, chips: N, reviewCards: N, rollback: shape.yesNo() })),
    outcome: nullable(outcome),
    why: nullable(T),
    imported: N,
    shares: nullable(shape.object({ chat: T, messages: N })),
    check: nullable(shape.object({ matched: shape.object({ head: shape.yesNo(), swipes: N, of: N }), placed: shape.object({ own: N, shown: N, lost: N }), differences: N })),
    offRpe: shape.yesNo(),
  }),
);
export const migrationChatsReply = shape.named("MigrationChatsReply", "A page of a report's chats, in the order the report holds them.", shape.page(chatShown));

export const migrationChatReply = shape.named(
  "MigrationChatReply",
  "One chat of a report in full: as listed, what today's readers found of it (a document the migration kept as JSON), and what the last real run that imported it carried of it.",
  shape.object({ chat: chatShown, read: nullable(json), carried: nullable(json) }),
);

export const migrationDifferencesReply = shape.named("MigrationDifferencesReply", "A page of where a chat's state differed from today's fold, in the order the run checked it.", shape.page(difference));

const itemShown = shape.named(
  "MigrationItemShown",
  "One thing a report found: where it is, its path, its size and SHA-256, its row and fate (null: found, not classified), and the report's note on it.",
  shape.object({ where: shape.oneOf("user storage", "extension storage", "runtime", "Lumiverse database"), path: T, bytes: N, sha256: T, row: nullable(T), fate: nullable(shape.oneOf("carried", "attached", "archived")), note: shape.optional(T) }),
);
export const migrationItemsReply = shape.named("MigrationItemsReply", "A page of the things a report found, in the order it found them.", shape.page(itemShown));

export const migrationTextReply = shape.named("MigrationTextReply", "A report's printed text, as the rehearsal or the run printed it.", shape.object({ text: T }));

export const migrationFileReply = shape.named(
  "MigrationFileReply",
  "A report whole, to be saved as a file: the name to save it under, the report (a document the migration made, as JSON: counts, paths and checksums, never content) and its printed text.",
  shape.object({ name: T, report: json, text: T }),
);

export const rehearsalBody = shape.named(
  "RehearsalAsk",
  "Where a rehearsal from the page reads today's data: Lumiverse's data folder (the one holding lumiverse.db), and today's runtime's two folders, or none where the server runs no runtime of today's build. Left out: the folders the page's summary gives.",
  shape.object({ lumiverse: shape.optional(T), runtime: shape.optional(nullable(folders)) }),
);

export const rehearsalReply = shape.named("RehearsalReply", "The rehearsal started from the page, once read: its report in brief, which the page then reads a page at a time.", shape.object({ summary }));

const oldText = shape.named(
  "CarriedText",
  "One text an old engine's record of a reply names, kept word for word beside its turn: the part of the record that names it, where it was in today's user storage, and its words (null where today's clean-up had removed it).",
  shape.object({ part: T, path: T, text: nullable(T) }),
);

const oldEngine = shape.oneOf("classic", "agents", "harness");

export const carriedTurnReply = shape.named(
  "CarriedTurnReply",
  "What an old engine recorded on a reply the migration carried, for the reply's Turn page: the engine that played the chat, each part of the record by name, every text it names, why the reply stood with no turn played, and each line where it says something against its turn.",
  shape.object({
    turn: shape.turnId(),
    chat: T,
    message: T,
    swipe: N,
    engine: field(nullable(oldEngine), "The engine that played the chat as today's build had it; null where it was not read."),
    fields: field(shape.list(shape.object({ name: T, value: json })), "The record's parts that hold what an old engine recorded (session, agents, memoryNext, finalEdits, finalParts, prompts, diag, harness), by name, as they were."),
    texts: shape.list(oldText),
    unplayed: field(nullable(T), "Why the reply stood with no turn played (stopped, failed, restarted); null where a turn was played."),
    departures: field(shape.list(T), "Each line where the reply says something against what its turn decided."),
  }),
);

export const carriedTurnsReply = shape.named(
  "CarriedTurnsReply",
  "A page of a migrated chat's carried turns, in the order the run imported them: each tied to its message and swipe, with the engine that played it, why it stood unplayed, how many departures and texts it holds. `more` says whether turns follow.",
  shape.object({
    turns: shape.list(shape.object({ turn: shape.turnId(), message: T, swipe: N, engine: nullable(oldEngine), unplayed: nullable(T), departures: N, texts: N })),
    total: N,
    more: shape.yesNo(),
  }),
);

// The parts the page reads, held to the migration's own types.
type OutcomeMirrored = Holds<Exactly<Infer<typeof outcome>, NonNullable<PageChat["outcome"]>>>;
type WaitingMirrored = Holds<Exactly<Infer<typeof waiting>, Waiting>>;
type PageMirrored = Holds<Exactly<Omit<MigrationShown, "lumiverse">, Omit<MigrationPage, "lumiverse">>>;
type SummaryMirrored = Holds<Exactly<Infer<typeof summary>, ReportSummary>>;
type RehearsalMirrored = Holds<Exactly<Infer<typeof rehearsalShown>, RehearsalShown>>;
type ChatMirrored = Holds<Exactly<Infer<typeof chatShown>, PageChat>>;
type DifferenceMirrored = Holds<Exactly<Infer<typeof difference>, Difference>>;
type ItemMirrored = Holds<Exactly<keyof Infer<typeof itemShown>, keyof Item>>;
type RowFieldsMirrored = Holds<Exactly<keyof Infer<typeof rowShown>, keyof PageRow>>;
type ChatOneMirrored = Holds<Exactly<Infer<typeof migrationChatReply>["chat"], Omit<PageChatOne, "read" | "carried">>>;
/** The checks above hold, and are read by no one. */
export type Mirrors = [OutcomeMirrored, WaitingMirrored, PageMirrored, SummaryMirrored, RehearsalMirrored, ChatMirrored, DifferenceMirrored, ItemMirrored, RowFieldsMirrored, ChatOneMirrored];
type CarriedMirrored = Holds<Exactly<Infer<typeof carriedTurnReply>, OldRecord>>;
type CarriedListMirrored = Holds<Exactly<Infer<typeof carriedTurnsReply>["turns"][number], OldListed>>;
/** The checks of the carried turns' routes, read by no one. */
export type CarriedMirrors = [CarriedMirrored, CarriedListMirrored];
