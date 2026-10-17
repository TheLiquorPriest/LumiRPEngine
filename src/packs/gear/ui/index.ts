// Gear & containers UI: the Gear panel (Owned / Worn / Carried / Stored).

import type { UiPackDef } from "../../../frontend/registry";
import { GearPanel } from "./panel";

const gear: UiPackDef = {
  id: "gear",
  register(r) {
    r.panel({ id: "gear.gear", label: "Gear", order: 50, component: GearPanel });
  },
};

export default gear;
