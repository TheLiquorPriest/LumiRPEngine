// Cast life UI: the People destination's cast list and the person sheet (plans, agendas, regard).

import type { UiPackDef } from "../../../frontend/registry";
import { CastPanel } from "./panel";
import { PersonSheet } from "./person";

const castlife: UiPackDef = {
  id: "castlife",
  register(r) {
    r.panel({ id: "castlife.cast", label: "Cast", order: 60, home: "people", component: CastPanel });
    r.sheet("person", PersonSheet);
  },
};

export default castlife;
