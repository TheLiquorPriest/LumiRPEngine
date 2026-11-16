// What the turn lane's routes answer (plan §14): each reply declared field by field, so the generated
// types and the API reference say what a page is sent, and each held to the turn lane's own type (or
// the store's, for the world's tree) so that a change to one stops this compiling until the declaration
// says the same. Written once here, read by the routes (`routes.ts`) and by every page through the
// generated types.

import type { ConsentGrant, FindStopped, GapCheck, KeptMessage, LocatedSlices, PromptMapEdit, ShownSlice } from "rp-harness/contract";
import { agentRef, type Exactly, type Holds, type Infer, limitHit, type Mutually, presetRef, promptNotice, replyError, ruleFiring, shape, traceRecord, usage } from "../app";
import type { NodeView, ValuesShown } from "../store";
import type { RequestRecord } from "./requests";
import type { NotGiven, RunKind, RunState, StoppedBy } from "./runs";

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
    finished: field(nullable(N), "The reply went out whole; the run after the reply is from here to `ended`."),
    intent: field(nullable(span), "The intent record's own time, its first token to its last; null when none began; to null when it began and did not end."),
    thinking: field(shape.list(span), "Each span of thinking before a model call's first output on the reply's path, in call order; none when no call thought."),
    intake: field(
      nullable(shape.list(shape.object({ step: T, from: N, to: N }))),
      "Intake's own steps in order, from `received` to `started`, none of them holding a wait for the turn before; null for a run with no intake of its own (a Settle now) or one kept before they were.",
    ),
    wait: field(nullable(shape.list(shape.object({ from: N, to: N }))), "Each wait for the turn before, on its own, in order; none when nothing was waited for; null as for `intake`."),
  }),
);

const replySoFar = shape.named("ReplySoFar", "What a run sent to the chat: the reply's text, and the progress lines of its thinking block.", shape.object({ text: T, progress: shape.list(T) }));

const turnMark = shape.named(
  "TurnMark",
  "A mark a turn carries apart from its run's status: interrupted (RPE restarted while a run of it went on), saved otherwise (what Lumiverse saved is not what was released, beyond the prefill in front and a continue's join), or standing on a message of the player's he edited, or inserted before it, since it was played; with that message, and when the mark was set.",
  shape.object({ kind: shape.oneOf("interrupted", "saved-otherwise", "edited-message", "inserted-message"), message: nullable(T), at: N }),
);

