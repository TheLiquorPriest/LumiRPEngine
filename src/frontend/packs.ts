// Every UI pack, in registration order. `core` holds the engine's own panels (Scene and Journal in
// Play, GM view and Context in GM mode); each domain pack's `ui` registers its panels, editors and
// chip renderers.

import calendar from "../packs/calendar/ui";
import combat from "../packs/combat/ui";
import castlife from "../packs/castlife/ui";
import economy from "../packs/economy/ui";
import gear from "../packs/gear/ui";
import minds from "../packs/minds/ui";
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
    r.panel({ id: "core.scene", label: "Scene", order: 10, home: "now", component: ScenePanel });
    r.panel({ id: "core.journal", label: "Journal", order: 90, home: "story", component: JournalPanel });
    r.panel({ id: "core.gm", label: "GM view", order: 100, home: "gm", component: GmPanel });
    r.panel({ id: "core.context", label: "Context", order: 110, home: "gm", component: ContextPanel });
  },
};

export const UI_PACKS: readonly UiPackDef[] = [core, sheets, economy, vehicles, gear, castlife, calendar, story, space, combat, minds];
