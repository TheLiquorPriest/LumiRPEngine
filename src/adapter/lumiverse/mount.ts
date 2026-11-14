// RPE's door to Lumiverse, put together and mounted in the app (STANDALONE-PLAN §4.2, §4.3, §4.4): the
// session as RPE's user, the reads (the database file where RPE runs beside Lumiverse, its HTTP routes
// otherwise), the chat port, the event socket and the changes it hears, the relay socket and the relay,
// and the routes: the provider endpoint and its model list, which the app holds to the provider key;
// and the routes only the extension calls (its question, a page's start-up facts, a page's follows),
// which the app holds to the extension's registration key, and which serve only the Lumiverse user RPE
// belongs to.
//
// The app (`src/app/`) mounts it as an area. Its sockets open, and it registers with the extension,
// only once the server listens (the area's `started`): the registration carries RPE's address, and a
// new registration key, made then and handed to the extension at once, the app keeping only its hash.

import type { Clock, HistoryRange, ModelsApi } from "rp-harness/contract";
import { AuthRefused, bearerOf, rawRoute, type App, type Area } from "../../app";
import { isRecord } from "../../shared/json";
import { questionRoute, type HistoryWindow, type SecrecyRules } from "./answer";
import { createChatReads, type ChatReads } from "./chat";
import { createDbReader, type DbReader } from "./db";
import { followChanges, type ChatChanges } from "./events";
import { blocksHint } from "./hint";
import { createHttpReads } from "./http-reads";
import { EXTENSION_IDENTIFIER, LIVE_PATH, readLiveAsk, START_PATH, USER_HEADER, type MissingPermission, type Registration, type StartFacts } from "./pipe-wire";
import { modelsEndpoint, providerEndpoint, type TurnPlayer } from "./provider";
import { preferDatabase, type LumiverseReads } from "./reads";
import { Relay, type RelaySettings } from "./relay";
import { LumiverseSession, type Fetch, type StoredSignIn } from "./session";
import { LumiverseSocket, newFrontendSession, type OpenSocket, type SocketSettings } from "./socket";
import { QUESTION_PATH } from "./wire";

/** What other lanes answer for the adapter. */
export interface AdapterLanes {
  /** The turn lane (`src/turn/`): a tagged reply played. */
  turns: TurnPlayer;
  /** The turn lane: Lumiverse's changes to the user's chats. */
  changes: ChatChanges;
  /** The history window: the first history message to keep. */
  window: HistoryWindow;
  /** The lore lane: what each secret reads as in this prompt. */
  secrecy: SecrecyRules;
  /** A chat's setting: agents may read the messages the user hid. */
  hiddenReadable(chat: string): Promise<boolean>;
  /** The story lane: the stretches a chat names (`scene`, since the scene opened). */
  ranges(chat: string): Promise<Record<string, HistoryRange>>;
  /** The turn lane: the messages Lumiverse's memory stands in for with a summary in the chat's prompt, from the tag's `summary` marks. */
  summarized(chat: string): Promise<ReadonlySet<string>>;
  /** RPH's model layer, for requests passed through. */
  models: Pick<ModelsApi, "pass">;
  /** The connection a request with no tag goes on; null for RPH's default (a user's choice, kept with RPE's global settings). */
  passConnection(): string | null;
  /** What the extension says it is missing, for RPE's UI. */
  permissions(missing: MissingPermission[]): void;
}

export interface AdapterDeps {
  fetch: Fetch;
  open: OpenSocket;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  sleep(ms: number): Promise<void>;
  socket?: Partial<SocketSettings>;
  relay?: Partial<RelaySettings>;
  /** How long a turn may be silent before its progress line is restated. */
  keepAliveMs?: number;
}

/** RPE's door to Lumiverse, once mounted. */
export interface Lumiverse {
  session: LumiverseSession;
  reads: LumiverseReads;
  chat: ChatReads;
  /** The event socket: Lumiverse's events about the user's chats. */
  events: LumiverseSocket;
  /** The relay socket, and the relay on it. */
  relaySocket: LumiverseSocket;
  relay: Relay;
  /** The database reader, where RPE reads Lumiverse's file. */
  database: DbReader | null;
}

