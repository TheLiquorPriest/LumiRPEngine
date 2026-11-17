// Finding a setting (plan §14): a search over keys and words, a value marked as changed from its default, and
// the group a setting belongs in; the page opens a group that holds what was searched for or what the address names.

import type { SettingView } from "../../../shared/api";

/** Whether a setting matches what he typed: every word of it is in its key, name, sentence or what it takes. */
export function settingMatches(s: SettingView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const hay = `${s.key} ${s.name} ${s.about} ${s.takesWords} ${s.setFor?.name ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Whether a file sets the setting to something other than its default. */
export function changedFromDefault(s: SettingView): boolean {
  return s.from !== null && JSON.stringify(s.value) !== JSON.stringify(s.default);
}

/** The group a setting is shown in: under its connection or agent for one set for one at a time, else its own. */
export function groupTitle(s: SettingView): string {
  if (s.setFor === undefined) return s.group;
  return s.setFor.known ? `${s.setFor.kind === "connection" ? "Connection" : "Agent"}: ${s.setFor.name}` : `Names no ${s.setFor.kind === "connection" ? "connection" : "agent"} there is now`;
}
