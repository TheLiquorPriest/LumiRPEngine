// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/runtime/lumiverse.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// Lumiverse's HTTP routes as the runtime uses them, with no change to Lumiverse: sign-in and the
// session, the user's connections (the loopback connection `up` adds), the local-inference
// scheduler's exclusions, and the setting that sends Edit and Send on the active connection. The
// saved session token is a bearer. HTTP is passed in, so the tests run all of this against a fake.

import { isRecord } from "../link/json";
import type { SchedulerState } from "../link/contract";
import { loopsBack } from "../link/contract";
import { spanWords, transportWait } from "../link/waits";
import type { SettingsOwner } from "../shared/timeouts";

export interface HttpRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** Ends the request when it aborts: the runtime's deadline for Lumiverse's answer (its Lumiverse wait). */
  signal?: AbortSignal;
}

export interface HttpReply {
  status: number;
  header(name: string): string | null;
  text: string;
}

/** One HTTP exchange; main.ts supplies Bun's fetch. */
export type Http = (request: HttpRequest) => Promise<HttpReply>;

/**
 * The runtime's HTTP to Lumiverse with a deadline on each request (`waitMs`, read as each starts:
 * the runtime's Lumiverse wait): past it the request is ended and rejects in words that name the
 * setting and where it is (`owner`: the extension the runtime links to, as it last said, read when
 * the words are made), whether or not the HTTP beneath heeds the signal.
 */
