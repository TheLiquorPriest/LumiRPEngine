// What every operation of `world_apply` shares: its context, the names it reads, and the shape of
// what it could not read. An operation reads its names on the draft as it stands, so a later
// operation finds what an earlier one made. What it cannot read (a name that is not there, a value
// that is not one of the choices) stops the whole call before anything is recorded; anything else
// is applied, and what does not add up is reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Lane, StoreState } from "../store/types";
import type { ItemOpOptions } from "../engine/thing-ops";
import type { Rejection } from "../engine/registry";
import type { Call, Reply } from "./kit";
import { type Found, isFound, type Missed, nearestOf, type Reading, type Want } from "./reading";
import { type Fields, type Lines, textOf } from "./texts";
import type { Draft } from "./writing";
import type { Provenance } from "./source";

/** What an operation is given to do its work. */
export interface OpContext {
  /** Its place in the call's list, from 1. */
  n: number;
  op: string;
  /** The lane this call records the operation in: the one the call names when the operation allows several, else the operation's own. */
  lane: Lane;
  args: JsonObject;
  prov: Provenance;
  draft: Draft;
  reply: Reply;
  call: Call;
  /** The draft as it stands when the operation starts, read again once it has made a thing it names. */
  reading: Reading;
  /** The operations after it in the call, as sent: a name one of them spawns is theirs to make. */
  later: readonly JsonObject[];
  /** Adds to the operation's entry in the answer, from the state as recorded (what a span of time brings due). */
  after(add: (state: StoreState) => JsonObject): void;
}

/**
 * What an operation could not read: the line of the answers' file that says so, and its fields; for a name not found, what it
 * was wanted as. `data` is what a refusal carries beside its words, as data: the `choices` a value was one of, or the `near`
 * names its candidates were drawn from, so an answer gives them whole (`rejected`).
 */
export interface Unread {
  line: string;
  fields: Fields;
  want?: Want;
  data?: JsonObject;
}

/** One everyday operation (plan §6.8): its name, the lane it writes, the arguments it needs, and its work. */
export interface OpDef {
  name: string;
  lane: Lane;
  /** The arguments it cannot do without, besides `op`. */
  needs: readonly string[];
  /** The arguments it reads, besides `op` and the three of provenance. */
  takes: readonly string[];
  /** False for the Author's own note that changes nothing in the world: it takes no provenance, so it is neither sourced nor unsourced. */
  provenance?: false;
  /** The lanes the call may name for this operation (its `lane` argument); absent, it records in `lane` alone. */
  lanes?: readonly Lane[];
  /** A worked example, for the operation reference. */
  example: JsonObject;
  /** Works the operation out on the draft and records it; what it could not read, when it could not. */
  run(o: OpContext): Unread | undefined;
  /**
   * What it says more, after what it takes, when the call could not be read on its account: `n` its place in the call, `args` as sent,
   * `reading` the state it was worked out on (`act`: what the action it names takes, with a value of each).
   */
  explain?(reply: Reply, n: number, args: JsonObject, reading: Reading): void;
}

/** Whether an operation's work could not read its arguments. */
export function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "line" in v && "fields" in v;
}

/**
 * An operation's refusal on a reply: its line, and what it carries as data (`data`: the choices a value was one of, or the near names
 * a name was drawn from), kept in the answer's details (`Reply.refusedWith`) beside the sentence.
 */
export function tellUnread(reply: Reply, unread: Unread): Reply {
  reply.line(unread.line, unread.fields);
  if (unread.data !== undefined) {
    const { n, op } = unread.fields;
    reply.refusedWith({ ...(typeof n === "number" ? { n } : {}), ...(typeof op === "string" ? { op } : {}), ...unread.data });
  }
  return reply;
}

/** The text of an argument, when it is given as text and is not empty. */
export function textArg(args: JsonObject, field: string): string | undefined {
  const v = args[field];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** A number argument, when it is given as a finite number or as text that is one ("40"); none when it is given as anything else. */
export function numberArg(args: JsonObject, field: string): number | undefined {
  const v = args[field];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** What an argument that is not one of the choices reads as: the whole list, put in as one text so the answer says it once. */
export function notOneOf(o: OpContext, field: string, value: JsonValue, choices: readonly string[]): Unread {
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field, value: JSON.stringify(value), choices: textOf(choices) } };
}

/**
 * A value the story gave that is outside a list fixed in code (a tier, a tax status, a life state, a relation type): refused only
 * because the typed field cannot hold it. The answer gives the list, nearest the value first, and names the operation that
 * records what was meant whatever the story says (`fact`), so no story value is left with no way to be recorded (D-169).
 */
export function outsideList(o: OpContext, field: string, value: JsonValue, choices: readonly string[]): Unread {
  const ranked = typeof value === "string" ? nearestOf(value, choices, o.call.settings) : [...choices];
  return { line: "outside_list", fields: { n: o.n, op: o.op, field, value: JSON.stringify(value), choices: textOf(ranked), records: "fact" }, data: { field, choices: ranked } };
}

