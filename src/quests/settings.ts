// The quests' settings (plan §8.3, Appendix D.1): each fixed value of the quest record is a setting with its default, as a config file
// writes it under `quests:`. The host (the turn lane) reads the values for a chat.

import type { NumberSettings, Setting } from "../app/setting-list";

/** Every fixed value of the quest record, each a setting with this default. */
export const QUESTS_DEFAULTS = Object.freeze({
  /** Beats in one answer of a quest's history: the newest, with a count of the rest. */
  history: 20,
  /** Quests in one page of the records list. */
  page: 100,
});

export type QuestsSettings = { -readonly [K in keyof typeof QUESTS_DEFAULTS]: number };

export const QUESTS_SETTING_DEFS = {
  history: { key: "quests.history", default: QUESTS_DEFAULTS.history, takes: { type: "whole", least: 1 }, perConnection: false, name: "Beats in a quest's history", about: "The most beats one answer of a quest's history gives, newest first; the answer counts the rest.", effect: "turn" },
  page: { key: "quests.page", default: QUESTS_DEFAULTS.page, takes: { type: "whole", least: 1 }, perConnection: false, name: "Quests in one page of the records", about: "The most quests one page of the Quests page's records holds.", effect: "turn" },
} as const satisfies NumberSettings<keyof QuestsSettings>;

/** Every setting the quest record reads, as a config file writes it. */
export const QUESTS_SETTINGS: readonly Setting[] = Object.values(QUESTS_SETTING_DEFS);
