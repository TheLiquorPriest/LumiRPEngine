// The way into LumiRPEngine on a Lumiverse host from outside it (DESIGN §23), with no change to
// Lumiverse. The saved session token is a bearer: find the extension (`GET /api/v1/spindle`), take
// a single-use ticket, open the event socket as a widget session (so it never takes the
// frontend-execution slot from the user's browser), wait for CONNECTED, then send LRE envelopes as
// SPINDLE_BACKEND_MSG frames and match each answer to its request by reqId. The host never
// acknowledges a frame, so every request has a timeout. HTTP and the socket are passed in: the
// tests run all of this against a fake host.

import { isRecord } from "../shared/json";
import type { ErrorCode, FrontendToBackend, LintIssue, ResultBodies } from "../shared/protocol";
import { AGENT_API, PROTOCOL_VERSION } from "../shared/protocol";
import { ENGINE_EXTENSION } from "../shared/studio-bridge";

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

export type LiveProblem = "login" | "locked" | "unreachable" | "forbidden" | "not_installed" | "not_running" | "too_old" | "timeout" | "closed" | "too_large" | "protocol";

/** Why a call to the host failed, in words the user can act on. */
export class LiveError extends Error {
  constructor(
    readonly problem: LiveProblem,
    message: string,
  ) {
    super(message);
    this.name = "LiveError";
  }
}

/** LumiRPEngine refused a request (`lre.error`): its code, its words, and the lint behind a refused commit. */
export class LreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly lint: LintIssue[],
  ) {
    super(message);
    this.name = "LreError";
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
  valid: boolean;
  /** Until when the session holds unused (each use extends it); null when the host didn't say. */
  expiresAt: string | null;
}

/** The host as `lre_status` reports it. */
export interface HostDescription {
  base: string;
  username: string;
  session: SessionState;
  extension: ExtensionInfo | null;
  /** The agent API level LumiRPEngine answered `lre.hello` with; null when it named none or wasn't reached. */
  agentApi: number | null;
  /** What stopped the description short, if anything. */
  problem: string | null;
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
const TIMEOUT_MS = 60_000;
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
  if (reply.status >= 300 && reply.status < 400) throw new LiveError("unreachable", `Lumiverse at ${base} answered with a redirect to ${reply.header("location") ?? "another address"}. Use the address it redirects to (lumirpengine login --url <that address>).`);
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
  if (reply.status === 401) throw new LiveError("login", `Lumiverse refused that username or password${said(reply.text)}. Careful: after 5 failed sign-ins Lumiverse locks your address out for a while.`);
  if (reply.status === 429) {
    const minutes = Math.ceil(Number(reply.header("retry-after")) / 60);
    const wait = Number.isFinite(minutes) && minutes > 0 ? ` for about ${minutes} minute${minutes === 1 ? "" : "s"}` : " for a while";
    throw new LiveError("locked", `Lumiverse is refusing sign-ins from this address${wait}: too many attempts. Wait, then sign in once more.`);
  }
  if (reply.status === 403) throw new LiveError("forbidden", forbidden(base));
  if (reply.status === 404) throw new LiveError("unreachable", `There is no Lumiverse sign-in at ${base} (404). Check the URL: it's the address you open Lumiverse at.`);
  throw new LiveError("protocol", `Lumiverse answered the sign-in with ${reply.status}${said(reply.text)}.`);
}

/** Ends the session on the host; whether the host had it. */
export async function signOut(http: Http, base: string, token: string): Promise<boolean> {
  const reply = await exchange(http, base, "POST", "/api/auth/sign-out", token, "{}");
  return reply.status >= 200 && reply.status < 300;
}

/** Whether the session is still good, and until when it holds unused. */
export async function sessionOf(http: Http, base: string, token: string): Promise<SessionState> {
  const reply = await exchange(http, base, "GET", "/api/auth/get-session", token);
  if (reply.status === 403) throw new LiveError("forbidden", forbidden(base));
  if (reply.status < 200 || reply.status >= 300) return { valid: false, expiresAt: null };
  const body = parse(reply.text);
  const session = isRecord(body) && isRecord(body.session) ? body.session : null;
  if (session === null) return { valid: false, expiresAt: null };
  return { valid: true, expiresAt: typeof session.expiresAt === "string" ? session.expiresAt : null };
}

interface Pending {
  resolve(body: unknown): void;
  reject(error: Error): void;
  timer: Timer;
}

interface Opened {
  extension: ExtensionInfo;
  agentApi: number | null;
}

export interface ConnectionOptions {
  base: string;
  username: string;
  token: string;
  http: Http;
  openSocket: OpenSocket;
  /** Named in `lre.hello`: LumiRPEngine labels this client's commits `agent`. */
  client: { name: string; version: string };
  timeoutMs?: number;
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
  /** Settles the open in progress when CONNECTED (or AUTH_ERROR) arrives. */
  private greeting: { resolve(): void; reject(error: Error): void } | null = null;
  private readonly timeoutMs: number;
  private readonly pingMs: number;

  constructor(private readonly options: ConnectionOptions) {
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.pingMs = options.pingMs ?? PING_MS;
  }

