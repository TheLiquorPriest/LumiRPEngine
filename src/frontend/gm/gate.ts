// GM mode's curtain as UI state (contract §4.5, §9.7), so the mode shell and the GM view agree on
// it: Show the truth opens it; Hide, leaving GM mode or another chat closes it again; moving between
// GM sections leaves it as it is. World, Places, Story, Money, the Fight and This chat's Edits wait
// behind it; This chat's rules and the Inspector show player-safe data and don't.

import type { GmSection, UiState } from "../app";

export function revealTruth(ui: UiState): UiState {
  return ui.gm.revealed ? ui : { ...ui, gm: { ...ui.gm, revealed: true } };
}

/** Re-arms the gate; the section stays where it was. */
export function hideTruth(ui: UiState): UiState {
  return ui.gm.revealed ? { ...ui, gm: { ...ui.gm, revealed: false } } : ui;
}

/** Another GM section, the gate left as it is. */
export function gmAt(ui: UiState, section: GmSection): UiState {
  return ui.gm.section === section ? ui : { ...ui, gm: { ...ui.gm, section } };
}
