// The stand-in Lumiverse's server as RPE meets it as a signed-in user: its HTTP routes and its
// sockets. Each answer is modelled on Lumiverse's source (staging at a70f4ed2; paths are its `src/`,
// and Better Auth's where named), with the file and line beside it. What is the stand-in's own says so:
// one client address, and the clock the test runs. Its rows come from a stand-in database file
// (`db.ts`), read the way Lumiverse's own mappers serve them.
//
// Its sockets are `ServerSocket`s (`sockets.ts`), with Lumiverse's receive queue, backlog limit and
// idle sweep; RPE's `LumiverseSocket` opens one through `open`, and a page opens one through `page`.
// An extension installed in the stand-in (`lumiverse.ts`) hears a socket's `SPINDLE_BACKEND_MSG`, and
// its `sendToFrontend` reaches the socket of the session it names.

import { createHash } from "node:crypto";
import type { Clock } from "rp-harness/contract";
import { isRecord } from "../../src/shared/json";
import type { OpenSocket, Socket, SocketEvents } from "../../src/adapter/lumiverse/socket";
import type { PageChannel } from "../../src/ext/page";
import type { GenerationType } from "./assembly";
import { databankAnswer, macroAnswer, memoryAnswer, openCortex, tokenAnswer, type CortexState } from "./cortex";
import type { StandInDb } from "./db";
import { createBook, createEntry, deleteEntry, entryOf, updateEntry, type Written } from "./entries";
import type { Installed, StandIn } from "./lumiverse";
import { dryRunResult, pageOf, parsePagination, parsed, rowMetadata, rowToBook, rowToCharacter, rowToEntry, rowToMessage, rowToMessageLight, rowToPersona, rowToPreset, rowToSetting, type Pagination } from "./served";
import { RECEIVE_LIMITS, ServerSocket, SWEEP_MS } from "./sockets";

type Timers = Pick<Clock, "now" | "setTimeout" | "clearTimeout">;

export interface Account {
  id: string;
  username: string;
  password: string;
  /** The user's role (`auth/index.ts:117-125`, the admin plugin's `defaultRole`); "user" when none is given. */
  role?: "owner" | "admin" | "user";
}

interface Session {
  token: string;
  user: string;
  expiresAt: number;
  updatedAt: number;
}

/** Better Auth's session (`auth/index.ts:109-112`): seven days from its last renewal, renewed by a use a day or more after the one before. */
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const UPDATE_AGE_MS = 24 * 60 * 60 * 1000;
/** `authSensitiveLimiter` (`app.ts:254-259`): eight sign-ins per five minutes per address. */
const SIGN_IN_MAX = 8;
const SIGN_IN_WINDOW_MS = 5 * 60 * 1000;
/** `FAILURE_THRESHOLD`, `INITIAL_LOCKOUT_STEPS_MS`, `MAX_LOCKOUT_MS` and `STATE_TTL_MS` (`services/auth-lockout.service.ts:24-31`, `:33`): five failed sign-ins lock an address for 15 minutes, 30, 60, then 6 hours, doubling to at most 7 days. */
const LOCKOUT_FAILURES = 5;
const LOCKOUT_STEPS_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const LOCKOUT_MAX_MS = 7 * 24 * 60 * 60_000;
const LOCKOUT_TTL_MS = 7 * 24 * 60 * 60_000;

/** What Lumiverse holds of one address's failed sign-ins (`LockoutState`, `services/auth-lockout.service.ts:3-9`). */
interface Lockout {
  failures: number;
  level: number;
  lockedUntil: number;
  lastActivityAt: number;
}
/** `TICKET_TTL_MS` (`ws/tickets.ts:22`). */
const TICKET_TTL_MS = 30_000;
/** `REVALIDATE_PRIVATE` (`utils/http-cache.ts:12`). */
const REVALIDATE_PRIVATE = "private, no-cache";
/** The longest an error told to a page is (`utils/provider-errors.ts:147-156`). */
const MAX_ERROR_LENGTH = 1000;
/** The messages one page of a list may ask for (`routes/chats.routes.ts:800-803`, `types/pagination.ts:14`). */
const MESSAGES_MAX = 1000;
/** A chat's messages in order (`services/chats.service.ts:2128`). */
const MESSAGES_ALL = "SELECT m.* FROM messages m JOIN chats c ON m.chat_id = c.id WHERE m.chat_id = ? AND c.user_id = ? ORDER BY m.index_in_chat ASC";
/** What an entry list sorts by (`services/world-books.service.ts:1498-1504`). */
const ENTRY_SORT_COLUMNS: Record<string, string> = { order: "order_value", priority: "priority", created: "created_at", updated: "updated_at", name: "comment" };

