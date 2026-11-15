// What the turn lane's routes answer (plan §14): each reply declared field by field, so the generated
// types and the API reference say what a page is sent, and each held to the turn lane's own type (or
// the store's, for the world's tree) so that a change to one stops this compiling until the declaration
// says the same. Written once here, read by the routes (`routes.ts`) and by every page through the
// generated types.

import type { FindStopped } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, jobView, limitHit, type Mutually, replyError, shape, traceRecord, usage } from "../app";
import type { NodeView, ValuesShown } from "../store";
import type { PanelRequest } from "./player";
import type { RunKind, RunState, StoppedBy } from "./runs";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const field = shape.field;
const nullable = shape.nullable;

// ---------------------------------------------------------------- chats and turns

const runKind = shape.named("TurnRunKind", "A run's kind: the kind of turn Lumiverse asked for, or a Settle now run, where the player asked the Author to settle an edit now and nothing is written to the chat.", shape.oneOf("new", "swipe", "regenerate", "continue", "impersonate", "settle"));
type RunKindMirrored = Holds<Exactly<Infer<typeof runKind>, RunKind>>;

const runState = shape.named("TurnState", "Where a turn or a run stands: running, or how it ended.", shape.oneOf("running", "released", "no-reply", "stopped", "limit", "failed"));
type RunStateMirrored = Holds<Exactly<Infer<typeof runState>, RunState>>;

const span = shape.named("Span", "A stretch of a model's own writing, in milliseconds since 1970: from its first token to its last; `to` null while it began and has not ended (a run stopped inside it).", shape.object({ from: N, to: nullable(N) }));

const stoppedBy = shape.named(
  "StoppedBy",
  "What stopped a run where it stood, its reply going out with what it had: one of RPH's limits (calls, tokens, time), or the hold of a reply asked for whole, in milliseconds from the request's arrival.",
  shape.union(shape.object({ limit: limitHit }), shape.object({ hold: N })),
);
type StoppedByMirrored = Holds<Exactly<Infer<typeof stoppedBy>, StoppedBy>>;

const moments = shape.named(
  "TurnMoments",
  "When a turn's moments happened, in milliseconds since 1970; null for one that has not happened.",
  shape.object({
    received: field(N, "The request reached RPE."),
    started: field(nullable(N), "The lead's run began, after intake and any wait for the turn before it."),
    firstWord: field(nullable(N), "The reply's first words went to the chat."),
    released: field(nullable(N), "The reply was released (plan §10.7)."),
    ended: field(nullable(N), "The lead's run ended; it can go on after the release (plan §10.9)."),
    intent: field(nullable(span), "The intent record's own time, its first token to its last; null when none began; to null when it began and did not end."),
    thinking: field(shape.list(span), "Each span of thinking before a model call's first output on the reply's path, in call order; none when no call thought."),
  }),
);

const replySoFar = shape.named("ReplySoFar", "What a run sent to the chat: the reply's text, and the progress lines of its thinking block.", shape.object({ text: T, progress: shape.list(T) }));

/** What a chat's list and a turn's own route both tell of it. */
const rowFields = {
  id: shape.turnId(),
  kind: runKind,
  onPath: field(shape.yesNo(), "On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted."),
  message: field(nullable(T), "The Lumiverse message it is tied to (plan §10.8); null until it is."),
  status: runState,
  timings: moments,
  usage: field(usage, "Every agent of its run together: model calls and tokens."),
} as const;

export const chatsReply = shape.named(
  "ChatsReply",
  "The chats of the user RPE belongs to, the most recently played first, then those its store holds that it has not played.",
  shape.object({
    chats: shape.list(
      shape.named(
        "ChatRow",
        "A chat RPE plays, as the web shell lists them.",
        shape.object({
          id: T,
          name: field(T, "The chat's name in Lumiverse."),
          lastTurnAt: field(nullable(N), "When its newest turn on RPE began; null for a chat RPE holds and has not played yet (one a migration imported)."),
          running: field(shape.yesNo(), "Whether a turn of it runs now."),
          played: field(shape.yesNo(), "Whether RPE has played a turn of it."),
          world: field(shape.yesNo(), "Whether RPE's store has a world for it."),
        }),
      ),
    ),
  }),
);

const turnRow = shape.named("TurnRow", "A turn as a chat's list shows it.", shape.object(rowFields));
export const turnsReply = shape.named("TurnsReply", "A chat's turns, newest first.", shape.object({ turns: shape.list(turnRow), more: field(shape.yesNo(), "Older turns remain.") }));

