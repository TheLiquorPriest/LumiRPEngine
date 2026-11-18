// The minds pack's events (DESIGN §24): every model answer and every GM control is one, so a fold,
// a Re-narrate and the background lane never call a model. Each apply reads only its own data, the
// minds slice and the clock, never an entity's fields, so a coarsened skip record (L21) folds alike.
// Knowledge (§24.11) folds the same way: facts and holdings come whole in their events, and a limit
// (a claim's length, how many) is the producer's, checked before an event is made, never here.
// Player lines: none. A mind is private, so every describer words nothing for a viewer and the
// Journal never shows one; the GM's and the author's lines name what changed, never a monologue.

import { listOf, say } from "../../../shared/lines";
import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import type { CommitmentStatus, FactId, FactTruth, Fidelity, Holding, KnowledgeFact, LearnEventData, MindCommitment, MindIntent, MindNote, MindPlan, MindRecord, MindsCharacter, PlanStatus, WitnessEntry } from "../../../shared/minds";
import { COMMITMENT_KINDS, COMMITMENT_STATUSES, FACT_KINDS, FACT_TRUTHS, FIDELITIES, HOLDING_BELIEFS, HOLDING_HOWS, isConfidence, isWitnessRef, keptFromOf, MIND_APPROACHES, MINDS_EVENTS, MINDS_KEEP, parseFactId, PLAN_KINDS, PLAN_PRIORITY } from "../../../shared/minds";
import { own } from "../../../engine/pack-kit";
import type { EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";
import { addWitness, dropPlan, putCommitment, putNote, putPlan, readCharacter, readKnowledge, readSlice, sharePlan, writeCharacter, writeKnowledge, writeSlice } from "./state";

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
    // Only a plan with others in it that isn't a payment or a loan is shared (`sharesPlan`).
    (v.shared === undefined || (v.shared === true && v.with.length > 0 && v.kind !== "pay" && v.kind !== "lend")) &&
    (v.by === undefined || (str(v.by) && v.shared === true)) &&
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
  return { id: v.id, what: v.what, kind: v.kind, when: { from: v.when.from, to: v.when.to }, where: v.where, with: [...v.with], priority: v.priority, status: v.status, made: v.made, source: v.source, closed: v.closed, reason: v.reason, ...(v.cents !== undefined ? { cents: v.cents } : {}), ...(v.shared === true ? { shared: true as const } : {}), ...(v.by !== undefined ? { by: v.by } : {}) };
}

function noteOf(v: MindNote): MindNote {
  return { id: v.id, text: v.text, salience: v.salience, at: v.at };
}

function commitmentOf(v: MindCommitment): MindCommitment {
  return { id: v.id, kind: v.kind, with: [...v.with], text: v.text, due: v.due, status: v.status, made: v.made, closed: v.closed };
}

function person(ctx: ReadContext, data: JsonObject): Rejection | null {
  return str(data.entity) && own(ctx.state.entities, data.entity) ? null : { code: "missing_entity", reason: say("why_a_minds_event_names_someone_who_isnt") };
}

/** A fidelity level as the GM's controls name it ("near" reads "Near"). */
function fidelityWords(level: JsonValue | undefined): string {
  const id = typeof level === "string" ? level : "";
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

function nameOf(ctx: ReadContext, id: EntityId): string {
  return own(ctx.state.entities, id)?.name ?? id;
}

const PLAN_STATUSES: readonly PlanStatus[] = ["open", "done", "dropped"];

/**
 * `minds.round`: a turn's minds round opens, and whether minds are on. Its `levels`, when there are
 * any, are the minds due this round that weren't called (DESIGN §24.1), each with the level it was
 * due at and where they were: kept as `passed`, so their cadence counts from now and their tier
 * reads that level, as a mind recorded then would. A round recorded without it folds as it did.
 */
const round: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.round,
  validate: (e, ctx) => {
    const levels = e.data.levels;
    const passedOk = levels === undefined || (isRecord(levels) && Object.entries(levels).every(([id, v]) => own(ctx.state.entities, id) !== undefined && isRecord(v) && isFidelity(v.level) && (v.place === null || str(v.place))));
    return finite(e.data.at) && typeof e.data.on === "boolean" && passedOk ? null : bad(say("why_a_minds_round_needs_its_clock_whether"));
  },
  apply: (e, state) => {
    const s = writeSlice(state);
    s.round += 1;
    s.on = e.data.on === true;
    const at = finite(e.data.at) ? e.data.at : state.clock;
    const levels = isRecord(e.data.levels) ? e.data.levels : {};
    for (const [id, v] of Object.entries(levels)) if (isRecord(v) && isFidelity(v.level)) writeCharacter(state, id).passed = { at, round: s.round, level: v.level, place: str(v.place) ? v.place : null };
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : say(e.data.on === true ? "mind_round_on" : "mind_round_off")),
};

