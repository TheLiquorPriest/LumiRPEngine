// The engine's tools' registration with the application (plan §4.1): their settings. The tools
// themselves are given to agents by the turn lane, which makes them for each chat.

import type { Area } from "../app";
import { IFACE_SETTINGS } from "./kit";

export function ifaceArea(): Area {
  return { name: "iface", settings: IFACE_SETTINGS };
}
