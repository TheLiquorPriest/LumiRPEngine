// Typed edits (DESIGN §7 GM edits, §12 ✎ fixes): what a ✎ fix or a GM edit writes, as events.
// Each operation is checked against what it touches (a field's type, enum values, min and max, a
// pool's evaluated max, derived and locked fields; a relation type's kinds and fields; a tier, a
// place, a track's stages; the world's facets and their values) and then resolved through the core
// effects, so the event validators and pack guards apply, money moves against the outside
// correction account and a change to XP levels up, as anywhere else. Values are literals: a typed
// "=1+1" is text, never a formula. A submit applies all or none and is one `fix` post entry on the
// head (§4.3), so undo, Keep, swipes, Re-narrate and Re-run treat it like any fix.

import { hashParts } from "../shared/hash";
import type { EntityId, FieldId } from "../shared/ids";
import { DOMAINS } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord, safeKey } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { EditOp } from "../shared/protocol";
import { EDIT_OPS_MAX } from "../shared/protocol";
import type { ChatScheduleChange, RoutineEntry } from "../shared/routines";
import { ROUTINE_AWARENESS, ROUTINE_MODES, ROUTINE_ROLES, SKIP_LIVES } from "../shared/routines";
import { isBand, tierOf } from "../shared/tiers";
import type { EffectSpec, FieldDef, FieldType, WorldDoc } from "../shared/world";
import { BUILTIN_RELATIONS, formatMoney, readSectionFeed, spanRecords } from "../shared/world";
import { FEED_EVENT } from "./feed";
import { calendarOf, slotIndexAt } from "./calendar";
import { parseDice } from "./dice";
import { applyEffects, fieldBounds } from "./effects";
import { ENGINE_EVENTS } from "./engine-pack";
import { EXTERNAL_ACCOUNT_PREFIX } from "./events";
import { labelOf, optionalService, own } from "./pack-kit";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { materializeIfNeeded } from "./materialize";
import { createRng, type Rng } from "./rng";
import { fieldDef, GONE_FIELD, kindDef, kindIs, placeOfEntity } from "./scope";
import { classOf, classProblems, classValues, tagsOf } from "./selector";
import type { WorldState } from "./state";
import { Working } from "./working";

export interface EditOptions {
  /** The GM editor writes locked fields too; a player's ✎ fix can't. */
  gm: boolean;
  /** The chat run's seed: the edit's generator (spawn ids, level-up effects) forks from it and the operations. */
  runSeed: string;
}

export type EditOutcome = { events: LedgerEvent[] } | { rejection: Rejection };

/** The outside account GM money edits post against (DESIGN §9.2), shown as "Correction". */
const CORRECTION = `${EXTERNAL_ACCOUNT_PREFIX}correction`;

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A value's shape for a field type; a list's items are checked against its `of`. Null when it fits. */
function shapeProblem(reg: Registry, w: Working, type: FieldType, def: FieldDef, value: JsonValue): string | null {
  switch (type) {
    case "number":
    case "duration":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
    case "money":
      return Number.isSafeInteger(value) ? null : "must be a whole amount";
    case "date":
      return (typeof value === "number" && Number.isFinite(value)) || typeof value === "string" ? null : "must be a date";
    case "bool":
      return typeof value === "boolean" ? null : "must be yes or no";
    case "text":
      return typeof value === "string" ? null : "must be text";
    case "enum":
      return typeof value === "string" && (!def.values || def.values.includes(value)) ? null : `must be one of ${(def.values ?? []).join(", ")}`;
    case "dice":
      if (typeof value !== "string") return "must be dice, like 2d6+1";
      try {
        parseDice(value);
        return null;
      } catch {
        return "must be dice, like 2d6+1";
      }
    case "ref": {
      // Null clears a reference (no owner, no employer).
      if (value === null) return null;
      const target = typeof value === "string" ? own(w.state.entities, value) : undefined;
      if (def.ref) return target && kindIs(reg, w.world, target.kind, def.ref) ? null : `must name a ${(kindDef(reg, w.world, def.ref)?.label ?? def.ref).toLowerCase()}`;
      return target || (typeof value === "string" && own(w.world.places, value)) ? null : "must name a place or something in the world";
    }
    case "list": {
      if (!Array.isArray(value)) return "must be a list";
      if (!def.of) return null;
      for (const item of value) {
        const problem = shapeProblem(reg, w, def.of, { ...def, type: def.of }, item);
        if (problem) return `has an item that ${problem.replace(/^must be /, "isn't ")}`;
      }
      return null;
    }
  }
}

