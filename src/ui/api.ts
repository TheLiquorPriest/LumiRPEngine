// What the pages read from RPE (plan §4.4, §14): the routes they call, with what each answers, and the
// live events a turn publishes on its chat. The route table is where these come from: the plan has the
// UI client's types generated from it. Until a generator exists they are kept here by hand, because the
// zone rules keep the pages from importing the server's code, its types included. The app's own routes
// (its status, the live socket) are mirrored from `src/app/`; the turn routes and the live kinds are
// what the turn lane implements, in exactly these shapes.

import type { ReplyError, RunStatus, TraceDelta, TraceRecord, TurnKind, Usage } from "rp-harness/contract";
import type { JsonValue } from "../shared/json";

// ---------------------------------------------------------------- the app's own

/** `GET /api/v1/status` (public): which RPE answers, and whether it belongs to a Lumiverse user yet. */
export interface Status {
  name: "rpe";
  version: string;
  started: number;
  belongsToUser: boolean;
}

/** A permission RPE's extension in Lumiverse lacks, and why it needs it. */
export interface MissingPermission {
  permission: string;
  why: string;
}

/** `GET /api/v1/status/extension` (page): how RPE's extension in Lumiverse last said it stands with RPE. */
export interface ExtensionStatus {
  /** Whether the extension holds RPE's registration, and so marks the replies RPE plays. */
  registered: boolean;
  /** Why it does not, in words a user is shown; null when it does. */
  why: string | null;
  /** The permissions it says it lacks, and why it needs each; null until it has said. */
  missing: MissingPermission[] | null;
}

/** The live socket (`src/app/live.ts`): its path, its protocol, and how a page gives its token as a protocol. */
export const LIVE_PATH = "/api/v1/live";
export const LIVE_PROTOCOL = "rpe.live";
export const TOKEN_PROTOCOL_PREFIX = "rpe.token.";
export const STATUS_PATH = "/api/v1/status";

/** One event of a chat as the live hub sends it: numbered from 1 per chat, with what happened in the publishing area's words. */
export interface LiveEvent {
  chat: string;
  seq: number;
  kind: string;
  /** Present on a state push, which a newer push with the same key may replace for a page that fell behind. */
  key?: string;
  at: number;
  data: JsonValue;
}

/** A chat's events in order; `missed` names the hub's numbers it dropped for a page that fell behind. */
export interface LiveBatch {
  chat: string;
  events: LiveEvent[];
  missed?: { from: number; to: number };
}

// ---------------------------------------------------------------- chats and turns (the turn lane's)

/** A chat RPE plays, as the web shell lists them. */
export interface ChatSummary {
  id: string;
  /** The chat's name in Lumiverse. */
  name: string;
  /** When its newest turn began; null before its first. */
  lastTurnAt: number | null;
  /** Whether a turn of it runs now. */
  running: boolean;
}

/** `GET /api/v1/chats`: the chats of the user RPE belongs to, the most recently played first. */
export interface ChatList {
  chats: ChatSummary[];
}

/** Where a turn stands: running, or how its run ended. */
export type TurnStatus = RunStatus | "running";

/** When a turn's moments happened, in milliseconds since 1970; null for one that has not happened. */
export interface TurnTimings {
  /** The request reached RPE. */
  received: number;
  /** The lead's run began, after intake and any wait for the turn before it. */
  started: number | null;
  /** The reply's first words went to the chat. */
  firstWord: number | null;
  /** The reply was released (plan §10.7). */
  released: number | null;
  /** The lead's run ended; it can go on after the release (plan §10.9). */
  ended: number | null;
}

/** A turn as a chat's list shows it. */
export interface TurnSummary {
  id: string;
  kind: TurnKind;
  /** On the chat's path; false once a swipe or a regenerate put a sibling in its place, or its message was deleted. */
  onPath: boolean;
  /** The Lumiverse message it is tied to (plan §10.8); null until it is. */
  message: string | null;
  status: TurnStatus;
  timings: TurnTimings;
  /** Every agent of its run together: model calls and tokens. */
  usage: Usage;
}

