// The kept UI's request and answer types (READINGS R-47, R-50): the review cards and Propose routines'
// input, as the kept components and their call files read them. Moved unchanged out of the previous
// extension's protocol (PlanSwap-13), whose message lists keep their own copies until PlanSwap-10
// removes it. Only the kept UI and its call files import this file.

import type { EntityId, MessageId } from "../../shared/ids";
import type { GenerateAs } from "../../shared/state-view";

/**
 * Propose routines from lore (DESIGN §13): whom it proposes routines and schedules for, and where a
 * second pass starts. People and groups are read in id order; a pass that stops before the last
 * returns the input that continues it (`JobResult.next`).
 */
export interface RoutineJobInput {
  /** The people and groups to propose for; absent, every one the job may read. */
  owners?: EntityId[];
  /** A second pass: start after this owner. */
  after?: EntityId;
}

/**
 * One change of a review card: its key (an operation's, or the read's confirm chip's), whether a role
 * staged it (`agent`) or the reply's read proposed it (`read`), the role, its change type, its lines,
 * and how it stands: waiting (`open`), let through at a gate (`approved`), `applied` (with its Undo chip
 * for `lre.chip`, `undo`; `undone` once that was pressed), `rejected`, or `refused` when it no longer applied.
 */
export interface ReviewItemView {
  key: string;
  source: "agent" | "read";
  role: string;
  changeType: string;
  lines: string[];
  status: "open" | "approved" | "applied" | "rejected" | "refused";
  refused?: { code: string; reason: string };
  undo?: string;
  undone?: true;
  /** On a harness chat, who staged it: the agent's harness name, and after the reply that it came then. Absent on the other engines, where `source` and `role` say it. */
  by?: string;
}

/** One turn's review card: the turn (`<message>:<swipe>`, or `<message>:gate`), the message it shows on, where its changes wait, its items, and at a gate how its turn resumes. */
export interface ReviewCardView {
  turn: string;
  messageId: MessageId;
  swipeId?: number;
  placement: "chips" | "gate";
  items: ReviewItemView[];
  resume?: GenerateAs;
}
