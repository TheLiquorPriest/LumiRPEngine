// The scene role, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5): before the plan, the lore and notes
// the narrator should have for the turn's scene, which the turn records as an output event (C11).
// Classic has no such step: its lore is chosen inside each step and the Place section, so the
// prompt-only scene gives nothing. What the agent chooses is checked here: each lore entry once, by
// the id the lore tools give it (a World Info entry's short id from the lore index, its
// `bookId/entryId`, or a lore id), kept as the live lore id it names when the world as it reads lore
// holds that entry now; and notes as plain lines. Delivery reads each entry under the narrator's
// view, and marks each note as Minds lines are marked: one naming someone the player character can't
// see or carrying a secret's words goes in marked as a secret, or is left out where the narrator's
// knowledge omits secrets; whatever the scene read with, every note reaches the Scene section.

import { hasOwn, isRecord, type JsonValue } from "../../../shared/json";
import type { WorldDoc } from "../../../shared/world";
import { povPlace } from "../../../engine/visibility";
import type { Runtime } from "../../runtime";
import { presentNames } from "../../turn-steps";
import { loreIdOf } from "../tools/lore";
import type { ToolReader } from "../tools/read-view";
import type { SceneOut, SceneTask, TurnAgentCtx } from "../turn-ctx";
import { namesOf, type RoleAnswer, runRoleAgent } from "./agent";

/** The scene's answer as its output contract (§16) has it: the lore it names, each id once as written, and notes, each a trimmed line; null for an answer that isn't one. `sceneRun` reads the ids as live lore. */
export function sceneAnswer(raw: JsonValue): SceneOut | null {
  if (!isRecord(raw) || !Array.isArray(raw.lore) || !Array.isArray(raw.notes)) return null;
  const lore = [...new Set(raw.lore.flatMap((id) => (typeof id === "string" && id.trim() !== "" ? [id.trim()] : [])))];
  const notes = [...new Set(raw.notes.flatMap((n) => (typeof n === "string" && n.trim() !== "" ? [n.replace(/\s+/g, " ").trim()] : [])))];
  return { lore, notes };
}

/**
 * The live lore ids `refs` name (`loreIdOf`), each once, and the refs that name no entry the world as
 * `reader` reads lore holds now (`unknown`), which are dropped. While the chat's world can't be read,
 * only lore ids `world` holds stand.
 */
async function liveLoreIds(reader: ToolReader, world: Pick<WorldDoc, "lore">, refs: readonly string[]): Promise<{ lore: string[]; unknown: string[] }> {
  let view;
  try {
    view = await reader.view();
  } catch {
    return { lore: refs.filter((id) => hasOwn(world.lore, id)), unknown: refs.filter((id) => !hasOwn(world.lore, id)) };
  }
  const live = (await view.lore()).lore;
  const has = (id: string): boolean => hasOwn(live, id);
  const ids = await Promise.all(refs.map((ref) => loreIdOf(view, has, ref)));
  return { lore: [...new Set(ids.filter(has))], unknown: refs.filter((_, i) => !has(ids[i]!)) };
}

/** The scene as its role's agent works it, with the tools of its families. */
export async function sceneRun(rt: Runtime, task: SceneTask, ctx: TurnAgentCtx): Promise<RoleAnswer<SceneOut>> {
  const answer = await runRoleAgent(rt, ctx, {
    sub: "scene",
    phase: "pre",
    names: namesOf(task.world, task.state),
    // Where the player character is and who is with them, as the player may know them: what it chooses for starts there.
    vars: { text: task.text, place: povPlace(rt.registry, task.world, task.state)?.name ?? "", present: presentNames(rt.registry, task.world, task.state).join(", ") },
    tools: task.world,
    check: (raw) => sceneAnswer(raw),
  });
  if (!answer.ok) return answer;
  const { lore, unknown } = await liveLoreIds(ctx.reader, task.world, answer.out.lore);
  return { ...answer, out: { ...answer.out, lore, ...(unknown.length > 0 ? { unknown } : {}) } };
}
