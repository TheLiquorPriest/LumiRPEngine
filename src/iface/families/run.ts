// What every searchable tool is made of (plan §6.8). A write is one operation of today's engine (an
// item op, a GM edit, a pack's effect), worked out on a copy of the state at the call's turn; what it
// cannot read refuses it before anything is recorded; then the user's setting for its lane is asked
// through the contract's approvals, never decided here; then it is recorded in one write through the
// queue and answered as `world_apply` answers: what changed, how it now stands, what did not add
// up. A read answers with the store's data. Every sentence of an answer is a line of the answers'
// file; a tool's own words are its file in `.tools/`.

import type { ApprovalAsk, JsonObject, JsonValue } from "rp-harness/contract";
import type { DomainId, EntityId } from "../../shared/ids";
import type { FixOp } from "../../shared/ledger";
import type { ItemOp } from "../../shared/things";
import type { EffectSpec } from "../../shared/world";
import { resolveEdit } from "../../engine/edits";
import { applyEffects } from "../../engine/effects";
import { materializeIfNeeded } from "../../engine/materialize";
import type { Rejection } from "../../engine/registry";
import { createRng } from "../../engine/rng";
import { applyItemOp } from "../../engine/thing-ops";
import type { Lane, StoreState } from "../../store/types";
import { readingOr } from "../fixed";
import type { Call, Reply, ToolSpec } from "../kit";
import { find, isUnread, itemOptions, named, type OpContext, type Unread } from "../ops";
import type { Reading, Want } from "../reading";
import { MARKS, PROVENANCE_PROPERTIES, provenanceOf } from "../source";
import { answerDraft, commit, Draft } from "../writing";

/** A searchable tool that writes: everything but its words, and its work on the draft. */
export interface WriteDef {
  name: string;
  family: string;
  /** The lane all of its changes go to. */
  lane: Lane;
  /** Its own arguments; the three of provenance are added to every write. */
  properties: Record<string, JsonObject>;
  required: readonly string[];
  example: JsonObject;
  /** Works the call out on the draft and records it (`record`); what it could not read, when it could not. */
  run(o: OpContext): Unread | undefined;
}

/** A searchable tool that reads: its answer, from the state at the call's turn. */
export interface ReadDef {
  name: string;
  family: string;
  properties: Record<string, JsonObject>;
  required: readonly string[];
  example: JsonObject;
  /** Answers on `reply`; what it could not read, when it could not. */
  read(r: Reading, args: JsonObject, reply: Reply, call: Call): Unread | undefined;
}

/** The fields every line of a one-operation answer starts with. */
function opFields(name: string): { n: number; op: string } {
  return { n: 1, op: name };
}

/** The user's setting for the lane, asked; null when the write may go ahead. */
async function laneSays(call: Call, lane: Lane, args: JsonObject): Promise<"never" | { declined: string | undefined } | null> {
  const approvals = call.deps.approvals;
  if (approvals === undefined) return null;
  const permission = await approvals.permission(call.scope, lane);
  if (permission === "auto") return null;
  if (permission === "never") return "never";
  const ask: ApprovalAsk = { agent: call.agent, callId: call.callId, tool: call.tool, lane, args, at: (call.deps.now ?? Date.now)() };
  const said = await approvals.ask(call.scope, ask, call.signal);
  return said.go ? null : { declined: said.reason };
}

async function runWrite(def: WriteDef, args: JsonObject, call: Call): Promise<Reply> {
  const first = call.reply();
  const fields = opFields(def.name);
  const missing = def.required.filter((f) => args[f] === undefined || args[f] === null || args[f] === "");
  if (missing.length > 0) return first.line("needs", { ...fields, fields: missing }).line("nothing_recorded", {}).fail();
  const prov = provenanceOf(args, call.agent);
  if ("field" in prov) return first.line("unreadable_op", { ...fields, field: prov.field, value: JSON.stringify(prov.value), choices: [...prov.choices] }).line("nothing_recorded", {}).fail();
  const base = readingOr(call, first);
  if (base === null) return first;
  if (base.turn === null) return first.line("turn_needed", {}).fail();
  const draft = new Draft(base, call);
  const reply = call.reply();
  let added: ((state: StoreState) => JsonObject) | undefined;
  const unread = def.run({ ...fields, args, prov, draft, reply, call, reading: draft.reading(), after: (add) => (added = add) });
  if (unread) return reply.line(unread.line, unread.fields).line("nothing_recorded", {}).fail();
  const held = await laneSays(call, def.lane, args);
  if (held !== null) {
    const out = call.reply();
    if (held === "never") out.line("never", { ...fields, lane: def.lane });
    else out.line("declined", { ...fields, ...(held.declined !== undefined ? { reason: held.declined } : {}) });
    const none = new Draft(base, call);
    return answerDraft(none, await commit(none), out, { operations: [{ ...fields, lane: def.lane, applied: false, held: held === "never" ? "never" : "declined" }] });
  }
  for (const mark of prov.marks) reply.mark(mark);
  if (prov.marks.includes(MARKS.unsourced)) reply.line("unsourced", fields);
  if (prov.marks.includes(MARKS.noGapCheck)) reply.line("invented_unchecked", fields);
  if (prov.marks.includes(MARKS.noConsent)) reply.line("invented_unconsented", fields);
  const done = await commit(draft);
  return answerDraft(draft, done, reply, added !== undefined ? { added: new Map([[1, added(done.state)]]) } : {});
}