/**
 * Why `value` can't be stored in an entity's field of this definition, as words after its label
 * ("must be between 3 and 18"), or null. Numbers are held to the bounds the `set` effect clamps to
 * (a pool's evaluated max included), but refused rather than clamped: a fix stores what was typed.
 */
export function valueProblem(reg: Registry, w: Working, entity: EntityId, def: FieldDef, value: JsonValue): string | null {
  const shape = shapeProblem(reg, w, def.type, def, value);
  if (shape || typeof value !== "number" || (def.type !== "number" && def.type !== "money" && def.type !== "duration")) return shape;
  const { min, max } = fieldBounds(reg, w.ctx, entity, def);
  const show = (n: number): string => (def.type === "money" ? formatMoney(n, w.world.currency) : String(n));
  if ((min === undefined || value >= min) && (max === undefined || value <= max)) return null;
  if (min !== undefined && max !== undefined) return `must be between ${show(min)} and ${show(max)}`;
  return min !== undefined ? `must be at least ${show(min)}` : `must be at most ${show(max ?? value)}`;
}

/** Runs effects with literal arguments; the first rejection (a level-up's included) refuses the edit. */
function run(reg: Registry, w: Working, specs: EffectSpec[], rng: Rng): Rejection | null {
  const out = applyEffects(reg, w, specs, { bindings: {}, rng, literal: true });
  return out.rejected[0]?.rejection ?? null;
}

/** Applies ready-made events in order (a pack service's unit); the first rejection refuses the edit. */
function applyAll(w: Working, events: readonly LedgerEvent[]): Rejection | null {
  for (const ev of events) {
    const rejection = w.apply(ev);
    if (rejection) return rejection;
  }
  return null;
}

