// The story's registration with the application (plan §4.1): its tables, its settings and its routes, those of the quests among them.

import type { Area } from "../app";
import { questRoutes, type QuestRoutesDeps } from "../quests/routes";
import { storyRoutes, type StoryRoutesDeps } from "./routes";
import { STORY_MIGRATIONS } from "./schema";
import { STORY_SETTINGS } from "./settings";

/** What the story takes from the turn lane: the store its record is in, the guidance files and the settings in force for a chat, and the reads of the prompt's window and the story so far. The quests' `knows` rides with them. */
export type StoryTakes = Omit<StoryRoutesDeps, "writes" | "now"> & Pick<QuestRoutesDeps, "knows">;

/** `takes` is asked once the turn lane is mounted: the routes are made then. */
export function storyArea(takes: () => StoryTakes): Area {
  return {
    name: "story",
    tables: [{ area: "story", migrations: STORY_MIGRATIONS }],
    settings: STORY_SETTINGS,
    mounted: (at) => {
      const taken = takes();
      at.routes.add("story", storyRoutes({ ...taken, writes: at.writes }));
      at.routes.add("quests", questRoutes(taken));
    },
  };
}
