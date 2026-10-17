// The starter worlds the Build tab offers as templates (DESIGN §13). Each is the converted form of a
// neutral template in data-src/templates (`bun run templates` regenerates the JSON beside this file).
// The key is the template id the Build tab sends to `lre.world create`; the store assigns the id.

import type { WorldDoc } from "../../shared/world";
import fantasyTown from "./fantasy_town.json";
import mysteryManor from "./mystery_manor.json";
import modernSliceOfLife from "./modern_slice_of_life.json";

const starter = (doc: unknown) => (id: string, name: string): WorldDoc => ({ ...structuredClone(doc as WorldDoc), id, name });

export const STARTER_WORLDS: Record<string, (id: string, name: string) => WorldDoc> = {
  fantasy_town: starter(fantasyTown),
  mystery_manor: starter(mysteryManor),
  modern_slice_of_life: starter(modernSliceOfLife),
};
