// The starter worlds the Build tab offers as templates (DESIGN §13). Each is the converted form of a
// neutral template in data-src/templates (`bun run templates` regenerates the JSON beside this file),
// with the tabletop rule set it carries put on as it loads (`withRules`, RULESET-DESIGN §7).
// The key is the template id the Build tab sends to `lre.world create`; the store assigns the id.

import type { WorldDoc } from "../../shared/world";
import fantasyTown from "./fantasy_town.json";
import mysteryManor from "./mystery_manor.json";
import modernSliceOfLife from "./modern_slice_of_life.json";
import { FANTASY_TOWN_RULES } from "./fantasy_town_rules";
import { withRules } from "./rules";

const starter = (doc: unknown) => (id: string, name: string): WorldDoc => ({ ...structuredClone(doc as WorldDoc), id, name });

export const STARTER_WORLDS: Record<string, (id: string, name: string) => WorldDoc> = {
  fantasy_town: starter(withRules(fantasyTown as unknown as WorldDoc, FANTASY_TOWN_RULES)),
  mystery_manor: starter(mysteryManor),
  modern_slice_of_life: starter(modernSliceOfLife),
};
