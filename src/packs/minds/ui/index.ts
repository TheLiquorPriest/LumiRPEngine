// Minds UI: the GM view's Minds tab (DESIGN §24.9; on a depth chat the Character Engine's minds,
// DEPTH-PLAN §4.4) and Play's What you know (DESIGN §24.11). Settings → Minds, Build → World → Minds
// and the inspector's minds calls are the engine's own screens.

import { MindsSection } from "../../../frontend/depth/minds";
import type { UiPackDef } from "../../../frontend/registry";
import { GM_ROSTER } from "../../../shared/gm-parts";
import { KNOWN_PANEL } from "../../../shared/minds";
import { KnownPanel } from "./known";

const minds: UiPackDef = {
  id: "minds",
  register(r) {
    // The minds, with the people and places their pages name.
    r.gm({ id: "minds.gm", label: "Minds", icon: "sparkle", order: 20, component: MindsSection, parts: ["minds", GM_ROSTER, "places"] });
    r.panel({ id: KNOWN_PANEL, label: "What you know", order: 85, home: "story", component: KnownPanel });
  },
};

export default minds;
