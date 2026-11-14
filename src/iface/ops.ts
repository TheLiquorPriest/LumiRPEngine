// What every operation of `world_apply` shares: its context, the names it reads, and the shape of
// what it could not read. An operation reads its names on the draft as it stands, so a later
// operation finds what an earlier one made. What it cannot read (a name that is not there, a value
// that is not one of the choices) stops the whole call before anything is recorded; anything else
// is applied, and what does not add up is reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Lane, StoreState } from "../store/types";
import type { ItemOpOptions } from "../engine/thing-ops";
import type { Call, Reply } from "./kit";
import { type Found, isFound, type Reading, type Want } from "./reading";
import type { Fields } from "./texts";
import type { Draft } from "./writing";
import type { Provenance } from "./source";

/** What an operation is given to do its work. */
export interface OpContext {
  /** Its place in the call's list, from 1. */
  n: number;
  op: string;
  args: JsonObject;
  prov: Provenance;
  draft: Draft;
  reply: Reply;
  call: Call;
  /** The draft as it stands when the operation starts. */
  reading: Reading;
  /** Adds to the operation's entry in the answer, from the state as recorded (what a span of time brings due). */
  after(add: (state: StoreState) => JsonObject): void;
}

/** What an operation could not read: the line of the answers' file that says so, and its fields. */
export interface Unread {
  line: string;
  fields: Fields;
}

/** One everyday operation (plan §6.8): its name, the lane it writes, the arguments it needs, and its work. */
export interface OpDef {
  name: string;
  lane: Lane;
  /** The arguments it cannot do without, besides `op`. */
  needs: readonly string[];
  /** The arguments it reads, besides `op` and the three of provenance. */
  takes: readonly string[];
  /** A worked example, for the operation reference. */
  example: JsonObject;
  /** Works the operation out on the draft and records it; what it could not read, when it could not. */
  run(o: OpContext): Unread | undefined;
}

/** Whether an operation's work could not read its arguments. */
export function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "line" in v && "fields" in v;
}

/** The text of an argument, when it is given as text and is not empty. */
export function textArg(args: JsonObject, field: string): string | undefined {
  const v = args[field];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** A number argument, when it is given as a finite number. */
export function numberArg(args: JsonObject, field: string): number | undefined {
  const v = args[field];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** What an argument that is not one of the choices reads as. */
export function notOneOf(o: OpContext, field: string, value: JsonValue, choices: readonly string[]): Unread {
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field, value: JSON.stringify(value), choices: [...choices] } };
}

/** The name an argument gives (or `said`, one item of a list argument), found as wanted on the draft; or what says it is not there (with the near matches) or fits several. */
export function find(o: OpContext, field: string, want: Want, gone = false, said: JsonValue | undefined = o.args[field]): Found | Unread {
  if (typeof said !== "string" || said.trim() === "") return { line: "needs", fields: { n: o.n, op: o.op, fields: [field] } };
  const r = o.reading.find(said, want, gone);
  if (isFound(r)) return r;
  if (r.several.length > 0) return { line: "several", fields: { n: o.n, op: o.op, field, name: r.name, several: r.several.map((x) => `${x.name} [${x.id}]`) } };
  return { line: "unknown", fields: { n: o.n, op: o.op, field, name: r.name, wanted: want, near: r.near.map((x) => `${x.name} [${x.id}]`) } };
}

/** A name argument that may be left out: undefined when it is. */
export function findOptional(o: OpContext, field: string, want: Want): Found | Unread | undefined {
  return o.args[field] === undefined || o.args[field] === null ? undefined : find(o, field, want);
}

/** How the engine's item ops run for an agent's write: the agent's, confirmed, with the say of the GM's edits, made things drawn from the call. */
export function itemOptions(o: OpContext): ItemOpOptions {
  return { by: o.call.agent.definition, confirmed: true, gm: true, salt: o.draft.seed(o.n) };
}

/** A name for an answer's fields: the thing's name with its id. */
export function named(reading: Reading, id: string): string {
  return `${reading.nameOf(id)} [${id}]`;
}
