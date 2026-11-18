// Combat UI: the Encounter, leading Play → Now while a fight is under way (its view is null otherwise), and the fight's page it opens.

import type { UiPackDef } from "../../../frontend/registry";
import { EncounterPanel, FightSheet } from "./panel";

const combat: UiPackDef = {
  id: "combat",
  register(r) {
    r.panel({ id: "combat.encounter", label: "Encounter", order: 5, home: "now", component: EncounterPanel });
    r.sheet("fight", FightSheet);
  },
};

export default combat;
