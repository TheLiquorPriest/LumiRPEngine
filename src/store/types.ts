// What the store records and answers (plan §6.3, §6.6, Appendix B). Plain data: every row carries
// the user, a change carries its lane, and a value carries its precision, standing and source.

import type { JsonObject, JsonValue } from "../shared/json";
import type { RevisionId, WorldId } from "../shared/ids";
import type { WorldState } from "../engine/state";

/** The two lanes of a turn (§6.2): what the story holds, and what the engine holds. */
export const LANES = ["story", "engine"] as const;
export type Lane = (typeof LANES)[number];

/** How sure a value is (§6.6). */
export const STANDINGS = ["established", "proposed", "assumed"] as const;
export type Standing = (typeof STANDINGS)[number];

/** How exact a value is (§6.6). */
export const PRECISIONS = ["exact", "approximate", "vague", "unknown"] as const;
export type Precision = (typeof PRECISIONS)[number];

/** Where a value came from (§6.6). None given is `null`: the change is unsourced. */
export const SOURCES = ["prose", "lore", "author", "gm", "character", "player", "import", "default", "invented"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * A turn's life: staged while open, then tied to a saved reply (`done`, or `cut` when only part was saved), dropped when nothing was
 * saved, or `joined`: a continue's held turn whose changes joined the turn it extended (plan §10.10, R-192 (e), (f)).
 */
export const TURN_STATUSES = ["open", "done", "cut", "dropped", "joined"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

/**
 * The operations the store applies itself. Every other operation is an event type of the engine's
 * registry (the core types and every pack's), applied by that type's own handler.
 */
export const STORE_OPS = {
  /** An agent's own line on a level of the tree (§6.4): `{ at: string, text: string }`; empty text takes it off. */
  note: "store.note",
  /** One of today's message-level markers (an Upgrade, a level, a time control), applied by today's own marker code. */
  marker: "store.marker",
  /**
   * A plain statement about a thing (§6.6): `{ id, about, key, value, replaces? }`, `about` a tree
   * ref. It replaces the standing fact of the same `about` and `key`, and the fact `replaces` names.
   */
  fact: "store.fact",
  /**
   * A value set at the world's own level (READINGS B-33): `{ at: "world", key, value }`, any JSON value, null taking it off. Every
   * level below takes it unless it sets its own.
   */
  value: "store.value",
} as const;

/** Why a change did not apply, or what it did not add up to: a code and its values, never words. */
export interface Report {
  code: string;
  values?: JsonObject;
}

/** One change as a caller gives it. */
export interface ChangeInput {
  lane: Lane;
  /** An engine event type (`set`, `post`, `economy.txn`, …), a store operation (`STORE_OPS`) or an area's (`<area>.<op>`). */
  op: string;
  /** For an event, the event itself (its `type` is `op`); for a store or area operation, its value. */
  value: JsonValue;
  /** Who decided it: an agent's definition, `player`, `import`, `migration`. */
  by?: string | null;
  /** The run that wrote it (an agent's handle), apart from who decided it: a lead drops a sub-agent's staged writes by it. */
  handle?: string | null;
  standing?: Standing | null;
  precision?: Precision | null;
  /** Null or absent: unsourced. */
  source?: Source | null;
  /**
   * What the source cites (plan §10.5), as its writer gives it: a lore entry, a message, a roll or a
   * ruling; for an invention, its gap check and its consent. Kept as given; null or absent: none.
   */
  cite?: JsonValue | null;
  /** The job that made it, when a job did. */
  job?: string | null;
  /** The reports its tool made for it (code and values, never words), kept beside the store's own. */
  reports?: Report[];
}

/**
 * One stored change. `applied` says whether it applied when it was recorded, on its own path; `reports` say why not, or what did not
 * add up. His own change (plan §6.3 l.632) belongs to no turn: its `turn` is empty and `chat` names its chat.
 */
export interface ChangeRow {
  id: number;
  turn: string;
  /** The chat of his own change; null for a turn's. */
  chat: string | null;
  ord: number;
  lane: Lane;
  op: string;
  value: JsonValue;
  by: string | null;
  handle: string | null;
  standing: Standing | null;
  precision: Precision | null;
  source: Source | null;
  cite: JsonValue | null;
  job: string | null;
  applied: boolean;
  /** The reports its tool made for it when it was recorded, then the store's own (codes and values, never words). */
  reports: Report[];
  created: number;
}

/**
 * His own change of a chat an import forgets (`forgetImport`), kept to be written again once the import has tied the chat's turns
 * afresh (`restoreOwn`): what it recorded, when it took effect (`at`: its job's end, else when it was made), and the reply of the
 * chat's own path whose turn it stood just before (`before`: null when it stood after the path's end, in a branch with no turn of its
 * own, or is a job's not ended yet).
 */
export interface KeptOwn {
  chat: string;
  lane: Lane;
  op: string;
  value: JsonValue;
  by: string | null;
  handle: string | null;
  standing: Standing | null;
  precision: Precision | null;
  source: Source | null;
  cite: JsonValue | null;
  job: string | null;
  applied: boolean;
  /** The store's own reports. */
  reports: Report[];
  /** Its tool's reports. */
  told: Report[];
  created: number;
  at: number;
  /** When its job ended; null: no job, or one not ended. */
  ended: number | null;
  before: { message: string; hash: string | null; date: number | null } | null;
}

export interface ChatRow {
  id: string;
  world: WorldId | null;
  /** The world revision the chat starts on. */
  revision: RevisionId | null;
  /** A branch: the chat it was made from, and the message it was made at. */
  sourceChat: string | null;
  sourceMessage: string | null;
  /** The path node of the last turn on the chat's path, or null before its first turn. */
  head: string | null;
  created: number;
  /** When the chat was deleted while a branch still shares its turns. */
  deleted: number | null;
  /** The chat's own seed, the run's seed an outside client's copy starts from: a carried chat keeps the old engine's; a chat made on RPE gets its own. */
  seed: string;
  /** When the chat started, in ms: a carried chat keeps the old engine's; one made on RPE, when it was made. */
  started: number;
  /** A carried chat: whether the old engine was on for it before the swap; null for a chat made on RPE. */
  wasOn: boolean | null;
  /** A carried chat: which engine played it (`classic`, `agents`, `harness`, as the carrier names it); null for a chat made on RPE. */
  engine: string | null;
}

export interface TurnRow {
  id: string;
  chat: string;
  /** The turn before it on the path it was made on, or null for a chat's first turn. */
  parent: string | null;
  /** The path node it was made on: its recorded path. */
  node: string;
  /** Turns before it on that path. */
  depth: number;
  kind: string;
  /** Written by a migration's import, not played on RPE. */
  imported: boolean;
  generation: string | null;
  /** The message it is tied to: null while open. */
  message: string | null;
  /** The hash of the reply's text as saved. */
  hash: string | null;
  /** The swipe's date. */
  date: number | null;
  status: TurnStatus;
  /** The hash the chat showed last when it differs from the saved one: the reply was edited. */
  edited: string | null;
  /** The text the reply was played on, kept with a carried turn (an RPE turn's is in its folder): what an edit since is told against. */
  text: string | null;
  /**
   * The turn whose changes it joined (`UserStore.joinTurn`): a continue's held turn, joined to the turn it extended when the
   * generation's end named that turn's message. Null for any other. A write or a reading of its state addressed to it is refused.
   */
  joined: string | null;
  /** The intent record, as text. */
  intent: string | null;
  /** The world clock at the turn's end, minutes since the world's epoch. */
  storyTime: number | null;
  timings: JsonValue | null;
  tokensIn: number | null;
  tokensOut: number | null;
  created: number;
}

/**
 * One message of the chat as the chat application shows it: the showing swipe's text hash and date,
 * and whether the player hid it from the prompt. Every caller says: a mark left out would clear one.
 */
export interface ShownMessage {
  id: string;
  user: boolean;
  hash: string;
  date?: number | null;
  hidden: boolean;
}

/** One message of a chat's path as last compared. Ids, hashes and marks only: never its text. */
export interface PathEntry {
  message: string;
  user: boolean;
  /** The turn showing there, null for a user message or a reply no turn is tied to. */
  turn: string | null;
  /** The path node after this turn. */
  node: string | null;
  /** Whether that node is the one the turn was made on (false: it stands rebased); null without a turn. */
  own: boolean | null;
  hash: string;
  date: number | null;
  /**
   * Whether the player hid it from the prompt, as the last comparison was shown it. The mark is the
   * message's: a swipe tied to it since keeps it, and a reply new to the path has none.
   */
  hidden: boolean;
}

/**
 * A change that applied when it was recorded and does not apply on the path folded now, with the reports that say why, the things it
 * was about (tree refs: what it touches) and the value it carried. The change's own row is never rewritten.
 */
export interface NotApplied {
  change: number;
  turn: string;
  op: string;
  lane: Lane;
  reports: Report[];
  about: string[];
  value: JsonValue;
}

/** Why a change is listed under "unsettled" (plan §6.7, §10.5). */
export type UnsettledWhy = "reported" | "not_applied" | "unsourced" | "unchecked";

/**
 * A change "unsettled" lists (`unsettledOf`): the change, the turn it is of (null: one of his own, or a job's, placed between turns),
 * the things it is about, and why it is listed.
 */
export interface UnsettledChange {
  change: ChangeRow;
  turn: string | null;
  about: string[];
  why: UnsettledWhy[];
}

/** What comparing the chat's path with the turn tree found (§6.3). Ids and hashes only. */
export interface PathReport {
  /** Messages no longer in the chat, with the turn each held. */
  gone: { message: string; turn: string | null }[];
  /** A different swipe showing on the newest reply. */
  swiped: { message: string; from: string | null; to: string | null } | null;
  /** A different swipe showing on an earlier reply, with later replies still after it. */
  flipped: { message: string; from: string | null; to: string | null }[];
  /** The turns now applied on top of a path other than the one they were made on: the stretch to look over. */
  rebased: { from: string; to: string; turns: string[] } | null;
  /**
   * Replies whose text differs from what was saved when their turn was tied (newly so); `text` is what the turn was played on where the store
   * keeps it (a carried turn's), the old text whole.
   */
  edited: { turn: string; message: string; saved: string; now: string; text?: string }[];
  /**
   * Replies after the chat's first turn that no turn is tied to, in runs. `why` names, among the run's messages, each that stands with a reason
   * kept for it (a carried reply: stopped, failed, restarted); absent when none has one.
   */
  unplayed: { from: string; to: string; count: number; why?: { message: string; why: StretchWhy }[] }[];
  /** A branch seen for the first time: the chat it was made from, and where. */
  branched: { from: string; at: string | null } | null;
  /** What no longer applies on the head's path, when a stretch is rebased. */
  notApplied: NotApplied[];
  /**
   * Where following a message's branch links back stopped at `store.branchHops`: the chat and message it reached, and how many links it
   * followed; the turns beyond are not found. Absent when none stopped.
   */
  branchStopped?: { chat: string; message: string; hops: number }[];
  /** Messages now standing before a played turn that were not on the path before, each with the first turn after it. Absent: none. */
  inserted?: { message: string; before: string }[];
}

/**
 * What a comparison between turns found and kept with the chat (R-130), for the next turn's start to tell once beside what it finds itself: a
 * flip, a delete, an edit, an inserted message, a stretch to look over and what no longer applies there. What is derived from the path each
 * time (an unplayed stretch) is not kept: the next comparison finds it again.
 */
export type KeptReport = Partial<Pick<PathReport, "gone" | "swiped" | "flipped" | "rebased" | "edited" | "branched" | "notApplied" | "inserted">>;

/**
 * What landing held changes on an earlier turn left to look over, for one chat whose path runs through that turn (`UserStore.addEarlier`):
 * the stretch from that turn to the head, as a flipped swipe's is reported, and what of it no longer applies, by thing and value.
 */
export interface EarlierLanded {
  chat: string;
  /** The turns after it on the chat's path, as the first and last message they stand at; null where none follows. */
  rebased: PathReport["rebased"];
  notApplied: NotApplied[];
}

/** Why a reply stands with no turn played, as the old engine recorded it: the reply was stopped, failed, or restarted. */
export type StretchWhy = "stopped" | "failed" | "restarted";

/**
 * Where a write goes (plan §10.9, R-73): to a turn (a turn's own call; an agent's job, to the turn that started it, with the job), or to
 * his own changes, kept with the chat (his edit, what is done on his word outside a turn, a job he started, with the job).
 */
export type WriteTarget = { kind: "turn"; turn: string; job?: string } | { kind: "owner"; chat: string; job?: string };

/** An agent's own line on a level of the tree. */
export interface NoteLine {
  text: string;
  by: string | null;
  turn: string;
}

/** The last turn whose changes touched something: its id and its number on the path. */
export type Touched = {
  turn: string;
  n: number;
};

/**
 * The change that last wrote a part of a level (a field, a relation type, or an aspect such as a
 * balance), as its change recorded it: the turn, and how exact, how sure and from where. For a
 * balance, a sum of every posting, the precision is the least exact any posting into it had.
 */
export type Mark = Touched & {
  precision: Precision | null;
  standing: Standing | null;
  source: Source | null;
  /** An invention with no gap check or no consent (plan §10.5): its source `invented`, its cite naming neither. Absent: not one. */
  unchecked?: true;
};

/** A plain statement about a thing (§6.6), as the fact store keeps it. History is kept: a replaced fact stays, marked. */
export type Fact = {
  id: string;
  /** The tree ref it is about. */
  about: string;
  /** The key its writer chose; matched exactly, never by its words. */
  key: string;
  /** The value in words. */
  value: string;
  precision: Precision | null;
  standing: Standing | null;
  source: Source | null;
  by: string | null;
  turn: string;
  /** The turn's number on the path. */
  n: number;
  /** The fact that replaced it, and the number of the turn that did; absent while it stands. */
  replacedBy?: string;
  replacedAt?: number;
  /** The part of a record it belongs to when its writer named one (a place's: since, feature, access). */
  part?: string;
  /** The id of the story beat that caused it, when named. */
  beat?: string;
};

/** The state the store folds: the engine's world state, and what the store keeps beside it. */
export interface StoreState {
  world: WorldState;
  /** Agents' own lines, by tree ref. */
  notes: Record<string, NoteLine>;
  /** The last turn that touched each tree ref, for the reflections. */
  touched: Record<string, Touched>;
  /** What last wrote each part of a level, by tree ref and then by the part's name (a field, a relation type, an aspect). */
  marks: Record<string, Record<string, Mark>>;
  /** The fact store: every fact recorded on the path, by the tree ref it is about, oldest first. */
  facts: Record<string, Fact[]>;
  /** Each area's slice (`StoreArea`), by the area's name; an area absent holds its starting slice. */
  areas?: Record<string, JsonObject>;
  /** The world's own values (`store.value`), by key; absent: none set. */
  values?: Record<string, JsonValue>;
}

/**
 * State at a point. `state` may be shared with the store's cache: read it, never change it.
 * `notApplied` lists changes that applied when recorded and do not apply on this path;
 * `rebased` the turns applied on a path other than the one they were made on.
 */
export interface Folded {
  node: string | null;
  state: StoreState;
  notApplied: NotApplied[];
  rebased: string[];
}

/**
 * One message of a chat's path as the chat application showed it when it was asked where a coming turn starts (plan §9.6 l.1121):
 * its id, whether it is the player's, its place in the chat, the swipe that shows (null where the asker did not say) and the hash of
 * that swipe's text, by which a turn knows its swipe (§6.3 l.617). Where the question is asked, neither a swipe's date nor a hidden
 * mark is seen.
 */
export interface SeenMessage {
  id: string;
  user: boolean;
  index: number;
  swipe: number | null;
  hash: string;
}

/**
 * Where a turn not yet begun will start on the path it comes with, which ends there (plan §4.2, §9.6): after the path's newest
 * message, the one its generation follows (a new reply, a continue, an impersonation; null on a path with no message), or in place
 * of the reply a swipe or a regenerate replaces, which the path leaves out, or ends with and is passed over.
 */
export type TurnPoint = { follows: string | null; replaces?: never } | { replaces: string; follows?: never };

/**
 * What the extension's question is answered from (plan §4.2, §9.6, R-5): the state where a turn not yet begun will start on the path
 * the question carries, folded along the chain of turns that path shows (`node` is the key of the path node the turn will stand
 * after, which a comparison of that path stores, null at the chat's start), and that path up to the point, oldest first, each
 * message with the hidden mark the store holds for it (R-21): the mark heard for it since the last comparison, else the one that
 * comparison took; a message no comparison has seen carries the mark heard for it, if one was, and is not hidden otherwise. With
 * each, the turn the tree ties its showing text to (null: none).
 */
export interface TurnStart extends Folded {
  messages: (SeenMessage & { hidden: boolean; turn: string | null })[];
  /**
   * The message whose turn the coming turn follows, and that turn: the answer stands at that turn's end on this path. Null when it
   * stands at the world's start: the tree ties no message of the path to a turn, or the store does not know the chat (`known`).
   */
  at: { message: string; turn: string } | null;
  /**
   * Whether the store knows the chat. One it does not know plays no world yet, as the chat the store makes for it does, so its
   * answer is the blank world's start.
   */
  known: boolean;
}

/** Input the store refuses because it cannot be read: an unknown lane, a malformed value, a turn that is not there. */
export class StoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreInputError";
  }
}

/**
 * A write, or a reading of its state, addressed to a turn that was joined to another (plan §10.10, R-192 (f)): refused, naming the
 * turn it joined (`joined`). The store never sends it on there itself: one place resolves a joined turn, and a caller that missed
 * that place is found by this, not by a change landing where nobody reads it.
 */
export class JoinedTurnError extends StoreInputError {
  constructor(
    readonly turn: string,
    readonly joined: string,
  ) {
    super(`turn ${turn} was joined to turn ${joined}: address that turn instead`);
    this.name = "JoinedTurnError";
  }
}

/** A database the store cannot work on as it is: its tables are not there, or another runner made them. */
export class StoreSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreSchemaError";
  }
}
