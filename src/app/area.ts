// The app's own registration (plan §4.1): what the application itself adds to the areas' lists, its
// settings. Its routes are its own (`appRoutes`), made where the app opens. Mounted first, it tells the
// composition the app it is mounted in (`opened`), for what the composition hands the other areas.

import type { App, Area } from "./app";
import { UPDATE_SETTINGS } from "./update";

export function appArea(opened?: (app: App) => void): Area {
  return { name: "app", settings: UPDATE_SETTINGS, ...(opened !== undefined ? { mount: opened } : {}) };
}
