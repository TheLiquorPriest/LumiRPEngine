// `world_apply` (plan §6.8): a list of everyday operations applied in order, each with its lane and
// its provenance. The call is read whole first, on a copy of the state: anything it cannot read (a
// name that is not there, a value that is none of the choices) answers the whole call, and nothing
// is recorded. Then the user's setting for each lane is asked through the contract's approvals and
// never decided here: an operation whose lane is Never, or that the user declines, is left out, and
// the rest are worked out again without it. What is left is recorded in one write, and the answer
// says what changed, how it now stands, and what did not add up. A searchable tool that writes is
// run the same way, as a call of one operation (`readOperation`, `runOperations`); it names its
// lane, so RPH's gate asks the user's setting for it before it runs, and it is not asked again here.

import type { ApprovalAsk, JsonObject, JsonValue } from "rp-harness/contract";
import type { Rejection } from "../engine/registry";
import { isRecord } from "../shared/json";
import { prepareBases } from "../places/prepare";
import { type Lane, PRECISIONS, STANDINGS, type StoreState } from "../store/types";
import { type Call, NUMBER, OBJECT, oneOf, Reply, TEXT, TEXTS, type ToolSpec, WHOLE, YES_NO } from "./kit";
import { type OpContext, type OpDef, tellUnread, type Unread } from "./ops";
import { THING_OPS } from "./ops-things";
import { TIME_OPS } from "./ops-time";
import { VALUE_OPS } from "./ops-values";
import { readingOr, unreadable } from "./fixed";
import { nearestOf, type Reading } from "./reading";
import { MARKS, PROVENANCE_PROPERTIES, type Provenance, provenanceOf, SOURCE_KINDS } from "./source";
import { type Fields, textOf } from "./texts";
import { answerDraft, commit, Draft } from "./writing";

/** The everyday operations, in the order the plan names them. */
export const OPERATION_NAMES = ["move", "place", "give", "wear", "store", "pay", "pass_time", "set", "fact", "quest", "relate", "spawn", "horizon"] as const;

const BY_NAME: ReadonlyMap<string, OpDef> = new Map([...THING_OPS, ...TIME_OPS, ...VALUE_OPS].map((d) => [d.name, d]));

/** Every operation, in the plan's order. */
export const OPERATIONS: readonly OpDef[] = OPERATION_NAMES.map((name) => {
  const def = BY_NAME.get(name);
  if (def === undefined) throw new Error(`no operation ${name}`);
  return def;
});

/** The arguments an operation may carry, each once, whichever operations read it: the file says what each is. The operation's name, the lane, and a fact's precision, standing and source are choices. */
export const OPERATION_PROPERTIES: Record<string, JsonObject> = {
  op: oneOf(OPERATION_NAMES),
  who: TEXT,
  what: TEXT,
  to: TEXT,
  from: TEXT,
  at: TEXT,
  on: TEXT,
  by: TEXT,
  in: TEXT,
  with: TEXTS,
  how: TEXT,
  until: TEXT,
  off: YES_NO,
  slot: TEXT,
  away: YES_NO,
  driving: YES_NO,
  amount: NUMBER,
  for: TEXT,
  goods: TEXT,
  qty: WHOLE,
  reason: TEXT,
  method: TEXT,
  minutes: NUMBER,
  seconds: NUMBER,
  rounds: WHOLE,
  world_terms: YES_NO,
  about: TEXT,
  key: TEXT,
  value: {},
  replaces: TEXT,
  add: NUMBER,
  quest: TEXT,
  stage: TEXT,
  outcome: TEXT,
  reveal: YES_NO,
  axis: TEXT,
  change: NUMBER,
  list: TEXTS,
  name: TEXT,
  kind: TEXT,
  tier: TEXT,
  fields: OBJECT,
  bestiary: TEXT,
  type: TEXT,
  class: TEXT,
  owner: TEXT,
  description: TEXT,
  square: { type: "array", items: { type: "integer" } },
  near: TEXT,
  zone: TEXT,
  why: TEXT,
  lane: oneOf([...new Set(OPERATIONS.flatMap((d) => d.lanes ?? []))]),
  ...PROVENANCE_PROPERTIES,
  source: { anyOf: [...SOURCE_KINDS.map((from) => ({ const: from })), { type: "object", required: ["from"], properties: { from: oneOf(SOURCE_KINDS), lore: TEXT, message: TEXT, roll: TEXT, gap_check: TEXT, consent: TEXT } }] },
  precision: oneOf(PRECISIONS),
  standing: oneOf(STANDINGS),
};

