// Economy UI: the Money panel and the data-table editor (catalog, categories, occupations,
// regions, finance tables are all `tables`).

import type { UiPackDef } from "../../../frontend/registry";
import { MoneyPanel } from "./panel";

const economy: UiPackDef = {
  id: "economy",
  register(r) {
    r.panel({ id: "economy.money", label: "Money", order: 30, component: MoneyPanel });
  },
};

export default economy;
