import { AgentTree } from "../../../trace-view";
import { EachRun } from "../parts";
import type { TurnSection } from "../types";



export const section: TurnSection = { id: "trace", order: 80, title: "The run, step by step", spoiler: true, body: ({ turn, runs, now, notices }) => (runs.some((run) => run.agents.size > 0) ? <EachRun runs={runs} views={turn.runs} part={(run) => <AgentTree run={run} now={now} notices={notices} />} /> : null) };
