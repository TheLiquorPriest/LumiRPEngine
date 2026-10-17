// Core event types and marker reducers (DESIGN §3 Effects → Events, §4.3 markers).
//
// These and the pack-registered event types are the only code the reference fold and the
// optimized fold share (DESIGN §14). Validation answers "may this event apply to this state?";
// a rebased view drops an event whose validation fails. Reducers mutate a working copy.

import type { JsonValue } from "../shared/json";
import { readAdjudication } from "../shared/adjudication";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { DomainId, EntityId, Level } from "../shared/ids";
import { BANDS, DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import type {
  AddEvent,
  ClockEvent,
  CoreEvent,
  EntityPicks,
  LedgerEvent,
  LinkEvent,
  MarkerBody,
  MaterializeEvent,
  PostEvent,
  SetEvent,
  SpawnEvent,
  StageEvent,
  TimelapseEvent,
  UnlinkEvent,
  UpgradePick,
  UpgradePicks,
} from "../shared/ledger";
import { UPGRADE_ASPECTS } from "../shared/ledger";
import type { EventTypeDef, ReadContext, Rejection } from "./registry";
import type { WorldState } from "./state";
import { touch } from "./touched";
import { migrate, type MarkerEnv } from "./upgrade";

/** Accounts outside the world: counterparties without numeric money (DESIGN §9.2). */
export const EXTERNAL_ACCOUNT_PREFIX = "economy.external:";

/** Looks up a registered event type; the engine registers the core types first. */
export interface EventTypes {
  get(type: string): EventTypeDef | undefined;
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

function hasEntity(state: Readonly<WorldState>, id: EntityId): boolean {
  return safeKey(id) && hasOwn(state.entities, id);
}

/** An entity's display name for describers (never a raw id when a name exists). */
function nameOf(ctx: ReadContext, id: EntityId): string {
  if (id === ctx.world.pov) return "you";
  return (hasEntity(ctx.state, id) ? ctx.state.entities[id]?.name : undefined) ?? (hasOwn(ctx.world.places, id) ? ctx.world.places[id]?.name : undefined) ?? id;
}

const setDef: EventTypeDef<SetEvent> = {
  type: "set",
  validate: (e, ctx) => (!hasEntity(ctx.state, e.entity) ? reject("missing_entity", `no entity ${e.entity}`) : safeKey(e.field) ? null : reject("bad_field", "not a field name")),
  apply: (e, state) => {
    const entity = hasEntity(state, e.entity) ? state.entities[e.entity] : undefined;
    if (entity && safeKey(e.field)) entity.fields[e.field] = e.value;
  },
  touches: (e) => [{ entity: e.entity, field: e.field }],
  describe: (e, ctx) => `${nameOf(ctx, e.entity)}: ${e.field.replace(/_/g, " ")} ${typeof e.value === "string" || typeof e.value === "number" || typeof e.value === "boolean" ? `is now ${String(e.value)}` : "changed"}`,
};

const addDef: EventTypeDef<AddEvent> = {
  type: "add",
  validate: (e, ctx) => {
    if (!hasEntity(ctx.state, e.entity)) return reject("missing_entity", `no entity ${e.entity}`);
    if (!safeKey(e.field)) return reject("bad_field", "not a field name");
    const current = ctx.state.entities[e.entity]?.fields[e.field];
    if (current !== undefined && typeof current !== "number") return reject("not_numeric", `${e.entity}.${e.field} is not a number`);
    return Number.isFinite(e.delta) ? null : reject("bad_delta", "delta must be finite");
  },
  apply: (e, state) => {
    const entity = hasEntity(state, e.entity) ? state.entities[e.entity] : undefined;
    if (!entity || !safeKey(e.field)) return;
    const current = entity.fields[e.field];
    entity.fields[e.field] = (typeof current === "number" ? current : 0) + e.delta;
  },
  touches: (e) => [{ entity: e.entity, field: e.field }],
  describe: (e, ctx) => `${nameOf(ctx, e.entity)}: ${e.field.replace(/_/g, " ")} ${e.delta >= 0 ? "+" : ""}${e.delta}`,
};

function isAccount(state: Readonly<WorldState>, account: EntityId): boolean {
  return account.startsWith(EXTERNAL_ACCOUNT_PREFIX) || hasEntity(state, account);
}

const postDef: EventTypeDef<PostEvent> = {
  type: "post",
  validate: (e, ctx) => {
    if (e.lines.length < 2) return reject("unbalanced", "a posting needs two lines");
    let sum = 0;
    for (const line of e.lines) {
      if (!Number.isSafeInteger(line.amount)) return reject("bad_amount", "amounts are integer cents");
      if (!isAccount(ctx.state, line.account)) return reject("missing_account", `no account ${line.account}`);
      sum += line.amount;
    }
    return sum === 0 ? null : reject("unbalanced", `posting sums to ${sum}`);
  },
  apply: (e, state) => {
    for (const line of e.lines) if (safeKey(line.account)) state.accounts[line.account] = (hasOwn(state.accounts, line.account) ? (state.accounts[line.account] ?? 0) : 0) + line.amount;
  },
  touches: (e) => e.lines.filter((l) => !l.account.startsWith(EXTERNAL_ACCOUNT_PREFIX)).map((l) => ({ entity: l.account, aspect: "posted" })),
  describe: (e) => e.memo,
};

const linkDef: EventTypeDef<LinkEvent> = {
  type: "link",
  // Both ends are entities, except that a `knows` link may point at a place (hearing of it, DESIGN §7).
  validate: (e, ctx) => (hasEntity(ctx.state, e.from) && (hasEntity(ctx.state, e.to) || (e.rel === "knows" && safeKey(e.to) && hasOwn(ctx.world.places, e.to))) ? null : reject("missing_entity", `link ${e.from} → ${e.to}`)),
  apply: (e, state) => {
    const entity = hasEntity(state, e.from) ? state.entities[e.from] : undefined;
    if (!entity) return;
    entity.relations = entity.relations.filter((r) => !(r.type === e.rel && r.to === e.to));
    entity.relations.push({ type: e.rel, to: e.to, ...(e.fields ? { fields: e.fields } : {}), ...(e.until !== undefined ? { until: e.until } : {}) });
  },
  touches: (e) => [{ entity: e.from, rel: e.rel, to: e.to }],
  describe: (e, ctx) => `${nameOf(ctx, e.from)} ${e.rel.replace(/_/g, " ")} ${nameOf(ctx, e.to)}`,
};

const unlinkDef: EventTypeDef<UnlinkEvent> = {
  type: "unlink",
  validate: (e, ctx) => {
    const entity = hasEntity(ctx.state, e.from) ? ctx.state.entities[e.from] : undefined;
    return entity && entity.relations.some((r) => r.type === e.rel && r.to === e.to) ? null : reject("missing_relation", `no ${e.rel} from ${e.from} to ${e.to}`);
  },
  apply: (e, state) => {
    const entity = hasEntity(state, e.from) ? state.entities[e.from] : undefined;
    if (entity) entity.relations = entity.relations.filter((r) => !(r.type === e.rel && r.to === e.to));
  },
  touches: (e) => [{ entity: e.from, rel: e.rel, to: e.to }],
  describe: (e, ctx) => `${nameOf(ctx, e.from)} no longer ${e.rel.replace(/_/g, " ")} ${nameOf(ctx, e.to)}`,
};

const spawnDef: EventTypeDef<SpawnEvent> = {
  type: "spawn",
  validate: (e, ctx) => (!safeKey(e.entity.id) ? reject("bad_id", "not an entity id") : hasEntity(ctx.state, e.entity.id) ? reject("exists", `entity ${e.entity.id} exists`) : null),
  apply: (e, state) => {
    const d = e.entity;
    if (!safeKey(d.id)) return;
    state.entities[d.id] = {
      kind: d.kind,
      name: d.name,
      tier: d.tier,
      fields: structuredClone(d.fields),
      relations: structuredClone(d.relations),
      levels: { ...(d.levels ?? {}) },
      agent: d.agent === true,
      // Only when given, so a spawn without them folds to the same state as before they existed.
      ...(d.class ? { class: structuredClone(d.class) } : {}),
      ...(d.tags ? { tags: [...d.tags] } : {}),
    };
  },
  touches: (e) => [{ entity: e.entity.id, aspect: "spawned" }],
  describe: (e) => `${e.entity.name} appears`,
};

const stageDef: EventTypeDef<StageEvent> = {
  type: "stage",
  validate: (e, ctx) => {
    const track = safeKey(e.track) && hasOwn(ctx.world.tracks, e.track) ? ctx.world.tracks[e.track] : undefined;
    if (!track) return reject("missing_track", `no track ${e.track}`);
    return safeKey(e.to) && hasOwn(track.stages, e.to) ? null : reject("missing_stage", `no stage ${e.to} in ${e.track}`);
  },
  apply: (e, state) => {
    if (safeKey(e.track)) state.tracks[e.track] = { stage: e.to, since: state.clock };
  },
  // Labels, not ids; whether the player may see a track's stages is the caller's check (eventVisible).
  describe: (e, ctx) => {
    const track = hasOwn(ctx.world.tracks, e.track) ? ctx.world.tracks[e.track] : undefined;
    return `${track?.label ?? "A thread"}: ${(track && hasOwn(track.stages, e.to) ? track.stages[e.to]?.label : undefined) ?? "moved on"}`;
  },
};

const clockDef: EventTypeDef<ClockEvent> = {
  type: "clock",
  validate: (e) => (Number.isFinite(e.minutes) && e.minutes >= 0 ? null : reject("bad_minutes", "minutes must be ≥ 0")),
  apply: (e, state) => {
    state.clock += e.minutes;
  },
  describe: (e) => `+${e.minutes} min`,
};

const timelapseDef: EventTypeDef<TimelapseEvent> = {
  type: "timelapse",
  validate: (e) => (e.to >= e.from ? null : reject("bad_interval", "timelapse ends before it starts")),
  apply: () => undefined,
  describe: (e) => `timelapse ${e.to - e.from} min`,
};

/** Registers the core event types; `materialize` needs the full table to validate nested events. */
export function coreEventTypes(lookup: () => EventTypes): EventTypeDef[] {
  const materializeDef: EventTypeDef<MaterializeEvent> = {
    type: "materialize",
    validate: (e, ctx) => {
      if (!hasEntity(ctx.state, e.entity)) return reject("missing_entity", `no entity ${e.entity}`);
      // Detail is sampled once per entity and domain (DESIGN §9.2): a second one, such as a carried
      // ✎ cash fix's when the new swipe already opened the accounts, would post their opening again.
      if (hasOwn(ctx.state.materialized, `${e.entity}:${e.domain}`)) return reject("materialized", `${e.domain} detail for ${nameOf(ctx, e.entity)} is already recorded`);
      // Nested events validate in sequence against the state they will see.
      const scratch = structuredClone(ctx.state) as WorldState;
      for (const inner of e.events) {
        const failure = validateEvent(lookup(), inner, { ...ctx, state: scratch });
        if (failure) return failure;
        applyEvent(lookup(), inner, scratch, { ...ctx, state: scratch });
      }
      return null;
    },
    apply: (e, state, ctx) => {
      for (const inner of e.events) applyEvent(lookup(), inner, state, ctx);
      state.materialized[`${e.entity}:${e.domain}`] = { generatorVersion: e.generatorVersion, tablesRevision: e.tablesRevision };
    },
    describe: (e) => `${e.entity} ${e.domain} detail`,
  };
  const defs: EventTypeDef<CoreEvent>[] = [setDef, addDef, postDef, linkDef, unlinkDef, spawnDef, stageDef, clockDef, materializeDef, timelapseDef];
  return defs as EventTypeDef[];
}

export function validateEvent(types: EventTypes, event: LedgerEvent, ctx: ReadContext): Rejection | null {
  const def = types.get(event.type);
  if (!def) return reject("unknown_event", `unknown event type ${event.type}`);
  return def.validate(event, ctx);
}

export function applyEvent(types: EventTypes, event: LedgerEvent, state: WorldState, ctx: ReadContext): void {
  const def = types.get(event.type);
  if (def) def.apply(event, state, ctx);
}

/**
 * A list's units as `[from, to)` index ranges: a run of contiguous events that share a `group`,
 * else one event (DESIGN §4.3, with event groups).
 */
export function eventUnits(events: readonly LedgerEvent[]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < events.length) {
    const group = events[i]?.group;
    let j = i + 1;
    if (group !== undefined) while (j < events.length && events[j]?.group === group) j++;
    out.push([i, j]);
    i = j;
  }
  return out;
}

/**
 * Applies, in order, each unit whose events all validate; a unit with any failing member is
 * skipped whole. Returns the events applied. Plans, reads and prefix replays use it.
 */
export function applyValidUnits(types: EventTypes, events: readonly LedgerEvent[], state: WorldState, context: (state: Readonly<WorldState>) => ReadContext): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const [from, to] of eventUnits(events)) {
    const unit = events.slice(from, to);
    if (unit.length > 1) {
      const scratch = structuredClone(state);
      const fits = unit.every((ev) => {
        const ctx = context(scratch);
        if (validateEvent(types, ev, ctx)) return false;
        applyEvent(types, ev, scratch, ctx);
        return true;
      });
      if (!fits) continue;
    }
    for (const ev of unit) {
      const ctx = context(state);
      if (unit.length === 1 && validateEvent(types, ev, ctx)) break;
      applyEvent(types, ev, state, ctx);
      out.push(ev);
    }
  }
  return out;
}

