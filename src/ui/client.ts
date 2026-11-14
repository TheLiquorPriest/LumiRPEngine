// One typed client over RPE's API (plan §4.4), the same for both shells and every page. A call names its
// route as the route table writes it ("GET /api/v1/chats/:chat/turns") and gets back what that route
// answers; whoever follows a chat gets its live events. Behind it is one of the two roads (roads.ts). The
// web shell, served by RPE itself, is always direct. In Lumiverse's drawer the client asks the extension
// for its start-up facts, tries RPE's addresses from the page, and takes the relay when none answers,
// keeping why, so the page can say which road it is on and why.

import { createStore, type Readable } from "../frontend/store";
import { isRecord } from "../shared/json";
import { type LiveEvent, type MissingPermission, type RouteKey, type Routes, SESSION_PATH } from "./api";
import { type Credential, directRoad, type LiveUpdate, probeDirect, type RelayChannel, relayRoad, type Road, type RoadAnswer, type RoadDeps, type SocketSettings, type StartFacts } from "./roads";
import { errorWords } from "./words";

/** RPE refused a call, in its own words; `status` 0 when RPE was not reached at all. */
export class RpeError extends Error {
  override name = "RpeError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Where the client stands: nothing asked of RPE yet, finding a road, on one (and for the relay, why),
 * unable to reach RPE, or waiting for the web UI's token.
 */
export type ClientState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "direct"; address: string }
  | { phase: "relay"; why: string }
  | { phase: "failed"; error: string }
  | { phase: "signed-out"; error: string | null };

type PathOf<K extends string> = K extends `${string} ${infer P}` ? P : never;
/** A segment's param name: `:chat` names `chat`; the last segment `*`, the rest of the path, is named `*`. */
type ParamName<S extends string> = S extends `:${infer N}` ? N : S extends "*" ? "*" : never;
type ParamNames<P extends string> = P extends `${infer Head}/${infer Tail}` ? ParamName<Head> | ParamNames<Tail> : ParamName<P>;
/** A route's path params, by the names its pattern gives them. */
export type ParamsOf<K extends RouteKey> = { readonly [N in ParamNames<PathOf<K>>]: string };

export interface CallOptions<K extends RouteKey> {
  query?: Routes[K]["query"];
  body?: Routes[K]["body"];
}

/** Whoever follows a chat. */
export interface LiveListener {
  /** The chat's events, in order; `missed` names the numbers the hub dropped before them. */
  events(events: readonly LiveEvent[], missed: { from: number; to: number } | null): void;
  /** Following has begun, or begun again after events were lost on the way: read afresh what the page shows. */
  reset(): void;
  /** RPE refused to follow the chat, or its live updates stopped and could not be had again: why, in the words of whoever said. */
  refused(words: string): void;
}

export interface RpeClient {
  readonly state: Readable<ClientState>;
  /** What the extension says it lacks, in its own word (the drawer); null where the page has none (the web shell: RPE's status route says it). */
  readonly missing: Readable<readonly MissingPermission[] | null>;
  call<K extends RouteKey>(key: K, params: ParamsOf<K>, options?: CallOptions<K>): Promise<Routes[K]["reply"]>;
  /** Follows a chat's live events; the returned function stops. */
  follow(chat: string, listener: LiveListener): () => void;
  /**
   * Calls `listener` each time the page is told to read afresh, for any chat: following one began, or
   * updates were lost on the way. What a page shows of RPE outside a chat's events is read again then.
   */
  onReset(listener: () => void): () => void;
  /** Finds a road now, unless one is found or being found: a shell does at its start, so the page says where it stands before any page asks. */
  connect(): void;
  /** Finds a road again: after a failure, or once the web UI's token is given. */
  reconnect(): void;
  close(): void;
}

export interface Connection {
  road: Road;
  credential: Credential;
  state: Extract<ClientState, { phase: "direct" | "relay" }>;
}

/** A connection that could not be made, with the state the page shows for it. */
export class ConnectFailure extends Error {
  override name = "ConnectFailure";

  constructor(readonly state: Extract<ClientState, { phase: "failed" | "signed-out" }>) {
    super(state.phase === "failed" ? state.error : (state.error ?? "Give the web UI's token to sign in."));
  }
}

