// One typed client over RPE's API (plan §4.4), the same for both shells and every page. A call names its
// route as the route table writes it ("GET /api/v1/chats/:chat/turns") and gets back what that route
// answers: a route in the form is typed by the generated types (`src/shared/api`, written from the route
// table by `bun run api`): the client keeps no route's shape by hand. A route that pages is read a page at
// a time with `call`, or walked to its end with `walk`. Whoever follows a chat gets its live events.
// Behind it is one of the two roads (roads.ts). The web shell, served by RPE itself, is always direct. In
// Lumiverse's drawer the client asks the extension for its start-up facts, tries RPE's addresses from the
// page, and takes the relay when none answers, keeping why, so the page can say which road it is on and
// why.

import { createStore, type Readable } from "./store";
import { ANSWER_GONE_STATUS, ANSWER_STATUS, ANSWERS_PATH, type ApiRoutes, JOINED_STATUS, type JoinedAnswer, type LiveEvent, type MissingPermissionShown } from "../shared/api";
import { isRecord } from "../shared/json";
import { type PreparingShown, preparingOf } from "../shared/preparing";
import { type Credential, directRoad, type LiveUpdate, probeDirect, type RelayChannel, relayRoad, type Road, type RoadAnswer, type RoadDeps, SESSION_PATH, type StartFacts, type Timers } from "./roads";
import { createUiSettings, type UiSettings } from "./ui-settings";
import { errorWords } from "./words";

/** Every route the pages call, by method and path pattern, as the route table writes them (the generated types); `*` stands for the rest of the path. */
export type RouteKey = keyof ApiRoutes & string;

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

/** What a route takes and answers, as the route table declares it (the generated types). */
export type RouteShapes<K extends RouteKey> = ApiRoutes[K];

/**
 * What a call to a route answers: its reply and, for a route that takes a turn's id (it declares `joined`), the answer of a turn
 * that was joined to another, which names the turn it joined: a fact of its own kind beside the reply, never taken for a reply and
 * never thrown as an error. A page follows it by asking again for the turn joined.
 */
export type Answer<K extends RouteKey> = ApiRoutes[K]["joined"] extends true ? ApiRoutes[K]["reply"] | JoinedAnswer : ApiRoutes[K]["reply"];

/**
 * A page that does not follow a joined turn yet reads the reply of a route that takes a turn's id as it reads any other, and a joined
 * turn's answer as a refusal in words: the turn asked for, and the turn it joined.
 */
export function replyOf<T>(answer: T | JoinedAnswer): T {
  if (isJoined(answer)) throw new RpeError(JOINED_STATUS, `Turn ${answer.joined.turn} was joined to turn ${answer.joined.joined}: ask for that turn.`);
  return answer;
}

/** Whether an answer is a joined turn's, not the route's reply. */
export function isJoined(answer: unknown): answer is JoinedAnswer {
  return isRecord(answer) && isRecord(answer.joined) && typeof answer.joined.turn === "string" && typeof answer.joined.joined === "string" && Object.keys(answer).length === 1;
}

export interface CallOptions<K extends RouteKey> {
  query?: RouteShapes<K>["query"];
  body?: RouteShapes<K>["body"];
}

/** The routes that page: each takes `limit` and `cursor` in its query and answers `{ items, next }`. */
export type PagedKey = { [K in keyof ApiRoutes]: ApiRoutes[K]["paged"] extends true ? K : never }[keyof ApiRoutes] & string;
/** An item of a paged route's list. */
export type PageItem<K extends PagedKey> = ApiRoutes[K]["reply"] extends { items: readonly (infer I)[] } ? I : never;

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
  readonly missing: Readable<readonly MissingPermissionShown[] | null>;
  call<K extends RouteKey>(key: K, params: ParamsOf<K>, options?: CallOptions<K>): Promise<Answer<K>>;
  /** Follows a chat's live events; the returned function stops. */
  follow(chat: string, listener: LiveListener): () => void;
  /**
   * Calls `listener` each time the page is told to read afresh, for any chat: following one began, or
   * updates were lost on the way. What a page shows of RPE outside a chat's events is read again then.
   */
  onReset(listener: () => void): () => void;
  /** The chats RPE is getting ready for its build, by chat, as the page's waiting reads of them were last told; a chat leaves once a read of it is told so no more. */
  readonly preparing: Readable<ReadonlyMap<string, PreparingShown>>;
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
  readonly missing: Readable<readonly MissingPermissionShown[] | null>;
  /** The page's settings, which the client reads when it waits (how often it asks after a long request). */
  readonly settings: UiSettings;
  readonly timers: Timers;
  close(): void;
}

