// Parts of the Turn page that sections share: which run a part is of, and a part drawn once for each run of the turn.

import type { RequestShown as AskedLine, RunShown } from "../../../shared/api";
import type { RunNode } from "../../live-model";
import { runTitle, TURN_KIND_WORDS } from "../../trace-view";
import { viewOf } from "../../turn-model";
import type { ComponentChildren } from "preact";

/** Feedback typed in Lumiverse's own regenerate dialog, as the turn lane gives it among the turn's `asked` lines (plan R-198): where it stands. */
export type FeedbackLine = Extract<AskedLine["asked"], { feedback: unknown }>["feedback"];

const SETTLED_WORDS: Readonly<Record<FeedbackLine["settled"], string>> = {
  start: "told apart from the prompt at the turn's start by comparison with the attempt it replaced; Lumiverse's breakdown, which comes with the saved reply, has not said otherwise",
  confirmed: "confirmed after the reply by Lumiverse's own name for it in the breakdown",
  corrected: "corrected after the reply: the breakdown's word governed over the comparison at the turn's start",
  completed: "completed after the reply from the breakdown: there was no earlier prompt of RPE's to compare with at the turn's start",
};

/** The feedback line an asked line is, where it is one. */
export function feedbackOf(line: AskedLine): FeedbackLine | null {
  return "feedback" in line.asked ? line.asked.feedback : null;
}

/** Where a feedback line stands, in words. */
export function settledWords(feedback: FeedbackLine): string {
  return SETTLED_WORDS[feedback.settled];
}

/** What he asked for beside his words, as a line: a panel's tap with what it was on, a composer control with the choice made and its words, or the feedback he typed in Lumiverse's regenerate dialog. */
export function askedWords(line: AskedLine): string {
  const { asked } = line;
  if ("feedback" in asked) return `feedback: ${asked.feedback.text}`;
  if ("what" in asked) return asked.on === null ? asked.what : `${asked.what}, on ${asked.on}`;
  return asked.words === null ? `${line.kind}: ${asked.choice}` : `${line.kind}: ${asked.choice} (${asked.words})`;
}

/** Which run a part is of, where the turn has run more than once (a continue runs it again under an id of its own). */
export function RunCaption(props: { nth: number; of: number; id: string | null; title: string }) {
  if (props.of < 2) return null;
  return (
    <p class="rpe-caption">
      Run {props.nth} of {props.of}
      {props.id === null ? "" : `, ${props.id}`}: {props.title}
    </p>
  );
}

/** Each run's own part, under its caption where the turn has run more than once; a run no view of the turn names (a job the turn started) is captioned by what it is. */
export function EachRun(props: { runs: readonly RunNode[]; views: readonly RunShown[]; part: (run: RunNode, view: RunShown | undefined) => ComponentChildren }) {
  return (
    <div class="lre-stack">
      {props.runs.map((run) => {
        const view = viewOf(props.views, run);
        return (
          <div key={run.run} class="lre-stack" data-run-of={run.run}>
            {view === undefined ? <p class="rpe-caption">{runTitle(run)}</p> : <RunCaption nth={view.nth} of={props.views.length} id={view.id} title={view.kind === "settle" ? TURN_KIND_WORDS.settle : runTitle(run)} />}
            {props.part(run, view)}
          </div>
        );
      })}
    </div>
  );
}