// ---------------------------------------------------------------- markers

const TIME_CONTROLS = ["tick", "scale", "pause", "interrupt", "speed_through", "montage", "unit_cap", "npc_calls"] as const;

/** Bounds for time controls (DESIGN §9.2): minutes per tick, the time scale, the unit cap and NPC calls. */
export const TIME_BOUNDS = Object.freeze({ tick: [0, 1440], scale: [0.25, 10], thresholdMinutes: [1, 10_080], agentDays: [1, 600], events: [1, 5000], npcCalls: [0, 50] } as const);

function clamp(v: number, [lo, hi]: readonly [number, number], integer = true): number {
  const x = Math.min(hi, Math.max(lo, v));
  return integer ? Math.round(x) : x;
}

/** A time control's value, clamped to its bounds; undefined when it isn't that control's shape. */
function timeValue(control: (typeof TIME_CONTROLS)[number], to: unknown): JsonValue | undefined {
  const num = typeof to === "number" && Number.isFinite(to) ? to : null;
  switch (control) {
    case "tick":
      return num === null ? undefined : clamp(num, TIME_BOUNDS.tick);
    case "scale":
      return num === null ? undefined : clamp(num, TIME_BOUNDS.scale, false);
    case "npc_calls":
      return num === null ? undefined : clamp(num, TIME_BOUNDS.npcCalls);
    case "pause":
      return typeof to === "boolean" ? to : undefined;
    case "interrupt":
      return to === "stop" || to === "note" || to === "ignore" ? to : undefined;
    case "montage":
      return to === "key" || to === "day" || to === "week" ? to : undefined;
    case "speed_through":
      return isRecord(to) && (to.mode === "offer" || to.mode === "auto") && typeof to.thresholdMinutes === "number" && Number.isFinite(to.thresholdMinutes) ? { mode: to.mode, thresholdMinutes: clamp(to.thresholdMinutes, TIME_BOUNDS.thresholdMinutes) } : undefined;
    case "unit_cap":
      return isRecord(to) && typeof to.agentDays === "number" && typeof to.events === "number" && Number.isFinite(to.agentDays) && Number.isFinite(to.events) ? { agentDays: clamp(to.agentDays, TIME_BOUNDS.agentDays), events: clamp(to.events, TIME_BOUNDS.events) } : undefined;
  }
}