/** `pattern` with its params put in, each encoded, and the query after it (a yes-or-no value as `true` or `false`, which the routes read). The rest of the path (`*`) is put in segment by segment, its slashes kept. */
export function pathOf(pattern: string, params: Readonly<Record<string, string>>, query?: Readonly<Record<string, string | number | boolean | undefined>>): string {
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

/** A success's parsed JSON (undefined when it has none), or a joined turn's answer (status 409, naming the turn it joined); any other refusal is thrown. */
function readAnswer(answer: RoadAnswer): unknown {
  if (answer.status === JOINED_STATUS) {
    try {
      const body: unknown = JSON.parse(answer.text);
      if (isJoined(body)) return body;
    } catch {
      // Not a joined turn's answer: a refusal like any other.
    }
  }
  if (answer.status < 200 || answer.status >= 300) throw refusalOf(answer);
  if (answer.text === "") return undefined;
  try {
    return JSON.parse(answer.text);
  } catch {
    throw new RpeError(answer.status, "RPE's answer was not JSON.");
  }
}

/**
 * The answer RPE says it will give, for a route that took the request in hand and answered at once (status 202, a body of the key
 * `answer`, and `preparing` beside it while the chat the request names is being made ready): its id and how far that is; null for any
 * other answer.
 */
function waitOf(answer: RoadAnswer): { id: string; preparing: PreparingShown | null } | null {
  if (answer.status !== ANSWER_STATUS) return null;
  try {
    const body: unknown = JSON.parse(answer.text);
    if (!isRecord(body) || typeof body.answer !== "string") return null;
    const preparing = preparingOf(body.preparing);
    const told = body.preparing === undefined ? 1 : 2;
    return Object.keys(body).length === told && (told === 1 || preparing !== null) ? { id: body.answer, preparing } : null;
  } catch {
    return null;
  }
}

/**
 * Every item of a paged route, its pages read one after another from the first to the end, each of
 * `limit` items where the query gives one, else of the route's own size. Each page's cursor names the
 * place after its last item, never a count, so an item that stays in the list while it is walked comes
 * once, however the list changes between pages; a cursor the route refuses (one from before RPE last
 * started) ends the walk with RPE's words.
 */
export async function walk<K extends PagedKey>(client: Pick<RpeClient, "call">, key: K, params: ParamsOf<K>, options: { query?: Omit<NonNullable<CallOptions<K>["query"]>, "cursor"> } = {}): Promise<PageItem<K>[]> {
  const items: PageItem<K>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const query = { ...options.query, ...(cursor === null ? {} : { cursor }) };
    const page: unknown = await client.call(key, params, { query } as CallOptions<K>);
    if (!isRecord(page) || !Array.isArray(page.items) || (page.next !== null && typeof page.next !== "string")) throw new RpeError(200, `RPE's answer to ${key} is not a page of its list.`);
    items.push(...(page.items as PageItem<K>[]));
    if (page.next === null) return items;
    // A route that pages moves on from where it was asked to start; one that does not would be walked forever.
    if (page.next === cursor) throw new RpeError(200, `RPE answered ${key} with the same page again, from ${cursor}.`);
    cursor = page.next;
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
  /** The GETs out now, by path: a page that asks the same while one is out shares its answer, one piece of RPE's work. */
  const out = new Map<string, Promise<RoadAnswer>>();
  /** The chats RPE is getting ready for its build, as the waiting answers of the page's reads say. */
  const preparing = createStore<ReadonlyMap<string, PreparingShown>>(new Map());
  /** Takes what a waiting answer said of `chat`: how far it is from ready, or (null) that it is ready. */
  const told = (chat: string, now: PreparingShown | null): void => {
    const held = preparing.get();
    if (now === null ? !held.has(chat) : JSON.stringify(held.get(chat)) === JSON.stringify(now)) return;
    const next = new Map(held);
    if (now === null) next.delete(chat);
    else next.set(chat, now);
    preparing.set(next);
  };
  /** The next try of a connect that failed, and how many failed in a row: the wait doubles from `reconnectMs` up to `reconnectMaxMs`. */
  let again: unknown = null;
  let failures = 0;

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
        failures = 0;
        road = connection.road;
        offLive = road.onLive(deliver);
        state.set(connection.state);
        for (const chat of listeners.keys()) followOn(connection.road, chat);
        return connection;
      },
      (error: unknown) => {
        if (current === attempt) {
          const failed = error instanceof ConnectFailure ? error.state : { phase: "failed" as const, error: errorWords(error) };
          state.set(failed);
          if (failed.phase === "failed") tryAgainLater(attempt);
        }
        throw new RpeError(0, errorWords(error));
      },
    );
    current = attempt;
    return attempt;
  }

  /** A connect that failed (RPE did not answer through Lumiverse in time, say) is tried again by itself, so a slow moment leaves no page dead until it is pressed. */
  function tryAgainLater(attempt: Promise<Connection>): void {
    const { reconnectMs, reconnectMaxMs } = connector.settings.values.get();
    const wait = Math.min(reconnectMaxMs, reconnectMs * 2 ** failures);
    failures++;
    connector.timers.clearTimeout(again);
    again = connector.timers.setTimeout(() => {
      again = null;
      if (closed || current !== attempt) return;
      current = null;
      void connect().catch(() => undefined);
    }, wait);
  }

  /**
   * One call's answer as RPE gives it at last: a long route's id asked after until its answer is ready. While the chat the call names is
   * being made ready, each waiting answer says how far it is (`preparing`), until one no longer does or the answer comes. An id RPE no
   * longer holds (it restarted meanwhile, on an update say) is a read asked again; anything else so lost is told as RPE's refusal.
   */
  async function answered(method: string, path: string, body: string | undefined): Promise<RoadAnswer> {
    let answer = await exchange(method, path, body);
    let chat: string | null = null;
    try {
      // A route that may outlast the relay's 30 s answers at once with the id of its answer, which is asked for until it is ready.
      for (let wait = waitOf(answer); wait !== null; wait = waitOf(answer)) {
        if (wait.preparing !== null) told((chat = wait.preparing.chat), wait.preparing);
        else if (chat !== null) told(chat, null);
        const { promise, resolve } = Promise.withResolvers<void>();
        connector.timers.setTimeout(resolve, connector.settings.values.get().jobPollMs);
        await promise;
        if (closed) throw new RpeError(0, "The page closed.");
        answer = await exchange("GET", pathOf(`${ANSWERS_PATH}/:id`, { id: wait.id }), undefined);
        if (answer.status === ANSWER_GONE_STATUS && method === "GET") answer = await exchange(method, path, body);
      }
      return answer;
    } finally {
      if (chat !== null) told(chat, null);
    }
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

  /**
   * RPE was not reached on the road the page holds (it stopped, or restarts on an update): the road is let go, and RPE is found again by
   * itself, waiting longer each time (`tryAgainLater`); once it is found every chat followed is read afresh (`followOn`), so what a cut read
   * left undrawn is drawn without a reload.
   */
  function lost(connection: Connection, error: RpeError): void {
    if (closed || road !== connection.road) return;
    drop();
    const failed = Promise.reject(error);
    failed.catch(() => undefined);
    current = failed;
    state.set({ phase: "failed", error: error.message });
    tryAgainLater(failed);
  }

  /** One request as RPE answers it: a road found if need be, found again once when the direct road stopped answering under the page, RPE found again when no road reached it, and a refused credential renewed. */
  async function exchange(method: string, path: string, body: string | undefined): Promise<RoadAnswer> {
    let connection = await connect();
    let answer: RoadAnswer;
    try {
      try {
        answer = await send(connection, method, path, body);
      } catch (error) {
        if (!(connector.canSwitch && connection.road.kind === "direct")) throw error;
        // The direct road stopped answering under the page: find a road again, once (unless another call already has).
        if (road === connection.road) client.reconnect();
        connection = await connect();
        answer = await send(connection, method, path, body);
      }
    } catch (error) {
      if (error instanceof RpeError && error.status === 0) lost(connection, error);
      throw error;
    }
    if (answer.status === 401 && (await connection.credential.renew().catch(() => false))) answer = await send(connection, method, path, body);
    if (answer.status === 401 && !connector.canSwitch) {
      const refused = new RpeError(401, `${refusalOf(answer).message} ${KEY_LET_GO}`);
      signOut(refused);
      throw refused;
    }
    return answer;
  }

  const client: RpeClient = {
    state,
    missing: connector.missing,
    preparing,
    async call(key, params, options = {}) {
      const space = key.indexOf(" ");
      const method = key.slice(0, space);
      const path = pathOf(key.slice(space + 1), params as Readonly<Record<string, string>>, options.query);
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      // A read the page has out already is not asked again: the second asker shares its answer, and reads its own copy of it.
      if (method !== "GET" || body !== undefined) return readAnswer(await answered(method, path, body)) as Answer<typeof key>;
      let reading = out.get(path);
      if (reading === undefined) {
        const mine = answered(method, path, body);
        reading = mine;
        out.set(path, mine);
        const done = (): void => {
          if (out.get(path) === mine) out.delete(path);
        };
        mine.then(done, done);
      }
      return readAnswer(await reading) as Answer<typeof key>;
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
      connector.timers.clearTimeout(again);
      drop();
      listeners.clear();
      resets.clear();
      connector.close();
    },
  };
  return client;
}