function validMind(data: JsonObject): Rejection | null {
  const { at, place, level, moment, reason, monologue, depiction, intent, reactions, plans, mood, interrupt, withheld } = data;
  if (!finite(at) || !(place === null || str(place)) || !isFidelity(level) || (moment !== "turn" && moment !== "beat") || !str(reason)) return bad(say("why_a_mind_needs_its_clock_place_level"));
  // Only a mind from an older chat carries plans (minds no longer make them); any it has must be well formed.
  if (!str(monologue) || !str(depiction) || !str(intent) || !texts(reactions) || (plans !== undefined && (!Array.isArray(plans) || !plans.every((p) => isPlan(p))))) return bad(say("why_a_mind_needs_its_monologue_depiction_intent"));
  if (!(mood === null || str(mood)) || !(interrupt === null || (isRecord(interrupt) && str(interrupt.reason))) || typeof withheld !== "boolean") return bad(say("why_a_minds_mood_interrupt_or_withheld_flag"));
  return null;
}

/**
 * `minds.mind`: one character's mind; a GM's refresh request is met. A mind recorded before minds
 * stopped proposing plans carries its plans: they join theirs as the mind's (`source: "mind"`), so an
 * old chat folds as it did and the GM still sees them, though nothing acts on them (`planInForce`).
 */
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
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say("mind_line", { name: nameOf(ctx, String(e.data.entity)), fidelity: fidelityWords(e.data.level), ...(str(e.data.intent) && e.data.intent !== "" ? { intent: e.data.intent } : {}) })),
};

function validMemory(data: JsonObject): Rejection | null {
  const { at, notes, commitments, resolved, plans, told, summary } = data;
  if (!finite(at) || !Array.isArray(notes) || !notes.every((n) => isNote(n)) || !Array.isArray(commitments) || !commitments.every((c) => isCommitment(c))) return bad(say("why_a_memory_needs_its_clock_notes_and"));
  if (!Array.isArray(resolved) || !resolved.every((r) => isRecord(r) && str(r.id) && (r.status === "kept" || r.status === "broken" || r.status === "released"))) return bad(say("why_a_memorys_resolved_commitments_are_malformed"));
  if (!Array.isArray(plans) || !plans.every((p) => isPlan(p)) || !Array.isArray(told) || !told.every((t) => isRecord(t) && ids(t.to) && str(t.what)) || !(summary === null || str(summary))) return bad(say("why_a_memorys_plans_told_or_summary_are"));
  return null;
}

/**
 * `minds.memory`: what one character took from a turn: notes, commitments made and resolved, plans,
 * what they told whom, their summary. A plan everyone in it shares reaches each of them (`sharePlan`).
 */
const memory: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.memory,
  validate: (e, ctx) => person(ctx, e.data) ?? validMemory(e.data),
  apply: (e, state, ctx) => {
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
    for (const p of Array.isArray(d.plans) ? d.plans : []) if (isPlan(p)) sharePlan(state, ctx.world.pov, who, planOf(p));
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
    return say("mind_memory", { name: nameOf(ctx, String(e.data.entity)), notes: n, commitments: c, ...(n === 1 ? { oneNote: true } : {}), ...(c === 1 ? { oneCommitment: true } : {}) });
  },
};

