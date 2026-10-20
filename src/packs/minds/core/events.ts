// The minds pack's events (DESIGN §24): every model answer and every GM control is one, so a fold,
// a Re-narrate and the background lane never call a model. Each apply reads only its own data, the
// minds slice and the clock, never an entity's fields, so a coarsened skip record (L21) folds alike.
// Player lines: none. A mind is private, so every describer words nothing for a viewer and the
// Journal never shows one; the GM's and the author's lines name what changed, never a monologue.

import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import type { CommitmentStatus, Fidelity, MindCommitment, MindNote, MindPlan, MindRecord, MindsCharacter, PlanStatus, WitnessEntry } from "../../../shared/minds";
import { COMMITMENT_KINDS, COMMITMENT_STATUSES, FIDELITIES, MINDS_EVENTS, MINDS_KEEP, PLAN_KINDS, PLAN_PRIORITY } from "../../../shared/minds";
import { own } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import { addWitness, putCommitment, putNote, putPlan, readCharacter, readSlice, writeCharacter, writeSlice } from "./state";

const str = (v: JsonValue | undefined): v is string => typeof v === "string";
const finite = (v: JsonValue | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const ids = (v: JsonValue | undefined): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const texts = ids;

function bad(reason: string): Rejection {
  return { code: "bad_event", reason };
}

export function isFidelity(v: JsonValue | undefined): v is Fidelity {
  return typeof v === "string" && (FIDELITIES as readonly string[]).includes(v);
}

export function isPlan(v: JsonValue | undefined): v is MindPlan & JsonObject {
  if (!isRecord(v) || !isRecord(v.when)) return false;
  return (
    str(v.id) &&
    v.id !== "" &&
    str(v.what) &&
    typeof v.kind === "string" &&
    (PLAN_KINDS as readonly string[]).includes(v.kind) &&
    finite(v.when.from) &&
    finite(v.when.to) &&
    v.when.to >= v.when.from &&
    (v.where === null || str(v.where)) &&
    ids(v.with) &&
    finite(v.priority) &&
    v.priority >= PLAN_PRIORITY.min &&
    v.priority <= PLAN_PRIORITY.max &&
    (v.status === "open" || v.status === "done" || v.status === "dropped") &&
    finite(v.made) &&
    (v.source === "mind" || v.source === "memory" || v.source === "gm") &&
    (v.closed === null || finite(v.closed)) &&
    (v.reason === null || str(v.reason)) &&
    // A pay or lend plan hands a whole positive amount to the first person it's with; no other kind carries one.
    (v.kind === "pay" || v.kind === "lend" ? finite(v.cents) && Number.isInteger(v.cents) && v.cents > 0 && v.with.length > 0 : v.cents === undefined)
  );
}

export function isNote(v: JsonValue | undefined): v is MindNote & JsonObject {
  return isRecord(v) && str(v.id) && v.id !== "" && str(v.text) && finite(v.salience) && v.salience >= 0 && v.salience <= 5 && finite(v.at);
}

export function isCommitment(v: JsonValue | undefined): v is MindCommitment & JsonObject {
  return (
    isRecord(v) &&
    str(v.id) &&
    v.id !== "" &&
    typeof v.kind === "string" &&
    (COMMITMENT_KINDS as readonly string[]).includes(v.kind) &&
    ids(v.with) &&
    str(v.text) &&
    (v.due === null || finite(v.due)) &&
    typeof v.status === "string" &&
    (COMMITMENT_STATUSES as readonly string[]).includes(v.status) &&
    finite(v.made) &&
    (v.closed === null || finite(v.closed))
  );
}

/** Copies of model-shaped values as plain state (the event's own objects are never aliased into the state). */
function planOf(v: MindPlan): MindPlan {
  return { id: v.id, what: v.what, kind: v.kind, when: { from: v.when.from, to: v.when.to }, where: v.where, with: [...v.with], priority: v.priority, status: v.status, made: v.made, source: v.source, closed: v.closed, reason: v.reason, ...(v.cents !== undefined ? { cents: v.cents } : {}) };
}

function noteOf(v: MindNote): MindNote {
  return { id: v.id, text: v.text, salience: v.salience, at: v.at };
}

function commitmentOf(v: MindCommitment): MindCommitment {
  return { id: v.id, kind: v.kind, with: [...v.with], text: v.text, due: v.due, status: v.status, made: v.made, closed: v.closed };
}

function person(ctx: ReadContext, data: JsonObject): Rejection | null {
  return str(data.entity) && own(ctx.state.entities, data.entity) ? null : { code: "missing_entity", reason: "a minds event names someone who isn't in the world" };
}

function nameOf(ctx: ReadContext, id: EntityId): string {
  return own(ctx.state.entities, id)?.name ?? id;
}

const PLAN_STATUSES: readonly PlanStatus[] = ["open", "done", "dropped"];

/** `minds.round`: a turn's minds round opens, and whether minds are on. */
const round: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.round,
  validate: (e) => (finite(e.data.at) && typeof e.data.on === "boolean" ? null : bad("a minds round needs its clock and whether minds are on")),
  apply: (e, state) => {
    const s = writeSlice(state);
    s.round += 1;
    s.on = e.data.on === true;
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : e.data.on === true ? "Minds round" : "Minds switched off"),
};

