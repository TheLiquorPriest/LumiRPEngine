// Simulation (DESIGN §4.3 seeds, §8, §9.2): stepping the world through game time.
//
// Time is cut into slots, one per calendar day part. Moving the clock from A to B completes every
// slot that ends in (A, B]; each completed slot is stepped exactly once, whatever the turns or
// timelapse segments that cross it, so skipping N days equals N one-day steps and any
// segmentation of the same interval. Within the interval, schedule edges apply at their own
// instants (LOD0) and each completed slot runs, in order:
//   1. the clock to the slot's end;
//   2. world processes (`ProcessDef`, scope `world`), each with per-entity process seeds
//      `hash(runSeed, process, entity, slotIndex)`;
//   3. in a timelapse, every LOD1 agent (and the POV) through its agent processes;
//   4. slot and day rules (event rules fire as events land), then tracks.
// Off-screen LOD1 agents outside a timelapse catch up K per turn from a round-robin queue
// (`catchUp`); whatever is left is the deterministic backlog: each agent's cursor trails the clock.
// Every bound is a deterministic unit (slots, agent-days, events), never wall clock.

import type { EntityId, InterruptClass, InterruptPolicy } from "../shared/ids";
import { INTERRUPT_CLASSES } from "../shared/ids";
import { hashJson, hashParts } from "../shared/hash";
import type { ClockEvent, LedgerEvent } from "../shared/ledger";
import { calendarOf, MINUTES_PER_DAY, slotIndexAt, slotOf, slotsEnding, type Slot } from "./calendar";
import { ENGINE_EVENTS, readEngineSlice, signalOf, type Signal } from "./engine-pack";
import { EXTERNAL_ACCOUNT_PREFIX } from "./events";
import type { ProcessDef, ReadContext, SlotInfo } from "./registry";
import { rulesetFloor, type Registry } from "./registry-impl";
import { createRng, type Rng } from "./rng";
import { runRulesOnEvents, runRulesOnTick, type RuleFiring } from "./rules";
import { allSchedules, instantEvents, scheduleInstants, type ScheduleInstant } from "./schedules";
import { isGone } from "./scope";
import { lostObservations, unobserved } from "./seen";
import type { WorldState } from "./state";
import { dropTouches } from "./touched";
import { own } from "./pack-kit";
import type { WorldDoc } from "../shared/world";
import { stepTracks, type TrackChange } from "./tracks";
import { Working } from "./working";
import { minutesBetween } from "./world-state";
import { clampUnitCap } from "./time-limits";

// Agent processes (`ProcessDef.scope === "agent"`) step once per LOD1 agent (and the POV in a
// timelapse) with that agent as `agent`. During catch-up the state's clock may be past the slot:
// they read the slot's `start`/`end`, never `ctx.state.clock`.

export function processSeed(runSeed: string, process: string, entity: EntityId, slotIndex: number): string {
  return hashParts(runSeed, process, entity, slotIndex);
}

/** LOD1 agents, by id; one a GM removed is out of the world and steps no more. */
export function lod1Agents(state: Readonly<WorldState>): EntityId[] {
  return Object.keys(state.entities)
    .filter((id) => own(state.entities, id)?.agent === true && !isGone(state, id))
    .sort();
}

/** The last slot an agent has been stepped through; before any step, the slot before the world's start. */
export function agentCursor(world: ReadContext["world"], state: Readonly<WorldState>, agent: EntityId): number {
  const recorded = own(readEngineSlice(state).agents, agent);
  if (recorded !== undefined) return recorded;
  const cal = calendarOf(world);
  return slotIndexAt(cal, minutesBetween(world.calendar.epoch, world.start.at)) - 1;
}

/** The last fully completed slot at the current clock. */
export function completedSlot(world: ReadContext["world"], state: Readonly<WorldState>): number {
  return slotIndexAt(calendarOf(world), state.clock) - 1;
}

