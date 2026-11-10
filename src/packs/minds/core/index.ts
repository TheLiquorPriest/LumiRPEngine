// Character minds (DESIGN §24): simulated perspectives that drive characters while the mechanics
// ground them. This pure core keeps what minds recorded (each character's latest mind, plans, notes,
// commitments, witness log and summary; the chat's minds round; who was present for each turn; what
// everyone knows, §24.11), scores the fidelity ladder, renders the narrator's Minds and Who knows
// what sections and Play's What you know, carries the knowledge step's change types (`learn`,
// `reveal`), and words the GM's controls. The model calls are the backend's (`backend/minds*.ts`,
// `backend/knowledge-*.ts`); every answer arrives here as an event, so a fold never calls a model.
//
// Level contract: none. Minds aren't a realism domain; the user's Settings → Minds and the world's
// `minds` config decide them, and the castlife planner reads their plans through `minds.plans`.

import type { JsonValue } from "../../../shared/json";
import type { PackDef } from "../../../engine/registry";
import "./contract";
import { KNOWLEDGE_DEFAULTS, KNOWLEDGE_SLOT, KNOWN_PANEL, MINDS_SLOT } from "../../../shared/minds";
import { MINDS_EVENT_DEFS, mindsOn } from "./events";
import { mindEdit } from "./edit";
import { fidelityOf } from "./fidelity";
import { KNOWLEDGE_CHANNELS, knowEffect } from "./knowledge-channels";
import { knowledgeLines } from "./knowledge-section";
import { buildKnownView } from "./known";
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
    r.query("minds.knowing", () => KNOWLEDGE_DEFAULTS);
    r.renderer({ slot: MINDS_SLOT, label: "What the characters' minds are on", render: (ctx) => mindLines(ctx).map((l) => l.line) });
    r.renderer({ slot: KNOWLEDGE_SLOT, label: "Who knows what", render: (ctx) => knowledgeLines(ctx, "player").map((l) => l.text), feed: knowledgeLines });
    r.view({ panel: KNOWN_PANEL, build: (ctx) => buildKnownView(ctx) as unknown as JsonValue });
    r.effect(knowEffect);
    for (const channel of KNOWLEDGE_CHANNELS) r.proposal(channel);
    for (const rule of MINDS_LINTS) r.lint(rule);
  },
};

export default mindsPack;
