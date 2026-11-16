// The taps' settings (plan §10.10, §16's bounds), each a setting with a default, declared once here and
// listed with the turn lane's (`TURN_SETTINGS`), so a chat's `RPE.yml` and the Settings page carry them,
// globally and for a chat: the longest name a refusal quotes, and the most things one ✎ things fix
// changes.

import type { Setting } from "../app/setting-list";

export interface TapSettings {
  /** The most characters of a name a refusal quotes; a longer one reads as naming no one. */
  nameMost: number;
  /** The most things one ✎ things fix changes; past it the tap is answered in words and changes nothing. */
  thingsMost: number;
}

export const TAP_DEFAULTS: Readonly<TapSettings> = Object.freeze({
  // Today's values: the 80 characters `unfitReason` quoted, and `FIX_THINGS_MAX`.
  nameMost: 80,
  thingsMost: 64,
});

/** Each setting by the name `TapSettings` reads it under. */
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
} as const satisfies Record<keyof TapSettings, Setting>;

export const TAP_SETTINGS: readonly Setting[] = Object.values(TAP_SETTING_DEFS);
