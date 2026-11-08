// Remembering right after the reply (DEPTH-PLAN §2.4, §4.4 Remember, §5.3): each character agent that
// played the turn's scene writes what it keeps of it into its mind, in its own voice, where it hasn't
// already: the scene as it lived it (the beats it lived in its plays, then what else reached it in
// the scene since) with its own takes as it had them. Each character's answer lands as one
// basis-anchored layer entry at the reply's basis (§4.9), so a swipe of the reply leaves it inert and
// a swipe back restores it, and a rerun of the same job lands nothing twice. Its lived batch (mode
// "remember") takes up the takes it remembered, so they leave its working memory; plans it writes
// with a time reach the Cast life planner through the minds pack's fold.
//
// The caller says whose scene is over: the step after a reply names whoever holds takes there but a
// character whose real-time talk still runs, whose scene stays open in its working memory until the
// talk ends (the author's, or the player's Leave, which runs that step at once) or its takes reach
// the cap (`depth/scene/after.ts`). Runs on the ledger's queue (its fold and its landing): never
// awaited inside an operation on that queue.

import { MIND_WRITE, hasAgent, mindV2At, pendingFor, storyOrder, takersAt, takesOf, exposedBeats } from "../../../shared/character-engine";
import type { ChatId, EntityId, UserId } from "../../../shared/ids";
import type { Basis, LandResult } from "../../../shared/layer";
import type { UserSettings } from "../../../shared/settings";
import { layerEntryId } from "../../../engine/ledger/layer";
import { remember } from "../../character-agent";
import { foldAt, land, livedPovs, mindInput, MindRefused, portFor, type AtBasis, type EngineRt } from "../../character-engine";
import type { ModelPort } from "../port";

export interface RememberOptions {
  /** The reply's basis (the head by default). */
  basis?: Basis;
  model?: ModelPort;
  signal?: AbortSignal;
}

/** Whose takes `rememberAfterReply` took up, the entries it landed, and who couldn't remember now (their takes wait for the next try). */
export interface RememberOut {
  remembered: EntityId[];
  entries: LandResult[];
  failed: { who: EntityId; why: string }[];
}

/**
 * One character remembers its scene at `at` (§4.4): the beats it lived in its takes, and what else
 * reached it since it first played and it hasn't lived, in story order (at most Settings → Depth's
 * catch-up batch of those; older ones wait for its catch-up), with its takes in order. Null when it
 * has nothing to remember (no takes, or no beat it can live). An answer that doesn't read lands
 * nothing and says so; its takes stay its working memory.
 */
async function rememberAt(rt: EngineRt, chatId: ChatId, userId: UserId, at: AtBasis, who: EntityId, settings: UserSettings, model: ModelPort, signal?: AbortSignal): Promise<LandResult | null> {
  const takes = takesOf(at.state, who);
  if (takes.length === 0 || !hasAgent(at.world, at.state, who)) return null;
  const { beats, replaced } = exposedBeats(at.story);
  const live = beats.filter((b) => !replaced.has(b.id));
  const byId = new Map(live.map((b) => [b.id, b]));
  const ids = new Set(takes.flatMap((t) => [...t.lived, ...(t.beat !== undefined ? [t.beat] : [])]));
  const since = Math.min(...takes.map((t) => t.at));
  const later = pendingFor(live, mindV2At(at.state, who), who)
    .filter((b) => !ids.has(b.id) && b.at >= since)
    .slice(0, Math.max(1, settings.depth.catchUpBatch));
  const scene = storyOrder([...[...ids].flatMap((id) => byId.get(id) ?? []), ...later]);
  const lived = await livedPovs(rt.blobs, userId, at.world, scene, who);
  if (lived.length === 0) return null;
  const texts: string[] = [];
  for (const t of takes) {
    const take = await rt.blobs.get(userId, t.hash);
    if (take !== null && take.trim() !== "") texts.push(take);
  }
  const out = await remember(model, { ...(await mindInput(rt, userId, at, who, settings)), lived, takes: texts, ...(signal ? { signal } : {}) });
  if (out.events.length === 0) throw new MindRefused("refused", `${at.state.entities[who]?.name ?? who}'s agent gave no answer LumiRPEngine could read, so nothing was remembered; the scene stays in their working memory.`);
  return land(rt, chatId, userId, at.basis, MIND_WRITE, out, layerEntryId("remember", chatId, who, at.basis.message, at.basis.swipe, takes[0]?.hash ?? "", String(takes.length)), "character");
}

/**
 * Right after a reply (§2.4): each character `who` names (every one holding takes at the basis by
 * default), but those whose scene stays `open`, remembers what it hasn't yet, all at once; each lands
 * as its own entry at the reply's basis. One that fails is reported and keeps its takes; the rest
 * land all the same.
 */
export async function rememberAfterReply(rt: EngineRt, chatId: ChatId, userId: UserId, o: RememberOptions & { who?: readonly EntityId[]; open?: readonly EntityId[] } = {}): Promise<RememberOut> {
  const at = await foldAt(rt, chatId, userId, o.basis);
  const settings = await rt.settings.get(userId);
  const model = o.model ?? portFor(rt, userId);
  const open = new Set(o.open ?? []);
  const who = [...new Set(o.who ?? takersAt(at.state))].filter((id) => !open.has(id) && takesOf(at.state, id).length > 0 && hasAgent(at.world, at.state, id));
  const done = await Promise.all(
    who.map(async (id): Promise<{ who: EntityId; entry: LandResult | null } | { who: EntityId; why: string }> => {
      try {
        return { who: id, entry: await rememberAt(rt, chatId, userId, at, id, settings, model, o.signal) };
      } catch (e) {
        return { who: id, why: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  const out: RememberOut = { remembered: [], entries: [], failed: [] };
  for (const d of done) {
    if ("why" in d) out.failed.push({ who: d.who, why: d.why });
    else if (d.entry) {
      out.remembered.push(d.who);
      out.entries.push(d.entry);
    }
  }
  return out;
}