/** What a chat's list and a turn's own route both tell of it. */
const rowFields = {
  id: shape.turnId(),
  kind: runKind,
  onPath: field(shape.yesNo(), "On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted."),
  message: field(nullable(T), "The Lumiverse message it is tied to (plan §10.8); null until it is."),
  status: runState,
  marks: field(shape.list(turnMark), "Its marks, in the order they were set; none for a turn that carries none."),
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

const notGiven = shape.named(
  "NotGiven",
  "Something a run's lead was not given, as a fact its briefing told: pictures its model does not take, or parts that are neither text nor a picture, with the messages of the prompt that held them; or a part of the briefing that could not be made, with why.",
  shape.union(
    shape.object({ what: shape.oneOf("pictures", "parts"), messages: field(shape.list(N), "The messages of the prompt that held them, by place from 0."), count: N }),
    shape.object({ what: shape.oneOf("world-state", "on-stage"), error: field(T, "Why it could not be made.") }),
  ),
);
type NotGivenMirrored = Holds<Exactly<Infer<typeof notGiven>, NotGiven>>;

const runShown = shape.named(
  "RunShown",
  "One run of a turn: its first, or a continue of it, which runs the turn again under a run id of its own; or a Settle now run on it.",
  shape.object({
    id: field(T, "RPE's own id for it."),
    run: field(nullable(T), "RPH's own id for it, which its trace records carry as their `run`; null before its first record."),
    nth: field(N, "Its place among the turn's runs, from 1."),
    kind: runKind,
    status: runState,
    target: field(
      nullable(T),
      "The message its request named: the one a new reply is written into, the reply a swipe or a regenerate writes again, or the one a continue's tag named for it to go on, a first word only. A continue is tied where Lumiverse's end names the message, the turn's `message`: where the two differ, the tag had named another; where this is null, the message was learned at the end.",
    ),
    held: field(nullable(T), "A continue's own turn, which held what it changed until Lumiverse's end decided its turn, and whose folder holds its files (its requests among them): the turn id its files are read under. Null for any other run."),
    timings: moments,
    usage,
    reply: field(replySoFar, "What this run sent to the chat."),
    saved: field(nullable(T), "What Lumiverse saved for it where that is not what was released (beyond the prefill in front and a continue's join): the saved text whole, beside `reply`; null where it is the same, or nothing is saved yet."),
    error: field(nullable(replyError), "Why the reply failed, when it did."),
    stoppedBy: field(nullable(stoppedBy), "What stopped it where it stood; null for neither a limit nor the hold."),
    lastText: field(shape.yesNo(), "What went out as its reply is the Author's last plain text, sent by the setting `reply.lastText` in place of the error line."),
    notGiven: field(shape.list(notGiven), "What its lead was not given of its prompt and its briefing, each told in its briefing; none when it was given all."),
    trace: field(shape.list(traceRecord), "Its own trace records, numbered from 1 within the run, as far as the read reaches (the turn's `trace`)."),
    requests: field(
      shape.list(shape.object({ agent: T, definition: T, call: N, file: T })),
      "The files of the turn's folder that hold its model calls' requests as sent, where the harness kept them: by agent and call, each named by its path below the folder.",
    ),
  }),
);
export type RunView = Infer<typeof runShown>;

const precision = shape.named("FactPrecision", "How exact a value or a fact is.", shape.oneOf("exact", "approximate", "vague", "unknown"));
const standing = shape.named("FactStanding", "How sure a value or a fact is.", shape.oneOf("established", "proposed", "assumed"));
const source = shape.named("FactSource", "Where a value or a fact came from.", shape.oneOf("prose", "lore", "author", "gm", "character", "player", "import", "default", "invented"));

const panelAsk = shape.object({
  action: field(nullable(T), "The panel action's id; null where the tap names none."),
  values: field(shape.record(shape.json()), "The action's values."),
  from: field(shape.oneOf("palette", "map", "panel", "chip", "send-now", "command"), "Where the tap was made."),
  what: field(T, "The words of what was pressed."),
  on: field(nullable(T), "What it was pressed on; null for nothing."),
});
const composerAsk = shape.object({ choice: field(T, "The choice made, as its choices file names it."), words: field(nullable(T), "Any words typed with it.") });
export const requestShown = shape.named(
  "RequestShown",
  "Something he asked for beside his words: a panel's tap, or a composer control (depth, swipe), with what was asked as data, whether it was played now as a message of its own, the turn it is kept with (null while it waits) and when it was made.",
  shape.object({
    id: T,
    chat: T,
    kind: shape.oneOf("panel", "depth", "swipe"),
    asked: shape.union(panelAsk, composerAsk),
    played: field(shape.yesNo(), "Played now, as a message of its own, rather than with the next message."),
    message: field(nullable(T), "The message it was sent as, where it was played now."),
    turn: field(nullable(shape.turnId()), "The turn it is kept with; null while it waits."),
    at: N,
  }),
);
type RequestMirrored = Holds<Mutually<Infer<typeof requestShown>, RequestRecord>>;
export const requestsReply = shape.named("RequestsReply", "Requests, oldest first.", shape.object({ requests: shape.list(requestShown) }));
export const requestAsk = shape.named(
  "RequestAsk",
  "A composer control's ask, for the next message: its kind, the choice made, and any words typed with it.",
  shape.object({ kind: shape.oneOf("depth", "swipe"), choice: shape.text({ blank: false }), words: opt(nullable(T), "Words typed with it; left out, null or blank, none.") }),
);
export const requestHeldReply = shape.named("RequestHeldReply", "The request held: it waits for the next message, in place of one of its kind that waited.", shape.object({ request: requestShown }));
export const requestWithdrawnReply = shape.named("RequestWithdrawnReply", "The request was withdrawn.", shape.object({ withdrawn: shape.literal(true) }));

const sliceAt = shape.object({ message: field(N, "The prompt's message, by place from 0."), start: N, end: N });
const sliceKind = shape.named("SliceKind", "A slice's kind, from the prompt map's fixed list.", shape.oneOf("instructions", "style", "character", "persona", "world", "note", "lore", "history", "other"));
const promptFront = field(shape.object({ length: N, brokenBy: opt(T) }), "The length of the prompt's front that was the same as the turn before, and the marker of the slice that broke it; no marker when the whole prompt held.");
const locatedSlices = shape.named(
  "LocatedSlices",
  "Where RPH found each slice of the preset's map in a turn's prompt: each slice's marker, kind, places and length; the text that belongs to no slice; the notices of what changed since the turn before; and how much of the prompt's front stayed the same.",
  shape.object({
    preset: nullable(presetRef),
    slices: shape.list(shape.object({ marker: T, kind: sliceKind, at: shape.list(sliceAt), length: N, hash: T })),
    unclaimed: shape.list(sliceAt),
    notices: shape.list(promptNotice),
    front: promptFront,
  }),
);
type LocatedMirrored = Holds<Mutually<Infer<typeof locatedSlices>, LocatedSlices>>;

// ---------------------------------------------------------------- the Prompt page

const shownSlice = shape.named(
  "PromptSliceShown",
  "A slice of the preset's map as found in a turn's prompt: its marker, kind, line and behaviour as the map has them, whether he edited it, its text and places there, how it was found, and what the chat application's breakdown said of it.",
  shape.object({
    marker: T,
    kind: sliceKind,
    line: opt(T, "One line on what it is; absent where the map has none (a slice of the raw layout)."),
    behaviour: opt(shape.oneOf("fixed", "scene", "turn"), "How its text goes from turn to turn; absent as for `line`."),
    edited: opt(shape.literal(true), "He changed it on the Prompt page; a new mapping keeps it."),
    text: T,
    length: N,
    at: shape.list(sliceAt),
    found: opt(shape.oneOf("signature", "block", "place"), "How it was found: by a signature of its text, by the chat application's block name, or by its place among its neighbours."),
    breakdown: opt(shape.oneOf("confirmed", "corrected"), "What the chat application's own breakdown said there: it agreed with the map's finder, or the finder was corrected to it."),
    hint: opt(T, "The breakdown's block the slice was found by."),
  }),
);
type ShownSliceMirrored = Holds<Mutually<Infer<typeof shownSlice>, ShownSlice>>;

const promptClipped = shape.named(
  "PromptClipped",
  "Lumiverse's own clipping inside RPE's window: how many of the window's messages the prompt does not hold, and why (its memory's summary stands for them, its message limit, or the preset's context size; null where it could not be told).",
  shape.object({ count: N, by: nullable(shape.oneOf("memory", "message-limit", "context-size")) }),
);

export const promptShownReply = shape.named(
  "PromptShown",
  "The prompt map of the chat's preset as found in one turn's prompt: its slices, the text no slice claims, the turn's notices and front, whether the prompt's text could be told apart, Lumiverse's clipping, and the old engines' blocks the preset still holds.",
  shape.object({
    turn: shape.turnId(),
    preset: nullable(presetRef),
    mapped: field(shape.yesNo(), "The slices are the learned map's; false: the raw layout's, named by the chat application's blocks and by place."),
    complete: field(shape.yesNo(), "The prompt's text could be told apart; false: slices cannot be found in some of it."),
    slices: shape.list(shownSlice),
    unclaimed: shape.list(shape.object({ message: N, start: N, end: N, text: T })),
    notices: shape.list(promptNotice),
    front: promptFront,
    clipped: field(nullable(promptClipped), "Null where the window's messages are all in the prompt."),
    old: field(
      shape.list(shape.object({ kind: shape.oneOf("block", "outlet"), name: T, in: T })),
      "The old engines' blocks the preset still holds: a block named `RPEngine · <step>` (its step), or an `{{outlet::lre_…}}` reference left in a block's text (the outlet), each with the block it stands in.",
    ),
  }),
);

export const promptTurnShown = shape.named(
  "PromptTurnShown",
  "One turn's notices and front, as the Prompt page lists them turn by turn: its number on the chat's path (null where it is not on it now), when its request came, and Lumiverse's clipping.",
  shape.object({ turn: shape.turnId(), n: nullable(N), at: N, notices: shape.list(promptNotice), front: promptFront, clipped: nullable(promptClipped) }),
);

export const promptEditAsk = shape.named(
  "PromptEditAsk",
  "One of his edits to the prompt map: rename a marker, merge slices under one, split one where given words begin, correct a line, change a kind.",
  shape.union(
    shape.object({ edit: shape.literal("rename"), marker: T, to: T }),
    shape.object({ edit: shape.literal("merge"), markers: shape.list(T), as: T }),
    shape.object({ edit: shape.literal("split"), marker: T, at: T, second: T }),
    shape.object({ edit: shape.literal("line"), marker: T, line: T }),
    shape.object({ edit: shape.literal("kind"), marker: T, to: sliceKind }),
  ),
);
type PromptEditMirrored = Holds<Mutually<Infer<typeof promptEditAsk>, PromptMapEdit>>;

const reportShown = shape.object({ code: T, values: opt(shape.record(shape.json())) });
const changeShown = shape.named(
  "TurnChange",
  "One change a turn recorded, in its order: the operation and its values, who made it, whether it applied, what it reported, and how exact, how sure and from where it is.",
  shape.object({
    id: N,
    ord: N,
    op: T,
    value: shape.json(),
    by: nullable(T),
    applied: shape.yesNo(),
    reports: shape.list(reportShown),
    source: nullable(source),
    standing: nullable(standing),
    precision: nullable(precision),
    job: field(nullable(T), "The job that recorded it, when a job did."),
  }),
);
/** One change of a turn as its route shows it. */
export type ChangeView = Infer<typeof changeShown>;

const searchHit = shape.object({ ref: T, title: T, snippet: T, how: field(shape.oneOf("words", "meaning"), "How it matched: by the names and words given, or by meaning.") });
const gapCheck = shape.named(
  "GapCheck",
  "A gap check run (plan §10.5): who ran it, on what, by which names and words, each place it searched with what came back there, and where its evidence was saved.",
  shape.object({ id: T, by: agentRef, topic: T, terms: shape.list(T), searched: shape.list(shape.object({ where: T, hits: shape.list(searchHit) })), saved: opt(T) }),
);
type GapMirrored = Holds<Mutually<Infer<typeof gapCheck>, GapCheck>>;
const consentGrant = shape.named(
  "ConsentGrant",
  "Something the lead allowed to be invented (plan §10.5): who allowed it, for whom, how (its own write, or its answer to a sub-agent), what, within what bounds, and the gap check it rests on.",
  shape.object({
    id: T,
    by: agentRef,
    to: opt(agentRef),
    via: shape.union(shape.object({ kind: shape.literal("write"), tool: T, callId: T }), shape.object({ kind: shape.literal("answer"), callId: T })),
    topic: T,
    bounds: opt(T),
    gapCheck: opt(T, "The gap check it rests on; absent when none was cited."),
  }),
);
type ConsentMirrored = Holds<Mutually<Infer<typeof consentGrant>, ConsentGrant>>;

export const toldShown = shape.named(
  "TurnTold",
  "What a turn, or a job he started, was told as it went: each gap check, each consent, each rule that fired with what the agent did next, the attachments each agent was given by name, and each sub-agent's writes the lead dropped, in the order told.",
  shape.object({
    gapChecks: shape.list(shape.object({ check: gapCheck, at: N })),
    consents: shape.list(shape.object({ grant: consentGrant, at: N })),
    rules: shape.list(shape.object({ firing: ruleFiring, at: N })),
    attachments: shape.list(shape.object({ agent: agentRef, refs: shape.json(), at: N })),
    dropped: shape.list(shape.object({ agent: agentRef, at: N })),
  }),
);
export const jobToldReply = shape.named("JobToldReply", "What a job he started was told as it went.", shape.object({ job: T, told: toldShown }));
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
    prompt: field(nullable(locatedSlices), "Where each slice of the preset's map was in this turn's prompt, with its notices; null where RPH kept none, or no longer keeps it (its folder was pruned)."),
    asked: field(shape.list(requestShown), "What he asked for beside his words that this turn was told and keeps, and what was played as its message."),
    record: field(nullable(shape.record(shape.json())), "The Author's record of the turn as `story_query` shows it, every field; null when it wrote none."),
    found: field(shape.list(T), "The tools its agents reached through `tool_search` and `tool_use`, by name."),
    todos: field(shape.list(shape.object({ agent: T, open: shape.list(T) })), "Each agent's `todo` items still open as its list last stood."),
    changes: field(shape.list(shape.object({ lane: T, changes: shape.list(changeShown) })), "Its changes by lane, each lane's in order."),
    told: toldShown,
    carried: field(nullable(shape.object({ message: T, swipe: N, record: shape.json() })), "For a turn a migration carried: its message and swipe, and the old engine's record of it as kept; null for any other."),
    card: field(T, "The route of the turn's review card, where each of its changes is reviewed and undone."),
    quests: field(shape.list(shape.object({ id: T, name: T, kind: T })), "The open quests the turn touched: opened, called a stage of, or wrote anything of."),
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

const keptMessage = shape.named(
  "KeptMessage",
  "One message of a model call's request as it was sent: its role, its text, and the block the harness placed it as (`opening`, `frame`, `prompt`, `session:carry`, `briefing`, a given name, `brief`); none for the run's own conversation.",
  shape.object({ role: T, text: T, block: opt(T, "The block it was placed as; absent for the run's own conversation.") }),
);
type KeptMessageMirrored = Holds<Exactly<Infer<typeof keptMessage>, KeptMessage>>;
export const requestReply = shape.named(
  "RequestReply",
  "One model call's request, by its file below the turn's folder, rebuilt from the pointers the harness kept into the turn's files: every message as it was sent, in order, and each tool declared with the file its words came from. Where what is rebuilt is not what was sent, it says so and shows nothing.",
  shape.object({
    name: T,
    same: field(shape.yesNo(), "What was rebuilt is what was sent, by the hash the file keeps; false where it is not, and nothing is shown."),
    messages: field(shape.list(keptMessage), "Every message as it was sent, in order; none where `same` is false."),
    tools: field(shape.list(shape.object({ name: T, file: opt(T, "The file its description came from; absent for a host's own tool.") })), "Each tool declared, in order; none where `same` is false."),
  }),
);

export const settleReply = shape.named("SettleReply", "The newest turn, and the Settle now run begun on it.", shape.object({ turn: shape.turnId(), run: T }));

// ---------------------------------------------------------------- the world (the store's tree, plan §6.4, §6.6)

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
    due: field(
      nullable(shape.object({ n: nullable(N), after: N, kind: T })),
      "What falls due beneath it in the time ahead: how many (null: more than one, uncounted), the minutes until the soonest, and its kind; null when nothing does, or the reading passed no due source.",
    ),
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
export type Mirrors = [RunKindMirrored, RunStateMirrored, RequestMirrored, NodeMirrored, ValuesMirrored, LocatedMirrored, GapMirrored, ConsentMirrored];
