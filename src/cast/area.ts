// The cast's registration with the application (plan §4.1): its tables, its settings and its routes.

import type { Area } from "../app";
import { stateChanged } from "../play/live";
import { countedOn, stagesAt } from "../turn/stage";
import type { OnStage } from "./facts";
import { CAST_SETTINGS } from "./kit";
import { castRoutes, type CastRoutesDeps } from "./routes";
import { CAST_MIGRATIONS } from "./schema";

/** What the cast takes from the turn lane: the store its records are in, the guidance files and the settings in force for a chat, and the sources as Lumiverse holds them now. */
export type CastTakes = Omit<CastRoutesDeps, "writes" | "now" | "onStage" | "changed">;

/** `takes` is asked once the turn lane is mounted: the routes are made then. */
export function castArea(takes: () => CastTakes): Area {
  return {
    name: "cast",
    tables: [{ area: "cast", migrations: CAST_MIGRATIONS }],
    settings: CAST_SETTINGS,
    mounted: (at) => {
      const taken = takes();
      // Who was on stage, and how that was read, is the one reading of a stage the cast's facts count by (`src/turn/stage.ts`, `countedOn`).
      const onStage: OnStage = async ({ user, chat }, turns) => new Map([...stagesAt(taken.store, user, chat, turns)].map(([turn, stage]) => [turn, countedOn(stage)]));
      at.routes.add("cast", castRoutes({ ...taken, onStage, writes: at.writes, changed: (chat) => stateChanged(at.live, chat) }));
    },
  };
}