interface EntryOptions {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  search?: string;
  folder?: string;
  tags?: string[];
  type?: "trigger" | "constant" | "vector";
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** What a route of `cortex.ts` answers: its body as JSON; a body that was not JSON Hono answers 500 as plain text, which these routes name by a string. */
function answered(a: { status: number; body: unknown }): Response {
  return a.status === 500 && typeof a.body === "string" ? new Response(a.body, { status: 500, headers: { "content-type": "text/plain; charset=UTF-8" } }) : json(a.status, a.body);
}

/** `ifNoneMatchSatisfies` (`utils/http-cache.ts:19-33`): the client's `If-None-Match` lists the tag, weak or strong, or `*`. */
function ifNoneMatchSatisfies(header: string | null, etag: string): boolean {
  if (!header) return false;
  const normalize = (value: string): string => (value.trim().startsWith("W/") ? value.trim().slice(2).trim() : value.trim());
  const current = normalize(etag);
  return header
    .split(",")
    .map((v) => v.trim())
    .some((v) => v === "*" || normalize(v) === current);
}

/** A route that revalidates (`routes/world-books.routes.ts:296-306`): the tag and `Cache-Control` on its answer, a 304 with no body where the client holds the tag already. */
function revalidated(request: Request, etag: string, body: unknown): Response {
  const headers = { ETag: etag, "Cache-Control": REVALIDATE_PRIVATE };
  if (ifNoneMatchSatisfies(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return json(200, body, headers);
}

/** The error a generation route tells (`routes/generate.routes.ts:27-37`): the message, clamped. */
function generationError(message: string): Response {
  return json(400, { error: message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message });
}

export interface LumiverseServerOptions {
  clock: Timers;
  accounts: Account[];
  /** Where the chats and messages its routes serve are kept. */
  db?: StandInDb;
  /** The stand-in host its extensions are installed in. */
  host?: StandIn;
  /** How long Lumiverse's handler of an extension's message takes (`ws/handler.ts:440-467`): the extension's lookup and the post to its worker. */
  handlerMs?: number;
  /**
   * The address Lumiverse sees RPE's requests come from (`getClientIp`, `app.ts:131-133`). Lumiverse never locks out a loopback address (`services/
   * auth-lockout.service.ts:150-155`), so on the default, RPE beside Lumiverse, only the sign-in limiter holds; a test that plays RPE on another machine gives its address.
   */
  clientAddress?: string;
  /** The models Lumiverse has a tokenizer for; for any other its token count is null (`services/tokenizer.service.ts:455-463`). */
  tokenizedModels?: readonly string[];
}

/** An installed extension as the stand-in lists it (`GET /api/v1/spindle`). */
interface Listed {
  installed: Installed;
  identifier: string;
}

export class LumiverseServer {
  readonly base = "http://lumiverse.test:7860";
  readonly clock: Timers;
  /** Every HTTP request it answered: its method, path and status. */
  readonly requests: { method: string; path: string; status: number }[] = [];
  /** Every sign-in it was asked for, with whether it held. */
  readonly signIns: { username: string; ok: boolean }[] = [];
  /** Every socket ticket it gave. */
  readonly tickets: string[] = [];
  /** It answers a socket's pings (`ws/handler.ts:284-292`); a test turns it off to play a connection that died without a close. */
  answerPings = true;
  /** It refuses every ticket, as `ws/handler.ts:124-137` does an unknown or expired one. */
  refuseTickets = false;
  /** Its Host guard (`app.ts:233-240`, `isHostAllowed`) refuses every `/api/` request, as it does a request whose Host is not one of the trusted hosts: 403 `{error: "Forbidden"}`, after the lockout check and before any route. */
  untrustedHost = false;
  /** It lets a socket in only after this long (its `onOpen`, `ws/handler.ts:122-248`); never, when null. */
  openDelayMs: number | null = 0;

  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, Session>();
  private readonly ticketsLive = new Map<string, { user: string; expires: number }>();
  private signInsAt: number[] = [];
  private readonly sockets = new Set<ServerSocket>();
  /** Frontend sessions by user, then by session id (`spindle/frontend-session.ts:11-27`). */
  private readonly frontends = new Map<string, Map<string, ServerSocket>>();
  private readonly listed = new Map<string, Listed>();
  private sweep: unknown;
  /** What Lumiverse holds of the client's failed sign-ins (`services/auth-lockout.service.ts:90-100`, `:118-182`), by the one address the stand-in sees. */
  private lockout: Lockout | null = null;
  /** The memory, databanks and token counts its routes answer from (`cortex.ts`); a test puts a databank's chunks in `cortex.bankChunks`. */
  readonly cortex: CortexState;

  constructor(private readonly options: LumiverseServerOptions) {
    this.clock = options.clock;
    this.cortex = openCortex(options.db, options.tokenizedModels ?? []);
    for (const a of options.accounts) this.accounts.set(a.username.toLowerCase(), a);
    if (options.host) {
      const host = options.host;
      // A worker's later task, a socket's delivery and the rows' stamps all run on the test's clock; the host's events reach the user's sockets.
      host.later = (run) => void this.clock.setTimeout(run, 0);
      host.now = () => this.clock.now();
      host.frontends = (m) => this.toFrontend(m.extension, m.payload, m.user, m.session);
      host.sockets = (event, payload, user) => this.frame(event, payload, user);
    }
    // The bus's sweep (`ws/bus.ts:17-18`, `:457-466`): every minute, a socket silent for two is closed.
    const sweep = (): void => {
      this.sweep = this.clock.setTimeout(sweep, SWEEP_MS);
      const now = this.clock.now();
      for (const s of [...this.sockets]) if (now - s.lastInbound > s.timeoutMs) s.close(1001, "Timeout");
    };
    this.sweep = this.clock.setTimeout(sweep, SWEEP_MS);
  }

  stop(): void {
    this.clock.clearTimeout(this.sweep);
    for (const s of [...this.sockets]) s.clientClosed(1001, "the stand-in stopped");
  }

  // ---------------------------------------------------------------- what a test does to it

  /** Installs an extension in the stand-in host under its identifier (`spindle/manager.service.ts`). */
  install(identifier: string, granted: readonly string[]): Installed {
    if (!this.options.host) throw new Error("the stand-in server has no host to install in");
    const installed = this.options.host.install(granted);
    this.listed.set(installed.id, { installed, identifier });
    return installed;
  }

  /** Every session of `user` ends: it expired, or the user signed out everywhere. */
  endSessions(user: string): void {
    for (const [token, s] of this.sessions) if (s.user === user) this.sessions.delete(token);
  }

  /** The sessions alive now. */
  sessionCount(user: string): number {
    return [...this.sessions.values()].filter((s) => s.user === user && this.alive(s)).length;
  }

  /** What Lumiverse holds of the client address's failed sign-ins now: its failures counted, its lockout's level and when it lifts; null for an address with no state. */
  lockoutState(): { failures: number; level: number; lockedUntil: number } | null {
    return this.lockout === null ? null : { failures: this.lockout.failures, level: this.lockout.level, lockedUntil: this.lockout.lockedUntil };
  }

  /** The sockets of a user open now, with the frontend session each was opened with. */
  socketsOf(user: string): ServerSocket[] {
    return [...this.sockets].filter((s) => s.user === user && s.closed === null);
  }

  /** The connection under a user's sockets breaks: no close frame reaches the client, which sees 1006. */
  drop(user: string): void {
    for (const s of this.socketsOf(user)) s.close(1006, "");
  }

  /**
   * `eventBus.emit` (`ws/bus.ts:502-544`): one frame to every socket of the user, `{event, payload,
   * timestamp, userId}`, and the event to the extensions' workers (`lumiverse.ts`), through the host
   * where there is one.
   */
  emit(event: string, payload: unknown, user?: string): void {
    if (user !== undefined && this.options.host) this.options.host.emit(event, payload, user);
    else this.frame(event, payload, user);
  }

  /** An event's frame, to every socket of the user (`ws/bus.ts:520-529`). */
  private frame(event: string, payload: unknown, user?: string): void {
    const frame = JSON.stringify({ event, payload, timestamp: this.clock.now(), ...(user !== undefined ? { userId: user } : {}) });
    for (const s of this.sockets) if (s.closed === null && (user === undefined || s.user === user)) s.send(frame);
  }

  // ---------------------------------------------------------------- HTTP

  /** A request to the stand-in, as `fetch` would make it. */
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const request = new Request(url, init);
    const path = new URL(request.url).pathname;
    const res = await this.answer(request);
    this.requests.push({ method: request.method, path, status: res.status });
    return res;
  };

  private alive(s: Session): boolean {
    return this.clock.now() < s.expiresAt;
  }

  /** A user's role as Lumiverse stores it: the account's own, else the admin plugin's default (`auth/index.ts:117-125`). */
  private roleOf(user: string): "owner" | "admin" | "user" {
    for (const account of this.accounts.values()) if (account.id === user) return account.role ?? "user";
    return "user";
  }

  /** The session a request's bearer names, renewed as Better Auth renews it (`auth/index.ts:109-112`); null for none alive. */
  private sessionOf(request: Request): Session | null {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    const s = token === undefined ? undefined : this.sessions.get(token);
    if (s === undefined || !this.alive(s)) return null;
    const now = this.clock.now();
    if (now - s.updatedAt >= UPDATE_AGE_MS) {
      s.updatedAt = now;
      s.expiresAt = now + SESSION_MS;
    }
    return s;
  }

  /** `getClientIp`'s answer for every request (`app.ts:131-133`): the one address the stand-in sees. */
  private get clientAddress(): string {
    return this.options.clientAddress ?? "127.0.0.1";
  }

  /** `getActiveLockout` (`services/auth-lockout.service.ts:107-116`), a state with no failure and no activity for a week swept as `:57-69` does within the minute. */
  private activeLockout(now: number): Lockout | null {
    const state = this.lockout;
    if (state === null) return null;
    if (state.failures === 0 && now - Math.max(state.lastActivityAt, state.lockedUntil) > LOCKOUT_TTL_MS) {
      this.lockout = null;
      return null;
    }
    return state.lockedUntil > now ? state : null;
  }

  /** The refusal of a locked address (`buildPayload`, `:184-192`; `applyLockoutHeaders`, `app.ts:109-115`): 429 with the wait in `Retry-After`. */
  private lockoutAnswer(state: Lockout, message: string, now: number): Response {
    const seconds = Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
    return json(429, { error: message, retryAfterSeconds: seconds, lockedUntil: new Date(state.lockedUntil).toISOString(), lockoutLevel: state.level, reason: "login" }, { "retry-after": String(seconds) });
  }

  /**
   * What `app.ts:280-315` does after a sign-in answers: a success clears the count of failures; a 401 is one more, and the fifth locks the address out for
   * 15 minutes, then 30 minutes, 1 hour, 6 hours, doubling after that to at most 7 days (`recordFailure`, `:118-153`; `nextLockoutMs`, `:84-93`), the fifth's own answer a 429.
   * A loopback address is never locked (`:127-130`). Any other answer (the limiter's 429) is no failure.
   */
  private afterSignIn(res: Response, now: number): Response {
    if (res.status >= 200 && res.status < 300) {
      if (this.lockout !== null) {
        this.lockout.lastActivityAt = now;
        this.lockout.failures = 0;
      }
      return res;
    }
    if (res.status !== 401 || this.clientAddress === "127.0.0.1" || this.clientAddress === "::1") return res;
    const state = (this.lockout ??= { failures: 0, level: 0, lockedUntil: 0, lastActivityAt: now });
    state.lastActivityAt = now;
    state.failures++;
    if (state.failures < LOCKOUT_FAILURES) return res;
    state.level++;
    state.lockedUntil = now + (state.level <= LOCKOUT_STEPS_MS.length ? LOCKOUT_STEPS_MS[state.level - 1]! : Math.min(LOCKOUT_STEPS_MS.at(-1)! * 2 ** (state.level - LOCKOUT_STEPS_MS.length), LOCKOUT_MAX_MS));
    state.failures = 0;
    return this.lockoutAnswer(state, "Too many failed sign-in attempts. Try again later.", now);
  }

  /** Better Auth's username sign-in (`auth/index.ts:114-116`; `better-auth/dist/plugins/username/index.mjs:57-160`), behind the sign-in limiter (`app.ts:254-276`, `middleware/rate-limit.ts:114-121`). */
  private async signIn(request: Request, now: number): Promise<Response> {
    this.signInsAt = this.signInsAt.filter((t) => now - t < SIGN_IN_WINDOW_MS);
    if (this.signInsAt.length >= SIGN_IN_MAX) {
      const retrySec = Math.ceil((this.signInsAt[0]! + SIGN_IN_WINDOW_MS - now) / 1000);
      return json(429, { error: "Too many authentication attempts. Try again in a few minutes.", retryAfterSeconds: retrySec }, { "retry-after": String(retrySec) });
    }
    this.signInsAt.push(now);
    const body = parsed(await request.text(), null) as { username?: unknown; password?: unknown } | null;
    const account = typeof body?.username === "string" ? this.accounts.get(body.username.toLowerCase()) : undefined;
    const ok = account !== undefined && body?.password === account.password;
    this.signIns.push({ username: typeof body?.username === "string" ? body.username : "", ok });
    // `plugins/username/error-codes.mjs:5`, thrown as `APIError.from` (`@better-auth/core/dist/error/index.mjs:20-25`).
    if (!ok) return json(401, { message: "Invalid username or password", code: "INVALID_USERNAME_OR_PASSWORD" });
    const token = crypto.randomUUID().replaceAll("-", "");
    this.sessions.set(token, { token, user: account.id, expiresAt: now + SESSION_MS, updatedAt: now });
    // The bearer plugin also sets the token as a header (`better-auth/dist/plugins/bearer/index.mjs:71-72`).
    return json(200, { token, user: { id: account.id, name: account.username, username: account.username, email: `${account.username}@example.invalid` } }, { "set-auth-token": token });
  }

  private async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = this.clock.now();

    // A locked address is refused on every route under `/api/`, before any other check (`app.ts:134-158`).
    if (path.startsWith("/api/")) {
      const locked = this.activeLockout(now);
      if (locked !== null) return this.lockoutAnswer(locked, "Too many authentication failures from this client. Try again later.", now);
    }

    // The Host guard (`app.ts:233-240`) comes after the lockout check, for every route under `/api/`.
    if (path.startsWith("/api/") && this.untrustedHost) return json(403, { error: "Forbidden" });

    if (request.method === "POST" && path === "/api/auth/sign-in/username") return this.afterSignIn(await this.signIn(request, now), now);

    // `POST /api/auth/sign-out` (Better Auth, `app.ts:356-357`; `better-auth/dist/api/routes/sign-out.mjs:27-61`): the session the request holds is ended, and `{success: true}` answered, with or without one.
    if (request.method === "POST" && path === "/api/auth/sign-out") {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (token !== undefined) this.sessions.delete(token);
      return json(200, { success: true });
    }

    // `GET /api/auth/get-session` (`better-auth/dist/api/routes/session.mjs:19-130`): the session and its user, or `null`.
    if (request.method === "GET" && path === "/api/auth/get-session") {
      const s = this.sessionOf(request);
      return json(200, s === null ? null : { session: { id: s.token.slice(0, 8), userId: s.user, token: s.token, expiresAt: new Date(s.expiresAt).toISOString() }, user: { id: s.user, role: this.roleOf(s.user) } });
    }

    if (!path.startsWith("/api/v1/")) return json(404, { error: "Not found" });

    // `requireAuth` (`auth/middleware.ts:33-50`): no session, or a dead one.
    const session = this.sessionOf(request);
    if (session === null) return json(401, { error: "Unauthorized", code: "SESSION_EXPIRED" });
    const user = session.user;

    // `POST /api/v1/ws-ticket` (`app.ts:494-498`; `ws/tickets.ts:52-57`).
    if (request.method === "POST" && path === "/api/v1/ws-ticket") {
      const ticket = crypto.randomUUID();
      this.ticketsLive.set(ticket, { user, expires: now + TICKET_TTL_MS });
      this.tickets.push(ticket);
      return json(200, { ticket });
    }

    // `GET /api/v1/users` (`routes/users.routes.ts:88-96`): behind `requireOwner` (`auth/middleware.ts:92-103`), which admits the owner and an admin and tells any other role 403 `{error: "Forbidden"}`.
    if (request.method === "GET" && /^\/api\/v1\/users\/?$/.test(path)) {
      if (this.roleOf(user) === "user") return json(403, { error: "Forbidden" });
      const at = new Date(this.clock.now()).toISOString();
      return json(200, [...this.accounts.values()].map((a) => ({ id: a.id, name: a.username, email: `${a.username}@example.invalid`, username: a.username, role: a.role ?? "user", banned: 0, createdAt: at, updatedAt: at })));
    }

    // `GET /api/v1/spindle` (`routes/spindle.routes.ts:45-58`): the extensions the user may use.
    if (request.method === "GET" && path === "/api/v1/spindle") {
      const extensions = [...this.listed.entries()].map(([id, l]) => ({ id, identifier: l.identifier, name: l.identifier, enabled: true, status: "running" }));
      return json(200, { extensions, isPrivileged: false });
    }

    const served = await this.fromRows(request, url, user);
    if (served !== null) return served;
    const written = await this.fromWrites(request, url, user);
    if (written !== null) return written;

    // `POST /api/v1/generate/stop` (`app.ts:443`, `routes/generate.routes.ts:45-65`): the generation named, else the chat's,
    // else every one of the user's. An id is taken only when it is truthy (`:48`, `:53`, `:60`): an empty one names nothing.
    if (request.method === "POST" && path === "/api/v1/generate/stop" && this.options.host) {
      const body = parsed(await request.text(), null) as { generation_id?: unknown; chat_id?: unknown } | null;
      const ask = { ...(typeof body?.generation_id === "string" && body.generation_id !== "" ? { generation: body.generation_id } : {}), ...(typeof body?.chat_id === "string" && body.chat_id !== "" ? { chat: body.chat_id } : {}) };
      return json(200, { stopped: this.options.host.stop(user, ask) });
    }

    return json(404, { error: "Not found" });
  }

  // ---------------------------------------------------------------- what the rows answer

  /**
   * The routes RPE reads from, answered from the stand-in's rows as Lumiverse's services read them: a chat and its messages
   * (`routes/chats.routes.ts`), a stored breakdown and a dry run (`routes/generate.routes.ts`), the user's books and their entries,
   * a character, the personas, a preset and a setting. Null for any other route.
   */
  private async fromRows(request: Request, url: URL, user: string): Promise<Response | null> {
    const db = this.options.db;
    const path = url.pathname;
    const rows = (sql: string, ...params: (string | number | null)[]): Record<string, unknown>[] => db?.rows(sql, ...params) ?? [];
    const match = (re: RegExp): RegExpExecArray | null => re.exec(path);
    const named = (m: RegExpExecArray | null, at = 1): string | undefined => (m === null ? undefined : decodeURIComponent(m[at]!));
    const pagination = parsePagination(url.searchParams.get("limit"), url.searchParams.get("offset"));

    if (request.method === "POST" && path === "/api/v1/generate/dry-run") return this.dryRun(request, user);
    if (request.method !== "GET") return null;

    // `GET /api/v1/chats/:id` and its messages (`routes/chats.routes.ts:410-421`, `:792-821`).
    const chatRoute = match(/^\/api\/v1\/chats\/([^/]+)(\/messages)?$/);
    if (chatRoute !== null) {
      const chatId = named(chatRoute)!;
      const chat = rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chatId, user)[0];
      if (chatRoute[2] === undefined) {
        if (chat === undefined) return json(404, { error: "Not found" });
        const shown = { ...chat, metadata: rowMetadata(chat.metadata) };
        const base = { ...shown, character_display_owner: this.displayOwner(user, chat.character_id) };
        return json(200, url.searchParams.get("messages") === "false" ? base : { ...base, messages: rows(MESSAGES_ALL, chatId, user).map(rowToMessage) });
      }
      if (chat === undefined) return json(404, { error: "Chat not found" });
      return this.messageList(url, chatId, user, rows);
    }

    // `GET /api/v1/generate/breakdown/:messageId` (`routes/generate.routes.ts:175-181`; `services/breakdown.service.ts:14-21`): what was stored with the reply, or 404.
    const breakdownRoute = match(/^\/api\/v1\/generate\/breakdown\/([^/]+)$/);
    if (breakdownRoute !== null) {
      const row = rows("SELECT data FROM message_breakdowns WHERE message_id = ? AND user_id = ?", named(breakdownRoute)!, user)[0];
      const data = row === undefined ? null : parsed(row.data, null);
      return data === null ? json(404, { error: "No breakdown found for this message" }) : json(200, data);
    }

    // The user's world books (`routes/world-books.routes.ts:302-342`, `:907-938`): no route for one entry.
    if (path === "/api/v1/world-books") {
      const sig = rows("SELECT COUNT(*) as count, COALESCE(MAX(updated_at), 0) as maxUpdatedAt FROM world_books WHERE user_id = ?", user)[0]!;
      const etag = `"wb-list-${sig.count}-${sig.maxUpdatedAt}-${pagination.limit}-${pagination.offset}"`;
      const list = rows("SELECT * FROM world_books WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?", user, pagination.limit, pagination.offset);
      return revalidated(request, etag, pageOf(list.map(rowToBook), Number(sig.count), pagination));
    }
    const bookRoute = match(/^\/api\/v1\/world-books\/([^/]+)(\/entries)?$/);
    if (bookRoute !== null) {
      const bookId = named(bookRoute)!;
      const book = rows("SELECT * FROM world_books WHERE id = ? AND user_id = ?", bookId, user)[0];
      if (book === undefined) return json(404, { error: bookRoute[2] === undefined ? "Not found" : "World book not found" });
      const sig = rows("SELECT COUNT(*) as count, COALESCE(MAX(updated_at), 0) as maxUpdatedAt, COALESCE(SUM(revision), 0) as revisionSum FROM world_book_entries WHERE world_book_id = ?", bookId)[0]!;
      const stamp = `${book.updated_at}-${sig.count}-${sig.maxUpdatedAt}-${sig.revisionSum}-${pagination.limit}-${pagination.offset}`;
      if (bookRoute[2] === undefined) {
        const entries = this.entriesPage(bookId, pagination, {}, rows);
        return revalidated(request, `"wb-${bookId}-${stamp}"`, { ...rowToBook(book), entries });
      }
      const sortBy = url.searchParams.get("sort_by");
      const sortDir = url.searchParams.get("sort_dir");
      const type = url.searchParams.get("type");
      const options: EntryOptions = {
        ...(sortBy !== null && sortBy in ENTRY_SORT_COLUMNS ? { sortBy } : {}),
        ...(sortDir === "desc" || sortDir === "asc" ? { sortDir } : {}),
        ...((url.searchParams.get("search") ?? "") !== "" ? { search: url.searchParams.get("search")! } : {}),
        ...(url.searchParams.get("folder") !== null ? { folder: url.searchParams.get("folder")! } : {}),
        ...(url.searchParams.getAll("tag").length > 0 ? { tags: url.searchParams.getAll("tag") } : {}),
        ...(type === "trigger" || type === "constant" || type === "vector" ? { type } : {}),
      };
      const etag = `"wb-entries-${bookId}-${stamp}-${options.sortBy ?? ""}-${options.sortDir ?? ""}"`;
      return revalidated(request, etag, this.entriesPage(bookId, pagination, options, rows));
    }

    // `GET /api/v1/characters/:id` (`routes/characters.routes.ts:860-865`).
    const characterRoute = match(/^\/api\/v1\/characters\/([^/]+)$/);
    if (characterRoute !== null) {
      const row = rows("SELECT * FROM characters WHERE id = ? AND user_id = ?", named(characterRoute)!, user)[0];
      return row === undefined ? json(404, { error: "Not found" }) : json(200, rowToCharacter(row));
    }

    // `GET /api/v1/personas` and one persona (`routes/personas.routes.ts:85-89`, `:272-277`).
    if (path === "/api/v1/personas") {
      const total = Number(rows("SELECT COUNT(*) as count FROM personas WHERE user_id = ?", user)[0]!.count);
      const list = rows("SELECT * FROM personas WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?", user, pagination.limit, pagination.offset);
      return json(200, pageOf(list.map(rowToPersona), total, pagination));
    }
    const personaRoute = match(/^\/api\/v1\/personas\/([^/]+)$/);
    if (personaRoute !== null) {
      const row = rows("SELECT * FROM personas WHERE id = ? AND user_id = ?", named(personaRoute)!, user)[0];
      return row === undefined ? json(404, { error: "Not found" }) : json(200, rowToPersona(row));
    }

    // `GET /api/v1/presets/:id` (`routes/presets.routes.ts:139-158`): tagged by the preset's cache revision and the user.
    const presetRoute = match(/^\/api\/v1\/presets\/([^/]+)$/);
    if (presetRoute !== null) {
      const presetId = named(presetRoute)!;
      const row = rows("SELECT * FROM presets WHERE id = ? AND user_id = ?", presetId, user)[0];
      if (row === undefined) return json(404, { error: "Not found" });
      const scope = createHash("sha256").update(user).digest("base64url");
      const headers = { ETag: `W/"preset-${presetId}-${Number(row.cache_revision ?? 0)}-${scope}"`, "Cache-Control": REVALIDATE_PRIVATE, Vary: "Cookie, Accept-Encoding" };
      if (ifNoneMatchSatisfies(request.headers.get("if-none-match"), headers.ETag)) return new Response(null, { status: 304, headers });
      return json(200, rowToPreset(row), headers);
    }

    // `GET /api/v1/settings/:key` (`routes/settings.routes.ts:20-25`): the value parsed.
    const settingRoute = match(/^\/api\/v1\/settings\/([^/]+)$/);
    if (settingRoute !== null) {
      const row = rows("SELECT key, value, updated_at FROM settings WHERE key = ? AND user_id = ?", named(settingRoute)!, user)[0];
      return row === undefined ? json(404, { error: "Not found" }) : json(200, rowToSetting(row));
    }
    // A chat's memory (`routes/memory-cortex.routes.ts`): entities and consolidations; there is no route that searches it.
    const memory = memoryAnswer(rows, user, path, url.searchParams);
    return memory === null ? null : answered(memory);
  }