/** The most picks one Upgrade marker may carry: it is stored on a message, so it stays small. */
export const UPGRADE_PICKS_MAX = 5000;

function isPick(v: unknown): v is UpgradePick {
  return v === "take" || v === "keep";
}

/**
 * An Upgrade's picks from outside: entity, field, relation type and target keys must be safe map
 * keys and every pick one of its values. Anything else, or more than `UPGRADE_PICKS_MAX` picks,
 * makes the whole marker invalid, since a pick quietly dropped could take a value the owner meant
 * to keep. Entities left with no picks are dropped.
 */
function validPicks(raw: unknown): UpgradePicks | null {
  if (!isRecord(raw)) return null;
  const out: UpgradePicks = {};
  let count = 0;
  for (const [id, p] of Object.entries(raw)) {
    if (!safeKey(id) || !isRecord(p)) return null;
    const picks: EntityPicks = {};
    for (const [key, v] of Object.entries(p)) {
      if (key === "entity") {
        if (v !== "take" && v !== "keep" && v !== "remove") return null;
        picks.entity = v;
        count++;
      } else if (key === "fields") {
        if (!isRecord(v)) return null;
        const fields: Record<string, UpgradePick> = {};
        for (const [field, pick] of Object.entries(v)) {
          if (!safeKey(field) || !isPick(pick)) return null;
          fields[field] = pick;
          count++;
        }
        if (Object.keys(fields).length > 0) picks.fields = fields;
      } else if (key === "relations") {
        if (!isRecord(v)) return null;
        const relations: Record<string, Record<string, UpgradePick>> = {};
        for (const [rel, targets] of Object.entries(v)) {
          if (!safeKey(rel) || !isRecord(targets)) return null;
          const byTarget: Record<string, UpgradePick> = {};
          for (const [to, pick] of Object.entries(targets)) {
            if (!safeKey(to) || !isPick(pick)) return null;
            byTarget[to] = pick;
            count++;
          }
          if (Object.keys(byTarget).length > 0) relations[rel] = byTarget;
        }
        if (Object.keys(relations).length > 0) picks.relations = relations;
      } else {
        const aspect = UPGRADE_ASPECTS.find((a) => a === key);
        if (!aspect || !isPick(v)) return null;
        picks[aspect] = v;
        count++;
      }
      if (count > UPGRADE_PICKS_MAX) return null;
    }
    if (Object.keys(picks).length > 0) out[id] = picks;
  }
  return out;
}