function validMind(data: JsonObject): Rejection | null {
  const { at, place, level, moment, reason, monologue, depiction, intent, reactions, plans, mood, interrupt, withheld } = data;
  if (!finite(at) || !(place === null || str(place)) || !isFidelity(level) || (moment !== "turn" && moment !== "beat") || !str(reason)) return bad("a mind needs its clock, place, level, moment and reason");
  if (!str(monologue) || !str(depiction) || !str(intent) || !texts(reactions) || !Array.isArray(plans) || !plans.every((p) => isPlan(p))) return bad("a mind needs its monologue, depiction, intent, reactions and plans");
  if (!(mood === null || str(mood)) || !(interrupt === null || (isRecord(interrupt) && str(interrupt.reason))) || typeof withheld !== "boolean") return bad("a mind's mood, interrupt or withheld flag is malformed");
  return null;
}

/** `minds.mind`: one character's mind. Its plans join theirs; a GM's refresh request is met. */
const mind: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.mind,
  validate: (e, ctx) => person(ctx, e.data) ?? validMind(e.data),
  apply: (e, state) => {
    const d = e.data;
    if (!str(d.entity)) return;
    const s = writeSlice(state);
    const c = writeCharacter(state, d.entity);
    const plans = Array.isArray(d.plans) ? d.plans.filter((p) => isPlan(p)).map(planOf) : [];
    const record: MindRecord = {
      at: finite(d.at) ? d.at : state.clock,
      round: s.round,
      level: isFidelity(d.level) ? d.level : "background",
      place: str(d.place) ? d.place : null,
      moment: d.moment === "beat" ? "beat" : "turn",
      reason: str(d.reason) ? d.reason : "",
      monologue: str(d.monologue) ? d.monologue : "",
      depiction: str(d.depiction) ? d.depiction : "",
      intent: str(d.intent) ? d.intent : "",
      reactions: texts(d.reactions) ? [...d.reactions] : [],
      plans: plans.map((p) => p.id),
      mood: str(d.mood) ? d.mood : null,
      interrupt: isRecord(d.interrupt) && str(d.interrupt.reason) ? d.interrupt.reason : null,
      withheld: d.withheld === true,
    };
    c.mind = record;
    c.refresh = false;
    for (const p of plans) putPlan(c, p);
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `${nameOf(ctx, String(e.data.entity))}'s mind (${String(e.data.level)}): ${str(e.data.intent) && e.data.intent !== "" ? e.data.intent : "no intent"}`),
};

