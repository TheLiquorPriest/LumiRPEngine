// The areas whose changes the store folds beside the engine's (plan §6.2): the one list, read by the store the application opens
// (`openAppStore`) and by the worker threads that fold a long history on their own connection to the file (`app/workers/tasks.ts`),
// so a thread folds a change of an area exactly as the store does. An area added to the store is added here and nowhere else.

import { CAST_STORE_AREA } from "../cast";
import { PLACE_STORE_AREA } from "../places";
import { QUEST_STORE_AREA } from "../quests";
import type { StoreArea } from "../store";
import { STORY_STORE_AREA } from "../story";

export const STORE_AREAS: readonly StoreArea[] = [CAST_STORE_AREA, STORY_STORE_AREA, QUEST_STORE_AREA, PLACE_STORE_AREA];
