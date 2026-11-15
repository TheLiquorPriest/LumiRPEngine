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

/** A turn's life: staged while open, then tied to a saved reply (`done`, or `cut` when only part was saved), or dropped when nothing was saved. */
export const TURN_STATUSES = ["open", "done", "cut", "dropped"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

/**
 * The operations the store applies itself. Every other operation is an event type of the engine's
 * registry (the core types and every pack's), applied by that type's own handler.
 */
export const STORE_OPS = {
  /** The Author's horizon (§6.4): `{ list: string[] }`, the whole list. */
  horizon: "store.horizon",
  /** An agent's own line on a level of the tree (§6.4): `{ at: string, text: string }`; empty text takes it off. */
  note: "store.note",
  /** One of today's message-level markers (an Upgrade, a level, a time control), applied by today's own marker code. */
  marker: "store.marker",
  /**
   * A plain statement about a thing (§6.6): `{ id, about, key, value, replaces? }`, `about` a tree
   * ref. It replaces the standing fact of the same `about` and `key`, and the fact `replaces` names.
   */
  fact: "store.fact",
} as const;

/** Why a change did not apply, or what it did not add up to: a code and its values, never words. */
export interface Report {
  code: string;
  values?: JsonObject;
}

/** One change as a caller gives it. */
export interface ChangeInput {
  lane: Lane;
  /** An engine event type (`set`, `post`, `economy.txn`, …) or a store operation (`STORE_OPS`). */
  op: string;
  /** For an event, the event itself (its `type` is `op`); for a store operation, its value. */
  value: JsonValue;
  /** Who made it: an agent, the player, an import. */
  by?: string | null;
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
}

/** One stored change. `applied` says whether it applied when it was recorded, on its own path; `reports` say why not, or what did not add up. */
export interface ChangeRow {
  id: number;
  turn: string;
  ord: number;
  lane: Lane;
  op: string;
  value: JsonValue;
  by: string | null;
  standing: Standing | null;
  precision: Precision | null;
  source: Source | null;
  cite: JsonValue | null;
  job: string | null;
  applied: boolean;
  reports: Report[];
  created: number;
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
 * and whether the player hid it from the prompt (absent: not hidden).
 */
export interface ShownMessage {
  id: string;
  user: boolean;
  hash: string;
  date?: number | null;
  hidden?: boolean;
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

/** A change that applied when it was recorded and does not apply on the path folded now, with the reports that say why. */
export interface NotApplied {
  change: number;
  turn: string;
  op: string;
  lane: Lane;
  reports: Report[];
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
  /** Replies whose text differs from what was saved when their turn was tied (newly so). */
  edited: { turn: string; message: string; saved: string; now: string }[];
  /** Replies after the chat's first turn that no turn is tied to. */
  unplayed: { from: string; to: string; count: number }[];
  /** A branch seen for the first time: the chat it was made from, and where. */
  branched: { from: string; at: string | null } | null;
  /** What no longer applies on the head's path, when a stretch is rebased. */
  notApplied: NotApplied[];
}

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
};

/** The state the store folds: the engine's world state, and what the store keeps beside it. */
export interface StoreState {
  world: WorldState;
  /** The Author's horizon, as tree refs; only a recorded change sets it. */
  horizon: string[];
  /** Agents' own lines, by tree ref. */
  notes: Record<string, NoteLine>;
  /** The last turn that touched each tree ref, for the reflections. */
  touched: Record<string, Touched>;
  /** What last wrote each part of a level, by tree ref and then by the part's name (a field, a relation type, an aspect). */
  marks: Record<string, Record<string, Mark>>;
  /** The fact store: every fact recorded on the path, by the tree ref it is about, oldest first. */
  facts: Record<string, Fact[]>;
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
 * message with the hidden mark the store holds for it (R-21; none for one no comparison has seen) and the turn the tree ties its
 * showing text to (null: none).
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

/** A database the store cannot work on as it is: its tables are not there, or another runner made them. */
export class StoreSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreSchemaError";
  }
}
