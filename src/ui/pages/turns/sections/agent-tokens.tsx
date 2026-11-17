import { Row } from "../../../../frontend/components";
import { agentUsage, type RunNode } from "../../../live-model";
import { counted, tokenWords } from "../../../words";
import { EachRun } from "../parts";
import type { TurnSection } from "../types";

function TokensByAgent(props: { run: RunNode }) {
  const agents = [...props.run.agents.values()];
  if (agents.length === 0) return <p class="lre-muted rpe-line">No agent has begun work.</p>;
  return (
    <div>
      {agents.map((agent) => {
        const usage = agentUsage(agent);
        return <Row key={agent.ref.id} k={agent.ref.plays === undefined ? agent.ref.definition : `${agent.ref.definition}, playing ${agent.ref.plays}`} v={<span class="lre-num">{counted(usage.calls, "call")}</span>} sub={tokenWords(usage)} />;
      })}
    </div>
  );
}


export const section: TurnSection = { id: "agent-tokens", order: 70, title: "Tokens by agent", spoiler: true, body: ({ turn, runs }) => (runs.some((run) => run.agents.size > 0) ? <EachRun runs={runs} views={turn.runs} part={(run) => <TokensByAgent run={run} />} /> : null) };