export interface AdvanceOptions {
  runSeed: string;
  mode: "turn" | "timelapse";
  /** Clock event cause for the interval. */
  cause?: ClockEvent["cause"];
  /** Timelapse: step the POV's own agent processes like an LOD1 agent (default true). */
  includePov?: boolean;
  /** Per-run interrupt overrides on top of `state.time.interrupts`. */
  interrupts?: Partial<Record<InterruptClass, InterruptPolicy>>;
  /** Timelapse unit cap per segment; default `state.time.unitCap`. */
  unitCap?: { agentDays: number; events: number };
  /** A target predicate checked after each slot (a track reaching a stage). */
  stopWhen?: (w: Working) => boolean;
}

export interface AdvanceResult {
  from: number;
  /** Where the clock stopped. */
  to: number;
  requested: number;
  slots: number;
  stop: "target" | "interrupt" | "cap" | "predicate";
  stoppedBy: InterruptClass | null;
  stops: Signal[];
  notes: Signal[];
  agentDays: number;
  events: number;
  rules: RuleFiring[];
  tracks: TrackChange[];
}

/** Interrupt policy per class for a run. */
export function interruptPolicy(state: Readonly<WorldState>, overrides: Partial<Record<InterruptClass, InterruptPolicy>> = {}): Record<InterruptClass, InterruptPolicy> {
  const out = {} as Record<InterruptClass, InterruptPolicy>;
  for (const c of INTERRUPT_CLASSES) out[c] = overrides[c] ?? own(state.time.interrupts, c) ?? "ignore";
  return out;
}

/** Every class at `note`: the policy of an applied `time.advance` and its catch-up. */
export const ALL_NOTE: Record<InterruptClass, InterruptPolicy> = Object.fromEntries(INTERRUPT_CLASSES.map((c) => [c, "note"])) as Record<InterruptClass, InterruptPolicy>;

function rngFactory(runSeed: string, process: string, slot: number): (entity: EntityId) => Rng {
  return (entity) => createRng(processSeed(runSeed, process, entity, slot));
}

/** Steps one agent through one slot: its agent processes at its effective level. */
function stepAgent(reg: Registry, w: Working, agent: EntityId, slot: Slot, runSeed: string): LedgerEvent[] {
  const applied: LedgerEvent[] = [];
  for (const def of reg.processes) {
    if (def.scope !== "agent") continue;
    if (w.ctx.levelOf(agent, def.domain) < def.minLevel) continue;
    applied.push(...w.applyAll(def.step({ start: slot.start, end: slot.end, index: slot.index }, w.ctx, rngFactory(runSeed, def.id, slot.index), agent)));
  }
  return applied;
}

interface Emitter {
  emit(events: readonly LedgerEvent[]): void;
}

function emitter(reg: Registry, w: Working, seed: string, rules: RuleFiring[]): Emitter {
  return {
    emit(events) {
      const applied = w.applyAll(events);
      if (applied.length > 0) rules.push(...runRulesOnEvents(reg, w, applied, { seed }));
    },
  };
}

function clockTo(w: Working, at: number, cause: ClockEvent["cause"], e: Emitter): void {
  const minutes = at - w.state.clock;
  if (minutes > 0) e.emit([{ type: "clock", minutes, cause }]);
}

/**
 * Moves the clock to `to`, stepping every completed slot (see the header). A timelapse stops
 * early on a `stop`-class interrupt, the unit cap (always after at least one slot) or `stopWhen`.
 */
