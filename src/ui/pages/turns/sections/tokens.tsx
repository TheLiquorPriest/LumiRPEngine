import type { TurnReply } from "../../../../shared/api";
import { Row } from "../../../atoms";
import { counted, tokenWords } from "../../../words";
import type { TurnSection } from "../types";

/** What the turn spent, all its runs together, and each run's own where there are several. */
function Tokens(props: { turn: TurnReply }) {
  const { usage, runs } = props.turn;
  return (
    <div>
      {runs.length > 1 ? <p class="rpe-meta">All its runs together; each run's own is below.</p> : null}
      <Row label="Model calls" value={<span class="lre-num">{usage.calls}</span>} />
      <Row label="Tokens sent" value={<span class="lre-num">{usage.input.toLocaleString("en")}</span>} sub={`${usage.cacheRead.toLocaleString("en")} read from the provider's cache, ${usage.cacheWrite.toLocaleString("en")} written to it`} />
      <Row label="Tokens written" value={<span class="lre-num">{usage.output.toLocaleString("en")}</span>} sub={usage.reasoning === undefined ? undefined : `${usage.reasoning.toLocaleString("en")} of them reasoning`} />
      {runs.length > 1 ? runs.map((run) => <Row key={run.id} label={`Run ${run.nth}, ${run.id}`} value={<span class="lre-num">{counted(run.usage.calls, "call")}</span>} sub={tokenWords(run.usage)} />) : null}
    </div>
  );
}


export const section: TurnSection = { id: "tokens", order: 20, title: "Tokens", spoiler: false, body: ({ turn }) => <Tokens turn={turn} /> };