function validMemory(data: JsonObject): Rejection | null {
  const { at, notes, commitments, resolved, plans, told, summary } = data;
  if (!finite(at) || !Array.isArray(notes) || !notes.every((n) => isNote(n)) || !Array.isArray(commitments) || !commitments.every((c) => isCommitment(c))) return bad("a memory needs its clock, notes and commitments");
  if (!Array.isArray(resolved) || !resolved.every((r) => isRecord(r) && str(r.id) && (r.status === "kept" || r.status === "broken" || r.status === "released"))) return bad("a memory's resolved commitments are malformed");
  if (!Array.isArray(plans) || !plans.every((p) => isPlan(p)) || !Array.isArray(told) || !told.every((t) => isRecord(t) && ids(t.to) && str(t.what)) || !(summary === null || str(summary))) return bad("a memory's plans, told or summary are malformed");
  return null;
}

/** `minds.memory`: what one character took from a turn: notes, commitments made and resolved, plans, what they told whom, their summary. */
const memory: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.memory,
  validate: (e, ctx) => person(ctx, e.data) ?? validMemory(e.data),
  apply: (e, state) => {
    const d = e.data;
    if (!str(d.entity)) return;
    const who = d.entity;
    const at = finite(d.at) ? d.at : state.clock;
    const c = writeCharacter(state, who);
    for (const n of Array.isArray(d.notes) ? d.notes : []) if (isNote(n)) putNote(c, noteOf(n));
    for (const x of Array.isArray(d.commitments) ? d.commitments : []) if (isCommitment(x)) putCommitment(c, commitmentOf(x));
    for (const r of Array.isArray(d.resolved) ? d.resolved : []) {
      if (!isRecord(r) || !str(r.id)) continue;
      const open = c.commitments.find((x) => x.id === r.id && x.status === "open");
      if (open && (r.status === "kept" || r.status === "broken" || r.status === "released")) putCommitment(c, { ...open, status: r.status, closed: at });
    }
    for (const p of Array.isArray(d.plans) ? d.plans : []) if (isPlan(p)) putPlan(c, planOf(p));
    if (str(d.summary)) c.summary = d.summary;
    // What they told others reaches the listeners' witness logs.
    for (const t of Array.isArray(d.told) ? d.told : []) {
      if (!isRecord(t) || !ids(t.to) || !str(t.what)) continue;
      for (const to of t.to) if (to !== who && own(state.entities, to)) addWitness(writeCharacter(state, to), { at, what: t.what, how: "told", by: who, place: null });
    }
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const n = Array.isArray(e.data.notes) ? e.data.notes.length : 0;
    const c = Array.isArray(e.data.commitments) ? e.data.commitments.length : 0;
    return `${nameOf(ctx, String(e.data.entity))} remembers the turn: ${n} note${n === 1 ? "" : "s"}, ${c} new commitment${c === 1 ? "" : "s"}`;
  },
};

/** `minds.presence`: who was in the POV's scene for a turn, and the notable things they saw happen in it. */
const presence: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.presence,
  validate: (e) => (finite(e.data.at) && (e.data.msg === null || str(e.data.msg)) && (e.data.place === null || str(e.data.place)) && ids(e.data.who) && texts(e.data.saw) ? null : bad("a presence record needs its clock, message, place, who and what they saw")),
  apply: (e, state) => {
    const d = e.data;
    const at = finite(d.at) ? d.at : state.clock;
    const place = str(d.place) ? d.place : null;
    const who = ids(d.who) ? d.who.filter((id) => own(state.entities, id)) : [];
    const s = writeSlice(state);
    s.presence.push({ msg: str(d.msg) ? d.msg : null, at, place, who: [...who] });
    if (s.presence.length > MINDS_KEEP.presence) s.presence.splice(0, s.presence.length - MINDS_KEEP.presence);
    const saw = texts(d.saw) ? d.saw : [];
    for (const id of who) {
      const c = writeCharacter(state, id);
      c.lastPresent = at;
      for (const what of saw) addWitness(c, { at, what, how: "saw", by: null, place } satisfies WitnessEntry);
    }
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `Present: ${ids(e.data.who) && e.data.who.length > 0 ? e.data.who.map((id) => nameOf(ctx, id)).join(", ") : "no one"}`),
};

