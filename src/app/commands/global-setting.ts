// A setting the command line keeps in the user's own `RPE-global.yml` (`rpe up --memory`).

import { mkdir } from "node:fs/promises";
import type { JsonValue } from "rp-harness/contract";
import type { DataPaths } from "../config";
import { oneFileAtATime, readText, writeWhole } from "../disk";
import { withKeyAt } from "../yaml";

/** Writes `key` (dotted, as the file nests it) with `value` in the global file, every other line as it was. */
export async function writeGlobalSetting(paths: DataPaths, key: string, value: JsonValue): Promise<void> {
  await oneFileAtATime(paths.globalConfig, async () => {
    const text = (await readText(paths.globalConfig)) ?? "";
    await mkdir(paths.files, { recursive: true });
    await writeWhole(paths.globalConfig, withKeyAt(text, key.split("."), value, paths.globalConfig));
  });
}
