// Sheets & checks UI: the You panel, and its glance on Now (active conditions).

import type { UiPackDef } from "../../../frontend/registry";
import { YouGlance } from "./glance";
import { YouPanel } from "./panel";

const sheets: UiPackDef = {
  id: "sheets",
  register(r) {
    r.panel({ id: "sheets.you", label: "You", order: 20, home: "me", component: YouPanel });
    r.glance({ id: "sheets.conditions", order: 85, panel: "sheets.you", component: YouGlance });
  },
};

export default sheets;
