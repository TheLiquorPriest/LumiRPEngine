// RPE's server (plan §4.4, §16): Bun's own server and router over the one route table. Before a
// route's code runs, every request is held to four things: it is addressed to RPE by a name RPE
// answers to (the Host check, which a page on a rebound DNS name fails); a page's Origin is one that
// may call RPE; it carries what its route's access asks for; and its body, whatever its method, is
// within the route's limit. A route in the form is held to its declaration too: a query or a body it
// does not take is refused with 400 before its handler runs, which is given only what was declared,
// read and typed, and the caller's credential only where its route declares it. A page from an allowed
// origin gets the CORS answers it needs to call RPE directly, the Lumiverse page among them.

import type { BunRequest, Server } from "bun";
import { createHmac, randomBytes } from "node:crypto";
import type { Log } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import type { Auth } from "./auth";
import { AuthRefused, bearerOf, NO_OWNER } from "./auth";
import type { AppConfig } from "./config";
import type { LiveHub, LiveSocketData } from "./live";
import { liveSockets, TOKEN_PROTOCOL_PREFIX } from "./live";
import type { AnyShape, DeclaredRoute, JoinedAnswer, Method, PageSizes, Placed, QueryFields, RouteTable } from "./routes";
import { JOINED_STATUS, problemsOf, readQuery, RouteError, shape, shapeWords } from "./routes";

export interface ServerParts {
  config: AppConfig;
  routes: RouteTable;
  auth: Auth;
  live: LiveHub;
  log: Log;
  now: () => number;
}

