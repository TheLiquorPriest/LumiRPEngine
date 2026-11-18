// What every searchable tool is made of (plan §6.8). A write is one operation of today's engine (an
// item op, a GM edit, a pack's effect), run as `world_apply` runs its operations, as a call of one
// (`runOperations`): worked out on a copy of the state at the call's turn; what it cannot read
// refuses it before anything is recorded; the user's setting for its lane is asked by RPH's gate
// before the tool runs, since the tool names its lane, and never decided here; then it is recorded
// in one write through the queue and answered with what changed, how it now stands, and what did
// not add up. A read answers with the store's data. Every sentence of an answer is a line of the
// answers' file; a tool's own words are its file in `.tools/`.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { EntityId } from "../../shared/ids";
import type { FixOp } from "../../shared/ledger";
import type { ItemOp } from "../../shared/things";
import type { EffectSpec } from "../../shared/world";
import { resolveEdit } from "../../engine/edits";
import { applyEffects } from "../../engine/effects";
import type { Rejection } from "../../engine/registry";
import { hasLedger } from "../../packs/economy/core/model";
import { createRng } from "../../engine/rng";
import { applyItemOp } from "../../engine/thing-ops";
import type { Lane, StoreState } from "../../store/types";
import { readOperation, runOperations } from "../apply";
import { readingOr } from "../fixed";
import type { Call, Reply, ToolSpec } from "../kit";
import { find, isUnread, itemOptions, minorUnits, missed, missedData, named, type OpContext, severalText, tellUnread, type Unread } from "../ops";
import { openAuthored } from "../ops-values";
import type { Found, Reading, Want } from "../reading";
import { PROVENANCE_PROPERTIES } from "../source";
import { textOf } from "../texts";

/** A searchable tool that writes: everything but its words, and its work on the draft. */
export interface WriteDef {
  name: string;
  family: string;
  /** The lane all of its changes go to. */
  lane: Lane;
  /** Its own arguments; the three of provenance are added to every write that takes them. */
  properties: Record<string, JsonObject>;
  required: readonly string[];
  example: JsonObject;
  /** False for a write whose provenance is what it does, never what the call says (detail the world's tables fill in): it takes none. */
  provenance?: false;
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

/** A write as RPH holds it: its arguments with the three of provenance, run as a call of one operation. */
export function writeTool(def: WriteDef): ToolSpec {
  const op = { name: def.name, lane: def.lane, needs: def.required, takes: Object.keys(def.properties), example: def.example, run: def.run, ...(def.provenance === false ? { provenance: false as const } : {}) };
  return {
    name: def.name,
    family: def.family,
    tier: "write",
    lane: def.lane,
    properties: def.provenance === false ? def.properties : { ...def.properties, ...PROVENANCE_PROPERTIES },
    required: def.required,
    example: def.example,
    async run(args, call) {
      const read = readOperation(1, op, args, call);
      if ("line" in read) return call.reply().line(read.line, read.fields).line("nothing_recorded", {}).fail();
      // The tool names its lane, so RPH's gate has asked the player about this very call before it ran: asking here would ask twice.
      return runOperations(call, [read]);
    },
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
      if (missing.length > 0) return reply.line("needs", { n: 1, op: def.name, fields: missing }).fail();
      const r = readingOr(call, reply);
      if (r === null) return reply;
      const unread = def.read(r, args, reply, call);
      return unread ? tellUnread(reply, unread).fail() : reply;
    },
  };
}

// ---------------------------------------------------------------- today's engine, called

/** The refusals that mean what was asked is so already: applied as nothing, and said in the answer. */
const ALREADY: Readonly<Record<string, true>> = { no_change: true, not_worn: true, already_lost: true, missing_relation: true, gone: true, not_gone: true, already_inside: true, not_inside: true, already_member: true, not_member: true };

export function isAlready(code: string): boolean {
  return Object.hasOwn(ALREADY, code);
}

/** The refusal an operation could not get past, as the answer says it. */
export function notApplicable(o: OpContext, code: string): Unread {
  return { line: "not_applicable", fields: { n: o.n, op: o.op, code } };
}

/**
 * One of today's item ops on the draft (`engine/thing-ops`), recorded as the call's change and asked for its advice: where the
 * things model's rules would refuse or move a thing elsewhere, the op applies as asked and each finding is advice, said in the
 * answer and kept with the change. One that finds it so already changes nothing and says so; `bend` takes any other refusal the
 * tool applies all the same (it returns undefined when it has, and null when it cannot).
 */