export interface Connector {
  connect(): Promise<Connection>;
  /** Another road may answer when the direct one stops answering (the drawer: the relay). */
  readonly canSwitch: boolean;
  readonly missing: Readable<readonly MissingPermission[] | null>;
  close(): void;
}

/** `pattern` with its params put in, each encoded, and the query after it. The rest of the path (`*`) is put in segment by segment, its slashes kept. */
export function pathOf(pattern: string, params: Readonly<Record<string, string>>, query?: Readonly<Record<string, string | number | undefined>>): string {
  const path = pattern
    .split("/")
    .map((segment) => {
      if (segment !== "*" && !segment.startsWith(":")) return segment;
      const name = segment === "*" ? "*" : segment.slice(1);
      const value = params[name];
      if (value === undefined || value === "") throw new Error(`${pattern} needs its ${name}.`);
      return segment === "*" ? value.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(value);
    })
    .join("/");
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined) search.set(name, String(value));
  const tail = search.toString();
  return tail === "" ? path : `${path}?${tail}`;
}

/** RPE's refusal of a call, in its own words where its answer has them. */
function refusalOf(answer: RoadAnswer): RpeError {
  let body: unknown = null;
  try {
    body = JSON.parse(answer.text);
  } catch {
    // Not JSON: its status says what happened.
  }
  return new RpeError(answer.status, isRecord(body) && typeof body.error === "string" ? body.error : `RPE answered ${answer.status}.`);
}

/** A success's parsed JSON (undefined when it has none); a refusal is thrown. */
function readAnswer(answer: RoadAnswer): unknown {
  if (answer.status < 200 || answer.status >= 300) throw refusalOf(answer);
  if (answer.text === "") return undefined;
  try {
    return JSON.parse(answer.text);
  } catch {
    throw new RpeError(answer.status, "RPE's answer was not JSON.");
  }
}

