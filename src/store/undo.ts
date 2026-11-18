// Undo of one change (plan §6.8: one review card per turn, with an undo for each change; §6.3: the
// player's own edits are changes with source `player`, placed after the newest reply). An undo is a
// new change that reverses an earlier one; nothing recorded is taken away. A change of a unit (events
// that share a group) is undone with its whole unit, as one unit of its own.
//
// What would be left is said as codes with values. A part a later change has written since is not
// the change's to take back: then nothing of the unit is undone. A part the store keeps no reverse for
// stays, and the rest of the unit is undone. A journal line is taken back as the economy takes one
// back (`reverseLine`, `reversedAs`), from its posting where that is in its unit and from its own lines
// where not. Something made is taken out by the engine's own despawn; a hint opened closes again; a
// materialization takes back what it brought, its accounts closing again; and a worth the economy
// fixed goes back to what it was.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { jsonEqual } from "../shared/json-patch";
import { FINANCE_EVENTS } from "../shared/finance";
import type { LedgerEvent, MarkerBody, MaterializeEvent, PostEvent } from "../shared/ledger";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import type { EventTypes } from "../engine/events";
import { applyEvent, validMarkerBody } from "../engine/events";
import { numOf, objOf, own, strOf } from "../engine/pack-kit";
import { GONE_FIELD, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { reversedAs, txn } from "../packs/economy/core/pay";
import { CLOCK_SET, CLOCK_UNSET, setsClock } from "./blank";
import { factStore, standing } from "./facts";
import { eventOf, type FoldEnv } from "./fold";
import type { AreaOp } from "./areas";
import { STORE_OPS, type ChangeInput, type ChangeRow, type Report, type StoreState } from "./types";

/** What undoing a change records, and what of it would be left. */
export interface UndoPlan {
  /** The changes that reverse it, in the order they are recorded. */
  inputs: ChangeInput[];
  /** What is not reversed, each as a code (`changed_since`, `not_reversible`) with the change and its operation. */
  left: Report[];
}

const leftOf = (code: "changed_since" | "not_reversible", c: ChangeRow, why?: string): Report => ({ code, values: { change: c.id, op: c.op, ...(why !== undefined ? { why } : {}) } });

/** What one event's reverse is: the events that take it back, in the order they are recorded, or why it has none. */
type Reversed = JsonObject[] | "changed_since" | "not_reversible";

/**
 * A journal line taken back the way the economy takes back what a payment brought when it is paid
 * another way (`otherWay`, `packs/economy/core/pay.ts`): the lines of its posting, the one of `posts`
 * with the same memo, the other way, or its own lines where its posting is not among them, filed as
 * the economy files a posting taken back (`reversedAs`), in its category. None when it has no lines.
 */
function reverseLine(data: JsonObject, posts: readonly PostEvent[]): LedgerEvent | null {
  const memo = strOf(data.memo);
  const mine = (Array.isArray(data.lines) ? data.lines : []).flatMap((l) => (isRecord(l) && typeof l.account === "string" && typeof l.amount === "number" ? [{ account: l.account, amount: l.amount }] : []));
  const lines = posts.find((e) => e.memo === memo)?.lines ?? mine;
  if (lines.length === 0) return null;
  const category = strOf(data.category);
  return txn(
    lines.map((l) => ({ account: l.account, amount: -l.amount })),
    { ...reversedAs({ lines, memo }), ...(category ? { category } : {}) },
  );
}

/**
 * The events the engine's despawn (`despawnOp`, `engine/edits.ts`) records for `entity` as `state` holds it: its relations go, and
 * everyone's to it but what is inside it, which goes with it; a thing held keeps the place it was at; and it is gone. None when it is
 * gone already. `unlinked` holds the relations the reverse being built takes off already, so none is taken off twice.
 */
function despawnOf(state: WorldState, entity: string, unlinked: Set<string>): JsonObject[] | null {
  const e = own(state.entities, entity);
  if (!e || e.fields[GONE_FIELD] === true) return null;
  const out: JsonObject[] = [];
  const unlink = (rel: string, from: string, to: string): void => {
    const key = JSON.stringify([rel, from, to]);
    if (unlinked.has(key)) return;
    unlinked.add(key);
    out.push({ type: "unlink", rel, from, to });
  };
  const where = placeOfEntity(state, entity);
  for (const r of e.relations) unlink(r.type, entity, r.to);
  if (where !== null && typeof e.fields.place !== "string" && e.relations.some((r) => r.type === "in")) out.push({ type: "set", entity, field: "place", value: where });
  for (const id of Object.keys(state.entities).sort()) {
    if (id === entity) continue;
    for (const r of own(state.entities, id)?.relations ?? []) if (r.to === entity && r.type !== "in") unlink(r.type, id, entity);
  }
  out.push({ type: "set", entity, field: GONE_FIELD, value: true });
  return out;
}

/** How many of a track's stage's hints are open in `state` (`engine.hint`). */
const hintsOpen = (state: StoreState, track: string, stage: string): number => numOf(own(objOf(own(objOf(objOf(state.world.packs.engine).hints), track)), stage));

/** A hint opened closes again; one that opened nothing (`n` were open already when it was asked for) has nothing to close. */
function reverseHint(data: JsonObject, before: StoreState, now: StoreState): Reversed {
  const track = strOf(data.track);
  const stage = strOf(data.stage);
  if (typeof data.n === "number" && hintsOpen(before, track, stage) >= data.n) return [];
  return hintsOpen(now, track, stage) > 0 ? [{ type: ENGINE_EVENTS.hintClosed, data: { track, stage } }] : "changed_since";
}

/** The worth the economy fixed for someone goes back to what it was: the one fixed before, or none (an anchor with no band). */
function reverseAnchor(data: JsonObject, before: StoreState, now: StoreState): Reversed {
  const entity = strOf(data.entity);
  const anchorIn = (state: StoreState): JsonValue => own(objOf(objOf(state.world.packs.economy).anchors), entity) ?? null;
  const set = strOf(data.band) === "" ? null : { band: strOf(data.band), typical: numOf(data.typical), base: numOf(data.base) };
  if (!jsonEqual(anchorIn(now), set)) return "changed_since";
  const was = anchorIn(before);
  return [{ type: FINANCE_EVENTS.anchor, data: isRecord(was) ? { ...was, entity } : { entity } }];
}

/**
 * A materialization taken back: what it made is taken out by the engine's despawn, with its fields and links; what it posted is
 * posted the other way, its journal lines likewise; accounts that were there before and opened with it close again; any other part is
 * reversed as on its own. Where it made nothing, its detail counts as not sampled, so it is sampled again when next needed; what it
 * made keeps its ids, gone, so it is not made twice.
 */
function reverseMaterialize(ev: MaterializeEvent, before: StoreState, now: StoreState, unlinked: Set<string>, registry: EventTypes): Reversed {
  const made = new Set(ev.events.flatMap((e) => (e.type === "spawn" && "entity" in e && isRecord(e.entity) ? [String(e.entity.id)] : [])));
  const posts = ev.events.filter((e): e is PostEvent => e.type === "post");
  const out: JsonObject[] = [];
  for (const inner of [...ev.events].reverse()) {
    if (inner.type === FINANCE_EVENTS.open && "data" in inner) {
      const accounts = (Array.isArray(inner.data.accounts) ? inner.data.accounts : []).filter((a): a is string => typeof a === "string" && !made.has(a));
      if (accounts.length > 0) out.push({ type: FINANCE_EVENTS.open, data: { accounts, close: true } });
      continue;
    }
    const on = "entity" in inner && typeof inner.entity === "string" ? inner.entity : "from" in inner && typeof inner.from === "string" ? inner.from : null;
    if (inner.type !== "spawn" && on !== null && made.has(on)) continue;
    const r = reverseEvent(inner, posts, before, now, unlinked, registry, null);
    if (typeof r === "string") return r;
    out.push(...r);
  }
  if (made.size === 0) out.push({ type: ENGINE_EVENTS.unmaterialized, data: { entity: ev.entity, domain: ev.domain } });
  return out;
}

/**
 * The reverse of one event, read against the state just before its unit and the state now; `posts` are the postings of its unit. The
 * core events and the engine's and the economy's own are reversed here; any other event type is reversed by the `reverse` its pack gave it.
 */
function reverseEvent(ev: LedgerEvent, posts: readonly PostEvent[], before: StoreState, now: StoreState, unlinked: Set<string>, registry: EventTypes, sim: Sim | null): Reversed {
  const related = (state: StoreState, rel: string, from: string, to: string) => own(state.world.entities, from)?.relations.find((r) => r.type === rel && r.to === to);
  // The Undo of a change that set the clock where nothing had set it before takes the setting off again (A155).
  const unset: JsonObject = setsClock(ev as unknown as JsonValue) && before.marks.world?.[CLOCK_SET] === undefined ? { [CLOCK_UNSET]: true } : {};
  switch (ev.type) {
    case "post":
      return [{ type: "post", lines: ev.lines.map((l) => ({ ...l, amount: -l.amount })) as unknown as JsonValue, memo: ev.memo }];
    case "link": {
      if (!related(now, ev.rel, ev.from, ev.to)) return "changed_since";
      // Taken off once: the despawn of what it joined takes off the same relation too.
      const key = JSON.stringify([ev.rel, ev.from, ev.to]);
      if (unlinked.has(key)) return [];
      unlinked.add(key);
      // A relation that was there before the unit comes back as it was (its fields and its end); one the unit made is taken off.
      const was = related(before, ev.rel, ev.from, ev.to);
      if (was) return [{ type: "link", rel: ev.rel, from: ev.from, to: ev.to, ...(was.fields ? { fields: was.fields } : {}), ...(was.until !== undefined ? { until: was.until } : {}) }];
      return [{ type: "unlink", rel: ev.rel, from: ev.from, to: ev.to }];
    }
    case "unlink": {
      const was = related(before, ev.rel, ev.from, ev.to);
      if (!was || related(now, ev.rel, ev.from, ev.to)) return "changed_since";
      return [{ type: "link", rel: ev.rel, from: ev.from, to: ev.to, ...(was.fields ? { fields: was.fields } : {}), ...(was.until !== undefined ? { until: was.until } : {}) }];
    }
    case "set":
      if (!jsonEqual(own(now.world.entities, ev.entity)?.fields[ev.field], ev.value)) return "changed_since";
      return [{ type: "set", entity: ev.entity, field: ev.field, value: own(before.world.entities, ev.entity)?.fields[ev.field] ?? null }];
    case "clock":
      if (ev.minutes > 0) return [{ type: ENGINE_EVENTS.rewind, data: { minutes: ev.minutes }, ...unset }];
      return CLOCK_UNSET in unset ? [{ type: "clock", minutes: 0, cause: "advance", ...unset }] : "not_reversible";
    case "add": {
      // A number added goes back to what the field held before; where it held something that is no number, the event left it as it was.
      const held = own(now.world.entities, ev.entity)?.fields[ev.field];
      if (held !== undefined && typeof held !== "number") return [];
      return [{ type: "set", entity: ev.entity, field: ev.field, value: own(before.world.entities, ev.entity)?.fields[ev.field] ?? null }];
    }
    case "spawn":
      return despawnOf(now.world, ev.entity.id, unlinked) ?? "changed_since";
    case "materialize":
      return reverseMaterialize(ev, before, now, unlinked, registry);
    case "stage": {
      // A quest moved back to the stage it stood at, as it was entered then; where something moved it since, that is not this one's to take back.
      const was = own(before.world.tracks, ev.track);
      if (own(now.world.tracks, ev.track)?.stage !== ev.to) return "changed_since";
      return was === undefined ? "not_reversible" : [{ type: "stage", track: ev.track, to: was.stage, from: ev.to, since: was.since }];
    }
    default: {
      if (ev.type === ENGINE_EVENTS.rewind && "data" in ev) return typeof ev.data.minutes === "number" ? [{ type: "clock", minutes: ev.data.minutes, cause: "advance", ...unset }] : "not_reversible";
      if (ev.type === ENGINE_EVENTS.hint && "data" in ev) return reverseHint(ev.data, before, now);
      if (ev.type === FINANCE_EVENTS.anchor && "data" in ev) return reverseAnchor(ev.data, before, now);
      if (ev.type === FINANCE_EVENTS.txn && "data" in ev) {
        const line = reverseLine(ev.data, posts);
        return line === null ? "not_reversible" : [line as unknown as JsonObject];
      }
      const def = registry.get(ev.type);
      if (def?.reverse === undefined) return reverseWritten(ev, before, now, sim);
      const r = def.reverse(ev, before.world, now.world);
      return typeof r === "string" ? r : [...r];
    }
  }
}

/** What each event of a unit wrote under the packs' slices and in what entities hold (the paths it changed), found by playing the unit on a copy of the world just before it, and that copy as the unit left it. */
interface Sim {
  wrote: Map<LedgerEvent, { paths: string[][]; outside: boolean }>;
  after: WorldState;
}

/** The topmost paths at which `a` and `b` differ: a key only one holds, or where neither is an object a value that differs. */
function diffPaths(a: unknown, b: unknown, path: string[], out: string[][]): void {
  if (jsonEqual(a as JsonValue, b as JsonValue)) return;
  if (isRecord(a) && isRecord(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key in a && key in b) diffPaths(a[key], b[key], [...path, key], out);
      else out.push([...path, key]);
    }
    return;
  }
  out.push(path);
}