/** A write as RPH holds it: its arguments with the three of provenance. */
export function writeTool(def: WriteDef): ToolSpec {
  return {
    name: def.name,
    family: def.family,
    tier: "write",
    lane: def.lane,
    properties: { ...def.properties, ...PROVENANCE_PROPERTIES },
    required: def.required,
    example: def.example,
    run: (args, call) => runWrite(def, args, call),
  };
}

/** A read as RPH holds it. */
export function readTool(def: ReadDef): ToolSpec {
  return {
    name: def.name,
    family: def.family,
    tier: "read",
    properties: def.properties,
    required: def.required,
    example: def.example,
    async run(args, call) {
      const reply = call.reply();
      const missing = def.required.filter((f) => args[f] === undefined || args[f] === null || args[f] === "");
      if (missing.length > 0) return reply.line("needs", { ...opFields(def.name), fields: missing }).fail();
      const r = readingOr(call, reply);
      if (r === null) return reply;
      const unread = def.read(r, args, reply, call);
      return unread ? reply.line(unread.line, unread.fields).fail() : reply;
    },
  };
}

// ---------------------------------------------------------------- today's engine, called

/** The refusals that mean what was asked is so already: applied as nothing, and reported. */
const ALREADY: Readonly<Record<string, true>> = { no_change: true, not_worn: true, already_lost: true, missing_relation: true, gone: true, not_gone: true, already_inside: true, not_inside: true, already_member: true, not_member: true };

export function isAlready(code: string): boolean {
  return Object.hasOwn(ALREADY, code);
}

/** The refusal an operation could not get past, as the answer says it. */
export function notApplicable(o: OpContext, code: string): Unread {
  return { line: "not_applicable", fields: { n: o.n, op: o.op, code } };
}

/**
 * One of today's item ops on the draft (`engine/thing-ops`), recorded as the call's change. One that
 * finds it so already changes nothing and says so; one the size rules put elsewhere than `asked`
 * says where; `bend` takes any other refusal the tool applies all the same (it returns undefined
 * when it has, and null when it cannot).
 */
export function itemChange(o: OpContext, op: Exclude<ItemOp, { do: "remove" }>, lane: Lane, what: EntityId, more: { asked?: EntityId; bend?: (code: string) => Unread | null | undefined } = {}): Unread | undefined {
  const w = o.draft.w;
  const from = w.events.length;
  const out = applyItemOp(w, op, itemOptions(o));
  if ("code" in out) {
    if (isAlready(out.code)) o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, what) });
    else {
      const bent = more.bend !== undefined ? more.bend(out.code) : null;
      if (bent !== undefined) return bent ?? notApplicable(o, out.code);
    }
  } else if (out.placed !== undefined) {
    const at = "place" in out.placed ? out.placed.place : out.placed.in;
    o.reply.report("placed_instead", { n: o.n, op: o.op, what: named(o.reading, what), asked: named(o.reading, more.asked ?? what), where: named(o.reading, at) });
  }
  o.draft.record(o.n, o.op, lane, o.prov, from);
  return undefined;
}

/** Today's GM edit of one operation (`engine/edits` `resolveEdit`), applied on the draft: its rejection, or null. */
export function editChange(o: OpContext, op: FixOp): Rejection | null {
  const out = resolveEdit(o.reading.registry, o.reading.doc, o.draft.w.state, [op], { gm: true, runSeed: o.draft.seed(o.n), by: o.call.agent.definition, confirmed: true });
  if ("rejection" in out) return out.rejection;
  return o.draft.applyAll(out.events);
}