/** The checks every field write shares: a field the kind may hold, never derived, locked only for the GM. */
function writable(reg: Registry, w: Working, entity: EntityId, field: FieldId, opts: EditOptions): { def: FieldDef | undefined; label: string } | Rejection {
  const e = own(w.state.entities, entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
  if (!safeKey(field)) return reject("bad_field", "not a field name");
  // Remove and Restore own `gone`, so the GM view's lists and every filter agree on it.
  if (field === GONE_FIELD) return reject("reserved", "use Remove or Restore");
  const def = fieldDef(reg, w.world, e.kind, field);
  const label = def?.label ?? field.replace(/_/g, " ");
  if (def?.derived !== undefined) return reject("derived", `${label} is worked out from other values`);
  if (def?.locked && !opts.gm) return reject("locked", `${label} is locked`);
  return { def, label };
}

function setField(reg: Registry, w: Working, entity: EntityId, field: FieldId, value: JsonValue, opts: EditOptions, rng: Rng): Rejection | null {
  const ok = writable(reg, w, entity, field, opts);
  if ("code" in ok) return ok;
  const problem = ok.def ? valueProblem(reg, w, entity, ok.def, value) : null;
  if (problem) return reject("bad_value", `${ok.label} ${problem}`);
  // Cash held in cash accounts is corrected by a balanced posting against the outside correction
  // account (DESIGN §9.2), so the cash shown becomes the amount and the books still balance; cash
  // without a cash account stays a field. The cash shown before the holder's money is materialized
  // is the authored opening amount, so the accounts open first and the correction is measured from
  // them (the fix records both).
  if (field === "cash" && typeof value === "number") {
    materializeIfNeeded(reg, w, entity, "money", opts.runSeed);
    const corrected = optionalService(w.ctx, "economy.set_cash")?.(w.ctx, entity, value) ?? null;
    if (corrected !== null) return Array.isArray(corrected) ? applyAll(w, corrected) : corrected;
  }
  // A place set from the field editor is a move like any other (the one move path): out of whatever
  // holds them and onto where they stand there, rather than the field alone.
  if (field === "place" && typeof value === "string" && own(w.world.places, value)) return run(reg, w, [{ type: "move", args: { entity, to: value } }], rng);
  return run(reg, w, [{ type: "set", args: { entity, field, value } }], rng);
}

function addField(reg: Registry, w: Working, entity: EntityId, field: FieldId, delta: number, opts: EditOptions, rng: Rng): Rejection | null {
  const ok = writable(reg, w, entity, field, opts);
  if ("code" in ok) return ok;
  if (!Number.isFinite(delta) || delta === 0) return reject("bad_delta", "add a number other than 0");
  if (ok.def && ok.def.type !== "number" && ok.def.type !== "money" && ok.def.type !== "duration") return reject("not_numeric", `${ok.label} isn't a number`);
  if (ok.def?.type === "money" && !Number.isSafeInteger(delta)) return reject("bad_delta", `${ok.label} moves in whole amounts`);
  return run(reg, w, [{ type: "add", args: { entity, field, delta } }], rng);
}

/** A relation: its type known (the world's, a pack's or built in), its ends of the kinds it allows, its fields typed. */
function linkOp(reg: Registry, w: Working, op: Extract<EditOp, { op: "link" }>, rng: Rng): Rejection | null {
  const def = own(w.world.relations, op.rel) ?? reg.relations.get(op.rel);
  if (!def && !BUILTIN_RELATIONS.some((r) => r === op.rel)) return reject("unknown_relation", `no relation type ${op.rel.replace(/_/g, " ")}`);
  const from = own(w.state.entities, op.from);
  const to = own(w.state.entities, op.to);
  if (!from || !to) return reject("missing_entity", `no entity ${labelOf(w, from ? op.to : op.from)}`);
  if (op.from === op.to) return reject("self", `${from.name} can't relate to itself`);
  const label = def?.label ?? op.rel.replace(/_/g, " ");
  if (def && def.from !== "*" && !kindIs(reg, w.world, from.kind, def.from)) return reject("bad_kind", `${label} starts from a ${(kindDef(reg, w.world, def.from)?.label ?? def.from).toLowerCase()}`);
  if (def && def.to !== "*" && !kindIs(reg, w.world, to.kind, def.to)) return reject("bad_kind", `${label} points at a ${(kindDef(reg, w.world, def.to)?.label ?? def.to).toLowerCase()}`);
  for (const [key, value] of Object.entries(op.fields ?? {})) {
    const fdef = def ? own(def.fields, key) : undefined;
    const problem = !safeKey(key) ? "isn't a field name" : fdef ? valueProblem(reg, w, op.from, fdef, value) : null;
    if (problem) return reject("bad_value", `${fdef?.label ?? key.replace(/_/g, " ")} ${problem}`);
  }
  if (op.until !== undefined && !Number.isFinite(op.until)) return reject("bad_until", "an end time is a time");
  const args: Record<string, JsonValue> = { rel: op.rel, from: op.from, to: op.to };
  if (op.fields && Object.keys(op.fields).length > 0) args.fields = op.fields;
  if (op.until !== undefined) args.until = op.until;
  return run(reg, w, [{ type: "link", args }], rng);
}

/** Into a container (`in`), never inside itself; or out of it (`into: null`) to where the container stands. */
function putOp(reg: Registry, w: Working, entity: EntityId, into: EntityId | null, rng: Rng): Rejection | null {
  const e = own(w.state.entities, entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
  const holders = e.relations.filter((r) => r.type === "in");
  const specs: EffectSpec[] = holders.filter((r) => r.to !== into).map((r) => ({ type: "unlink", args: { rel: "in", from: entity, to: r.to } }));
  if (into === null) {
    if (holders.length === 0) return reject("not_inside", `${e.name} isn't inside anything`);
    const place = placeOfEntity(w.state, entity);
    if (place) specs.push({ type: "set", args: { entity, field: "place", value: place } });
    return run(reg, w, specs, rng);
  }
  const container = own(w.state.entities, into);
  if (!container) return reject("missing_entity", `no entity ${labelOf(w, into)}`);
  // Walking up from the container must never reach the entity: nothing goes inside itself.
  let cur: EntityId | undefined = into;
  for (let guard = 0; cur && guard < 32; guard++) {
    if (cur === entity) return reject("cycle", `${e.name} can't go inside ${container.name}`);
    cur = own(w.state.entities, cur)?.relations.find((r) => r.type === "in")?.to;
  }
  if (holders.some((r) => r.to === into)) return reject("already_inside", `${e.name} is already in ${container.name}`);
  // A thing inside something has no place of its own: it is wherever its container is.
  if (typeof e.fields.place === "string") specs.push({ type: "set", args: { entity, field: "place", value: null } });
  specs.push({ type: "link", args: { rel: "in", from: entity, to: into } });
  return run(reg, w, specs, rng);
}

/** Money into or out of an account against the correction account: the economy's posting with its history line, or a bare one. */
function adjustOp(reg: Registry, w: Working, account: EntityId, cents: number, rng: Rng): Rejection | null {
  if (!own(w.state.entities, account)) return reject("missing_entity", `no account ${labelOf(w, account)}`);
  if (!Number.isSafeInteger(cents) || cents === 0) return reject("bad_amount", "an adjustment is a whole amount other than nothing");
  const adjust = optionalService(w.ctx, "economy.adjust");
  if (adjust) {
    const events = adjust(w.ctx, account, cents);
    return Array.isArray(events) ? applyAll(w, events) : events;
  }
  return run(reg, w, [{ type: "post", args: { memo: "Correction", lines: [{ account, amount: cents }, { account: CORRECTION, amount: -cents }] } }], rng);
}

/**
 * An entity's simulation detail. An entity that becomes an agent (or comes back as one) starts
 * caught up, as a spawned one does: it never replays the slots it wasn't stepped through.
 */
function caughtUp(w: Working, entity: EntityId): Rejection | null {
  return applyAll(w, [{ type: ENGINE_EVENTS.caught, data: { agent: entity, slot: slotIndexAt(calendarOf(w.world), w.state.clock) } }]);
}

function entityOp(w: Working, op: Extract<EditOp, { op: "entity" }>): Rejection | null {
  const e = own(w.state.entities, op.entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, op.entity)}`);
  const data: JsonObject = { entity: op.entity };
  if (op.tier !== undefined) {
    if (!tierOf(w.world, op.tier) && !isBand(op.tier)) return reject("bad_tier", `no tier ${op.tier}`);
    data.tier = op.tier;
  }
  if (op.agent !== undefined) {
    if (op.entity === w.world.pov) return reject("pov", "the point of view is played, never an agent");
    data.agent = op.agent;
  }
  if (op.levels !== undefined) {
    const levels: JsonObject = {};
    for (const [domain, level] of Object.entries(op.levels)) {
      if (!DOMAINS.some((d) => d === domain)) return reject("bad_domain", `no domain ${domain}`);
      if (level !== null && level !== undefined && !(Number.isInteger(level) && level >= 0 && level <= 4)) return reject("bad_level", "a level is a whole number 0–4");
      levels[domain] = level ?? null;
    }
    data.levels = levels;
  }
  if (Object.keys(data).length === 1) return reject("no_change", "nothing to change");
  const wasAgent = e.agent;
  const rejection = applyAll(w, [{ type: ENGINE_EVENTS.entity, data }]);
  if (rejection) return rejection;
  return op.agent === true && !wasAgent ? caughtUp(w, op.entity) : null;
}

/**
 * Classes and tags, both whole: the chat holds them from then on, so they win over the world's
 * definition until an Upgrade takes the revision's. One that reads the same as now is refused,
 * since holding it would still keep an Upgrade from bringing the revision's in.
 */
function classifyOp(w: Working, op: Extract<EditOp, { op: "classify" }>): Rejection | null {
  const e = own(w.state.entities, op.entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, op.entity)}`);
  const classes = classOf(op.class);
  if (!classes) return reject("bad_args", "a classification is facet → values");
  const problem = classProblems(w.world, classes, e.name)[0];
  if (problem) return reject(problem.code, problem.message);
  const tags = [...new Set(op.tags.map((t) => t.trim()).filter((t) => t !== ""))];
  const sameAs = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
  const facets = new Set([...Object.keys(classes), ...Object.keys(w.world.classifications)]);
  const unchanged = [...facets].every((f) => sameAs(classValues(w.world, w.state, op.entity, f), classes[f] ?? [])) && sameAs(tagsOf(w.world, w.state, op.entity), tags);
  if (unchanged) return reject("no_change", "nothing to change");
  // What it read as before, kept in the event so its player line can say only what changed, the
  // same on every replay: which facets players see is read when the line is worded.
  const was = Object.fromEntries([...facets].flatMap((f) => {
    const values = classValues(w.world, w.state, op.entity, f);
    return values.length > 0 ? [[f, [...values]]] : [];
  }));
  return applyAll(w, [{ type: ENGINE_EVENTS.classes, data: { entity: op.entity, class: classes, tags, was } }]);
}