/** `minds.presence`: who was in the POV's scene for a turn, and the notable things they saw happen in it. */
const presence: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.presence,
  validate: (e) => (finite(e.data.at) && (e.data.msg === null || str(e.data.msg)) && (e.data.place === null || str(e.data.place)) && ids(e.data.who) && texts(e.data.saw) ? null : bad(say("why_a_presence_record_needs_its_clock_message"))),
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
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const who = ids(e.data.who) ? e.data.who.map((id) => nameOf(ctx, id)) : [];
    return who.length === 0 ? say("mind_present_none") : say("mind_present", { who: listOf(who), ...(who.length === 1 ? { one: true } : {}) });
  },
};

/** `minds.plan`: a plan's status, from the castlife planner during `advance` or from the GM. */
const planStatus: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.plan,
  validate: (e, ctx) => {
    const d = e.data;
    if (!str(d.plan) || typeof d.status !== "string" || !(PLAN_STATUSES as readonly string[]).includes(d.status) || !finite(d.at) || !(d.reason === null || str(d.reason))) return bad(say("why_a_plans_status_needs_the_plan_a"));
    const missing = person(ctx, d);
    if (missing) return missing;
    return readCharacter(ctx.state, String(d.entity)).plans.some((p) => p.id === d.plan) ? null : { code: "missing_plan", reason: say("why_that_plan_isnt_theirs_any_more") };
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
    return say("mind_plan_status", { name: nameOf(ctx, String(e.data.entity)), ...(plan ? { plan: plan.what } : {}), status: String(e.data.status) });
  },
};

/** An edit event's three cases for one list: replace, add (a new id) or, with `value` null, delete. */
function editDef(type: PackEvent["type"], key: "plan" | "note" | "commitment", valid: (v: JsonValue | undefined) => boolean, list: (c: MindsCharacter) => { id: string }[], put: (state: WorldState, who: EntityId, value: JsonValue, ctx: ReadContext) => void, remove: (state: WorldState, who: EntityId, id: string) => void): EventTypeDef<PackEvent> {
  return {
    type,
    validate: (e, ctx) => {
      const d = e.data;
      const missing = person(ctx, d);
      if (missing) return missing;
      const id = d[key];
      if (!str(id) || id === "") return bad(say("why_a_key_edit_needs_the_key_s", { key: key }));
      if (d.value === null) return list(readCharacter(ctx.state, String(d.entity))).some((x) => x.id === id) ? null : { code: `missing_${key}`, reason: say("why_that_key_isnt_theirs_any_more", { key: key }) };
      return valid(d.value) && isRecord(d.value) && d.value.id === id ? null : bad(say("why_a_key_edits_value_is_malformed", { key: key }));
    },
    apply: (e, state, ctx) => {
      const d = e.data;
      const who = String(d.entity);
      if (d.value === null) remove(state, who, String(d[key]));
      else if (d.value !== undefined && valid(d.value)) put(state, who, d.value, ctx);
    },
    describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say(e.data.value === null ? "mind_part_deleted" : "mind_part_edited", { name: nameOf(ctx, String(e.data.entity)), key })),
  };
}

// A shared plan is one plan: an edit reaches everyone in it, and a delete takes it from them all.
const planEdit = editDef(
  MINDS_EVENTS.planEdit,
  "plan",
  isPlan,
  (c) => c.plans,
  (state, who, v, ctx) => {
    if (isPlan(v)) sharePlan(state, ctx.world.pov, who, planOf(v));
  },
  dropPlan,
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
    if (!str(d.commitment) || typeof d.status !== "string" || !(COMMITMENT_STATUSES as readonly string[]).includes(d.status) || !finite(d.at) || !(d.reason === null || str(d.reason))) return bad(say("why_a_commitments_status_needs_the_commitment_a"));
    const missing = person(ctx, d);
    if (missing) return missing;
    return readCharacter(ctx.state, String(d.entity)).commitments.some((x) => x.id === d.commitment) ? null : { code: "missing_commitment", reason: say("why_that_commitment_isnt_theirs_any_more") };
  },
  apply: (e, state) => {
    const d = e.data;
    const c = writeCharacter(state, String(d.entity));
    const x = c.commitments.find((y) => y.id === d.commitment);
    if (!x || typeof d.status !== "string" || !(COMMITMENT_STATUSES as readonly string[]).includes(d.status)) return;
    const status = d.status as CommitmentStatus;
    putCommitment(c, { ...x, status, closed: status === "open" ? null : finite(d.at) ? d.at : state.clock });
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say("mind_commitment_status", { name: nameOf(ctx, String(e.data.entity)), status: String(e.data.status) })),
};

