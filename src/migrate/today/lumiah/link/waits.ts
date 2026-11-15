// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/link/waits.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// A wait's words where it runs out, and a transport limit's where it is met: its setting's name, and
// where the user changes it (the Timeouts page for a wait, `shared/timeouts.ts`), so the words say
// what to change and where.

import { type SettingsOwner, settingPlace, timeoutPlace } from "../shared/timeouts";
import { isRecord } from "./json";
import { TRANSPORT_KEY, TRANSPORT_SCHEMA } from "./settings";

/** The titles of the transport's groups down to the setting at `path`, the section's own first, and the setting's last. */
function titlesOf(path: readonly string[]): string[] {
  const titles = [typeof TRANSPORT_SCHEMA.title === "string" ? TRANSPORT_SCHEMA.title : TRANSPORT_KEY];
  let at: unknown = TRANSPORT_SCHEMA;
  for (const key of path) {
    at = isRecord(at) && isRecord(at.properties) ? at.properties[key] : undefined;
    titles.push(isRecord(at) && typeof at.title === "string" ? at.title : key);
  }
  return titles;
}

/** Where one of the transport's waits is changed: `path` is its place within the transport's section (`["pages", "askMs"]`), `owner` whose Settings hold it (`timeoutPlace`). */
export function transportWait(path: readonly string[], owner: SettingsOwner): string {
  return timeoutPlace([TRANSPORT_KEY, ...path], titlesOf(path).at(-1) ?? path.join("."), owner);
}

/** Where any of the transport's settings is changed, as `settingPlace` says it: a limit that isn't a wait by its groups on the Settings page ("Largest frame the runtime joins (LumiAH's Settings → Transport → Runtime)"). */
export function transportPlace(path: readonly string[], owner: SettingsOwner): string {
  const titles = titlesOf(path);
  return settingPlace([TRANSPORT_KEY, ...path], titles.at(-1) ?? path.join("."), titles.slice(0, -1), owner);
}

/** A span of time as a timeout's words say it: "250 ms", "30 seconds", "2 minutes", "1.5 seconds". */
export function spanWords(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} minute${ms === 60_000 ? "" : "s"}`;
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
