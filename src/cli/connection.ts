// The way into LumiRPEngine on a Lumiverse host from outside it (DESIGN §23), with no change to
// Lumiverse. The saved session token is a bearer: find the extension (`GET /api/v1/spindle`), take
// a single-use ticket, open the event socket as a widget session (so it never takes the
// frontend-execution slot from the user's browser), wait for CONNECTED, then send LRE envelopes as
// SPINDLE_BACKEND_MSG frames and match each answer to its request by reqId. The host never
// acknowledges a frame, so every request has a timeout. HTTP and the socket are passed in: the
// tests run all of this against a fake host.

import type { AgentCheckIn, HelloClient } from "../shared/agents";
import { isRecord } from "../shared/json";
import type { ErrorCode, FrontendToBackend, LintIssue, ResultBodies } from "../shared/protocol";
import { AGENT_API, ENGINE_EXTENSION, PROTOCOL_VERSION } from "../shared/protocol";
import { formatMs } from "../shared/timeouts";
import { inClear } from "./credentials";

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpReply {
  status: number;
  header(name: string): string | null;
  text: string;
}

/** One HTTP exchange; main.ts supplies Node's fetch. */
export type Http = (request: HttpRequest) => Promise<HttpReply>;

export interface SocketEvents {
  message(text: string): void;
  close(code: number, reason: string): void;
}

export interface Socket {
  send(text: string): void;
  close(): void;
}

/** Opens the event socket; main.ts supplies Node's WebSocket. Events arrive later, never during the call itself. */
export type OpenSocket = (url: string, events: SocketEvents) => Socket;

export type LiveProblem = "login" | "locked" | "unreachable" | "forbidden" | "insecure" | "not_installed" | "not_running" | "too_old" | "timeout" | "closed" | "too_large" | "protocol";

/**
 * The brands the errors below carry. The core and each agent kit are bundles of their own, each with
 * its own copy of these classes (DESIGN §23), so `instanceof` checks a brand that every copy sets
 * rather than the class: an error the core's connection throws is still a LiveError to a kit's tools.
 */
const LIVE_ERROR = Symbol.for("lumirpengine.LiveError");
const LRE_ERROR = Symbol.for("lumirpengine.LreError");

/** Why a call to the host failed, in words the user can act on. */
export class LiveError extends Error {
  static override [Symbol.hasInstance](value: unknown): value is LiveError {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[LIVE_ERROR] === true;
  }

  constructor(
    readonly problem: LiveProblem,
    message: string,
  ) {
    super(message);
    this.name = "LiveError";
    Object.defineProperty(this, LIVE_ERROR, { value: true });
  }
}

/** LumiRPEngine refused a request (`lre.error`): its code, its words, and the lint behind a refused commit. */
export class LreError extends Error {
  static override [Symbol.hasInstance](value: unknown): value is LreError {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[LRE_ERROR] === true;
  }

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly lint: LintIssue[],
  ) {
    super(message);
    this.name = "LreError";
    Object.defineProperty(this, LRE_ERROR, { value: true });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RequestType = FrontendToBackend["type"];
/** A request's own fields: the envelope (`lre`, `type`, `reqId`) is the connection's. */
export type RequestFields<T extends RequestType> = DistributiveOmit<Extract<FrontendToBackend, { type: T }>, "lre" | "type" | "reqId">;

export interface ExtensionInfo {
  /** Its database id, which frames are addressed by. */
  id: string;
  version: string | null;
  enabled: boolean;
  status: string;
}

export interface SessionState {
  /** Whether the session holds; null when the host couldn't be asked (a lockout, an outage, a refusal). */
  valid: boolean | null;
  /** Until when the session holds unused (each use extends it); null when the host didn't say. */
  expiresAt: string | null;
}

/** The host as `lre_status` reports it. */
export interface HostDescription {
  base: string;
  /** Who the saved sign-in is for; null when there is none. */
  username: string | null;
  session: SessionState;
  extension: ExtensionInfo | null;
  /** The agent API level LumiRPEngine answered `lre.hello` with; null when it named none or wasn't reached. */
  agentApi: number | null;
  /** What stopped the description short, if anything. */
  problem: string | null;
  /** What an MCP server checks in with (DESIGN §23): its builds and whether it follows the extension's kit; null from a command-line run. */
  checkIn: AgentCheckIn | null;
}

/** The saved sign-in a connection uses (`StoredLogin`). */
export interface Credentials {
  username: string;
  token: string;
  /** The user agreed to plain http to another machine (`login --allow-http`). */
  allowHttp?: true;
}

/** What the live tools need of the host. */
export interface Connection {
  /** Sends one request and resolves with its result body; `lre.error` rejects with an LreError. Refuses an LRE older than AGENT_API. */
  request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]>;
  describe(): Promise<HostDescription>;
  close(): void;
}

