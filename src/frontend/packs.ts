// Every UI pack, in registration order. `core` holds the engine's own Play panels; each domain
// pack's `ui` registers its panels, editors and chip renderers.

import calendar from "../packs/calendar/ui";
import castlife from "../packs/castlife/ui";
import economy from "../packs/economy/ui";
import gear from "../packs/gear/ui";
import sheets from "../packs/sheets/ui";
import space from "../packs/space/ui";
import story from "../packs/story/ui";
import vehicles from "../packs/vehicles/ui";
import { ContextPanel } from "./play/context";
import { GmPanel } from "./play/gm";
import { JournalPanel } from "./play/journal";
import { ScenePanel } from "./play/scene";
import type { UiPackDef } from "./registry";

const core: UiPackDef = {
  id: "core",
  register(r) {
    r.panel({ id: "core.scene", label: "Scene", order: 10, component: ScenePanel });
    r.panel({ id: "core.journal", label: "Journal", order: 90, component: JournalPanel });
    r.panel({ id: "core.context", label: "Context", order: 100, component: ContextPanel });
    r.panel({ id: "core.gm", label: "GM view", order: 110, component: GmPanel });
  },
};

export const UI_PACKS: readonly UiPackDef[] = [core, sheets, economy, vehicles, gear, castlife, calendar, story, space];
