// RPE's server (plan §4.4, §16): Bun's own server and router over the one route table. Before a
// route's code runs, every request is held to four things: it is addressed to RPE by a name RPE
// answers to (the Host check, which a page on a rebound DNS name fails); a page's Origin is one that
// may call RPE; it carries what its route's access asks for; and its body is within the route's
// limit. A page from an allowed origin gets the CORS answers it needs to call RPE directly, the
// Lumiverse page among them.

import type { BunRequest, Server } from "bun";
import type { Log } from "rp-harness/contract";
import type { Auth } from "./auth";
import { AuthRefused, bearerOf, NO_OWNER } from "./auth";
import type { AppConfig } from "./config";
import type { LiveHub, LiveSocketData } from "./live";
import { liveSockets, TOKEN_PROTOCOL_PREFIX } from "./live";
import type { Method, Placed, RouteTable } from "./routes";
import { RouteError } from "./routes";

export interface ServerParts {
  config: AppConfig;
  routes: RouteTable;
  auth: Auth;
  live: LiveHub;
  log: Log;
}

export interface RunningServer {
  readonly port: number;
  /** Where RPE answers: `http://<address>:<port>`. */
  readonly url: string;
  /** Stops listening and closes every connection and socket. */
  stop(): Promise<void>;
}

const LOOPBACK: Readonly<Record<string, true>> = { localhost: true, "127.0.0.1": true, "[::1]": true };
const WILDCARD: Readonly<Record<string, true>> = { "0.0.0.0": true, "[::]": true };
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A host as `name` (IPv6 in brackets, lower case) and its port (null when not given). */
function splitHost(host: string): { name: string; port: number | null } {
  const lower = host.trim().toLowerCase();
  const close = lower.startsWith("[") ? lower.indexOf("]") : -1;
  const colon = lower.indexOf(":", close + 1);
  // An IPv6 address written without brackets is a bare address, never a name with a port.
  if (colon === -1 || (close === -1 && lower.indexOf(":") !== lower.lastIndexOf(":"))) return { name: close === -1 && lower.includes(":") ? `[${lower}]` : lower, port: null };
  const port = Number(lower.slice(colon + 1));
  return { name: lower.slice(0, colon), port: Number.isInteger(port) ? port : -1 };
}

/** Whether RPE answers to `name` on `port`: its own address, a loopback name, a name the config lists, and any IP address when it listens on all of them. */
function answersTo(config: AppConfig, listening: number, name: string, port: number): boolean {
  for (const entry of config.hosts) {
    const listed = splitHost(entry);
    if (listed.name === name && (listed.port === null || listed.port === port)) return true;
  }
  if (port !== listening) return false;
  if (Object.hasOwn(LOOPBACK, name) || /^127(\.\d{1,3}){3}$/.test(name)) return true;
  const own = splitHost(config.address).name;
  // Every IP address of the machine is its own when it listens on all of them; a rebinding page's Host is a name, never an address.
  if (Object.hasOwn(WILDCARD, own)) return IPV4.test(name) || name.startsWith("[");
  return name === own;
}

function hostAllowed(config: AppConfig, listening: number, host: string | null): boolean {
  if (host === null || host.trim() === "") return false;
  const { name, port } = splitHost(host);
  return answersTo(config, listening, name, port ?? 80);
}