/** What each kind of operation needs, as schema branches: kinds that need the same arguments share one (`place` and `store` both need `what`). */
function needed(): JsonObject[] {
  const by = new Map<string, string[]>();
  for (const d of OPERATIONS) if (d.needs.length > 0) by.set(d.needs.join(","), [...(by.get(d.needs.join(",")) ?? []), d.name]);
  return [...by].map(([needs, ops]): JsonObject => ({ if: { properties: { op: ops.length === 1 ? { const: ops[0] ?? "" } : { enum: ops } } }, then: { required: needs.split(",") } }));
}

/**
 * One operation of a call as the schema holds it: its name is one of the thirteen and, once it has one, what its kind needs is there, so
 * the check that runs before the tool does names the field and what it takes. An argument the operation does not read is not refused: the
 * answer says it.
 */
const OPERATION_ITEM: JsonObject = {
  type: "object",
  required: ["op"],
  properties: OPERATION_PROPERTIES,
  dependentSchemas: { op: { allOf: needed() } },
};

/** A scene set from nothing in one call (an island, a kitchen on it, two people there, a lamp): the operation reference shows it, which the tool's own words no longer do. */
export const SCENE_FROM_NOTHING: JsonObject = {
  operations: (
    [
      { op: "spawn", kind: "place", name: "Gull Skerry" },
      { op: "spawn", kind: "place", name: "Keeper's kitchen", at: "Gull Skerry" },
      { op: "spawn", kind: "person", name: "Ada Lorne", at: "Keeper's kitchen" },
      { op: "spawn", kind: "person", name: "Tobin Lorne", at: "Keeper's kitchen" },
      { op: "spawn", name: "Oil lamp", at: "Keeper's kitchen" },
    ] as JsonObject[]
  ).map((operation) => ({ ...operation, source: { from: "prose", message: "m-1" } })),
};

/** One operation a call asks for, read for its shape: its place in the call, what works it out, the lane it records in, its arguments and its provenance. */
export interface Asked {
  n: number;
  def: OpDef;
  lane: Lane;
  args: JsonObject;
  prov: Provenance;
}

/** One attempt at the call's operations on a copy of the state: the draft, or what one of them could not read. */
interface Attempt {
  reply: Reply;
  draft: Draft;
  afters: Map<number, (state: StoreState) => JsonObject>;
  unread?: Unread;
}

/**
 * What a refusal of the engine's says, given with its code: its reason, the list the value was one of (nearest first and no more than
 * the near matches when the call's words are known), and the operation that records what was meant whatever the story says (`fact`).
 */
function refusalFields(call: Call, r: Rejection): { fields: Fields; data: JsonObject } {
  const choices = r.choices === undefined ? [] : r.said === undefined ? [...r.choices] : nearestOf(r.said, r.choices, call.settings).slice(0, call.settings.nearMatches);
  return {
    fields: { reason: r.reason, choices: textOf(choices), ...(choices.length > 0 ? { records: "fact" } : {}) },
    data: { code: r.code, ...(choices.length > 0 ? { choices } : {}) },
  };
}

/** An operation that could not be read, as the call's answer gives it: the engine's own refusal with its reason and choices; a handler that threw as a fault. */
function unreadAs(call: Call, draft: Draft, unread: Unread): Unread {
  if (unread.line !== "not_applicable" || typeof unread.fields.code !== "string") return unread;
  if (unread.fields.code === "failed" && draft.fault !== null) return { line: "engine_fault", fields: { tool: call.tool, ...(unread.fields.n !== undefined ? { n: unread.fields.n } : {}), ...(unread.fields.op !== undefined ? { op: unread.fields.op } : {}) } };
  const refused = draft.refusedBy(unread.fields.code);
  if (refused === undefined) return unread;
  const said = refusalFields(call, refused);
  return { ...unread, fields: { ...unread.fields, ...said.fields }, data: { ...(unread.data ?? {}), ...said.data } };
}

