// The story lane's settings (plan Appendix D.1): each of its defaults as a config file writes it, under
// `story:`. The defaults stay where each part keeps them; the host (the turn lane) reads the values from
// the config files and hands them to each part, at the levels each part can take them from.

import type { NumberSettings, SettingDef } from "../app/setting-list";
import { STORY_FACT_DEFAULTS, type StoryFactSettings } from "./facts";
import { STORY_DEFAULTS, type StorySettings } from "./kit";
import { STORY_SO_FAR_DEFAULTS, type StorySoFarSettings } from "./sofar";

/** The story tools' (`storyTools`): read at every level, since the tools are made for the chat a call is in. */
export const STORY_SETTING_DEFS = {
  queryItems: { key: "story.queryItems", default: STORY_DEFAULTS.queryItems, takes: { type: "whole", least: 1 }, perConnection: false },
} as const satisfies NumberSettings<keyof StorySettings>;

/** The story's facts' (`storyFacts`): the host makes them once for every chat, so they are read from the global level alone. */
export const STORY_FACT_SETTING_DEFS = {
  ahead: { key: "story.ahead", default: STORY_FACT_DEFAULTS.ahead, takes: { type: "whole", least: 0 }, levels: ["shipped", "global"], perConnection: false },
} as const satisfies NumberSettings<keyof StoryFactSettings>;

/** The story so far's (`storySoFar`): read at every level, since it is worked out for each turn's briefing. */
export const STORY_SO_FAR_SETTING_DEFS = {
  share: { key: "story.soFar.share", default: STORY_SO_FAR_DEFAULTS.share, takes: { type: "number", least: 0, most: 1 }, perConnection: false },
  floor: { key: "story.soFar.floor", default: STORY_SO_FAR_DEFAULTS.floor, takes: { type: "whole", least: 0 }, perConnection: false },
} as const satisfies NumberSettings<keyof StorySoFarSettings>;

/** Every setting the story lane reads, as a config file writes it. */
export const STORY_SETTINGS: readonly SettingDef[] = [...Object.values(STORY_SETTING_DEFS), ...Object.values(STORY_FACT_SETTING_DEFS), ...Object.values(STORY_SO_FAR_SETTING_DEFS)];
