// Combat UI: the Encounter tab, first in Play while a fight is under way (its view is null otherwise).

import type { UiPackDef } from "../../../frontend/registry";
import { EncounterPanel } from "./panel";

const combat: UiPackDef = {
  id: "combat",
  register(r) {
    r.panel({ id: "combat.encounter", label: "Encounter", order: 5, component: EncounterPanel });
  },
};

export default combat;