/** Works the operations out in order on a fresh copy of the state, those in `skip` left out. */
function attempt(call: Call, base: Reading, asked: readonly Asked[], skip: ReadonlySet<number>): Attempt {
  const reply = call.reply();
  const draft = new Draft(base, call);
  draft.reply = reply;
  const afters = new Map<number, (state: StoreState) => JsonObject>();
  for (const a of asked) {
    if (skip.has(a.n)) continue;
    const later = asked.filter((x) => x.n > a.n).map((x) => x.args);
    const o: OpContext = { n: a.n, op: a.def.name, lane: a.lane, args: a.args, prov: a.prov, draft, reply, call, reading: draft.reading(), later, after: (add) => afters.set(a.n, add) };
    const unread = a.def.run(o);
    if (unread) return { reply, draft, afters, unread: unreadAs(call, draft, unread) };
  }
  draft.keepReports(reply);
  return { reply, draft, afters };
}

/** Why the player's setting or answer held an operation back: its lane is Never, or they said no (with their reason, when they gave one). */
type Held = "never" | { declined: string | undefined };

/** Asks the user's setting for each lane the operations write, and the user where a lane is Confirm, showing them what `askArgs` gives: which operations may not go ahead, and why. */
async function approved(call: Call, asked: readonly Asked[], askArgs: (mine: readonly Asked[]) => JsonObject): Promise<Map<number, Held>> {
  const out = new Map<number, Held>();
  const approvals = call.deps.approvals;
  if (approvals === undefined) return out;
  const lanes = [...new Set(asked.map((a) => a.lane))];
  for (const lane of lanes) {
    const mine = asked.filter((a) => a.lane === lane);
    const permission = await approvals.permission(call.scope, lane);
    if (permission === "auto") continue;
    if (permission === "never") {
      for (const a of mine) out.set(a.n, "never");
      continue;
    }
    const ask: ApprovalAsk = { agent: call.agent, callId: call.callId, tool: call.tool, lane, args: askArgs(mine), at: (call.deps.now ?? Date.now)() };
    const said = await approvals.ask(call.scope, ask, call.signal);
    if (!said.go) for (const a of mine) out.set(a.n, { declined: said.reason });
  }
  return out;
}

/** The provenance of an operation that takes none: nothing cited, nothing marked. */
const NO_PROVENANCE: Provenance = { source: null, precision: null, standing: null, marks: [] };

/** The lane an operation records in: the one the call names where the operation allows several, else its own; or what could not be read. */
function laneOf(n: number, def: OpDef, args: JsonObject): Lane | Unread {
  const named = args.lane;
  if (def.lanes === undefined || named === undefined || named === null) return def.lane;
  if (typeof named === "string" && def.lanes.includes(named as Lane)) return named as Lane;
  return { line: "unreadable_op", fields: { n, op: def.name, field: "lane", value: JSON.stringify(named), choices: textOf(def.lanes) } };
}

/** An operation read for its shape: what it needs is there and its provenance reads; or what is wrong with it. */
export function readOperation(n: number, def: OpDef, args: JsonObject, call: Call): Asked | Unread {
  const missing = def.needs.filter((f) => args[f] === undefined || args[f] === null || args[f] === "");
  if (missing.length > 0) return { line: "needs", fields: { n, op: def.name, fields: missing } };
  const lane = laneOf(n, def, args);
  if (typeof lane !== "string") return lane;
  const prov = def.provenance === false ? NO_PROVENANCE : provenanceOf(args, call.agent);
  if ("field" in prov) return { line: "unreadable_op", fields: { n, op: def.name, field: prov.field, value: JSON.stringify(prov.value), choices: textOf(prov.choices) } };
  return { n, def, lane, args, prov };
}

