// Finding a setting (plan §14): a search over keys and words, a value marked as changed from its default, and
// the group a setting belongs in; the page opens a group that holds what was searched for or what the address names.

import type { SettingView } from "../../../shared/api";

/** Whether a setting matches what he typed: every word of it is in its key, name, sentence or what it takes. */
export function settingMatches(s: SettingView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const hay = `${s.key} ${s.name} ${s.about} ${s.takesWords} ${s.connection?.name ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Whether a file sets the setting to something other than its default. */
export function changedFromDefault(s: SettingView): boolean {
  return s.from !== null && JSON.stringify(s.value) !== JSON.stringify(s.default);
}

/** The group a setting is shown in: under its connection for one set per connection, else by the first part of its key. */
export function groupTitle(s: SettingView): string {
  if (s.connection === undefined) return s.key.split(".")[0] ?? s.key;
  return s.connection === null ? "Names no connection there is now" : `Connection: ${s.connection.name}`;
}