  async request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]> {
    const opened = await this.ensure();
    if (opened.agentApi === null || opened.agentApi < AGENT_API) throw new LiveError("too_old", this.tooOld(opened.agentApi));
    return (await this.send(type, fields)) as ResultBodies[T];
  }

  async describe(): Promise<HostDescription> {
    const { base, username, token, http } = this.options;
    const out: HostDescription = { base, username, session: { valid: false, expiresAt: null }, extension: null, agentApi: null, problem: null };
    try {
      out.session = await sessionOf(http, base, token);
      if (!out.session.valid) {
        out.problem = loginAgain(base);
        return out;
      }
      const opened = await this.ensure();
      out.extension = opened.extension;
      out.agentApi = opened.agentApi;
      if (opened.agentApi === null || opened.agentApi < AGENT_API) out.problem = this.tooOld(opened.agentApi);
    } catch (error) {
      out.problem = error instanceof Error ? error.message : String(error);
      out.extension = this.lastExtension;
    }
    return out;
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.closed(1000, "closed by the client");
  }

  private tooOld(agentApi: number | null): string {
    const speaks = agentApi === null ? "doesn't speak the agent API" : `speaks agent API ${agentApi}`;
    return `LumiRPEngine on ${this.options.base} is too old for lumirpengine ${this.options.client.version}: it ${speaks}, and this client needs ${AGENT_API}. Update LumiRPEngine on your Lumiverse (Extensions → LumiRPEngine → Update), then try again.`;
  }

  private ensure(): Promise<Opened> {
    if (this.opened !== null && this.socket !== null) return Promise.resolve(this.opened);
    this.opening ??= this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async findExtension(): Promise<ExtensionInfo> {
    const { base, token, http } = this.options;
    this.lastExtension = null;
    const reply = await exchange(http, base, "GET", "/api/v1/spindle", token);
    if (reply.status === 401) throw new LiveError("login", loginAgain(base));
    if (reply.status === 403) throw new LiveError("forbidden", forbidden(base));
    if (reply.status !== 200) throw new LiveError("protocol", `Lumiverse at ${base} answered ${reply.status} when asked for its extensions${said(reply.text)}.`);
    const body = parse(reply.text);
    const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e): e is Record<string, unknown> => isRecord(e) && e.identifier === ENGINE_EXTENSION) : undefined;
    if (!found || typeof found.id !== "string") throw new LiveError("not_installed", `LumiRPEngine isn't installed on ${base}, or your account can't use it. Install it in Lumiverse's Extensions tab from https://github.com/TheLiquorPriest/LumiRPEngine.`);
    const extension: ExtensionInfo = { id: found.id, version: typeof found.version === "string" ? found.version : null, enabled: found.enabled === true, status: typeof found.status === "string" ? found.status : "unknown" };
    this.lastExtension = extension;
    if (extension.status !== "running") throw new LiveError("not_running", `LumiRPEngine is installed on ${base} but not running (${extension.enabled ? extension.status : "disabled"}). Enable it in Lumiverse's Extensions tab.`);
    return extension;
  }

  private async ticket(): Promise<string> {
    const { base, token, http } = this.options;
    const reply = await exchange(http, base, "POST", "/api/v1/ws-ticket", token, "{}");
    if (reply.status === 401) throw new LiveError("login", loginAgain(base));
    const body = parse(reply.text);
    if (reply.status !== 200 || !isRecord(body) || typeof body.ticket !== "string") throw new LiveError("protocol", `Lumiverse at ${base} gave no socket ticket (${reply.status}${said(reply.text)}).`);
    return body.ticket;
  }

  private async open(): Promise<Opened> {
    const extension = await this.findExtension();
    // A ticket lives 30 s and works once; one refused on the way gets one more try with a new ticket.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.connect(await this.ticket());
        break;
      } catch (error) {
        if (!(error instanceof LiveError && error.problem === "protocol" && attempt === 1)) throw error;
      }
    }
    // `opened` gates `request`, so the hello goes through `send` directly.
    this.opened = { extension, agentApi: null };
    try {
      const hello = await this.send("lre.hello", { chatId: null, client: this.options.client });
      const agentApi = isRecord(hello) ? hello.agentApi : undefined;
      this.opened = { extension, agentApi: typeof agentApi === "number" ? agentApi : null };
    } catch (error) {
      this.close();
      if (error instanceof LiveError && error.problem === "timeout") throw new LiveError("timeout", `LumiRPEngine on ${this.options.base} didn't answer within ${Math.round(this.timeoutMs / 1000)} s. Check that it's running (lumirpengine status), and restart it in Lumiverse's Extensions tab if it is.`);
      throw error;
    }
    return this.opened;
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
    const timer = setTimeout(() => settle(new LiveError("timeout", `Lumiverse at ${this.options.base} opened no event socket within ${Math.round(this.timeoutMs / 1000)} s. Behind a proxy, the proxy must pass WebSocket upgrades on /api/ws.`)), this.timeoutMs);
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
    // Pushes (state, jobs, draft changes) carry no reqId of ours: nothing here waits for them.
    if (!isRecord(data) || data.lre !== PROTOCOL_VERSION || typeof data.reqId !== "string") return;
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
    const timer = setTimeout(() => {
      this.pending.delete(reqId);
      reject(new LiveError("timeout", `LumiRPEngine didn't answer ${type} within ${Math.round(this.timeoutMs / 1000)} s. A change may still have been made: check before repeating it.`));
    }, this.timeoutMs);
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
