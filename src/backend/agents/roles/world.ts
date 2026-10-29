// The world role, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5): a world's own effects step after
// the reply, its author's text filled with what the turn gives it, answered as classic's step's are
// (`effectsAnswer`: at most fifteen proposals, each with a type, money in minor units), which the
// engine then validates and bounds as it does the reply's read. A world with no effects step has
// nothing to propose, with no call, as classic.

import { isRecord, type JsonObject } from "../../../shared/json";
import type { Runtime } from "../../runtime";
import { effectsAnswer, renderTemplate } from "../../turn-steps";
import type { EffectsTask, TurnAgentCtx } from "../turn-ctx";
import { emptyUsage } from "../usage";
import { type RoleAnswer, runRoleAgent } from "./agent";

/** A world's effects step as the world role's agent works it, with the tools of its families. */
export async function effectsRun(rt: Runtime, task: EffectsTask, ctx: TurnAgentCtx): Promise<RoleAnswer<JsonObject[]>> {
  if (task.template === "") return { ok: true, out: [], usage: emptyUsage(), via: "agent", text: "" };
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "effects",
      purpose: "extract",
      phase: "read",
      names: { world: task.vars.world ?? "", pov: task.vars.pov ?? "" },
      vars: { ...task.vars, template: renderTemplate(task.template, task.vars) },
      answer: { part: "answer", vars: { currency: task.currency.code, symbol: task.currency.symbol } },
      tools: task.world,
      check: (raw) => (isRecord(raw) && Array.isArray(raw.proposals) ? effectsAnswer(raw, task.currency) : null),
    },
  );
}