/** The value at `path` below `root`, where there is one. */
function valueAt(root: unknown, path: readonly string[]): JsonValue | undefined {
  let at = root;
  for (const step of path) {
    if (!isRecord(at) || !(step in at)) return undefined;
    at = at[step];
  }
  return at as JsonValue;
}

/** What a put-back may give back: the packs' slices and what each entity holds. */
const heldBy = (state: Readonly<WorldState>): { packs: WorldState["packs"]; entities: WorldState["entities"] } => ({ packs: state.packs, entities: state.entities });

/** The unit's events played one after another on a copy of the world just before it, each with the paths it changed; none where the world's revision is not known. */
function simulate(unit: readonly ChangeRow[], before: StoreState, env: Pick<FoldEnv, "registry"> & Partial<Pick<FoldEnv, "worlds">>): Sim | null {
  const doc = env.worlds?.(before.world.revision);
  if (!doc) return null;
  const scratch = structuredClone(before.world);
  const ctx = env.registry.context(doc, scratch);
  const wrote = new Map<LedgerEvent, { paths: string[][]; outside: boolean }>();
  for (const c of unit) {
    const ev = c.applied ? eventOf(c.op, c.value) : null;
    if (ev === null) continue;
    const prev = structuredClone(scratch);
    try {
      applyEvent(env.registry, ev, scratch, ctx);
    } catch {
      continue;
    }
    const paths: string[][] = [];
    diffPaths(heldBy(prev), heldBy(scratch), [], paths);
    // What it wrote of the world beyond the slices and what the entities hold (a balance, the clock, a new entity) is not a put-back's to give.
    const { packs: _before, entities: _entities, ...rest } = prev;
    const { packs: _after, entities: _entitiesAfter, ...rested } = scratch;
    const outside: string[][] = [];
    diffPaths(rest, rested, [], outside);
    wrote.set(ev, { paths, outside: outside.length > 0 || paths.some((p) => p[0] === "entities" && p.length < 3) });
  }
  return { wrote, after: scratch };
}

