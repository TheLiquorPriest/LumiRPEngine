// What a run spent against what it may (plan §14 "Sessions and Jobs show how many calls a run made and how full each agent's window is"):
// the calls a run made against the limit that applies to it, and each agent's window as a gauge: what its last call held, the window of its
// model, and the room kept for the answer, so it is plain how near compaction it is. The Sessions page draws it, and the Jobs page. It is
// read from a run's own trace records; a run that still runs moves as its records come, and one that ended shows its last reading.

import type { ConnectionShown } from "../../shared/api";
import type { AgentNode, RunNode } from "../live-model";
import { counted, num } from "../words";

/** What an agent's last answered call held of its model's window. */
export interface AgentWindow {
  agent: string;
  definition: string;
  connection: string;
  model: string;
  /** Tokens its last answered call held (what went in, new, read from the cache or written to it); null before a call was answered. */
  held: number | null;
  /** The model's window in tokens; null where nobody knows it. */
  window: number | null;
  /** The room its last call kept for the answer (its `maxTokens`); null where it set none. */
  reserve: number | null;
  /** Its calls so far. */
  calls: number;
  /** The agent has not ended. */
  running: boolean;
}

/** The window of a connection's model: what he entered, else what its server reported, else what the connection's own limits found for its own model. */
export function windowOfModel(connections: readonly ConnectionShown[], connection: string, model: string): number | null {
  const found = connections.find((c) => c.id === connection || c.name === connection);
  if (found === undefined) return null;
  const entered = found.limits?.[model]?.contextWindow;
  if (entered !== undefined) return entered;
  const reported = found.reported?.[model]?.contextWindow;
  if (reported !== undefined) return reported;
  if (found.model === model || found.model === undefined) return found.limitsInForce?.contextWindow?.tokens ?? null;
  return null;
}

function windowOfAgent(id: string, agent: AgentNode, run: RunNode, windowOf: (connection: string, model: string) => number | null): AgentWindow {
  let held: number | null = null;
  let reserve: number | null = null;
  let calls = 0;
  let connection = agent.info?.connection ?? "";
  let model = agent.info?.model ?? "";
  for (const step of agent.steps) {
    if (step.kind !== "call") continue;
    calls++;
    connection = step.sent.connection;
    model = step.sent.model;
    if (step.answer !== null) {
      held = step.answer.usage.input + step.answer.usage.cacheRead + step.answer.usage.cacheWrite;
      reserve = step.sent.maxTokens ?? null;
    }
  }
  return {
    agent: id,
    definition: agent.ref.definition,
    connection,
    model,
    held,
    window: windowOf(connection, model),
    reserve,
    calls,
    running: agent.ended === null && run.outcome === null,
  };
}

/** Each agent of a run with its window as its last call left it. */
export function windowsOf(run: RunNode, windowOf: (connection: string, model: string) => number | null): AgentWindow[] {
  return [...run.agents].map(([id, agent]) => windowOfAgent(id, agent, run, windowOf));
}

/** A run's model calls, all its agents together. */
export function callsOf(run: RunNode): number {
  let calls = 0;
  for (const agent of run.agents.values()) for (const step of agent.steps) if (step.kind === "call") calls++;
  return calls;
}

/** "7 of 40 calls", or "7 calls" where no limit is known. */
export function CallsLine(props: { calls: number; limit: number | null; running?: boolean }) {
  const words = props.limit === null ? counted(props.calls, "call") : `${num(props.calls)} of ${num(props.limit)} calls`;
  const near = props.limit !== null && props.calls >= props.limit;
  return (
    <span class="rpe-calls" data-calls={props.calls} data-limit={props.limit ?? undefined} data-running={props.running === true ? "yes" : undefined}>
      {words}
      {near ? " (the limit)" : ""}
    </span>
  );
}

/** A window gauge: the share held, then the room kept for the answer, of the window. */
export function WindowGauge(props: { w: AgentWindow }) {
  const { w } = props;
  const who = `${w.definition}${w.model === "" ? "" : ` on ${w.model}`}`;
  if (w.held === null) return <p class="rpe-meta" data-window={w.agent}>{who}: no call answered yet.</p>;
  if (w.window === null) {
    return (
      <p class="rpe-meta" data-window={w.agent}>
        {who}: holds {num(w.held)} tokens; its window is not known.
      </p>
    );
  }
  const held = Math.min(100, (w.held / w.window) * 100);
  const reserve = w.reserve === null ? 0 : Math.min(100 - held, (w.reserve / w.window) * 100);
  const full = w.held + (w.reserve ?? 0) >= w.window;
  return (
    <div class="rpe-window" data-window={w.agent} data-full={full ? "yes" : undefined}>
      <p class="rpe-meta">
        {who}: holds {num(w.held)} of {num(w.window)} tokens{w.reserve === null ? "" : `, ${num(w.reserve)} kept for its answer`}
        {full ? ": the next call compacts" : ""}
        {w.running ? "" : " (its last reading)"}
      </p>
      <div class="rpe-gauge" role="meter" aria-valuemin={0} aria-valuemax={w.window} aria-valuenow={w.held} aria-label={`${who}: window`}>
        <span class="rpe-gauge-held" style={{ width: `${held}%` }} />
        <span class="rpe-gauge-reserve" style={{ width: `${reserve}%` }} />
      </div>
    </div>
  );
}

/** A run's calls against its limit and each of its agents' windows. */
export function RunUsage(props: { run: RunNode; limit: number | null; windowOf(connection: string, model: string): number | null }) {
  const windows = windowsOf(props.run, props.windowOf);
  return (
    <div class="lre-stack" data-usage>
      <p class="rpe-line">
        <CallsLine calls={callsOf(props.run)} limit={props.limit} running={props.run.outcome === null} />
      </p>
      {windows.map((w) => (
        <WindowGauge key={w.agent} w={w} />
      ))}
    </div>
  );
}
