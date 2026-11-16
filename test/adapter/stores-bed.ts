// A signed-in session on the stand-in Lumiverse with one chat of one invented user, for the tests of what the door asks of Lumiverse's routes.

import { createDbReader } from "../../src/adapter/lumiverse/db";
import { LumiverseSession } from "../../src/adapter/lumiverse/session";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import { FakeClock } from "../standin/clock";
import { StandInDb } from "../standin/db";
import { LumiverseServer } from "../standin/http";
import { StandIn } from "../standin/lumiverse";

export interface StoresBed {
  db: StandInDb;
  /** The stand-in Lumiverse, which holds each chat beside its rows. */
  host: StandIn;
  server: LumiverseServer;
  session: LumiverseSession;
  reads: LumiverseReads;
}

export async function createChatReadsStub(closing: (() => void)[], tokenizedModels: string[] = []): Promise<StoresBed> {
  const db = new StandInDb();
  db.write({
    user: [{ id: "user-tamsin", name: "tamsin", email: "tamsin@example.invalid", username: "tamsin" }],
    characters: [{ id: "char-a", name: "Mara", user_id: "user-tamsin" }],
    chats: [{ id: "chat-1", user_id: "user-tamsin", character_id: "char-a", name: "One", metadata: "{}" }],
    messages: [],
    world_books: [],
    world_book_entries: [],
    personas: [],
    presets: [],
    settings: [],
    message_breakdowns: [],
  });
  const clock = new FakeClock();
  // The stand-in Lumiverse holds the chat beside its rows, as its write routes need (`test/standin/chatwrites.ts`).
  const host = new StandIn();
  host.db = db;
  host.chats.set("chat-1", { id: "chat-1", user: "user-tamsin", character: { id: "char-a", name: "Mara" }, name: "One", metadata: {}, messages: [] });
  const server = new LumiverseServer({ clock, db, host, tokenizedModels, accounts: [{ id: "user-tamsin", username: "reader", password: "lamp oil lamp" }] });
  const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => "user-tamsin", clock, log: () => undefined });
  await session.signIn("reader", "lamp oil lamp");
  const reads = createDbReader({ path: db.path, user: "user-tamsin", sleep: async () => undefined, log: () => undefined });
  closing.push(() => {
    reads.close();
    server.stop();
    db.close();
  });
  return { db, host, server, session, reads };
}