/**
 * The reverse of an event that has none of its own: what it wrote under the packs' slices goes back to what the world held before its
 * unit, unless a later change has written that since (the slice is not what the unit left).
 */
function reverseWritten(ev: LedgerEvent, before: StoreState, now: StoreState, sim: Sim | null): Reversed {
  const wrote = sim?.wrote.get(ev);
  if (sim === null || wrote === undefined || wrote.outside) return "not_reversible";
  const out: JsonObject[] = [];
  for (const path of wrote.paths) {
    if (!jsonEqual(valueAt(now.world, path) ?? null, valueAt(sim.after, path) ?? null)) return "changed_since";
    const was = valueAt(before.world, path);
    out.push({ type: ENGINE_EVENTS.put, data: { path, ...(was === undefined ? {} : { value: was }) } });
  }
  return out;
}

/** What the control a marker sets holds in `world`; undefined where it holds none. */
function markerValue(world: Readonly<WorldState>, body: Exclude<MarkerBody, { kind: "migrate" }>): JsonValue | undefined {
  switch (body.kind) {
    case "time": {
      const t = world.time;
      const s = body.scope;
      switch (body.control) {
        case "tick":
          return "sceneType" in s ? own(t.sceneTicks, s.sceneType) : undefined;
        case "scale":
          return t.scale;
        case "pause":
          return t.paused;
        case "interrupt":
          return "interrupt" in s ? own(t.interrupts, s.interrupt) : undefined;
        case "speed_through":
          return "activity" in s ? (own(t.speedThrough, s.activity) as unknown as JsonValue | undefined) : undefined;
        case "montage":
          return t.montage;
        case "unit_cap":
          return t.unitCap as unknown as JsonValue;
        default:
          return undefined;
      }
    }
    case "resolve": {
      const s = body.scope;
      return "all" in s ? world.realism.levels[body.domain] : "tier" in s ? own(world.realism.tierCaps, s.tier)?.[body.domain] : own(world.entities, s.entity)?.levels[body.domain];
    }
    case "adjudicate":
      return world.adjudication as unknown as JsonValue | undefined;
    case "claims":
      return world.claims as unknown as JsonValue | undefined;
    case "infer":
      return world.inferred as unknown as JsonValue | undefined;
  }
}

