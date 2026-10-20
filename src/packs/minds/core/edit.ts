// The GM's minds controls (DESIGN §24.9) as events of one `fix` entry: pin a character's fidelity,
// ask for a fresh mind next turn, and edit, add or delete a note, commitment or plan. A value names
// only the fields that change; what it names is checked here, and the event then checks the whole.

import { hashParts } from "../../../shared/hash";
import type { EntityId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import type { CommitmentKind, CommitmentStatus, MindCommitment, MindEditOp, MindNote, MindPlan, PlanKind, PlanStatus } from "../../../shared/minds";
import { COMMITMENT_KINDS, COMMITMENT_STATUSES, MIND_TEXT_CAPS, MINDS_EVENTS, PLAN_KINDS, PLAN_PRIORITY } from "../../../shared/minds";
import { labelOf, own } from "../../../engine/pack-kit";
import type { ReadContext, Rejection } from "../../../engine/registry";
import { kindIs } from "../../../engine/scope";
import { readCharacter } from "./state";

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** Text cut at a word to `max` characters, whitespace collapsed. */
export function capText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : t.slice(0, max)).replace(/[\s,;:.]+$/, "")}…`;
}

const text = (v: JsonValue | undefined, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? capText(v, max) : null);
const minutes = (v: JsonValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** The entity ids among `v`, every one a person in the world: a value naming anything else refuses. */
function peopleIn(ctx: ReadContext, v: JsonValue | undefined): EntityId[] | Rejection {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return reject("bad_value", "who it's with is a list of people");
  const ids = v as string[];
  for (const id of ids) {
    const e = own(ctx.state.entities, id);
    if (!e) return reject("missing_entity", `there's no ${labelOf(ctx, id)}`);
    if (!kindIs(ctx.registry, ctx.world, e.kind, "person")) return reject("bad_value", `${e.name} isn't a person`);
  }
  return [...new Set(ids)];
}

function noteFrom(ctx: ReadContext, who: EntityId, id: string | null, v: JsonObject, before: MindNote | undefined): MindNote | Rejection {
  const body = text(v.text, MIND_TEXT_CAPS.note) ?? before?.text ?? null;
  if (body === null) return reject("bad_value", "a note needs its text");
  const salience = v.salience === undefined ? (before?.salience ?? 3) : typeof v.salience === "number" && v.salience >= 1 && v.salience <= 5 ? v.salience : null;
  if (salience === null) return reject("bad_value", "a note's salience is 1 to 5");
  return { id: id ?? `n_${hashParts("minds.gm.note", who, String(ctx.state.clock), body).slice(0, 10)}`, text: body, salience, at: before?.at ?? ctx.state.clock };
}

function commitmentFrom(ctx: ReadContext, who: EntityId, id: string | null, v: JsonObject, before: MindCommitment | undefined): MindCommitment | Rejection {
  const body = text(v.text, MIND_TEXT_CAPS.commitment) ?? before?.text ?? null;
  if (body === null) return reject("bad_value", "a commitment needs its text");
  const kind = v.kind === undefined ? (before?.kind ?? "other") : (COMMITMENT_KINDS as readonly JsonValue[]).includes(v.kind) ? (v.kind as CommitmentKind) : null;
  if (kind === null) return reject("bad_value", `a commitment is one of ${COMMITMENT_KINDS.join(", ")}`);
  const status = v.status === undefined ? (before?.status ?? "open") : (COMMITMENT_STATUSES as readonly JsonValue[]).includes(v.status) ? (v.status as CommitmentStatus) : null;
  if (status === null) return reject("bad_value", `a commitment's status is one of ${COMMITMENT_STATUSES.join(", ")}`);
  const withList = v.with === undefined ? (before?.with ?? []) : peopleIn(ctx, v.with);
  if (!Array.isArray(withList)) return withList;
  const due = v.due === undefined ? (before?.due ?? null) : v.due === null ? null : minutes(v.due);
  if (v.due !== undefined && v.due !== null && due === null) return reject("bad_value", "a commitment's due time is game minutes");
  const closed = status === "open" ? null : before && before.status !== "open" ? before.closed : ctx.state.clock;
  return { id: id ?? `c_${hashParts("minds.gm.commitment", who, String(ctx.state.clock), body).slice(0, 10)}`, kind, with: withList, text: body, due, status, made: before?.made ?? ctx.state.clock, closed };
}

