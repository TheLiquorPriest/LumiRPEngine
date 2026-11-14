// What time brings due (plan §6.4; §6.1: code lists what is due when time passes, and never decides
// what the passing of time did). For a span and a part of the tree: each slot that starts in the span
// on a schedule today's engine keeps (a routine or a shift, which puts someone somewhere or at
// something; the world's own processes, such as weather, prices or bills, which concern everyone),
// with who it concerns and where. A list only: nothing in it is applied, and a slot whose value is
// left to chance is listed by its schedule, its chance never drawn. The list stops at the bound the
// caller gives, soonest first, and the rest is counted, not made: a span of years costs what its first
// page does.

import type { JsonValue } from "../shared/json";
import type { ScheduleDef } from "../shared/world";
import { own } from "../engine/pack-kit";
import { chatSchedulesIn, scheduleOwners, slotStarts } from "../engine/schedules";
import type { Store } from "./store";
import type { DueEntry, DueSource } from "./world-state";

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
      const { starts, more } = slotStarts(world, chatSchedulesIn(ctx), span.from, span.to, most, (schedule, slot) => entryOf(schedule, slot) !== null);
      const items: DueEntry[] = [];
      for (const i of starts) {
        const entry = entryOf(i.schedule, i.slot);
        if (entry !== null) items.push({ at: i.at, ...entry });
      }
      return { items, more };
    },
  };
}
