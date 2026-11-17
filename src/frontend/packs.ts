// Every UI pack, in registration order. `core` holds the engine's own panels (Scene in Now and
// Journal in Story); each domain pack's `ui` registers its panels, editors and chip renderers.

import calendar from "../packs/calendar/ui";
import combat from "../packs/combat/ui";
import castlife from "../packs/castlife/ui";
import economy from "../packs/economy/ui";
import gear from "../packs/gear/ui";
import minds from "../packs/minds/ui";
import orgs from "../packs/orgs/ui";
import sheets from "../packs/sheets/ui";
import space from "../packs/space/ui";
import story from "../packs/story/ui";
import vehicles from "../packs/vehicles/ui";
import { JournalPanel } from "./play/journal";
import { ScenePanel } from "./play/scene";
import type { UiPackDef } from "./registry";

const core: UiPackDef = {
  id: "core",
  register(r) {
    r.panel({ id: "core.scene", label: "Scene", order: 10, home: "now", component: ScenePanel });
    r.panel({ id: "core.journal", label: "Journal", order: 90, home: "story", component: JournalPanel });
  },
};

export const UI_PACKS: readonly UiPackDef[] = [core, sheets, economy, vehicles, gear, castlife, orgs, calendar, story, space, combat, minds];