  /**
   * The routes that write to the rows or answer by the stand-in's own: macros, token counts, a databank search (`cortex.ts`), the user's books and their entries
   * with the revision check (`entries.ts`). Null for any other route. The body is read from a copy, so the routes after this one can read it.
   */
  private async fromWrites(request: Request, url: URL, user: string): Promise<Response | null> {
    const db = this.options.db;
    const path = url.pathname;
    const method = request.method;
    if (method !== "POST" && method !== "PUT" && method !== "DELETE") return null;
    const rows = (sql: string, ...params: (string | number | null)[]): Record<string, unknown>[] => db?.rows(sql, ...params) ?? [];
    const now = Math.floor(this.clock.now() / 1000);
    const sent = (w: Written, status = 200): Response => {
      if (!w.ok) return json(w.status, w.body);
      if (w.event !== undefined) this.options.host?.emit(w.event.name, w.event.payload, user);
      return json(status, w.body);
    };
    if (method === "POST") {
      const raw = ["/api/v1/macros/resolve", "/api/v1/macros/resolve-batch", "/api/v1/tokenizers/count", "/api/v1/tokenizers/count-batch", "/api/v1/databanks/search"].includes(path) ? await request.clone().text() : "";
      const counted = tokenAnswer(this.cortex, path, raw) ?? macroAnswer(rows, user, path, raw) ?? databankAnswer(this.cortex, rows, user, path, raw);
      if (counted !== null) return answered(counted);
    }
    if (db === undefined) return null;
    const bodyOf = async (): Promise<Record<string, unknown> | null> => {
      const body = parsed(await request.clone().text(), null);
      return isRecord(body) ? body : null;
    };
    // `POST /api/v1/world-books` (`routes/world-books.routes.ts:318-323`): 201.
    if (method === "POST" && path === "/api/v1/world-books") {
      const body = await bodyOf();
      return body === null ? new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain; charset=UTF-8" } }) : sent(createBook(db, user, body, now), 201);
    }
    const route = /^\/api\/v1\/world-books\/([^/]+)\/entries(?:\/([^/]+))?$/.exec(path);
    if (route === null) return null;
    const bookId = decodeURIComponent(route[1]!);
    const entryId = route[2] === undefined ? undefined : decodeURIComponent(route[2]);
    if (method === "POST" && entryId === undefined) {
      if (rows("SELECT id FROM world_books WHERE id = ? AND user_id = ?", bookId, user)[0] === undefined) return json(404, { error: "World book not found" });
      const body = await bodyOf();
      return body === null ? json(400, { error: "JSON object required" }) : sent(createEntry(db, user, bookId, body, now), 201);
    }
    if (entryId === undefined) return null;
    if (method === "PUT") {
      const existing = entryOf(db, user, entryId);
      if (existing === undefined || existing.world_book_id !== bookId) return json(404, { error: "Not found" });
      const body = await bodyOf();
      if (body === null) return json(400, { error: "JSON object required" });
      const wrote = updateEntry(db, user, entryId, body, now);
      return wrote === null ? json(404, { error: "Not found" }) : sent(wrote);
    }
    if (method === "DELETE") {
      const wrote = deleteEntry(db, user, entryId, now);
      return wrote === null ? json(404, { error: "Not found" }) : sent(wrote);
    }
    return null;
  }