/**
 * A marker body from outside (a request, a stored or imported ledger), checked and clamped; null
 * when it isn't one. Domains, bands and interrupt classes come from their fixed lists; entity,
 * scene type and activity keys must be safe map keys; levels are whole numbers 0–4; an Upgrade's
 * picks pass `validPicks`.
 */
export function validMarkerBody(raw: unknown): MarkerBody | null {
  if (!isRecord(raw)) return null;
  const scope = isRecord(raw.scope) ? raw.scope : null;
  switch (raw.kind) {
    case "migrate": {
      if (typeof raw.to !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.to)) return null;
      if (raw.merge === undefined) return { kind: "migrate", to: raw.to };
      const merge = validPicks(raw.merge);
      return merge ? { kind: "migrate", to: raw.to, merge } : null;
    }
    case "resolve": {
      const domain = DOMAINS.find((d) => d === raw.domain);
      const to = raw.to;
      if (!domain || !scope || typeof to !== "number" || !Number.isInteger(to) || to < 0 || to > 4) return null;
      const level = to as Level;
      if (scope.all === true) return { kind: "resolve", domain, scope: { all: true }, to: level };
      const band = BANDS.find((b) => b === scope.tier);
      if (band) return { kind: "resolve", domain, scope: { tier: band }, to: level };
      return safeKey(scope.entity) ? { kind: "resolve", domain, scope: { entity: scope.entity }, to: level } : null;
    }
    case "time": {
      const control = TIME_CONTROLS.find((c) => c === raw.control);
      if (!control || !scope) return null;
      const to = timeValue(control, raw.to);
      if (to === undefined) return null;
      if (scope.all === true) return { kind: "time", control, scope: { all: true }, to };
      if (safeKey(scope.sceneType)) return { kind: "time", control, scope: { sceneType: scope.sceneType }, to };
      if (safeKey(scope.activity)) return { kind: "time", control, scope: { activity: scope.activity }, to };
      const interrupt = INTERRUPT_CLASSES.find((c) => c === scope.interrupt);
      return interrupt ? { kind: "time", control, scope: { interrupt }, to } : null;
    }
    case "adjudicate": {
      const to = readAdjudication(raw.to);
      return to ? { kind: "adjudicate", to } : null;
    }
    default:
      return null;
  }
}

