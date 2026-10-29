// Minds UI: the GM view's Minds tab (DESIGN §24.9) and Play's What you know (DESIGN §24.11).
// Settings → Minds, Build → World → Minds and the inspector's minds calls are the engine's own
// screens.

import type { UiPackDef } from "../../../frontend/registry";
import { KNOWN_PANEL } from "../../../shared/minds";
import { GmMindsSection } from "./gm";
import { KnownPanel } from "./known";

const minds: UiPackDef = {
  id: "minds",
  register(r) {
    r.gm({ id: "minds.gm", label: "Minds", icon: "sparkle", order: 20, component: GmMindsSection });
    r.panel({ id: KNOWN_PANEL, label: "What you know", order: 85, home: "story", component: KnownPanel });
  },
};

export default minds;
