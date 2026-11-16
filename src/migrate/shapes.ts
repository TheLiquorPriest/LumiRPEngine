// What the Migration page's route answers (plan §14, §15.5, §15.6), declared field by field. The page reads
// each chat's check, the backup, what waits on the user, the steps of going back, the report as it was
// printed and, of the report, what became of each world in Build. The rest of the report, what was carried
// of each chat and what today's build put in Lumiverse are documents the migration stored as JSON and
// carries as they are: their fields are named here, each as JSON, and the page shows them as the report's
// printed text. The parts the page reads are held to the migration's own types.

import type { OldListed, OldRecord } from "./old-records";
import { type Exactly, type Holds, type Infer, shape } from "../app";
import type { MigrationPage, PageChat, Waiting } from "./page";
import type { MigrationReport } from "./report";

const T = shape.text();
const N = shape.number();
const field = shape.field;
const opt = shape.optional;
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

const chatRow = shape.named(
  "MigrationChatRow",
  "One chat as the last run left it: what came of it and why it was not imported; the turns imported of its own; the messages it shares with the chat it was made from; its check against today's fold (matched at the head and at how many swipes, where it differed, and where its swipes were placed); and what the run carried of it.",
  shape.object({
    chat: T,
    outcome,
    why: nullable(T),
    turns: N,
    shares: nullable(shape.object({ chat: T, messages: N })),
    check: shape.object({
      matched: shape.object({ head: shape.yesNo(), swipes: N, of: N }),
      differences: shape.list(difference),
      placed: shape.object({ own: N, shown: N, lost: N }),
    }),
    carried: field(nullable(json), "What the run that imported it carried of it, over its whole path (a document the migration kept as JSON); null for a chat no run of this build imported."),
  }),
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

const report = shape.named(
  "MigrationReportShown",
  "The last real run's report as the run printed it, whole (counts and checksums, never content): every field is the migration's own document, carried as JSON.",
  shape.object({
    format: json,
    at: json,
    mode: json,
    layout: json,
    database: json,
    rows: json,
    items: json,
    notClassified: json,
    chats: json,
    unreadable: json,
    unsent: json,
    runtime: opt(json),
    given: opt(json),
    standIn: json,
    lumiverse: json,
    disk: json,
    underWay: json,
    imports: json,
    backup: json,
    landed: json,
    carried: json,
    worldsInStore: json,
    identifier: opt(json),
    offRpe: opt(json),
    changes: json,
    refusals: json,
  }),
);

export const migrationReply = shape.named(
  "MigrationReply",
  "The Migration page's data, in one read: the last real run's report and its text as the run printed it; each chat's check, what came of it and what was carried of it; the backup with its checksum, and whether it is still there; what is waiting on the user; the steps of going back with the permissions the previous build asks for; and what today's build put in Lumiverse.",
  shape.object({
    report: field(nullable(report), "Null before any run."),
    text: nullable(T),
    chats: shape.list(chatRow),
    backup: field(nullable(shape.object({ path: T, bytes: N, sha256: T, present: field(shape.yesNo(), "Whether a file of that size is still there.") })), "The backup the last run took before it wrote anything."),
    waiting: field(shape.list(waiting), "In the order the plan lists it: GUIDANCE.md first."),
    goingBack: shape.object({ steps: shape.list(T), permissions: shape.list(T) }),
    lumiverse: field(nullable(json), "What today's build put in Lumiverse, left as it is until the user says they will not go back."),
  }),
);
export type MigrationShown = Infer<typeof migrationReply>;

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
type OutcomeMirrored = Holds<Exactly<Infer<typeof outcome>, PageChat["outcome"]>>;
type WaitingMirrored = Holds<Exactly<Infer<typeof waiting>, Waiting>>;
type BackupMirrored = Holds<Exactly<NonNullable<MigrationShown["backup"]>, NonNullable<MigrationPage["backup"]>>>;
type GoingMirrored = Holds<Exactly<MigrationShown["goingBack"], MigrationPage["goingBack"]>>;
type DifferenceMirrored = Holds<Exactly<Infer<typeof difference>, PageChat["check"]["differences"][number]>>;
type ReportFieldsMirrored = Holds<Exactly<keyof NonNullable<MigrationShown["report"]>, keyof MigrationReport>>;
/** The checks above hold, and are read by no one. */
export type Mirrors = [OutcomeMirrored, WaitingMirrored, BackupMirrored, GoingMirrored, DifferenceMirrored, ReportFieldsMirrored];
type CarriedMirrored = Holds<Exactly<Infer<typeof carriedTurnReply>, OldRecord>>;
type CarriedListMirrored = Holds<Exactly<Infer<typeof carriedTurnsReply>["turns"][number], OldListed>>;
/** The checks of the carried turns' routes, read by no one. */
export type CarriedMirrors = [CarriedMirrored, CarriedListMirrored];
