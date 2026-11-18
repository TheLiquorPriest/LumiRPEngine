// What time brings due (plan §6.4; §6.1: code lists what is due when time passes, and never decides
// what the passing of time did). For a span and a part of the tree, every kind there is: each slot that
// starts in the span on a schedule today's engine keeps (a routine or a shift, which puts someone
// somewhere or at something; the world's own processes, such as weather, prices or bills, which concern
// everyone), each future the Author scheduled whose due falls in it (an arrival among them: today's
// engine records no journey under way, so one is a future that names it), each need that crosses the
// line it alerts at, each effect that ends (a loan, a grant, a permission), and each regard a world's
// half-life halves; every one with who it concerns and where. A list only: nothing in it is applied,
// and a slot whose value is left to chance is listed by its schedule, its chance never drawn. The
// list stops at the bound the caller gives, soonest first, and the rest is counted, not made: a span
// of years costs what its first page does.

import type { JsonValue } from "../shared/json";
import type { ScheduleDef } from "../shared/world";
import { isRecord } from "../shared/json";
import { NEED_IDS, needsSettingsOf } from "../shared/needs";
import { chatWorld } from "../engine/holidays";
import { optionalQuery, own } from "../engine/pack-kit";
import type { ReadContext } from "../engine/registry";
import { chatSchedulesIn, scheduleOwners, slotStarts } from "../engine/schedules";
import { needDueWords, needValue } from "../packs/castlife/core";
import type { TreeView } from "./view";
import type { Store } from "./store";
import type { StoreState } from "./types";
import type { DueEntry, DueSource } from "./world-state";

/** What a future of the story's record gives the list: the story area's read of the open futures that have a due time. */
interface FutureDue {
  id: string;
  due: number;
  who: string[];
  place: string | null;
  text: string;
}

/** A principal out of view with an intention that has a story time, as the cast's area reads it. */
interface AwayDue {
  id: string;
  character: string;
  name: string | null;
  /** The tree ref of the world's person the character is. */
  ref: string | null;
  whereabouts: string | null;
  placeRef: string | null;
  nameRefs: string[];
  intention: string | null;
  until: number;
}

/** The away principals with an intention meant for a time, as the cast's area reads them (the store names the area and imports nothing of it); none where the store opened without it. */
function awayOf(store: Store, state: StoreState): AwayDue[] {
  const area = store.env.areas?.get("cast");
  const read = area?.reads && Object.hasOwn(area.reads, "away") ? area.reads.away : undefined;
  const list = read?.(state.areas?.cast ?? area?.initial?.() ?? {}, {});
  const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return (Array.isArray(list) ? list : []).flatMap((a) =>
    isRecord(a) && typeof a.id === "string" && typeof a.character === "string" && typeof a.until_at === "number"
      ? [{ id: a.id, character: a.character, name: text(a.name), ref: text(a.ref), whereabouts: text(a.whereabouts), placeRef: text(a.place_ref), nameRefs: Array.isArray(a.name_refs) ? a.name_refs.filter((r): r is string => typeof r === "string") : [], intention: text(a.intention), until: a.until_at }]
      : [],
  );
}

/** The open futures with a due time, as the story's area reads them (the store names the area and imports nothing of it); none where the store opened without it. */
function futuresOf(store: Store, state: StoreState): FutureDue[] {
  const area = store.env.areas?.get("story");
  const read = area?.reads && Object.hasOwn(area.reads, "futures") ? area.reads.futures : undefined;
  const list = read?.(state.areas?.story ?? area?.initial?.() ?? {}, {});
  return (Array.isArray(list) ? list : []).flatMap((f) => (isRecord(f) && typeof f.id === "string" && typeof f.due === "number" ? [{ id: f.id, due: f.due, who: Array.isArray(f.who) ? f.who.filter((w): w is string => typeof w === "string") : [], place: typeof f.place === "string" ? f.place : null, text: typeof f.text === "string" ? f.text : "" }] : []));
}

