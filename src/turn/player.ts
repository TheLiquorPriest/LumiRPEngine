// The player's side of what has happened since the last turn (plan §6.3, §10.10): the player's messages
// as RPE read them, so an edit of one can be told with the text it had before. What he asks for beside
// his words is the request store's (`requests.ts`).

import type { Database } from "bun:sqlite";

/** A player's message's text as RPE read it, by the hash it had then. */
export interface PlayerText {
  message: string;
  hash: string;
  text: string;
}

export class PlayerSide {
  constructor(private readonly db: Database) {}

  /** The text a message of the player's had when its hash was `hash`; null when RPE never read it so. */
  textOf(user: string, chat: string, message: string, hash: string): string | null {
    return this.db.query<{ text: string }, [string, string, string, string]>("SELECT text FROM player_text WHERE user = ? AND chat = ? AND message = ? AND hash = ?").get(user, chat, message, hash)?.text ?? null;
  }

  /** Keeps messages' texts as read; inside a queued write. */
  keepTexts(into: Database, user: string, chat: string, texts: readonly PlayerText[]): void {
    const put = into.query("INSERT OR IGNORE INTO player_text (user, chat, message, hash, text) VALUES (?, ?, ?, ?, ?)");
    for (const t of texts) put.run(user, chat, t.message, t.hash, t.text);
  }
}
