// Every pack core, in registration order (requirements first), and the starter worlds.
// Zone `pack-index`: the one module that may import every pack's core by value; the backend,
// worker and the command line's local engine build registries from ALL_PACKS (the engine pack always first).

import type { DataTable } from "../shared/tables";
import type { PackDef } from "../engine/registry";
import { enginePack } from "../engine/engine-pack";
import calendarPack from "./calendar/core/index";
import spacePack from "./space/core/index";
import economyPack from "./economy/core/index";
import gearPack from "./gear/core/index";
import vehiclesPack from "./vehicles/core/index";
import weatherPack from "./weather/core/index";
import relationshipsPack from "./relationships/core/index";
import castlifePack from "./castlife/core/index";
import sheetsPack from "./sheets/core/index";
import storyPack from "./story/core/index";
import combatPack from "./combat/core/index";
import mindsPack from "./minds/core/index";

export const ALL_PACKS: readonly PackDef[] = [enginePack, calendarPack, spacePack, economyPack, gearPack, vehiclesPack, weatherPack, relationshipsPack, castlifePack, sheetsPack, storyPack, combatPack, mindsPack];

/** Every pack's default tables, keyed by id (world creation copies and pins them). */
export function defaultTables(packs: readonly PackDef[] = ALL_PACKS): Record<string, DataTable> {
  const out: Record<string, DataTable> = {};
  for (const pack of packs) {
    pack.register({
      kind: () => undefined,
      relation: () => undefined,
      event: () => undefined,
      guard: () => undefined,
      effect: () => undefined,
      service: () => undefined,
      query: () => undefined,
      formula: () => undefined,
      renderer: () => undefined,
      action: () => undefined,
      rule: () => undefined,
      schedule: () => undefined,
      table: (def) => {
        if (def.defaults) out[def.id] = def.defaults;
      },
      materializer: () => undefined,
      process: () => undefined,
      proposal: () => undefined,
      lint: () => undefined,
      view: () => undefined,
    });
  }
  return out;
}

/** Starter worlds by template id: `(id, name) → WorldDoc`, converted from `data-src/templates` by ops' converter. */
export { STARTER_WORLDS } from "./starters/index";
/** What each starter world is: its template id, name and a short summary (`lre.world templates`). */
export { STARTER_INFO } from "./starters/info";
