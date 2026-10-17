// Cast life UI: the Cast panel (timelines, agendas, regard).

import type { UiPackDef } from "../../../frontend/registry";
import { CastPanel } from "./panel";

const castlife: UiPackDef = {
  id: "castlife",
  register(r) {
    r.panel({ id: "castlife.cast", label: "Cast", order: 60, component: CastPanel });
  },
};

export default castlife;
