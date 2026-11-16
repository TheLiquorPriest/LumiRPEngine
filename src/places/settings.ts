// The places' settings (plan §8.2, Appendix D.1): each fixed value of a place's record is a setting with its default, as a config file
// writes it under `places:`. The host (the turn lane) reads the values for a chat and hands them to the readers and the routes.

import type { NumberSettings, Setting } from "../app/setting-list";

/** Every fixed value of the places' record, each a setting with this default. */
export const PLACES_DEFAULTS = Object.freeze({
  /** What the story changed at a place (its `since` part) one answer shows: the newest, oldest first among them, and a count of the earlier ones. */
  since: 20,
  /** The features a place's answer shows (its facts of part `feature`, and what its grid draws). */
  features: 20,
  /** The access entries a place's answer shows (its facts of part `access`). */
  access: 20,
  /** Places in one page of the list the Places page reads. */
  page: 100,
  /** Beats in one answer of a place's history. */
  history: 20,
});

export type PlacesSettings = { -readonly [K in keyof typeof PLACES_DEFAULTS]: number };

export const PLACES_SETTING_DEFS = {
  since: { key: "places.since", default: PLACES_DEFAULTS.since, takes: { type: "whole", least: 1 }, perConnection: false, name: "Places: what the story changed, shown", about: "The most entries of a place's `since` one answer shows (the newest, oldest first among them); the answer counts the earlier ones and says the query that reads them.", effect: "turn" },
  features: { key: "places.features", default: PLACES_DEFAULTS.features, takes: { type: "whole", least: 1 }, perConnection: false, name: "Places: features shown", about: "The most feature entries of a place one answer shows; the answer counts the rest and says the query that reads them.", effect: "turn" },
  access: { key: "places.access", default: PLACES_DEFAULTS.access, takes: { type: "whole", least: 1 }, perConnection: false, name: "Places: access entries shown", about: "The most access entries of a place one answer shows; the answer counts the rest and says the query that reads them.", effect: "turn" },
  page: { key: "places.page", default: PLACES_DEFAULTS.page, takes: { type: "whole", least: 1 }, perConnection: false, name: "Places in one page of the list", about: "The most places one page of the Places list holds.", effect: "turn" },
  history: { key: "places.history", default: PLACES_DEFAULTS.history, takes: { type: "whole", least: 1 }, perConnection: false, name: "Beats in a place's history", about: "The most beats one answer of a place's history gives, newest first; the answer counts the rest.", effect: "turn" },
} as const satisfies NumberSettings<keyof PlacesSettings>;

/** Every setting the places' record reads, as a config file writes it. */
export const PLACES_SETTINGS: readonly Setting[] = Object.values(PLACES_SETTING_DEFS);
