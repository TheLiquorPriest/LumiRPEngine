// The lore's registration with the application (plan §4.1): its tables, its settings and its routes. The
// lore itself is made by the turn lane, over the books the door reads; its routes are made once every area
// is mounted, over the store and the turns' tags of the turn lane, which the composition hands it.

import type { Area } from "../app";
import type { Store } from "../store";
import { EntryNumbers } from "./ids";
import { loreRoutes } from "./routes";
import { LORE_MIGRATIONS } from "./schema";
import { LORE_SETTINGS } from "./settings";
import type { LoreTurns } from "./sources";

/** What the lore's routes take from the turn lane: its store and the tags it keeps of each turn's prompt. */
export interface LoreTakes {
  store: Store;
  turns: LoreTurns;
}

/** `takes` is asked once the turn lane is mounted: the routes are made then; with none the area lists its tables and settings and adds no route. */
export function loreArea(takes?: () => LoreTakes): Area {
  return {
    name: "lore",
    tables: [{ area: "lore", migrations: LORE_MIGRATIONS }],
    settings: LORE_SETTINGS,
    ...(takes === undefined ? {} : { mounted: (at) => at.routes.add("lore", loreRoutes({ ...takes(), numbers: new EntryNumbers(at.db, at.writes) })) }),
  };
}