export function advance(reg: Registry, w: Working, to: number, opts: AdvanceOptions): AdvanceResult {
  const from = w.state.clock;
  const cause = opts.cause ?? (opts.mode === "timelapse" ? "timelapse" : "tick");
  const policy = interruptPolicy(w.state, opts.interrupts);
  const cap = clampUnitCap(opts.unitCap ?? w.state.time.unitCap);
  const startEvents = w.events.length;
  const result: AdvanceResult = { from, to: from, requested: to, slots: 0, stop: "target", stoppedBy: null, stops: [], notes: [], agentDays: 0, events: 0, rules: [], tracks: [] };
  if (to <= from) return result;
  const cal = calendarOf(w.world);
  const schedules = allSchedules(reg, w.world);
  const instants = scheduleInstants(w.world, schedules, from, to);
  const slots = slotsEnding(cal, from, to);
  const e = emitter(reg, w, opts.runSeed, result.rules);
  const timelapse = opts.mode === "timelapse";
  const agents = timelapse ? lod1Agents(w.state).filter((a) => a !== w.world.pov) : [];
  if (timelapse && opts.includePov !== false && own(w.state.entities, w.world.pov)) agents.unshift(w.world.pov);
  const cursors = new Map(agents.map((a) => [a, agentCursor(w.world, w.state, a)]));
  let next = 0;

  const applyInstants = (until: number): void => {
    while (next < instants.length && (instants[next]?.at ?? Infinity) <= until) {
      const inst = instants[next++] as ScheduleInstant;
      clockTo(w, inst.at, cause, e);
      e.emit(instantEvents(reg, w.ctx, inst, opts.runSeed, { povRoutine: timelapse }));
    }
  };

  const signalsSince = (index: number): Signal[] => {
    const out: Signal[] = [];
    for (let i = index; i < w.events.length; i++) {
      const ev = w.events[i];
      const s = ev && "data" in ev ? signalOf(ev) : null;
      if (s) out.push(s);
    }
    return out;
  };

  for (const slot of slots) {
    const slotDays = (agents.length * (slot.end - slot.start)) / MINUTES_PER_DAY;
    if (timelapse && result.slots > 0 && result.agentDays + slotDays > cap.agentDays) {
      result.stop = "cap";
      break;
    }
    const mark = timelapse && result.slots > 0 ? w.mark() : null;
    const before = w.events.length;
    const rulesBefore = result.rules.length;
    const tracksBefore = result.tracks.length;
    applyInstants(slot.end);
    clockTo(w, slot.end, cause, e);
    const info: SlotInfo = { start: slot.start, end: slot.end, index: slot.index };
    for (const def of reg.processes) {
      if (def.scope === "agent" || rulesetFloor(w.world, def.domain, w.state.realism.levels[def.domain] ?? 0) < def.minLevel) continue;
      e.emit(def.step(info, w.ctx, rngFactory(opts.runSeed, def.id, slot.index)));
    }
    for (const agent of agents) {
      const cursor = cursors.get(agent) ?? slot.index - 1;
      for (let k = cursor + 1; k <= slot.index; k++) {
        const applied = stepAgent(reg, w, agent, k === slot.index ? slot : slotOf(cal, k), opts.runSeed);
        if (applied.length > 0) result.rules.push(...runRulesOnEvents(reg, w, applied, { seed: hashParts(opts.runSeed, "agent", agent, k) }));
      }
      cursors.set(agent, slot.index);
    }
    const dayEnds = (slot.index + 1) % cal.partStarts.length === 0;
    const tickSeed = hashParts(opts.runSeed, "tick", slot.index);
    result.rules.push(...runRulesOnTick(reg, w, "slot", { seed: tickSeed }));
    if (dayEnds) result.rules.push(...runRulesOnTick(reg, w, "day", { seed: tickSeed }));
    result.tracks.push(...stepTracks(reg, w, tickSeed));

    if (mark && w.events.length - startEvents > cap.events) {
      w.restore(mark);
      result.rules.length = rulesBefore;
      result.tracks.length = tracksBefore;
      result.stop = "cap";
      break;
    }
    result.slots++;
    result.agentDays += slotDays;
    for (const s of signalsSince(before)) {
      const p = own(policy, s.class);
      if (p === "stop" && timelapse) result.stops.push(s);
      else if (p === "note" || (p === "stop" && !timelapse)) result.notes.push(s);
    }
    if (timelapse && result.stops.length > 0) {
      result.stop = "interrupt";
      result.stoppedBy = result.stops[0]?.class ?? null;
      break;
    }
    if (opts.stopWhen?.(w)) {
      result.stop = "predicate";
      break;
    }
  }

  if (result.stop === "target") {
    applyInstants(to);
    clockTo(w, to, cause, e);
  }
  for (const [agent, slot] of cursors) if (slot !== agentCursor(w.world, w.state, agent)) w.apply({ type: ENGINE_EVENTS.caught, data: { agent, slot } });
  result.to = w.state.clock;
  result.events = w.events.length - startEvents;
  return result;
}