/** `minds.plan`: a plan's status, from the castlife planner during `advance` or from the GM. */
const planStatus: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.plan,
  validate: (e, ctx) => {
    const d = e.data;
    if (!str(d.plan) || typeof d.status !== "string" || !(PLAN_STATUSES as readonly string[]).includes(d.status) || !finite(d.at) || !(d.reason === null || str(d.reason))) return bad("a plan's status needs the plan, a status, its clock and a reason or null");
    const missing = person(ctx, d);
    if (missing) return missing;
    return readCharacter(ctx.state, String(d.entity)).plans.some((p) => p.id === d.plan) ? null : { code: "missing_plan", reason: "that plan isn't theirs any more" };
  },
  apply: (e, state) => {
    const d = e.data;
    const c = writeCharacter(state, String(d.entity));
    const p = c.plans.find((x) => x.id === d.plan);
    if (!p || typeof d.status !== "string" || !(PLAN_STATUSES as readonly string[]).includes(d.status)) return;
    const status = d.status as PlanStatus;
    putPlan(c, { ...p, status, closed: status === "open" ? null : finite(d.at) ? d.at : state.clock, reason: str(d.reason) ? d.reason : null });
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const plan = readCharacter(ctx.state, String(e.data.entity)).plans.find((p) => p.id === e.data.plan);
    return `${nameOf(ctx, String(e.data.entity))}'s plan ${plan ? `"${plan.what}"` : String(e.data.plan)}: ${String(e.data.status)}`;
  },
};

/** An edit event's three cases for one list: replace, add (a new id) or, with `value` null, delete. */
function editDef(type: PackEvent["type"], key: "plan" | "note" | "commitment", valid: (v: JsonValue | undefined) => boolean, list: (c: MindsCharacter) => { id: string }[], put: (state: WorldState, who: EntityId, value: JsonValue) => void, remove: (state: WorldState, who: EntityId, id: string) => void): EventTypeDef<PackEvent> {
  return {
    type,
    validate: (e, ctx) => {
      const d = e.data;
      const missing = person(ctx, d);
      if (missing) return missing;
      const id = d[key];
      if (!str(id) || id === "") return bad(`a ${key} edit needs the ${key}'s id`);
      if (d.value === null) return list(readCharacter(ctx.state, String(d.entity))).some((x) => x.id === id) ? null : { code: `missing_${key}`, reason: `that ${key} isn't theirs any more` };
      return valid(d.value) && isRecord(d.value) && d.value.id === id ? null : bad(`a ${key} edit's value is malformed`);
    },
    apply: (e, state) => {
      const d = e.data;
      const who = String(d.entity);
      if (d.value === null) remove(state, who, String(d[key]));
      else if (d.value !== undefined && valid(d.value)) put(state, who, d.value);
    },
    describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `${nameOf(ctx, String(e.data.entity))}'s ${key} ${e.data.value === null ? "deleted" : "edited"}`),
  };
}

const planEdit = editDef(
  MINDS_EVENTS.planEdit,
  "plan",
  isPlan,
  (c) => c.plans,
  (state, who, v) => {
    if (isPlan(v)) putPlan(writeCharacter(state, who), planOf(v));
  },
  (state, who, id) => {
    const c = writeCharacter(state, who);
    c.plans = c.plans.filter((p) => p.id !== id);
  },
);

const noteEdit = editDef(
  MINDS_EVENTS.noteEdit,
  "note",
  isNote,
  (c) => c.notes,
  (state, who, v) => {
    if (isNote(v)) putNote(writeCharacter(state, who), noteOf(v));
  },
  (state, who, id) => {
    const c = writeCharacter(state, who);
    c.notes = c.notes.filter((n) => n.id !== id);
  },
);

const commitmentEdit = editDef(
  MINDS_EVENTS.commitmentEdit,
  "commitment",
  isCommitment,
  (c) => c.commitments,
  (state, who, v) => {
    if (isCommitment(v)) putCommitment(writeCharacter(state, who), commitmentOf(v));
  },
  (state, who, id) => {
    const c = writeCharacter(state, who);
    c.commitments = c.commitments.filter((x) => x.id !== id);
  },
);

