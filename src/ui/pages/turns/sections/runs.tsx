import type { RunShown } from "../../../../shared/api";
import { Badge, Pre } from "../../../atoms";
import type { RunNode } from "../../../live-model";
import { RunHead, runTitle, statusWords, TURN_KIND_WORDS } from "../../../trace-view";
import { RunCaption } from "../parts";
import type { TurnSection } from "../types";

/** Each run of a turn run more than once, by its own id: how it went, and what it sent to the chat (the latest's is below, as it streams). */
function Runs(props: { views: readonly RunShown[]; runs: readonly RunNode[]; now: number }) {
  const latest = props.views.at(-1);
  return (
    <div class="lre-stack">
      {props.views.map((view) => {
        const run = props.runs.find((r) => r.run === (view.run ?? view.id));
        const status = statusWords(view.kind, view.status);
        return (
          <div key={view.id} class="lre-stack" data-run={view.id}>
            <RunCaption nth={view.nth} of={props.views.length} id={view.id} title={run === undefined || view.kind === "settle" ? TURN_KIND_WORDS[view.kind] : runTitle(run)} />
            {run === undefined ? (
              <span class="lre-inline">
                <Badge tone={status.tone}>{status.words}</Badge>
              </span>
            ) : (
              <RunHead run={run} now={props.now} kind={view.kind} />
            )}
            {view === latest ? null : view.reply.text === "" ? <p class="rpe-meta">It sent nothing to the chat.</p> : <Pre text={view.reply.text} mono={false} />}
          </div>
        );
      })}
    </div>
  );
}


export const section: TurnSection = { id: "runs", order: 30, title: "Its runs", spoiler: false, body: ({ turn, runs, now }) => (turn.runs.length < 2 ? null : <Runs views={turn.runs} runs={runs} now={now} />) };