/** `minds.consolidated`: notes folded into the summary, and gone. */
const consolidated: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.consolidated,
  validate: (e, ctx) => person(ctx, e.data) ?? (finite(e.data.at) && ids(e.data.notes) && str(e.data.summary) ? null : bad(say("why_a_consolidation_needs_its_clock_the_notes"))),
  apply: (e, state) => {
    const d = e.data;
    const c = writeCharacter(state, String(d.entity));
    const gone = new Set(ids(d.notes) ? d.notes : []);
    c.notes = c.notes.filter((n) => !gone.has(n.id));
    if (str(d.summary)) c.summary = d.summary;
    c.consolidated = finite(d.at) ? d.at : state.clock;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say("mind_consolidated", { name: nameOf(ctx, String(e.data.entity)) })),
};

/** `minds.pin`: the GM's pin on a character's fidelity, or null to unpin. */
const pin: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.pin,
  validate: (e, ctx) => person(ctx, e.data) ?? (e.data.level === null || isFidelity(e.data.level) ? null : bad(say("why_a_pin_is_a_fidelity_level_or"))),
  apply: (e, state) => {
    writeCharacter(state, String(e.data.entity)).pin = isFidelity(e.data.level) ? e.data.level : null;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : e.data.level === null ? say("mind_unpinned", { name: nameOf(ctx, String(e.data.entity)) }) : say("mind_pinned", { name: nameOf(ctx, String(e.data.entity)), fidelity: fidelityWords(e.data.level) })),
};

/** `minds.refresh`: the GM wants a fresh mind next turn. */
const refresh: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.refresh,
  validate: (e, ctx) => person(ctx, e.data),
  apply: (e, state) => {
    writeCharacter(state, String(e.data.entity)).refresh = true;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say("mind_refresh", { name: nameOf(ctx, String(e.data.entity)) })),
};

/** An intent as the GM sets it: its text, or its approach, or both; one with neither is a clear, written as null. */
function isIntent(v: JsonValue | undefined): v is MindIntent & JsonObject {
  if (!isRecord(v) || !str(v.text)) return false;
  const approach = v.approach === null || (typeof v.approach === "string" && (MIND_APPROACHES as readonly string[]).includes(v.approach));
  return approach && (v.text !== "" || v.approach !== null);
}

/** `minds.intent`: the GM's intent for a character, set whole, or cleared with null. */
const intent: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.intent,
  validate: (e, ctx) => person(ctx, e.data) ?? (e.data.intent === null || isIntent(e.data.intent) ? null : bad(say("why_an_intent_is_its_text_its_approach"))),
  apply: (e, state) => {
    const c = writeCharacter(state, String(e.data.entity));
    const v = e.data.intent;
    // A copy, so the event's own object is never aliased into the state.
    if (isIntent(v)) c.intent = { text: v.text, approach: v.approach };
    else delete c.intent;
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const name = nameOf(ctx, String(e.data.entity));
    const v = e.data.intent;
    if (!isIntent(v)) return say("mind_intent_cleared", { name });
    // "Danny Okafor now means to “find the ledger”, proactively".
    return say(v.text !== "" ? "mind_intent" : "mind_intent_manner", { name, text: v.text, ...(v.approach === null ? {} : { approach: v.approach }) });
  },
};

/** `minds.skip`: a time skip's beats, as recorded for the GM; the skip itself is its own events. */
const skip: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.skip,
  validate: (e) =>
    finite(e.data.from) && finite(e.data.to) && Array.isArray(e.data.beats) && e.data.beats.every((b) => isRecord(b) && finite(b.at) && str(b.reason) && (b.source === "scan" || b.source === "model")) ? null : bad(say("why_a_skips_beats_need_their_span_and")),
  apply: () => undefined,
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : say("mind_skip", { beats: Array.isArray(e.data.beats) ? e.data.beats.length : 0 })),
};