  /** `getCharacterDisplayOwner` (`services/characters.service.ts:52-68`): which enabled extension the character's own record names as the one that draws it. */
  private displayOwner(user: string, characterId: unknown): string | null {
    const providers = [...this.listed.values()].map((l) => l.identifier);
    if (providers.length === 0 || typeof characterId !== "string" || characterId === "") return null;
    const whens = providers.map(() => "WHEN json_extract(extensions, '$.' || ? || '.display_owner') = 1 THEN ?").join(" ");
    const row = this.options.db?.rows(`SELECT (CASE ${whens} ELSE NULL END) AS owner FROM characters WHERE id = ? AND user_id = ?`, ...providers.flatMap((id) => [id, id]), characterId, user)[0];
    return typeof row?.owner === "string" ? row.owner : null;
  }

  /**
   * A chat's message list (`routes/chats.routes.ts:792-821`): the light form unless `full=true` asks for every swipe; a keyset page
   * before a boundary (`beforeIndex` and `beforeId`, both required together, `services/chats.service.ts:2257-2275`); the newest page
   * of `tail=true` (`:2226-2245`); else an offset page, `{data, total, limit, offset}`.
   */
  private messageList(url: URL, chatId: string, user: string, rows: (sql: string, ...params: (string | number | null)[]) => Record<string, unknown>[]): Response {
    const shape = url.searchParams.get("full") === "true" ? rowToMessage : rowToMessageLight;
    const requested = url.searchParams.get("beforeIndex");
    if (requested !== null) {
      const index = Number(requested);
      const id = url.searchParams.get("beforeId");
      if (!Number.isSafeInteger(index) || index < 0 || !id) return json(400, { error: "beforeIndex and beforeId must identify a message boundary" });
      const limit = Math.min(parsePagination(url.searchParams.get("limit")).limit, MESSAGES_MAX);
      const before = rows(
        `SELECT m.* FROM messages m JOIN chats c ON m.chat_id = c.id
        WHERE m.chat_id = ? AND c.user_id = ? AND m.index_in_chat <= ?
          AND (m.index_in_chat < ? OR m.id < ?)
        ORDER BY m.index_in_chat DESC, m.id DESC LIMIT ?`,
        chatId,
        user,
        index,
        index,
        id,
        limit + 1,
      );
      const more = before.length > limit;
      if (more) before.length = limit;
      return json(200, { data: before.reverse().map(shape), has_more: more, limit });
    }
    const total = Number(rows("SELECT COUNT(*) as count FROM messages m JOIN chats c ON m.chat_id = c.id WHERE m.chat_id = ? AND c.user_id = ?", chatId, user)[0]!.count);
    if (url.searchParams.get("tail") === "true") {
      const limit = Math.min(parsePagination(url.searchParams.get("limit")).limit, MESSAGES_MAX);
      const newest = rows("SELECT m.* FROM messages m JOIN chats c ON m.chat_id = c.id WHERE m.chat_id = ? AND c.user_id = ? ORDER BY m.index_in_chat DESC, m.id DESC LIMIT ?", chatId, user, limit).reverse();
      return json(200, { data: newest.map(shape), total, limit, offset: Math.max(0, total - newest.length) });
    }
    const pagination = parsePagination(url.searchParams.get("limit"), url.searchParams.get("offset"));
    const page = rows(`${MESSAGES_ALL} LIMIT ? OFFSET ?`, chatId, user, pagination.limit, pagination.offset);
    return json(200, pageOf(page.map(shape), total, pagination));
  }

