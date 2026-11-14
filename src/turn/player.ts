// The player's side of what has happened since the last turn (plan §6.3, §10.10): the player's messages
// as RPE read them, so an edit of one can be told with the text it had before; and what the player
// asked for through a panel, as part of their next message, held for the turns that answer it.

import type { Database } from "bun:sqlite";
import type { Writes } from "./kv";

/** A tap on a panel that is part of the player's next message: what was pressed, and on what. */
export interface PanelRequest {
  id: string;
  what: string;
  on: string | null;
  at: number;
}

/** A player's message's text as RPE read it, by the hash it had then. */
export interface PlayerText {
  message: string;
  hash: string;
  text: string;
}

export class PlayerSide {
  constructor(
    private readonly db: Database,
    private readonly writes: Writes,
  ) {}

  /** The text a message of the player's had when its hash was `hash`; null when RPE never read it so. */
  textOf(user: string, chat: string, message: string, hash: string): string | null {
    return this.db.query<{ text: string }, [string, string, string, string]>("SELECT text FROM player_text WHERE user = ? AND chat = ? AND message = ? AND hash = ?").get(user, chat, message, hash)?.text ?? null;
  }

  /** Keeps messages' texts as read; inside a queued write. */
  keepTexts(into: Database, user: string, chat: string, texts: readonly PlayerText[]): void {
    const put = into.query("INSERT OR IGNORE INTO player_text (user, chat, message, hash, text) VALUES (?, ?, ?, ?, ?)");
    for (const t of texts) put.run(user, chat, t.message, t.hash, t.text);
  }

  /**
   * Holds a panel request for every turn that follows `after`: the turn whose reply was the chat's newest when it was made, null
   * before the chat's first turn. A swipe of such a turn answers the same message, so it is given the same requests.
   */
  async hold(user: string, chat: string, after: string | null, ask: { what: string; on: string | null }, at: number): Promise<PanelRequest> {
    const request: PanelRequest = { id: crypto.randomUUID(), what: ask.what, on: ask.on, at };
    await this.writes.run(
      (db) => db.run(`INSERT INTO panel_request (user, id, chat, after, what, "on", at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [user, request.id, chat, after, request.what, request.on, request.at]),
      "holding a request from a panel",
    );
    return request;
  }

  /** The requests held for a turn that follows `after`, oldest first. */
  requests(user: string, chat: string, after: string | null): PanelRequest[] {
    return this.db
      .query<{ id: string; what: string; on: string | null; at: number }, [string, string, string | null]>(`SELECT id, what, "on" AS "on", at FROM panel_request WHERE user = ? AND chat = ? AND after IS ? ORDER BY at, rowid`)
      .all(user, chat, after);
  }
}
