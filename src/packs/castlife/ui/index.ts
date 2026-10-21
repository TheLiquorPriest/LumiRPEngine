// Cast life UI: the People destination's cast list, the person sheet (plans, agendas, regard), and
// the GM view's Routines tab (everyone's routine and schedules as this chat has them, with the
// per-chat controls).

import type { UiPackDef } from "../../../frontend/registry";
import { CastPanel } from "./panel";
import { PersonSheet } from "./person";
import { GmRoutinesSection } from "./routines-gm";

const castlife: UiPackDef = {
  id: "castlife",
  register(r) {
    r.panel({ id: "castlife.cast", label: "Cast", order: 60, home: "people", component: CastPanel });
    r.sheet("person", PersonSheet);
    // Between Minds (20) and Money (30).
    r.gm({ id: "castlife.routines", label: "Routines", icon: "calendar", order: 25, component: GmRoutinesSection });
  },
};

export default castlife;