export interface CatchUpOptions {
  runSeed: string;
  /** Agents per turn (K). */
  agents: number;
  /** Agents in the POV's scene, stepped first. */
  onScreen?: EntityId[];
  /** Agent-days per turn; the rest stays on the backlog. */
  agentDays?: number;
}

export interface CatchUpResult {
  stepped: { agent: EntityId; from: number; to: number }[];
  /** Slots still owed across all agents after this pass. */
  backlog: number;
}

/** Off-screen catch-up (DESIGN §8): up to K agents, on-screen first, then round-robin. */
export function catchUp(reg: Registry, w: Working, opts: CatchUpOptions): CatchUpResult {
  const cal = calendarOf(w.world);
  const done = completedSlot(w.world, w.state);
  const all = lod1Agents(w.state).filter((a) => a !== w.world.pov);
  const slice = readEngineSlice(w.state);
  const onScreen = (opts.onScreen ?? []).filter((a) => all.includes(a)).sort();
  const queue = all.filter((a) => !onScreen.includes(a));
  const rr = queue.length > 0 ? slice.rr % queue.length : 0;
  const rotated = [...queue.slice(rr), ...queue.slice(0, rr)];
  const order = [...onScreen, ...rotated];
  const slotLen = MINUTES_PER_DAY / cal.partStarts.length;
  let budget = (opts.agentDays ?? Infinity) * MINUTES_PER_DAY;
  const stepped: CatchUpResult["stepped"] = [];
  let taken = 0;
  let advancedQueue = 0;
  for (const agent of order) {
    if (taken >= opts.agents || budget <= 0) break;
    const cursor = agentCursor(w.world, w.state, agent);
    if (cursor >= done) continue;
    taken++;
    if (!onScreen.includes(agent)) advancedQueue = rotated.indexOf(agent) + 1;
    let k = cursor;
    while (k < done && budget > 0) {
      k++;
      const applied = stepAgent(reg, w, agent, slotOf(cal, k), opts.runSeed);
      if (applied.length > 0) runRulesOnEvents(reg, w, applied, { seed: hashParts(opts.runSeed, "agent", agent, k) });
      budget -= slotLen;
    }
    w.apply({ type: ENGINE_EVENTS.caught, data: { agent, slot: k } });
    stepped.push({ agent, from: cursor + 1, to: k });
  }
  if (queue.length > 0 && advancedQueue > 0) w.apply({ type: ENGINE_EVENTS.cursor, data: { rr: (rr + advancedQueue) % queue.length } });
  let backlog = 0;
  for (const agent of all) backlog += Math.max(0, done - agentCursor(w.world, w.state, agent));
  return { stepped, backlog };
}

// ---------------------------------------------------------------- record coarsening

/** Events that read neither entity fields nor relations when they apply. */
const FIELD_TRANSPARENT = new Set<string>(["clock", "post", "timelapse", ENGINE_EVENTS.signal, ENGINE_EVENTS.note, ENGINE_EVENTS.beat, ENGINE_EVENTS.cursor, ENGINE_EVENTS.choice, ENGINE_EVENTS.caught, ENGINE_EVENTS.fired]);
/** Events whose application doesn't read the clock. */
const CLOCK_TRANSPARENT = new Set<string>(["set", "add", "post", ENGINE_EVENTS.signal, ENGINE_EVENTS.note, ENGINE_EVENTS.beat, ENGINE_EVENTS.cursor, ENGINE_EVENTS.choice, ENGINE_EVENTS.caught]);

/** Signal classes whose notes collapse to the latest per entity in a record (period-close status). */
const COLLAPSED_SIGNALS = new Set<string>(["arrival", "needs", "weather", "overdue", "invitation"]);

