// The story's registration with the application (plan §4.1): its tables, its settings and its routes, those of the quests and of the places among them.

import type { Area } from "../app";
import { placesRoutes, type PlacesRoutesDeps } from "../places/routes";
import { PLACES_DEFAULTS, PLACES_SETTINGS } from "../places/settings";
import { questRoutes, type QuestRoutesDeps } from "../quests/routes";
import { QUESTS_SETTINGS } from "../quests/settings";
import { storyRoutes, type StoryRoutesDeps } from "./routes";
import { STORY_MIGRATIONS } from "./schema";
import { STORY_SETTINGS } from "./settings";

/**
 * What the story takes from the turn lane: the store its record is in, the guidance files and the settings in force for a chat, and the reads of the prompt's window and the story so far. The quests' `knows` rides with them, and the places' settings and what they read of the lore (the entries bound to a place and each as Lumiverse holds it now); with neither, a place shows no sources.
 */
export type StoryTakes = Omit<StoryRoutesDeps, "writes" | "now"> & Pick<QuestRoutesDeps, "knows" | "quests"> & { places?: Partial<Pick<PlacesRoutesDeps, "settings" | "sources" | "cast">> };

/** `takes` is asked once the turn lane is mounted: the routes are made then. */
export function storyArea(takes: () => StoryTakes): Area {
  return {
    name: "story",
    tables: [{ area: "story", migrations: STORY_MIGRATIONS }],
    settings: [...STORY_SETTINGS, ...PLACES_SETTINGS, ...QUESTS_SETTINGS],
    mounted: (at) => {
      const taken = takes();
      at.routes.add("story", storyRoutes({ ...taken, writes: at.writes }));
      at.routes.add("quests", questRoutes(taken));
      at.routes.add("places", placesRoutes({ store: taken.store, writes: at.writes, files: taken.files, settings: taken.places?.settings ?? (async () => PLACES_DEFAULTS), ...(taken.places?.sources !== undefined ? { sources: taken.places.sources } : {}), ...(taken.places?.cast !== undefined ? { cast: taken.places.cast } : {}) }));
    },
  };
}
