// The page's own settings in the registry (plan §14 "every limit can be edited here"): each wait the
// pages keep, at the global level of `RPE-global.yml`, shown and written on the Settings page under
// "Pages". The page reads the group from RPE (`src/ui/ui-settings.ts`): with the extension's start-up
// facts, and from the settings route; a change is in force at the page's next read of them.

import { PAGE_SETTING_DEFS } from "../shared/page-settings";
import type { Setting } from "./setting-list";

/** Every setting of the pages, in the order the page declares them. */
export const PAGE_SETTINGS: readonly Setting[] = Object.values(PAGE_SETTING_DEFS).map((def) => ({
  key: def.key,
  default: def.default,
  takes: { type: "whole", least: def.least },
  advice: def.advice,
  levels: ["shipped", "global"],
  perConnection: false,
  name: def.name,
  about: def.about,
  effect: "use",
}));
