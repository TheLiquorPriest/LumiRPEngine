// The lore's registration with the application (plan §4.1): its tables and its settings. The lore
// itself is made by the turn lane, over the books the door reads.

import type { Area } from "../app";
import { LORE_MIGRATIONS } from "./schema";
import { LORE_SETTINGS } from "./settings";

export function loreArea(): Area {
  return { name: "lore", tables: [{ area: "lore", migrations: LORE_MIGRATIONS }], settings: LORE_SETTINGS };
}
