// What the player asks for beside his message's words (plan §10.10 "A panel action", App. B `request`,
// R-23): a panel's tap for his next message or one played now, and the composer's depth and swipe
// controls. Each is kept, as data, with the turn that answered it. Until then it waits: one of each kind
// at a time, a new one in its place; listed, and withdrawn while it waits. What waits goes with the next
// turn that answers a new message; a swipe or a regenerate of that turn is told what that turn was, and
// no turn after; a continue is not told it again. A request whose turn was dropped with nothing saved,
// or that the store no longer holds, waits again. Every row carries the user.

import type { Database } from "bun:sqlite";
import { liveKind, shape } from "../app";
import type { JsonObject } from "../shared/json";
import type { Writes } from "./kv";

/** What a chat's followers are told when what waits in it changed: how many requests wait now; a page reads them again. */
export const REQUESTS_KIND = liveKind("requests", {
  data: shape.object({ waiting: shape.number() }),
  does: "What waits in the chat, asked for beside the player's words, changed: how many requests wait now; a page reads them again.",
});

/** A request's words as the bound `requests.textMost` counts them: what was pressed and on what, or the choice and the words typed with it. */
export function requestText(asked: PanelAsk | ComposerAsk): string {
  return "what" in asked ? `${asked.what}${asked.on ?? ""}` : `${asked.choice}${asked.words ?? ""}`;
}

/** A request's kind: a panel's tap, or one of the composer's two controls. */
export type RequestKind = "panel" | "depth" | "swipe";

/** Where a panel's tap was made. */
export type TapFrom = "palette" | "map" | "panel" | "chip" | "send-now";

/** What a panel's tap asked: its action and values where it has one, where it came from, and the words of what was pressed and on what. */
export interface PanelAsk {
  action: string | null;
  values: JsonObject;
  from: TapFrom;
  what: string;
  on: string | null;
}

/** What a composer control asked: the choice made, as its choices file names it, and any words typed with it. */
export interface ComposerAsk {
  choice: string;
  words: string | null;
}

/** One request as kept. */
export interface RequestRecord {
  id: string;
  chat: string;
  kind: RequestKind;
  asked: PanelAsk | ComposerAsk;
  /** Played now, as a message of its own, rather than with the next message. */
  played: boolean;
  /** The message it was sent as, where it was played now; null otherwise. */
  message: string | null;
  /** The turn it is kept with; null while it waits. */
  turn: string | null;
  at: number;
}

interface RequestRow {
  id: string;
  chat: string;
  kind: string;
  asked: string;
  played: number;
  message: string | null;
  turn: string | null;
  at: number;
}

const recordOf = (r: RequestRow): RequestRecord => ({ id: r.id, chat: r.chat, kind: r.kind as RequestKind, asked: JSON.parse(r.asked) as PanelAsk | ComposerAsk, played: r.played === 1, message: r.message, turn: r.turn, at: r.at });

/** A request waits while it is kept with no turn, or with one dropped with nothing saved, or one the store no longer holds. */
const WAITS = "(r.turn IS NULL OR NOT EXISTS (SELECT 1 FROM turn t WHERE t.user = r.user AND t.id = r.turn AND t.status <> 'dropped'))";

/** What withdrawing a request came to: withdrawn; kept with a turn already, which it names; or no such request of the chat's. */
export type Withdrawn = { withdrawn: true } | { kept: string } | null;

/** A request carried onto a given turn (the migration's writer, PlanCarry). */
export interface CarriedRequest {
  id: string;
  kind: RequestKind;
  asked: PanelAsk | ComposerAsk;
  played: boolean;
  message: string | null;
  at: number;
}

export class Requests {
  constructor(
    private readonly db: Database,
    private readonly writes: Writes,
    /** Told whenever what waits in a chat changed, with how many wait now: the chat's followers are told on the live hub. */
    private readonly told: (chat: string, waiting: number) => void,
  ) {}

  /** Tells the chat's followers that what waits in it changed. */
  changed(user: string, chat: string): void {
    this.told(chat, this.waiting(user, chat).length);
  }

  /** What waits in the chat, oldest first. */
  waiting(user: string, chat: string): RequestRecord[] {
    return this.db.query<RequestRow, [string, string]>(`SELECT r.* FROM request r WHERE r.user = ? AND r.chat = ? AND ${WAITS} ORDER BY r.at, r.rowid`).all(user, chat).map(recordOf);
  }

