// The lore's settings as a chat's levels set them (plan §5.4 "Config"): the lore and its index are made once
// for every chat, so what one chat's levels set is read for it at the moment it is needed, through the config
// reader the host gives (`ConfigRead` of the chat's levels as their files stand now). Kept apart from
// `settings.ts`, which the lore's own parts take their defaults from, so that no part takes a setting from
// the lore it is part of.

import type { ConfigRead } from "../app/config-read";
import { LORE_INDEX_ENTRY_DEF } from "./settings";

/** The levels of the chat a read is for. */
export interface LoreScope {
  user: string;
  chat: string;
}

/** What a chat's levels set of the lore's settings. */
export interface LoreChatSettings {
  /** His own lore index entry, by its id in Lumiverse; null for none (`lore.index.entry`). */
  indexEntry: string | null;
}

/** The lore's settings for one chat, read when asked. */
export type LoreSettingsFor = (at: LoreScope) => Promise<LoreChatSettings>;

/** `LoreSettingsFor` over the host's reader of a chat's config levels. */
export function loreSettingsFor(config: (at: LoreScope) => Promise<ConfigRead>): LoreSettingsFor {
  return async (at) => {
    const read = await config(at);
    const entry = read.value(LORE_INDEX_ENTRY_DEF);
    return { indexEntry: typeof entry === "string" && entry.trim() !== "" ? entry.trim() : null };
  };
}