export interface RunningServer {
  readonly port: number;
  /** Where RPE answers: `http://<address>:<port>`. */
  readonly url: string;
  /** Where RPE answers on this machine's loopback, whatever its address: `http://127.0.0.1:<port>`, its extension's road to it. */
  readonly loopback: string;
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

/** Why a body over its route's limit is refused: both sizes as a person reads them, or in bytes where those would read the same. */
function tooLargeWords(size: number, limit: number, at: string): string {
  const [said, most] = sizeWords(size) === sizeWords(limit) ? [`${size} bytes`, `${limit} bytes`] : [sizeWords(size), sizeWords(limit)];
  return `This request's body is ${said}, and ${at} takes at most ${most}.`;
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

/** What a paged route takes in its query beside what it declares: the size of the page it asks for, and the cursor a page before gave. */
const PAGE_QUERY: QueryFields = { limit: shape.optional(shape.whole({ least: 1 })), cursor: shape.optional(shape.text({ blank: false })) };

/**
 * The two turns a refusal for a joined turn names: the turn asked for and the turn it joined. The store throws it as a
 * `JoinedTurnError` (`src/store/types.ts`), which this server, importing no area, knows by its name and its two fields.
 */
function joinedOf(error: unknown): JoinedAnswer["joined"] | null {
  if (!(error instanceof Error) || error.name !== "JoinedTurnError") return null;
  const { turn, joined } = error as Error & { turn?: unknown; joined?: unknown };
  return typeof turn === "string" && typeof joined === "string" ? { turn, joined } : null;
}

/**
 * A cursor's seal: the route, the list it was given for (the route's params) and the place, signed with a
 * key this server made when it started, so that a cursor it did not give, another route's or another
 * list's, one changed, or one from before it last started, fails.
 */
function sealOf(key: Uint8Array, route: string, params: Readonly<Record<string, string>>, place: string): string {
  const list = JSON.stringify(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHmac("sha256", key).update(`${route}\n${list}\n${place}`).digest("base64url");
}

/** The cursor a page hands back: the place its last item has in the list's own order, sealed to the route and the list. */
function cursorOf(key: Uint8Array, route: string, params: Readonly<Record<string, string>>, place: string): string {
  return `${Buffer.from(place, "utf8").toString("base64url")}.${sealOf(key, route, params, place)}`;
}

/** The place a cursor names, when this route gave it for this list; null for any other, or one changed. */
function placeOf(key: Uint8Array, route: string, params: Readonly<Record<string, string>>, cursor: string): string | null {
  const dot = cursor.lastIndexOf(".");
  if (dot < 0) return null;
  const sent = cursor.slice(0, dot);
  const place = Buffer.from(sent, "base64url").toString("utf8");
  // Read back as it would be written, so a change base64 would read past is a change still.
  if (Buffer.from(place, "utf8").toString("base64url") !== sent) return null;
  return cursor.slice(dot + 1) === sealOf(key, route, params, place) ? place : null;
}

/** The rest of the path a pattern's last `*` stands for: each segment decoded, or as sent where one cannot be. */
function restOf(pattern: string, pathname: string): { decoded: string | null; sent: string } {
  const parts = pathname.split("/").slice(pattern.split("/").length - 1);
  const sent = parts.join("/");
  try {
    return { decoded: parts.map((part) => decodeURIComponent(part)).join("/"), sent };
  } catch {
    return { decoded: null, sent };
  }
}

/** What a route in the form is asked, before its handler is given it. */
interface Asked {
  path: string;
  params: Record<string, string>;
  search: URLSearchParams;
  user: string | null;
  credential: string | null;
  bytes: Uint8Array<ArrayBuffer> | null;
  signal: AbortSignal;
}

/**
 * A route in the form, answered: its query and its body held to its declaration (refused with 400 in RPE's
 * words), then its handler given what they hold; `cursorKey` seals and reads a paged route's cursors.
 */
async function answerDeclared(route: DeclaredRoute<any, any, any, any, any, any, any>, asked: Asked, cursorKey: Uint8Array): Promise<Response> {
  const at = `${route.method} ${route.path}`;
  const fields: QueryFields = route.paged === undefined ? (route.query ?? {}) : { ...route.query, ...PAGE_QUERY };
  const read = readQuery(fields, asked.search, at);
  if (!read.ok) return refusal(asked.path, 400, read.why);
  const { cursor, ...query } = read.value;
  if (route.paged !== undefined) {
    const sizes: PageSizes | undefined = await route.paged.sizes?.({ params: asked.params, user: asked.user });
    if (sizes !== undefined) {
      const limit = query.limit as number | undefined;
      if (limit !== undefined && limit > sizes.most) return refusal(asked.path, 400, `${at} gives at most ${sizes.most} a page, and this asks for ${limit}.`);
      query.limit = limit ?? sizes.default;
    }
    if (typeof cursor === "string") {
      const after = placeOf(cursorKey, at, asked.params, cursor);
      if (after === null) return refusal(asked.path, 400, `This cursor is not one ${at} gave for this list: read the list again from its start, with no cursor.`);
      query.after = after;
    }
  }
  let body: unknown;
  const sent = asked.bytes !== null && asked.bytes.length > 0;
  if (route.body === undefined) {
    if (sent) return refusal(asked.path, 400, `${at} takes no body.`);
  } else {
    const declared: AnyShape = route.body;
    if (asked.bytes === null || !sent) return refusal(asked.path, 400, `${at} takes a JSON body: ${shapeWords(declared)}.`);
    try {
      body = JSON.parse(new TextDecoder().decode(asked.bytes));
    } catch {
      return refusal(asked.path, 400, "The request's body is not JSON.");
    }
    const problems = problemsOf(declared, body, "body");
    if (problems.length > 0) return refusal(asked.path, 400, `${at} does not take this body: ${problems.slice(0, 3).join(" ")}`);
  }
  // The caller's credential reaches only the code of a route that declares it reads it.
  const reply: unknown = await route.handle({ params: asked.params, query, body, user: asked.user, signal: asked.signal, ...(route.credential === true ? { credential: asked.credential } : {}) });
  if ((route.reply as AnyShape).kind === "nothing") return new Response(null, { status: 204 });
  // A page's `next` is the place of its last item; the page is handed it sealed, as its cursor.
  const answered = route.paged !== undefined && isRecord(reply) && typeof reply.next === "string" ? { ...reply, next: cursorOf(cursorKey, at, asked.params, reply.next) } : reply;
  return Response.json(answered, { headers: { "cache-control": "no-store" } });
}

export function startServer(parts: ServerParts): RunningServer {
  const { config, auth, log } = parts;
  const table = parts.routes.fix();
  // Made at each start and kept nowhere: a cursor is good for the server that gave it.
  const cursorKey = randomBytes(32);
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
    // Every request's body is held to its route's limit, whatever its method. Bun hands no route the body of a
    // GET or a HEAD, and no route takes one, so what such a request's headers say of a body refuses it.
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    const limit = route.maxBody ?? (route.access === "provider" ? config.server.providerBodyBytes : config.server.bodyBytes);
    if (request.method === "GET" || request.method === "HEAD") {
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > limit) return withCors(refusal(path, 413, tooLargeWords(declared, limit, `${request.method} ${route.path}`)), origin);
      if (declared !== 0 || request.headers.has("transfer-encoding")) return withCors(refusal(path, 400, `${request.method} ${route.path} takes no body.`), origin);
    } else {
      const read = await readBody(request, limit);
      if ("tooLarge" in read) return withCors(refusal(path, 413, tooLargeWords(read.tooLarge, limit, `${request.method} ${route.path}`)), origin);
      bytes = read.bytes;
    }
    const credential = credentialOf(request);
    const rest = route.path.endsWith("/*") ? restOf(route.path, path) : null;
    try {
      if ("raw" in route) {
        const given = bytes === null ? request : new Request(request.url, { method: request.method, headers: request.headers, body: bytes, signal: request.signal });
        const openLiveSocket = (headers?: Record<string, string>): boolean => server.upgrade(request, { data: { follows: new Map(), credential, ends: undefined, catchUp: undefined }, ...(headers === undefined ? {} : { headers }) });
        const response = await route.raw(given, { params: rest === null ? params : { ...params, "*": rest.decoded ?? rest.sent }, user, openLiveSocket });
        return response === undefined ? undefined : withCors(response, origin);
      }
      if (rest !== null && rest.decoded === null) return withCors(refusal(path, 400, `The path ${path} has a part that is not well encoded.`), origin);
      const asked: Asked = { path, params: rest === null ? params : { ...params, "*": rest.decoded ?? "" }, search: url.searchParams, user, credential, bytes, signal: request.signal };
      return withCors(await answerDeclared(route, asked, cursorKey), origin);
    } catch (error) {
      if (error instanceof RouteError || error instanceof AuthRefused) return withCors(refusal(path, error.status, error.message), origin);
      // A turn joined to another is a fact about the turn: the one answer for it, whichever route and whichever area's code threw it, logging no failure.
      const joined = joinedOf(error);
      if (joined !== null) return withCors(Response.json({ joined } satisfies JoinedAnswer, { status: JOINED_STATUS, headers: { "cache-control": "no-store" } }), origin);
      log.error(`${request.method} ${route.path} failed`, { area: placed.area, error: error instanceof Error ? error.message : String(error) });
      return withCors(refusal(path, 500, "RPE could not answer this request; its log says why."), origin);
    }
  };

  const routes: Record<string, (request: BunRequest, server: Server<LiveSocketData>) => Promise<Response | undefined>> = {};
  for (const [pattern, byMethod] of table) routes[pattern] = (request, server) => answer(request, server, byMethod, request.params);
  const websocket = liveSockets(parts.live, {
    messageBytes: config.live.messageBytes,
    follows: config.live.follows,
    holds: (credential) => {
      const hold = auth.pageHold(credential);
      return hold === null ? false : hold.until;
    },
    now: parts.now,
  });
  const serve = (hostname: string, port: number): Server<LiveSocketData> =>
    Bun.serve<LiveSocketData>({
      hostname,
      port,
      // A turn can stay silent for minutes (plan §10.7 keeps it alive inside ten), longer than Bun's longest idle limit.
      idleTimeout: 0,
      // Above every route's own limit, so that each route refuses in its own words first.
      maxRequestBodySize: Math.max(...limits) + 1024 * 1024,
      routes,
      fetch: (request, server) => answer(request, server, null, {}),
      websocket,
      error(error) {
        log.error("a request failed before its route answered", { error: error.message });
        return Response.json({ error: "RPE could not answer this request; its log says why." }, { status: 500 });
      },
    });
  const server = serve(config.address, config.port);
  listening = server.port ?? config.port;
  // The extension's road to RPE is loopback (plan §4.3), whatever address pages reach RPE by: set to
  // any other, RPE listens on 127.0.0.1 as well, at the same port. A wildcard address takes it in.
  const own = splitHost(config.address).name;
  let beside: Server<LiveSocketData> | null = null;
  if (own !== "127.0.0.1" && !Object.hasOwn(WILDCARD, own)) {
    try {
      beside = serve("127.0.0.1", listening);
    } catch (error) {
      void server.stop(true);
      const taken = isRecord(error) && error.code === "EADDRINUSE";
      throw new Error(`RPE did not start: its extension in Lumiverse reaches it on 127.0.0.1:${listening}, and ${taken ? "another program holds that address" : `RPE could not listen there (${error instanceof Error ? error.message : String(error)})`}; give RPE another port.`);
    }
  }
  const shown = Object.hasOwn(WILDCARD, own) ? "127.0.0.1" : config.address.includes(":") ? `[${config.address}]` : config.address;
  return {
    port: listening,
    url: `http://${shown}:${listening}`,
    loopback: `http://127.0.0.1:${listening}`,
    stop: async () => {
      await Promise.all([server.stop(true), beside?.stop(true)]);
    },
  };
}
