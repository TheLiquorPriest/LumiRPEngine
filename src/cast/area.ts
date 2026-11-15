// The cast's registration with the application (plan §4.1): its tables, its settings and its routes.

import type { Area } from "../app";
import { CAST_SETTINGS } from "./kit";
import { castRoutes, type CastRoutesDeps } from "./routes";
import { CAST_MIGRATIONS } from "./schema";

/** What the cast takes from the turn lane: the store its records are in, whether a turn of a chat goes on, the guidance files and the settings in force for a chat. */
export type CastTakes = Omit<CastRoutesDeps, "writes" | "now">;

/** `takes` is asked once the turn lane is mounted: the routes are made then. */
export function castArea(takes: () => CastTakes): Area {
  return {
    name: "cast",
    tables: [{ area: "cast", migrations: CAST_MIGRATIONS }],
    settings: CAST_SETTINGS,
    mounted: (at) => at.routes.add("cast", castRoutes({ ...takes(), writes: at.writes })),
  };
}