function setTimeControl(state: WorldState, body: Extract<MarkerBody, { kind: "time" }>): void {
  const t = state.time;
  const scope = body.scope;
  const to = body.to;
  switch (body.control) {
    case "tick":
      if ("sceneType" in scope && typeof to === "number") t.sceneTicks[scope.sceneType] = to;
      return;
    case "scale":
      if (typeof to === "number") t.scale = to;
      return;
    case "pause":
      if (typeof to === "boolean") t.paused = to;
      return;
    case "interrupt":
      if ("interrupt" in scope && (to === "stop" || to === "note" || to === "ignore")) t.interrupts[scope.interrupt] = to;
      return;
    case "speed_through":
      if ("activity" in scope && isRecord(to) && (to.mode === "offer" || to.mode === "auto") && typeof to.thresholdMinutes === "number") {
        t.speedThrough[scope.activity] = { mode: to.mode, thresholdMinutes: to.thresholdMinutes };
      }
      return;
    case "montage":
      if (to === "key" || to === "day" || to === "week") t.montage = to;
      return;
    case "unit_cap":
      if (isRecord(to) && typeof to.agentDays === "number" && typeof to.events === "number") t.unitCap = { agentDays: to.agentDays, events: to.events };
      return;
    case "npc_calls":
      if (typeof to === "number") t.npcCalls = to;
      return;
  }
}

