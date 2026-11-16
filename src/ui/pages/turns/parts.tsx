// Parts of the Turn page that sections share: which run a part is of, and a part drawn once for each run of the turn.

import type { RequestShown as AskedLine, RunShown } from "../../../shared/api";
import type { RunNode } from "../../live-model";
import { runTitle, TURN_KIND_WORDS } from "../../trace-view";
import { viewOf } from "../../turn-model";
import type { ComponentChildren } from "preact";

/** What he asked for beside his words, as a line: a panel's tap with what it was on, a composer control with the choice made and its words. */
export function askedWords(line: AskedLine): string {
  const { asked } = line;
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
