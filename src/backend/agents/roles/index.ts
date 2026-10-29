// The fixed pipeline's roles (INC2-SPEC C9, lane T2): each task run by its role's agent, or, where
// the role is prompt-only (`RoleSettings.promptOnly`), by its classic step's own call (`classic.ts`).
// A failed agent run does as the role's `onFail` says: the orchestrator runs it again prompt-only,
// goes on without it, or stops the turn; the minds family does so call by call (`mindAsk`). Test for
// a role's text (Settings → Agents → Prompts, `lre.prompts test`) runs the text's task once on a
// chat (`test.ts`).

import type { Runtime } from "../../runtime";
import type { RoleResult, RoleRun, TurnAgentCtx, TurnRoles } from "../turn-ctx";
import { classicRoles } from "./classic";
import { choicesRun, decideRun, proseRun } from "./director";
import { interpretRun, judgeRun, puzzleRun } from "./intent";
import { knowledgeRun, memoryRun, mindsRun, skipPlanRun, skipRun } from "./minds";
import { extractRun } from "./read";
import { sceneRun } from "./scene";
import { effectsRun } from "./world";

/** The roles of `rt`'s turns: each task its role's agent's, or its classic step's while the role is prompt-only. */
export function agentRoles(rt: Runtime): TurnRoles {
  const classic = classicRoles(rt);
  const either =
    <T, O>(agent: (rt: Runtime, task: T, ctx: TurnAgentCtx) => Promise<RoleResult<O>>, prompted: RoleRun<T, O>): RoleRun<T, O> =>
    (task, ctx) =>
      ctx.settings.promptOnly ? prompted(task, ctx) : agent(rt, task, ctx);
  return {
    intent: { interpret: either(interpretRun, classic.intent.interpret), judge: either(judgeRun, classic.intent.judge), puzzle: either(puzzleRun, classic.intent.puzzle) },
    scene: either(sceneRun, classic.scene),
    minds: either(mindsRun, classic.minds),
    knowledge: either(knowledgeRun, classic.knowledge),
    director: { decisions: either(decideRun, classic.director.decisions), prose: either(proseRun, classic.director.prose), choices: either(choicesRun, classic.director.choices), offscreen: either(decideRun, classic.director.offscreen) },
    read: { extract: either(extractRun, classic.read.extract) },
    world: { effects: either(effectsRun, classic.world.effects) },
    memory: either(memoryRun, classic.memory),
    skip: { plan: either(skipPlanRun, classic.skip.plan), beats: either(skipRun, classic.skip.beats) },
  };
}
