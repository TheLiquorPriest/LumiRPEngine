// What an Upgrade of a chat would bring into it, read through today's runtime (the old road's dispatcher and the harness tools of the
// extension): the pure plan and its words are `worlds/upgrade-preview.ts`, which RPE's own routes use over its store; this reads the chat's
// run and the world's revisions from the runtime until the old runtime goes (PlanSwap-8).

import type { ChatId, RevisionId, UserId } from "../shared/ids";
import type { UpgradePreview } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import type { WorldState } from "../engine/state";
import { definitionsLag, planUpgrade } from "../engine/upgrade";
import { upgradePreview } from "../worlds/upgrade-preview";
import { WorldError } from "../worlds/worlds";
import type { Runtime } from "./runtime";

/**
 * What an Upgrade of the chat to `to` would bring into it, from `state` (the chat's head): the plan
 * the fold applies, worded (`upgradePreview`). Null for a chat that plays no world. `unmade` is the
 * document `to` names while it is no revision of the world yet (a draft, named as its commit will
 * name it), so what a commit and the Upgrade after it bring can be shown before either is made.
 */
export async function previewUpgrade(rt: Pick<Runtime, "runOf" | "worlds" | "registry">, chatId: ChatId, userId: UserId, state: Readonly<WorldState>, to: RevisionId, unmade?: WorldDoc): Promise<UpgradePreview | null> {
  const run = await rt.runOf(chatId, userId);
  if (!run) return null;
  const docs = new Map<RevisionId, WorldDoc>();
  for (const revision of new Set([definitionsLag(state) ?? state.revision, state.revision, to])) docs.set(revision, unmade !== undefined && revision === to ? unmade : (await rt.worlds.get(run.worldId, userId, revision)).world);
  const doc = (revision: RevisionId): WorldDoc => {
    const found = docs.get(revision);
    if (!found) throw new WorldError("not_found", `revision ${revision} of the world not found`);
    return found;
  };
  const plan = planUpgrade(state, { worlds: (revision) => docs.get(revision), types: rt.registry }, to);
  return upgradePreview(rt.registry, plan, state, doc(to), doc(state.revision));
}