/** The reverse of one change of `unit`, read against the state just before the unit and the state now; or why it has none. */
function reverseOne(c: ChangeRow, unit: readonly ChangeRow[], before: StoreState, now: StoreState, group: string, unlinked: Set<string>, registry: EventTypes, sim: Sim | null): ChangeInput[] | Report {
  const input = (op: string, value: JsonValue): ChangeInput => ({ lane: c.lane, op, value, precision: c.precision, standing: c.standing });
  const ev = eventOf(c.op, c.value);
  if (ev) {
    const posts = unit
      .filter((u) => u.applied)
      .map((u) => eventOf(u.op, u.value))
      .filter((e): e is PostEvent => e?.type === "post");
    const nature = registry.get(ev.type)?.irreversible;
    if (nature !== undefined) return leftOf("not_reversible", c, nature);
    const r = reverseEvent(ev, posts, before, now, unlinked, registry, sim);
    return typeof r === "string" ? leftOf(r, c) : r.map((e) => input(String(e.type), { ...e, group }));
  }
  const v = isRecord(c.value) ? c.value : {};
  if (c.op === STORE_OPS.note) {
    const at = typeof v.at === "string" ? v.at : "";
    if ((now.notes[at]?.text ?? "") !== (typeof v.text === "string" ? v.text : "")) return leftOf("changed_since", c);
    return [input(c.op, { at, text: before.notes[at]?.text ?? "" })];
  }
  if (c.op === STORE_OPS.value) {
    const key = typeof v.key === "string" ? v.key : "";
    if (!jsonEqual(now.values?.[key] ?? null, v.value ?? null)) return leftOf("changed_since", c);
    return [input(c.op, { at: "world", key, value: before.values?.[key] ?? null })];
  }
  if (c.op === STORE_OPS.marker) {
    // A level, a time control or a policy goes back to what it held before. An Upgrade has its own undo (the chat's), and a control that held
    // no value before has none to put back.
    const body = validMarkerBody(c.value);
    if (!body || body.kind === "migrate") return leftOf("not_reversible", c);
    const was = markerValue(before.world, body);
    if (was === undefined) return leftOf("not_reversible", c);
    if (!jsonEqual(markerValue(now.world, body) ?? null, body.to as unknown as JsonValue)) return leftOf("changed_since", c);
    return [input(c.op, { ...body, to: was })];
  }
  return leftOf("not_reversible", c);
}

