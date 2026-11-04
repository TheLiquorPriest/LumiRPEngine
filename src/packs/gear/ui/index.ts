// Gear & containers UI: the Gear panel (On you / Holding for others / Yours elsewhere / Lent out /
// Borrowed), the item sheet, a glance on Now for things lent out and overdue back, and the gear
// pack's config in Build (everyday carry).

import type { UiPackDef } from "../../../frontend/registry";
import { GearConfig } from "./config";
import { GearGlance } from "./glance";
import { ItemSheet } from "./item";
import { GearPanel } from "./panel";

const gear: UiPackDef = {
  id: "gear",
  register(r) {
    r.panel({ id: "gear.gear", label: "Gear", order: 50, home: "me", component: GearPanel });
    r.sheet("item", ItemSheet);
    r.glance({ id: "gear.overdue", order: 80, panel: "gear.gear", component: GearGlance });
    r.config(GearConfig);
  },
};

export default gear;