/** The host drops a larger frame without a word. */
export const FRAME_LIMIT = 4 * 1024 * 1024;
/** Each request's wait, and the socket's opening, unless `--timeout` or `LRE_TIMEOUT` says otherwise. */
const TIMEOUT_MS = 300_000;
/** What a timeout's message says to raise. */
const RAISE = "Raise --timeout (or LRE_TIMEOUT) in seconds, or set it to none.";
/** The host closes a socket idle for 120 s. */
const PING_MS = 45_000;

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The words a Lumiverse error reply carries, if any. */
function said(text: string): string {
  const body = parse(text);
  const words = isRecord(body) ? (body.message ?? body.error) : null;
  return typeof words === "string" && words !== "" ? `: ${words}` : "";
}

const loginAgain = (base: string): string => `Your Lumiverse session for ${base} is no longer valid (it expired, or was signed out). Sign in again: lumirpengine login --url ${base}`;

const forbidden = (base: string): string =>
  `Lumiverse at ${base} refused this client (403 Forbidden): the address isn't one of its trusted hosts. Use the URL you open Lumiverse at in your browser, or add the host to Lumiverse's trusted hosts (Operator panel) or TRUSTED_ORIGINS. See docs/MCP.md, "Troubleshooting".`;

/** How long a 429 asks to wait, in words. */
function waitOf(reply: HttpReply): string {
  const minutes = Math.ceil(Number(reply.header("retry-after")) / 60);
  return Number.isFinite(minutes) && minutes > 0 ? `for about ${minutes} minute${minutes === 1 ? "" : "s"}` : "for a while";
}

/** A 429 from any route but the sign-in: a lockout blocks every /api request from the address. */
const lockedOut = (reply: HttpReply): string =>
  `Lumiverse is refusing every request from this address ${waitOf(reply)}${said(reply.text)}: it locks an address out after repeated failed sign-ins, and that includes your browser on this machine. Wait it out; signing in again before then only makes the next lockout longer.`;

/** What a refusal means, for the replies a caller doesn't read itself; `asked` says what was asked ("asked for its extensions"). */
function refused(base: string, reply: HttpReply, asked: string): LiveError {
  if (reply.status === 401) return new LiveError("login", loginAgain(base));
  if (reply.status === 403) return new LiveError("forbidden", forbidden(base));
  if (reply.status === 429) return new LiveError("locked", lockedOut(reply));
  if (reply.status === 404) return new LiveError("unreachable", `There is no Lumiverse at ${base} (404 when it ${asked}). Check the URL: it's the address you open Lumiverse at.`);
  return new LiveError("unreachable", `Lumiverse at ${base} answered ${reply.status} when it ${asked}${said(reply.text)}. Behind a proxy, that can mean Lumiverse itself is down.`);
}

