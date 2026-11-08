// GM mode's navigation as UI state, so the mode shell and the GM pages agree on it: which section is
// open, and a character to open in it (a link between a character's GM pages). Nothing waits behind
// a gate: every GM page is the player's to read (DEPTH-PLAN §1.4, D-9).

import type { GmSection, UiState } from "../app";

/** Another GM section. */
export function gmAt(ui: UiState, section: GmSection): UiState {
  return ui.gm.section === section ? ui : { ...ui, gm: { ...ui.gm, section } };
}

/** Another GM section with one character's page open in it (a link between a character's GM pages). */
export function gmOpen(ui: UiState, section: GmSection, entity: string): UiState {
  return { ...ui, gm: { ...ui.gm, section, focus: entity } };
}

/** The focus taken: the section opened its page. */
export function focusTaken(ui: UiState): UiState {
  if (ui.gm.focus === undefined) return ui;
  const { focus: _taken, ...gm } = ui.gm;
  return { ...ui, gm };
}
