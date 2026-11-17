// Cast life UI: the People destination's cast list, the person sheet (plans, agendas, regard) and
// Me's Needs.

import type { UiPackDef } from "../../../frontend/registry";
import { NeedsPanel } from "./needs";
import { CastPanel } from "./panel";
import { PersonSheet } from "./person";

const castlife: UiPackDef = {
  id: "castlife",
  register(r) {
    r.panel({ id: "castlife.cast", label: "Cast", order: 60, home: "people", component: CastPanel });
    // Beside You (20), before Money (30): the player character's own state.
    r.panel({ id: "castlife.needs", label: "Needs", order: 25, home: "me", component: NeedsPanel });
    r.sheet("person", PersonSheet);
  },
};

export default castlife;