// ---------------------------------------------------------------- knowledge (DESIGN §24.11)

/** Ids, each a non-empty string. */
const someIds = (v: JsonValue | undefined): v is string[] => ids(v) && v.every((id) => id !== "");

/** A fact as recorded: an id in its kind's form, a claim, the ids it is about, its truth, and any source and text hash well formed. */
export function isFact(v: JsonValue | undefined): v is KnowledgeFact & JsonObject {
  if (!isRecord(v) || !str(v.id) || typeof v.kind !== "string" || !(FACT_KINDS as readonly string[]).includes(v.kind) || parseFactId(v.id)?.kind !== v.kind) return false;
  const source = v.source;
  return (
    str(v.claim) &&
    v.claim.trim() !== "" &&
    someIds(v.about) &&
    typeof v.truth === "string" &&
    (FACT_TRUTHS as readonly string[]).includes(v.truth) &&
    (source === undefined || (isRecord(source) && (source.msg === null || str(source.msg)) && finite(source.at))) &&
    (v.textHash === undefined || (str(v.textHash) && v.textHash !== "")) &&
    (v.matters === undefined || (str(v.matters) && v.matters.trim() !== ""))
  );
}

/**
 * A holding's shape: how it's held and by whom (one told names its teller), its evidence (fact ids
 * and witness refs), since when, the belief, a confidence from 0 to 1 (§16, a fixed range), and
 * whom it is kept from, if anyone. Whom and what it names are checked against the state apart.
 */
export function isHolding(v: JsonValue | undefined): v is Holding & JsonObject {
  if (!isRecord(v) || typeof v.how !== "string" || !(HOLDING_HOWS as readonly string[]).includes(v.how)) return false;
  const since = v.since;
  return (
    (v.by === null || (str(v.by) && v.by !== "")) &&
    (v.how !== "told" || v.by !== null) &&
    texts(v.evidence) &&
    v.evidence.every((ref) => isWitnessRef(ref) || parseFactId(ref) !== null) &&
    isRecord(since) &&
    (since.msg === null || str(since.msg)) &&
    finite(since.at) &&
    typeof v.belief === "string" &&
    (HOLDING_BELIEFS as readonly string[]).includes(v.belief) &&
    isConfidence(v.confidence) &&
    (v.keptFrom === undefined || v.keptFrom === "everyone" || someIds(v.keptFrom))
  );
}

/** A holding as `self` keeps it: a copy, its evidence once each, and whom it's kept from once each, never themselves (none at all is no `keptFrom`). */
export function holdingOf(v: Holding, self: EntityId): Holding {
  const keptFrom = keptFromOf(v.keptFrom, self);
  return { how: v.how, by: v.by, evidence: [...new Set(v.evidence)], since: { msg: v.since.msg, at: v.since.at }, belief: v.belief, confidence: v.confidence, ...(keptFrom ? { keptFrom } : {}) };
}

function factOf(v: KnowledgeFact): KnowledgeFact {
  return { id: v.id, kind: v.kind, claim: v.claim, about: [...v.about], truth: v.truth, ...(v.source ? { source: { msg: v.source.msg, at: v.source.at } } : {}), ...(v.textHash !== undefined ? { textHash: v.textHash } : {}), ...(v.matters !== undefined ? { matters: v.matters } : {}) };
}

/** The holding a learning gives each learner, as its data carries it (`since` is its message and clock). */
function learnedHolding(d: JsonObject): JsonObject {
  return { how: d.how ?? null, by: d.by ?? null, evidence: d.evidence ?? null, since: { msg: d.msg ?? null, at: d.at ?? null }, belief: d.belief ?? null, confidence: d.confidence ?? null, ...(d.keptFrom !== undefined ? { keptFrom: d.keptFrom } : {}) };
}

/** Who a knowledge event names: some people, each once, each in the world. */
function knowers(ctx: ReadContext, v: JsonValue | undefined): EntityId[] | Rejection {
  if (!someIds(v) || v.length === 0 || new Set(v).size !== v.length) return bad(say("why_a_knowledge_event_names_who_each_once"));
  return v.every((id) => own(ctx.state.entities, id) !== undefined) ? v : { code: "missing_entity", reason: say("why_a_knowledge_event_names_someone_who_isnt") };
}

