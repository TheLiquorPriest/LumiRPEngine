// Sheets & checks UI: the You panel and the check editor.

import type { UiPackDef } from "../../../frontend/registry";
import { YouPanel } from "./panel";

const sheets: UiPackDef = {
  id: "sheets",
  register(r) {
    r.panel({ id: "sheets.you", label: "You", order: 20, component: YouPanel });
  },
};

export default sheets;
