// The update's settings as the config files give them.

import type { Log } from "rp-harness/contract";
import { sharedLevels } from "../../tree";
import { diskTexts, readConfig } from "../config-read";
import type { DataPaths } from "../config";
import { UPDATE_SETTINGS, updateSettings, type UpdateSettings } from "../update";

/** The update's settings as the global level's config files give them now: the shipped file's, and the user's own over it. */
export async function updateSettingsOf(paths: DataPaths, log: Log): Promise<UpdateSettings> {
  return updateSettings(readConfig(await diskTexts(sharedLevels(paths.files)), log, UPDATE_SETTINGS));
}
