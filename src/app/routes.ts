// The one route table (plan §4.4). Every area adds its routes here and nowhere else: the provider
// endpoint Lumiverse calls (`/v1/`), the API that pages and the extension call (`/api/v1/`), and
// the web UI (`/ui/`). Each route says who may call it, and the server holds every request to that,
// and to its Origin, its Host and its body limit, before the route's own code runs. Routes are fixed
// once the server has started.
//
// A route is typed from its path to its reply: its params come from the path's pattern, its body from
// the reader it gives, its reply from what its handler returns. The UI's client takes its types from
// the routes themselves (`RouteBody`, `RouteReply`, `PathParams`), and `list()` says what the table
// holds, for the API reference.

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Who may call a route:
 * - `public`: anyone who reaches the server (its status, the web UI's files);
 * - `page`: a page of the Lumiverse user this RPE belongs to, with a page token or the web UI's token;
 * - `provider`: Lumiverse on RPE's connection, with the provider key;
 * - `extension`: the light extension, with its registration key.
 *
 * Which a route may say follows from where it is: `/v1/` is the provider's, `/api/v1/ext/` the
 * extension's, the rest of `/api/v1/` is pages' (or public), and `/ui/` is public.
 */
export type Access = "public" | "page" | "provider" | "extension";

type ParamName<S extends string> = S extends `:${infer Name}` ? Name : never;
/** The names of a path pattern's params: `/api/v1/chats/:chat/turns/:turn` has `chat` and `turn`. */
export type ParamNames<P extends string> = P extends `${infer Head}/${infer Tail}` ? ParamName<Head> | ParamNames<Tail> : ParamName<P>;
export type PathParams<P extends string> = { readonly [K in ParamNames<P>]: string };

/** The user a route acts for: on a page route, the user this RPE belongs to; elsewhere that user, or null before one is set. */
export type UserFor<A extends Access> = A extends "page" ? string : string | null;

/** What a route's handler is given. */
export interface RouteCall<P extends string, A extends Access, B> {
  readonly params: PathParams<P>;
  readonly query: URLSearchParams;
  /** The body as the route's reader gave it back; undefined for a route with no reader. */
  readonly body: B;
  readonly user: UserFor<A>;
  readonly request: Request;
  /** Aborts when the caller goes away. */
  readonly signal: AbortSignal;
}

/**
 * A route that answers in JSON. Its handler returns the reply's value (sent with 200), undefined
 * (204), or a `Response` of its own; it throws a `RouteError` to refuse.
 */
export interface JsonRoute<P extends string = string, A extends Access = Access, B = unknown, R = unknown> {
  readonly method: Method;
  readonly path: P;
  readonly access: A;
  /** The largest body it takes, in bytes; the server's setting when absent. */
  readonly maxBody?: number;
  /** Reads the JSON body into what the handler takes, throwing a `RouteError` (400) for one it does not take. Absent: the route reads no body. */
  readonly body?: (value: unknown) => B;
  readonly handle: (call: RouteCall<P, A, B>) => R | Promise<R>;
}

/** What a raw route's handler is given besides the request. */
export interface RawCall<P extends string, A extends Access> {
  readonly params: PathParams<P>;
  readonly user: UserFor<A>;
  /**
   * Turns the request into a live socket, the one kind of socket RPE serves, sending `headers` with
   * the answer; false when the request is not a socket's.
   */
  readonly openLiveSocket: (headers?: Record<string, string>) => boolean;
}

/**
 * A route that takes the request as it came (its body already read and held to its limit) and makes
 * its own response: a handler another area wrote from a request to a response (the provider
 * endpoint, the extension's question), the web UI's files, the live socket. Undefined: the request
 * became a socket.
 */
export interface RawRoute<P extends string = string, A extends Access = Access> {
  readonly method: Method;
  readonly path: P;
  readonly access: A;
  readonly maxBody?: number;
  readonly raw: (request: Request, call: RawCall<P, A>) => Response | undefined | Promise<Response | undefined>;
}

// A table holds routes of every shape; each keeps its own types where it is written.
export type Route = JsonRoute<any, any, any, any> | RawRoute<any, any>;

/** Writes a JSON route, keeping its types. */
export function route<const P extends string, const A extends Access, B = undefined, R = unknown>(def: JsonRoute<P, A, B, R>): JsonRoute<P, A, B, R> {
  return def;
}

/** Writes a raw route, keeping its types. */
export function rawRoute<const P extends string, const A extends Access>(def: RawRoute<P, A>): RawRoute<P, A> {
  return def;
}

/** The reply a JSON route's handler gives, for a client. */
export type RouteReply<T> = T extends JsonRoute<any, any, any, infer R> ? Exclude<Awaited<R>, Response> : never;
/** The body a JSON route takes, for a client. */
export type RouteBody<T> = T extends JsonRoute<any, any, infer B, any> ? B : never;

/** A refusal a route's handler throws: its status and the words the caller is shown. */
export class RouteError extends Error {
  override name = "RouteError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A route as the table lists it. */
export interface RouteInfo {
  area: string;
  method: Method;
  path: string;
  access: Access;
  maxBody: number | null;
  raw: boolean;
}

export interface Placed {
  area: string;
  route: Route;
}

const LITERAL = /^[A-Za-z0-9._~-]+$/;
const PARAM = /^:[A-Za-z_][A-Za-z0-9_]*$/;

/** The access a path's place allows. */
function accessFor(path: string): readonly Access[] | null {
  if (path.startsWith("/v1/")) return ["provider"];
  if (path.startsWith("/api/v1/ext/")) return ["extension"];
  if (path.startsWith("/api/v1/")) return ["page", "public"];
  if (path === "/ui" || path.startsWith("/ui/")) return ["public"];
  return null;
}

/** A pattern's shape: its params unnamed, so that two patterns that match the same paths compare equal. */
function shapeOf(path: string): string {
  return path
    .split("/")
    .map((s) => (s.startsWith(":") ? ":" : s))
    .join("/");
}

export class RouteTable {
  private readonly placed: Placed[] = [];
  private readonly patterns = new Map<string, string>();
  private fixed = false;

  /** Adds an area's routes. All are checked before any is added. */
  add(area: string, routes: readonly Route[]): void {
    if (this.fixed) throw new Error(`The ${area} routes came after the server started: every area adds its routes before it starts.`);
    const taken = new Set(this.placed.map((p) => `${p.route.method} ${shapeOf(p.route.path)}`));
    const patterns = new Map(this.patterns);
    for (const r of routes) {
      const at = `${area}: ${r.method} ${r.path}`;
      if (!METHODS.includes(r.method)) throw new Error(`${at}: a route's method is one of ${METHODS.join(", ")}.`);
      const path: string = r.path;
      const segments = path.split("/");
      const wildcard = segments.at(-1) === "*";
      if (segments[0] !== "" || segments.length < 2 || !segments.slice(1).every((s, i) => LITERAL.test(s) || PARAM.test(s) || (s === "*" && i === segments.length - 2))) throw new Error(`${at}: a path is made of words and :params between slashes, with * last for a raw route.`);
      if (wildcard && !("raw" in r)) throw new Error(`${at}: only a raw route may end in *.`);
      const allowed = accessFor(r.path);
      if (allowed === null) throw new Error(`${at}: routes live under /v1/, /api/v1/ or /ui/.`);
      if (!allowed.includes(r.access)) throw new Error(`${at}: a route there is for ${allowed.join(" or ")}, not ${r.access}.`);
      if (r.maxBody !== undefined && (!Number.isInteger(r.maxBody) || r.maxBody < 0)) throw new Error(`${at}: maxBody is a whole number of bytes.`);
      if ("body" in r && r.body !== undefined && (r.method === "GET" || r.method === "DELETE")) throw new Error(`${at}: a ${r.method} takes no body.`);
      const shape = shapeOf(r.path);
      const key = `${r.method} ${shape}`;
      if (taken.has(key)) throw new Error(`${at}: another route already answers ${r.method} on that path.`);
      const pattern = patterns.get(shape);
      if (pattern !== undefined && pattern !== r.path) throw new Error(`${at}: name its params as ${pattern} does.`);
      taken.add(key);
      patterns.set(shape, r.path);
    }
    for (const r of routes) this.placed.push({ area, route: r });
    for (const [shape, pattern] of patterns) this.patterns.set(shape, pattern);
  }

  list(): RouteInfo[] {
    return this.placed.map(({ area, route: r }) => ({ area, method: r.method, path: r.path, access: r.access, maxBody: r.maxBody ?? null, raw: "raw" in r }));
  }

  /** Fixes the table for the server: each path pattern with its routes by method. */
  fix(): Map<string, Map<Method, Placed>> {
    this.fixed = true;
    const out = new Map<string, Map<Method, Placed>>();
    for (const placed of this.placed) {
      let byMethod = out.get(placed.route.path);
      if (byMethod === undefined) out.set(placed.route.path, (byMethod = new Map()));
      byMethod.set(placed.route.method, placed);
    }
    return out;
  }
}