/**
 * Undoing a fact: what it replaced stands again (its words, how exact and how sure, under a new id),
 * and where it replaced nothing of its own key, an empty fact of that key takes it off. Left when a
 * later fact has replaced it since.
 */
function reverseFact(c: ChangeRow, now: StoreState): ChangeInput[] | Report {
  const v = isRecord(c.value) ? c.value : {};
  const id = String(v.id);
  const about = String(v.about);
  const key = String(v.key);
  if (!standing(now, about).some((f) => f.id === id)) return leftOf("changed_since", c);
  const replaced = Object.values(now.facts)
    .flat()
    .filter((f) => f.replacedBy === id && f.value !== "");
  const inputs: ChangeInput[] = replaced.map((f) => ({ lane: c.lane, ...factStore.change({ about: f.about, key: f.key, value: f.value, replaces: f.about === about && f.key === key ? null : id }), precision: f.precision, standing: f.standing }));
  if (!replaced.some((f) => f.about === about && f.key === key)) inputs.push({ lane: c.lane, ...factStore.change({ about, key, value: "" }) });
  return inputs;
}

type Parts = readonly { ref: string; part: string }[];

/** The parts a change writes: the fields and relations its event touches, or the parts its area names; none for a store operation. */
function partsOf(c: Pick<ChangeRow, "op" | "value">, env: Pick<FoldEnv, "registry" | "areas">): Parts {
  const found = env.areas?.of(c.op) ?? null;
  if (found !== null) return found.def.touches?.(c.value) ?? [];
  if (c.op === STORE_OPS.value) return isRecord(c.value) && typeof c.value.key === "string" ? [{ ref: "world", part: c.value.key }] : [];
  const ev = eventOf(c.op, c.value);
  return (ev ? (env.registry.get(ev.type)?.touches?.(ev) ?? []) : []).flatMap((t) => ("field" in t ? [{ ref: `entity:${t.entity}`, part: t.field }] : "rel" in t ? [{ ref: `entity:${t.entity}`, part: t.rel }] : []));
}