/** What an argument that is not of the shape it takes reads as: the shape in the answers' words, its `wants_<shape>` line. */
export function notAs(o: OpContext, field: string, value: JsonValue, shape: string): Unread {
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field, value: JSON.stringify(value), wants: o.call.lines.line(`wants_${shape}`) ?? "" } };
}

/**
 * A name not found, as an answer's fields give it: what was wanted (`wanted`, the code's own name
 * for it, and `sought`, the answers' `want_<wanted>` line), the near names of that kind, and those
 * of another kind that go by that very name; each list put in as one text, so it is said once. With
 * nothing of that kind recorded at all (`empty`), `nothing` is the answers' `nothing_of_kind` line:
 * the near list is never empty while anything of the kind exists (R-74).
 */
export function unknownFields(lines: Lines, field: string, wanted: string, name: string, near: readonly string[], other: readonly string[] = [], empty = false): Fields {
  const sought = lines.line(`want_${wanted}`) ?? "";
  return { field, name, wanted, sought, near: textOf(near), other: textOf(other), nothing: empty ? (lines.line("nothing_of_kind", { sought }) ?? "") : "" };
}

/** A name that was not found as wanted, as `unknownFields` gives it: each near or other one by its name and id, the other with what it is. */
export function missed(lines: Lines, field: string, r: Missed, want: Want): Fields {
  return unknownFields(lines, field, want, r.name, r.near.map((x) => `${x.name} [${x.id}]`), r.other.map((x) => `${x.name} [${x.id}] (${x.what})`), r.empty === true);
}

/** What a name not found carries as data: the near matches, each by its id, name and what it is. */
export function missedData(r: Missed): JsonObject {
  return { near: r.near.map((x) => ({ id: x.id, name: x.name, what: x.what })) };
}

/** The name an argument gives (or `said`, one item of a list argument), found as wanted on the draft; or what says it is not there (with the near matches) or fits several. */
export function find(o: OpContext, field: string, want: Want, gone = false, said: JsonValue | undefined = o.args[field]): Found | Unread {
  if (typeof said !== "string" || said.trim() === "") return { line: "needs", fields: { n: o.n, op: o.op, fields: [field] } };
  const r = o.reading.find(said, want, gone);
  if (isFound(r)) return r;
  if (r.several.length > 0) return { line: "several", fields: { n: o.n, op: o.op, field, name: r.name, several: textOf(r.several.map((x) => `${x.name} [${x.id}]`)) } };
  const later = typeof said === "string" ? o.later.findIndex((a) => a.op === "spawn" && typeof a.name === "string" && a.name.trim().toLowerCase() === said.trim().toLowerCase()) : -1;
  if (later >= 0) return { line: "not_yet", fields: { n: o.n, op: o.op, ...missed(o.call.lines, field, r, want), later: o.n + 1 + later }, want, data: missedData(r) };
  return { line: "unknown", fields: { n: o.n, op: o.op, ...missed(o.call.lines, field, r, want) }, want, data: missedData(r) };
}

/** A name argument that may be left out: undefined when it is. */
export function findOptional(o: OpContext, field: string, want: Want): Found | Unread | undefined {
  return o.args[field] === undefined || o.args[field] === null ? undefined : find(o, field, want);
}

/** What an engine refusal names that is not there (an id gone between reading and applying): answered as not there, with the near ones of that kind. */
const NOT_THERE: Readonly<Record<string, true>> = { missing_entity: true, missing_place: true, gone: true };

/**
 * An engine refusal as the answer to an operation: what names an id that is not there is answered as not there, with the near ones of
 * `want` (the words the call gave for it, else the engine's); any other as the engine's own refusal, kept so the answer gives its reason
 * and its list of choices.
 */
export function refusedAs(o: OpContext, out: Rejection, field: string, want: Want): Unread {
  o.draft.note(out);
  if (NOT_THERE[out.code]) {
    const missing = find(o, field, want, false, out.said ?? o.args[field]);
    if (isUnread(missing) && missing.line === "unknown") return missing;
  }
  return { line: "not_applicable", fields: { n: o.n, op: o.op, code: out.code } };
}

/** How the engine's item ops run for an agent's write: the agent's, confirmed, with the say of the GM's edits, made things drawn from the call. */
export function itemOptions(o: OpContext): ItemOpOptions {
  return { by: o.call.agent.definition, confirmed: true, gm: true, salt: o.draft.seed(o.n) };
}

/** An amount in the world's main coin (12.5 is twelve and a half) in its smallest unit, as the economy counts money. */
export function minorUnits(reading: Reading, amount: number): number {
  return Math.round(amount * 10 ** reading.doc.currency.decimals);
}

/** A name for an answer's fields: the thing's name with its id. */
export function named(reading: Reading, id: string): string {
  return `${reading.nameOf(id)} [${id}]`;
}