/** `GET /api/v1/chats/:chat/turns?limit=&before=`: a chat's turns, newest first; `before` is a turn's id, and older ones follow it. */
export interface TurnList {
  turns: TurnSummary[];
  /** Older turns remain. */
  more: boolean;
}

/** `GET /api/v1/chats/:chat/turns/:turn?from=`: one turn, with its trace from the record numbered `from` (1 when absent). */
export interface TurnDetail extends TurnSummary {
  chat: string;
  /** The lead's intent record as it was written (plan §10.3); null when it wrote none. Shown behind the spoiler gate. */
  intent: string | null;
  /** What went to the chat so far: the reply's text, and the progress lines of its thinking block. */
  reply: { text: string; progress: string[] };
  /** Why the reply failed, when it did. */
  error: ReplyError | null;
  /** The events of the turn's run, numbered from `from`, in order. */
  trace: TraceRecord[];
  /** The lore of the turn's prompt, by id, as its intake kept it: the entries Lumiverse activated for it (Lumiverse's ids), and the entries its lore map showed the Author (RPE's ids, as the map writes them). */
  lore: { activated: string[]; map: string[] };
}

/** `POST /api/v1/chats/:chat/turns/:turn/stop` (no body): true when the turn was running and is being stopped, false when it had already ended. */
export interface StopAnswer {
  stopped: boolean;
}

/**
 * A turn's folder as RPE writes it (plan §5.3: `TURN_FILES` in `src/turn/folder.ts`, and `transcripts/`
 * in `src/turn/trace.ts`), kept here by hand as the routes are. No route lists a turn's folder or opens
 * one of its files yet, so the Turn page names them and says they cannot be opened.
 */
export const TURN_FOLDER: readonly { name: string; holds: string }[] = [
  { name: "briefing.md", holds: "the Author's briefing: the turn's facts, the lore map and the world state" },
  { name: "world-state.md", holds: "the world state" },
  { name: "assembled-preset-prompt.md", holds: "the prompt Lumiverse assembled" },
  { name: "visible-chat-history.md", holds: "the chat's history the prompt carried" },
  { name: "active-wi-content.md", holds: "the lore entries that activated" },
  { name: "persona.md", holds: "the persona" },
  { name: "character.md", holds: "the character card" },
  { name: "turn.json", holds: "the turn's facts, as data" },
  { name: "previous-attempts/", holds: "the earlier attempts at this reply, for a swipe or a regenerate" },
  { name: "transcripts/", holds: "each agent's records" },
];

// ---------------------------------------------------------------- the route map the client is typed by

/** A route's reply, its query and its body. */
export interface RouteShape<Reply, Query extends Record<string, string | number | undefined> = Record<string, never>, Body = undefined> {
  reply: Reply;
  query: Query;
  body: Body;
}

/** Every route the pages call, by method and path pattern, as the route table writes them. */
export interface Routes {
  "GET /api/v1/status": RouteShape<Status>;
  "GET /api/v1/status/extension": RouteShape<ExtensionStatus>;
  "GET /api/v1/chats": RouteShape<ChatList>;
  "GET /api/v1/chats/:chat/turns": RouteShape<TurnList, { limit?: number; before?: string }>;
  "GET /api/v1/chats/:chat/turns/:turn": RouteShape<TurnDetail, { from?: number }>;
  "POST /api/v1/chats/:chat/turns/:turn/stop": RouteShape<StopAnswer>;
}

export type RouteKey = keyof Routes & string;

// ---------------------------------------------------------------- what a turn publishes on its chat

/**
 * What went to the chat: a piece of the reply's text at its offset in the reply (UTF-16 code units), or
 * one progress line of the chat's thinking block, counted from 0.
 */
export type ReplyPiece = { run: string; from: number; text: string } | { run: string; line: number; progress: string };

/**
 * The live kinds a turn publishes (`app.live.publish(chat, { kind, data })`), each without a key, so
 * none replaces another: every event of a run as RPH traced it, the text of a model call as it streams,
 * and what went to the chat.
 */
export interface LiveKinds {
  trace: TraceRecord;
  delta: TraceDelta;
  reply: ReplyPiece;
}