export function createClient(connector: Connector): RpeClient {
  const state = createStore<ClientState>({ phase: "idle" });
  const listeners = new Map<string, Set<LiveListener>>();
  /** Chats the road in use follows now. */
  const following = new Set<string>();
  let current: Promise<Connection> | null = null;
  let road: Road | null = null;
  let offLive: (() => void) | null = null;
  let closed = false;
  const resets = new Set<() => void>();

  const each = (chat: string | undefined, act: (listener: LiveListener) => void): void => {
    for (const [at, set] of listeners) if (chat === undefined || chat === at) for (const listener of [...set]) act(listener);
  };
  const toldToReadAfresh = (): void => {
    for (const listener of [...resets]) listener();
  };

  /** The web UI's key no longer holds and this browser has let it go: the shell asks for another, and every call waits for it. */
  function signOut(refused: RpeError): void {
    drop();
    current = Promise.reject(refused);
    current.catch(() => undefined);
    state.set({ phase: "signed-out", error: refused.message });
  }

  function deliver(update: LiveUpdate): void {
    if (update.type === "events") each(update.chat, (l) => l.events(update.events, update.missed ?? null));
    else if (update.type === "reset") {
      each(update.chat, (l) => l.reset());
      toldToReadAfresh();
    } else if (update.type === "ended") {
      if (connector.canSwitch) each(undefined, (l) => l.refused("RPE's live updates stopped: the page's token no longer holds, and no other could be had."));
      else signOut(new RpeError(401, KEY_LET_GO));
    } else each(undefined, (l) => l.refused(update.message));
  }

  function followOn(on: Road, chat: string): void {
    on.follow(chat).then(
      () => {
        if (road !== on || !listeners.has(chat)) return;
        following.add(chat);
        each(chat, (l) => l.reset());
        toldToReadAfresh();
      },
      (error: unknown) => {
        if (road === on) each(chat, (l) => l.refused(errorWords(error)));
      },
    );
  }

  function connect(): Promise<Connection> {
    if (current !== null) return current;
    state.set({ phase: "connecting" });
    const attempt = connector.connect().then(
      (connection) => {
        if (closed || current !== attempt) {
          connection.road.close();
          throw new RpeError(0, closed ? "The page closed." : "RPE is being reached again.");
        }
        road = connection.road;
        offLive = road.onLive(deliver);
        state.set(connection.state);
        for (const chat of listeners.keys()) followOn(connection.road, chat);
        return connection;
      },
      (error: unknown) => {
        if (current === attempt) state.set(error instanceof ConnectFailure ? error.state : { phase: "failed", error: errorWords(error) });
        throw new RpeError(0, errorWords(error));
      },
    );
    current = attempt;
    return attempt;
  }

  function drop(): void {
    offLive?.();
    offLive = null;
    road?.close();
    road = null;
    current = null;
    following.clear();
  }

  async function send(connection: Connection, method: string, path: string, body: string | undefined): Promise<RoadAnswer> {
    try {
      return await connection.road.request(method, path, body, connection.credential.token());
    } catch (error) {
      throw new RpeError(0, `RPE did not answer: ${errorWords(error)}`);
    }
  }

  const client: RpeClient = {
    state,
    missing: connector.missing,
    async call(key, params, options = {}) {
      const space = key.indexOf(" ");
      const method = key.slice(0, space);
      const path = pathOf(key.slice(space + 1), params as Readonly<Record<string, string>>, options.query);
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      let connection = await connect();
      let answer: RoadAnswer;
      try {
        answer = await send(connection, method, path, body);
      } catch (error) {
        if (!(connector.canSwitch && connection.road.kind === "direct")) throw error;
        // The direct road stopped answering under the page: find a road again, once (unless another call already has).
        if (road === connection.road) client.reconnect();
        connection = await connect();
        answer = await send(connection, method, path, body);
      }
      if (answer.status === 401 && (await connection.credential.renew().catch(() => false))) answer = await send(connection, method, path, body);
      if (answer.status === 401 && !connector.canSwitch) {
        const refused = new RpeError(401, `${refusalOf(answer).message} ${KEY_LET_GO}`);
        signOut(refused);
        throw refused;
      }
      return readAnswer(answer) as Routes[typeof key]["reply"];
    },
    follow(chat, listener) {
      let set = listeners.get(chat);
      if (set === undefined) {
        listeners.set(chat, (set = new Set()));
        if (road !== null) followOn(road, chat);
        else void connect().catch(() => undefined);
      } else if (following.has(chat)) queueMicrotask(() => listener.reset());
      set.add(listener);
      const mine = set;
      return () => {
        mine.delete(listener);
        if (mine.size > 0 || listeners.get(chat) !== mine) return;
        listeners.delete(chat);
        following.delete(chat);
        void road?.unfollow(chat).catch(() => undefined);
      };
    },
    onReset(listener) {
      resets.add(listener);
      return () => resets.delete(listener);
    },
    connect() {
      if (!closed) void connect().catch(() => undefined);
    },
    reconnect() {
      if (closed) return;
      drop();
      void connect().catch(() => undefined);
    },
    close() {
      closed = true;
      drop();
      listeners.clear();
      resets.clear();
      connector.close();
    },
  };
  return client;
}

// ---------------------------------------------------------------- the shells' connectors

export interface ConnectSettings extends SocketSettings {
  /** How long the page waits for each of RPE's addresses to answer it directly. */
  probeMs: number;
  /** How long the page waits for the extension's start-up facts. */
  startMs: number;
  /** How long before a page token runs out the client asks for a new one (at most half its life). */
  renewAheadMs: number;
}

/** Fixed defaults: a loopback address answers well inside 3 s; the start waits past Spindle's proxy's 30 s; a token is renewed a minute before it runs out. */
export const CONNECT_DEFAULTS: ConnectSettings = { probeMs: 3000, startMs: 35_000, renewAheadMs: 60_000, reconnectMs: 1000, reconnectMaxMs: 30_000 };

/** Where the web shell keeps the web UI's token. */
export interface TokenStore {
  get(): string | null;
  set(token: string | null): void;
}

/** Why the web shell asks for its key again, in a sentence. */
export const KEY_LET_GO = "This browser has let go of the key it kept: a key stops when it runs out, or when rpe key web makes a new one. Give the current one.";

/**
 * The web shell's connector: RPE served the page, so the road is direct to the page's own origin, with the
 * web UI's key. When RPE refuses it, RPE's session route says whether the key itself is refused: then it
 * is let go, and there is no other to take its place. A session route that does not answer is RPE not
 * running (a restart, say): that says nothing of the key, so the socket is simply tried again.
 */