/** What a kind of operation needs and takes, and which of the arguments it was sent it does not read: said after anything about it that could not be read. */
function takesLine(reply: Reply, def: OpDef, args: JsonObject): void {
  const read = new Set(["op", ...def.needs, ...def.takes, ...(def.lanes !== undefined ? ["lane"] : []), ...(def.provenance === false ? [] : Object.keys(PROVENANCE_PROPERTIES))]);
  reply.line("op_takes", { op: def.name, needs: textOf(def.needs), takes: textOf(def.takes.filter((f) => !def.needs.includes(f))), ignored: textOf(Object.keys(args).filter((k) => !read.has(k))) });
}

/** The call's operations read for their shape: each a known operation with what it needs and readable provenance; or what is wrong with each that is not, with what that kind of operation takes. */
function readCall(args: JsonObject, call: Call, reply: Reply): Asked[] | null {
  const list = args.operations;
  if (!Array.isArray(list) || list.length === 0) {
    reply.line("no_operations", { ...(list !== undefined ? { value: JSON.stringify(list) } : {}), ops: textOf(OPERATION_NAMES) }).fail();
    return null;
  }
  const asked: Asked[] = [];
  let bad = false;
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    const op = isRecord(raw) ? raw.op : undefined;
    const def = typeof op === "string" ? BY_NAME.get(op) : undefined;
    if (!isRecord(raw) || def === undefined) {
      reply.line("unreadable_op", { n, field: "op", value: JSON.stringify(op ?? null), choices: textOf(OPERATION_NAMES) });
      bad = true;
      continue;
    }
    const read = readOperation(n, def, raw as JsonObject, call);
    if ("line" in read) {
      reply.line(read.line, read.fields);
      takesLine(reply, def, raw as JsonObject);
      bad = true;
      continue;
    }
    asked.push(read);
  }
  if (bad) {
    reply.line("nothing_recorded", {}).fail();
    return null;
  }
  return asked;
}

/** The marks and lines an operation's provenance carries into the answer. */
function provenanceLines(reply: Reply, a: Asked): void {
  for (const mark of a.prov.marks) reply.mark(mark);
  const fields = { n: a.n, op: a.def.name };
  if (a.prov.marks.includes(MARKS.unsourced)) reply.line("unsourced", fields);
  if (a.prov.marks.includes(MARKS.noGapCheck)) reply.line("invented_unchecked", fields);
  if (a.prov.marks.includes(MARKS.noConsent)) reply.line("invented_unconsented", fields);
}

/**
 * A call refused: only what could not be read, and what `explain` adds; what the operations before it reported never stands, since
 * nothing is recorded. What the refusal carries as data (the choices a value was one of, the near names a name was drawn from) is
 * given whole beside its words. A handler of the engine's that threw is a fault, said so and kept in the call's details, never the
 * agent's call refused.
 */
function refusal(call: Call, run: Attempt, explain?: (reply: Reply, unread: Unread) => void): Reply {
  const unread = run.unread as Unread;
  const refused = tellUnread(call.reply(), unread);
  if (unread.line === "engine_fault" && run.draft.fault !== null) {
    const { error } = run.draft.fault;
    refused.details = { fault: { tool: call.tool, error: error instanceof Error ? error.message : String(error) } };
  } else explain?.(refused, unread);
  return refused.line("nothing_recorded", {}).fail();
}

/** Says why an operation the player held back was not applied; its entry for the answer's data. */
function heldBack(reply: Reply, a: Asked, why: Held): JsonObject {
  const lane = a.lane;
  if (why === "never") reply.line("never", { n: a.n, op: a.def.name, lane });
  else reply.line("declined", { n: a.n, op: a.def.name, ...(why.declined !== undefined ? { reason: why.declined } : {}) });
  return { n: a.n, op: a.def.name, lane, applied: false, held: why === "never" ? "never" : "declined" };
}

/**
 * A call refused because a later operation needs what one the player held back would have done:
 * what could not be read, each held operation with why it was held, and that the call cannot go
 * ahead as it is (sent again, it would be held again). Nothing is recorded.
 */
function heldRefusal(call: Call, unread: Unread, asked: readonly Asked[], held: ReadonlyMap<number, Held>): Reply {
  const refused = call.reply().line(unread.line, unread.fields);
  for (const a of asked) {
    const why = held.get(a.n);
    if (why !== undefined) heldBack(refused, a, why);
  }
  return refused.line("needs_held", { n: unread.fields.n ?? null, op: unread.fields.op ?? null }).fail();
}

