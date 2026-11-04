// Economy UI: your own money (Play → Me → Money, its segments Summary · Accounts · In & out ·
// Assets · Credit, its pages riding Play's sheet stack as `money` and `account` sheets; ORG-SPEC
// §5), an organization's Money, Ownership, Taxes and Payroll in Orgs (`r.orgTab`, with GM → Orgs'
// versions), a person's money in GM mode, Now's money glance, the economy pack's config in Build
// (the narrated-price cap, the claim cap, the Custom money features, products and assets), and
// Build's editors for the structured money fields of its kinds and for places' cash machines and
// branches. The data tables (catalog, categories, occupations, regions, finance) are all `tables`.

import type { UiPackDef } from "../../../frontend/registry";
import { EconomyConfig } from "./config";
import { MONEY_FIELD_EDITORS, MONEY_PLACE_FIELDS } from "./field-editors";
import { MoneyGlance } from "./glance";
import { GmMoneySection } from "./gm";
import { GmOrgMoneyTab, GmOrgPayrollPart, OrgMoneyTab, OrgPayrollPart } from "./orgs";
import { GmOrgOwnershipTab, OrgOwnershipTab } from "./ownership";
import { MoneyPanel } from "./panel";
import { AccountSheet, MoneySheet } from "./sheet";
import { GmOrgTaxesTab, OrgTaxesTab } from "./taxes";

const economy: UiPackDef = {
  id: "economy",
  register(r) {
    r.panel({ id: "economy.money", label: "Money", order: 30, home: "me", component: MoneyPanel });
    r.sheet("money", MoneySheet);
    r.sheet("account", AccountSheet);
    r.glance({ id: "economy.due", order: 75, panel: "economy.money", component: MoneyGlance });
    r.gm({ id: "economy.money", label: "Money", icon: "coins", order: 30, component: GmMoneySection });
    // An organization's page (ORG-SPEC §4.3): its tabs among the shell's Overview 10, People 20 and Rules 90, and Payroll at the foot of People.
    r.orgTab({ id: "economy.money", label: "Money", order: 40, section: "money", component: OrgMoneyTab, gm: GmOrgMoneyTab });
    r.orgTab({ id: "economy.ownership", label: "Ownership", order: 60, section: "ownership", component: OrgOwnershipTab, gm: GmOrgOwnershipTab });
    r.orgTab({ id: "economy.taxes", label: "Taxes", order: 70, section: "taxes", component: OrgTaxesTab, gm: GmOrgTaxesTab });
    r.orgTab({ id: "economy.payroll", label: "Payroll", order: 30, section: "payroll", within: "people", component: OrgPayrollPart, gm: GmOrgPayrollPart });
    r.config(EconomyConfig);
    for (const def of MONEY_FIELD_EDITORS) r.field(def);
    for (const def of MONEY_PLACE_FIELDS) r.placeField(def);
  },
};

export default economy;
