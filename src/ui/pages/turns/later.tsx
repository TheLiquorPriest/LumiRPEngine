// The runs of a turn after the one that answered it (a Settle now run), each said in its own words beside the turn's own line: why it ran, that
// it writes nothing to the chat, how it ended, and its own time and spend (the turn's reply, its kind and its ending are the answering run's).

import type { TurnRunRow } from "../../../shared/api";
import { replyErrorWords, SETTLE_WHY, statusWords, TURN_KIND_WORDS } from "../../trace-view";
import { counted, duration, tokenWords } from "../../words";

/** One later run in a line: "Then a settle run (why): how it ended, its time, its calls and tokens; why it failed where it did." */
export function laterWords(run: TurnRunRow): string {
  const settle = run.kind === "settle";
  const ending = statusWords(run.kind, run.status, run.timings.released !== null).words;
  const from = run.timings.started ?? run.timings.received;
  const took = run.timings.ended === null ? "" : `, ${duration(run.timings.ended - from)}`;
  const failure = run.error === null || (settle && run.status === "no-reply") ? null : replyErrorWords(run.error, run.status);
  return `Then ${settle ? "a settle run" : `a ${TURN_KIND_WORDS[run.kind].toLowerCase()} run`}${settle ? ` (${SETTLE_WHY})` : ""}: ${ending.charAt(0).toLowerCase()}${ending.slice(1)}${took}, ${counted(run.usage.calls, "call")}, ${tokenWords(run.usage)}${failure === null ? "" : `; ${failure}`}.`;
}

/** The runs after the one that answered, one line each; nothing where there are none. */
export function LaterRuns(props: { runs: readonly TurnRunRow[] }) {
  if (props.runs.length === 0) return null;
  return (
    <ul class="rpe-plain lre-stack" data-later-runs>
      {props.runs.map((run) => (
        <li key={run.nth} class="rpe-line" data-later-run={run.nth}>
          {laterWords(run)}
        </li>
      ))}
    </ul>
  );
}