/** Conservative pass: merges only within runs no other event reads (exact by construction, bar float sums). */
function coarsenRuns(events: readonly LedgerEvent[]): LedgerEvent[] {
  const out: (LedgerEvent | null)[] = [];
  let keys = new Map<string, { set?: number; add?: number }>();
  let lastClock: number | null = null;
  for (const ev of events) {
    if (ev.type === "set" || ev.type === "add") {
      const key = `${ev.entity}\u0000${ev.field}`;
      const slot = keys.get(key) ?? {};
      if (ev.type === "set") {
        if (slot.set !== undefined) out[slot.set] = null;
        if (slot.add !== undefined) out[slot.add] = null;
        out.push({ ...ev });
        keys.set(key, { set: out.length - 1 });
      } else if (slot.add !== undefined) {
        const prev = out[slot.add];
        if (prev && prev.type === "add") out[slot.add] = { ...prev, delta: prev.delta + ev.delta };
      } else {
        out.push({ ...ev });
        keys.set(key, { ...slot, add: out.length - 1 });
      }
      continue;
    }
    if (ev.type === "clock") {
      const prev = lastClock !== null ? out[lastClock] : null;
      if (prev && prev.type === "clock" && prev.cause === ev.cause) {
        out[lastClock as number] = { ...prev, minutes: prev.minutes + ev.minutes };
        continue;
      }
      out.push({ ...ev });
      lastClock = out.length - 1;
      continue;
    }
    if (!FIELD_TRANSPARENT.has(ev.type)) keys = new Map();
    if (!CLOCK_TRANSPARENT.has(ev.type)) lastClock = null;
    out.push(ev);
  }
  return out.filter((e): e is LedgerEvent => e !== null && !(e.type === "add" && e.delta === 0) && !(e.type === "clock" && e.minutes === 0));
}

/** The group an event collapses into across the whole record, or null when it stays as it is. */
function groupKey(reg: Registry, e: LedgerEvent): string | null {
  if (e.type === "set" || e.type === "add") return `f\u0000${e.entity}\u0000${e.field}`;
  if (e.type === "post") return `p\u0000${e.lines.map((l) => `${l.account}${l.amount < 0 ? "-" : "+"}`).join(",")}`;
  if (e.type === ENGINE_EVENTS.caught && "data" in e) return `c\u0000${String(e.data.agent)}`;
  if (e.type === ENGINE_EVENTS.cursor) return "r";
  const s = "data" in e ? signalOf(e) : null;
  if (s) return COLLAPSED_SIGNALS.has(s.class) ? `s\u0000${s.class}\u0000${s.entity ?? ""}` : null;
  const hook = reg.get(e.type)?.coarsen;
  const key = hook ? hook.key(e) : null;
  return key === null ? null : `h\u0000${e.type}\u0000${key}`;
}

/** One field's events, replayed with the reducer's arithmetic: the last assignment, then a summed delta only when it lands exactly. */
function collapseField(start: Readonly<WorldState>, group: LedgerEvent[]): LedgerEvent[] {
  const first = group[0];
  if (!first || (first.type !== "set" && first.type !== "add")) return group;
  const before = own(start.entities, first.entity);
  let value = own(before?.fields ?? {}, first.field);
  let lastSet: LedgerEvent | null = null;
  let delta = 0;
  for (const e of group) {
    if (e.type === "set") {
      value = e.value;
      lastSet = e;
      delta = 0;
    } else if (e.type === "add") {
      value = (typeof value === "number" ? value : 0) + e.delta;
      delta += e.delta;
    }
  }
  if (lastSet) return delta === 0 ? [lastSet] : [{ ...lastSet, value: value ?? null }];
  // Accumulators stay deltas (L21) when the summed delta reproduces the replayed value exactly.
  const base = own(before?.fields ?? {}, first.field);
  if (first.type === "add" && before && (typeof base === "number" ? base : 0) + delta === value) return delta === 0 ? [] : [{ ...first, delta }];
  return group;
}

/** Whether a posting only credits owned accounts (income, refunds): its aggregate can land early. */
function creditOnly(e: LedgerEvent): boolean {
  return e.type === "post" && e.lines.every((l) => l.account.startsWith(EXTERNAL_ACCOUNT_PREFIX) || l.amount >= 0);
}

/**
 * Aggressive pass: every collapsible group becomes its merged form at its last member's position,
 * except credit-only postings, which land at their first member's. Then every debit aggregate sees
 * at least the balance the raw record had at its last member, so the funds guard on `post` holds
 * in the coarse record wherever it held in the raw one.
 */
