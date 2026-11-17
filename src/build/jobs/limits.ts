// What bounds a job of Build's (plan §14, PlanChatUI-B2): each was a constant of today's job runner, and each is a setting now with today's value as
// its default, read from the global level (`RPE-global.yml`) at each use.

import type { NumberSettings, Setting } from "../../app/setting-list";

export interface JobLimits {
  /** The most jobs a user may have running at once. */
  running: number;
  /** Jobs that have ended kept per user (the newest), with their results. */
  kept: number;
  /** The longest id a job's input may name. */
  idChars: number;
  /** The most turns a Playtest takes. */
  turns: number;
  /** The longest typed turn of a Playtest, in characters. */
  turnChars: number;
  /** The days a Check world runs when its request names none. */
  days: number;
  /** The most days a Check world runs. */
  daysMost: number;
  /** The most lore books an Import from lore reads. */
  books: number;
  /** The longest request a Refine takes, in characters. */
  refineChars: number;
  /** The most pasted text an Index this text keeps, in characters. */
  indexChars: number;
  /** The longest prose a Describe a map takes, in characters. */
  proseChars: number;
  /** The most people and groups a Propose routines may be asked for by name. */
  owners: number;
  /** People and groups one pass of Propose routines reads; Continue reads the next. */
  perPass: number;
  /** The lore one person or group brings to Propose routines, in tokens. */
  loreTokens: number;
  /** The most proposals one model job keeps. */
  proposals: number;
}

export const JOB_LIMIT_DEFAULTS: Readonly<JobLimits> = Object.freeze({
  running: 2,
  kept: 8,
  idChars: 200,
  turns: 50,
  turnChars: 2000,
  days: 3,
  daysMost: 14,
  books: 64,
  refineChars: 4000,
  indexChars: 78_000,
  proseChars: 4000,
  owners: 500,
  perPass: 36,
  loreTokens: 8000,
  proposals: 120,
});

const GLOBAL = ["shipped", "global"] as const;

export const JOB_SETTING_DEFS = {
  running: { key: "build.jobs.running", default: JOB_LIMIT_DEFAULTS.running, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Jobs running at once", about: "The most jobs one user may have running in Build at once; another is refused until one ends or is cancelled.", effect: "use" },
  kept: { key: "build.jobs.kept", default: JOB_LIMIT_DEFAULTS.kept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Ended jobs kept", about: "How many ended jobs Build keeps per user, the newest, each with its result; running ones are always kept.", effect: "use" },
  idChars: { key: "build.jobs.idChars", default: JOB_LIMIT_DEFAULTS.idChars, takes: { type: "whole", least: 1 }, advice: [{ below: 8, says: "Ids of fewer than 8 characters are refused, and most of the ids Build's jobs name are longer." }], levels: GLOBAL, perConnection: false, name: "Longest id a job's input names", about: "The longest id (a world, a book, a map, a person) a job's input may name; a longer one is refused.", effect: "use" },
  turns: { key: "build.playtest.turns", default: JOB_LIMIT_DEFAULTS.turns, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Turns in a Playtest", about: "The most typed turns one Playtest takes; the rest are cut.", effect: "use" },
  turnChars: { key: "build.playtest.turnChars", default: JOB_LIMIT_DEFAULTS.turnChars, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Characters in a Playtest turn", about: "The longest a typed turn of a Playtest may be, in characters; a longer one is cut.", effect: "use" },
  days: { key: "build.check.days", default: JOB_LIMIT_DEFAULTS.days, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Days a Check world runs", about: "The days Check world simulates when its request names none.", effect: "use" },
  daysMost: { key: "build.check.daysMost", default: JOB_LIMIT_DEFAULTS.daysMost, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Most days a Check world runs", about: "The most days one Check world may simulate; a request for more runs this many.", effect: "use" },
  books: { key: "build.import.books", default: JOB_LIMIT_DEFAULTS.books, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Books an import reads", about: "The most lore books one Import from lore may read; a request naming more is refused.", effect: "use" },
  refineChars: { key: "build.refine.chars", default: JOB_LIMIT_DEFAULTS.refineChars, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Characters in a Refine request", about: "The longest request Refine with AI takes; a longer one is cut.", effect: "use" },
  indexChars: { key: "build.index.chars", default: JOB_LIMIT_DEFAULTS.indexChars, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Text an index job keeps", about: "The most pasted text one Index this text keeps, in characters; a longer text is read to its last paragraph that fits, and the job says how much was not read.", effect: "use" },
  proseChars: { key: "build.map.proseChars", default: JOB_LIMIT_DEFAULTS.proseChars, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Characters in a map's prose", about: "The longest description Describe a map takes; a longer one is cut.", effect: "use" },
  owners: { key: "build.routines.owners", default: JOB_LIMIT_DEFAULTS.owners, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "People a routines job may name", about: "The most people and groups one Propose routines may be asked for by name; a request naming more is refused.", effect: "use" },
  perPass: { key: "build.routines.perPass", default: JOB_LIMIT_DEFAULTS.perPass, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "People one routines pass reads", about: "The people and groups one pass of Propose routines gives its agent, in id order; Continue starts the next pass after the last.", effect: "use" },
  loreTokens: { key: "build.routines.loreTokens", default: JOB_LIMIT_DEFAULTS.loreTokens, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Lore each person brings to routines", about: "The lore one person or group brings to Propose routines, in tokens: their entries best first, whole, until the next would pass this.", effect: "use" },
  proposals: { key: "build.jobs.proposals", default: JOB_LIMIT_DEFAULTS.proposals, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Proposals a model job keeps", about: "The most proposals one of Build's model jobs keeps for review; the rest are dropped and the job says so.", effect: "use" },
} as const satisfies NumberSettings<keyof JobLimits>;

/** Every setting Build's jobs read, as a config file writes it. */
export const JOB_SETTINGS: readonly Setting[] = Object.values(JOB_SETTING_DEFS);
