// A route called as the server calls it, without the network: the query read as the route declares it, the body held to its
// declaration, and the handler given only those, with the user and a signal; a refusal is the `RouteError` the server answers with.
// The reply is held to the route's declaration as the server would send it (as JSON): a call whose route answers what its
// declaration does not take fails there, naming the fields, so every test of an area's routes checks its replies at run time.
// For tests of an area's routes that need no server, their requests made by hand.

import { type App, type DeclaredRoute, problemsOf, readQuery, RouteError, type RouteReply } from "../../src/app";

/** What a call gives besides the route: its path's params, its query as the URL carries it, its body as JSON, and the user it acts for. */
export interface Given {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  user: string;
}

/** A route in the form that answers in JSON, of any types. */
type JsonRoute = DeclaredRoute<any, any, any, any, any, any>;

/** `route` asked as the server asks it: its reply, or the `RouteError` its declaration or its handler refuses with. */
export async function callRoute<R extends JsonRoute>(route: R, given: Given): Promise<RouteReply<R>> {
  const at = `${route.method} ${route.path}`;
  // `limit` and `cursor` belong to a route that pages, not to its declared query.
  const { limit: _limit, cursor: _cursor, ...declared } = given.query ?? {};
  const read = readQuery(route.query ?? {}, new URLSearchParams(Object.entries(route.paged === undefined ? (given.query ?? {}) : declared).map(([name, value]) => [name, String(value)])), at);
  if (!read.ok) throw new RouteError(400, read.why);
  let body: unknown;
  if (route.body === undefined) {
    if (given.body !== undefined) throw new RouteError(400, `${at} takes no body.`);
  } else {
    // As over a road: the body goes as JSON text and is read back.
    body = given.body === undefined ? undefined : JSON.parse(JSON.stringify(given.body));
    const problems = body === undefined ? [`${at} takes a JSON body.`] : problemsOf(route.body, body, "body");
    if (problems.length > 0) throw new RouteError(400, `${at} does not take this body: ${problems.slice(0, 3).join(" ")}`);
  }
  const handle = route.handle as (call: unknown) => unknown;
  // A route that pages is given what the server gives its handler: the size asked for (the route's own default where none is) and the place its page starts after (the cursor as given: the server's seal is its own).
  const paging = route.paged === undefined ? {} : { limit: _limit !== undefined ? Number(_limit) : route.paged.sizes === undefined ? undefined : (await route.paged.sizes({ params: given.params ?? {}, user: given.user })).default, ...(_cursor === undefined ? {} : { after: String(_cursor) }) };
  const reply = await handle({ params: given.params ?? {}, query: { ...read.value, ...paging }, body, user: given.user, auth: { user: given.user, access: route.access, listener: "tcp", credential: null }, signal: new AbortController().signal });
  const sent = reply === undefined ? undefined : JSON.parse(JSON.stringify(reply));
  const wrong = problemsOf(route.reply, sent, "reply");
  if (wrong.length > 0) throw new Error(`${at} answered what its declaration does not take: ${wrong.slice(0, 3).join(" ")}`);
  return reply as RouteReply<R>;
}

/** What is wrong with `reply` as the reply the table declares for `key` (`"GET /api/v1/chats"`): none where it is what the declaration takes, field for field. */
export function replyProblems(app: Pick<App, "routes">, key: string, reply: unknown): string[] {
  const info = app.routes.list().find((r) => `${r.method} ${r.path}` === key);
  if (info === undefined) throw new Error(`The table holds no route ${key}.`);
  if (!("reply" in info.declared)) throw new Error(`${key} answers in its own way, and declares no reply.`);
  return problemsOf(info.declared.reply, reply, "reply");
}

/**
 * What is wrong with `reply` as the reply of the route a request reached: the route is the table's whose method and path
 * pattern the request's path (its query left off) fits, a param taking one segment and `*` the rest. Throws when none fits.
 */
export function answeredProblems(app: Pick<App, "routes">, method: string, path: string, reply: unknown): string[] {
  const at = path.split("?")[0] ?? path;
  const fits = (pattern: string): boolean => new RegExp(`^${pattern.split("/").map((s) => (s === "*" ? ".+" : s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`).test(at);
  const info = app.routes.list().find((r) => r.method === method && fits(r.path));
  if (info === undefined) throw new Error(`The table holds no route that answers ${method} ${at}.`);
  return replyProblems(app, `${info.method} ${info.path}`, reply);
}
