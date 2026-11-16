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
}

export const JOB_LIMIT_DEFAULTS: Readonly<JobLimits> = Object.freeze({ running: 2, kept: 8, idChars: 200, turns: 50, turnChars: 2000, days: 3, daysMost: 14 });

const GLOBAL = ["shipped", "global"] as const;

export const JOB_SETTING_DEFS = {
  running: { key: "build.jobs.running", default: JOB_LIMIT_DEFAULTS.running, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Jobs running at once", about: "The most jobs one user may have running in Build at once; another is refused until one ends or is cancelled.", effect: "use" },
  kept: { key: "build.jobs.kept", default: JOB_LIMIT_DEFAULTS.kept, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Ended jobs kept", about: "How many ended jobs Build keeps per user, the newest, each with its result; running ones are always kept.", effect: "use" },
  idChars: { key: "build.jobs.idChars", default: JOB_LIMIT_DEFAULTS.idChars, takes: { type: "whole", least: 8 }, levels: GLOBAL, perConnection: false, name: "Longest id a job's input names", about: "The longest id (a world, a book, a map, a person) a job's input may name; a longer one is refused.", effect: "use" },
  turns: { key: "build.playtest.turns", default: JOB_LIMIT_DEFAULTS.turns, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Turns in a Playtest", about: "The most typed turns one Playtest takes; the rest are cut.", effect: "use" },
  turnChars: { key: "build.playtest.turnChars", default: JOB_LIMIT_DEFAULTS.turnChars, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Characters in a Playtest turn", about: "The longest a typed turn of a Playtest may be, in characters; a longer one is cut.", effect: "use" },
  days: { key: "build.check.days", default: JOB_LIMIT_DEFAULTS.days, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Days a Check world runs", about: "The days Check world simulates when its request names none.", effect: "use" },
  daysMost: { key: "build.check.daysMost", default: JOB_LIMIT_DEFAULTS.daysMost, takes: { type: "whole", least: 1 }, levels: GLOBAL, perConnection: false, name: "Most days a Check world runs", about: "The most days one Check world may simulate; a request for more runs this many.", effect: "use" },
} as const satisfies NumberSettings<keyof JobLimits>;

/** Every setting Build's jobs read, as a config file writes it. */
export const JOB_SETTINGS: readonly Setting[] = Object.values(JOB_SETTING_DEFS);