  /** `listEntriesPaginated` (`services/world-books.service.ts:1550-1620`): sorted by `order` unless asked, filtered by folder, tags, type and search. */
  private entriesPage(bookId: string, pagination: Pagination, options: EntryOptions, rows: (sql: string, ...params: (string | number | null)[]) => Record<string, unknown>[]): unknown {
    const column = ENTRY_SORT_COLUMNS[options.sortBy ?? "order"] ?? "order_value";
    const collate = options.sortBy === "name" ? " COLLATE NOCASE" : "";
    const direction = options.sortDir === "desc" ? "DESC" : "ASC";
    const conditions = ["e.world_book_id = ?"];
    const params: (string | number | null)[] = [bookId];
    const search = options.search?.trim() ?? "";
    if (search !== "") {
      // Lumiverse matches a trigram index of the entry's text for three characters or more, each word a phrase, all of them (`:1524-1530`); a shorter
      // query is a substring of one of four columns (`:1585-1591`). The stand-in has no index: each word is a substring of the same four columns.
      const words = search.length >= 3 ? search.split(/\s+/).filter(Boolean) : [search];
      for (const word of words) {
        const like = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
        conditions.push("(e.comment LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\' OR e.key LIKE ? ESCAPE '\\' OR e.keysecondary LIKE ? ESCAPE '\\')");
        params.push(like, like, like, like);
      }
    }
    if (options.folder !== undefined) {
      conditions.push("e.folder = ?");
      params.push(options.folder.trim());
    }
    for (const tag of [...new Set((options.tags ?? []).map((t) => t.trim()).filter(Boolean))]) {
      conditions.push("EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(e.tags) THEN CASE WHEN json_type(e.tags) = 'array' THEN e.tags ELSE '[]' END ELSE '[]' END) t WHERE t.value = ?)");
      params.push(tag);
    }
    if (options.type === "constant") conditions.push("e.constant = 1");
    if (options.type === "vector") conditions.push("e.constant = 0 AND e.vectorized = 1");
    if (options.type === "trigger") conditions.push("e.constant = 0 AND e.vectorized = 0");
    const where = conditions.join(" AND ");
    const total = Number(rows(`SELECT COUNT(*) as count FROM world_book_entries e WHERE ${where}`, ...params)[0]!.count);
    const page = rows(`SELECT e.* FROM world_book_entries e WHERE ${where} ORDER BY e.${column}${collate} ${direction}, e.id ASC LIMIT ? OFFSET ?`, ...params, pagination.limit, pagination.offset);
    return pageOf(page.map(rowToEntry), total, pagination);
  }

