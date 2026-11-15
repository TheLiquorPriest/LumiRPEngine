// The app's own registration (plan §4.1): what the application itself adds to the areas' lists, its
// settings (the update's and the app's own limits), and the Settings routes over the whole registry.
// Its other routes are its own (`appRoutes`), made where the app opens. Mounted first, it tells the
// composition the app it is mounted in (`opened`), for what the composition hands the other areas.

import type { App, Area } from "./app";
import { installFacts, SERVER_SETTINGS } from "./config";
import { PAGE_SETTINGS } from "./page-settings";
import { type SettingsDeps, settingsRoutes } from "./settings-routes";
import { UPDATE_SETTINGS } from "./update";

/** What the app area takes from the composition. */
export interface AppTakes {
  /** Told the app once it is mounted in it. */
  opened(app: App): void;
  /** Where a chat's levels are on disk and the model layer's connections, from the areas that know them, for the Settings routes. */
  settings(app: App): Pick<SettingsDeps, "levels" | "connections">;
}

export function appArea(takes?: AppTakes): Area {
  return {
    name: "app",
    settings: [...UPDATE_SETTINGS, ...SERVER_SETTINGS, ...PAGE_SETTINGS],
    ...(takes === undefined
      ? {}
      : {
          mount: (at: App) => takes.opened(at),
          // Once every area is mounted: the levels and connections come from the tree and the turn lane.
          mounted: (at: App) => at.routes.add("settings", settingsRoutes({ settings: at.settings, facts: () => installFacts(at.config, at.paths), ...takes.settings(at) })),
        }),
  };
}
