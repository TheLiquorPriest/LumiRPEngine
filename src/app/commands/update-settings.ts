// The update's settings as the config files give them.

import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import { GLOBAL_CONFIG, SHIPPED_FOLDER } from "../../tree/layout";
import type { DataPaths } from "../config";
import { readText } from "../disk";
import { updateSettings, type UpdateSettings } from "../update";

/** The update's settings as the global level's config files give them now: the shipped file's, and the user's own over it. */
export async function updateSettingsOf(paths: DataPaths, log: Log): Promise<UpdateSettings> {
  return updateSettings(await Promise.all([join(paths.files, SHIPPED_FOLDER, GLOBAL_CONFIG), paths.globalConfig].map((file) => readText(file))), log);
}
