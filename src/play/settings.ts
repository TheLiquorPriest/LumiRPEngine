// The panels' settings (plan §10.10, §16's bounds), each a setting with a default, declared once here and
// listed with the turn lane's (`TURN_SETTINGS`), so a chat's `RPE.yml` and the Settings page carry them,
// globally and for a chat: the longest name a refusal quotes, the most things one ✎ things fix changes,
// the turns the Journal reads at a time, the out-of-play settings (whether each group of taps is told to
// the next turn's Author when he made no choice of his own, and the amount from which a payment to
// someone else is), and the tidy-up's switch and the findings he left as they are (R-173).

import type { ConfigRead } from "../app/config-read";
import type { Setting } from "../app/setting-list";
import { OFFSTAGE_DEFAULTS, OFFSTAGE_GROUP_LABEL, OFFSTAGE_GROUPS, type OffstageGroup, type OffstageSettings } from "../shared/offstage";

/**
 * The chat's tidy-up (R-173, §6.1): whether the holds that cannot be are listed in each turn's world state (`on`: true or false his
 * chat's own switch; null, the world's `tidy.auto`), the keys of the findings he left as they are, and how many of those are kept.
 */
export interface TidySettings {
  on: boolean | null;
  left: readonly string[];
  leftMost: number;
}

export interface TapSettings {
  /** The most characters of a name a refusal quotes; a longer one reads as naming no one. */
  nameMost: number;
  /** The most things one ✎ things fix changes; past it the tap is answered in words and changes nothing. */
  thingsMost: number;
  /** The most turns, newest first, whose notes the Journal shows. */
  journalMost: number;
  /** Whether each group of taps is told to the next turn's Author when he made no choice, and the amount from which a payment to someone else is. */
  tell: OffstageSettings;
  tidy: TidySettings;
}

export const TAP_DEFAULTS: Readonly<TapSettings> = Object.freeze({
  // Today's values: the 80 characters `unfitReason` quoted, `FIX_THINGS_MAX`, and today's out-of-play defaults.
  nameMost: 80,
  thingsMost: 64,
  journalMost: 100,
  tell: OFFSTAGE_DEFAULTS,
  // Today's: the world's tidy.auto, nothing left, and the 1000 keys today's chat prefs kept.
  tidy: { on: null, left: [], leftMost: 1000 },
});

/** The numbers among them, by the name `TapSettings` reads each under. */
export const TAP_SETTING_DEFS = {
  nameMost: {
    key: "taps.nameMost",
    default: TAP_DEFAULTS.nameMost,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Longest name a refusal quotes",
    about: "The most characters of a name a tap's refusal quotes back; a longer one reads as naming no one.",
    effect: "use",
  },
  thingsMost: {
    key: "taps.thingsMost",
    default: TAP_DEFAULTS.thingsMost,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Things one fix changes",
    about: "The most things one ✎ things fix changes; past it the tap is answered in words and changes nothing.",
    effect: "use",
  },
  journalMost: {
    key: "taps.journalMost",
    default: TAP_DEFAULTS.journalMost,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Turns the Journal reads at a time",
    about: "The most turns, newest first, whose notes the Journal shows; a longer chat reads the rest a page at a time.",
    effect: "use",
  },
} as const satisfies Record<Exclude<keyof TapSettings, "tell" | "tidy">, Setting>;

/** The out-of-play settings: one switch for each group of taps, and the amount a payment to someone else is told from. */
const TELL_GROUP_DEFS: Readonly<Record<OffstageGroup, Setting>> = Object.fromEntries(
  OFFSTAGE_GROUPS.map((group): [OffstageGroup, Setting] => [
    group,
    {
      key: `taps.tell.${group}`,
      default: OFFSTAGE_DEFAULTS.tell[group],
      takes: { type: "yesNo" },
      perConnection: false,
      name: `Tell the Author: ${OFFSTAGE_GROUP_LABEL[group]}`,
      about: "Whether a tap of this group is told to the next turn's Author when he made no choice of his own on it.",
      effect: "use",
    },
  ]),
) as Record<OffstageGroup, Setting>;

const PAYMENTS_FROM: Setting = {
  key: "taps.tell.paymentsFrom",
  default: OFFSTAGE_DEFAULTS.paymentsFrom,
  takes: { type: "whole", least: 0 },
  perConnection: false,
  name: "Payments told from",
  about: "A payment to someone else is told to the next turn's Author from this amount, in whole units of the world's money (0: every one).",
  effect: "use",
};

/** The tidy-up's switch, as the old route's chat choice writes it. */
export const TIDY_SWITCH = "things.tidy";

const TIDY_DEFS = {
  on: {
    key: TIDY_SWITCH,
    default: TAP_DEFAULTS.tidy.on,
    takes: { type: "yesNo" },
    orNone: true,
    none: "as the world's tidy.auto says",
    perConnection: false,
    name: "Tidy-up findings in the world state",
    about: "Whether each turn's world state lists the holds that cannot be (a thing too big to carry on a person, a thing worn but lying elsewhere) with the fix the tidy-up would make; unset, the world's own tidy.auto decides. Nothing is ever fixed by itself.",
    effect: "turn",
  },
  left: {
    key: "things.tidyLeft",
    default: [],
    takes: { type: "texts" },
    perConnection: false,
    name: "Tidy-up findings left as they are",
    about: "The keys of the tidy-up's findings he told it to leave alone (Leave it): they are not listed again.",
    effect: "turn",
  },
  leftMost: {
    key: "things.tidyLeftMost",
    default: TAP_DEFAULTS.tidy.leftMost,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Findings left alone, kept",
    about: "The most keys the list of findings left alone keeps; past it the oldest go.",
    effect: "use",
  },
} as const satisfies Record<keyof TidySettings, Setting>;

export const TAP_SETTINGS: readonly Setting[] = [...Object.values(TAP_SETTING_DEFS), ...Object.values(TELL_GROUP_DEFS), PAYMENTS_FROM, ...Object.values(TIDY_DEFS)];

/** The panels' settings as a chat's levels set them; the list of findings left alone cut to its newest `things.tidyLeftMost`. */
export function tapSettingsRead(read: ConfigRead): TapSettings {
  const tell = Object.fromEntries(OFFSTAGE_GROUPS.map((group) => [group, read.value(TELL_GROUP_DEFS[group]) as boolean])) as Record<OffstageGroup, boolean>;
  const leftMost = read.value(TIDY_DEFS.leftMost) as number;
  const tidy = { on: read.value(TIDY_DEFS.on) as boolean | null, left: (read.value(TIDY_DEFS.left) as string[]).slice(-leftMost), leftMost };
  return { ...read.numbers(TAP_SETTING_DEFS), tell: { tell, paymentsFrom: read.value(PAYMENTS_FROM) as number }, tidy };
}