/** One of a pack's effects, run as the packs run it (`engine/effects`), on the draft: its rejection, or null (nothing of it is kept then). */
export function effectChange(o: OpContext, spec: EffectSpec): Rejection | null {
  const w = o.draft.w;
  const mark = w.lightMark();
  const out = applyEffects(o.reading.registry, w, [spec], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
  const refused = out.rejected[0]?.rejection ?? null;
  if (refused !== null) w.restore(mark);
  return refused;
}

/** How a tool's argument becomes an argument of the effect it runs. */
export interface EffectArg {
  /** The tool's argument. */
  field: string;
  /** The effect's argument, when it is named otherwise. */
  arg?: string;
  /** A name, found as this and given as its id. */
  want?: Want;
  /** An amount in the world's main coin, given in its smallest unit. */
  money?: true;
}

/** A searchable write that runs one of a pack's effects, as today's packs run it. */
export interface EffectDef {
  name: string;
  family: string;
  lane: Lane;
  effect: string;
  args: readonly EffectArg[];
  properties: Record<string, JsonObject>;
  required: readonly string[];
  example: JsonObject;
  /** A refusal of today's that the tool applies all the same: undefined once it has, null for one it cannot get past. */
  bend?(o: OpContext, code: string, args: Record<string, JsonValue>): Unread | null | undefined;
  /** Called before the effect runs; what it returns is called once the effect has applied, to report what did not add up. */
  watch?(o: OpContext, args: Record<string, JsonValue>): (() => void) | undefined;
  /** A domain whose detail each entity the call names is sampled in first, where the world has not yet, as today's purchases sample money. */
  materialize?: DomainId;
  /** What the answer shows besides the things it touched, from the state as recorded: a value a pack keeps apart from them (an account's status). */
  shows?(o: OpContext, state: StoreState, args: Record<string, JsonValue>): JsonObject;
}

export function effectTool(def: EffectDef): ToolSpec {
  return writeTool({
    name: def.name,
    family: def.family,
    lane: def.lane,
    properties: def.properties,
    required: def.required,
    example: def.example,
    run(o) {
      const args: Record<string, JsonValue> = {};
      let what: string | undefined;
      const ids: EntityId[] = [];
      for (const a of def.args) {
        const said = o.args[a.field];
        if (said === undefined || said === null || said === "") continue;
        if (a.want !== undefined) {
          const found = find(o, a.field, a.want);
          if (isUnread(found)) return found;
          args[a.arg ?? a.field] = found.id;
          what ??= found.id;
          ids.push(found.id);
        } else if (a.money === true) {
          if (typeof said !== "number" || !Number.isFinite(said)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: a.field, value: JSON.stringify(said) } };
          args[a.arg ?? a.field] = minorUnits(o.reading, said);
        } else args[a.arg ?? a.field] = said;
      }
      const from = o.draft.w.events.length;
      if (def.materialize !== undefined) for (const id of ids) materializeIfNeeded(o.reading.registry, o.draft.w, id, def.materialize, o.draft.seed(o.n));
      const watched = def.watch?.(o, args);
      if (def.shows !== undefined) {
        const shows = def.shows;
        o.after((state) => shows(o, state, args));
      }
      const refused = effectChange(o, { type: def.effect, args });
      if (refused !== null) {
        if (isAlready(refused.code)) o.reply.report("already_so", { n: o.n, op: o.op, what: what !== undefined ? named(o.reading, what) : o.op });
        else {
          const bent = def.bend !== undefined ? def.bend(o, refused.code, args) : null;
          if (bent !== undefined) return bent ?? notApplicable(o, refused.code);
        }
      } else watched?.();
      o.draft.record(o.n, o.op, def.lane, o.prov, from);
      return undefined;
    },
  });
}

/** A searchable write that is one of today's GM edits (`engine/edits`), as today's tool sends it. */
export interface EditDef {
  name: string;
  family: string;
  lane: Lane;
  properties: Record<string, JsonObject>;
  required: readonly string[];
  example: JsonObject;
  /** The edit the call asks for, with the id an answer names it by (`what`); or what could not be read. */
  build(o: OpContext): { op: FixOp; what: EntityId } | Unread;
  /** What the answer shows besides the things it touched, from the state as recorded: a value kept apart from them (tags). */
  shows?(o: OpContext, state: StoreState): JsonObject;
}

/** A GM edit as a tool: so already, it changes nothing and says so; any other refusal is the edit's own. */
export function editTool(def: EditDef): ToolSpec {
  return writeTool({
    name: def.name,
    family: def.family,
    lane: def.lane,
    properties: def.properties,
    required: def.required,
    example: def.example,
    run(o) {
      const asked = def.build(o);
      if (def.shows !== undefined) {
        const shows = def.shows;
        o.after((state) => shows(o, state));
      }
      if (isUnread(asked)) return asked;
      const from = o.draft.w.events.length;
      const refused = editChange(o, asked.op);
      if (refused !== null) {
        if (!isAlready(refused.code)) return notApplicable(o, refused.code);
        o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, asked.what) });
      }
      o.draft.record(o.n, o.op, def.lane, o.prov, from);
      return undefined;
    },
  });
}

/** A name argument that may be left out: its id, undefined when left out, or what could not be read. */
export function optionalId(o: OpContext, field: string, want: Want): string | Unread | undefined {
  const said = o.args[field];
  if (said === undefined || said === null || said === "") return undefined;
  const r = find(o, field, want);
  return isUnread(r) ? r : r.id;
}

/** An amount in the world's main coin in its smallest unit, as the economy counts money. */
export function minorUnits(reading: Reading, amount: number): number {
  return Math.round(amount * 10 ** reading.doc.currency.decimals);
}

/** A value an answer's data carries as it was given, for a report's field. */
export function shownValue(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : JSON.stringify(v ?? null);
}
