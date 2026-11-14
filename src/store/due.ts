// What time brings due (plan §6.4; §6.1: code lists what is due when time passes, and never decides
// what the passing of time did). For a span and a part of the tree: each slot that starts in the span
// on a schedule today's engine keeps (a routine or a shift, which puts someone somewhere or at
// something; the world's own processes, such as weather, prices or bills, which concern everyone),
// with who it concerns and where. A list only: nothing in it is applied, and a slot whose value is
// left to chance is listed by its schedule, its chance never drawn.

import type { JsonValue } from "../shared/json";
import type { ScheduleDef } from "../shared/world";
import { own } from "../engine/pack-kit";
import { chatSchedulesIn, scheduleInstants, scheduleOwners } from "../engine/schedules";
import type { Store } from "./store";
import type { DueEntry, DueSource } from "./world-state";

/** What time brings due over the store's states: what the world state and the engine's tools take as `due`. */
export function timeDue(store: Store): DueSource {
  return {
    due(state, span, at) {
      const doc = store.env.worlds(state.world.revision);
      if (!doc || span.to <= span.from) return [];
      const ctx = store.env.registry.context(doc, state.world);
      const world = ctx.world;
      const view = store.viewOf(state);
      const root = at === null ? null : view.resolve(at);
      // Inside the part of the tree asked about: the level itself, or anything in it.
      const inside = (ref: string): boolean => {
        for (let r: string | null = ref; r !== null; r = view.parentOf(r)) if (r === root) return true;
        return false;
      };
      const owners = new Map<ScheduleDef, string[]>();
      const out: DueEntry[] = [];
      for (const i of scheduleInstants(world, chatSchedulesIn(ctx), span.from, span.to)) {
        if (i.edge !== "start") continue;
        let who = owners.get(i.schedule);
        if (!who) {
          who = scheduleOwners(store.env.registry, world, state.world, i.schedule);
          owners.set(i.schedule, who);
        }
        const value = i.schedule.slots[i.slot]?.value;
        const place = i.schedule.target === "place" && typeof value === "string" && own(world.places, value) ? `place:${value}` : null;
        // A person's schedule outside the part asked about is not listed; the world's own processes concern every part.
        const here = root === null ? who : who.filter((id) => inside(`entity:${id}`) || (place !== null && inside(place)));
        if (who.length > 0 && here.length === 0) continue;
        const what: JsonValue = value === undefined || place !== null ? i.schedule.id : value;
        out.push({ at: i.at, kind: i.schedule.target, ...(place !== null ? { where: place } : {}), ...(here.length > 0 ? { who: here } : {}), what });
      }
      return out;
    },
  };
}
