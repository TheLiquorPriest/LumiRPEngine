// Minds UI: the GM view's Minds tab (DESIGN §24.9). Settings → Minds, Build → World → Minds and the
// inspector's minds calls are the engine's own screens.

import type { UiPackDef } from "../../../frontend/registry";
import { GmMindsSection } from "./gm";

const minds: UiPackDef = {
  id: "minds",
  register(r) {
    r.gm({ id: "minds.gm", label: "Minds", icon: "sparkle", order: 20, component: GmMindsSection });
  },
};

export default minds;