function setLevel(state: WorldState, domain: DomainId, scope: Extract<MarkerBody, { kind: "resolve" }>["scope"], to: Level): void {
  if ("all" in scope) state.realism.levels[domain] = to;
  else if ("tier" in scope) {
    if (hasOwn(state.realism.tierCaps, scope.tier)) state.realism.tierCaps[scope.tier][domain] = to;
  } else {
    const entity = hasEntity(state, scope.entity) ? state.entities[scope.entity] : undefined;
    if (!entity) return;
    entity.levels[domain] = to;
    // A level set for one entity in play is a change an Upgrade keeps by default.
    touch(state, { entity: scope.entity, aspect: "levels" });
  }
}

/**
 * Applies a marker's intent and returns the Journal notes it makes. `migrate` switches the revision
 * in force; with picks it also merges the revision's definition changes into the state, reading the
 * revisions through `env` (`upgrade.ts`). The body is re-checked here, so a marker that slipped past
 * the write path (an old or imported ledger) can never index state with an unchecked key.
 */
export function applyMarker(state: WorldState, raw: Exclude<MarkerBody, { kind: "migrate" }>): string[];
export function applyMarker(state: WorldState, raw: MarkerBody, env: MarkerEnv): string[];
export function applyMarker(state: WorldState, raw: MarkerBody, env?: MarkerEnv): string[] {
  const body = validMarkerBody(raw);
  if (!body) return [];
  switch (body.kind) {
    case "migrate":
      if (!env) throw new Error("an Upgrade marker needs the world revisions to apply");
      return migrate(state, body, env);
    case "resolve":
      setLevel(state, body.domain, body.scope, body.to);
      return [];
    case "time":
      setTimeControl(state, body);
      return [];
    case "adjudicate":
      state.adjudication = body.to;
      return [];
  }
}
