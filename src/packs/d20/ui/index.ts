// The tabletop rules' UI: Play → Me → You is their sheet while they are on in the chat (the sheets pack's You gives way to it), a
// person's sheet shows theirs, and Now's glance what the character is under.

import type { UiPackDef } from "../../../frontend/registry";
import { D20Glance, D20PersonPart, D20YouPanel } from "./panel";

const d20: UiPackDef = {
  id: "d20",
  register(r) {
    r.panel({ id: "d20.sheet", label: "You", order: 20, home: "me", component: D20YouPanel });
    r.glance({ id: "d20.conditions", order: 85, panel: "d20.sheet", component: D20Glance });
    r.personPart({ id: "d20.sheet", order: 10, component: D20PersonPart });
  },
};

export default d20;