export function webConnector(base: string, tokens: TokenStore, deps: RoadDeps, settings: ConnectSettings = CONNECT_DEFAULTS): Connector {
  const credential: Credential = {
    token: () => tokens.get() ?? "",
    async renew() {
      const held = tokens.get();
      if (held === null) return false;
      const answer = await deps.fetch(new URL(SESSION_PATH, base).toString(), { method: "GET", headers: { authorization: `Bearer ${held}`, accept: "application/json" } }).catch(() => null);
      if (answer === null || answer.status !== 401) return true;
      tokens.set(null);
      return false;
    },
  };
  return {
    canSwitch: false,
    missing: createStore<readonly MissingPermission[] | null>(null),
    async connect() {
      if (tokens.get() === null) throw new ConnectFailure({ phase: "signed-out", error: null });
      return { road: directRoad(base, credential, deps, settings), credential, state: { phase: "direct", address: base } };
    },
    close: () => undefined,
  };
}

/**
 * The drawer's connector: the extension's start-up facts (a page token, RPE's addresses, its build),
 * then each address tried from the page, and the relay when none answers. The page token is renewed
 * before it runs out, asked for again until it comes when the extension cannot give it, and renewed
 * again when RPE refuses it.
 */
export function extensionConnector(channel: RelayChannel, deps: RoadDeps, settings: ConnectSettings = CONNECT_DEFAULTS): Connector {
  const missing = createStore<readonly MissingPermission[] | null>(null);
  let facts: StartFacts | null = null;
  let timer: unknown = null;
  let closed = false;
  const offPermissions = channel.onPermissions((lacking) => missing.set(lacking));

  async function start(): Promise<StartFacts> {
    const { promise, resolve, reject } = Promise.withResolvers<StartFacts>();
    const wait = deps.timers.setTimeout(() => reject(new ConnectFailure({ phase: "failed", error: `The extension gave this page no answer within ${Math.round(settings.startMs / 1000)} s.` })), settings.startMs);
    channel.start().then(
      (answer) => {
        deps.timers.clearTimeout(wait);
        missing.set(answer.missing);
        if (answer.facts === null) reject(new ConnectFailure({ phase: "failed", error: answer.error ?? "The extension could not reach RPE." }));
        else resolve(answer.facts);
      },
      (error: unknown) => {
        deps.timers.clearTimeout(wait);
        reject(new ConnectFailure({ phase: "failed", error: errorWords(error) }));
      },
    );
    const got = await promise;
    facts = got;
    schedule(got);
    return got;
  }

  /** Renews the token before its life runs out, counted from now, when its facts reached the page: never from a time RPE's clock named. */
  function schedule(got: StartFacts): void {
    const life = got.expiresInMs;
    renewIn(Math.max(0, Math.max(life / 2, life - settings.renewAheadMs)), settings.reconnectMs);
  }

  /** Hears each token renewed ahead of the old one's end: the live socket opens its next one with it before the old one is closed. */
  const renewed = new Set<() => void>();

  /** Asks for a new token in `ms`; one that cannot be had is asked for again after `retryMs`, twice as long each time after, up to `reconnectMaxMs`. */
  function renewIn(ms: number, retryMs: number): void {
    deps.timers.clearTimeout(timer);
    timer = null;
    if (closed) return;
    timer = deps.timers.setTimeout(() => {
      timer = null;
      start().then(
        () => {
          for (const listener of [...renewed]) listener();
        },
        () => {
          // Another renewal may have come in meanwhile and set the next one.
          if (timer === null) renewIn(retryMs, Math.min(retryMs * 2, settings.reconnectMaxMs));
        },
      );
    }, ms);
  }

  const credential: Credential = {
    token: () => facts?.token ?? "",
    renew: () => start().then(() => true),
    onFresh(listener) {
      renewed.add(listener);
      return () => renewed.delete(listener);
    },
  };

  return {
    canSwitch: true,
    missing,
    async connect() {
      const got = await start();
      const tried: string[] = [];
      for (const address of got.addresses) {
        const probe = await probeDirect(address, got.token, deps, settings.probeMs);
        if (probe.ok) return { road: directRoad(address, credential, deps, settings), credential, state: { phase: "direct", address } };
        tried.push(`${address}: ${probe.why}`);
      }
      const why = tried.length === 0 ? "RPE gave no address this page could try directly." : `This page could not reach RPE directly (${tried.join("; ")}).`;
      return { road: relayRoad(channel), credential, state: { phase: "relay", why } };
    },
    close() {
      closed = true;
      deps.timers.clearTimeout(timer);
      timer = null;
      offPermissions();
    },
  };
}