/** Whether a page from `origin` may call RPE: one the config lists, Lumiverse's, or one of RPE's own addresses. */
function originAllowed(config: AppConfig, listening: number, origin: string): boolean {
  if (config.origins.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (config.lumiverse.url !== null && new URL(config.lumiverse.url).origin === url.origin) return true;
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return answersTo(config, listening, url.hostname.toLowerCase(), port);
}

const OPENAI_TYPES: Readonly<Record<number, string>> = { 400: "invalid_request_error", 401: "authentication_error", 403: "permission_error", 404: "not_found_error", 405: "invalid_request_error", 413: "invalid_request_error", 421: "invalid_request_error" };

/** A refusal in the shape its caller reads: OpenAI's on the provider endpoint, `{error}` elsewhere. */
function refusal(path: string, status: number, message: string, headers?: Record<string, string>): Response {
  const body = path.startsWith("/v1/") ? { error: { message, type: OPENAI_TYPES[status] ?? "server_error" } } : { error: message };
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** The response with the CORS headers a page from `origin` needs to read it. */
function withCors(response: Response, origin: string | null): Response {
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** A size as a person reads it: bytes, KiB or MiB. */
function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / 1048576).toFixed(1)} MiB`;
}

/** The request's body, counted as it arrives so that one sent without a length stops at the limit. */
async function readBody(request: Request, limit: number): Promise<{ bytes: Uint8Array<ArrayBuffer> } | { tooLarge: number }> {
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) return { tooLarge: declared };
  if (request.body === null) return { bytes: new Uint8Array(0) };
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      void reader.cancel().catch(() => undefined);
      return { tooLarge: total };
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return { bytes };
}

/** The credential a request carries: its bearer, or, for a page's socket, the token it gave as a protocol. */
function credentialOf(request: Request): string | null {
  const bearer = bearerOf(request);
  if (bearer !== null) return bearer;
  for (const offered of (request.headers.get("sec-websocket-protocol") ?? "").split(",")) {
    const protocol = offered.trim();
    if (protocol.startsWith(TOKEN_PROTOCOL_PREFIX)) return protocol.slice(TOKEN_PROTOCOL_PREFIX.length);
  }
  return null;
}

const ACCESS_WORDS: Readonly<Record<"page" | "provider" | "extension", string>> = {
  page: "This needs a page token or the web UI's token.",
  provider: "This is RPE's provider endpoint, and the connection's API key is not RPE's provider key. Make one with `rpe key` on the server and put it in the connection.",
  extension: "This needs the extension's registration with this RPE.",
};

export function startServer(parts: ServerParts): RunningServer {
  const { config, auth, log } = parts;
  const table = parts.routes.fix();
  let listening = config.port;
  const limits = [config.server.bodyBytes, config.server.providerBodyBytes, ...[...table.values()].flatMap((byMethod) => [...byMethod.values()].map((p) => p.route.maxBody ?? 0))];

  const answer = async (request: Request, server: Server<LiveSocketData>, byMethod: Map<Method, Placed> | null, params: Record<string, string>): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!hostAllowed(config, listening, request.headers.get("host"))) return refusal(path, 421, `This is RPE, and it answers only requests addressed to it by its own names. If you reach it by ${request.headers.get("host") ?? "another name"} on purpose, add that name to "hosts" in its config.`);
    const origin = request.headers.get("origin");
    if (origin !== null && !originAllowed(config, listening, origin)) return refusal(path, 403, `Pages from ${origin} may not call RPE. If that address is yours, add it to "origins" in RPE's config.`);
    const methods = byMethod === null ? [] : [...byMethod.keys()];
    if (request.method === "OPTIONS") {
      if (byMethod === null) return withCors(refusal(path, 404, `RPE has nothing at ${path}.`), origin);
      const headers = new Headers({ allow: [...methods, "OPTIONS"].join(", ") });
      if (origin !== null) {
        headers.set("access-control-allow-methods", methods.join(", "));
        headers.set("access-control-allow-headers", "authorization, content-type");
        headers.set("access-control-max-age", String(config.server.preflightSeconds));
        // A public page calling a loopback address asks this first (Private Network Access).
        if (request.headers.get("access-control-request-private-network") === "true") headers.set("access-control-allow-private-network", "true");
      }
      return withCors(new Response(null, { status: 204, headers }), origin);
    }
    if (byMethod === null) {
      if (path === "/ui" && table.has("/ui/*")) return Response.redirect(`${url.origin}/ui/`, 308);
      return withCors(refusal(path, 404, `RPE has no ${request.method} ${path}.`), origin);
    }
    const placed = byMethod.get((request.method === "HEAD" ? "GET" : request.method) as Method);
    if (placed === undefined) return withCors(refusal(path, 405, `${path} takes ${methods.join(", ")}.`, { allow: methods.join(", ") }), origin);
    const route = placed.route;
    let user: string | null = auth.owner;
    if (route.access === "page") {
      if (auth.owner === null) return withCors(refusal(path, 503, NO_OWNER), origin);
      user = auth.pageUser(credentialOf(request));
      if (user === null) return withCors(refusal(path, 401, ACCESS_WORDS.page), origin);
    } else if (route.access !== "public" && !auth.holds(route.access, credentialOf(request))) {
      return withCors(refusal(path, 401, ACCESS_WORDS[route.access as "provider" | "extension"]), origin);
    }
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
      const limit = route.maxBody ?? (route.access === "provider" ? config.server.providerBodyBytes : config.server.bodyBytes);
      const read = await readBody(request, limit);
      if ("tooLarge" in read) return withCors(refusal(path, 413, `This request's body is ${sizeWords(read.tooLarge)}, and ${request.method} ${route.path} takes at most ${sizeWords(limit)}.`), origin);
      bytes = read.bytes;
    }
    try {
      if ("raw" in route) {
        const given = bytes === null ? request : new Request(request.url, { method: request.method, headers: request.headers, body: bytes, signal: request.signal });
        const openLiveSocket = (headers?: Record<string, string>): boolean => server.upgrade(request, { data: { follows: new Map() }, ...(headers === undefined ? {} : { headers }) });
        const response = await route.raw(given, { params, user, openLiveSocket });
        return response === undefined ? undefined : withCors(response, origin);
      }
      let body: unknown;
      if (route.body !== undefined) {
        if (bytes === null || bytes.length === 0) return withCors(refusal(path, 400, `${request.method} ${route.path} takes a JSON body.`), origin);
        let value: unknown;
        try {
          value = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return withCors(refusal(path, 400, "The request's body is not JSON."), origin);
        }
        body = route.body(value);
      }
      const reply: unknown = await route.handle({ params, query: url.searchParams, body, user, request, signal: request.signal });
      if (reply instanceof Response) return withCors(reply, origin);
      const response = reply === undefined ? new Response(null, { status: 204 }) : Response.json(reply, { headers: { "cache-control": "no-store" } });
      return withCors(response, origin);
    } catch (error) {
      if (error instanceof RouteError || error instanceof AuthRefused) return withCors(refusal(path, error.status, error.message), origin);
      log.error(`${request.method} ${route.path} failed`, { area: placed.area, error: error instanceof Error ? error.message : String(error) });
      return withCors(refusal(path, 500, "RPE could not answer this request; its log says why."), origin);
    }
  };

  const routes: Record<string, (request: BunRequest, server: Server<LiveSocketData>) => Promise<Response | undefined>> = {};
  for (const [pattern, byMethod] of table) routes[pattern] = (request, server) => answer(request, server, byMethod, request.params);
  const server = Bun.serve<LiveSocketData>({
    hostname: config.address,
    port: config.port,
    // A turn can stay silent for minutes (plan §10.7 keeps it alive inside ten), longer than Bun's longest idle limit.
    idleTimeout: 0,
    // Above every route's own limit, so that each route refuses in its own words first.
    maxRequestBodySize: Math.max(...limits) + 1024 * 1024,
    routes,
    fetch: (request, server) => answer(request, server, null, {}),
    websocket: liveSockets(parts.live, config.live.messageBytes),
    error(error) {
      log.error("a request failed before its route answered", { error: error.message });
      return Response.json({ error: "RPE could not answer this request; its log says why." }, { status: 500 });
    },
  });
  listening = server.port ?? config.port;
  const shown = Object.hasOwn(WILDCARD, splitHost(config.address).name) ? "127.0.0.1" : config.address.includes(":") ? `[${config.address}]` : config.address;
  return {
    port: listening,
    url: `http://${shown}:${listening}`,
    stop: () => server.stop(true),
  };
}