/** A life state, and who is told it (DESIGN §8): everyone with the entity learns a change anyway. Nothing to do is refused. */
function lifeOp(reg: Registry, w: Working, op: Extract<EditOp, { op: "life" }>, rng: Rng): Rejection | null {
  const before = w.events.length;
  const rejection = run(reg, w, [{ type: "life", args: { entity: op.entity, ...(op.to !== undefined ? { to: op.to } : {}), ...(op.tell !== undefined ? { tell: op.tell } : {}) } }], rng);
  if (rejection) return rejection;
  return w.events.length === before ? reject("no_change", "nothing to change") : null;
}

function spawnOp(reg: Registry, w: Working, op: Extract<EditOp, { op: "spawn" }>, rng: Rng): Rejection | null {
  const name = op.name.trim();
  if (name === "" || name.length > 80) return reject("bad_name", "a name is 1–80 characters");
  if (op.id !== undefined && (!safeKey(op.id) || own(w.state.entities, op.id))) return reject("bad_id", `${op.id} is taken or isn't an id`);
  if (op.tier !== undefined && !tierOf(w.world, op.tier)) return reject("bad_tier", `no tier ${op.tier}`);
  if (op.place !== undefined && !own(w.world.places, op.place)) return reject("missing_place", `no place ${labelOf(w, op.place)}`);
  const args: Record<string, JsonValue> = { kind: op.kind, name };
  if (op.id !== undefined) args.id = op.id;
  if (op.tier !== undefined) args.tier = op.tier;
  if (op.place !== undefined) args.place = op.place;
  if (op.agent !== undefined) args.agent = op.agent;
  return run(reg, w, [{ type: "spawn", args }], rng);
}

