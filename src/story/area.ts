// The story's registration with the application (plan §4.1): its tables, its settings and its routes.

import type { Area } from "../app";
import { storyRoutes, type StoryRoutesDeps } from "./routes";
import { STORY_MIGRATIONS } from "./schema";
import { STORY_SETTINGS } from "./settings";

/** What the story takes from the turn lane: the store its record is in, whether a turn of a chat goes on, the guidance files and the settings in force for a chat. */
export type StoryTakes = Omit<StoryRoutesDeps, "writes" | "now">;

/** `takes` is asked once the turn lane is mounted: the routes are made then. */
export function storyArea(takes: () => StoryTakes): Area {
  return {
    name: "story",
    tables: [{ area: "story", migrations: STORY_MIGRATIONS }],
    settings: STORY_SETTINGS,
    mounted: (at) => at.routes.add("story", storyRoutes({ ...takes(), writes: at.writes })),
  };
}
