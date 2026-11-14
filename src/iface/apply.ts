// `world_apply` (plan §6.8): a list of everyday operations applied in order, each with its lane and
// its provenance. The call is read whole first, on a copy of the state: anything it cannot read (a
// name that is not there, a value that is none of the choices) answers the whole call, and nothing
// is recorded. Then the user's setting for each lane is asked through the contract's approvals and
// never decided here: an operation whose lane is Never, or that the user declines, is left out, and
// the rest are worked out again without it. What is left is recorded in one write, and the answer
// says what changed, how it now stands, and what did not add up.

import type { ApprovalAsk, JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import type { Lane, StoreState } from "../store/types";
import { type Call, NUMBER, OBJECT, oneOf, type Reply, TEXT, TEXTS, type ToolSpec, WHOLE, YES_NO } from "./kit";
import type { OpContext, OpDef, Unread } from "./ops";
import { HOW_GIVEN, THING_OPS } from "./ops-things";
import { TIME_OPS } from "./ops-time";
import { VALUE_OPS } from "./ops-values";
import { readingOr } from "./fixed";
import type { Reading } from "./reading";
import { MARKS, PROVENANCE_PROPERTIES, type Provenance, provenanceOf } from "./source";
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

/** The arguments an operation may carry, each once, whichever operations read it: the file says what each is. */
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
  how: oneOf(Object.keys(HOW_GIVEN)),
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
  about: TEXT,
  key: TEXT,
  value: {},
  add: NUMBER,
  quest: TEXT,
  stage: TEXT,
  outcome: oneOf(["met", "failed"]),
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
  square: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 2, maxItems: 2 },
  near: TEXT,
  zone: TEXT,
  why: TEXT,
  ...PROVENANCE_PROPERTIES,
};

interface Asked {
  n: number;
  def: OpDef;
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

/** Works the operations out in order on a fresh copy of the state, those in `skip` left out. */
function attempt(call: Call, base: Reading, asked: readonly Asked[], skip: ReadonlySet<number>): Attempt {
  const reply = call.reply();
  const draft = new Draft(base, call);
  const afters = new Map<number, (state: StoreState) => JsonObject>();
  for (const a of asked) {
    if (skip.has(a.n)) continue;
    const o: OpContext = { n: a.n, op: a.def.name, args: a.args, prov: a.prov, draft, reply, call, reading: draft.reading(), after: (add) => afters.set(a.n, add) };
    const unread = a.def.run(o);
    if (unread) return { reply, draft, afters, unread };
  }
  return { reply, draft, afters };
}

/** Asks the user's setting for each lane the operations write, and the user where a lane is Confirm: which operations may not go ahead, and why. */
async function approved(call: Call, asked: readonly Asked[]): Promise<Map<number, "never" | { declined: string | undefined }>> {
  const out = new Map<number, "never" | { declined: string | undefined }>();
  const approvals = call.deps.approvals;
  if (approvals === undefined) return out;
  const lanes = [...new Set(asked.map((a) => a.def.lane))];
  for (const lane of lanes) {
    const mine = asked.filter((a) => a.def.lane === lane);
    const permission = await approvals.permission(call.scope, lane);
    if (permission === "auto") continue;
    if (permission === "never") {
      for (const a of mine) out.set(a.n, "never");
      continue;
    }
    const ask: ApprovalAsk = { agent: call.agent, callId: call.callId, tool: call.tool, lane, args: { operations: mine.map((a) => a.args) as JsonValue[] }, at: (call.deps.now ?? Date.now)() };
    const said = await approvals.ask(call.scope, ask, call.signal);
    if (!said.go) for (const a of mine) out.set(a.n, { declined: said.reason });
  }
  return out;
}

/** The call's operations read for their shape: each a known operation with what it needs and readable provenance; or what is wrong with each that is not. */
function readCall(args: JsonObject, call: Call, reply: Reply): Asked[] | null {
  const list = args.operations;
  if (!Array.isArray(list) || list.length === 0) {
    reply.line("unreadable", { field: "operations", value: JSON.stringify(list ?? null), choices: ["a list of operations"] }).fail();
    return null;
  }
  const asked: Asked[] = [];
  let bad = false;
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    const op = isRecord(raw) ? raw.op : undefined;
    const def = typeof op === "string" ? BY_NAME.get(op) : undefined;
    if (!isRecord(raw) || def === undefined) {
      reply.line("unreadable_op", { n, field: "op", value: JSON.stringify(op ?? null), choices: [...OPERATION_NAMES] });
      bad = true;
      continue;
    }
    const missing = def.needs.filter((f) => raw[f] === undefined || raw[f] === null || raw[f] === "");
    if (missing.length > 0) {
      reply.line("needs", { n, op: def.name, fields: missing });
      bad = true;
      continue;
    }
    const prov = provenanceOf(raw as JsonObject, call.agent);
    if ("field" in prov) {
      reply.line("unreadable_op", { n, op: def.name, field: prov.field, value: JSON.stringify(prov.value), choices: [...prov.choices] });
      bad = true;
      continue;
    }
    asked.push({ n, def, args: raw as JsonObject, prov });
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

async function applyOperations(args: JsonObject, call: Call): Promise<Reply> {
  const first = call.reply();
  const asked = readCall(args, call, first);
  if (asked === null) return first;
  const base = readingOr(call, first);
  if (base === null) return first;
  if (base.turn === null) return first.line("turn_needed", {}).fail();
  const refuse = (a: Attempt): Reply => {
    a.reply.line((a.unread as Unread).line, (a.unread as Unread).fields).line("nothing_recorded", {});
    return a.reply.fail();
  };
  let run = attempt(call, base, asked, new Set());
  if (run.unread) return refuse(run);
  const held = await approved(call, asked);
  if (held.size > 0) {
    run = attempt(call, base, asked, new Set(held.keys()));
    if (run.unread) return refuse(run);
  }
  const reply = run.reply;
  const left: JsonObject[] = [];
  for (const a of asked) {
    const why = held.get(a.n);
    if (why === undefined) {
      provenanceLines(reply, a);
      continue;
    }
    const lane: Lane = a.def.lane;
    if (why === "never") reply.line("never", { n: a.n, op: a.def.name, lane });
    else reply.line("declined", { n: a.n, op: a.def.name, ...(why.declined !== undefined ? { reason: why.declined } : {}) });
    left.push({ n: a.n, op: a.def.name, lane, applied: false, held: why === "never" ? "never" : "declined" });
  }
  const done = await commit(run.draft);
  const added = new Map<number, JsonObject>();
  for (const [n, add] of run.afters) added.set(n, add(done.state));
  return answerDraft(run.draft, done, reply, { operations: left, added });
}

export const WORLD_APPLY: ToolSpec = {
  name: "world_apply",
  family: "state",
  tier: "write",
  properties: { operations: { type: "array", items: { type: "object", properties: OPERATION_PROPERTIES, required: ["op"] }, minItems: 1 } },
  required: ["operations"],
  example: { operations: [OPERATIONS[2]?.example ?? {}, OPERATIONS[5]?.example ?? {}] },
  run: applyOperations,
};
