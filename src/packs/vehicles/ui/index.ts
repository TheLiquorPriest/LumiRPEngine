// Vehicles UI: the Garage panel, its glance on Now (low fuel, an overdue use grant or service), and
// the place sheet's Parked here part.

import type { UiPackDef } from "../../../frontend/registry";
import { GarageGlance } from "./glance";
import { ParkedHere } from "./here";
import { GaragePanel } from "./panel";

const vehicles: UiPackDef = {
  id: "vehicles",
  register(r) {
    r.panel({ id: "vehicles.garage", label: "Garage", order: 40, home: "me", component: GaragePanel });
    r.glance({ id: "vehicles.attention", order: 70, panel: "vehicles.garage", component: GarageGlance });
    r.placePart({ id: "vehicles.here", order: 20, component: ParkedHere });
  },
};

export default vehicles;