  /**
   * `POST /api/v1/generate/dry-run` (`routes/generate.routes.ts:26-43`; `services/generate.service.ts:3080-3274`): the prompt assembled as a
   * generation would assemble it, its interceptors run with `dryRun` set, and no lock, no provider call and nothing saved. `chat_id` is
   * required (400); a failure is told as 400 with its message. The connection is the chat's pin, else the one asked (`connection_id`)
   * (`services/generation/connection-resolution.ts:65-91`; the stand-in has no default connection).
   */
  private async dryRun(request: Request, user: string): Promise<Response> {
    const host = this.options.host;
    const db = this.options.db;
    if (host === undefined) return json(404, { error: "Not found" });
    const text = await request.text();
    const body = parsed(text, undefined) as Record<string, unknown> | null | undefined;
    // `c.req.json()` throws on what is not JSON, and the app has no handler of its own for it: Hono answers 500.
    if (body === undefined) return new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain; charset=UTF-8" } });
    if (body === null || typeof body !== "object" || !body.chat_id) return json(400, { error: "chat_id is required" });
    const asked = (key: string): string | undefined => (typeof body[key] === "string" && body[key] !== "" ? (body[key] as string) : undefined);
    if (body.include_request_messages !== undefined && typeof body.include_request_messages !== "boolean") return generationError("include_request_messages must be a boolean");
    const chatId = String(body.chat_id);
    const rows = (sql: string, ...params: (string | number | null)[]): Record<string, unknown>[] => db?.rows(sql, ...params) ?? [];
    const chat = rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chatId, user)[0];
    const metadata = chat === undefined ? {} : rowMetadata(chat.metadata);
    const settingOf = (key: string): unknown => {
      const row = rows("SELECT value FROM settings WHERE key = ? AND user_id = ?", key, user)[0];
      return row === undefined ? undefined : parsed(row.value, undefined);
    };
    const pin = typeof metadata.connection_profile_id === "string" ? metadata.connection_profile_id.trim() : "";
    const connection = host.connections.get(pin) ?? host.connections.get(asked("connection_id") ?? "");
    if (connection === undefined) return generationError("No connection profile found. Configure a default connection or select one for this chat.");
    const presetId = asked("preset_id") ?? (typeof settingOf("activeLoomPresetId") === "string" ? (settingOf("activeLoomPresetId") as string) : undefined);
    if (presetId === undefined) return generationError(host.presets.size === 0 ? "No presets available. Create a preset before generating." : "No preset selected. Choose a preset before generating.");
    if (!host.presets.has(presetId)) return generationError("The selected preset was deleted. Pick a different preset before generating.");
    if (chat === undefined) return generationError("Chat not found");
    const persona = asked("persona_id") ?? (typeof settingOf("activePersonaId") === "string" ? (settingOf("activePersonaId") as string) : undefined);
    const outcome = await host.generate({
      chat: chatId,
      connection: connection.id,
      preset: presetId,
      type: (asked("generation_type") ?? "normal") as GenerationType,
      dryRun: true,
      ...(persona !== undefined ? { persona } : {}),
      ...(asked("message_id") !== undefined ? { message: asked("message_id")! } : {}),
      ...(isRecord(body.parameters) ? { parameters: body.parameters } : {}),
    });
    if (outcome.error !== null) return generationError(outcome.error);
    const sourceMessages = new Map(rows(MESSAGES_ALL, chatId, user).map((row) => [String(row.id), rowToMessage(row)] as const));
    const reasoning = settingOf("reasoningSettings");
    return json(
      200,
      dryRunResult({ outcome, connection, sourceMessages, reasoningSettings: isRecord(reasoning) ? reasoning : null, includeRequestMessages: body.include_request_messages === true }),
    );
  }

  // ---------------------------------------------------------------- sockets

  /** Consumes a ticket (`ws/tickets.ts:62-67`): used once, and only within its thirty seconds. */
  private consume(ticket: string | null): string | null {
    if (ticket === null) return null;
    const t = this.ticketsLive.get(ticket);
    this.ticketsLive.delete(ticket);
    return t === undefined || this.clock.now() > t.expires ? null : t.user;
  }

  /** A socket of the server's own, not yet kept: Lumiverse's receive queue in front of its handler (`ws/handler.ts:254-467`). */
  private create(user: string, session: string | undefined, client: SocketEvents, readBytesPerSecond?: number): ServerSocket {
    return new ServerSocket(
      { user, ...(session !== undefined ? { session } : {}), handlerMs: this.options.handlerMs ?? 0, ...(readBytesPerSecond !== undefined ? { readBytesPerSecond } : {}) },
      this.clock,
      client,
      (s, frame) => this.handle(s, frame),
      (s) => this.closed(s),
    );
  }

  /** The socket kept for its user, and its frontend session where it has one. */
  private register(socket: ServerSocket): void {
    this.sockets.add(socket);
    const session = socket.session;
    if (session !== undefined) {
      // A session opened again replaces the one before, which is closed (`spindle/frontend-session.ts:14-21`; `ws/handler.ts:202`).
      const byId = this.frontends.get(socket.user) ?? new Map<string, ServerSocket>();
      const before = byId.get(session);
      byId.set(session, socket);
      this.frontends.set(socket.user, byId);
      before?.close(1000, "Frontend session reconnected");
    }
  }

  private serve(user: string, session: string | undefined, client: SocketEvents, readBytesPerSecond?: number): ServerSocket {
    const socket = this.create(user, session, client, readBytesPerSecond);
    this.register(socket);
    return socket;
  }

  private closed(socket: ServerSocket): void {
    this.sockets.delete(socket);
    const session = socket.session;
    if (session === undefined) return;
    const byId = this.frontends.get(socket.user);
    if (byId?.get(session) !== socket) return;
    byId.delete(session);
    // The session's `closed` (`ws/handler.ts:203`): the extension hears its frontend went.
    this.options.host?.emit("FRONTEND_SESSION_CLOSED", { frontendSessionId: session }, socket.user);
  }

  private async handle(socket: ServerSocket, frame: Record<string, unknown>): Promise<void> {
    if (frame.type === "visibility") {
      // `ws/handler.ts:299-304`: the page says whether it is shown; a hidden one is let be 30 minutes (`ws/bus.ts:461-463`).
      socket.visible = !!frame.visible;
      return;
    }
    if (frame.type === "ping") {
      // `ws/handler.ts:284-292`.
      if (this.answerPings) socket.send(JSON.stringify({ type: "pong", timestamp: this.clock.now(), ...(typeof frame.id === "string" ? { id: frame.id } : {}) }));
      return;
    }
    if (frame.type === "SPINDLE_BACKEND_MSG") {
      // `ws/handler.ts:440-467`: the extension looked up for the user, then the message posted to its worker.
      const handled = Promise.withResolvers<void>();
      this.clock.setTimeout(handled.resolve, this.options.handlerMs ?? 0);
      await handled.promise;
      const listed = typeof frame.extensionId === "string" ? this.listed.get(frame.extensionId) : undefined;
      if (listed !== undefined && socket.closed === null) listed.installed.fromFrontend(frame.payload, socket.user, socket.session);
    }
  }

  /** `sendToFrontend` (`spindle/worker-host.ts:2129-2160`): to the session named alone, or to every socket of the user. */
  private toFrontend(extension: string, data: unknown, user: string | undefined, session: string | undefined): boolean {
    const identifier = this.listed.get(extension)?.identifier ?? extension;
    const frame = JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", timestamp: this.clock.now(), payload: { extensionId: extension, identifier, data } });
    if (session !== undefined) {
      const socket = user === undefined ? undefined : this.frontends.get(user)?.get(session);
      if (socket === undefined || socket.closed !== null) return false;
      socket.send(frame);
      return true;
    }
    for (const s of this.sockets) if (s.closed === null && (user === undefined || s.user === user)) s.send(frame);
    return true;
  }

  /**
   * RPE's way in (`socket.ts`'s `OpenSocket`): `/api/ws?ticket=…`, answered on a later task, as
   * Lumiverse's `onOpen` runs (`ws/handler.ts:122-248`): `AUTH_ERROR` and a close with 1008 for a ticket
   * it does not take, else `CONNECTED`. The socket exists from the upgrade: what the client sends before it is let in is counted and kept (`ws/receive-queue.ts:
   * 104-109`), and one not let in within 10 s is closed, 1013 "WebSocket authentication timed out" (`:111-112`).
   */
  open: OpenSocket = (url: string, events: SocketEvents): Socket => {
    const u = new URL(url);
    let gone = false;
    const later = (ms: number, run: () => void): void => void this.clock.setTimeout(run, ms);
    const served = this.create("", undefined, events);
    served.admitted = false;
    const admission = this.clock.setTimeout(() => served.close(1013, "WebSocket authentication timed out"), RECEIVE_LIMITS.maxPauseMs);
    const refuse = (code: number, reason: string): void => {
      this.clock.clearTimeout(admission);
      served.clientClosed(code, reason);
      later(0, () => events.close(code, reason));
    };
    const handshake = (): void => {
      if (gone || served.closed !== null) return;
      const user = u.pathname === "/api/ws" ? this.consume(u.searchParams.get("ticket")) : null;
      if (user === null || this.refuseTickets) {
        events.message(JSON.stringify({ event: "AUTH_ERROR", payload: { message: "Invalid or expired ticket" }, timestamp: this.clock.now() }));
        refuse(1008, "Invalid or expired ticket");
        return;
      }
      const session = u.searchParams.get("frontend_session") ?? undefined;
      // `readFrontendSessionId` (`spindle/frontend-session.ts:1-5`; `ws/handler.ts:206-209`).
      if (session !== undefined && !/^[0-9a-f]{32}$/.test(session)) {
        refuse(1008, "Invalid frontend session");
        return;
      }
      this.clock.clearTimeout(admission);
      served.admit(user, session);
      this.register(served);
      served.send(JSON.stringify({ event: "CONNECTED", payload: { message: "Connected to Lumiverse event bus", userId: user, role: this.roleOf(user), extensionCommands: [] }, timestamp: this.clock.now() }));
    };
    if (this.openDelayMs !== null) later(this.openDelayMs, handshake);
    return {
      send: (text) => served.fromClient(text),
      close: (code = 1000, reason = "") => {
        if (gone || served.closed !== null) return;
        gone = true;
        this.clock.clearTimeout(admission);
        served.clientClosed(code, reason);
        // The client's own close event comes after its close frame is answered.
        later(0, () => events.close(code, reason));
      },
    };
  };

  /**
   * A Lumiverse page of the user, with its frontend session, already signed in by its cookie: the
   * channel the extension's frontend gets (`ctx.sendToBackend`, `ctx.onBackendMessage`), over a socket
   * the server keeps like any other. `readBytesPerSecond` is how fast the page reads what it is sent.
   */
  page(user: string, session: string, extension: string, readBytesPerSecond?: number): { channel: PageChannel; socket: ServerSocket; close(): void } {
    const handlers = new Set<(payload: unknown) => void>();
    const socket = this.serve(
      user,
      session,
      {
        message: (text) => {
          const frame = parsed(text, null) as { event?: unknown; payload?: { extensionId?: unknown; data?: unknown } } | null;
          if (frame?.event !== "SPINDLE_FRONTEND_MSG" || frame.payload?.extensionId !== extension) return;
          for (const handler of handlers) handler(frame.payload.data);
        },
        close: () => undefined,
      },
      readBytesPerSecond,
    );
    const channel: PageChannel = {
      sendToBackend: (payload) => socket.fromClient(JSON.stringify({ type: "SPINDLE_BACKEND_MSG", extensionId: extension, payload })),
      onBackendMessage(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    return { channel, socket, close: () => socket.clientClosed(1000, "page closed") };
  }
}
