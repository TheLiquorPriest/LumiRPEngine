// The drawer's Harness tab as the drawer and Settings name it, and when the drawer offers it. A world
// chat is played by one of three engines (GM → This chat → Engine); the tab holds the harness's own
// pages, so it is there only while the open chat plays on the harness. It bears the engine's name as
// the Engine switch shows it: what makes the tab appear and the tab read the same, and neither is
// taken for the agents engine or for Settings → Agents, which set up another engine. Pure, so the
// rules are tested without a browser; nothing here imports LumiAH.

import type { Mode } from "../app";
import type { IconName } from "../icons";
import type { SyncState } from "../protocol-client";

/** The tab on the drawer's bar. Its label is the one word for it wherever a page points there. */
export const HARNESS_MODE: { readonly id: "harness"; readonly label: string; readonly icon: IconName } = { id: "harness", label: "Harness", icon: "sparkle" };

/**
 * Whether the open chat plays on the harness; null while its view is still read, when that can't be
 * said yet. With no view and none on the way (no chat is open, or its read failed) there is no chat
 * the tab could show pages for.
 */
export function harnessChat(sync: Pick<SyncState, "view" | "status">): boolean | null {
  if (sync.view !== null) return sync.view.engine === "harness";
  return sync.status === "syncing" ? null : false;
}

/**
 * Whether the bar offers the tab: for a chat on the harness. While a chat's view is read the tab
 * stays if it is the one shown, so going from one harness chat to the next doesn't drop to Play in
 * between; it isn't offered anew for a chat nothing is known of yet.
 */
export function harnessOffered(harness: boolean | null, mode: Mode): boolean {
  return harness === true || (harness === null && mode === HARNESS_MODE.id);
}

/** The mode the drawer shows: the one chosen, or Play where the tab was chosen and isn't offered (the open chat changed to one another engine plays). */
export function shownMode(mode: Mode, offered: boolean): Mode {
  return mode === HARNESS_MODE.id && !offered ? "play" : mode;
}
