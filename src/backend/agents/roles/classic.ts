// The fixed pipeline's roles in prompt-only mode (INC2-SPEC C9, lane T1): each role's task is worked
// by its classic step's own call (`task.classic`), with that step's prompt, contract and budget, at
// the seam the classic-turn map §10 names for it, so an agent turn with these roles makes exactly
// the calls a classic turn makes, in the same order, and gets the same answers. Classic has no scene
// step (its lore is chosen inside each step and the Place section), so the scene's classic call
// answers with no lore and no notes.
//
// The agent-backed roles (`index.ts`) work the same tasks with tools and fall back on these same
// calls (`promptOnly`, `onFail: "prompt_only"`).

import { FAILED_TEXT } from "../../../shared/agent-failures";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import type { DirectorProse, RoleResult, RoleTask, TurnAgentCtx, TurnRoles } from "../turn-ctx";
import { emptyUsage } from "../usage";

function answered<O>(out: O): RoleResult<O> {
  return { ok: true, out, usage: emptyUsage(), via: "prompt_only" };
}

/** A role run that is its task's classic call; what that call spent is the classic step meter's, not an agent's. */
async function prompted<C>(task: RoleTask<C>, ctx: TurnAgentCtx): Promise<RoleResult<C>> {
  return answered(await task.classic(ctx.signal));
}

/** The fixed pipeline's roles as classic's own calls; `rt`, where given, words a failure in the user's texts (else the shipped ones). */
export function classicRoles(rt?: Runtime): TurnRoles {
  return {
    intent: {
      // A failed call is the role's failure (its `onFail` decides); none left in the budget is a read of nothing.
      interpret: async (task, ctx) => {
        const done = await task.classic(ctx.signal);
        if (!done.failed) return answered(done.read);
        const texts = ctx.texts ?? (rt ? (await rt.settings.get(ctx.userId)).prompts.texts : {});
        return { ok: false, code: "failed", reason: renderPrompt(FAILED_TEXT.interpret, texts, {}), usage: emptyUsage(), via: "prompt_only" };
      },
      judge: prompted,
      puzzle: prompted,
    },
    scene: prompted,
    minds: prompted,
    knowledge: prompted,
    director: {
      decisions: prompted,
      prose: async (task, ctx) => answered<DirectorProse>({ prose: await task.classic(ctx.signal) }),
      choices: prompted,
      offscreen: prompted,
    },
    read: { extract: prompted },
    world: { effects: prompted },
    memory: prompted,
    skip: { plan: prompted, beats: prompted },
  };
}
