// Economy UI: the money hub (Play → Money, and everyone's in the GM view), the economy pack's config
// in Build (the narrated-price cap, the Custom money features, products and assets), and Build's
// editors for the structured money fields of its kinds and for places' cash machines and branches.
// The data tables (catalog, categories, occupations, regions, finance) are all `tables`.

import type { UiPackDef } from "../../../frontend/registry";
import { EconomyConfig } from "./config";
import { MONEY_FIELD_EDITORS, MONEY_PLACE_FIELDS } from "./field-editors";
import { GmMoneySection } from "./gm";
import { MoneyPanel } from "./panel";

const economy: UiPackDef = {
  id: "economy",
  register(r) {
    r.panel({ id: "economy.money", label: "Money", order: 30, component: MoneyPanel });
    r.gm({ id: "economy.money", label: "Money", order: 30, component: GmMoneySection });
    r.config(EconomyConfig);
    for (const def of MONEY_FIELD_EDITORS) r.field(def);
    for (const def of MONEY_PLACE_FIELDS) r.placeField(def);
  },
};

export default economy;
