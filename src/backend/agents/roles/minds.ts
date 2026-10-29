// The minds family of roles, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5): minds (each present
// person's thoughts before the plan), knowledge (what each one learned from the turn, after the read)
// memory (their memory of what was written, and consolidation) and skip (a time skip's plan, and its
// beats with the minds at them). Classic runs each phase: who is asked, what each reads, its lore and
// its budget, and how its answers are validated and recorded. Each call the phase makes is asked of
// its role's agent (`mindAsk`), which reads that character's own context only, so the events are
// classic's types, by classic's own validators (`mindData`, `memoryData`, the knowledge step's parser
// and filters, the plan's and the beats' checks).

import { planSkip } from "../../skip-plan";
import { postKnowledge, postMemory, preMinds, type RunMindsResult } from "../../minds";
import type { Runtime } from "../../runtime";
import { runSkip, type SkipRun } from "../../skip";
import type { LedgerEvent } from "../../../shared/ledger";
import type { KnowledgeTask, MemoryTask, MindsTask, RoleResult, SkipPlanTask, SkipTask, TurnAgentCtx } from "../turn-ctx";
import { emptyUsage } from "../usage";
import { mindAsk } from "./minds-ask";

/** A minds phase's result as its role's: classic's own, each call's spend counted in its traces (the agents' in Diagnostics). */
function ran<O>(out: O): RoleResult<O> {
  return { ok: true, out, usage: emptyUsage(), via: "agent" };
}

/** The minds before the plan: each person present asked by the minds role's agent. */
export async function mindsRun(rt: Runtime, task: MindsTask, ctx: TurnAgentCtx): Promise<RoleResult<RunMindsResult>> {
  return ran(await preMinds({ ...rt.minds, ask: mindAsk(rt, ctx, "pre") }, { ...task.input, signal: ctx.signal }));
}

/** The knowledge step after the read: what each person who was there learned from the turn, the read's findings with it. */
export async function knowledgeRun(rt: Runtime, task: KnowledgeTask, ctx: TurnAgentCtx): Promise<RoleResult<RunMindsResult>> {
  return ran(await postKnowledge({ ...rt.minds, ask: mindAsk(rt, ctx, "read") }, { ...task.input, signal: ctx.signal }, task.opening));
}

/** The memory of what was written, and consolidation, from the post phase's opening; a classic turn's memory (none) is its whole post phase, classic's. */
export async function memoryRun(rt: Runtime, task: MemoryTask, ctx: TurnAgentCtx): Promise<RoleResult<RunMindsResult>> {
  if (task.opening === null) return ran(await task.classic(ctx.signal));
  return ran(await postMemory({ ...rt.minds, ask: mindAsk(rt, ctx, "memory") }, { ...task.input, signal: ctx.signal }, task.opening));
}

/** A timelapse's skip plan, its call asked of the skip role's agent. */
export async function skipPlanRun(rt: Runtime, task: SkipPlanTask, ctx: TurnAgentCtx): Promise<RoleResult<LedgerEvent | null>> {
  return ran(await planSkip({ registry: rt.registry, steps: rt.steps, log: task.log, host: rt.host, ask: mindAsk(rt, ctx, "skip") }, { ...task.input, signal: ctx.signal }));
}

/** A time skip's beats, their call asked of the skip role's agent, and the minds at them of the minds role's. */
export async function skipRun(rt: Runtime, task: SkipTask, ctx: TurnAgentCtx): Promise<RoleResult<SkipRun | null>> {
  return ran(await runSkip({ registry: rt.registry, steps: rt.steps, minds: task.minds, host: rt.host, ask: mindAsk(rt, ctx, "skip") }, { ...task.input, signal: ctx.signal }));
}
