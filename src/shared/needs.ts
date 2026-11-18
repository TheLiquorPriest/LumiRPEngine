// Needs settings (DESIGN §8, §24.8): per world, each need on or off, how fast it grows, and the two
// points it is told at: the narrator's line ("you: hungry") with Play's mark, and the alert a
// timelapse may stop on. Absent, every need is on with the rates and points earlier builds had, so a
// world without them plays as it did. Needs themselves run from Cast life 4.

import { hasOwn, isRecord } from "./json";
import type { ParamDef } from "./world";
import { say, type Voice, wordedParam } from "../engine/lines";

export type NeedId = "hunger" | "fatigue" | "social" | "fun";
export const NEED_IDS: readonly NeedId[] = ["hunger", "fatigue", "social", "fun"];

/**
 * Each need in words, the one set every surface uses (Build, Play, Check world, the narrator): its
 * name; the word the narrator is told it in once it's pressing ("you: hungry"); and what meets it,
 * to finish "met by …".
 */
export const NEED_WORDS: Readonly<Record<NeedId, { name: string; word: string; metBy: string }>> = {
  hunger: { name: "Hunger", word: "hungry", metBy: "eating" },
  fatigue: { name: "Fatigue", word: "tired", metBy: "sleep, a night's or a nap" },
  social: { name: "Social", word: "lonely", metBy: "a chat, or time with someone you know" },
  fun: { name: "Fun", word: "bored", metBy: "rest, leisure, exercise or a night out" },
};

/** One need as a world tunes it (`world.needs`); a part left out keeps its default. */
export interface NeedSetting {
  /** Off: the need never grows, never shows, is never told and never alerts. On by default. */
  on?: boolean;
  /** How much it grows per hour, on its scale of 0 (met) to 100 (urgent). */
  rate?: number;
  /** At or above this the narrator is told of it, and Play's Needs marks it. */
  tell?: number;
  /** At or above this it raises the `needs` alert in a timelapse (the interrupt policy says what that does). */
  alert?: number;
}

export type NeedsSettings = Partial<Record<NeedId, NeedSetting>>;

/** A need as the engine reads it, every part filled. */
export interface NeedTuning {
  on: boolean;
  rate: number;
  tell: number;
  alert: number;
}

/** What earlier builds fixed in code: hunger 4, fatigue 3, social 1.5 and fun 1 an hour, told from 60, alerting from 80. */
export const NEED_DEFAULTS: Readonly<Record<NeedId, NeedTuning>> = {
  hunger: { on: true, rate: 4, tell: 60, alert: 80 },
  fatigue: { on: true, rate: 3, tell: 60, alert: 80 },
  social: { on: true, rate: 1.5, tell: 60, alert: 80 },
  fun: { on: true, rate: 1, tell: 60, alert: 80 },
};

/** The parts of a need's setting, each with what it takes: every part of `NeedSetting`, looked up by the name a write gives. */
const NEED_SETTING_PARTS: Readonly<Record<string, "switch" | "points" | "rate">> = { on: "switch", rate: "rate", tell: "points", alert: "points" } satisfies Record<keyof NeedSetting, "switch" | "points" | "rate">;

/** A rate an hour: from nothing to the whole scale in an hour. */
const RATE_MAX = 100;

const inScale = (v: unknown, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

/**
 * The length an everyday action takes when the player states one ("rest for an hour", "talk for two
 * hours"): eat, rest, sleep and chat take it as `minutes`, which interpret fills, and their own time without it.
 */
export const STATED_MINUTES: ParamDef = wordedParam({ type: "duration", optional: true }, "param_stated_minutes");
/**
 * The appraisal a chat makes (relationships' `chat_with`), and so the `why` of the regard it records:
 * what Cast life reads a conversation by to meet the social need, so neither pack imports the other.
 */
export const CONVERSATION = "conversation";

/**
 * Every need as a world tunes it: a part a world doesn't give, or gives a value the engine doesn't
 * take, reads as its default, so a malformed setting changes nothing unseen (the write and lint say so).
 */
export function needsSettingsOf(world: { readonly needs?: unknown }): Record<NeedId, NeedTuning> {
  const raw = isRecord(world.needs) ? world.needs : {};
  const one = (need: NeedId): NeedTuning => {
    const set = isRecord(raw[need]) ? raw[need] : {};
    const base = NEED_DEFAULTS[need];
    return {
      on: typeof set.on === "boolean" ? set.on : base.on,
      rate: inScale(set.rate, RATE_MAX) ? set.rate : base.rate,
      tell: inScale(set.tell, 100) ? set.tell : base.tell,
      alert: inScale(set.alert, 100) ? set.alert : base.alert,
    };
  };
  return { hunger: one("hunger"), fatigue: one("fatigue"), social: one("social"), fun: one("fun") };
}

/** The needs a world has on, in order. */
export function needsOn(world: { readonly needs?: unknown }): NeedId[] {
  const tuned = needsSettingsOf(world);
  return NEED_IDS.filter((n) => tuned[n].on);
}

/** Whether a name is one of the needs. */
export function isNeedId(v: unknown): v is NeedId {
  return typeof v === "string" && (NEED_IDS as readonly string[]).includes(v);
}

/** What is wrong with needs settings as written, each naming its field, said by `voice` (the lines in force unless a page gives its own); none when the engine reads them as given. */
export function needsSettingsProblems(v: unknown, voice: Voice = say): string[] {
  if (!isRecord(v)) return [voice("fault_needs_settings_are_an_object_one")];
  return Object.entries(v).flatMap(([need, set]) => {
    if (!isNeedId(need)) return [voice("fault_there_s_no_need_need_needids", { need, needIds: NEED_IDS.join(", ") })];
    if (!isRecord(set)) return [voice("fault_need_is_an_object_on_rate", { need })];
    return Object.entries(set).flatMap(([part, value]) => {
      const takes = hasOwn(NEED_SETTING_PARTS, part) ? NEED_SETTING_PARTS[part] : undefined;
      if (takes === undefined) return [voice("fault_need_has_no_setting_part", { need, part, parts: Object.keys(NEED_SETTING_PARTS).join(", ") })];
      if (takes === "switch") return typeof value === "boolean" ? [] : [voice("fault_need_part_is_true_or_false", { need, part })];
      if (takes === "rate") return inScale(value, RATE_MAX) ? [] : [voice("fault_need_part_is_a_number_from", { need, part, rateMax: RATE_MAX })];
      return inScale(value, 100) ? [] : [voice("fault_need_part_is_a_number_from_2", { need, part })];
    });
  });
}

/** The settings as a world stores them: only what differs from the defaults, so the defaults store nothing. */
export function storedNeedsSettings(settings: Record<NeedId, NeedTuning>): NeedsSettings {
  const out: NeedsSettings = {};
  for (const need of NEED_IDS) {
    const base = NEED_DEFAULTS[need];
    const set = settings[need];
    const diff: NeedSetting = {
      ...(set.on !== base.on ? { on: set.on } : {}),
      ...(set.rate !== base.rate ? { rate: set.rate } : {}),
      ...(set.tell !== base.tell ? { tell: set.tell } : {}),
      ...(set.alert !== base.alert ? { alert: set.alert } : {}),
    };
    if (Object.keys(diff).length > 0) out[need] = diff;
  }
  return out;
}
