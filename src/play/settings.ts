// The panels' settings (plan §10.10, §16's bounds), each a setting with a default, declared once here and
// listed with the turn lane's (`TURN_SETTINGS`), so a chat's `RPE.yml` and the Settings page carry them,
// globally and for a chat: the longest name a refusal quotes, the most things one ✎ things fix changes,
// the turns the Journal reads at a time, the turns the HUD's meter averages over, the newest replies
// whose clocks the panels carry, how many findings one Tidy up run shows, the out-of-play settings
// (whether each group of taps is told to the next turn's Author when he made no choice of his own, and
// the amount from which a payment to someone else is), and the tidy-up's switch and the findings he left
// as they are (R-173). The chat's own knowledge choices (the secrets' settings, the lore's) are read here
// beside his own, as the controls show them.

import type { ConfigRead } from "../app/config-read";
import type { Setting } from "../app/setting-list";
import { SECRETS_NARRATOR_KNOWLEDGE_DEF, SECRETS_NARRATOR_SECRETS_DEF, SECRETS_TRACKED_DEF } from "../lore/settings";
import type { JsonValue } from "../shared/json";
import { KNOWLEDGE_DEFAULTS } from "../shared/minds";
import { OFFSTAGE_DEFAULTS, OFFSTAGE_GROUP_LABEL, OFFSTAGE_GROUPS, type OffstageGroup, type OffstageSettings } from "../shared/offstage";
import { NARRATOR_DEFAULTS, NARRATOR_KNOWLEDGE, NARRATOR_SECRETS, type NarratorView } from "../shared/settings";
import type { ControlsKnowledge } from "./state/controls";

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
  /** The chat's last turns the HUD's meter averages over. */
  meterTurns: number;
  /** The newest replies on the chat's path whose world clock the panels carry. */
  clocksMost: number;
  /** The most findings one Tidy up run shows. */
  tidyRunMost: number;
  /** Whether each group of taps is told to the next turn's Author when he made no choice, and the amount from which a payment to someone else is. */
  tell: OffstageSettings;
  tidy: TidySettings;
  /** The chat's own knowledge tracking and narrator's view (none where it sets none), beside his own; the tidy switch is `tidy.on`. */
  choices: Omit<ControlsKnowledge, "chat"> & { chat: Omit<ControlsKnowledge["chat"], "tidy"> };
}

export const TAP_DEFAULTS: Readonly<TapSettings> = Object.freeze({
  // Today's values: the 80 characters `unfitReason` quoted, `FIX_THINGS_MAX`, and today's out-of-play defaults.
  nameMost: 80,
  thingsMost: 64,
  journalMost: 100,
  // Today's: the meter's 200 turns (`backend/steps.ts`), and `UserSettings.tidy.findings`, 50.
  meterTurns: 200,
  clocksMost: 100,
  tidyRunMost: 50,
  tell: OFFSTAGE_DEFAULTS,
  // Today's: the world's tidy.auto, nothing left, and the 1000 keys today's chat prefs kept.
  tidy: { on: null, left: [], leftMost: 1000 },
  choices: { chat: {}, tracking: KNOWLEDGE_DEFAULTS.enabled, narrator: NARRATOR_DEFAULTS },
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
  meterTurns: {
    key: "taps.meterTurns",
    default: TAP_DEFAULTS.meterTurns,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Turns the HUD's meter averages over",
    about: "The chat's last turns whose calls, tokens, time and lore lookups the HUD's meter gives the average and 95th percentile of.",
    effect: "use",
  },
  clocksMost: {
    key: "taps.clocksMost",
    default: TAP_DEFAULTS.clocksMost,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Replies whose world clock the panels carry",
    about: "The newest replies on the chat's path that show the world's date and time at their turn's end with each read of the panels.",
    effect: "use",
  },
  tidyRunMost: {
    key: "things.tidyRunMost",
    default: TAP_DEFAULTS.tidyRunMost,
    takes: { type: "whole", least: 1, most: 500 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Findings one Tidy up shows",
    about: "The most findings one Tidy up run lists, of the things that do not add up in a chat.",
    effect: "use",
  },
} as const satisfies Record<Exclude<keyof TapSettings, "tell" | "tidy" | "choices">, Setting>;

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

/** A narrator's view as a level set it, part by part; undefined for a part it set to nothing it takes. */
function narratorPart<T extends string>(value: JsonValue | undefined, takes: readonly T[]): T | undefined {
  return takes.find((t) => t === value);
}

/**
 * The chat's own knowledge tracking and narrator's view, where its own level sets them, beside his own (the nearest other level's,
 * else the default), as GM → This chat shows them. A chat that sets one part of the narrator's view follows the rest in force.
 */
function choicesRead(read: ConfigRead): TapSettings["choices"] {
  const chatSet = (def: Setting): JsonValue | undefined => read.setAt(def).find((l) => l.level === "chat")?.value;
  const hisSet = (def: Setting): JsonValue | undefined => read.setAt(def).filter((l) => l.level !== "chat").at(-1)?.value;
  const tracked = chatSet(SECRETS_TRACKED_DEF);
  const knows = narratorPart(chatSet(SECRETS_NARRATOR_KNOWLEDGE_DEF), NARRATOR_KNOWLEDGE);
  const secrets = narratorPart(chatSet(SECRETS_NARRATOR_SECRETS_DEF), NARRATOR_SECRETS);
  const his: NarratorView = {
    knowledge: narratorPart(hisSet(SECRETS_NARRATOR_KNOWLEDGE_DEF), NARRATOR_KNOWLEDGE) ?? NARRATOR_DEFAULTS.knowledge,
    secrets: narratorPart(hisSet(SECRETS_NARRATOR_SECRETS_DEF), NARRATOR_SECRETS) ?? NARRATOR_DEFAULTS.secrets,
  };
  const hisTracked = hisSet(SECRETS_TRACKED_DEF);
  return {
    chat: {
      ...(typeof tracked === "boolean" ? { knowledge: tracked } : {}),
      ...(knows !== undefined || secrets !== undefined ? { narrator: { knowledge: knows ?? his.knowledge, secrets: secrets ?? his.secrets } } : {}),
    },
    tracking: typeof hisTracked === "boolean" ? hisTracked : KNOWLEDGE_DEFAULTS.enabled,
    narrator: his,
  };
}

/** The panels' settings as a chat's levels set them; the list of findings left alone cut to its newest `things.tidyLeftMost`. */
export function tapSettingsRead(read: ConfigRead): TapSettings {
  const tell = Object.fromEntries(OFFSTAGE_GROUPS.map((group) => [group, read.value(TELL_GROUP_DEFS[group]) as boolean])) as Record<OffstageGroup, boolean>;
  const leftMost = read.value(TIDY_DEFS.leftMost) as number;
  const tidy = { on: read.value(TIDY_DEFS.on) as boolean | null, left: (read.value(TIDY_DEFS.left) as string[]).slice(-leftMost), leftMost };
  return { ...read.numbers(TAP_SETTING_DEFS), tell: { tell, paymentsFrom: read.value(PAYMENTS_FROM) as number }, tidy, choices: choicesRead(read) };
}