/**
 * Runs a call's operations, read for their shape: worked out in order on a copy of the state (one
 * that cannot read its names refuses the whole call, and nothing is recorded; `explain` adds to what
 * the refusal says); each lane's setting asked, an approval showing what `askArgs` gives (none for a
 * tool that names its lane: RPH's gate asked by it before the tool ran, and the player is asked
 * once); then what may go ahead worked out again inside its write, on the state as it stands when
 * the write runs, and recorded there; and answered with what changed, how it now stands, and the
 * reports.
 */
export async function runOperations(call: Call, asked: readonly Asked[], askArgs?: (mine: readonly Asked[]) => JsonObject, explain?: (reply: Reply, unread: Unread) => void): Promise<Reply> {
  const first = call.reply();
  const base = readingOr(call, first);
  if (base === null) return first;
  if (base.turn === null) return first.line("turn_needed", {}).fail();
  // (S17Story, places) The entries bound to a place a call writes a base of, as Lumiverse holds them now: what the base is drawn against.
  await prepareBases(call, asked);
  // Read first on the state as it stands, so the player is asked nothing about a call that cannot be read.
  const tried = attempt(call, base, asked, new Set());
  if (tried.unread) return refusal(call, tried, explain);
  const held = askArgs === undefined ? new Map<number, Held>() : await approved(call, asked, askArgs);
  const skip = new Set(held.keys());
  // Another call of the turn may be recorded while the player is asked, or at the same moment: the call is worked out again on what it left.
  const worked = await commit<{ run: Attempt; needsHeld: boolean } | Reply>(call, () => {
    const missing = call.reply();
    const now = readingOr(call, missing);
    if (now === null) return { out: missing, draft: null };
    const run = attempt(call, now, asked, skip);
    // If the whole call reads on this same state, what could not be read is what the player held back.
    const needsHeld = run.unread !== undefined && skip.size > 0 && attempt(call, now, asked, new Set()).unread === undefined;
    return { out: { run, needsHeld }, draft: run.unread ? null : run.draft };
  });
  if (worked.gone) return unreadable(call, worked.gone);
  if (worked.out instanceof Reply) return worked.out;
  const { run, needsHeld } = worked.out;
  if (run.unread) return needsHeld ? heldRefusal(call, run.unread, asked, held) : refusal(call, run, explain);
  const done = worked.done;
  if (done === null) throw new Error("a call worked out in full is recorded");
  const reply = run.reply;
  const left: JsonObject[] = [];
  for (const a of asked) {
    const why = held.get(a.n);
    if (why === undefined) provenanceLines(reply, a);
    else left.push(heldBack(reply, a, why));
  }
  const added = new Map<number, JsonObject>();
  for (const [n, add] of run.afters) added.set(n, add(done.state));
  return answerDraft(run.draft, done, reply, { operations: left, added });
}

async function applyOperations(args: JsonObject, call: Call): Promise<Reply> {
  const first = call.reply();
  const asked = readCall(args, call, first);
  if (asked === null) return first;
  // A name not there may be made by an operation earlier in this same call; and the operation that could not read it takes what it takes.
  const explain = (reply: Reply, unread: Unread): void => {
    if (unread.want !== undefined) reply.line(`make_${unread.want}`, {});
    const a = asked.find((x) => x.n === unread.fields.n);
    if (a) takesLine(reply, a.def, a.args);
  };
  return runOperations(call, asked, (mine) => ({ operations: mine.map((a) => a.args) as JsonValue[] }), explain);
}

export const WORLD_APPLY: ToolSpec = {
  name: "world_apply",
  family: "state",
  tier: "write",
  // The schema holds what the check before the tool can fail on: the list, each operation's name and what its kind needs, and the choices of precision, standing and source. An argument an operation does not read is said in the answer, never refused.
  properties: { operations: { type: "array", minItems: 1, items: OPERATION_ITEM } },
  required: ["operations"],
  example: { operations: [OPERATIONS[2]?.example ?? {}, OPERATIONS[5]?.example ?? {}] },
  run: applyOperations,
};
