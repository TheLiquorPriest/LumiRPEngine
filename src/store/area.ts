// The store's registration with the application (plan §4.1): its tables and its settings. The store
// knows nothing of the application, so this describes the shape the application's `Area` takes and
// imports none of it; the composition hands it over as it stands.

import { STORE_MIGRATIONS } from "./schema";
import { STORE_SETTINGS } from "./settings";

export function storeArea() {
  return { name: "store", tables: [{ area: "store" as const, migrations: STORE_MIGRATIONS }], settings: STORE_SETTINGS };
}
