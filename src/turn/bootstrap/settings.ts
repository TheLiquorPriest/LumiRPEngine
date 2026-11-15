// The bootstrap's one setting (plan §12, Appendix D.1 "Bootstrap asks before: 200,000 tokens"): the
// token limit a bootstrap job is given, read for its chat from the config files of the chat's levels
// (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, through the one reader of the config levels, as the turn lane reads its own and as
// RPH reads the limits it holds a job's run to (`jobs.run.*`). RPH holds the job to it: the job ends at
// it with what it has.

import type { FilesPort, Log, Scope } from "rp-harness/contract";
import { portTexts, readConfig } from "../../app/config-read";
import type { NumberSettings, Setting } from "../../app/setting-list";

/** Every fixed value of the bootstrap, each a setting with this default. */
export const BOOTSTRAP_DEFAULTS = Object.freeze({
  /** Tokens sent and written together, by every agent of a bootstrap job, at which RPH ends the job (Appendix D.1). */
  tokenLimit: 200_000,
});

export type BootstrapSettings = { -readonly [K in keyof typeof BOOTSTRAP_DEFAULTS]: number };

/** Read at every level, since a job is started for one chat, and at the start of each job. */
export const BOOTSTRAP_SETTING_DEFS = {
  tokenLimit: {
    key: "bootstrap.tokenLimit",
    default: BOOTSTRAP_DEFAULTS.tokenLimit,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Bootstrap token limit",
    about: "Tokens sent and written together by a bootstrap job's agents, at which the job ends with what it has.",
    effect: "use",
    row: "Bootstrap asks before",
  },
} as const satisfies NumberSettings<keyof BootstrapSettings>;

/** Every setting the bootstrap reads, as a config file writes it, for the Settings page. */
export const BOOTSTRAP_SETTINGS: readonly Setting[] = Object.values(BOOTSTRAP_SETTING_DEFS);

/** The bootstrap's settings for a chat, as its levels' config files set them over the defaults. */
export async function bootstrapSettings(files: FilesPort, scope: Scope, log: Log): Promise<BootstrapSettings> {
  return readConfig(await portTexts(files, scope), log, BOOTSTRAP_SETTINGS).numbers(BOOTSTRAP_SETTING_DEFS);
}
