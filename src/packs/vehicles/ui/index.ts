// Vehicles UI: the Garage panel.

import type { UiPackDef } from "../../../frontend/registry";
import { GaragePanel } from "./panel";

const vehicles: UiPackDef = {
  id: "vehicles",
  register(r) {
    r.panel({ id: "vehicles.garage", label: "Garage", order: 40, component: GaragePanel });
  },
};

export default vehicles;
