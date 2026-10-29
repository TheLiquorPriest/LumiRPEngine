// The scene role, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5): before the plan, the lore and notes
// the narrator should have for the turn's scene, which the turn records as an output event (C11).
// Classic has no such step: its lore is chosen inside each step and the Place section, so the
// prompt-only scene gives nothing. What the agent chooses is checked here: only lore ids the world
// holds now, each once, and notes as plain lines, with the knowledge it read the scene with. Delivery
// reads each entry under the narrator's view, and holds each note to what Minds lines are held to: a
// note read beyond the player character's knowledge never reaches the player's scope, and one naming
// someone they can't see or carrying a secret's words goes in marked as a secret, or not at all.

import type { AgentKnowledge } from "../../../shared/agent-tools";
import { hasOwn, isRecord, type JsonValue } from "../../../shared/json";
import type { WorldDoc } from "../../../shared/world";
import { povPlace } from "../../../engine/visibility";
import type { Runtime } from "../../runtime";
import { presentNames } from "../../turn-steps";
import type { SceneOut, SceneTask, TurnAgentCtx } from "../turn-ctx";
import { namesOf, type RoleAnswer, runRoleAgent } from "./agent";

/** The scene's answer as what the narrator is told (its output contract, §16): live lore ids, each once, and notes, each a trimmed line, read with `knowledge`; null for an answer that isn't one. */
export function sceneAnswer(raw: JsonValue, world: Pick<WorldDoc, "lore">, knowledge: AgentKnowledge): SceneOut | null {
  if (!isRecord(raw) || !Array.isArray(raw.lore) || !Array.isArray(raw.notes)) return null;
  const lore = [...new Set(raw.lore.filter((id): id is string => typeof id === "string" && hasOwn(world.lore, id)))];
  const notes = [...new Set(raw.notes.flatMap((n) => (typeof n === "string" && n.trim() !== "" ? [n.replace(/\s+/g, " ").trim()] : [])))];
  return { lore, notes, knowledge };
}

/** The scene as its role's agent works it, with the tools of its families; its notes carry the knowledge its tools read with, the player character's for a scene that reads only its task. */
export function sceneRun(rt: Runtime, task: SceneTask, ctx: TurnAgentCtx): Promise<RoleAnswer<SceneOut>> {
  const knowledge: AgentKnowledge = ctx.settings.knowledge === "own" ? "pov" : ctx.settings.knowledge;
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "scene",
      purpose: null,
      phase: "pre",
      names: namesOf(task.world, task.state),
      // Where the player character is and who is with them, as the player may know them: what it chooses for starts there.
      vars: { text: task.text, place: povPlace(rt.registry, task.world, task.state)?.name ?? "", present: presentNames(rt.registry, task.world, task.state).join(", ") },
      tools: task.world,
      check: (raw) => sceneAnswer(raw, task.world, knowledge),
    },
  );
}