  /** Holds a request: it waits for the next turn that answers a new message, in place of one of its kind that waited. */
  async hold(user: string, chat: string, ask: { kind: RequestKind; asked: PanelAsk | ComposerAsk; played?: boolean; message?: string | null }, at: number): Promise<RequestRecord> {
    const request: RequestRecord = { id: crypto.randomUUID(), chat, kind: ask.kind, asked: ask.asked, played: ask.played === true, message: ask.message ?? null, turn: null, at };
    await this.writes.run((db) => {
      db.run(`DELETE FROM request WHERE user = ? AND chat = ? AND kind = ? AND rowid IN (SELECT r.rowid FROM request r WHERE r.user = ? AND r.chat = ? AND ${WAITS})`, [user, chat, ask.kind, user, chat]);
      db.run("INSERT INTO request (user, id, chat, kind, asked, played, message, turn, at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)", [user, request.id, chat, request.kind, JSON.stringify(request.asked), request.played ? 1 : 0, request.message, at]);
    }, "holding what the player asked for");
    this.changed(user, chat);
    return request;
  }

  /** Withdraws a request that waits; one kept with a turn stays, and the answer names the turn. */
  async withdraw(user: string, chat: string, id: string): Promise<Withdrawn> {
    const out = await this.writes.run((db): Withdrawn => {
      const row = db.query<RequestRow & { waits: number }, [string, string, string]>(`SELECT r.*, ${WAITS} AS waits FROM request r WHERE r.user = ? AND r.chat = ? AND r.id = ?`).get(user, chat, id);
      if (row === null) return null;
      if (row.waits !== 1 && row.turn !== null) return { kept: row.turn };
      db.run("DELETE FROM request WHERE user = ? AND id = ?", [user, id]);
      return { withdrawn: true };
    }, "withdrawing what the player asked for");
    if (out !== null && "withdrawn" in out) this.changed(user, chat);
    return out;
  }

  /** The requests kept with a turn, oldest first, and those played as its message. */
  ofTurn(user: string, turn: string, message: string | null): RequestRecord[] {
    return this.db
      .query<RequestRow, [string, string, string | null]>("SELECT r.* FROM request r WHERE r.user = ?1 AND (r.turn = ?2 OR (r.played = 1 AND ?3 IS NOT NULL AND r.message = ?3)) ORDER BY r.at, r.rowid")
      .all(user, turn, message)
      .map(recordOf);
  }

  /**
   * What a turn is told: one that answers a new message (`attempts` null), what waits in the chat but a swipe's mode, which waits for the
   * next swipe; a swipe or a regenerate, which answers the message its earlier attempts answered (`attempts`), what they were told but
   * the mode of an earlier swipe, and the swipe's mode that waits, asked for this attempt.
   */
  forTurn(user: string, chat: string, attempts: readonly string[] | null): RequestRecord[] {
    const waiting = this.waiting(user, chat);
    if (attempts === null) return waiting.filter((r) => r.kind !== "swipe");
    const told = this.db
      .query<RequestRow, [string, string, string]>("SELECT r.* FROM request r WHERE r.user = ? AND r.chat = ? AND r.turn IN (SELECT value FROM json_each(?)) ORDER BY r.at, r.rowid")
      .all(user, chat, JSON.stringify(attempts))
      .map(recordOf);
    return [...told.filter((r) => r.kind !== "swipe"), ...waiting.filter((r) => r.kind === "swipe")];
  }

  /** Keeps what a turn was told with it, inside the caller's write: each request that waits, or whose turn no longer stands, is now its. */
  tell(into: Database, user: string, ids: readonly string[], turn: string): void {
    if (ids.length === 0) return;
    into.run(`UPDATE request SET turn = ? WHERE rowid IN (SELECT r.rowid FROM request r WHERE r.user = ? AND r.id IN (SELECT value FROM json_each(?)) AND ${WAITS})`, [turn, user, JSON.stringify(ids)]);
  }
}

/** The carrier's writer (PlanCarry): a request put onto a given turn, inside the carrier's own write; told to no turn after it. */
export function carryRequest(into: Database, user: string, chat: string, turn: string, r: CarriedRequest): void {
  into.run("INSERT OR REPLACE INTO request (user, id, chat, kind, asked, played, message, turn, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [user, r.id, chat, r.kind, JSON.stringify(r.asked), r.played ? 1 : 0, r.message, turn, r.at]);
}

/**
 * Drops, inside the caller's write, what the store's removals leave of the user's requests: one kept with a turn the store no longer
 * holds, and one in a chat the store no longer holds.
 */
export function dropLeftoverRequests(into: Database, user: string): void {
  into.run("DELETE FROM request WHERE user = ? AND turn IS NOT NULL AND NOT EXISTS (SELECT 1 FROM turn t WHERE t.user = request.user AND t.id = request.turn)", [user]);
  into.run("DELETE FROM request WHERE user = ? AND NOT EXISTS (SELECT 1 FROM chat c WHERE c.user = request.user AND c.id = request.chat)", [user]);
}
