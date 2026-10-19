// Gear & containers UI: the Gear panel (Owned / Worn / Carried / Stored), the item sheet, and a
// glance on Now for things lent out and overdue back.

import type { UiPackDef } from "../../../frontend/registry";
import { GearGlance } from "./glance";
import { ItemSheet } from "./item";
import { GearPanel } from "./panel";

const gear: UiPackDef = {
  id: "gear",
  register(r) {
    r.panel({ id: "gear.gear", label: "Gear", order: 50, home: "me", component: GearPanel });
    r.sheet("item", ItemSheet);
    r.glance({ id: "gear.overdue", order: 80, panel: "gear.gear", component: GearGlance });
  },
};

export default gear;