function planFrom(ctx: ReadContext, who: EntityId, id: string | null, v: JsonObject, before: MindPlan | undefined): MindPlan | Rejection {
  const what = text(v.what, MIND_TEXT_CAPS.planWhat) ?? before?.what ?? null;
  if (what === null) return reject("bad_value", "a plan needs what it is");
  const when = v.when === undefined ? (before?.when ?? null) : typeof v.when === "object" && v.when !== null && !Array.isArray(v.when) ? { from: minutes(v.when.from), to: minutes(v.when.to) } : null;
  if (!when || when.from === null || when.to === null || when.to < when.from) return reject("bad_value", "a plan needs when, from and to in game minutes, to not before from");
  const kind = v.kind === undefined ? (before?.kind ?? "other") : (PLAN_KINDS as readonly JsonValue[]).includes(v.kind) ? (v.kind as PlanKind) : null;
  if (kind === null) return reject("bad_value", `a plan is one of ${PLAN_KINDS.join(", ")}`);
  const where = v.where === undefined ? (before?.where ?? null) : v.where === null ? null : typeof v.where === "string" && own(ctx.world.places, v.where) ? v.where : undefined;
  if (where === undefined) return reject("missing_place", `there's no place ${typeof v.where === "string" ? labelOf(ctx, v.where) : "like that"}`);
  const withList = v.with === undefined ? (before?.with ?? []) : peopleIn(ctx, v.with);
  if (!Array.isArray(withList)) return withList;
  const priority = v.priority === undefined ? (before?.priority ?? PLAN_PRIORITY.normal) : typeof v.priority === "number" && v.priority >= PLAN_PRIORITY.min && v.priority <= PLAN_PRIORITY.max ? Math.round(v.priority) : null;
  if (priority === null) return reject("bad_value", `a plan's priority is ${PLAN_PRIORITY.min} to ${PLAN_PRIORITY.max}`);
  const statuses: readonly JsonValue[] = ["open", "done", "dropped"];
  const status = v.status === undefined ? (before?.status ?? "open") : statuses.includes(v.status) ? (v.status as PlanStatus) : null;
  if (status === null) return reject("bad_value", "a plan's status is open, done or dropped");
  const closed = status === "open" ? null : before && before.status !== "open" ? before.closed : ctx.state.clock;
  // A pay or lend plan's amount is whole minor units, kept from before unless the edit gives one; it's handed to the first person it's with.
  const money = kind === "pay" || kind === "lend";
  const cents = v.cents === undefined ? before?.cents : typeof v.cents === "number" && Number.isInteger(v.cents) && v.cents > 0 ? v.cents : null;
  if (money && (cents === null || cents === undefined || withList.length === 0)) return reject("bad_value", "a pay or lend plan needs an amount in minor units and someone to hand it to");
  return {
    id: id ?? `p_${hashParts("minds.gm.plan", who, String(ctx.state.clock), what).slice(0, 10)}`,
    what,
    kind,
    when: { from: when.from, to: when.to },
    where,
    with: withList,
    priority,
    status,
    made: before?.made ?? ctx.state.clock,
    source: before?.source ?? "gm",
    closed,
    reason: status === "open" ? null : (before?.reason ?? "GM edit"),
    ...(money && cents ? { cents } : {}),
  };
}

/** A GM minds control as the events of its `fix` entry, or why it can't apply. */
export function mindEdit(ctx: ReadContext, op: MindEditOp): LedgerEvent[] | Rejection {
  const { world, state, registry } = ctx;
  const e = own(state.entities, op.entity);
  if (!e) return reject("missing_entity", `there's no ${labelOf(ctx, op.entity)}`);
  if (op.entity === world.pov || !kindIs(registry, world, e.kind, "person")) return reject("no_mind", `${e.name} doesn't have a mind`);
  if (op.op === "mind_pin") return [{ type: MINDS_EVENTS.pin, data: { entity: op.entity, level: op.level } }];
  if (op.op === "mind_refresh") return [{ type: MINDS_EVENTS.refresh, data: { entity: op.entity } }];
  const c = readCharacter(state, op.entity);
  const value = op.value;
  if (op.part === "note") {
    const before = op.id === null ? undefined : c.notes.find((n) => n.id === op.id);
    if (op.id !== null && !before) return reject("missing_note", `${e.name} has no such note`);
    if (value === null) return op.id === null ? reject("bad_value", "say which note to delete") : [{ type: MINDS_EVENTS.noteEdit, data: { entity: op.entity, note: op.id, value: null } }];
    const note = noteFrom(ctx, op.entity, op.id, value, before);
    return "code" in note ? note : [{ type: MINDS_EVENTS.noteEdit, data: { entity: op.entity, note: note.id, value: note as unknown as JsonObject } }];
  }
  if (op.part === "commitment") {
    const before = op.id === null ? undefined : c.commitments.find((x) => x.id === op.id);
    if (op.id !== null && !before) return reject("missing_commitment", `${e.name} has no such commitment`);
    if (value === null) return op.id === null ? reject("bad_value", "say which commitment to delete") : [{ type: MINDS_EVENTS.commitmentEdit, data: { entity: op.entity, commitment: op.id, value: null } }];
    const commitment = commitmentFrom(ctx, op.entity, op.id, value, before);
    return "code" in commitment ? commitment : [{ type: MINDS_EVENTS.commitmentEdit, data: { entity: op.entity, commitment: commitment.id, value: commitment as unknown as JsonObject } }];
  }
  const before = op.id === null ? undefined : c.plans.find((p) => p.id === op.id);
  if (op.id !== null && !before) return reject("missing_plan", `${e.name} has no such plan`);
  if (value === null) return op.id === null ? reject("bad_value", "say which plan to delete") : [{ type: MINDS_EVENTS.planEdit, data: { entity: op.entity, plan: op.id, value: null } }];
  const plan = planFrom(ctx, op.entity, op.id, value, before);
  return "code" in plan ? plan : [{ type: MINDS_EVENTS.planEdit, data: { entity: op.entity, plan: plan.id, value: plan as unknown as JsonObject } }];
}
