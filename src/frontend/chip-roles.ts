// What a chip asks of the player under a reply: a decision to answer, an
// offer to take or leave, or a record of what the turn did. Every kind is listed, so a new chip
// kind can't ship without a role and a tone.

import type { Chip, ChipKind } from "../shared/state-view";

export type ChipRole = "decision" | "offer" | "done";

export type ChipTone = "neutral" | "pos" | "neg" | "warn";

const ROLE: Record<ChipKind, ChipRole> = {
  confirm: "decision",
  keep_report: "decision",
  contradiction: "decision",
  read_failed: "decision",
  engine_failed: "decision",
  retry: "decision",
  retry_read: "decision",
  reread: "decision",
  overdue: "decision",
  refused: "decision",
  timelapse_offer: "offer",
  continue_timelapse: "offer",
  choice: "offer",
  swipe_option: "offer",
  change: "done",
  elapsed: "done",
  roll: "done",
  price: "done",
  undo: "done",
  not_action: "done",
  mode_change: "done",
  fix: "done",
  pending: "done",
  degraded: "done",
  // A decline that offers a way out (pay another way, retry) asks; one without actions only reports.
  decline: "done",
};

const TONE: Record<ChipKind, ChipTone> = {
  decline: "neg",
  read_failed: "neg",
  engine_failed: "neg",
  refused: "neg",
  degraded: "warn",
  pending: "warn",
  overdue: "warn",
  confirm: "warn",
  keep_report: "neutral",
  contradiction: "neutral",
  retry: "neutral",
  retry_read: "neutral",
  reread: "neutral",
  timelapse_offer: "neutral",
  continue_timelapse: "neutral",
  choice: "neutral",
  swipe_option: "neutral",
  change: "neutral",
  elapsed: "neutral",
  roll: "neutral",
  price: "neutral",
  undo: "neutral",
  not_action: "neutral",
  mode_change: "neutral",
  fix: "neutral",
};

export function chipRole(chip: Pick<Chip, "kind" | "actions">): ChipRole {
  return chip.kind === "decline" && chip.actions.length > 0 ? "decision" : ROLE[chip.kind];
}

export function chipTone(chip: Pick<Chip, "kind">): ChipTone {
  return TONE[chip.kind];
}