/** The minute a need first reaches `line` in (from, to], by today's arithmetic, or null when it does not cross there. */
function crossing(ctx: ReadContext, who: string, need: string, line: number, from: number, to: number): number | null {
  if (needValue(ctx, who, need, from) >= line || needValue(ctx, who, need, to) < line) return null;
  let lo = from;
  let hi = to;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (needValue(ctx, who, need, mid) >= line) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Everything but the schedules' slots that falls due in `(from, to]`: futures, arrivals, needs, endings, fading; each with the levels
 * it concerns (a part of the tree lists it where one of them is in that part; none named, only a list of the whole world does).
 */
function otherDue(store: Store, ctx: ReadContext, state: StoreState, view: TreeView, from: number, to: number): { entry: DueEntry; refs: (string | null)[] }[] {
  const world = ctx.world;
  /** The tree ref words name: an id, or a name of someone or a place. */
  const refOf = (words: string): string | null => {
    const said = words.trim().toLowerCase();
    const id = view.resolve(words.trim());
    if (id !== null) return id;
    const person = Object.entries(state.world.entities).find(([, e]) => e.name.trim().toLowerCase() === said);
    if (person) return `entity:${person[0]}`;
    const place = Object.entries(world.places).find(([, p]) => p.name.trim().toLowerCase() === said);
    return place ? `place:${place[0]}` : null;
  };
  const out: { entry: DueEntry; refs: (string | null)[] }[] = [];
  for (const f of futuresOf(store, state)) {
    if (!(f.due > from && f.due <= to)) continue;
    const refs = f.who.map(refOf);
    const where = f.place === null ? null : refOf(f.place);
    const who = refs.flatMap((r) => (r !== null && r.startsWith("entity:") ? [r.slice("entity:".length)] : []));
    out.push({ entry: { at: f.due, kind: "future", ...(where !== null ? { where } : {}), ...(who.length > 0 ? { who } : {}), what: f.text }, refs: [where, ...refs] });
  }
  // A principal out of view whose recorded intention has a time in the span: who, from where, and where it means to be. Nothing is applied: what it did meanwhile is the Author's to say.
  for (const a of awayOf(store, state)) {
    if (!(a.until > from && a.until <= to)) continue;
    const to_ = a.nameRefs.find((r) => r.startsWith("place:")) ?? null;
    const comes = a.ref !== null ? [a.ref] : [];
    const what: JsonValue = { character: a.name ?? a.character, ...(a.placeRef !== null ? { from: a.placeRef } : a.whereabouts !== null ? { from: a.whereabouts } : {}), ...(to_ !== null ? { to: to_ } : {}), ...(a.intention !== null ? { intention: a.intention } : {}) };
    out.push({ entry: { at: a.until, kind: "arrival", ...(to_ !== null ? { where: to_ } : {}), ...(comes.length > 0 ? { who: comes.filter((r) => r.startsWith("entity:")).map((r) => r.slice("entity:".length)) } : {}), what }, refs: [a.ref, to_, a.placeRef] });
  }
  const settings = needsSettingsOf(world);
  for (const [id, e] of Object.entries(state.world.entities)) {
    const ref = `entity:${id}`;
    // An effect recorded with an end (a loan, a grant, a permission), ending in the span.
    for (const r of e.relations) {
      if (typeof r.until === "number" && r.until > from && r.until <= to) out.push({ entry: { at: r.until, kind: "ending", who: [id], what: { relation: r.type, to: r.to } }, refs: [ref, `entity:${r.to}`] });
    }
    // A need that rises with time, crossing the line it alerts at: the POV's, and anyone whose need was recorded.
    if (id === world.pov || isRecord(e.fields.needs)) {
      for (const need of NEED_IDS) {
        const tuned = settings[need];
        if (!tuned.on) continue;
        const at = crossing(ctx, id, need, tuned.alert, from, to);
        // Said as the Needs view says a need (`needDueWords`), beside what a page reads it by.
        const words = at === null ? undefined : needDueWords(ctx, id, need, at);
        if (at !== null) out.push({ entry: { at, kind: "need", who: [id], what: { need, line: tuned.alert }, ...(words !== undefined ? { words } : {}) }, refs: [ref] });
      }
    }
  }
  // Regard a world's half-life halves, where it sets one: listed with the pair; nothing is applied.
  for (const f of optionalQuery(ctx, "relationships.fading")?.(ctx, { from, to }) ?? []) {
    out.push({ entry: { at: f.at, kind: "fading", who: [f.from, f.to], what: { axis: f.axis, value: f.value, halved: f.halved } }, refs: [`entity:${f.from}`, `entity:${f.to}`] });
  }
  return out;
}

/** What time brings due over the store's states: what the world state and the engine's tools take as `due`. */
export function timeDue(store: Store): DueSource {
  return {
    due(state, span, at, most) {
      const doc = store.env.worlds(state.world.revision);
      if (!doc || span.to <= span.from) return { items: [], more: 0 };
      const ctx = store.env.registry.context(doc, state.world);
      const world = ctx.world;
      const view = store.viewOf(state);
      const root = at === null ? null : view.resolve(at);
      // Inside the part of the tree asked about: the level itself, or anything in it.
      const inside = (ref: string): boolean => {
        for (let r: string | null = ref; r !== null; r = view.parentOf(r)) if (r === root) return true;
        return false;
      };
      // What each slot's start is listed as, worked out once for the slot; null for a slot not listed here.
      const entries = new Map<ScheduleDef, (Omit<DueEntry, "at"> | null)[]>();
      const entryOf = (schedule: ScheduleDef, slot: number): Omit<DueEntry, "at"> | null => {
        let slots = entries.get(schedule);
        if (!slots) {
          const who = scheduleOwners(store.env.registry, world, state.world, schedule);
          slots = schedule.slots.map((s) => {
            const place = schedule.target === "place" && typeof s.value === "string" && own(world.places, s.value) ? `place:${s.value}` : null;
            // A person's schedule outside the part asked about is not listed; the world's own processes concern every part.
            const here = root === null ? who : who.filter((id) => inside(`entity:${id}`) || (place !== null && inside(place)));
            if (who.length > 0 && here.length === 0) return null;
            const what: JsonValue = s.value === undefined || place !== null ? schedule.id : s.value;
            return { kind: schedule.target, ...(place !== null ? { where: place } : {}), ...(here.length > 0 ? { who: here } : {}), what };
          });
          entries.set(schedule, slots);
        }
        return slots[slot] ?? null;
      };
      const { starts, more } = slotStarts(chatWorld(ctx), chatSchedulesIn(ctx), span.from, span.to, most, (schedule, slot) => entryOf(schedule, slot) !== null);
      const items: DueEntry[] = [];
      for (const i of starts) {
        const entry = entryOf(i.schedule, i.slot);
        if (entry !== null) items.push({ at: i.at, ...entry });
      }
      // The rest of what falls due, each kind kept to the part asked about, merged in time order with the slots.
      for (const o of otherDue(store, ctx, state, view, span.from, span.to)) if (root === null || o.refs.some((r) => r !== null && inside(r))) items.push(o.entry);
      items.sort((a, b) => a.at - b.at);
      const listed = items.slice(0, Math.max(0, most));
      return { items: listed, more: more === null ? null : more + (items.length - listed.length) };
    },
    under(state, span) {
      const doc = store.env.worlds(state.world.revision);
      if (!doc || span.to <= span.from) return () => null;
      const ctx = store.env.registry.context(doc, state.world);
      const world = ctx.world;
      const view = store.viewOf(state);
      // Each that falls due, with the levels it concerns (null: every one), how many, and in the order a listing breaks a tie of
      // time in: each schedule's slot, by schedule and slot (its first start, and its run counted as `due` counts it), then the rest.
      const all: { refs: (string | null)[] | null; at: number; kind: string; n: number | null }[] = [];
      const calendar = chatWorld(ctx);
      for (const schedule of chatSchedulesIn(ctx)) {
        const who = scheduleOwners(store.env.registry, world, state.world, schedule);
        schedule.slots.forEach((s, slot) => {
          const { starts, more } = slotStarts(calendar, [schedule], span.from, span.to, 1, (_, i) => i === slot);
          const first = starts[0];
          if (first === undefined) return;
          const place = schedule.target === "place" && typeof s.value === "string" && own(world.places, s.value) ? `place:${s.value}` : null;
          all.push({ refs: who.length === 0 ? null : [...who.map((id) => `entity:${id}`), place], at: first.at, kind: schedule.target, n: more === null ? null : 1 + more });
        });
      }
      for (const o of otherDue(store, ctx, state, view, span.from, span.to)) all.push({ refs: o.refs, at: o.entry.at, kind: o.entry.kind, n: 1 });
      // Summed under each level each concerns and every level above it, the soonest kept (`due(state, span, level, 1)`, at once).
      type Under = { n: number | null; at: number; rank: number; kind: string };
      const join = (a: Under | undefined, b: Under): Under => {
        if (a === undefined) return b;
        const first = b.at < a.at || (b.at === a.at && b.rank < a.rank) ? b : a;
        return { n: a.n === null || b.n === null ? null : a.n + b.n, at: first.at, rank: first.rank, kind: first.kind };
      };
      let everywhere: Under | undefined;
      const byLevel = new Map<string, Under>();
      all.forEach((d, rank) => {
        const one: Under = { n: d.n, at: d.at, rank, kind: d.kind };
        if (d.refs === null) {
          everywhere = join(everywhere, one);
          return;
        }
        const levels = new Set<string>();
        for (const ref of d.refs) for (let r: string | null = ref; r !== null && !levels.has(r); r = view.parentOf(r)) levels.add(r);
        for (const level of levels) byLevel.set(level, join(byLevel.get(level), one));
      });
      return (ref) => {
        const mine = byLevel.get(ref);
        const sum = mine === undefined ? everywhere : everywhere === undefined ? mine : join(mine, everywhere);
        return sum === undefined ? null : { n: sum.n, at: sum.at, kind: sum.kind };
      };
    },
  };
}
