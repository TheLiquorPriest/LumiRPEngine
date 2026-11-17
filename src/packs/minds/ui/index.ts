// Minds UI: Play's What you know (DESIGN §24.11).

import type { UiPackDef } from "../../../frontend/registry";
import { KNOWN_PANEL } from "../../../shared/minds";
import { KnownPanel } from "./known";

const minds: UiPackDef = {
  id: "minds",
  register(r) {
    r.panel({ id: KNOWN_PANEL, label: "What you know", order: 85, home: "story", component: KnownPanel });
  },
};

export default minds;