/** `minds.commitment`: a commitment's status (kept, broken, released, or open again). */
const commitmentStatus: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.commitment,
  validate: (e, ctx) => {
    const d = e.data;
    if (!str(d.commitment) || typeof d.status !== "string" || !(COMMITMENT_STATUSES as readonly string[]).includes(d.status) || !finite(d.at) || !(d.reason === null || str(d.reason))) return bad("a commitment's status needs the commitment, a status, its clock and a reason or null");
    const missing = person(ctx, d);
    if (missing) return missing;
    return readCharacter(ctx.state, String(d.entity)).commitments.some((x) => x.id === d.commitment) ? null : { code: "missing_commitment", reason: "that commitment isn't theirs any more" };
  },
  apply: (e, state) => {
    const d = e.data;
    const c = writeCharacter(state, String(d.entity));
    const x = c.commitments.find((y) => y.id === d.commitment);
    if (!x || typeof d.status !== "string" || !(COMMITMENT_STATUSES as readonly string[]).includes(d.status)) return;
    const status = d.status as CommitmentStatus;
    putCommitment(c, { ...x, status, closed: status === "open" ? null : finite(d.at) ? d.at : state.clock });
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `${nameOf(ctx, String(e.data.entity))}'s commitment: ${String(e.data.status)}`),
};

/** `minds.consolidated`: notes folded into the summary, and gone. */
const consolidated: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.consolidated,
  validate: (e, ctx) => person(ctx, e.data) ?? (finite(e.data.at) && ids(e.data.notes) && str(e.data.summary) ? null : bad("a consolidation needs its clock, the notes folded and the summary")),
  apply: (e, state) => {
    const d = e.data;
    const c = writeCharacter(state, String(d.entity));
    const gone = new Set(ids(d.notes) ? d.notes : []);
    c.notes = c.notes.filter((n) => !gone.has(n.id));
    if (str(d.summary)) c.summary = d.summary;
    c.consolidated = finite(d.at) ? d.at : state.clock;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `${nameOf(ctx, String(e.data.entity))}'s older notes folded into their summary`),
};

/** `minds.pin`: the GM's pin on a character's fidelity, or null to unpin. */
const pin: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.pin,
  validate: (e, ctx) => person(ctx, e.data) ?? (e.data.level === null || isFidelity(e.data.level) ? null : bad("a pin is a fidelity level or null")),
  apply: (e, state) => {
    writeCharacter(state, String(e.data.entity)).pin = isFidelity(e.data.level) ? e.data.level : null;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `${nameOf(ctx, String(e.data.entity))}: fidelity ${e.data.level === null ? "unpinned" : `pinned at ${String(e.data.level)}`}`),
};

/** `minds.refresh`: the GM wants a fresh mind next turn. */
const refresh: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.refresh,
  validate: (e, ctx) => person(ctx, e.data),
  apply: (e, state) => {
    writeCharacter(state, String(e.data.entity)).refresh = true;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : `${nameOf(ctx, String(e.data.entity))}: a fresh mind next turn`),
};

/** `minds.skip`: a time skip's beats, as recorded for the GM; the skip itself is its own events. */
const skip: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.skip,
  validate: (e) =>
    finite(e.data.from) && finite(e.data.to) && Array.isArray(e.data.beats) && e.data.beats.every((b) => isRecord(b) && finite(b.at) && str(b.reason) && (b.source === "scan" || b.source === "model")) ? null : bad("a skip's beats need their span and each beat's clock, reason and source"),
  apply: () => undefined,
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `Time skip beats: ${Array.isArray(e.data.beats) ? e.data.beats.length : 0}`),
};

export const MINDS_EVENT_DEFS: readonly EventTypeDef<PackEvent>[] = [round, mind, memory, presence, planStatus, planEdit, noteEdit, commitmentStatus, commitmentEdit, consolidated, pin, refresh, skip];

/** Whether minds are on at the chat's latest round. */
export function mindsOn(ctx: Pick<ReadContext, "state">): boolean {
  return readSlice(ctx.state).on;
}