/**
 * Whether a later change than this one wrote one of the parts it wrote: then it is changed since, whatever its value now. A later turn than the
 * change's own is one, by the marks; a later change of his own (`later`, those of his that came after its unit) is one too, which the marks
 * cannot tell, since his changes have no turn.
 */
function writtenSince(c: ChangeRow, parts: Parts, now: StoreState, later: readonly ChangeRow[], env: Pick<FoldEnv, "registry" | "areas">): boolean {
  if (parts.some(({ ref, part }) => (now.marks[ref]?.[part]?.turn ?? c.turn) !== c.turn)) return true;
  return later.some((l) => l.applied && partsOf(l, env).some((p) => parts.some((q) => q.ref === p.ref && q.part === p.part)));
}

/** Undoing an area's change: the reverse its area gives, read against its slice just before it and now. */
function reverseArea(c: ChangeRow, area: { id: string; name: string; def: AreaOp; initial: JsonObject }, before: StoreState, now: StoreState): ChangeInput[] | Report {
  const inputs = area.def.undo?.(c.value, before.areas?.[area.id] ?? area.initial, now.areas?.[area.id] ?? area.initial) ?? null;
  if (inputs === "changed_since") return leftOf("changed_since", c);
  if (inputs === null) return leftOf("not_reversible", c);
  return inputs.map((i) => ({ lane: c.lane, op: `${area.id}.${i.op}`, value: i.value, precision: c.precision, standing: c.standing }));
}

/**
 * What undoing `unit` (a change with the rest of its unit, in order) records: each change that
 * applied, reversed, the last first, as one unit of its own. `before` is the state just before the
 * unit, `now` the chat's state at its newest reply, `later` his own changes that came after the unit
 * where it is one of his. A field or relation an event wrote, or an area's part, that a later turn or
 * a later change of his wrote since is changed since (a sum such as a balance is not).
 */
export function reversal(unit: readonly ChangeRow[], before: StoreState, now: StoreState, env: Pick<FoldEnv, "registry" | "areas"> & Partial<Pick<FoldEnv, "worlds">>, later: readonly ChangeRow[] = []): UndoPlan {
  const group = `undo:${unit[0]?.id ?? 0}`;
  const out: UndoPlan = { inputs: [], left: [] };
  const unlinked = new Set<string>();
  const sim = simulate(unit, before, env);
  for (const c of [...unit].reverse()) {
    if (!c.applied) continue;
    const found = env.areas?.of(c.op) ?? null;
    const r = writtenSince(c, partsOf(c, env), now, later, env)
      ? leftOf("changed_since", c)
      : found !== null
        ? reverseArea(c, { id: found.area.id, name: found.name, def: found.def, initial: found.area.initial?.() ?? {} }, before, now)
        : c.op === STORE_OPS.fact
          ? reverseFact(c, now)
          : reverseOne(c, unit, before, now, group, unlinked, env.registry, sim);
    if (Array.isArray(r)) out.inputs.push(...r);
    else out.left.push(r);
  }
  return out.left.some((r) => r.code === "changed_since") ? { inputs: [], left: out.left } : out;
}
