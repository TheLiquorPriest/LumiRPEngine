import type { TurnReply } from "../../../../shared/api";
import { Row } from "../../../atoms";
import { momentsOf, spansOf } from "../../../turn-model";
import { clock, duration } from "../../../words";
import type { TurnSection } from "../types";

function Timings(props: { turn: TurnReply }) {
  const moments = momentsOf(props.turn.timings);
  const spans = spansOf(props.turn.timings);
  return (
    <div class="lre-stack">
      {props.turn.runs.length > 1 ? <p class="rpe-meta">Of its latest run.</p> : null}
      <div>
        {moments.map((m) => (
          <Row key={m.label} label={m.label} value={<span class="lre-num">{clock(m.at)}</span>} sub={m.since === null ? undefined : `${duration(m.since)} after the moment before`} />
        ))}
      </div>
      {spans.length === 0 ? null : (
        <div class="rpe-stats" aria-label="Where the time went">
          {spans.map((s) => (
            <span key={s.label}>
              {s.label}: <strong class="lre-num">{duration(s.ms)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


export const section: TurnSection = { id: "timings", order: 10, title: "Timings", spoiler: false, body: ({ turn }) => <Timings turn={turn} /> };
