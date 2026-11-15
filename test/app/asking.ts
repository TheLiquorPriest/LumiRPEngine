// A request for a route made from its own declaration, for tests that ask every route of the table (the joined
// answer's, the pages'): its params, its query and its body, each a value the declaration takes. A turn's id
// is the one given wherever the route takes one; any other field the declaration leaves optional is left out.

import type { AnyShape, Fields, RouteInfo } from "../../src/app";

/** What a request for a route is made of, as the client's call takes them. */
export interface Asked {
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

/** What the request names: the chat and the turn, and any param by name beside them. */
export interface Names {
  chat: string;
  turn: string;
  params?: Readonly<Record<string, string>>;
}

export const keyOf = (r: Pick<RouteInfo, "method" | "path">): string => `${r.method} ${r.path}`;

export function fieldShape(f: Fields[string]): AnyShape {
  return "kind" in f && f.kind === "field" ? f.of : (f as AnyShape);
}

export function isOptional(f: Fields[string]): boolean {
  return "kind" in f && f.kind === "field" && f.optional;
}

/** Whether a shape holds a turn's id somewhere in it. */
export function holdsTurn(s: AnyShape): boolean {
  switch (s.kind) {
    case "text":
      return s.turn !== undefined;
    case "list":
    case "record":
      return holdsTurn(s.of);
    case "object":
      return Object.values(s.fields).some((f) => holdsTurn(fieldShape(f)));
    case "union":
      return s.of.some(holdsTurn);
    default:
      return false;
  }
}

/** A value a shape takes, with any turn's id in it `turn`, and a text field of a name the path has (`chat`, say) the path's value. A field left optional is left out unless it holds a turn's id. */
export function sample(shape: AnyShape, turn: string, named: Readonly<Record<string, string>> = {}): unknown {
  switch (shape.kind) {
    case "text":
      if (shape.turn === undefined) return "a";
      return shape.turn.inside === null ? turn : shape.turn.inside.replace("<turn>", turn).replace(/<[^>]*>/g, "tap-1");
    case "number":
      return shape.least ?? 1;
    case "yesNo":
      return true;
    case "literal":
      return shape.value;
    case "oneOf":
      return shape.values[0];
    case "list":
      return [];
    case "record":
    case "json":
      return {};
    case "union":
      return sample(shape.of.find((s) => !(s.kind === "literal" && s.value === null)) ?? (shape.of[0] as AnyShape), turn, named);
    case "object":
      return Object.fromEntries(Object.entries(shape.fields).flatMap(([name, f]) => (isOptional(f) && !holdsTurn(fieldShape(f)) ? [] : [[name, fieldShape(f).kind === "text" && Object.hasOwn(named, name) && !holdsTurn(fieldShape(f)) ? named[name] : sample(fieldShape(f), turn, named)]])));
    default:
      return undefined;
  }
}

/** The request for `route`: a route that answers in its own way has no declaration to ask by, and is refused here. */
export function askOf(route: RouteInfo, names: Names): Asked {
  const d = route.declared;
  if (!("reply" in d)) throw new Error(`${keyOf(route)} answers in its own way, and declares nothing to ask it by.`);
  const known: Record<string, string> = { chat: names.chat, turn: names.turn, character: "someone", "*": "notes.md", ...names.params };
  const params: Record<string, string> = {};
  for (const name of route.params) params[name] = known[name] ?? "x";
  if (route.path.endsWith("*")) params["*"] = known["*"] ?? "notes.md";
  const query: Record<string, string> = {};
  for (const [name, f] of Object.entries(d.query)) if (!isOptional(f) || holdsTurn(fieldShape(f))) query[name] = String(sample(fieldShape(f), names.turn, params));
  return d.body === null ? { params, query } : { params, query, body: sample(d.body, names.turn, params) };
}
