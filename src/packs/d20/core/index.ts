// The tabletop rules layer (RULESET-DESIGN §3): one pack, its domain `d20`. It adds the formula functions a ruleset's totals are
// written with (§4.4), the actions an agent or the player carries out with `act` (§5.1), each action's procedure as an effect, and
// the records those make. A world wants it when it lists the pack and has a `ruleset.d20` part; a chat switches it with its level
// of the domain. Everything it adds reads the world's data: no number or formula of any game is written here.

import type { PackDef } from "../../../engine/registry";
import { D20_PACK } from "../../../shared/d20";
import { D20_ACTION_DEFS } from "./actions";
import { D20_FORMULAS } from "./functions";
import { D20_PROCEDURES } from "./procedures";
import { D20_RECORDS } from "./records";

export const d20Pack: PackDef = {
  id: D20_PACK,
  label: "Tabletop rules",
  version: 1,
  domain: "d20",
  requires: ["space", "gear", "combat"],
  register(r) {
    for (const [name, fn] of Object.entries(D20_FORMULAS)) r.formula(name, fn);
    for (const def of D20_RECORDS) r.event(def);
    for (const def of D20_PROCEDURES) r.effect(def);
    for (const def of D20_ACTION_DEFS) r.action(def);
  },
};

export default d20Pack;