export function itemChange(o: OpContext, op: Exclude<ItemOp, { do: "remove" }>, lane: Lane, what: EntityId, more: { bend?: (code: string) => Unread | null | undefined } = {}): Unread | undefined {
  const w = o.draft.w;
  const from = w.events.length;
  const out = applyItemOp(w, op, { ...itemOptions(o), advise: true });
  if ("code" in out) {
    o.draft.note(out);
    if (isAlready(out.code)) o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, what) });
    else {
      const bent = more.bend !== undefined ? more.bend(out.code) : null;
      if (bent !== undefined) return bent ?? notApplicable(o, out.code);
    }
  } else {
    // What the engine advises on the op (the op applied all the same) is said in the answer and kept with its change; what it filled in from the world is recorded apart, as a default.
    for (const advice of out.advice ?? []) o.draft.adviseOp(o.n, advice);
    if (out.filled !== undefined) o.draft.markFilled(out.filled);
  }
  o.draft.record(o.n, o.op, lane, o.prov, from);
  return undefined;
}

/**
 * Today's GM edit of one operation (`engine/edits` `resolveEdit`), applied on the draft: its rejection, or null. A correction of cash is
 * measured from what the world authored: the accounts it gave the holder open first, each a change of its own, established and from the
 * player (`openAuthored`), and the edit draws nothing from the tables to make up money; a holder the world gave none keeps the cash as given.
 */
export function editChange(o: OpContext, op: FixOp): Rejection | null {
  const cash = op.op === "set" && op.field === "cash" && typeof op.value === "number";
  if (cash) {
    const bad = openAuthored(o, [op.entity]);
    if (bad) return { code: typeof bad.fields.code === "string" ? bad.fields.code : "failed", reason: "" };
  }
  const out = resolveEdit(o.reading.registry, o.reading.doc, o.draft.w.state, [op], { gm: true, runSeed: o.draft.seed(o.n), by: o.call.agent.definition, confirmed: true, ...(cash ? { opened: true } : {}) });
  if ("rejection" in out) return o.draft.note(out.rejection);
  const failed = o.draft.applyAll(out.events);
  if (failed === null && cash && !hasLedger(o.draft.w.ctx, op.entity)) o.reply.report("no_accounts", { n: o.n, op: o.op, what: named(o.reading, op.entity) });
  return failed;
}

/** One of a pack's effects, run as the packs run it (`engine/effects`), on the draft: its rejection, or null (nothing of it is kept then). */
export function effectChange(o: OpContext, spec: EffectSpec): Rejection | null {
  const w = o.draft.w;
  const mark = w.lightMark();
  const out = applyEffects(o.reading.registry, w, [spec], { bindings: {}, rng: createRng(o.draft.seed(o.n)), literal: true });
  const refused = out.rejected[0]?.rejection ?? null;
  if (refused !== null) {
    w.restore(mark);
    o.draft.note(refused);
  }
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
  /** Each party the call names has the accounts the world gave them opened first, so the sums start from what the world gave (`openAuthored`). */
  opensMoney?: true;
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
      const unopened = def.opensMoney === true ? openAuthored(o, ids) : undefined;
      if (unopened) return unopened;
      const watched = def.watch?.(o, args);
      if (def.shows !== undefined) {
        const shows = def.shows;
        o.after((state) => shows(o, state, args));
      }
      const refused = effectChange(o, { type: def.effect, args });
      if (refused !== null) {
        if (isAlready(refused.code)) o.reply.line("already_so", { n: o.n, op: o.op, what: what !== undefined ? named(o.reading, what) : o.op });
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
  build(o: OpContext): { op: FixOp; what: EntityId; findings?: { code: string; values: Record<string, JsonValue> }[] } | Unread;
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
        o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, asked.what) });
      } else for (const found of asked.findings ?? []) o.reply.report(found.code, { n: o.n, op: o.op, ...found.values });
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

/** A name a read's argument gives, found as wanted; or the line that says it is not there or fits several. */
export function foundIn(r: Reading, field: string, said: JsonValue | undefined, want: Want): Found | Unread {
  if (typeof said !== "string" || said.trim() === "") return { line: "needs_field", fields: { field } };
  const f = r.find(said, want);
  if ("id" in f) return f;
  if (f.several.length > 0) return { line: "several", fields: { field, name: f.name, several: severalText(f.several) } };
  return { line: "unknown", fields: missed(r.lines, field, f, want), data: missedData(f) };
}

/** A value an answer's data carries as it was given, for a report's field. */
export function shownValue(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : JSON.stringify(v ?? null);
}