/**
 * Remove: out of the world, kept in state. Its relations go, and everyone's relations to it, so no
 * one knows, holds or belongs to what isn't there; what is inside it stays inside and goes with it.
 * Each pair is unlinked once: its own unlinks take the other side of a symmetric or inverse pair
 * with them, so only what others still hold toward it afterwards is left to unlink.
 */
function despawnOp(reg: Registry, w: Working, entity: EntityId, rng: Rng): Rejection | null {
  const e = own(w.state.entities, entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
  if (entity === w.world.pov) return reject("pov", "the point of view can't be removed");
  if (e.fields[GONE_FIELD] === true) return reject("gone", `${e.name} is already removed`);
  // Where it is, read before its container lets go of it: taken out, it keeps that place, so Restore brings it back there.
  const where = placeOfEntity(w.state, entity);
  const contained = typeof e.fields.place !== "string" && e.relations.some((r) => r.type === "in");
  const unlinked = run(reg, w, e.relations.map((r) => ({ type: "unlink", args: { rel: r.type, from: entity, to: r.to } })), rng.fork("own"));
  if (unlinked) return unlinked;
  const specs: EffectSpec[] = where && contained ? [{ type: "set", args: { entity, field: "place", value: where } }] : [];
  for (const id of Object.keys(w.state.entities).sort()) {
    if (id === entity) continue;
    for (const r of own(w.state.entities, id)?.relations ?? []) if (r.to === entity && r.type !== "in") specs.push({ type: "unlink", args: { rel: r.type, from: id, to: entity } });
  }
  specs.push({ type: "set", args: { entity, field: GONE_FIELD, value: true } });
  return run(reg, w, specs, rng.fork("others"));
}

function restoreOp(reg: Registry, w: Working, entity: EntityId, rng: Rng): Rejection | null {
  const e = own(w.state.entities, entity);
  if (!e) return reject("missing_entity", `no entity ${labelOf(w, entity)}`);
  if (e.fields[GONE_FIELD] !== true) return reject("not_gone", `${e.name} isn't removed`);
  const rejection = run(reg, w, [{ type: "set", args: { entity, field: GONE_FIELD, value: false } }], rng);
  if (rejection) return rejection;
  // An agent comes back caught up: the slots it was away for aren't replayed.
  return e.agent ? caughtUp(w, entity) : null;
}

/**
 * A pack effect the GM may run (`EffectDef.gm`): an asset's price, say, which no entity field holds.
 * Its arguments are literals, and it resolves through the effect's own checks and the event guards.
 */
function effectOp(reg: Registry, w: Working, op: Extract<EditOp, { op: "effect" }>, opts: EditOptions, rng: Rng): Rejection | null {
  const def = reg.effects.get(op.effect);
  if (!opts.gm || def?.gm !== true) return reject("not_editable", `${op.effect.replace(/[._]/g, " ")} isn't something the GM view can run`);
  const before = w.events.length;
  const rejection = run(reg, w, [{ type: op.effect, args: op.args }], rng);
  if (rejection) return rejection;
  return w.events.length === before ? reject("no_change", "nothing to change") : null;
}

function applyOp(reg: Registry, w: Working, op: EditOp, opts: EditOptions, rng: Rng): Rejection | null {
  switch (op.op) {
    case "set":
      return setField(reg, w, op.entity, op.field, op.value, opts, rng);
    case "add":
      return addField(reg, w, op.entity, op.field, op.delta, opts, rng);
    case "link":
      return linkOp(reg, w, op, rng);
    case "unlink":
      return run(reg, w, [{ type: "unlink", args: { rel: op.rel, from: op.from, to: op.to } }], rng);
    case "move":
      return run(reg, w, [{ type: "move", args: { entity: op.entity, to: op.to } }], rng);
    case "put":
      return putOp(reg, w, op.entity, op.into, rng);
    case "adjust":
      return adjustOp(reg, w, op.account, op.cents, rng);
    case "stage":
      return run(reg, w, [{ type: "stage", args: { track: op.track, to: op.to } }], rng);
    case "entity":
      return entityOp(w, op);
    case "classify":
      return classifyOp(w, op);
    case "life":
      return lifeOp(reg, w, op, rng);
    case "spawn":
      return spawnOp(reg, w, op, rng);
    case "despawn":
      return despawnOp(reg, w, op.entity, rng);
    case "restore":
      return restoreOp(reg, w, op.entity, rng);
    case "mind_pin":
    case "mind_refresh":
    case "mind_memory":
    case "mind_intent": {
      // A character's mind is the minds pack's (DESIGN §24.9): it words the control as its events.
      const edit = optionalService(w.ctx, "minds.edit");
      if (!edit) return reject("no_minds", "this world has no character minds");
      const out = edit(w.ctx, op);
      return Array.isArray(out) ? applyAll(w, out) : out;
    }
    case "routine_follow":
    case "routine_block":
    case "schedule_override": {
      // A character's routine and schedules in a chat are Cast life's (DESIGN §8): it words the control as its events.
      const edit = optionalService(w.ctx, "castlife.edit");
      if (!edit) return reject("no_castlife", "this world has no Cast life");
      const out = edit(w.ctx, op);
      return Array.isArray(out) ? applyAll(w, out) : out;
    }
    case "effect":
      return effectOp(reg, w, op, opts, rng);
    case "feed":
      // A section's settings in this chat (DESIGN §6.11): one event, so its Undo is the fix's.
      return w.apply({ type: FEED_EVENT, data: { section: op.section, to: op.to as JsonObject | null } });
  }
}

/**
 * Resolves operations in order against `state` (each sees the ones before it) into the events of
 * one `fix` entry, or the first operation's rejection; nothing applies unless all do.
 */
export function resolveEdit(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, ops: readonly EditOp[], opts: EditOptions): EditOutcome {
  const w = new Working(reg, world, state);
  const rng = createRng(hashParts("lre.edit", opts.runSeed, JSON.stringify(ops)));
  for (const [i, op] of ops.entries()) {
    const rejection = applyOp(reg, w, op, opts, rng.fork(`op:${i}`));
    if (rejection) return { rejection };
  }
  // What a GM sets them doing, and until when, is that activity's span (DESIGN §9.2), stamped as the
  // whole edit leaves them, where they are: Activity and Activity ends read together whether set in
  // one edit or one after the other, in either order. A player's ✎ of the activity takes no old end.
  const spans = w.events.flatMap((e) => (e.type === "set" && (e.field === "activity_until" || (opts.gm && e.field === "activity")) ? [e.entity] : []));
  for (const entity of new Set(spans)) {
    const fields = own(w.state.entities, entity)?.fields;
    if (typeof fields?.activity_until !== "number") continue;
    const rejection = applyAll(w, spanRecords(entity, fields));
    if (rejection) return { rejection };
  }
  // One submit is one unit: a rebased view keeps or drops it whole, as it does a purchase.
  const group = w.events.length > 1 ? `edit:${hashParts(JSON.stringify(w.events)).slice(0, 10)}` : undefined;
  return { events: group ? w.events.map((e) => ({ ...e, group })) : [...w.events] };
}

const str = (v: unknown): v is string => typeof v === "string";

/**
 * Operations from a request, checked for shape (the frontend is outside data): null when any is
 * malformed or there are none or too many. What they name is checked when they resolve.
 */
export function parseEditOps(raw: unknown): EditOp[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > EDIT_OPS_MAX) return null;
  const out: EditOp[] = [];
  for (const o of raw) {
    if (!isRecord(o)) return null;
    const op = ((): EditOp | null => {
      switch (o.op) {
        case "set":
          return str(o.entity) && str(o.field) && o.value !== undefined ? { op: "set", entity: o.entity, field: o.field, value: o.value as JsonValue } : null;
        case "add":
          return str(o.entity) && str(o.field) && typeof o.delta === "number" ? { op: "add", entity: o.entity, field: o.field, delta: o.delta } : null;
        case "link":
          if (!str(o.rel) || !str(o.from) || !str(o.to) || (o.fields !== undefined && !isRecord(o.fields)) || (o.until !== undefined && typeof o.until !== "number")) return null;
          return { op: "link", rel: o.rel, from: o.from, to: o.to, ...(isRecord(o.fields) ? { fields: o.fields as JsonObject } : {}), ...(typeof o.until === "number" ? { until: o.until } : {}) };
        case "unlink":
          return str(o.rel) && str(o.from) && str(o.to) ? { op: "unlink", rel: o.rel, from: o.from, to: o.to } : null;
        case "move":
          return str(o.entity) && str(o.to) ? { op: "move", entity: o.entity, to: o.to } : null;
        case "put":
          return str(o.entity) && (o.into === null || str(o.into)) ? { op: "put", entity: o.entity, into: o.into } : null;
        case "adjust":
          return str(o.account) && typeof o.cents === "number" ? { op: "adjust", account: o.account, cents: o.cents } : null;
        case "stage":
          return str(o.track) && str(o.to) ? { op: "stage", track: o.track, to: o.to } : null;
        case "entity": {
          if (!str(o.entity) || (o.tier !== undefined && !str(o.tier)) || (o.agent !== undefined && typeof o.agent !== "boolean")) return null;
          if (o.levels !== undefined && !(isRecord(o.levels) && Object.values(o.levels).every((v) => v === null || typeof v === "number"))) return null;
          const levels: Record<string, number | null> = isRecord(o.levels) ? Object.fromEntries(Object.entries(o.levels).map(([d, v]) => [d, typeof v === "number" ? v : null])) : {};
          return { op: "entity", entity: o.entity, ...(str(o.tier) ? { tier: o.tier } : {}), ...(typeof o.agent === "boolean" ? { agent: o.agent } : {}), ...(isRecord(o.levels) ? { levels } : {}) };
        }
        case "classify": {
          if (!str(o.entity) || !isRecord(o.class) || !Array.isArray(o.tags) || !o.tags.every(str)) return null;
          const classes: Record<string, string[]> = {};
          for (const [facet, values] of Object.entries(o.class)) {
            if (!safeKey(facet) || !Array.isArray(values) || !values.every(str)) return null;
            classes[facet] = values.filter(str);
          }
          return { op: "classify", entity: o.entity, class: classes, tags: o.tags.filter(str) };
        }
        case "life":
          if (!str(o.entity) || (o.to !== undefined && !str(o.to)) || (o.tell !== undefined && !(Array.isArray(o.tell) && o.tell.every(str))) || (o.to === undefined && o.tell === undefined)) return null;
          return { op: "life", entity: o.entity, ...(str(o.to) ? { to: o.to } : {}), ...(Array.isArray(o.tell) ? { tell: o.tell.filter(str) } : {}) };
        case "spawn":
          if (!str(o.kind) || !str(o.name) || [o.id, o.tier, o.place].some((v) => v !== undefined && !str(v)) || (o.agent !== undefined && typeof o.agent !== "boolean")) return null;
          return { op: "spawn", kind: o.kind, name: o.name, ...(str(o.id) ? { id: o.id } : {}), ...(str(o.tier) ? { tier: o.tier } : {}), ...(str(o.place) ? { place: o.place } : {}), ...(typeof o.agent === "boolean" ? { agent: o.agent } : {}) };
        case "despawn":
        case "restore":
          return str(o.entity) ? { op: o.op, entity: o.entity } : null;
        case "mind_pin":
          return str(o.entity) && (o.level === null || o.level === "live" || o.level === "near" || o.level === "far" || o.level === "background") ? { op: "mind_pin", entity: o.entity, level: o.level } : null;
        case "mind_refresh":
          return str(o.entity) ? { op: "mind_refresh", entity: o.entity } : null;
        case "mind_memory":
          if (!str(o.entity) || (o.part !== "note" && o.part !== "commitment" && o.part !== "plan") || !(o.id === null || str(o.id)) || !(o.value === null || isRecord(o.value))) return null;
          return { op: "mind_memory", entity: o.entity, part: o.part, id: o.id, value: o.value as JsonObject | null };
        case "mind_intent":
          // Each part is optional (absent keeps it), but one of them must be there.
          if (!str(o.entity) || (o.text !== undefined && !str(o.text)) || (o.approach !== undefined && o.approach !== null && o.approach !== "reactive" && o.approach !== "proactive") || (o.text === undefined && o.approach === undefined)) return null;
          return { op: "mind_intent", entity: o.entity, ...(str(o.text) ? { text: o.text } : {}), ...(o.approach !== undefined ? { approach: o.approach } : {}) };
        case "routine_follow": {
          // Each part is optional (absent keeps it), but one of them must be there; null returns it to the world's (the role and the skip life to their level's).
          const mode = o.mode === undefined || o.mode === null || ROUTINE_MODES.some((m) => m === o.mode);
          const awareness = o.awareness === undefined || o.awareness === null || ROUTINE_AWARENESS.some((a) => a === o.awareness);
          const role = o.role === undefined || o.role === null || ROUTINE_ROLES.some((r) => r === o.role);
          const skips = o.skips === undefined || o.skips === null || SKIP_LIVES.some((s) => s === o.skips);
          if (!str(o.entity) || !mode || !awareness || !role || !skips || (o.mode === undefined && o.awareness === undefined && o.role === undefined && o.skips === undefined)) return null;
          return { op: "routine_follow", entity: o.entity, ...(o.mode !== undefined ? { mode: ROUTINE_MODES.find((m) => m === o.mode) ?? null } : {}), ...(o.awareness !== undefined ? { awareness: ROUTINE_AWARENESS.find((a) => a === o.awareness) ?? null } : {}), ...(o.role !== undefined ? { role: ROUTINE_ROLES.find((r) => r === o.role) ?? null } : {}), ...(o.skips !== undefined ? { skips: SKIP_LIVES.find((s) => s === o.skips) ?? null } : {}) };
        }
        case "routine_block":
          // The block's shape is checked when it resolves, against the chat's own sources.
          if (!str(o.entity) || !str(o.block) || !(o.value === null || isRecord(o.value))) return null;
          return { op: "routine_block", entity: o.entity, block: o.block, value: o.value as RoutineEntry | null };
        case "schedule_override":
          if (!str(o.entity) || !str(o.schedule) || !(o.value === null || isRecord(o.value))) return null;
          return { op: "schedule_override", entity: o.entity, schedule: o.schedule, value: o.value as ChatScheduleChange | null };
        case "effect":
          return str(o.effect) && isRecord(o.args) ? { op: "effect", effect: o.effect, args: o.args as JsonObject } : null;
        case "feed": {
          if (!str(o.section) || o.section.trim() === "") return null;
          if (o.to === null) return { op: "feed", section: o.section, to: null };
          const to = readSectionFeed(o.to);
          return to ? { op: "feed", section: o.section, to } : null;
        }
        default:
          return null;
      }
    })();
    if (!op) return null;
    out.push(op);
  }
  return out;
}
