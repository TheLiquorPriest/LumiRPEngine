// The bootstrap's settings (plan §12, Appendix D.1 "Bootstrap asks before: 200,000 tokens"): the token
// limit at which a bootstrap job is held and asks him whether to go on, and the caps of a bootstrap
// job's own run in place of the generic `jobs.run.*` (calls and seconds, as today's preparation ran a
// bootstrap). Each is read for its chat from the config files of the chat's levels (`RPE-global.yml`
// shipped and global, the chat's `RPE.yml`), the nearer level's value over the farther one's, through
// the one reader of the config levels, as the turn lane reads its own and RPH reads `jobs.run.*`.

import type { FilesPort, Log, Scope } from "rp-harness/contract";
import { portTexts, readConfig } from "../../app/config-read";
import type { NumberSettings, Setting } from "../../app/setting-list";

/** Every fixed value of the bootstrap, each a setting with this default. */
export const BOOTSTRAP_DEFAULTS = Object.freeze({
  /** Tokens sent and written together, by every agent of a bootstrap job, at which it is held and asks him whether to go on (Appendix D.1). */
  tokenLimit: 200_000,
  /** Model calls across every agent of a bootstrap job's run (today's `prepare.runRounds`). */
  runCalls: 200,
  /** Seconds of a bootstrap job's run (today's `prepare.runMinutes`, 60). */
  runTime: 3_600,
});

export type BootstrapSettings = { -readonly [K in keyof typeof BOOTSTRAP_DEFAULTS]: number };

/** Read at every level, since a job is started for one chat, and at the start of each job. */
export const BOOTSTRAP_SETTING_DEFS = {
  tokenLimit: {
    key: "bootstrap.tokenLimit",
    default: BOOTSTRAP_DEFAULTS.tokenLimit,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Bootstrap asks before",
    about: "Tokens sent and written together by a bootstrap job's agents (a token read again from a cache at the weight jobs.cachedWeight gives), at which the job is held and asks you whether to go on; a go-on gives it as many again unless you say otherwise.",
    effect: "use",
    row: "Bootstrap asks before",
  },
  runCalls: {
    key: "bootstrap.run.calls",
    default: BOOTSTRAP_DEFAULTS.runCalls,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Calls in a bootstrap job's run",
    about: "Model calls all the agents of one bootstrap job's run may make between them, in place of the cap other jobs have.",
    effect: "use",
  },
  runTime: {
    key: "bootstrap.run.time",
    default: BOOTSTRAP_DEFAULTS.runTime,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Time for a bootstrap job's run",
    about: "Seconds one bootstrap job's run may take, in place of the cap other jobs have; the clock waits while the job waits for your word.",
    effect: "use",
  },
} as const satisfies NumberSettings<keyof BootstrapSettings>;

/** Every setting the bootstrap reads, as a config file writes it, for the Settings page. */
export const BOOTSTRAP_SETTINGS: readonly Setting[] = Object.values(BOOTSTRAP_SETTING_DEFS);

/** The bootstrap's settings for a chat, as its levels' config files set them over the defaults. */
export async function bootstrapSettings(files: FilesPort, scope: Scope, log: Log): Promise<BootstrapSettings> {
  return readConfig(await portTexts(files, scope), log, BOOTSTRAP_SETTINGS).numbers(BOOTSTRAP_SETTING_DEFS);
}
