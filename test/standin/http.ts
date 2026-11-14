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

import type { Clock } from "rp-harness/contract";
import type { OpenSocket, Socket, SocketEvents } from "../../src/adapter/lumiverse/socket";
import type { PageChannel } from "../../src/ext/page";
import type { StandInDb } from "./db";
import type { Installed, StandIn } from "./lumiverse";
import { CLIENT_TIMEOUT_MS, ServerSocket, SWEEP_MS } from "./sockets";

type Timers = Pick<Clock, "now" | "setTimeout" | "clearTimeout">;

export interface Account {
  id: string;
  username: string;
  password: string;
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
/** `TICKET_TTL_MS` (`ws/tickets.ts:22`). */
const TICKET_TTL_MS = 30_000;
/** A page of a list is at most 1000 rows (`types/pagination.ts:12-14`). */
const PAGE_MAX = 1000;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const parsed = (text: unknown, fallback: unknown): unknown => {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fallback;
  }
};

/** A message row as Lumiverse's light list serves it (`rowToMessage` and `rowToMessageLight`, `services/chats.service.ts:587-605`, `:655-669`): lists parsed, `is_user` a boolean, the swipes not shown left out. */
function lightMessage(row: Record<string, unknown>): Record<string, unknown> {
  const swipes = parsed(row.swipes, [row.content ?? ""]);
  const swipeId = typeof row.swipe_id === "number" ? row.swipe_id : 0;
  const list = Array.isArray(swipes) ? swipes : [row.content ?? ""];
  return {
    ...row,
    is_user: row.is_user === 1 || row.is_user === true,
    swipes: list.length > 1 ? list.map((s, i) => (i === swipeId ? s : null)) : list,
    swipe_dates: parsed(row.swipe_dates || "[]", []),
    extra: parsed(row.extra, {}),
  };
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

  constructor(private readonly options: LumiverseServerOptions) {
    this.clock = options.clock;
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
      for (const s of [...this.sockets]) if (now - s.lastInbound > CLIENT_TIMEOUT_MS) s.close(1001, "Timeout");
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

  private async answer(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = this.clock.now();

    // Better Auth's username sign-in (`auth/index.ts:114-116`; `better-auth/dist/plugins/username/index.mjs:57-160`), behind the sign-in limiter (`app.ts:254-276`, `middleware/rate-limit.ts:114-121`).
    if (request.method === "POST" && path === "/api/auth/sign-in/username") {
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

    // `GET /api/auth/get-session` (`better-auth/dist/api/routes/session.mjs:19-130`): the session and its user, or `null`.
    if (request.method === "GET" && path === "/api/auth/get-session") {
      const s = this.sessionOf(request);
      return json(200, s === null ? null : { session: { id: s.token.slice(0, 8), userId: s.user, token: s.token, expiresAt: new Date(s.expiresAt).toISOString() }, user: { id: s.user } });
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

    // `GET /api/v1/spindle` (`routes/spindle.routes.ts:45-58`): the extensions the user may use.
    if (request.method === "GET" && path === "/api/v1/spindle") {
      const extensions = [...this.listed.entries()].map(([id, l]) => ({ id, identifier: l.identifier, name: l.identifier, enabled: true, status: "running" }));
      return json(200, { extensions, isPrivileged: false });
    }

    const db = this.options.db;
    const chatPath = /^\/api\/v1\/chats\/([^/]+)(\/messages)?$/.exec(path);
    if (request.method === "GET" && chatPath !== null) {
      const chatId = decodeURIComponent(chatPath[1]!);
      const chat = db?.rows("SELECT * FROM chats WHERE id = ? AND user_id = ?", chatId, user)[0];
      // `GET /api/v1/chats/:id` (`routes/chats.routes.ts:410-421`), the chat as `rowToChat` gives it.
      if (chatPath[2] === undefined) return chat === undefined ? json(404, { error: "Not found" }) : json(200, { ...chat, metadata: parsed(chat.metadata, {}) });
      // `GET /api/v1/chats/:chatId/messages` (`routes/chats.routes.ts:792-821`): a page of the light list, `{data, total, limit, offset}` (`services/pagination.ts:27-45`).
      if (chat === undefined || db === undefined) return json(404, { error: "Chat not found" });
      const all = db.rows("SELECT * FROM messages WHERE chat_id = ? ORDER BY index_in_chat, rowid", chatId);
      const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
      return json(200, { data: all.slice(offset, offset + limit).map(lightMessage), total: all.length, limit, offset });
    }

    // `POST /api/v1/generate/stop` (`app.ts:443`, `routes/generate.routes.ts:45-65`): the generation named, else the chat's,
    // else every one of the user's. An id is taken only when it is truthy (`:48`, `:53`, `:60`): an empty one names nothing.
    if (request.method === "POST" && path === "/api/v1/generate/stop" && this.options.host) {
      const body = parsed(await request.text(), null) as { generation_id?: unknown; chat_id?: unknown } | null;
      const ask = { ...(typeof body?.generation_id === "string" && body.generation_id !== "" ? { generation: body.generation_id } : {}), ...(typeof body?.chat_id === "string" && body.chat_id !== "" ? { chat: body.chat_id } : {}) };
      return json(200, { stopped: this.options.host.stop(user, ask) });
    }

    return json(404, { error: "Not found" });
  }

  // ---------------------------------------------------------------- sockets

  /** Consumes a ticket (`ws/tickets.ts:62-67`): used once, and only within its thirty seconds. */
  private consume(ticket: string | null): string | null {
    if (ticket === null) return null;
    const t = this.ticketsLive.get(ticket);
    this.ticketsLive.delete(ticket);
    return t === undefined || this.clock.now() > t.expires ? null : t.user;
  }

  /** A socket the server keeps: Lumiverse's receive queue in front of its handler (`ws/handler.ts:254-467`). */
  private serve(user: string, session: string | undefined, client: SocketEvents, readBytesPerSecond?: number): ServerSocket {
    const socket = new ServerSocket(
      { user, ...(session !== undefined ? { session } : {}), handlerMs: this.options.handlerMs ?? 0, ...(readBytesPerSecond !== undefined ? { readBytesPerSecond } : {}) },
      this.clock,
      client,
      (s, frame) => this.handle(s, frame),
      (s) => this.closed(s),
    );
    this.sockets.add(socket);
    if (session !== undefined) {
      // A session opened again replaces the one before, which is closed (`spindle/frontend-session.ts:14-21`; `ws/handler.ts:202`).
      const byId = this.frontends.get(user) ?? new Map<string, ServerSocket>();
      const before = byId.get(session);
      byId.set(session, socket);
      this.frontends.set(user, byId);
      before?.close(1000, "Frontend session reconnected");
    }
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
   * it does not take, else `CONNECTED`.
   */
  open: OpenSocket = (url: string, events: SocketEvents): Socket => {
    const u = new URL(url);
    let served: ServerSocket | null = null;
    let gone = false;
    const early: string[] = [];
    const later = (ms: number, run: () => void): void => void this.clock.setTimeout(run, ms);
    const handshake = (): void => {
      if (gone) return;
      const user = u.pathname === "/api/ws" ? this.consume(u.searchParams.get("ticket")) : null;
      if (user === null || this.refuseTickets) {
        events.message(JSON.stringify({ event: "AUTH_ERROR", payload: { message: "Invalid or expired ticket" }, timestamp: this.clock.now() }));
        later(0, () => events.close(1008, "Invalid or expired ticket"));
        return;
      }
      const session = u.searchParams.get("frontend_session") ?? undefined;
      // `readFrontendSessionId` (`spindle/frontend-session.ts:1-5`; `ws/handler.ts:206-209`).
      if (session !== undefined && !/^[0-9a-f]{32}$/.test(session)) {
        later(0, () => events.close(1008, "Invalid frontend session"));
        return;
      }
      served = this.serve(user, session, events);
      served.send(JSON.stringify({ event: "CONNECTED", payload: { message: "Connected to Lumiverse event bus", userId: user, role: "user", extensionCommands: [] }, timestamp: this.clock.now() }));
      for (const text of early.splice(0)) served.fromClient(text);
    };
    if (this.openDelayMs !== null) later(this.openDelayMs, handshake);
    return {
      send: (text) => {
        if (served === null) early.push(text);
        else served.fromClient(text);
      },
      close: (code = 1000, reason = "") => {
        if (gone) return;
        gone = true;
        served?.clientClosed(code, reason);
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