const runShown = shape.named(
  "RunShown",
  "One run of a turn: its first, or a continue of it, which runs the turn again under a run id of its own; or a Settle now run on it.",
  shape.object({
    id: field(T, "RPE's own id for it."),
    run: field(nullable(T), "RPH's own id for it, which its trace records carry as their `run`; null before its first record."),
    nth: field(N, "Its place among the turn's runs, from 1."),
    kind: runKind,
    status: runState,
    timings: moments,
    usage,
    reply: field(replySoFar, "What this run sent to the chat."),
    error: field(nullable(replyError), "Why the reply failed, when it did."),
    stoppedBy: field(nullable(stoppedBy), "What stopped it where it stood; null for neither a limit nor the hold."),
    lastText: field(shape.yesNo(), "What went out as its reply is the Author's last plain text, sent by the setting `reply.lastText` in place of the error line."),
    trace: field(shape.list(traceRecord), "Its own trace records, numbered from 1 within the run, as far as the read reaches (the turn's `trace`)."),
    requests: field(
      shape.list(shape.object({ agent: T, definition: T, call: N, file: T })),
      "The files of the turn's folder that hold its model calls' requests as sent, where the harness kept them: by agent and call, each named by its path below the folder.",
    ),
  }),
);
export type RunView = Infer<typeof runShown>;

export const turnReply = shape.named(
  "TurnReply",
  "One turn, read on from where a page has read to, and each of its runs.",
  shape.object({
    ...rowFields,
    chat: T,
    intent: field(nullable(T), "The lead's intent record as it was written (plan §10.3); null when it wrote none. Shown behind the spoiler gate."),
    reply: field(replySoFar, "What its latest run sent to the chat so far."),
    error: field(nullable(replyError), "Why the reply failed, when it did."),
    trace: field(shape.list(traceRecord), "Its runs' events as far as the read reaches, in order: of the run asked for (the turn's first when none), those numbered `from` on; and every record of each run that began after it."),
    lore: field(
      shape.object({ activated: shape.list(T), map: shape.list(T) }),
      "The lore of the turn's prompt, by id, as its intake kept it: the entries Lumiverse activated for it (Lumiverse's ids), and the entries its lore map showed the Author (RPE's ids, as the map writes them).",
    ),
    runs: field(shape.list(runShown), "Each of its runs, the first first."),
  }),
);

export const stopReply = shape.named("StopReply", "True when the turn was running and is being stopped, false when it had already ended.", shape.object({ stopped: shape.yesNo() }));

const folderEntry = shape.named("FolderEntry", "One entry of a turn's folder: its path below the folder, its size (a folder's is what its files hold), and whether it is a folder.", shape.object({ name: T, bytes: N, folder: shape.yesNo() }));
export type TurnFileEntry = Infer<typeof folderEntry>;
const findStopped = shape.named(
  "FindStopped",
  "Why the file host stopped before it had looked everywhere, each way it did with its counts: at the cap on hits with more there, past files too large to search, at lines cut to a length, or out of time.",
  shape.object({
    limit: opt(shape.object({ max: N }), "The hits reached `max`, the host's own cap, and more were there."),
    large: opt(shape.object({ files: N, bytes: N }), "A search passed over `files` files larger than `bytes` bytes."),
    cut: opt(shape.object({ lines: N, chars: N }), "A search cut `lines` of the lines it gave to `chars` characters each."),
    time: opt(shape.object({ ms: N }), "It ran out of the `ms` milliseconds it was given."),
  }),
);
type FindStoppedMirrored = Holds<Exactly<Infer<typeof findStopped>, FindStopped>>;
export const folderReply = shape.named(
  "FolderReply",
  "The whole of a turn's folder, every level down; none for a turn that has no folder. Where the file host stopped short of the whole folder, what it found, and how it stopped.",
  shape.object({ files: shape.list(folderEntry), stopped: opt(findStopped, "How the file host stopped short of the whole folder; absent when it listed it all.") }),
);
export const fileReply = shape.named("FileReply", "One file of a turn's folder, by its path below the folder, as text.", shape.object({ name: T, text: T }));

export const settleReply = shape.named("SettleReply", "The newest turn, and the Settle now run begun on it.", shape.object({ turn: shape.turnId(), run: T }));