// ---------------------------------------------------------------- the shells' connectors

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
export function webConnector(base: string, tokens: TokenStore, deps: RoadDeps, settings: UiSettings = createUiSettings(null)): Connector {
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
    missing: createStore<readonly MissingPermissionShown[] | null>(null),
    settings,
    timers: deps.timers,
    async connect() {
      if (tokens.get() === null) throw new ConnectFailure({ phase: "signed-out", error: null });
      return { road: directRoad(base, credential, deps, settings.values), credential, state: { phase: "direct", address: base } };
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
export function extensionConnector(channel: RelayChannel, deps: RoadDeps, settings: UiSettings = createUiSettings(null)): Connector {
  const missing = createStore<readonly MissingPermissionShown[] | null>(null);
  let facts: StartFacts | null = null;
  let timer: unknown = null;
  let closed = false;
  const offPermissions = channel.onPermissions((lacking) => missing.set(lacking));

  async function start(): Promise<StartFacts> {
    const { promise, resolve, reject } = Promise.withResolvers<StartFacts>();
    const startMs = settings.values.get().startMs;
    const wait = deps.timers.setTimeout(() => reject(new ConnectFailure({ phase: "failed", error: `The extension gave this page no answer within ${Math.round(startMs / 1000)} s.` })), startMs);
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
    settings.take(got.pageSettings);
    facts = got;
    schedule(got);
    return got;
  }

  /** Renews the token before its life runs out, counted from now, when its facts reached the page: never from a time RPE's clock named. */
  function schedule(got: StartFacts): void {
    const { renewAheadMs, reconnectMs } = settings.values.get();
    const life = got.expiresInMs;
    renewIn(Math.max(0, Math.max(life / 2, life - renewAheadMs)), reconnectMs);
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
          if (timer === null) renewIn(retryMs, Math.min(retryMs * 2, settings.values.get().reconnectMaxMs));
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
    settings,
    timers: deps.timers,
    async connect() {
      const got = await start();
      const tried: string[] = [];
      for (const address of got.addresses) {
        const probe = await probeDirect(address, got.token, deps, settings.values.get().probeMs);
        if (probe.ok) return { road: directRoad(address, credential, deps, settings.values), credential, state: { phase: "direct", address } };
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
