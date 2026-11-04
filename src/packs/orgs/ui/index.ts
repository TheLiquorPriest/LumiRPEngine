// Orgs UI (ORG-SPEC §4): Play's Orgs destination, its home (`orgs.list`: the party, where you
// belong, the organizations you know of) and each organization's page, the `org` sheet, with its
// Overview, People and Rules and the tabs other packs add through `r.orgTab`, its own Property
// (Premises and entry), Plan (goals and orders) and the party's Rules part (what each tier means,
// §4.4); its editors, the `org_edit` sheet over the page (a member's sheet, Hire someone, Admit a
// member, a position, a delegation, the dues); Now's glance of the alerts that need you; and GM →
// Orgs (§6.1).

import type { UiPackDef } from "../../../frontend/registry";
import { ORGS_LIST_PANEL } from "../../../shared/org-view";
import { PARTY_SECTION } from "../../../shared/party";
import { GM_ORGS_SECTION, GmOrgsSection } from "./gm";
import { OrgsGlance } from "./feed";
import { OrgsPanel } from "./home";
import { OrgEditSheet } from "./member";
import { OrgSheet } from "./org";
import { PartyTiers } from "./party";
import { PLAN_TAB_DEF } from "./plan";
import { PROPERTY_TAB } from "./property";

const orgs: UiPackDef = {
  id: "orgs",
  register(r) {
    r.panel({ id: ORGS_LIST_PANEL, label: "Organizations", order: 10, home: "orgs", component: OrgsPanel });
    r.sheet("org", OrgSheet);
    r.sheet("org_edit", OrgEditSheet);
    r.gm({ id: GM_ORGS_SECTION, label: "Orgs", icon: "briefcase", order: 28, component: GmOrgsSection });
    r.orgTab(PROPERTY_TAB);
    r.orgTab(PLAN_TAB_DEF);
    r.glance({ id: "orgs.alerts", order: 76, panel: ORGS_LIST_PANEL, component: OrgsGlance });
    r.orgTab({ id: "orgs.party_tiers", label: "What each tier means", order: 95, section: PARTY_SECTION, within: "rules", component: PartyTiers });
  },
};

export default orgs;
