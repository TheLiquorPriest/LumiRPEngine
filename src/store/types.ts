// What the store records and answers (plan §6.3, §6.6, Appendix B). Plain data: every row carries
// the user, a change carries its lane, and a value carries its precision, standing and source.

import type { JsonValue } from "../shared/json";
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
} as const;

/** Why a change did not apply, or what it did not add up to. */
export interface Report {
  code: string;
  text: string;
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

/** One message of the chat as the chat application shows it: the showing swipe's text hash and date. */
export interface ShownMessage {
  id: string;
  user: boolean;
  hash: string;
  date?: number | null;
}

/** One message of a chat's path as last compared. */
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
}

/** A change that applied when it was recorded and does not apply on the path folded now. */
export interface NotApplied {
  change: number;
  turn: string;
  op: string;
  lane: Lane;
  reason: string;
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
export interface Touched {
  turn: string;
  n: number;
}

/** The state the store folds: the engine's world state, and what the store keeps beside it. */
export interface StoreState {
  world: WorldState;
  /** The Author's horizon, as tree refs; only a recorded change sets it. */
  horizon: string[];
  /** Agents' own lines, by tree ref. */
  notes: Record<string, NoteLine>;
  /** The last turn that touched each tree ref, for the reflections. */
  touched: Record<string, Touched>;
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

/** Input the store refuses because it cannot be read: an unknown lane, a malformed value, a turn that is not there. */
export class StoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreInputError";
  }
}