async function exchange(http: Http, base: string, method: "GET" | "POST", path: string, token: string | null, body?: string): Promise<HttpReply> {
  // No Origin and no Cookie, ever: a bearer request without them passes Lumiverse's origin checks.
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  let reply: HttpReply;
  try {
    reply = await http({ method, url: `${base}${path}`, headers, ...(body !== undefined ? { body } : {}) });
  } catch (error) {
    throw new LiveError("unreachable", `Can't reach Lumiverse at ${base}: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Redirects aren't followed: one would drop the bearer (or turn the sign-in into a GET).
  if (reply.status >= 300 && reply.status < 400) {
    let target: URL | null = null;
    try {
      target = new URL(reply.header("location") ?? "", `${base}${path}`);
    } catch {
      // A Location that isn't a URL: the message names no address.
    }
    // The address to sign in at instead: the target, without the route that was asked for.
    const instead = target === null ? "<that address>" : target.pathname.endsWith(path) ? `${target.origin}${target.pathname.slice(0, -path.length)}` : target.href;
    if (target !== null && target.protocol === "https:" && base.startsWith("http:")) throw new LiveError("insecure", `Lumiverse at ${base} answers on https: use lumirpengine login --url ${instead}, so the password and the session token never cross the network in clear.`);
    throw new LiveError("unreachable", `Lumiverse at ${base} answered with a redirect to ${target?.href ?? "another address"}. Use the address it redirects to (lumirpengine login --url ${instead}).`);
  }
  return reply;
}

/** Signs in with a username and password; resolves with the session token. */
export async function signIn(http: Http, base: string, username: string, password: string): Promise<string> {
  const reply = await exchange(http, base, "POST", "/api/auth/sign-in/username", null, JSON.stringify({ username, password }));
  if (reply.status >= 200 && reply.status < 300) {
    const body = parse(reply.text);
    const token = isRecord(body) && typeof body.token === "string" && body.token !== "" ? body.token : reply.header("set-auth-token");
    if (token === null || token === "") throw new LiveError("protocol", `Lumiverse at ${base} signed you in but sent back no session token, so this client can't use the session. Is it Lumiverse's staging branch?`);
    return token;
  }
  if (reply.status === 401) throw new LiveError("login", `Lumiverse refused that username or password${said(reply.text)}. Careful: after 5 failed sign-ins Lumiverse locks your address out, your browser on this machine included, and each lockout lasts longer than the last.`);
  // The sign-in's own limit (8 tries in 5 minutes) or a lockout (after 5 failures): either way, more tries only make it worse.
  if (reply.status === 429) throw new LiveError("locked", `Lumiverse is refusing sign-ins from this address ${waitOf(reply)}${said(reply.text)}. It allows 8 sign-ins in 5 minutes, and after 5 failed ones it locks the whole address out (your browser on this machine included) for 15 minutes, then 30, an hour, 6 hours, and up to 7 days. Wait, then sign in once.`);
  if (reply.status === 403) throw new LiveError("forbidden", forbidden(base));
  if (reply.status === 404) throw new LiveError("unreachable", `There is no Lumiverse sign-in at ${base} (404). Check the URL: it's the address you open Lumiverse at.`);
  throw new LiveError("protocol", `Lumiverse answered the sign-in with ${reply.status}${said(reply.text)}.`);
}

/** How a sign-out went: `ended`; `gone`, the host no longer had the session (401); or `unconfirmed`, with the status the host answered instead. */
export type SignOutResult = { outcome: "ended" | "gone" } | { outcome: "unconfirmed"; status: number };

/** Ends the session on the host. */
export async function signOut(http: Http, base: string, token: string): Promise<SignOutResult> {
  const reply = await exchange(http, base, "POST", "/api/auth/sign-out", token, "{}");
  if (reply.status >= 200 && reply.status < 300) return { outcome: "ended" };
  if (reply.status === 401) return { outcome: "gone" };
  return { outcome: "unconfirmed", status: reply.status };
}

/**
 * Whether a session holds, and until when it holds unused: a 401, or an answer with no session,
 * means it doesn't. Any other answer (a lockout, a refusal, an outage) says nothing about the
 * session, so it throws. With no token, it asks as nobody: `login` does that first, before a password is sent.
 */
export async function sessionOf(http: Http, base: string, token: string | null): Promise<SessionState> {
  const reply = await exchange(http, base, "GET", "/api/auth/get-session", token);
  if (reply.status === 401) return { valid: false, expiresAt: null };
  if (reply.status < 200 || reply.status >= 300) throw refused(base, reply, "was asked about the session");
  const body = parse(reply.text);
  const session = isRecord(body) && isRecord(body.session) ? body.session : null;
  if (session === null) return { valid: false, expiresAt: null };
  return { valid: true, expiresAt: typeof session.expiresAt === "string" ? session.expiresAt : null };
}

interface Pending {
  resolve(body: unknown): void;
  reject(error: Error): void;
  timer: Timer | undefined;
}

interface Opened {
  extension: ExtensionInfo;
  agentApi: number | null;
}

export interface ConnectionOptions {
  base: string;
  /**
   * The sign-in saved for `base`, read again every time the connection opens and whenever the host
   * is asked about the session: after a `lumirpengine login`, a running server uses the new token.
   */
  credentials(): Credentials | null;
  http: Http;
  openSocket: OpenSocket;
  /** Named in `lre.hello`: LumiRPEngine labels this client's commits `agent`. A command-line run says it serves no MCP. */
  client: HelloClient;
  /** An MCP server's check-in (DESIGN §23), sent with every hello: read again for each one. */
  checkIn?(): AgentCheckIn;
  /** The agent API level the tools need: the loaded kit's (DESIGN §23). AGENT_API when not given. */
  needs?(): number;
  /** Each hello's answer, with the check-in that hello carried: an MCP server learns there which build LumiRPEngine is and where its kit is. */
  onHello?(answer: Record<string, unknown>, sent: AgentCheckIn | null): void;
  /** What LumiRPEngine sends unasked (no reqId of ours): an MCP server is asked to reload there. */
  onPush?(push: Record<string, unknown>): void;
  /** Null: no limit. */
  timeoutMs?: number | null;
  pingMs?: number;
}

/** A frontend session id as Lumiverse takes one: 32 lowercase hex digits, fresh for every socket. */
function frontendSession(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class HostConnection implements Connection {
  private socket: Socket | null = null;
  private opened: Opened | null = null;
  private opening: Promise<Opened> | null = null;
  /** The extension as the last lookup found it, for a status that stops short after it. */
  private lastExtension: ExtensionInfo | null = null;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private prefix = "";
  private ping: Timer | null = null;
  /** The token the open socket was made with. Lumiverse trusts a socket for its life, so a logout or a new login drops it here. */
  private openedToken: string | null = null;
  /** Settles the open in progress when CONNECTED (or AUTH_ERROR) arrives. */
  private greeting: { resolve(): void; reject(error: Error): void } | null = null;
  private readonly timeoutMs: number | null;
  private readonly pingMs: number;

  constructor(private readonly options: ConnectionOptions) {
    this.timeoutMs = options.timeoutMs === undefined ? TIMEOUT_MS : options.timeoutMs;
    this.pingMs = options.pingMs ?? PING_MS;
  }

  /** The Lumiverse this connection is to. */
  get base(): string {
    return this.options.base;
  }

  async request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]> {
    const opened = await this.ensure();
    if (opened.agentApi === null || opened.agentApi < this.needs()) throw new LiveError("too_old", this.tooOld(opened.agentApi));
    return (await this.send(type, fields)) as ResultBodies[T];
  }

  async describe(): Promise<HostDescription> {
    const { base, http } = this.options;
    const out: HostDescription = { base, username: this.options.credentials()?.username ?? null, session: { valid: null, expiresAt: null }, extension: null, agentApi: null, problem: null, checkIn: this.options.checkIn?.() ?? null };
    try {
      out.session = await sessionOf(http, base, this.signedIn().token);
      if (out.session.valid === false) {
        out.problem = loginAgain(base);
        return out;
      }
      const opened = await this.ensure();
      out.extension = opened.extension;
      out.agentApi = opened.agentApi;
      if (opened.agentApi === null || opened.agentApi < this.needs()) out.problem = this.tooOld(opened.agentApi);
    } catch (error) {
      out.problem = error instanceof Error ? error.message : String(error);
      out.extension = this.lastExtension;
    }
    return out;
  }

  /** Opens the socket, saying hello, unless it is open already. */
  async ensureOpen(): Promise<void> {
    await this.ensure();
  }

  /** Whether the socket is open and greeted. */
  isOpen(): boolean {
    return this.opened !== null && this.socket !== null;
  }

  /** Says hello again on the open socket (an MCP server checks in after a change of what it runs); nothing when none is open. */
  async checkInAgain(): Promise<void> {
    if (this.isOpen()) await this.greet();
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.closed(1000, "closed by the client");
  }

  private needs(): number {
    return this.options.needs?.() ?? AGENT_API;
  }

  private tooOld(agentApi: number | null): string {
    const speaks = agentApi === null ? "doesn't speak the agent API" : `speaks agent API ${agentApi}`;
    return `LumiRPEngine on ${this.options.base} is too old for lumirpengine ${this.options.client.version}: it ${speaks}, and this client needs ${this.needs()}. Update LumiRPEngine on your Lumiverse (Extensions → LumiRPEngine → Update), then try again.`;
  }

  /** The sign-in to use now. Plain http to another machine needs the consent `login --allow-http` saved with it. */
  private signedIn(): Credentials {
    const { base } = this.options;
    const saved = this.options.credentials();
    if (saved === null) throw new LiveError("login", `Not signed in to ${base}. Run: lumirpengine login --url ${base}`);
    if (inClear(base) && saved.allowHttp !== true) throw new LiveError("insecure", `${base} is plain http to another machine, and this sign-in wasn't made with --allow-http, so its session token won't be sent there in clear. Use https, or sign in again with: lumirpengine login --url ${base} --allow-http`);
    return saved;
  }

  private ensure(): Promise<Opened> {
    if (this.opened !== null && this.socket !== null) {
      // One small read per request: after `lumirpengine logout` the running server stops, and after a new login it reconnects as that.
      const saved = this.options.credentials();
      if (saved !== null && saved.token === this.openedToken) return Promise.resolve(this.opened);
      this.close();
    }
    this.opening ??= this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async findExtension(token: string): Promise<ExtensionInfo> {
    const { base, http } = this.options;
    this.lastExtension = null;
    const reply = await exchange(http, base, "GET", "/api/v1/spindle", token);
    if (reply.status !== 200) throw refused(base, reply, "was asked for its extensions");
    const body = parse(reply.text);
    const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e): e is Record<string, unknown> => isRecord(e) && e.identifier === ENGINE_EXTENSION) : undefined;
    if (!found || typeof found.id !== "string") throw new LiveError("not_installed", `LumiRPEngine isn't installed on ${base}, or your account can't use it. Install it in Lumiverse's Extensions tab from https://github.com/TheLiquorPriest/LumiRPEngine.`);
    const extension: ExtensionInfo = { id: found.id, version: typeof found.version === "string" ? found.version : null, enabled: found.enabled === true, status: typeof found.status === "string" ? found.status : "unknown" };
    this.lastExtension = extension;
    if (extension.status !== "running") throw new LiveError("not_running", `LumiRPEngine is installed on ${base} but not running (${extension.enabled ? extension.status : "disabled"}). Enable it in Lumiverse's Extensions tab.`);
    return extension;
  }

  private async ticket(token: string): Promise<string> {
    const { base, http } = this.options;
    const reply = await exchange(http, base, "POST", "/api/v1/ws-ticket", token, "{}");
    if (reply.status !== 200) throw refused(base, reply, "was asked for a socket ticket");
    const body = parse(reply.text);
    if (!isRecord(body) || typeof body.ticket !== "string") throw new LiveError("protocol", `Lumiverse at ${base} gave no socket ticket${said(reply.text)}.`);
    return body.ticket;
  }

  private async open(): Promise<Opened> {
    // Read now, not when the connection was made: a reconnect after `lumirpengine login` uses the new token.
    const { token } = this.signedIn();
    this.openedToken = token;
    const extension = await this.findExtension(token);
    // A ticket lives 30 s and works once; one refused on the way gets one more try with a new ticket.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.connect(await this.ticket(token));
        break;
      } catch (error) {
        if (!(error instanceof LiveError && error.problem === "protocol" && attempt === 1)) throw error;
      }
    }
    // `opened` gates `request`, so the hello goes through `send` directly.
    this.opened = { extension, agentApi: null };
    try {
      await this.greet();
    } catch (error) {
      this.close();
      if (error instanceof LiveError && error.problem === "timeout") throw new LiveError("timeout", `LumiRPEngine on ${this.options.base} didn't answer within ${formatMs(this.timeoutMs ?? 0)}. Check that it's running (lumirpengine status), and restart it in Lumiverse's Extensions tab if it is. ${RAISE}`);
      throw error;
    }
    return this.opened;
  }

  /** The hello: names this client (an MCP server checks in with it) and takes the agent API level from the answer. */
  private async greet(): Promise<void> {
    const opened = this.opened;
    const checkIn = this.options.checkIn?.() ?? null;
    const hello = await this.send("lre.hello", { chatId: null, client: { ...this.options.client, ...checkIn } });
    const agentApi = isRecord(hello) ? hello.agentApi : undefined;
    // Only the socket the hello was said on takes its answer.
    if (opened !== null && this.opened === opened) this.opened = { extension: opened.extension, agentApi: typeof agentApi === "number" ? agentApi : null };
    if (isRecord(hello)) this.options.onHello?.(hello, checkIn);
  }

  private connect(ticket: string): Promise<void> {
    const session = frontendSession();
    this.prefix = `${session.slice(0, 8)}-`;
    const url = new URL(this.options.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/ws`;
    url.search = new URLSearchParams({ ticket, frontend_session: session, frontend_runtime: "widget" }).toString();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const settle = (error: Error | null): void => {
      clearTimeout(timer);
      this.greeting = null;
      if (error === null) return resolve();
      // A socket that never got ready is dropped here; the next open starts a new one.
      if (this.socket === socket) this.socket = null;
      socket.close();
      reject(error);
    };
    const limit = this.timeoutMs;
    const timer = limit === null ? undefined : setTimeout(() => settle(new LiveError("timeout", `Lumiverse at ${this.options.base} opened no event socket within ${formatMs(limit)}. Behind a proxy, the proxy must pass WebSocket upgrades on /api/ws. ${RAISE}`)), limit);
    this.greeting = { resolve: () => settle(null), reject: settle };
    const socket: Socket = this.options.openSocket(url.toString(), {
      message: (text) => this.received(socket, text),
      close: (code, reason) => {
        // A socket this connection already left (closed, or given up before it was ready).
        if (this.socket !== socket) return;
        this.socket = null;
        const why = code === 1006 ? "it never opened (1006): behind a proxy, the proxy must pass WebSocket upgrades on /api/ws" : `Lumiverse closed it before it was ready (${code}${reason ? ` ${reason}` : ""})`;
        this.greeting?.reject(new LiveError(code === 1008 ? "protocol" : "closed", `The event socket at ${this.options.base}/api/ws failed: ${why}.`));
        this.closed(code, reason);
      },
    });
    this.socket = socket;
    return promise;
  }

  private received(socket: Socket, text: string): void {
    if (socket !== this.socket) return;
    const msg = parse(text);
    if (!isRecord(msg)) return;
    if (msg.event === "CONNECTED") {
      // A CLI run closes the socket when it ends; the timer alone must not keep the process up.
      this.ping ??= setInterval(() => this.socket?.send(JSON.stringify({ type: "ping" })), this.pingMs).unref();
      this.greeting?.resolve();
      return;
    }
    if (msg.event === "AUTH_ERROR") {
      this.greeting?.reject(new LiveError("protocol", "Lumiverse refused the event socket's ticket."));
      return;
    }
    if (msg.event !== "SPINDLE_FRONTEND_MSG" || !isRecord(msg.payload) || msg.payload.extensionId !== this.opened?.extension.id) return;
    const data = msg.payload.data;
    if (!isRecord(data) || data.lre !== PROTOCOL_VERSION) return;
    // Pushes (state, jobs, draft changes, a reload asked for) carry no reqId of ours: nothing here waits for them.
    if (typeof data.reqId !== "string") {
      this.options.onPush?.(data);
      return;
    }
    const waiting = this.pending.get(data.reqId);
    if (!waiting || (data.type !== "lre.result" && data.type !== "lre.error")) return;
    this.pending.delete(data.reqId);
    clearTimeout(waiting.timer);
    if (data.type === "lre.result") waiting.resolve(data.body);
    else waiting.reject(new LreError(typeof data.code === "string" ? (data.code as ErrorCode) : "internal", typeof data.message === "string" ? data.message : "LumiRPEngine refused the request", Array.isArray(data.lint) ? (data.lint as LintIssue[]) : []));
  }

  private send<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<unknown> {
    const socket = this.socket;
    const opened = this.opened;
    if (socket === null || opened === null) return Promise.reject(new LiveError("closed", "The connection to Lumiverse closed. Try again."));
    const reqId = `${this.prefix}${++this.seq}`;
    // `type` first: the host reads it from a large frame's first bytes to allow it 4 MiB instead of 1.
    const frame = JSON.stringify({ type: "SPINDLE_BACKEND_MSG", extensionId: opened.extension.id, payload: { lre: PROTOCOL_VERSION, type, reqId, ...fields } });
    // A UTF-16 unit is at most 3 UTF-8 bytes, so only a long frame needs measuring.
    const bytes = frame.length * 3 > FRAME_LIMIT ? new TextEncoder().encode(frame).length : 0;
    if (bytes > FRAME_LIMIT) return Promise.reject(new LiveError("too_large", `That ${type} request is ${(bytes / 1048576).toFixed(1)} MiB, and Lumiverse drops anything over 4 MiB without a word. Send less at once.`));
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const limit = this.timeoutMs;
    const timer =
      limit === null
        ? undefined
        : setTimeout(() => {
            this.pending.delete(reqId);
            reject(new LiveError("timeout", `LumiRPEngine didn't answer ${type} within ${formatMs(limit)}. A change may still have been made: check before repeating it. ${RAISE}`));
          }, limit);
    this.pending.set(reqId, { resolve, reject, timer });
    socket.send(frame);
    return promise;
  }

  /** The socket is gone: whatever waited on it fails, and the next request opens a new one. */
  private closed(code: number, reason: string): void {
    clearInterval(this.ping ?? undefined);
    this.ping = null;
    this.opened = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) {
      clearTimeout(w.timer);
      w.reject(new LiveError("closed", `The connection to Lumiverse closed (${code}${reason ? ` ${reason}` : ""}) before LumiRPEngine answered. A change may or may not have been made: check before repeating it.`));
    }
  }
}