/** Whether `who` holds `fact` in the state. */
function holds(state: Readonly<WorldState>, who: EntityId, fact: FactId): boolean {
  return own(own(readKnowledge(state).holdings, who) ?? {}, fact) !== undefined;
}

/** A fact's claim for the GM's lines. */
function claimOf(ctx: ReadContext, fact: JsonValue | undefined): string {
  const f = str(fact) ? own(readKnowledge(ctx.state).facts, fact) : undefined;
  return f ? `“${f.claim}”` : "a fact";
}

/** Names for the GM's lines, in a list. */
function namesOf(ctx: ReadContext, who: JsonValue | undefined): string {
  return listOf(ids(who) ? who.map((id) => nameOf(ctx, id)) : []);
}

/** How a holding is held and how far it is believed, as phrases (the lines `mind_how_*` and `mind_belief_*`). */
const howWords = (how: Holding["how"]): string => say(`mind_how_${how}`);
const beliefWords = (belief: Holding["belief"]): string => say(`mind_belief_${belief}`);

/** `minds.fact`: a fact the minds can hold, recorded whole; one already held is replaced whole, and whoever holds it still does. */
const knowledgeFact: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.fact,
  validate: (e) => (isFact(e.data.fact) ? null : bad(say("why_a_fact_needs_an_id_in_its"))),
  apply: (e, state) => {
    const v = e.data.fact;
    if (isFact(v)) writeKnowledge(state).facts[v.id] = factOf(v);
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : isFact(e.data.fact) ? say("mind_fact", { claim: e.data.fact.claim }) : say("mind_fact_bare")),
};

/**
 * The witness entry a learning adds to each learner's log (`LearnEventData.witness`): what they saw
 * (`witnessed`) or were told (`told`, by the teller), at the learning's clock and the place it gives.
 * Its producer names it in the holding's evidence (`witnessRef`); null for a learning without one, or
 * of another kind.
 */
export function learnedWitness(d: Pick<LearnEventData, "how" | "by" | "at"> & { witness?: LearnEventData["witness"] }): WitnessEntry | null {
  if (!d.witness || (d.how !== "witnessed" && d.how !== "told")) return null;
  return { at: d.at, what: d.witness.what, how: d.how === "told" ? "told" : "saw", by: d.how === "told" ? d.by : null, place: d.witness.place };
}

function isLearnedWitness(v: JsonValue | undefined): v is LearnEventData["witness"] & JsonObject {
  return isRecord(v) && str(v.what) && v.what.trim() !== "" && (v.place === null || str(v.place));
}

/**
 * `minds.learn`: each person named holds a fact the chat holds, as the event gives it, in place of
 * any holding of it they had. Whom it names (a teller, those it's kept from) is in the world and
 * none of the learners, and each fact it rests on is held by the chat; whether the teller holds what
 * they told, and the learners could perceive it, the producer checks before it is made. A learning
 * the knowledge step recorded, witnessed or told, adds its line to each learner's witness log
 * (`learnedWitness`), as presence and memory add theirs.
 */