function collapse(reg: Registry, start: Readonly<WorldState>, events: readonly LedgerEvent[]): LedgerEvent[] {
  const keys = events.map((e) => groupKey(reg, e));
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const members = new Map<string, LedgerEvent[]>();
  keys.forEach((k, i) => {
    if (k === null) return;
    if (!first.has(k)) first.set(k, i);
    last.set(k, i);
    const list = members.get(k) ?? [];
    const ev = events[i];
    if (ev) list.push(ev);
    members.set(k, list);
  });
  const out: LedgerEvent[] = [];
  events.forEach((e, i) => {
    const k = keys[i];
    if (k === null || k === undefined) {
      out.push(e);
      return;
    }
    const list = members.get(k) ?? [];
    const early = k.startsWith("p\u0000") && creditOnly(e);
    if ((early ? first.get(k) : last.get(k)) !== i) return;
    const tail = list[list.length - 1] ?? e;
    if (k.startsWith("f\u0000")) out.push(...collapseField(start, list));
    else if (k.startsWith("p\u0000") && tail.type === "post") {
      // Postings per account and direction over the period: amounts sum (integer cents, exact).
      const lines = tail.lines.map((l, j) => ({ account: l.account, amount: list.reduce((a, p) => a + (p.type === "post" ? (p.lines[j]?.amount ?? 0) : 0), 0) }));
      // One posting keeps its memo; a sum says how many it holds (a memo's own amounts would misread the total).
      const memo = list.length === 1 ? tail.memo : `${(tail.memo ?? "").split(":")[0]?.trim() ?? ""} (${list.length} postings)`;
      if (lines.some((l) => l.amount !== 0)) out.push({ ...tail, lines, ...(memo !== undefined ? { memo } : {}) });
    } else if (k.startsWith("h\u0000")) {
      const hook = reg.get(e.type)?.coarsen;
      out.push(hook ? list.reduce((a, b) => hook.merge(a, b)) : e);
    } else out.push(e);
  });
  // Clock moves that became adjacent merge.
  const merged: LedgerEvent[] = [];
  for (const e of out) {
    const prev = merged[merged.length - 1];
    if (e.type === "clock" && prev?.type === "clock" && prev.cause === e.cause) merged[merged.length - 1] = { ...prev, minutes: prev.minutes + e.minutes };
    else merged.push(e);
  }
  return merged.filter((e) => !(e.type === "add" && e.delta === 0) && !(e.type === "clock" && e.minutes === 0));
}

function foldOf(reg: Registry, world: WorldDoc, start: Readonly<WorldState>, events: readonly LedgerEvent[]): WorldState | null {
  const w = new Working(reg, world, start);
  const applied = w.applyAll(events);
  return applied.length === events.length ? w.state : null;
}

/**
 * Coarsens a timelapse or catch-up record (DESIGN §4.3): one event per entity field (its last value,
 * or its summed delta, L21), postings summed per memo and accounts, catch-up cursors and status
 * signals (arrivals, needs, weather, overdue, invitations) at their latest, pack accumulators
 * merged through their `coarsen` hook, and adjacent clock moves joined. The result is checked:
 * when it doesn't fold from `start` to exactly the raw fold's state, the conservative pass is
 * used, and when that doesn't either, the raw events. Moving everyone once loses what the POV saw
 * on the way, so a coarse record ends with an `engine.observed` event putting that back. The
 * touched record is left out of the check: the stored record is what play applied, so a field
 * whose deltas net to nothing over the period isn't touched by it.
 */
export function coarsen(reg: Registry, world: WorldDoc, start: Readonly<WorldState>, events: readonly LedgerEvent[]): LedgerEvent[] {
  const full = foldOf(reg, world, start, events);
  if (full === null) return [...events];
  const worldOnly = (s: Readonly<WorldState>): string => {
    const copy = unobserved(s);
    dropTouches(copy);
    return hashJson(copy);
  };
  const expected = worldOnly(full);
  for (const candidate of [collapse(reg, start, events), coarsenRuns(events)]) {
    const coarse = foldOf(reg, world, start, candidate);
    if (coarse === null || worldOnly(coarse) !== expected) continue;
    const lost = lostObservations(full, coarse);
    return lost ? [...candidate, { type: ENGINE_EVENTS.observed, data: lost }] : candidate;
  }
  return [...events];
}
