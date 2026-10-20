// Economy UI: the money hub (Play → Me → Money, its pages riding Play's sheet stack as `money` and
// `account` sheets, and everyone's in GM mode), Now's money glance, the economy pack's config in
// Build (the narrated-price cap, the claim cap, the Custom money features, products and assets), and Build's
// editors for the structured money fields of its kinds and for places' cash machines and branches.
// The data tables (catalog, categories, occupations, regions, finance) are all `tables`.

import type { UiPackDef } from "../../../frontend/registry";
import { EconomyConfig } from "./config";
import { MONEY_FIELD_EDITORS, MONEY_PLACE_FIELDS } from "./field-editors";
import { MoneyGlance } from "./glance";
import { GmMoneySection } from "./gm";
import { MoneyPanel } from "./panel";
import { AccountSheet, MoneySheet } from "./sheet";

const economy: UiPackDef = {
  id: "economy",
  register(r) {
    r.panel({ id: "economy.money", label: "Money", order: 30, home: "me", component: MoneyPanel });
    r.sheet("money", MoneySheet);
    r.sheet("account", AccountSheet);
    r.glance({ id: "economy.due", order: 75, panel: "economy.money", component: MoneyGlance });
    r.gm({ id: "economy.money", label: "Money", icon: "coins", order: 30, component: GmMoneySection });
    r.config(EconomyConfig);
    for (const def of MONEY_FIELD_EDITORS) r.field(def);
    for (const def of MONEY_PLACE_FIELDS) r.placeField(def);
  },
};

export default economy;
