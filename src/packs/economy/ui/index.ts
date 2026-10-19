// Economy UI: the Money panel, everyone's money in the GM view, and the narrated-price cap among
// its config fields in Build (the data tables, catalog, categories, occupations, regions and
// finance, are all `tables`).

import type { UiPackDef } from "../../../frontend/registry";
import { EconomyConfig } from "./config";
import { GmMoneySection } from "./gm";
import { MoneyPanel } from "./panel";

const economy: UiPackDef = {
  id: "economy",
  register(r) {
    r.panel({ id: "economy.money", label: "Money", order: 30, component: MoneyPanel });
    r.gm({ id: "economy.money", label: "Money", order: 30, component: GmMoneySection });
    r.config(EconomyConfig);
  },
};

export default economy;