export interface LumiverseDoor {
  /**
   * The app's area: the adapter's routes and its parts, made from the app's config and secrets when
   * mounted; its sockets open, the session is kept and RPE registers with the extension once the
   * server listens (`started`), and all of it stops when the app closes (`stopping`).
   */
  readonly area: Area;
  /** The parts, once the area is mounted in an app set up for a Lumiverse user; null before. */
  lumiverse(): Lumiverse | null;
}

/** Fixed: a question carries the chat's whole path and the marked lore's text, past the app's 1 MiB for other bodies. */
export const QUESTION_BODY_BYTES = 8 * 1024 * 1024;

const NOT_SET_UP = "RPE is not set up for a Lumiverse yet: give it Lumiverse's address and your Lumiverse user (rpe up).";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** A sign-in as RPE's secrets keep it, or null. */
function storedSignIn(value: unknown): StoredSignIn | null {
  if (!isRecord(value) || typeof value.username !== "string" || typeof value.token !== "string" || typeof value.user !== "string" || typeof value.savedAt !== "number") return null;
  return { username: value.username, token: value.token, user: value.user, savedAt: value.savedAt };
}

const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\]|::1)$/;
const WILDCARD = /^(?:0\.0\.0\.0|::|\[::\])$/;

export function lumiverseDoor(lanes: AdapterLanes, deps: AdapterDeps): LumiverseDoor {
  let app: App | null = null;
  let parts: Lumiverse | null = null;
  let key: string | null = null;
  let offChanges: (() => void) | null = null;
  const relaySession = newFrontendSession();
  const log = (message: string): void => app?.log.warn(`[lumiverse] ${message}`);

  /** RPE's address for the extension's road: on loopback, which a wildcard listen includes. */
  const base = (): string | null => {
    const listening = app?.listening();
    if (app === null || listening === null || listening === undefined) return null;
    const address = app.config.address.toLowerCase();
    return LOOPBACK.test(address) || WILDCARD.test(address) ? `http://127.0.0.1:${listening.port}` : listening.url;
  };
  /** Where a browser may reach RPE directly: this machine's loopback, then every name RPE is published at. */
  const addresses = (): string[] => {
    const own = base();
    return [...(own === null ? [] : [own]), ...(app?.config.hosts ?? []).map((host) => `https://${host}`)];
  };

  function build(at: App, user: string, url: string, signIn: StoredSignIn | null): Lumiverse {
    const cfg = at.config.lumiverse;
    const session = new LumiverseSession({ base: url.replace(/\/+$/, ""), fetch: deps.fetch, signIn, save: (s) => at.secrets.write("lumiverse", s === null ? null : { ...s }), owner: () => user, clock: deps.clock, log });
    const http = createHttpReads(session);
    const database = cfg.database === null ? null : createDbReader({ path: cfg.database, user, sleep: deps.sleep, log });
    const reads = database === null ? http : preferDatabase(database, http);
    const chat = createChatReads({ reads, user, hiddenReadable: lanes.hiddenReadable, ranges: lanes.ranges, summarized: lanes.summarized });
    const settings = deps.socket ? { settings: deps.socket } : {};
    const events = new LumiverseSocket({ session, open: deps.open, clock: deps.clock, log: (m) => log(`event socket: ${m}`), ...settings });
    const relaySocket = new LumiverseSocket({ session, open: deps.open, clock: deps.clock, log: (m) => log(`relay socket: ${m}`), frontendSession: relaySession, ...settings });
    const registration = (): Registration | null => {
      const road = base();
      return road === null || key === null ? null : { v: 1, base: road, key, connection: at.config.lumiverse.connection, relay: relaySession, build: at.version };
    };
    const relay = new Relay({
      socket: relaySocket,
      extension: async () => {
        // `GET /api/v1/spindle` lists the extensions the user may use, each with Lumiverse's id (`routes/spindle.routes.ts:46-59`).
        const body = await session.json("GET", "/api/v1/spindle");
        const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e) => isRecord(e) && e.identifier === EXTENSION_IDENTIFIER) : undefined;
        if (!isRecord(found) || typeof found.id !== "string") throw new Error(`RPE's extension (${EXTENSION_IDENTIFIER}) is not installed in Lumiverse for this user`);
        return found.id;
      },
      registration,
      follow: (chatId, take) => at.live.follow(chatId, { take: (_batch, text) => take(text) }),
      clock: deps.clock,
      log: (m) => log(`relay: ${m}`),
      permissions: lanes.permissions,
      ...(deps.relay ? { settings: deps.relay } : {}),
    });
    return { session, reads, chat, events, relaySocket, relay, database };
  }

  /** The adapter's handlers, made once the area is mounted in an app set up for a Lumiverse user. */
  interface Handlers {
    user: string;
    provider(request: Request): Promise<Response>;
    question(request: Request): Promise<Response>;
  }
  let handlers: Handlers | null = null;
  const notSetUp = (): Response => json(503, { error: NOT_SET_UP });

  /** One of the extension's routes, for RPE's own user alone (the app has checked the key). */
  const forOwner =
    (handler: (body: unknown, user: string, parts: Lumiverse) => Promise<Response>) =>
    async (request: Request): Promise<Response> => {
      if (handlers === null || parts === null) return notSetUp();
      if (request.headers.get(USER_HEADER) !== handlers.user) return json(403, { error: "This RPE belongs to another Lumiverse user." });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(400, { error: "The request is not JSON." });
      }
      return handler(body, handlers.user, parts);
    };

  const area: Area = {
    name: "lumiverse",
    async mount(at) {
      app = at;
      const providerKey = (request: Request): boolean => at.auth.holds("provider", bearerOf(request));
      const modelNames = (): string[] => at.config.lumiverse.models;
      const { url, user } = at.config.lumiverse;
      if (url !== null && user !== null) {
        const p = build(at, user, url, storedSignIn(await at.secrets.read("lumiverse")));
        parts = p;
        handlers = {
          user,
          provider: providerEndpoint({
            user,
            allowed: providerKey,
            window: lanes.window,
            blocks: blocksHint({ reads: p.reads, session: p.session, log }),
            models: lanes.models,
            passConnection: lanes.passConnection,
            modelNames,
            turns: lanes.turns,
            clock: deps.clock,
            ...(deps.keepAliveMs !== undefined ? { keepAliveMs: deps.keepAliveMs } : {}),
            log,
          }),
          question: questionRoute({ secrecy: lanes.secrecy, window: lanes.window, allowed: (request) => request.headers.get(USER_HEADER) === user, log }),
        };
      }
      at.routes.add("lumiverse", [
        rawRoute({ method: "POST", path: "/v1/chat/completions", access: "provider", raw: (request) => (handlers === null ? notSetUp() : handlers.provider(request)) }),
        rawRoute({ method: "GET", path: "/v1/models", access: "provider", raw: modelsEndpoint({ allowed: providerKey, modelNames }) }),
        rawRoute({ method: "POST", path: QUESTION_PATH, access: "extension", maxBody: QUESTION_BODY_BYTES, raw: (request) => (handlers === null ? notSetUp() : handlers.question(request)) }),
        rawRoute({
          method: "POST",
          path: START_PATH,
          access: "extension",
          raw: forOwner(async (_body, owner) => {
            try {
              const minted = await at.auth.mintPageToken(owner, "extension");
              const facts: StartFacts = { token: minted.token, expiresAt: minted.expires, addresses: addresses(), build: at.version };
              return json(200, facts);
            } catch (error) {
              if (error instanceof AuthRefused) return json(error.status, { error: error.message });
              throw error;
            }
          }),
        }),
        rawRoute({
          method: "POST",
          path: LIVE_PATH,
          access: "extension",
          raw: forOwner(async (body, _owner, p) => {
            const ask = readLiveAsk(body);
            if (ask === null) return json(400, { error: "That is not a follow RPE reads." });
            p.relay.ask(ask);
            return json(200, {});
          }),
        }),
      ]);
    },
    async started(at) {
      if (parts === null) return;
      // A new key at each start, handed to the extension in the registration: the one before it is retired.
      key = (await at.auth.makeKey("extension")).key;
      offChanges = followChanges(parts.events, lanes.changes);
      parts.relay.start();
      parts.session.keep();
      parts.events.start();
      parts.relaySocket.start();
    },
    stopping() {
      offChanges?.();
      offChanges = null;
      if (parts === null) return;
      parts.relay.stop();
      parts.events.stop();
      parts.relaySocket.stop();
      parts.session.stop();
      parts.database?.close();
    },
  };

  return { area, lumiverse: () => parts };
}