export const panelRequestHeld = shape.named("PanelRequestHeld", "A request a panel made, held as part of the player's next message: what was pressed, and what it was pressed on.", shape.object({ id: T, what: T, on: nullable(T), at: N }));
type PanelMirrored = Holds<Exactly<Infer<typeof panelRequestHeld>, PanelRequest>>;
export const panelRequestReply = shape.object({ request: panelRequestHeld });
export const panelRequestBody = shape.named(
  "PanelRequestAsk",
  "A panel's request: what was pressed, and what it was pressed on, where it was pressed on something.",
  shape.object({ what: shape.text({ blank: false }), on: opt(nullable(T), "What it was pressed on; left out, null or blank, nothing.") }),
);

// ---------------------------------------------------------------- jobs

export const jobsReply = shape.named("JobsReply", "The user's jobs (of every chat, or of one) as RPH last kept each, the newest started first.", shape.object({ jobs: shape.list(jobView) }));
export const jobCancelReply = shape.named("JobCancelReply", "The job as it stands after the cancel; one that had already ended comes back as it ended.", shape.object({ job: jobView }));

// ---------------------------------------------------------------- the world (the store's tree, plan §6.4, §6.6)

const precision = shape.named("FactPrecision", "How exact a value or a fact is.", shape.oneOf("exact", "approximate", "vague", "unknown"));
const standing = shape.named("FactStanding", "How sure a value or a fact is.", shape.oneOf("established", "proposed", "assumed"));
const source = shape.named("FactSource", "Where a value or a fact came from.", shape.oneOf("prose", "lore", "author", "gm", "character", "player", "import", "default", "invented"));

const levelKind = shape.named("LevelKind", "What a level of the world's tree is: the world, a place, an entity, or one of the two levels the tree adds (the groups, and what is elsewhere).", shape.oneOf("world", "place", "entity", "groups", "elsewhere"));
const levelMark = shape.named(
  "LevelMark",
  "The change that last wrote a value: its turn, by id and by its number on the chat's path, and how exact, how sure and from where.",
  shape.object({ turn: shape.turnId(), n: N, precision: nullable(precision), standing: nullable(standing), source: nullable(source) }),
);
const levelValue = shape.named(
  "LevelValue",
  "One value of a level: its key, its value as text (null: none), where it comes from when it is not the level's own (a game system that keeps it, or the level above that sets it), and the change that last wrote it.",
  shape.object({ key: T, value: nullable(T), from: opt(shape.object({ system: opt(T), ref: opt(T), name: opt(T) })), mark: opt(levelMark) }),
);
const levelReflection = shape.named(
  "LevelReflection",
  "What is beneath a level, made from recorded values.",
  shape.object({
    people: N,
    things: N,
    places: N,
    groups: N,
    records: N,
    notable: shape.list(T),
    open: N,
    changed: field(nullable(N), "The number of the last turn that changed something there."),
    note: field(nullable(T), "An agent's own line on the level."),
  }),
);
const levelFact = shape.named(
  "LevelFact",
  "A plain statement recorded about a level, with how exact and how sure it is and where it came from; never merged into the level's values.",
  shape.object({ id: T, about: T, key: T, value: T, precision: nullable(precision), standing: nullable(standing), source: nullable(source), by: nullable(T), turn: shape.turnId(), n: N, replacedBy: opt(T), replacedAt: opt(N) }),
);
const levelNode = shape.named(
  "LevelNode",
  "A level of the world's tree as the world route shows it.",
  shape.object({
    ref: T,
    kind: levelKind,
    name: field(nullable(T), "Its name in the data; null for the groups and for what is elsewhere."),
    what: field(nullable(T), "An entity's kind, by its label; null for any other level."),
    reflection: levelReflection,
    values: shape.list(levelValue),
    facts: shape.list(levelFact),
    children: shape.list(T),
    parent: nullable(T),
  }),
);
// The store's node is made of intersections (`Mark` is `Touched` and more), which `Exactly` tells from the flat object the declaration makes.
type NodeMirrored = Holds<Mutually<Infer<typeof levelNode>, NodeView>>;

export const worldReply = shape.named("WorldReply", "The level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn.", shape.object({ at: T, nodes: shape.list(levelNode) }));

/** Which values each level carries: none, its own (with what game systems keep), or all (with what it inherits). */
export const valuesShown = shape.oneOf("none", "own", "all");
type ValuesMirrored = Holds<Exactly<Infer<typeof valuesShown>, ValuesShown>>;

/** The checks above hold, and are read by no one. */
export type Mirrors = [RunKindMirrored, RunStateMirrored, PanelMirrored, NodeMirrored, ValuesMirrored];
