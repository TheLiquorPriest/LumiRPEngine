// The way into the story's pages from outside the drawer: a harness reply's footer opens its turn's
// record (`openTurnRecord`). A window event, as the activity line's way to Diagnostics is: `setup`
// hears it, puts the drawer at Harness → Record on that reply (`atTurnRecord`) and opens the tab.
// The Harness tab's curtain still stands between the press and the record: the record holds what
// the player's character doesn't know.

import type { StoryAt } from "../../shared/story-pages";
import type { UiState } from "../app";

/** The event `openTurnRecord` sends and `setup` hears. */
export const OPEN_TURN_RECORD_EVENT = "lre:open-turn-record";

/** Opens the drawer at the record of the turn that wrote the reply `at` names. */
export function openTurnRecord(at: StoryAt): void {
  window.dispatchEvent(new CustomEvent<StoryAt>(OPEN_TURN_RECORD_EVENT, { detail: { messageId: at.messageId, swipeId: at.swipeId } }));
}

/** The UI state that shows a reply's record: the Harness tab, at Record on that reply. */
export function atTurnRecord(ui: UiState, at: StoryAt): UiState {
  return { ...ui, mode: "harness", harness: { page: "record", at: { messageId: at.messageId, swipeId: at.swipeId } } };
}
