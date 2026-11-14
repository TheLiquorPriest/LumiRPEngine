// The bootstrap's one setting (plan §12, Appendix D.1 "Bootstrap asks before: 200,000 tokens"): the
// token limit a bootstrap job is given, read for its chat from the config files of the chat's levels
// (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, as the turn lane reads its own and as RPH reads the limits it holds a job's run to
// (`jobs.run.*`). The job is told the limit; what it does as it nears it is the skill's to say.

import type { FilesPort, Log, Scope } from "rp-harness/contract";
import { isMapping, type Mapping, mergedConfig, type NumberSettings, type SettingDef } from "../../app/setting-list";
import { type ConfigRead, numbersOf } from "../settings";

/** Every fixed value of the bootstrap, each a setting with this default. */
export const BOOTSTRAP_DEFAULTS = Object.freeze({
  /** Tokens a bootstrap job is told it may spend (Appendix D.1). */
  tokenLimit: 200_000,
});

export type BootstrapSettings = { -readonly [K in keyof typeof BOOTSTRAP_DEFAULTS]: number };

/** Read at every level, since a job is started for one chat. */
export const BOOTSTRAP_SETTING_DEFS = {
  tokenLimit: { key: "bootstrap.tokenLimit", default: BOOTSTRAP_DEFAULTS.tokenLimit, takes: { type: "whole", least: 1 }, perConnection: false },
} as const satisfies NumberSettings<keyof BootstrapSettings>;

/** Every setting the bootstrap reads, as a config file writes it, for the Settings page. */
export const BOOTSTRAP_SETTINGS: readonly SettingDef[] = Object.values(BOOTSTRAP_SETTING_DEFS);

/** The scope's config, every level's file read and merged, farthest first, as the turn lane's own reader merges them. */
async function chatConfig(files: FilesPort, scope: Scope, log: Log): Promise<ConfigRead> {
  let config: Mapping = {};
  const paths: string[] = [];
  for (const layer of await files.layers(scope)) {
    if (layer.config === undefined) continue;
    const path = `${layer.mount}${layer.config}`;
    const read = await files.read(scope, path);
    if (read.status !== "read" || read.text.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(read.text);
    } catch (error) {
      log.warn("A config file does not parse; the bootstrap's settings in it are passed over.", { path, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!isMapping(parsed)) continue;
    config = mergedConfig(config, parsed);
    paths.push(path);
  }
  return { config, from: paths.join(", ") };
}

/** The bootstrap's settings for a chat, as its levels' config files set them over the defaults. */
export async function bootstrapSettings(files: FilesPort, scope: Scope, log: Log): Promise<BootstrapSettings> {
  return numbersOf(await chatConfig(files, scope, log), BOOTSTRAP_SETTING_DEFS, log);
}
