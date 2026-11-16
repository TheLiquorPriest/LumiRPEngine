// The taps' settings (plan §10.10, §16's bounds), each a setting with a default, declared once here and
// listed with the turn lane's (`TURN_SETTINGS`), so a chat's `RPE.yml` and the Settings page carry them,
// globally and for a chat: the longest name a refusal quotes, the most things one ✎ things fix changes,
// and the out-of-play settings: whether each group of taps is told to the next turn's Author when he
// made no choice of his own, and the amount from which a payment to someone else is.

import type { ConfigRead } from "../app/config-read";
import type { Setting } from "../app/setting-list";
import { OFFSTAGE_DEFAULTS, OFFSTAGE_GROUP_LABEL, OFFSTAGE_GROUPS, type OffstageGroup, type OffstageSettings } from "../shared/offstage";

export interface TapSettings {
  /** The most characters of a name a refusal quotes; a longer one reads as naming no one. */
  nameMost: number;
  /** The most things one ✎ things fix changes; past it the tap is answered in words and changes nothing. */
  thingsMost: number;
  /** Whether each group of taps is told to the next turn's Author when he made no choice, and the amount from which a payment to someone else is. */
  tell: OffstageSettings;
}

export const TAP_DEFAULTS: Readonly<TapSettings> = Object.freeze({
  // Today's values: the 80 characters `unfitReason` quoted, `FIX_THINGS_MAX`, and today's out-of-play defaults.
  nameMost: 80,
  thingsMost: 64,
  tell: OFFSTAGE_DEFAULTS,
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
} as const satisfies Record<Exclude<keyof TapSettings, "tell">, Setting>;

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

export const TAP_SETTINGS: readonly Setting[] = [...Object.values(TAP_SETTING_DEFS), ...Object.values(TELL_GROUP_DEFS), PAYMENTS_FROM];

/** The taps' settings as a chat's levels set them. */
export function tapSettingsRead(read: ConfigRead): TapSettings {
  const tell = Object.fromEntries(OFFSTAGE_GROUPS.map((group) => [group, read.value(TELL_GROUP_DEFS[group]) as boolean])) as Record<OffstageGroup, boolean>;
  return { ...read.numbers(TAP_SETTING_DEFS), tell: { tell, paymentsFrom: read.value(PAYMENTS_FROM) as number } };
}
