// The test bed of the generation's life (`save.test.ts`, `thinking.test.ts`, `events.test.ts`): a stand-in Lumiverse with a database, one chat on a boat, and a plain model
// that answers each request from a script of the test's. Every name is invented.

import { StandInDb } from "../../standin/db";
import { PROCESS_CLOCK, type HostClock } from "../../standin/host";
import { StandIn, type Connection, type Outcome, type Preset } from "../../standin/lumiverse";
import { ScriptedProvider, type PlainReply } from "../../standin/provider";

export const USER = "user-boat";
export const CHAT = "chat-boat";
export const ORIGIN = "http://127.0.0.1:7887";

const open: StandInDb[] = [];

/** Closes every database the test bed opened; each test file calls it after each test. */
export function closeBoats(): void {
  for (const db of open.splice(0)) db.close();
}

export interface Boat {
  lv: StandIn;
  db: StandInDb;
  provider: ScriptedProvider;
}

/** The boat's chat: Edda's, with one line of the player's; the preset a main block and the chat's history, as given beside them; each request answered by the next of `replies`. */
export function boat(replies: PlainReply[], options: { preset?: Partial<Preset>; connection?: Partial<Connection>; clock?: HostClock; messages?: { id: string; role: "user" | "assistant"; content: string }[] } = {}): Boat {
  const lv = new StandIn();
  const clock = options.clock ?? PROCESS_CLOCK;
  lv.clock = clock;
  const db = new StandInDb();
  open.push(db);
  db.write({ user: [{ id: USER, name: "Oona", email: "oona@example.invalid", username: "oona" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
  lv.db = db;
  const provider = new ScriptedProvider(clock, ...replies);
  lv.servers.set(ORIGIN, provider.server);
  lv.connections.set("conn-model", { id: "conn-model", base: `${ORIGIN}/v1`, key: "model-key", model: "model", ...options.connection });
  lv.presets.set("preset-boat", {
    id: "preset-boat",
    name: "Boat",
    blocks: [
      { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a boat on a river." },
      { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" },
    ],
    ...options.preset,
  });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-edda", name: "Edda" }, messages: options.messages ?? [{ id: "m0", role: "user", content: "USER-1 I steer the boat." }] });
  return { lv, db, provider };
}

/** A generation of the boat's chat, ended. */
export function generate(b: Boat, input: { type?: "normal" | "swipe" | "regenerate" | "continue" | "impersonate"; parameters?: Record<string, unknown>; impersonateDraft?: boolean } = {}): Promise<Outcome> {
  return b.lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-boat", ...input });
}

/** What the database holds of a message: its text, its swipes, its extra as stored. */
export function rowOf(b: Boat, id: string): { content: string; swipes: string[]; extra: Record<string, unknown> } {
  const row = b.db.rows("SELECT content, swipes, extra FROM messages WHERE id = ?", id)[0];
  if (row === undefined) throw new Error(`no such message ${id}`);
  return { content: String(row.content), swipes: JSON.parse(String(row.swipes)) as string[], extra: JSON.parse(String(row.extra)) as Record<string, unknown> };
}
