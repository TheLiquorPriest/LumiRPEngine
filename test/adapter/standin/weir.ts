// The test bed of the stand-in server's route tests (`reads.test.ts`, `writes.test.ts`): a database with two users in it, the stand-in
// host behind a server, a signed-in session of each user, and the weir's chat on a model that answers every request with one line.
// Every name is invented.

import { LumiverseSession } from "../../../src/adapter/lumiverse/session";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import { FakeClock } from "../../standin/clock";
import { StandInDb, type Rows } from "../../standin/db";
import { LumiverseServer, type LumiverseServerOptions } from "../../standin/http";
import { StandIn, type ChatMessage, type Preset } from "../../standin/lumiverse";

export const USER = "user-mara";
export const OTHER = "user-pell";
export const CHAT = "chat-weir";
export const PASSWORD = "reed lamp reed";
const MODEL = "http://127.0.0.1:7881";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

export const json = (value: unknown): string => JSON.stringify(value);

const EMPTY: Rows = { user: [], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] };
const USERS = [
  { id: USER, name: "Mara", email: "mara@example.invalid", username: "mara" },
  { id: OTHER, name: "Pell", email: "pell@example.invalid", username: "pell" },
];

/** One signed-in user of the weir's server: each call carries the user's bearer. */
export interface Asker {
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
  patch(path: string, body: unknown): Promise<Response>;
  delete(path: string): Promise<Response>;
  session: LumiverseSession;
}

export interface Weir {
  db: StandInDb;
  server: LumiverseServer;
  host: StandIn;
  clock: FakeClock;
  as(user: string): Asker;
}

/** The weir's server and a database with `rows` and the two users in it, a session of each user; what `closing` is given closes them. */
export async function weir(closing: (() => void)[], rows: Partial<Rows> = {}, options: Partial<LumiverseServerOptions> = {}): Promise<Weir> {
  const db = new StandInDb();
  closing.push(() => db.close());
  db.write({ ...EMPTY, ...rows, user: USERS });
  const host = new StandIn();
  host.db = db;
  const clock = new FakeClock();
  const server = new LumiverseServer({ clock, db, host, accounts: [USER, OTHER].map((id) => ({ id, username: id.replace("user-", ""), password: PASSWORD })), ...options });
  closing.push(() => server.stop());
  const sessions = new Map<string, LumiverseSession>();
  const tokens = new Map<string, string>();
  for (const id of [USER, OTHER]) {
    const session = new LumiverseSession({ base: server.base, fetch: server.fetch, signIn: null, save: async () => undefined, owner: () => id, clock, log: () => undefined });
    tokens.set(id, (await session.signIn(id.replace("user-", ""), PASSWORD)).token);
    sessions.set(id, session);
  }
  const send = (user: string, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Response> =>
    server.fetch(`${server.base}${path}`, { method, headers: { authorization: `Bearer ${tokens.get(user)!}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return {
    db,
    server,
    host,
    clock,
    as: (user) => ({
      session: sessions.get(user)!,
      get: (path, headers = {}) => send(user, "GET", path, headers),
      post: (path, body) => send(user, "POST", path, {}, body),
      put: (path, body) => send(user, "PUT", path, {}, body),
      patch: (path, body) => send(user, "PATCH", path, {}, body),
      delete: (path) => send(user, "DELETE", path, {}),
    }),
  };
}

/** The weir's chat of `messages` in a database, on a model that answers every request with one line; how often the model was asked is `asked()`. */
export async function weirChat(closing: (() => void)[], messages: ChatMessage[], preset: Partial<Preset> = {}): Promise<Weir & { asked(): number }> {
  const bed = await weir(closing);
  let asked = 0;
  bed.host.servers.set(MODEL, async (request) => {
    asked++;
    return streamedReply(async (out) => out.content("NEW-TEXT the eel slips under the weir."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, keepAlive: null });
  });
  bed.host.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  bed.host.presets.set("preset-weir", { id: "preset-weir", name: "Weir", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a night at the weir." }], ...preset });
  bed.host.addChat({ id: CHAT, user: USER, character: { id: "char-ilsa", name: "Ilsa" }, messages });
  return { ...bed, asked: () => asked };
}

/** The chat so far: Ilsa's greeting, the player's line, her reply, the player's next line. */
export const LINES: ChatMessage[] = [
  { id: "m0", role: "assistant", content: "GREET The weir hums in the dark." },
  { id: "m1", role: "user", content: "USER-1 I lower the lantern." },
  { id: "m2", role: "assistant", content: "REPLY-1 Ilsa points at the water." },
  { id: "m3", role: "user", content: "USER-2 I step to the edge." },
];
