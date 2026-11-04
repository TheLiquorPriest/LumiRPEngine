// Gear & containers UI: the Gear panel (What you have: On you / Holding for others / Yours elsewhere
// / Lent out / Borrowed; Manage: Outfit / Carried / Wardrobe, changed at once), the item sheet, the
// place sheet's Things here, a glance on Now for things lent out and overdue back, and the gear
// pack's config in Build (everyday carry).

import type { UiPackDef } from "../../../frontend/registry";
import { GearConfig } from "./config";
import { GearGlance } from "./glance";
import { ThingsHere } from "./here";
import { ItemSheet } from "./item";
import { GearPanel } from "./panel";

const gear: UiPackDef = {
  id: "gear",
  register(r) {
    r.panel({ id: "gear.gear", label: "Gear", order: 50, home: "me", component: GearPanel });
    r.sheet("item", ItemSheet);
    r.glance({ id: "gear.overdue", order: 80, panel: "gear.gear", component: GearGlance });
    r.placePart({ id: "gear.here", order: 10, component: ThingsHere });
    r.config(GearConfig);
  },
};

export default gear;
