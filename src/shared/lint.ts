// What a world's lint finds, and the fix it offers (DESIGN §23): moved unchanged out of the previous
// extension's protocol (PlanSwap-13), which takes them back from here until it goes.

import type { JsonPatchOp } from "./json-patch";

export interface LintIssue {
  severity: "error" | "warning" | "info";
  /** Document path, e.g. `entities.npc_dev.fields.cash`. */
  path: string;
  code: string;
  message: string;
  /** A fix Problems offers in one press: what it does, and the draft patch that does it. */
  fix?: LintFix;
}

/** One press's fix to the draft (`lre.editor patch`): its label ("Put it at 114 Harbor Street") and its operations. */
export interface LintFix {
  label: string;
  ops: JsonPatchOp[];
}
