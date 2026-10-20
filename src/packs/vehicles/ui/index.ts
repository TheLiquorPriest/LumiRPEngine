// Vehicles UI: the Garage panel, and its glance on Now (low fuel, an overdue use grant or service).

import type { UiPackDef } from "../../../frontend/registry";
import { GarageGlance } from "./glance";
import { GaragePanel } from "./panel";

const vehicles: UiPackDef = {
  id: "vehicles",
  register(r) {
    r.panel({ id: "vehicles.garage", label: "Garage", order: 40, home: "me", component: GaragePanel });
    r.glance({ id: "vehicles.attention", order: 70, panel: "vehicles.garage", component: GarageGlance });
  },
};

export default vehicles;