const learning: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.learn,
  validate: (e, ctx) => {
    const d = e.data;
    const who = knowers(ctx, d.who);
    if (!Array.isArray(who)) return who;
    const k = readKnowledge(ctx.state);
    if (!str(d.fact) || !own(k.facts, d.fact)) return { code: "missing_fact", reason: say("why_a_learning_names_a_fact_the_minds") };
    const h = learnedHolding(d);
    if (d.by === undefined || d.msg === undefined || !isHolding(h)) return bad(say("why_a_learning_needs_how_and_by_whom"));
    if (h.by !== null && (own(ctx.state.entities, h.by) === undefined || who.includes(h.by))) return { code: "missing_entity", reason: say("why_a_learnings_teller_is_in_the_world") };
    if (Array.isArray(h.keptFrom) && h.keptFrom.some((id) => own(ctx.state.entities, id) === undefined || who.includes(id))) return { code: "missing_entity", reason: say("why_those_a_learning_is_kept_from_are") };
    if (h.evidence.some((ref) => ref === d.fact || (!isWitnessRef(ref) && own(k.facts, ref) === undefined))) return { code: "missing_fact", reason: say("why_a_learning_rests_on_facts_the_minds") };
    if (d.witness !== undefined && (!isLearnedWitness(d.witness) || (h.how !== "witnessed" && h.how !== "told"))) return bad(say("why_a_learnings_witness_line_is_what_was"));
    return null;
  },
  apply: (e, state) => {
    const d = e.data;
    const h = learnedHolding(d);
    if (!str(d.fact) || !ids(d.who) || !isHolding(h) || own(readKnowledge(state).facts, d.fact) === undefined) return;
    const k = writeKnowledge(state);
    const line = isLearnedWitness(d.witness) ? learnedWitness({ how: h.how, by: h.by, at: h.since.at, witness: { what: d.witness.what, place: d.witness.place } }) : null;
    for (const who of d.who) {
      if (own(state.entities, who) === undefined) continue;
      const held = own(k.holdings, who) ?? {};
      held[d.fact] = holdingOf(h, who);
      k.holdings[who] = held;
      if (line) addWitness(writeCharacter(state, who), { ...line });
    }
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = e.data;
    const h = learnedHolding(d);
    const who = ids(d.who) ? d.who : [];
    if (!isHolding(h)) return say("mind_learned", { who: namesOf(ctx, who), claim: claimOf(ctx, d.fact) });
    const kept = h.keptFrom === "everyone" ? say("mind_kept_everyone") : h.keptFrom && h.keptFrom.length > 0 ? say("mind_kept_from", { who: namesOf(ctx, h.keptFrom) }) : null;
    const how = h.how === "told" && h.by !== null ? say("mind_told_by", { who: nameOf(ctx, h.by) }) : howWords(h.how);
    const parts = [how, beliefWords(h.belief), say("mind_sure", { pct: Math.round(h.confidence * 100) }), kept].filter((p): p is string => p !== null && p !== "");
    return say("mind_holds", { who: namesOf(ctx, who), ...(who.length === 1 ? { one: true } : {}), claim: claimOf(ctx, d.fact), parts: parts.join(", ") });
  },
};

/** `minds.forget`: none of those named holds the fact any more; each of them held it. */
const forgetting: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.forget,
  validate: (e, ctx) => {
    const d = e.data;
    if (!someIds(d.who) || d.who.length === 0 || new Set(d.who).size !== d.who.length || !str(d.fact)) return bad(say("why_forgetting_names_the_fact_and_who_forgets"));
    const fact = d.fact;
    return d.who.every((who) => holds(ctx.state, who, fact)) ? null : { code: "missing_holding", reason: say("why_someone_it_names_doesnt_hold_that_fact") };
  },
  apply: (e, state) => {
    const d = e.data;
    if (!ids(d.who) || !str(d.fact) || readSlice(state).knowledge === undefined) return;
    const k = writeKnowledge(state);
    for (const who of d.who) {
      const held = own(k.holdings, who);
      if (!held || own(held, d.fact) === undefined) continue;
      delete held[d.fact];
      // Someone who holds nothing has no entry, as if they never held anything.
      if (Object.keys(held).length === 0) delete k.holdings[who];
    }
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say("mind_forgot", { who: namesOf(ctx, e.data.who), ...(ids(e.data.who) && e.data.who.length === 1 ? { one: true } : {}), claim: claimOf(ctx, e.data.fact) })),
};

