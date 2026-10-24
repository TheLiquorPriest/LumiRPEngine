// Character minds (DESIGN §24): simulated perspectives that drive characters while the mechanics
// ground them. This pure core keeps what minds recorded (each character's latest mind, plans, notes,
// commitments, witness log and summary; the chat's minds round; who was present for each turn),
// scores the fidelity ladder, renders the narrator's Minds section and words the GM's controls. The
// model calls are the backend's (`backend/minds*.ts`); every answer arrives here as an event, so a
// fold never calls a model.
//
// Level contract: none. Minds aren't a realism domain; the user's Settings → Minds and the world's
// `minds` config decide them, and the castlife planner reads their plans through `minds.plans`.

import type { PackDef } from "../../../engine/registry";
import "./contract";
import { MINDS_SLOT } from "../../../shared/minds";
import { MINDS_EVENT_DEFS, mindsOn } from "./events";
import { mindEdit } from "./edit";
import { fidelityOf } from "./fidelity";
import { MINDS_LINTS } from "./lint";
import { mindLines, minded } from "./section";
import { keptPlans, lastDue, PACK, readCharacter } from "./state";

export const mindsPack: PackDef = {
  id: PACK,
  label: "Minds",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    for (const def of MINDS_EVENT_DEFS) r.event(def);
    r.service("minds.edit", mindEdit);
    r.query("minds.plans", (ctx, who) => keptPlans(readCharacter(ctx.state, who)));
    r.query("minds.tier", (ctx, who) => {
      const c = readCharacter(ctx.state, who);
      return c.pin ?? lastDue(c)?.level ?? "background";
    });
    r.query("minds.minded", minded);
    r.query("minds.on", mindsOn);
    r.query("minds.intent", (ctx, who) => (readCharacter(ctx.state, who).intent?.text ?? "") !== "");
    r.query("minds.fidelity", (ctx, texts) => fidelityOf(ctx, texts));
    r.renderer({ slot: MINDS_SLOT, render: (ctx) => mindLines(ctx).map((l) => l.line) });
    for (const rule of MINDS_LINTS) r.lint(rule);
  },
};

export default mindsPack;
