// The player's side of what has happened since the last turn (plan §6.3, §10.10): the player's messages
// as RPE read them, so an edit of one can be told with the text it had before; and what the player
// asked for through a panel, as part of their next message, told to the turn that answers it whatever
// that turn follows, and again only to a swipe of that turn. Which turn was told which request is kept
// beside what a comparison found (`since_told`, written through `SinceKept.told`).

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

  /** Holds a panel request: part of the player's next message, for the turn that answers it. */
  async hold(user: string, chat: string, ask: { what: string; on: string | null }, at: number): Promise<PanelRequest> {
    const request: PanelRequest = { id: crypto.randomUUID(), what: ask.what, on: ask.on, at };
    await this.writes.run((db) => db.run(`INSERT INTO panel_request (user, id, chat, what, "on", at) VALUES (?, ?, ?, ?, ?, ?)`, [user, request.id, chat, request.what, request.on, request.at]), "holding a request from a panel");
    return request;
  }

  /**
   * The requests a turn is told, oldest first. A turn that answers a new message (`attempts` null): the chat's requests that no turn
   * standing was told, a turn dropped with nothing saved telling none. A swipe or a regenerate, which answers the message its earlier
   * attempts answered (`attempts`): the requests they were told.
   */
  requestsFor(user: string, chat: string, attempts: readonly string[] | null): PanelRequest[] {
    if (attempts === null) {
      return this.db
        .query<PanelRequest, [string, string]>(
          `SELECT r.id, r.what, r."on" AS "on", r.at FROM panel_request r WHERE r.user = ?1 AND r.chat = ?2 AND NOT EXISTS (
             SELECT 1 FROM since_told t JOIN turn u ON u.user = t.user AND u.id = t.turn WHERE t.user = ?1 AND t.item = r.id AND u.status <> 'dropped')
           ORDER BY r.at, r.rowid`,
        )
        .all(user, chat);
    }
    return this.db
      .query<PanelRequest, [string, string, string]>(
        `SELECT r.id, r.what, r."on" AS "on", r.at FROM panel_request r WHERE r.user = ?1 AND r.chat = ?2 AND EXISTS (
           SELECT 1 FROM since_told t WHERE t.user = ?1 AND t.item = r.id AND t.turn IN (SELECT value FROM json_each(?3)))
         ORDER BY r.at, r.rowid`,
      )
      .all(user, chat, JSON.stringify(attempts));
  }
}
