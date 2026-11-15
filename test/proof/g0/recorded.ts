// Recorded runs for G0's tests: invented data in the shapes a run records (R-19), made from the floor's own
// recorded run (`../floor/recorded.ts`). `soundRun` is that run with what the model was sent measured, as
// the floor's own window test records it; the two counts of row 0.2 are made here in the shape the tags
// and two-step gates keep (`scripts/proof/g0/forms.ts`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CountedForm, FormKept, FormReading, FormsReading } from "../../../scripts/proof/g0/forms";
import { formCount } from "../../../scripts/proof/lib/phase0";
import type { ChatRow, StoredMessage } from "../../../scripts/proof/lib/sent";
import type { FloorRun } from "../../../scripts/testbed/floor-measure";
import { MODEL, recordedRun, type Shape } from "../floor/recorded";

interface RecordedWindow {
  request: { messages: { role: string; text: string }[] };
  breakdown: { messages: StoredMessage[] };
  rows: ChatRow[];
  keep: number;
}

/** RPH's own blocks after the prompt, named as an RPH that names its blocks keeps them (`block`). */
const blockOf = (text: string): string | null => (text.startsWith("What this scene has carried so far") ? "carry" : text.startsWith("Turn facts:") ? "briefing" : null);

/** A recorded run whose every RPE turn sent what the window kept, in order, with the chat's rows read: what the model was sent is measured, and passes. */
export function soundRun(shape: Shape): FloorRun {
  const recorded = JSON.parse(readFileSync(join(import.meta.dir, "..", "floor", "fixtures", "sent-window.json"), "utf8")) as RecordedWindow;
  const run = recordedRun(shape);
  for (const t of run.turns) {
    if (t.rpe === null) continue;
    t.rpe.request = { messages: recorded.request.messages.map((m) => ({ ...m, block: blockOf(m.text) })), tools: null };
    t.rpe.stored = recorded.breakdown.messages;
    t.rpe.rows = recorded.rows;
    t.rpe.history = { keep: recorded.keep, step: null, hold: null, framing: null, framingNote: null, framingWhy: null };
  }
  return run;
}

/** The count a gate of row 0.2 keeps for thirty turns of which `kept` were kept, the rest missed the way a model that drops its intent record misses. */
export function counted(form: CountedForm, kept: number, over: Partial<FormKept> = {}): FormKept {
  const miss = form === "tags" ? "no-intent-tag" : "intent-not-first";
  const outcomes = [...Array.from({ length: kept }, () => "kept"), ...Array.from({ length: 30 - kept }, () => miss)];
  return {
    kind: "form-count",
    form,
    run: "rig-20261120T091500Z",
    nonce: "invented-nonce-0",
    connection: "rpe-floor",
    model: MODEL,
    count: formCount(outcomes),
    calls: form === "two-step" ? { exact: Math.max(0, kept - 1), of: 30, each: "2, 2, 3" } : null,
    turns: outcomes.map((outcome, i) => ({ line: `an invented line ${i + 1}`, outcome, calls: form === "two-step" ? 2 : 1 })),
    ...over,
  };
}

/** A reading G0 may stand on, or one it may not (with its reasons). */
export const reading = (kept: FormKept | null, not: string[] = []): FormReading => ({ kept, run: kept === null ? null : kept.run, not });

/** Both counts as G0 reads them where the floor model keeps its tags. */
export const keepsTags = (): FormsReading => ({ tags: reading(counted("tags", 29)), twoStep: reading(counted("two-step", 30)) });

/** Both counts where the floor model does not: the tags kept in 8 of 30, the two-step form in 30. */
export const losesTags = (): FormsReading => ({ tags: reading(counted("tags", 8)), twoStep: reading(counted("two-step", 30)) });

/** No count was read. */
export const noCounts = (): FormsReading => ({ tags: reading(null, ["no run folder is named"]), twoStep: reading(null, ["no run folder is named"]) });
