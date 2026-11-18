// The one route table (plan §4.4). Every area adds its routes here and nowhere else: the provider
// endpoint Lumiverse calls (`/v1/`), the API that pages and the extension call (`/api/v1/`), and
// the web UI (`/ui/`). Each route says who may call it, and the server holds every request to that,
// and to its Origin, its Host and its body limit, before the route's own code runs. Routes are fixed
// once the server has started.
//
// The route form. A route declares, as values the code reads while it runs, what it takes and what it
// answers: its params (named by its path's pattern), its query, its body and its reply, each a shape
// (below), with the group of §4.4 it belongs to and one line saying what it does. A raw route declares
// what it answers in words (an OpenAI stream, a socket, a file). The server holds each request to its
// route's declaration before the handler runs, and refuses with 400, in RPE's words, what the route does
// not take; the handler is given only what was declared, typed by the declaration, and what auth answered
// for its call (`CallAuth`: whose call, on which listener, with which credential), never a credential's text. The client's types
// and the API reference (`docs/api.md`) are written from the same declarations (`bun run api`,
// `scripts/api/`), and a test holds every reply to its declaration, so no route's shape is kept by hand
// anywhere else. Every route is in this form: the table holds no other.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export const METHODS: readonly Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Who may call a route:
 * - `public`: anyone who reaches the server (its status, the web UI's files);
 * - `page`: a page of the Lumiverse user this RPE belongs to, with a page token or the web UI's token;
 * - `provider`: Lumiverse on RPE's connection, with the provider key;
 * - `extension`: the light extension, with its registration key;
 * - `command`: the server's own command line, on the Unix socket in the data folder that only the
 *   owner's account may open. Such a route is served there alone: never on the TCP listener, so never
 *   through Lumiverse's relay either, and no page can reach it.
 *
 * Which a route may say follows from where it is: `/v1/` is the provider's, `/api/v1/ext/` the
 * extension's, `/api/v1/command/` the command line's, the rest of `/api/v1/` is pages' (or public),
 * and `/ui/` is public.
 */
export type Access = "public" | "page" | "provider" | "extension" | "command";

/** Where the command line's routes live, and the only place a route of `command` access may be. */
export const COMMAND_PREFIX = "/api/v1/command/";

/**
 * The groups of §4.4 l.309, in the reference's order: the provider endpoint (`/v1/`), the API's groups
 * (`/api/v1/`), the live socket and the web UI (`/ui/`).
 */
export const ROUTE_GROUPS = ["provider", "chats", "turns", "state", "cast", "story", "places", "quests", "lore", "files", "sessions", "jobs", "agents", "rules", "connections", "settings", "worlds", "migration", "service", "live", "ui"] as const;
export type RouteGroup = (typeof ROUTE_GROUPS)[number];

/** A segment's param name: `:chat` names `chat`; the last segment `*`, the rest of the path, is named `*`. */
type ParamName<S extends string> = S extends `:${infer Name}` ? Name : S extends "*" ? "*" : never;
/** The names of a path pattern's params: `/api/v1/chats/:chat/turns/:turn` has `chat` and `turn`, `/api/v1/files/*` has `*`. */
export type ParamNames<P extends string> = P extends `${infer Head}/${infer Tail}` ? ParamName<Head> | ParamNames<Tail> : ParamName<P>;
export type PathParams<P extends string> = { readonly [K in ParamNames<P>]: string };

/** The user a route acts for: on a page route, the user this RPE belongs to; elsewhere that user, or null before one is set. */
export type UserFor<A extends Access> = A extends "page" ? string : string | null;

/** The kinds of credential a call comes with: the provider key, a page token, the web UI's key, the extension's registration key. */
export type CredentialKind = "provider" | "page" | "web" | "extension";

/** The credential a call came with, as auth found it: never its text. */
export interface CallCredential {
  readonly kind: CredentialKind;
  /** Its SHA-256, as RPE keeps it. */
  readonly hash: string;
  /** The client that made it, as RPE recorded it when it was made (the extension for a page, the command line for the web UI's key, RPE at its start for the extension's); null for the provider key. */
  readonly madeBy: string | null;
  /** When it runs out (epoch milliseconds); null: no end. */
  readonly until: number | null;
}

/**
 * What auth answered for one call, as every handler is handed it whole: whose call (the user this RPE belongs to), the access its
 * route asked for, the listener it came on (a call on the command line's socket is the command line's, its socket its credential),
 * and the credential it came with (none for a public route's call, nor on the command socket). Nothing a caller names in a header
 * or a body changes it.
 */
export interface CallAuth {
  readonly user: string;
  readonly access: Access;
  readonly listener: "tcp" | "command";
  readonly credential: CallCredential | null;
}

// ---------------------------------------------------------------- shapes

/** The type a shape describes: a mark for the compiler, never set. */
declare const DESCRIBES: unique symbol;

interface ShapeOf<T> {
  readonly [DESCRIBES]?: T;
  /** The generated types write a named shape once, under its name, and the reference lists it there. */
  readonly name?: string;
  /** What a value of it is, in a line: a named shape's, beside its name. */
  readonly doc?: string;
}

/**
 * Text; not blank, where `blank` is false (the space at its ends is not counted). `turn` marks text that
 * holds a turn's id, alone (`inside` null) or inside another id (`inside` is that id's form, `tap:<turn>:<tap>`
 * say): a route that takes one declares `joined` (below), and the table lists it as one that does.
 */
export interface TextShape extends ShapeOf<string> {
  readonly kind: "text";
  readonly blank: boolean;
  readonly turn?: { readonly inside: string | null };
}

/** A number, or a whole number; at least `least` and at most `most` where each is given. */
export interface NumberShape extends ShapeOf<number> {
  readonly kind: "number";
  readonly whole: boolean;
  readonly least: number | null;
  readonly most: number | null;
}

export interface YesNoShape extends ShapeOf<boolean> {
  readonly kind: "yesNo";
}

export type LiteralValue = string | number | boolean | null;

/** Exactly one value. */
export interface LiteralShape<V extends LiteralValue = LiteralValue> extends ShapeOf<V> {
  readonly kind: "literal";
  readonly value: V;
}

/** One of a few words. */
export interface OneOfShape<V extends string = string> extends ShapeOf<V> {
  readonly kind: "oneOf";
  readonly values: readonly V[];
}

/** A list, each item of one shape; `readonly` where the server hands on a list it may not change. */
export interface ListShape<A extends readonly unknown[] = readonly unknown[]> extends ShapeOf<A> {
  readonly kind: "list";
  readonly of: AnyShape;
  readonly readonly: boolean;
}

/** An object with named fields, and no others; `page` marks the reply of a route that pages. */
export interface ObjectShape<T = unknown> extends ShapeOf<T> {
  readonly kind: "object";
  readonly fields: Fields;
  readonly page?: true;
}

/** An object whose keys are any names and whose values are each of one shape. */
export interface RecordShape<T = unknown> extends ShapeOf<{ [key: string]: T }> {
  readonly kind: "record";
  readonly of: AnyShape;
}

/** Any one of several shapes. */
export interface UnionShape<T = unknown> extends ShapeOf<T> {
  readonly kind: "union";
  readonly of: readonly AnyShape[];
}

/** Any JSON value, carried as it is. */
export interface JsonShape extends ShapeOf<JsonValue> {
  readonly kind: "json";
}

/** No value: a reply of nothing (204), a body a route does not take, or a field an object never has (`optional(nothing())`, a field of `undefined`). */
export interface NothingShape extends ShapeOf<void> {
  readonly kind: "nothing";
}

/** A value of the previous build's wire, carried as that build wrote it (see `shape.carried`). */
export interface CarriedShape<T = unknown> extends ShapeOf<T> {
  readonly kind: "carried";
  readonly name: string;
  /** The module the generated types import its type from, relative to `src/shared/api/`. */
  readonly from: string;
  readonly words: string;
  readonly holds: (value: unknown) => boolean;
}

export type AnyShape = TextShape | NumberShape | YesNoShape | LiteralShape | OneOfShape | ListShape | ObjectShape | RecordShape | UnionShape | JsonShape | NothingShape | CarriedShape;

/** A field of an object: its shape, whether it may be left out, and what it is, in a line. */
export interface FieldShape<S extends AnyShape = AnyShape, O extends boolean = boolean> {
  readonly kind: "field";
  readonly of: S;
  readonly optional: O;
  readonly doc?: string;
}

export type Fields = { readonly [name: string]: AnyShape | FieldShape };

/** The type a shape describes. */
export type Infer<S> = S extends ShapeOf<infer T> ? T : never;

/** True when two types are the same, each field's optional mark included: a declaration that mirrors another's type stops compiling where they part. */
export type Exactly<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;
/** True when each of two types is assignable to the other: for a type made of intersections, which `Exactly` tells from the flat object a declaration makes. */
export type Mutually<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compiles only for `true`. */
export type Holds<T extends true> = T;

type FieldOf<F> = F extends FieldShape<infer S, boolean> ? S : F;
/** A field's value: a field of nothing is one the object never has, as `undefined`. */
type FieldValue<S> = S extends NothingShape ? undefined : Infer<S>;
type OptionalNames<F extends Fields> = { [K in keyof F]: F[K] extends FieldShape<AnyShape, true> ? K : never }[keyof F];
type Flat<T> = { [K in keyof T]: T[K] };
/** The object type a set of fields describes. */
export type FieldsOut<F extends Fields> = Flat<{ [K in Exclude<keyof F, OptionalNames<F>>]: FieldValue<FieldOf<F[K]>> } & { [K in OptionalNames<F>]?: FieldValue<FieldOf<F[K]>> }>;

const TEXT: TextShape = { kind: "text", blank: true };
const NULL: LiteralShape<null> = { kind: "literal", value: null };

function list<S extends AnyShape>(of: S): ListShape<Infer<S>[]>;
function list<S extends AnyShape>(of: S, options: { readonly: true }): ListShape<readonly Infer<S>[]>;
function list(of: AnyShape, options?: { readonly: true }): ListShape {
  return { kind: "list", of, readonly: options?.readonly === true };
}

function nullable<S extends AnyShape>(of: S): UnionShape<Infer<S> | null> {
  return { kind: "union", of: [of, NULL] };
}

/** The shapes a route's query, body and reply are declared in. */
export const shape = {
  /** Text; `{ blank: false }` for text that is not blank. */
  text: (options: { blank?: false } = {}): TextShape => (options.blank === false ? { kind: "text", blank: false } : TEXT),
  number: (bounds: { least?: number; most?: number } = {}): NumberShape => ({ kind: "number", whole: false, least: bounds.least ?? null, most: bounds.most ?? null }),
  whole: (bounds: { least?: number; most?: number } = {}): NumberShape => ({ kind: "number", whole: true, least: bounds.least ?? null, most: bounds.most ?? null }),
  yesNo: (): YesNoShape => ({ kind: "yesNo" }),
  literal: <const V extends LiteralValue>(value: V): LiteralShape<V> => ({ kind: "literal", value }),
  oneOf: <const V extends string>(...values: V[]): OneOfShape<V> => ({ kind: "oneOf", values }),
  list,
  object: <const F extends Fields>(fields: F): ObjectShape<FieldsOut<F>> => ({ kind: "object", fields }),
  record: <S extends AnyShape>(of: S): RecordShape<Infer<S>> => ({ kind: "record", of }),
  union: <const S extends readonly AnyShape[]>(...of: S): UnionShape<Infer<S[number]>> => ({ kind: "union", of }),
  nullable,
  json: (): JsonShape => ({ kind: "json" }),
  nothing: (): NothingShape => ({ kind: "nothing" }),
  /**
   * A value of the previous build's wire (its messages and its state view), which the form does not describe field by field: carried
   * as that build wrote it, under the name of its type, which the generated types take from `from` (a module of `src/shared`, as
   * `src/shared/api/index.ts` reaches it). `words` says in the refusal what a value must be; `holds` is what the server checks of it.
   */
  carried: <T>(name: string, from: string, doc: string, words: string, holds: (value: unknown) => value is T): CarriedShape<T> => ({ kind: "carried", name, from, doc, words, holds }),
  /** A field that may be left out. */
  optional: <S extends AnyShape>(of: S, doc?: string): FieldShape<S, true> => ({ kind: "field", of, optional: true, ...(doc === undefined ? {} : { doc }) }),
  /** A field with a line saying what it is. */
  field: <S extends AnyShape>(of: S, doc: string): FieldShape<S, false> => ({ kind: "field", of, optional: false, doc }),
  /** `of`, written once under `name` in the generated types and the reference. */
  named: <S extends AnyShape>(name: string, doc: string, of: S): S => ({ ...of, name, doc }) as S,
  /** A page of a list, as a route that pages answers: its items, and where the next page starts (null at the end). */
  page: <S extends AnyShape>(item: S): ObjectShape<{ items: Infer<S>[]; next: string | null }> => ({ kind: "object", fields: { items: list(item), next: nullable(TEXT) }, page: true }),
  /**
   * A turn's id, as a field of a query or a body, or a reply's field that names one: written once as `TurnId`. Where the
   * id is held inside another (a tap's, `tap:<turn>:<tap>`), `inside` is that id's form and the shape is not named.
   */
  turnId: (inside?: string): TextShape => (inside === undefined ? { kind: "text", blank: false, turn: { inside: null }, name: "TurnId", doc: "A turn's id: the id RPE gives a turn when it begins it." } : { kind: "text", blank: false, turn: { inside } }),
};

/** What a value of `s` is, in words, for a refusal. */
export function shapeWords(s: AnyShape): string {
  if (s.name !== undefined && s.kind !== "carried") return `a ${s.name}`;
  switch (s.kind) {
    case "text":
      return s.turn !== undefined ? (s.turn.inside === null ? "a turn's id" : `an id of the form ${s.turn.inside}`) : s.blank ? "text" : "text that is not blank";
    case "number": {
      const what = s.whole ? "a whole number" : "a number";
      if (s.least !== null && s.most !== null) return `${what} from ${s.least} to ${s.most}`;
      if (s.least !== null) return `${what} of at least ${s.least}`;
      if (s.most !== null) return `${what} of at most ${s.most}`;
      return what;
    }
    case "yesNo":
      return "true or false";
    case "literal":
      return JSON.stringify(s.value);
    case "oneOf":
      return s.values.length === 1 ? JSON.stringify(s.values[0]) : `one of ${s.values.slice(0, -1).map((v) => JSON.stringify(v)).join(", ")} or ${JSON.stringify(s.values.at(-1))}`;
    case "list":
      return `a list of ${plural(s.of)}`;
    case "object":
      return Object.keys(s.fields).length === 0 ? "an empty object" : `an object of ${Object.keys(s.fields).join(", ")}`;
    case "record":
      return `an object whose every value is ${shapeWords(s.of)}`;
    case "union":
      return s.of.map(shapeWords).join(", or ");
    case "json":
      return "any JSON value";
    case "carried":
      return s.words;
    case "nothing":
      return "nothing";
  }
}

function plural(s: AnyShape): string {
  if (s.name !== undefined) return `${s.name} items`;
  if (s.kind === "text") return s.blank ? "texts" : "texts that are not blank";
  return `items, each ${shapeWords(s)}`;
}

function fieldOf(f: AnyShape | FieldShape): { of: AnyShape; optional: boolean } {
  return f.kind === "field" ? { of: f.of, optional: f.optional } : { of: f, optional: false };
}

/** The field every alternative of a union of objects holds as a literal, by which a value picks its alternative; null when there is none. */
function discriminant(alternatives: readonly AnyShape[]): string | null {
  const objects = alternatives.filter((a): a is ObjectShape => a.kind === "object");
  if (objects.length !== alternatives.length || objects.length === 0) return null;
  const first = objects[0] as ObjectShape;
  for (const name of Object.keys(first.fields)) if (objects.every((o) => o.fields[name] !== undefined && fieldOf(o.fields[name] as AnyShape | FieldShape).of.kind === "literal")) return name;
  return null;
}

/** One thing wrong with a value, where it is: not of its shape, a field its object needs left out, or a field it does not take. */
type Problem =
  | { kind: "not"; at: string; shape: AnyShape; value: unknown }
  | { kind: "needs"; at: string; name: string; shape: AnyShape }
  | { kind: "extra"; at: string; name: string; value: unknown; takes: string[] };

/** What is wrong with `value` as a value of `s`, each where it is (from `at`); none when it holds. Strict: an object with a field its shape does not name is refused. */
function problemList(s: AnyShape, value: unknown, at: string): Problem[] {
  const not = (): Problem[] => [{ kind: "not", at, shape: s, value }];
  switch (s.kind) {
    case "text":
      return typeof value === "string" && (s.blank || value.trim() !== "") ? [] : not();
    case "number":
      return typeof value === "number" && Number.isFinite(value) && (!s.whole || Number.isInteger(value)) && (s.least === null || value >= s.least) && (s.most === null || value <= s.most) ? [] : not();
    case "yesNo":
      return typeof value === "boolean" ? [] : not();
    case "literal":
      return value === s.value ? [] : not();
    case "oneOf":
      return typeof value === "string" && (s.values as readonly string[]).includes(value) ? [] : not();
    case "list":
      return Array.isArray(value) ? value.flatMap((item, i) => problemList(s.of, item, `${at}[${i}]`)) : not();
    case "object": {
      if (!isRecord(value)) return not();
      const out: Problem[] = [];
      for (const [name, f] of Object.entries(s.fields)) {
        const { of, optional } = fieldOf(f);
        const given = Object.hasOwn(value, name) ? value[name] : undefined;
        if (given === undefined) {
          if (!optional) out.push({ kind: "needs", at, name, shape: of });
        } else out.push(...problemList(of, given, `${at}.${name}`));
      }
      for (const name of Object.keys(value)) if (!Object.hasOwn(s.fields, name) && value[name] !== undefined) out.push({ kind: "extra", at, name, value: value[name], takes: Object.keys(s.fields) });
      return out;
    }
    case "record":
      return isRecord(value) ? Object.entries(value).flatMap(([name, item]) => problemList(s.of, item, `${at}.${name}`)) : not();
    case "union": {
      if (s.of.some((alternative) => problemList(alternative, value, at).length === 0)) return [];
      // A union of objects told apart by one field: the alternative the value names says what is wrong with it.
      const by = discriminant(s.of);
      if (by !== null && isRecord(value)) {
        const picked = s.of.find((o) => o.kind === "object" && problemList(fieldOf(o.fields[by] as AnyShape | FieldShape).of, value[by], at).length === 0);
        if (picked !== undefined) return problemList(picked, value, at);
      }
      return not();
    }
    case "json":
      return isJson(value) ? [] : not();
    case "carried":
      return s.holds(value) ? [] : not();
    case "nothing":
      return value === undefined ? [] : not();
  }
}

/** A problem as the form says it: a sentence naming where it is. */
function problemWords(p: Problem): string {
  switch (p.kind) {
    case "not":
      return `${p.at} must be ${shapeWords(p.shape)}.`;
    case "needs":
      return `${p.at} needs ${p.name}: ${shapeWords(p.shape)}.`;
    case "extra":
      return `${p.at} has ${p.name}, which it does not take.`;
  }
}

/**
 * What is wrong with `value` as a value of `s` (each problem a sentence naming where it is, from `at`);
 * none when it holds. Strict: an object with a field its shape does not name is refused.
 */
export function problemsOf(s: AnyShape, value: unknown, at = "value"): string[] {
  return problemList(s, value, at).map(problemWords);
}

/**
 * What the form found wrong with a request before its handler ran, as a route that words its own refusals is handed it (`refusal`):
 * a field it could not read (`unreadable`: left out, sent twice, or not of its shape; `body` for a body missing or not JSON), with
 * what was sent there and, where they are few, the values it takes; a field it does not take (`not_taken`), with the names it does;
 * a page asked larger than its route gives (`page_size`, with `most`); or a cursor the route did not give for the list (`cursor`).
 */
export interface FormProblem {
  kind: "unreadable" | "not_taken" | "page_size" | "cursor";
  /** The field, by its path in the body (`id`, `items[2].name`) or its name in the query; `body` for the body as a whole. */
  field: string;
  /** What was sent there, as it was sent; absent where nothing was. */
  value?: unknown;
  /** For `unreadable`, the values the field takes where they are few; for `not_taken`, the names taken where it was sent. */
  choices: string[];
  /** For `page_size`: the most a page of the route holds. */
  most?: number;
}

/** The values a shape takes, where they are few enough to list: one word of a few, true or false, the one value; none for any other. */
function choicesOf(s: AnyShape): string[] {
  return s.kind === "oneOf" ? [...s.values] : s.kind === "yesNo" ? ["true", "false"] : s.kind === "literal" ? [String(s.value)] : [];
}

/** The first problem of a body as a route's own words take it; null when the body holds. */
export function bodyProblem(s: AnyShape, value: unknown): FormProblem | null {
  const first = problemList(s, value, "body")[0];
  if (first === undefined) return null;
  const path = (at: string, name?: string): string => {
    const whole = name === undefined ? at : `${at}.${name}`;
    return whole === "body" ? whole : whole.slice("body.".length);
  };
  switch (first.kind) {
    case "not":
      return { kind: "unreadable", field: path(first.at), value: first.value, choices: choicesOf(first.shape) };
    case "needs":
      return { kind: "unreadable", field: path(first.at, first.name), choices: choicesOf(first.shape) };
    case "extra":
      return { kind: "not_taken", field: path(first.at, first.name), value: first.value, choices: first.takes };
  }
}

function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

// ---------------------------------------------------------------- the query

/** What a query string can carry: text, a number, true or false, one word of a few. */
export type QueryShape = TextShape | NumberShape | YesNoShape | LiteralShape<string | number | boolean> | OneOfShape;
export type QueryFields = { readonly [name: string]: QueryShape | FieldShape<QueryShape> };

const QUERY_KINDS: Readonly<Record<QueryShape["kind"], true>> = { text: true, number: true, yesNo: true, literal: true, oneOf: true };
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** A query value as its shape reads it; undefined when it is not one. */
function queryValue(s: QueryShape, given: string): unknown {
  switch (s.kind) {
    case "text":
    case "oneOf":
      return given;
    case "number":
      return DECIMAL.test(given) ? Number(given) : undefined;
    case "yesNo":
      return given === "true" ? true : given === "false" ? false : undefined;
    case "literal":
      return typeof s.value === "number" ? (DECIMAL.test(given) ? Number(given) : undefined) : typeof s.value === "boolean" ? (given === "true" ? true : given === "false" ? false : undefined) : given;
  }
}

/** The query as `fields` read it, or why it is not one they take: a name they do not hold, one given twice, one left out, or a value of the wrong kind. */
export function readQuery(fields: QueryFields, given: URLSearchParams, route: string): { ok: true; value: Record<string, unknown> } | { ok: false; why: string; problem: FormProblem } {
  const names = Object.keys(fields);
  const value: Record<string, unknown> = {};
  for (const name of new Set(given.keys())) {
    const all = given.getAll(name);
    if (!Object.hasOwn(fields, name))
      return {
        ok: false,
        why: names.length === 0 ? `${route} takes no query, and this one gives ${name}.` : `${route} takes no ${name} in its query: it takes ${names.join(", ")}.`,
        problem: { kind: "not_taken", field: name, value: all.join(", "), choices: names },
      };
    const { of } = fieldOf(fields[name] as QueryShape | FieldShape<QueryShape>);
    if (all.length > 1) return { ok: false, why: `The query gives ${name} ${all.length} times, and ${route} takes it once.`, problem: { kind: "unreadable", field: name, value: all.join(", "), choices: choicesOf(of) } };
    const raw = all[0] ?? "";
    const read = queryValue(of as QueryShape, raw);
    if (read === undefined || problemsOf(of, read).length > 0) return { ok: false, why: `The query's ${name} is ${shapeWords(of)}, not ${JSON.stringify(raw)}.`, problem: { kind: "unreadable", field: name, value: raw, choices: choicesOf(of) } };
    value[name] = read;
  }
  for (const name of names) {
    const { of, optional } = fieldOf(fields[name] as QueryShape | FieldShape<QueryShape>);
    if (!optional && !Object.hasOwn(value, name)) return { ok: false, why: `${route} needs ${name} in its query: ${shapeWords(of)}.`, problem: { kind: "unreadable", field: name, choices: choicesOf(of) } };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------- routes

/** A paged route's sizes: the page's when the caller names none, and the most it may name. */
export interface PageSizes {
  readonly default: number;
  readonly most: number;
}

/**
 * How a route pages: it takes `limit` and `cursor` in its query and answers a page (`shape.page`).
 * `sizes` gives the page's size when the caller names none and the most it may name, each from a setting
 * of the route's own area; absent, the route hands the caller's limit to the list it reads (one of RPH's),
 * which holds it to its own.
 *
 * What a cursor is. A list is read in its own order, and every item has its place in that order (an id, a
 * time and an id: whatever the list is ordered by), never a count of items before it. The handler is given
 * `after`, the place after which its page starts (absent for the first page), and answers its items and,
 * as `next`, the place of its last item, or null at the end. The server seals that place to the route
 * and the list it was given for (the route's params), with a key of its own start, and hands the page the
 * seal as its cursor: a cursor this route did not give for this list (another route's, another list's,
 * one changed, one from before the server last started) is refused with 400 before the handler runs. So
 * a walk over a list that changes between its pages neither repeats nor skips an item that stayed.
 */
export interface Paging<P extends string = string, A extends Access = Access> {
  readonly sizes?: (at: { readonly params: PathParams<P>; readonly user: UserFor<A> }) => PageSizes | Promise<PageSizes>;
}

/** What a paged route's handler finds in its query beside what it declared: the size asked for (with `sizes`, the default when none was), and the place its page starts after. */
type PageQuery<G> = G extends { readonly sizes: (...args: never[]) => unknown } ? { limit: number; after?: string } : { limit?: number; after?: string };
type QueryOut<Q extends QueryFields, G> = [G] extends [Paging] ? Flat<FieldsOut<Q> & PageQuery<G>> : FieldsOut<Q>;

/**
 * What a declared route's handler is given: what its declaration takes, read and typed, and nothing else
 * of the request, with what auth answered for its call.
 */
export type DeclaredCall<P extends string, A extends Access, Q extends QueryFields, B extends AnyShape | undefined, G> = {
  readonly params: PathParams<P>;
  readonly query: QueryOut<Q, G>;
  /** The body, held to its declaration; undefined for a route that takes none. */
  readonly body: B extends AnyShape ? Infer<B> : undefined;
  readonly user: UserFor<A>;
  readonly auth: CallAuth;
  /** Aborts when the caller goes away; never, for a long route's call, whose answer is kept for reading. */
  readonly signal: AbortSignal;
};

/**
 * A route in the form that answers in JSON: its group, what it does, its query, its body and its reply.
 * The handler returns the reply (sent with 200; nothing, for a reply of `shape.nothing()`, with 204), or
 * throws a `RouteError` to refuse.
 */
export interface DeclaredRoute<
  P extends string = string,
  A extends Access = Access,
  Q extends QueryFields = QueryFields,
  B extends AnyShape | undefined = AnyShape | undefined,
  R extends AnyShape = AnyShape,
  G extends Paging<P, A> | undefined = Paging<P, A> | undefined,
> {
  readonly method: Method;
  readonly path: P;
  readonly access: A;
  readonly group: RouteGroup;
  /** What it does, in one line. */
  readonly does: string;
  /** The largest body it takes, in bytes; the server's setting when absent. */
  readonly maxBody?: number;
  /** The names its query takes, each with its shape; absent, it takes no query. */
  readonly query?: Q;
  /** Its body's shape; absent, it takes no body. */
  readonly body?: B;
  readonly reply: R;
  readonly paged?: G;
  /**
   * It may take longer than the relay proxy's 30 seconds (R-4): a page's call to it over TCP is answered at once, status 202, with
   * `{ answer: <id> }`, and its own answer is read from `GET /api/v1/answers/:id` once ready (`answers.ts`).
   */
  readonly long?: true;
  /**
   * It takes a turn's id (in its path, its query or its body), and a turn that was joined to another is answered as a fact:
   * `JoinedAnswer`, status 409, in the one place the server turns a throw into an answer.
   */
  readonly joined?: true;
  /** Whether the chat its path names is taken on before it answers (`takesChat`); declared only where the route does otherwise than its method says. */
  readonly takesChat?: boolean;
  /**
   * Words its own refusal of a request the form refused before the handler ran (its query or its body), from what the form found,
   * for the user and the path's params; absent, the form's own words say it.
   */
  readonly refusal?: (problem: FormProblem, asked: { user: UserFor<A>; params: PathParams<P> }) => Promise<string>;
  readonly handle: (call: DeclaredCall<P, A, Q, B, G>) => Infer<R> | Promise<Infer<R>>;
}

/** What a raw route's handler is given besides the request. */
export interface RawCall<P extends string, A extends Access> {
  readonly params: PathParams<P>;
  readonly user: UserFor<A>;
  readonly auth: CallAuth;
  /**
   * Turns the request into a live socket, the one kind of socket RPE serves, sending `headers` with
   * the answer; false when the request is not a socket's.
   */
  readonly openLiveSocket: (headers?: Record<string, string>) => boolean;
  /**
   * The request's body as JSON, parsed on a worker thread when it is larger than `server.workerParseBytes`
   * (a long prompt's parse holds up no other request); rejects when there is no body or it is not JSON.
   */
  readonly json: () => Promise<unknown>;
  /**
   * Lifts the server's idle bound (`server.idleSeconds`) from this request: for an answer that sends nothing until it is whole,
   * which its own hold bounds (a reply asked for whole).
   */
  readonly untimed: () => void;
}

/**
 * A route in the form that takes the request as it came (its body already read and held to its limit)
 * and makes its own response, saying in words what it answers: a handler another area wrote from a
 * request to a response (the provider endpoint, the extension's question), the web UI's files, the live
 * socket. Undefined: the request became a socket.
 */
export interface DeclaredRawRoute<P extends string = string, A extends Access = Access> {
  readonly method: Method;
  readonly path: P;
  readonly access: A;
  readonly group: RouteGroup;
  readonly does: string;
  /** What it answers, in words: an OpenAI stream, a socket, a file. */
  readonly answers: string;
  readonly maxBody?: number;
  readonly raw: (request: Request, call: RawCall<P, A>) => Response | undefined | Promise<Response | undefined>;
  /** A turn that was joined to another is answered as a fact (`JoinedAnswer`, status 409), whatever this route reads. */
  readonly joined?: true;
  /** As a JSON route's. */
  readonly takesChat?: boolean;
}

/** A route in the form, of any types. */
export type Declared = DeclaredRoute<any, any, any, any, any, any> | DeclaredRawRoute<any, any>;
// A table holds routes of every shape; each keeps its own types where it is written.
export type Route = Declared;

/** Writes a JSON route in the form, keeping its types. */
export function route<const P extends string, const A extends Access, const Q extends QueryFields = {}, B extends AnyShape | undefined = undefined, R extends AnyShape = AnyShape, G extends Paging<P, A> | undefined = undefined>(def: DeclaredRoute<P, A, Q, B, R, G>): DeclaredRoute<P, A, Q, B, R, G> {
  return def;
}

/** Writes a raw route in the form, keeping its types. */
export function rawRoute<const P extends string, const A extends Access>(def: DeclaredRawRoute<P, A>): DeclaredRawRoute<P, A> {
  return def;
}

/** The reply a JSON route gives, for a client. */
export type RouteReply<T> = T extends DeclaredRoute<any, any, any, any, infer R, any> ? Infer<R> : never;
/** The body a JSON route takes, for a client. */
export type RouteBody<T> = T extends DeclaredRoute<any, any, any, infer B, any, any> ? (B extends AnyShape ? Infer<B> : undefined) : never;

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

/**
 * What the server answers a turn that was joined to another with, status 409: a continue's held turn is joined to the turn
 * it extended, and any reading of it is refused naming the turn it joined (`JoinedTurnError`, `src/store/types.ts`). The page
 * follows it to the turn joined; it is a fact about the turn, never a failure of the server. Every route that takes a turn's id
 * declares `joined`, and the server gives this answer wherever such a refusal is thrown under a route.
 */
export const JOINED_STATUS = 409;
export const joinedAnswer = shape.named(
  "JoinedAnswer",
  "What a route that takes a turn's id answers, with status 409, for a turn that was joined to another: the turn asked for and the turn it joined, which is the one to ask for.",
  shape.object({ joined: shape.object({ turn: shape.turnId(), joined: shape.turnId() }) }),
);
export type JoinedAnswer = Infer<typeof joinedAnswer>;

/** A route's declaration as the table lists it: what a JSON route takes and answers, or what a raw route answers. */
export type RouteDeclaration =
  | { readonly group: RouteGroup; readonly does: string; readonly query: QueryFields; readonly body: AnyShape | null; readonly reply: AnyShape; readonly paged: boolean; readonly long: boolean; readonly joined: boolean; readonly turn: boolean }
  | { readonly group: RouteGroup; readonly does: string; readonly answers: string; readonly joined: boolean; readonly turn: boolean };

/** A route as the table lists it. */
export interface RouteInfo {
  area: string;
  method: Method;
  path: string;
  access: Access;
  maxBody: number | null;
  raw: boolean;
  /** Its params, by the names its pattern gives them (`*` for the rest of the path). */
  params: string[];
  /** Its declaration. */
  declared: RouteDeclaration;
  /** Whether the server takes on the chat its path names before it answers (`takesChat`). */
  takesChat: boolean;
}

export interface Placed {
  area: string;
  route: Route;
}

const LITERAL = /^[A-Za-z0-9._~-]+$/;
const PARAM = /^:[A-Za-z_][A-Za-z0-9_]*$/;
const SHAPE_KINDS: Readonly<Record<AnyShape["kind"], true>> = { text: true, number: true, yesNo: true, literal: true, oneOf: true, list: true, object: true, record: true, union: true, json: true, nothing: true, carried: true };

/** The access a path's place allows. */
function accessFor(path: string): readonly Access[] | null {
  if (path.startsWith("/v1/")) return ["provider"];
  if (path.startsWith("/api/v1/ext/")) return ["extension"];
  if (path.startsWith(COMMAND_PREFIX)) return ["command"];
  if (path.startsWith("/api/v1/")) return ["page", "public"];
  if (path === "/ui" || path.startsWith("/ui/")) return ["public"];
  return null;
}

/** The groups a path's place allows: the provider endpoint's under `/v1/`, the web UI's under `/ui/`, the API's under `/api/v1/`. */
function groupsFor(path: string): (group: RouteGroup) => boolean {
  if (path.startsWith("/v1/")) return (g) => g === "provider";
  if (path === "/ui" || path.startsWith("/ui/")) return (g) => g === "ui";
  return (g) => g !== "provider" && g !== "ui";
}

/** A pattern's shape: its params unnamed, so that two patterns that match the same paths compare equal. */
function shapeOf(path: string): string {
  return path
    .split("/")
    .map((s) => (s.startsWith(":") ? ":" : s))
    .join("/");
}

/** A pattern's params, in order: `:name` segments by name, and `*` for the rest of the path. */
export function paramsOf(path: string): string[] {
  return path.split("/").flatMap((s) => (s.startsWith(":") ? [s.slice(1)] : s === "*" ? ["*"] : []));
}

function isShape(value: unknown): value is AnyShape {
  return isRecord(value) && typeof value.kind === "string" && Object.hasOwn(SHAPE_KINDS, value.kind);
}

/** Why a route in the form cannot be held to its declaration as written; null when it can. */
function declarationProblem(r: Declared): string | null {
  if (!(ROUTE_GROUPS as readonly string[]).includes(r.group)) return `its group is one of §4.4's: ${ROUTE_GROUPS.join(", ")}.`;
  if (!groupsFor(r.path)(r.group)) return `a route at ${r.path} is not in the ${r.group} group.`;
  if (typeof r.does !== "string" || r.does.trim() === "" || r.does.includes("\n")) return "it says what it does in one line.";
  if (r.joined !== undefined && r.joined !== true) return "joined is true where the route takes a turn's id, and left out where it does not.";
  if (r.takesChat !== undefined && !CHAT_PATH.test(r.path)) return "takesChat is declared only on a route whose path names a chat first.";
  if (r.takesChat !== undefined && r.takesChat === takesByMethod(r)) return "takesChat is declared only where the route does otherwise than its method says: a GET that keeps something of the chat, or a POST that keeps nothing of it.";
  if ("raw" in r) return typeof r.answers !== "string" || r.answers.trim() === "" || r.answers.includes("\n") ? "a raw route says what it answers in one line." : null;
  const params = new Set(paramsOf(r.path));
  for (const [name, f] of Object.entries(r.query ?? {})) {
    const of: unknown = isRecord(f) && f.kind === "field" ? f.of : f;
    if (!isShape(of) || !Object.hasOwn(QUERY_KINDS, of.kind)) return `its query's ${name} is text, a number, true or false, or one of a few words: a query string carries nothing else.`;
    if (params.has(name)) return `${name} is a param of its path, and its query names it again.`;
  }
  if (r.body !== undefined) {
    if (r.method === "GET" || r.method === "DELETE") return `a ${r.method} takes no body.`;
    if (!isShape(r.body)) return "it declares its body as a shape: a reader of its own is no declaration, and the server could not hold a request to it.";
    if (r.body.kind === "nothing") return "a route that takes no body leaves its body out.";
  }
  if (!isShape(r.reply)) return "it declares its reply as a shape.";
  if (r.long !== undefined && r.long !== true) return "long is true where the route may take longer than the relay's 30 seconds, and left out where it does not.";
  if (r.paged !== undefined) {
    if (r.method !== "GET") return "a route that pages is a GET.";
    if (r.query !== undefined && (Object.hasOwn(r.query, "limit") || Object.hasOwn(r.query, "cursor") || Object.hasOwn(r.query, "after"))) return "a route that pages takes limit and cursor already, and its handler is given after from the cursor: its query declares none of them.";
    if (r.reply.kind !== "object" || r.reply.page !== true) return "a route that pages answers a page (shape.page).";
  }
  return null;
}

/** Whether a shape holds a turn's id somewhere in it (`shape.turnId`). */
function holdsTurnId(s: AnyShape): boolean {
  switch (s.kind) {
    case "text":
      return s.turn !== undefined;
    case "list":
    case "record":
      return holdsTurnId(s.of);
    case "object":
      return Object.values(s.fields).some((f) => holdsTurnId(fieldOf(f).of));
    case "union":
      return s.of.some(holdsTurnId);
    default:
      return false;
  }
}

/** A path param named this holds a turn's id. */
export const TURN_PARAM = "turn";

/** Whether a route takes a turn's id: in its path (a param named `turn`), in its query, or in its body. */
function takesTurn(r: Declared): boolean {
  if (paramsOf(r.path).includes(TURN_PARAM)) return true;
  if ("raw" in r) return false;
  const query: Fields = r.query ?? {};
  return Object.values(query).some((f) => holdsTurnId(fieldOf(f).of)) || (r.body !== undefined && holdsTurnId(r.body));
}

/** A path that names a chat first (`/api/v1/chats/:chat/…`). */
const CHAT_PATH = /^\/api\/v1\/chats\/:chat(\/|$)/;
/** The params that name a record RPE keeps of a chat, which only a chat it holds has. */
const HELD_PARAMS: Readonly<Record<string, true>> = { [TURN_PARAM]: true, request: true, edit: true, approval: true, session: true, job: true };

/** What a route's method says of it: any but a GET keeps or changes something, unless its path names a record only a held chat has. */
function takesByMethod(r: Declared): boolean {
  return r.method !== "GET" && !paramsOf(r.path).some((p) => Object.hasOwn(HELD_PARAMS, p));
}

/**
 * Whether the server takes on the chat a route's path names before the route answers: its row and its folders made, by what
 * Lumiverse says of it (`ChatNamedHook`). Only a route that keeps or changes something of the chat does; one that only reads it
 * answers a chat RPE does not hold as an untouched chat reads, and makes nothing. One that names a turn, a request or another
 * record of the chat finds the chat held already, or answers that there is no such record. By the route's own `takesChat` where
 * it declares it (a GET that keeps something of the chat, a POST that keeps nothing of it), else by its method.
 */
export function takesChat(r: Declared): boolean {
  if (!CHAT_PATH.test(r.path)) return false;
  return r.takesChat ?? takesByMethod(r);
}

/** A route's declaration as the table lists it. */
function declarationOf(r: Route): RouteDeclaration {
  const turn = takesTurn(r);
  const joined = r.joined === true;
  if ("answers" in r) return { group: r.group, does: r.does, answers: r.answers, joined, turn };
  return { group: r.group, does: r.does, query: r.query ?? {}, body: r.body ?? null, reply: r.reply, paged: r.paged !== undefined, long: r.long === true, joined, turn };
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
      if (segments[0] !== "" || segments.length < 2 || !segments.slice(1).every((s, i) => LITERAL.test(s) || PARAM.test(s) || (s === "*" && i === segments.length - 2))) throw new Error(`${at}: a path is made of words and :params between slashes, with * last.`);
      const allowed = accessFor(r.path);
      if (allowed === null) throw new Error(`${at}: routes live under /v1/, /api/v1/ or /ui/.`);
      if (!allowed.includes(r.access)) throw new Error(`${at}: a route there is for ${allowed.join(" or ")}, not ${r.access}.`);
      if (r.maxBody !== undefined && (!Number.isInteger(r.maxBody) || r.maxBody < 0)) throw new Error(`${at}: maxBody is a whole number of bytes.`);
      const problem = declarationProblem(r);
      if (problem !== null) throw new Error(`${at}: ${problem}`);
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
    return this.placed.map(({ area, route: r }) => ({ area, method: r.method, path: r.path, access: r.access, maxBody: r.maxBody ?? null, raw: "raw" in r, params: paramsOf(r.path), declared: declarationOf(r), takesChat: takesChat(r) }));
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
