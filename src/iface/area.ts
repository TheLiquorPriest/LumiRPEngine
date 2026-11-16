// The engine's tools' registration with the application (plan §4.1): their settings, and the route of the systems the
// engine plays by. The tools themselves are given to agents by the turn lane, which makes them for each chat.

import type { Area } from "../app";
import { IFACE_SETTINGS } from "./kit";
import { type SystemsTakes, systemsRoutes } from "./systems";

export function ifaceArea(takes: () => SystemsTakes): Area {
  return { name: "iface", settings: IFACE_SETTINGS, mounted: (at) => at.routes.add("iface", systemsRoutes(takes())) };
}
