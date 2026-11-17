// The bootstrap's settings (plan §12, Appendix D.1 "Bootstrap asks before: 200,000 tokens"): the token
// point at which a bootstrap job is held and asks him whether to go on, and the limits of a bootstrap
// job's own run in place of the generic `jobs.run.*` (calls and seconds). Neither limit is set by
// default (§2.1 point 4: no default cuts a job's work short): unset, a bootstrap job's run is held to
// `jobs.run.*` as every job is. Each is read for its chat from the config files of the chat's levels
// (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, through the one reader of the config levels, as the turn lane reads its own and RPH
// reads `jobs.run.*`.

import type { FilesPort, Log, Scope } from "rp-harness/contract";
import { portTexts, readConfig } from "../../app/config-read";
import type { Setting } from "../../app/setting-list";

/** The bootstrap's ask point, a setting with this default: tokens sent and written together, by every agent of a bootstrap job, at which it is held and asks him whether to go on (Appendix D.1). An ask, not a limit: his go-on lets the job work on. */
export const BOOTSTRAP_DEFAULTS = Object.freeze({ tokenLimit: 200_000 });

/** The bootstrap's settings for a chat: its ask point, and its run's own limits on calls and seconds (null: none of its own). */
export interface BootstrapSettings {
  tokenLimit: number;
  runCalls: number | null;
  runTime: number | null;
}

/** The run's own limits: none by default (§2.1 point 4, 17 Nov). */
const OWN = { default: null, orNone: true, none: "none of its own: every job's limit holds" } as const;

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
    ...OWN,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Calls in a bootstrap job's run",
    about: "Model calls all the agents of one bootstrap job's run may make between them, in place of every job's jobs.run.calls; none set, that one holds.",
    effect: "use",
  },
  runTime: {
    key: "bootstrap.run.time",
    ...OWN,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Time for a bootstrap job's run",
    about: "Seconds one bootstrap job's run may take, in place of every job's jobs.run.time; none set, that one holds. The clock waits while the job waits for your word.",
    effect: "use",
  },
} as const satisfies Record<keyof BootstrapSettings, Setting>;

/** Every setting the bootstrap reads, as a config file writes it, for the Settings page. */
export const BOOTSTRAP_SETTINGS: readonly Setting[] = Object.values(BOOTSTRAP_SETTING_DEFS);

/** The bootstrap's settings for a chat, as its levels' config files set them over the defaults. */
export async function bootstrapSettings(files: FilesPort, scope: Scope, log: Log): Promise<BootstrapSettings> {
  const read = readConfig(await portTexts(files, scope), log, BOOTSTRAP_SETTINGS);
  // Each value is one its setting takes, so it is of the type the setting's `takes` says.
  return { tokenLimit: read.value(BOOTSTRAP_SETTING_DEFS.tokenLimit) as number, runCalls: read.value(BOOTSTRAP_SETTING_DEFS.runCalls) as number | null, runTime: read.value(BOOTSTRAP_SETTING_DEFS.runTime) as number | null };
}
