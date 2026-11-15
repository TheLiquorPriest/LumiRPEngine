// The app's own registration (plan §4.1): what the application itself adds to the areas' lists, its
// settings. Its routes are its own (`appRoutes`), made where the app opens.

import type { Area } from "./app";
import { UPDATE_SETTINGS } from "./update";

export function appArea(): Area {
  return { name: "app", settings: UPDATE_SETTINGS };
}
