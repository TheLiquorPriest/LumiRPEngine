// The raw archive index (DEPTH-PLAN §4.3): the chat's own prose, as the host stores it, indexed per
// chat by message, swipe, story time, place, the beats that cite it and the exposure on those beats,
// with a lexical index in the user's storage (`backend/archive-index.ts`). The author and the GM
// search and quote any of it; a character never reads it (its recall goes through its own mind and
// the points of view it received).

import type { EntityId, MessageId, PlaceId } from "./ids";
import type { SwipeKey } from "./layer";
import type { StoryTime } from "./story";

export interface ArchiveQuery {
  /** Words to find (lexical, ranked); absent: every message the other filters keep, newest first. */
  text?: string;
  /** Messages cited by a live beat with this person as actor, addressee, subject or exposed. */
  who?: EntityId;
  /** Messages cited by a live beat at this place. */
  place?: PlaceId;
  /** Story-time window (inclusive), by the message's story time. */
  from?: StoryTime;
  to?: StoryTime;
  /** Only messages at or before this one on the active chain (a job's basis). */
  upTo?: MessageId;
  /** At most this many hits (default 8, at most 50). */
  limit?: number;
  /** Hits to skip first, for paging. */
  offset?: number;
}

export interface ArchiveResult {
  hits: ArchiveHit[];
  /** Every hit the query matched before paging. */
  total: number;
}

export interface ArchiveHit {
  messageId: MessageId;
  /** Its index on the active chain. */
  index: number;
  isUser: boolean;
  swipeId: number;
  swipe: SwipeKey;
  /** The clock after its turn (the ledger's), else the earliest live beat citing it; null when neither is known. */
  storyTime: StoryTime | null;
  /** Places of the live beats citing it. */
  places: PlaceId[];
  /** People of the live beats citing it: actors, addressed, exposed. */
  people: EntityId[];
  /** Ids of the live beats citing it. */
  beats: string[];
  /** Lexical score (0 without `text`). */
  score: number;
  /** The best-matching passage, about 400 characters. */
  snippet: string;
  /** The snippet's [start, end) in the message's text, for `archiveQuote`. */
  span: [number, number];
}

export interface ArchiveQuoteRequest {
  messageId: MessageId;
  /** [start, end) characters; absent: the whole message (capped). */
  span?: [number, number];
}

export interface ArchiveQuote {
  messageId: MessageId;
  index: number;
  isUser: boolean;
  swipeId: number;
  swipe: SwipeKey;
  storyTime: StoryTime | null;
  span: [number, number];
  text: string;
  /** True when the text was cut at the cap (`ARCHIVE_QUOTE_MAX`). */
  truncated: boolean;
}

/** The most characters one quote returns. */
export const ARCHIVE_QUOTE_MAX = 6000;