/** `minds.keep`: whom someone keeps a fact they hold from: some people (never themselves), everyone, or (an empty list) no one. */
const keeping: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.keep,
  validate: (e, ctx) => {
    const { who, fact, keptFrom } = e.data;
    if (!str(who) || !str(fact) || !(keptFrom === "everyone" || someIds(keptFrom))) return bad(say("why_keeping_names_who_keeps_the_fact_the"));
    if (!holds(ctx.state, who, fact)) return { code: "missing_holding", reason: say("why_they_dont_hold_that_fact") };
    return keptFrom !== "everyone" && keptFrom.some((id) => id === who || own(ctx.state.entities, id) === undefined) ? { code: "missing_entity", reason: say("why_those_a_fact_is_kept_from_are") } : null;
  },
  apply: (e, state) => {
    const d = e.data;
    if (!str(d.who) || !str(d.fact) || !holds(state, d.who, d.fact)) return;
    const h = own(own(writeKnowledge(state).holdings, d.who) ?? {}, d.fact);
    if (!h) return;
    const keptFrom = keptFromOf(d.keptFrom, d.who);
    if (keptFrom) h.keptFrom = keptFrom;
    else delete h.keptFrom;
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = e.data;
    const name = nameOf(ctx, String(d.who));
    const keptFrom = keptFromOf(d.keptFrom, String(d.who));
    if (keptFrom === null) return say("mind_keeps_none", { name, claim: claimOf(ctx, d.fact) });
    return say("mind_keeps", { name, claim: claimOf(ctx, d.fact), from: keptFrom === "everyone" ? say("mind_everyone") : namesOf(ctx, keptFrom) });
  },
};

function isTruth(v: JsonValue | undefined): v is FactTruth {
  return typeof v === "string" && (FACT_TRUTHS as readonly string[]).includes(v);
}

/** `minds.settle`: a fact's truth as the GM holds it: true, false, or an open question. */
const settling: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.settle,
  validate: (e, ctx) => {
    if (!str(e.data.fact) || own(readKnowledge(ctx.state).facts, e.data.fact) === undefined) return { code: "missing_fact", reason: say("why_that_fact_isnt_one_the_minds_hold") };
    return isTruth(e.data.truth) ? null : bad(say("why_a_facts_truth_is_true_false_or"));
  },
  apply: (e, state) => {
    const d = e.data;
    if (!str(d.fact) || !isTruth(d.truth) || own(readKnowledge(state).facts, d.fact) === undefined) return;
    const f = own(writeKnowledge(state).facts, d.fact);
    if (f) f.truth = d.truth;
  },
  describe: (e, ctx, viewer) => (viewer !== undefined ? "" : say("mind_truth", { claim: claimOf(ctx, e.data.fact), ...(e.data.truth === "open" ? { open: true } : { truth: String(e.data.truth) }) })),
};

/**
 * `minds.knowledge`: whether the chat tracks knowledge from this turn on, and the user's threshold
 * when it changed (DESIGN §24.11): how sure the player character's holding must be to reveal its fact
 * on their screens (`revealsFact`). The pre phase records it only when either changes in a chat that
 * holds knowledge, so a chat with none folds as it always did. Switched off, every reader of
 * knowledge reads as if there were none, and what was recorded stays for when it is switched on again.
 */
const tracking: EventTypeDef<PackEvent> = {
  type: MINDS_EVENTS.knowledge,
  validate: (e) => (typeof e.data.on === "boolean" && (e.data.threshold === undefined || isConfidence(e.data.threshold)) ? null : bad(say("why_knowledge_tracking_is_on_or_off_and"))),
  apply: (e, state) => {
    if (typeof e.data.on !== "boolean") return;
    if (e.data.on) {
      if (readSlice(state).knowledge?.off) delete writeKnowledge(state).off;
    } else writeKnowledge(state).off = true;
    if (isConfidence(e.data.threshold)) writeKnowledge(state).threshold = e.data.threshold;
  },
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `${say(e.data.on === true ? "mind_tracking_on" : "mind_tracking_off")}${isConfidence(e.data.threshold) ? say("mind_threshold", { pct: Math.round(e.data.threshold * 100) }) : ""}`),
};

export const MINDS_EVENT_DEFS: readonly EventTypeDef<PackEvent>[] = [round, mind, memory, presence, planStatus, planEdit, noteEdit, commitmentStatus, commitmentEdit, consolidated, pin, refresh, intent, skip, knowledgeFact, learning, forgetting, keeping, settling, tracking];

/** Whether minds are on at the chat's latest round. */
export function mindsOn(ctx: Pick<ReadContext, "state">): boolean {
  return readSlice(ctx.state).on;
}