export function timedHttp(http: Http, waitMs: () => number, owner: () => SettingsOwner): Http {
  return async (request) => {
    const ms = waitMs();
    const stop = new AbortController();
    const { promise: late, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(() => {
      const error = new Error(`Lumiverse didn't answer within ${spanWords(ms)}. ${transportWait(["runtime", "lumiverseMs"], owner())} says how long the runtime waits for it.`);
      stop.abort(error);
      reject(error);
    }, ms);
    try {
      return await Promise.race([http({ ...request, signal: request.signal !== undefined ? AbortSignal.any([request.signal, stop.signal]) : stop.signal }), late]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export type LiveProblem = "login" | "locked" | "unreachable" | "forbidden" | "insecure" | "not_installed" | "not_running" | "too_old" | "timeout" | "closed" | "too_large" | "protocol";

/** Why a call to Lumiverse failed, in words the user can act on. */
export class LiveError extends Error {
  constructor(
    readonly problem: LiveProblem,
    message: string,
  ) {
    super(message);
    this.name = "LiveError";
  }
}

/** A wait of the runtime's that ran out, in words that name its setting and where it is changed (`transportWait`): wherever it is told, it is told in its own words. */
export class WaitError extends LiveError {
  constructor(message: string) {
    super("timeout", message);
    this.name = "WaitError";
  }
}

/** The sign-in a runtime keeps in its config: one Better Auth session token, with the username it signed in as. The password is never kept. */
export interface StoredLogin {
  username: string;
  token: string;
  /** When it was saved, in ms since the epoch. */
  savedAt: number;
  /** The user agreed, at `up --allow-http`, to send the token over plain http to another machine. */
  allowHttp?: true;
}

export interface SessionState {
  /** Whether the session holds; null when Lumiverse couldn't be asked (a lockout, an outage, a refusal). */
  valid: boolean | null;
  /** Until when the session holds unused (each use extends it); null when Lumiverse didn't say. */
  expiresAt: string | null;
}

/**
 * A Lumiverse base URL as the runtime keeps it: scheme, host and port (the default port dropped),
 * and a path prefix when Lumiverse is served under one, without a trailing slash.
 */
export function normalizeBase(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`"${input}" isn't a URL: give Lumiverse's address as you open it in a browser, such as http://localhost:7860`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`"${input}" isn't an http or https URL: give Lumiverse's address as you open it in a browser, such as http://localhost:7860`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Whether a base URL is plain http to another machine, where the password and then the session
 * token would cross the network in clear. The machine's own loopback addresses never leave it.
 */
export function inClear(base: string): boolean {
  const url = new URL(base);
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return !(host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]");
}

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

export const loginAgain = (base: string): string => `The runtime's Lumiverse session for ${base} is no longer valid (it expired, or was signed out). Sign it in again: lumiah login`;

const forbidden = (base: string): string =>
  `Lumiverse at ${base} refused this client (403 Forbidden): the address isn't one of its trusted hosts. Use the URL you open Lumiverse at in your browser, or add the host to Lumiverse's trusted hosts (Operator panel) or TRUSTED_ORIGINS.`;

/** How long a 429 asks to wait, in words. */
function waitOf(reply: HttpReply): string {
  const minutes = Math.ceil(Number(reply.header("retry-after")) / 60);
  return Number.isFinite(minutes) && minutes > 0 ? `for about ${minutes} minute${minutes === 1 ? "" : "s"}` : "for a while";
}

/** What a refusal means, for the replies a caller doesn't read itself; `asked` says what was asked ("asked for its extensions"). */
export function refused(base: string, reply: HttpReply, asked: string): LiveError {
  if (reply.status === 401) return new LiveError("login", loginAgain(base));
  if (reply.status === 403) return new LiveError("forbidden", forbidden(base));
  // A lockout blocks every /api request from the address, the user's own browser on this machine included.
  if (reply.status === 429) return new LiveError("locked", `Lumiverse is refusing every request from this address ${waitOf(reply)}${said(reply.text)}: it locks an address out after repeated failed sign-ins. Wait it out; signing in again before then only makes the next lockout longer.`);
  if (reply.status === 404) return new LiveError("unreachable", `There is no Lumiverse at ${base} (404 when it ${asked}). Check the URL: it's the address you open Lumiverse at.`);
  return new LiveError("unreachable", `Lumiverse at ${base} answered ${reply.status} when it ${asked}${said(reply.text)}. Behind a proxy, that can mean Lumiverse itself is down.`);
}

/** One request to Lumiverse, never with an Origin or a Cookie (a bearer request without them passes Lumiverse's origin checks), and never following a redirect, which would drop the bearer. */
export async function exchange(http: Http, base: string, method: "GET" | "POST" | "PUT", path: string, token: string | null, body?: string): Promise<HttpReply> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  let reply: HttpReply;
  try {
    reply = await http({ method, url: `${base}${path}`, headers, ...(body !== undefined ? { body } : {}) });
  } catch (error) {
    throw new LiveError("unreachable", `Can't reach Lumiverse at ${base}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (reply.status >= 300 && reply.status < 400) {
    let target: URL | null = null;
    try {
      target = new URL(reply.header("location") ?? "", `${base}${path}`);
    } catch {
      // A Location that isn't a URL: the message names no address.
    }
    // The address to use instead: the target, without the route that was asked for.
    const instead = target === null ? "<that address>" : target.pathname.endsWith(path) ? `${target.origin}${target.pathname.slice(0, -path.length)}` : target.href;
    if (target !== null && target.protocol === "https:" && base.startsWith("http:")) throw new LiveError("insecure", `Lumiverse at ${base} answers on https: use --url ${instead}, so the password and the session token never cross the network in clear.`);
    throw new LiveError("unreachable", `Lumiverse at ${base} answered with a redirect to ${target?.href ?? "another address"}. Use the address it redirects to (--url ${instead}).`);
  }
  return reply;
}

/** Signs in with a username and password; resolves with the session token. */
export async function signIn(http: Http, base: string, username: string, password: string): Promise<string> {
  const reply = await exchange(http, base, "POST", "/api/auth/sign-in/username", null, JSON.stringify({ username, password }));
  if (reply.status >= 200 && reply.status < 300) {
    const body = parse(reply.text);
    const token = isRecord(body) && typeof body.token === "string" && body.token !== "" ? body.token : reply.header("set-auth-token");
    if (token === null || token === "") throw new LiveError("protocol", `Lumiverse at ${base} signed you in but sent back no session token, so the runtime can't use the session. Is it Lumiverse's staging branch?`);
    return token;
  }
  if (reply.status === 401) throw new LiveError("login", `Lumiverse refused that username or password${said(reply.text)}. Careful: after 5 failed sign-ins Lumiverse locks your address out, your browser on this machine included, and each lockout lasts longer than the last.`);
  if (reply.status === 429) throw new LiveError("locked", `Lumiverse is refusing sign-ins from this address ${waitOf(reply)}${said(reply.text)}. It allows few sign-ins in a short time, and after 5 failed ones it locks the whole address out (your browser on this machine included) for longer each time. Wait, then sign in once.`);
  if (reply.status === 403) throw new LiveError("forbidden", forbidden(base));
  if (reply.status === 404) throw new LiveError("unreachable", `There is no Lumiverse sign-in at ${base} (404). Check the URL: it's the address you open Lumiverse at.`);
  throw new LiveError("protocol", `Lumiverse answered the sign-in with ${reply.status}${said(reply.text)}.`);
}

/**
 * Whether a session holds, and until when it holds unused: a 401, or an answer with no session,
 * means it doesn't. Any other answer (a lockout, a refusal, an outage) says nothing about the
 * session, so it throws. With no token, it asks as nobody: a sign-in does that first, before a
 * password is sent, so a redirect or a lockout stops it there.
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

/** A connection profile the user has (`GET /api/v1/connections`), as much of it as tells the loopback's. */
export interface ConnectionProfileSummary {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  model: string;
}

function profileOf(raw: unknown): ConnectionProfileSummary | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.provider !== "string") return null;
  return { id: raw.id, name: typeof raw.name === "string" ? raw.name : "", provider: raw.provider, apiUrl: typeof raw.api_url === "string" ? raw.api_url : "", model: typeof raw.model === "string" ? raw.model : "" };
}

/** The user's connection profiles as they see them in Connections; `limit` is how many Lumiverse is asked for at once. */
export async function connectionProfiles(http: Http, base: string, token: string, limit: number): Promise<ConnectionProfileSummary[]> {
  const reply = await exchange(http, base, "GET", `/api/v1/connections?limit=${limit}`, token);
  if (reply.status !== 200) throw refused(base, reply, "was asked for your connections");
  const body = parse(reply.text);
  const rows = isRecord(body) && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
  return rows.map(profileOf).filter((p): p is ConnectionProfileSummary => p !== null);
}

/**
 * Adds a connection profile as the user would in Connections (`POST /api/v1/connections`): Spindle
 * lets an extension read connections but not add one, so the runtime adds it with the user's own
 * session. A key, where given, goes to Lumiverse's secrets and never comes back.
 */
export async function addConnectionProfile(http: Http, base: string, token: string, profile: { name: string; provider: string; apiUrl: string; model: string; apiKey?: string }): Promise<ConnectionProfileSummary> {
  const reply = await exchange(http, base, "POST", "/api/v1/connections", token, JSON.stringify({ name: profile.name, provider: profile.provider, api_url: profile.apiUrl, model: profile.model, ...(profile.apiKey !== undefined ? { api_key: profile.apiKey } : {}) }));
  if (reply.status !== 200 && reply.status !== 201) throw refused(base, reply, "was asked to add the connection");
  const made = profileOf(parse(reply.text));
  if (made === null) throw new LiveError("protocol", `Lumiverse at ${base} added the connection but didn't say what it made.`);
  return made;
}

/** Puts a new API key in a connection the user has (`PUT /api/v1/connections/:id/api-key`): the loopback key, when the user mints or rotates it. */
export async function setConnectionKey(http: Http, base: string, token: string, connectionId: string, apiKey: string): Promise<void> {
  const reply = await exchange(http, base, "PUT", `/api/v1/connections/${encodeURIComponent(connectionId)}/api-key`, token, JSON.stringify({ api_key: apiKey }));
  if (reply.status !== 200) throw refused(base, reply, "was asked to set the connection's key");
}

/**
 * Stops a generation as Lumiverse's own Stop button does (`POST /api/v1/generate/stop`): Lumiverse
 * closes its request to the provider, keeps what was written and shows the reply as stopped, not as
 * failed. Spindle gives an extension no call for it, so the runtime asks with the user's own
 * session. The chat goes with it as the button sends it: Lumiverse stops by it when it has given the
 * reply another generation id since. False when Lumiverse had nothing of the kind running.
 */
export async function stopGeneration(http: Http, base: string, token: string, generationId: string, chatId: string): Promise<boolean> {
  const reply = await exchange(http, base, "POST", "/api/v1/generate/stop", token, JSON.stringify({ generation_id: generationId, chat_id: chatId }));
  if (reply.status !== 200) throw refused(base, reply, "was asked to stop the reply");
  const body = parse(reply.text);
  return isRecord(body) && body.stopped === true;
}

/**
 * The user's loopback connection for a runtime at `url` (`http://127.0.0.1:<port>/v1`) of the
 * extension whose loopback model is `model`: the first of their Custom connections that names that
 * model, or sits at the runtime's address and names no other extension's (`loopsBack`, which the
 * extension asks too).
 */
export function loopbackProfile(profiles: readonly ConnectionProfileSummary[], url: string, model: string): ConnectionProfileSummary | null {
  return profiles.find((p) => p.provider === "custom" && loopsBack({ model: p.model, url: p.apiUrl }, model, [url])) ?? null;
}

/**
 * Whether the user has Lumiverse's "always use the active connection" on for Edit and Send
 * (`quickToolbarSettings.editAndSendAlwaysUseActiveConnection`): true or false, or null where
 * Lumiverse wouldn't say. There a message sent with Edit and Send goes on the active connection,
 * not on a chat's pin to the loopback.
 */
export async function editAndSendPrefersActive(http: Http, base: string, token: string): Promise<boolean | null> {
  const reply = await exchange(http, base, "GET", "/api/v1/settings/quickToolbarSettings", token).catch(() => null);
  if (reply === null) return null;
  if (reply.status === 404) return false;
  if (reply.status !== 200) return null;
  const body = parse(reply.text);
  const value = isRecord(body) && isRecord(body.value) ? body.value : null;
  return value !== null && value.editAndSendAlwaysUseActiveConnection === true;
}

/** The origins Lumiverse's scheduler compares (its `normalizeEndpointOrigin`): scheme, lowercase host, port. On a loopback address, both names Lumiverse may be given. */
export function runtimeOrigins(listen: string, port: number): string[] {
  const host = listen.includes(":") && !listen.startsWith("[") ? `[${listen}]` : listen.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  return [`http://${host}:${port}`];
}

/**
 * Puts the runtime's origins in the account's scheduler exclusions (`excludedOrigins`): with the
 * scheduler on, a turn holds the local slot while its own agents' calls wait for it, a deadlock
 * progress lines would keep alive.
 */
export async function excludeOrigins(http: Http, base: string, token: string, origins: readonly string[]): Promise<SchedulerState> {
  const url = `${base}/api/v1/inference-scheduler/config`;
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  const listed = (text: string): string[] => {
    const body = parse(text);
    const config = isRecord(body) && isRecord(body.config) ? body.config : body;
    return isRecord(config) && Array.isArray(config.excludedOrigins) ? config.excludedOrigins.filter((o): o is string => typeof o === "string") : [];
  };
  try {
    const got = await http({ method: "GET", url, headers });
    if (got.status === 404) return "unavailable";
    if (got.status !== 200) return "missing";
    const current = listed(got.text);
    if (origins.every((o) => current.includes(o))) return "excluded";
    const put = await http({ method: "PUT", url, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ excludedOrigins: [...current, ...origins.filter((o) => !current.includes(o))] }) });
    return put.status === 200 && origins.every((o) => listed(put.text).includes(o)) ? "excluded" : "missing";
  } catch {
    return "unknown";
  }
}
