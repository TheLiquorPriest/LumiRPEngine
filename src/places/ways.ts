// A place's ways (plan §8.2): every route that joins it, the world's and the chat's own, each with its minutes and distance per way of
// travel and, for one the chat laid or changed, the turn that did it; and what is adjoining, by the rule the world state's "Around it"
// uses: the places beside it in the same place, and those a way joins it to.

import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { RouteDef } from "../shared/world";
import { DRAFT_EVENT } from "../engine/world-draft";
import type { PlaceAt } from "./record";
import { placeDef } from "./record";
import type { Infer } from "../app";
import type { adjoiningRow, wayRow } from "./shapes";

export type PlaceWay = Infer<typeof wayRow>;
export type PlaceAdjoining = Infer<typeof adjoiningRow>;

/** The turn that laid or last changed each of the chat's own routes on the path read at, by route id: the newest applied draft change of it. */
export function routesLaidIn(at: PlaceAt, ids: ReadonlySet<string>): Map<string, string> {
  const laid = new Map<string, string>();
  if (ids.size === 0) return laid;
  const line = at.u.line(at.chat).map((l) => l.turn);
  const stop = at.turn === null ? -1 : line.indexOf(at.turn);
  const turns = at.turn !== null && stop < 0 ? [...line, at.turn] : at.turn === null ? line : line.slice(0, stop + 1);
  for (const turn of turns) {
    for (const c of at.u.changes(turn)) {
      if (!c.applied || c.op !== DRAFT_EVENT || !isRecord(c.value) || !isRecord(c.value.data)) continue;
      const data: JsonObject = c.value.data;
      if (data.collection === "routes" && typeof data.id === "string" && ids.has(data.id)) laid.set(data.id, turn);
    }
  }
  return laid;
}

/** A route's ways of travel as the record shows them, in the order the world lists the modes. */
function modesOf(route: RouteDef): PlaceWay["modes"] {
  return Object.entries(route.modes).map(([mode, leg]) => ({ mode, minutes: leg?.minutes ?? 0, km: leg?.distanceKm ?? null }));
}

/** The routes of the played world that join `place`, each with where it leads and the turn the chat laid it. */
export function waysOf(at: PlaceAt, place: string): PlaceWay[] {
  const routes = Object.values(at.ctx.world.routes).filter((r) => r.from === place || r.to === place);
  const own = new Set(routes.filter((r) => r.map === undefined).map((r) => r.id));
  const laid = routesLaidIn(at, own);
  return routes
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r): PlaceWay => {
      const other = r.from === place ? r.to : r.from;
      return {
        route: r.id,
        to: { id: other, name: placeDef(at, other)?.name ?? other },
        modes: modesOf(r),
        dir: r.bidirectional ? "both" : r.from === place ? "out" : "in",
        turn: laid.get(r.id) ?? null,
      };
    });
}

/** The places next to a place: those beside it in the same place, and those a way joins it to, each once. */
export function adjoiningOf(at: PlaceAt, place: string): PlaceAdjoining[] {
  const out = new Map<string, PlaceAdjoining>();
  const add = (id: string, how: PlaceAdjoining["how"]): void => {
    if (id !== place && !out.has(id) && placeDef(at, id) !== undefined) out.set(id, { id, name: placeDef(at, id)?.name ?? id, how });
  };
  const parent = placeDef(at, place)?.parent;
  if (parent !== undefined) for (const [id, def] of Object.entries(at.ctx.world.places)) if (def.parent === parent) add(id, "beside");
  for (const r of Object.values(at.ctx.world.routes)) {
    if (r.from === place) add(r.to, "way");
    else if (r.to === place) add(r.from, "way");
  }
  return [...out.values()];
}

/** A place's ways part: every way that joins it, and what is adjoining. */
export function waysPart(at: PlaceAt, place: string): { ways: PlaceWay[]; adjoining: PlaceAdjoining[] } {
  return { ways: waysOf(at, place), adjoining: adjoiningOf(at, place) };
}
