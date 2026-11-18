// `world_query` and `world_search` at the quests (plan §8.3, §6.8): the quests' level gives one line of data per quest, a quest named by
// its name, id or ref gives its record whole, and a search by words finds the quests whose names, objectives and stages hold them.
// The tools' own code asks here; nothing is recorded.

import type { JsonObject } from "rp-harness/contract";
import { readEngineSlice } from "../engine/engine-pack";
import { evalExpr, scopeEnv, truthy } from "../engine/scope";
import { currentStage, isTerminal } from "../engine/tracks";
import { hintsEarned, hintsOpened } from "../engine/visibility";
import { objectiveLabel, objectiveWhen, type TrackDef, trackOwner } from "../shared/world";
import type { Call, Reply, StateHit } from "../iface/kit";
import { isFound, type Reading, type ReadingCall } from "../iface/reading";
import { textOf } from "../iface/texts";
import { storySliceOf } from "../story/fold";
import { storyAt } from "../story/path";
import { StoryRecord } from "../story/record";
import { findQuestView, questLine, questRead, questRef, searchQuests } from "./read";
import { openQuests, questSliceOf, questViews } from "./record";
import { trailsOf, withTrails } from "./trail";
import { QUESTS_DEFAULTS } from "./settings";

/** The point of the tree the quests' level is asked at. */
export const QUESTS_POINT = "quests";

/**
 * Where the engine has a quest the world defines: its status (an end stage is done, or failed where a way to fail leads there), when it
 * came to the stage, what the stage's objectives hold now (as the quest log ticks them), the hints earned and opened, and the truths
 * revealed. What today's `quests_tracks` and `quests_stage` answered, none left out.
 */
function engineOf(reading: Reading, id: string, def: TrackDef): JsonObject {
  const world = reading.ctx.world;
  const state = reading.state.world;
  const at = currentStage(world, state, id) ?? def.start;
  const stage = Object.hasOwn(def.stages, at) ? def.stages[at] : undefined;
  const status = isTerminal(def, at) ? (Object.values(def.stages).some((s) => s.fail?.to === at) ? "failed" : "done") : "active";
  const since = Object.hasOwn(state.tracks, id) ? state.tracks[id]?.since : undefined;
  const owner = trackOwner(def);
  const env = scopeEnv({ reg: reading.registry, ctx: reading.ctx, bindings: owner ? { self: owner } : {} });
  const out: JsonObject = { status, ...(since !== undefined && since !== null ? { since } : {}) };
  if ((stage?.objectives ?? []).length > 0) out.objectives = (stage?.objectives ?? []).map((o) => ({ label: objectiveLabel(o), done: truthy(evalExpr(objectiveWhen(o), env, false)) }));
  const earned = hintsEarned(world, state, id);
  if (earned.length > 0) out.hints = { earned, opened: hintsOpened(world, state, id) };
  const revealed = readEngineSlice(state).revealed;
  const shown = (Object.hasOwn(revealed, id) ? revealed[id] : undefined) ?? [];
  const truths = shown.map((s) => (Object.hasOwn(def.stages, s) ? def.stages[s]?.truth : undefined)).filter((x): x is string => typeof x === "string");
  if (truths.length > 0) out.truths_revealed = truths;
  return out;
}

/** The quests as a reading sees them, as the pages see them: the world's tracks and those opened in play, each with the stages it was moved past and why, and which are open. */
function questsOf(call: ReadingCall, reading: Reading) {
  const slice = questSliceOf(reading.state);
  const tracks = reading.doc.tracks;
  const standing = Object.fromEntries(Object.entries(reading.state.world.tracks).map(([id, t]) => [id, t.stage]));
  const views = withTrails(questViews(tracks, slice), tracks, trailsOf(call.deps.store, call.deps.env, call.scope.chat, reading.turn?.id ?? null, tracks, reading.state.world.tracks));
  const open = new Set(openQuests(tracks, slice, standing).map((q) => q.id));
  return { slice, tracks, standing, views, open };
}

/**
 * `world_query` at the quests' level, or at a quest by name, id or ref (not at a place, person or thing that goes by that name): answers
 * on `reply` and returns it; null where `said` asks for anything else, which the tool answers as it always did.
 */
export function queryQuests(call: Call, reading: Reading, reply: Reply, said: unknown): Reply | null {
  if (typeof said !== "string" || said.trim() === "") return null;
  const asked = said.trim();
  const { slice, tracks, standing, views, open } = questsOf(call, reading);
  if (asked.toLowerCase() === QUESTS_POINT) return reply.data({ quests: views.map((q) => questLine(q, open.has(q.id), standing, Object.hasOwn(tracks, q.id) && q.world ? { status: engineOf(reading, q.id, tracks[q.id] as TrackDef).status } : {})) });
  const prefixed = /^(?:quest|track):/.test(asked);
  // A name that is a place, person or thing is theirs; a quest goes by its own.
  if (!prefixed && isFound(reading.find(asked, "point"))) return null;
  const found = findQuestView(views, asked, call.settings.nearMatches);
  if (!("quest" in found)) {
    if (!prefixed) return null;
    return reply.line("unknown", { name: asked, sought: "a quest", near: textOf(found.near) }).fail();
  }
  const view = found.quest;
  const turn = reading.turn;
  const record = new StoryRecord(storyAt(call.deps.store, call.scope.chat, turn?.id ?? null), storySliceOf(reading.state), slice);
  const sources = (call.deps.placeSources?.recordBindings?.(call.scope.user, questRef(view.id)) ?? []).map((b) => ({ entry: b.entry, aspect: b.aspect, title: null as string | null }));
  const settings = { ...QUESTS_DEFAULTS, ...(call.deps.quests ?? {}) };
  const shown: JsonObject = questRead({
    view,
    open: open.has(view.id),
    standing,
    track: Object.hasOwn(tracks, view.id) ? tracks[view.id] : undefined,
    doc: Object.hasOwn(slice.quests, view.id) ? slice.quests[view.id] : undefined,
    slice,
    items: storySliceOf(reading.state).items,
    settings,
    sources,
    engine: view.world && Object.hasOwn(tracks, view.id) ? engineOf(reading, view.id, tracks[view.id] as TrackDef) : {},
    holders: call.deps.questHolders?.(call.scope.user, call.scope.chat, turn?.id ?? null, view.id) ?? [],
    messageOf: (item) => record.beatAt(item),
  });
  return reply.data(shown);
}

/** The quests `world_search` finds for the words, as the search gives its hits. */
export function searchedQuests(call: ReadingCall, reading: Reading, words: string): StateHit[] {
  return searchQuests(questsOf(call, reading).views, words).map((h) => ({ ref: h.ref, name: h.name, what: h.what, matched: h.matched }));
}
