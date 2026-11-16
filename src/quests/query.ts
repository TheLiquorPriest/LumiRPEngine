// `world_query` and `world_search` at the quests (plan §8.3, §6.8): the quests' level gives one line of data per quest, a quest named by
// its name, id or ref gives its record whole, and a search by words finds the quests whose names, objectives and stages hold them.
// The tools' own code asks here; nothing is recorded.

import type { JsonObject } from "rp-harness/contract";
import type { Call, Reply, StateHit } from "../iface/kit";
import { isFound, type Reading } from "../iface/reading";
import { textOf } from "../iface/texts";
import { storySliceOf } from "../story/fold";
import { storyAt } from "../story/path";
import { StoryRecord } from "../story/record";
import { findQuestView, questLine, questRead, questRef, searchQuests } from "./read";
import { openQuests, questSliceOf, questViews } from "./record";
import { QUESTS_DEFAULTS } from "./settings";

/** The point of the tree the quests' level is asked at. */
export const QUESTS_POINT = "quests";

/** The quests as a reading sees them: the world's tracks and those opened in play, and which are open. */
function questsOf(reading: Reading) {
  const slice = questSliceOf(reading.state);
  const tracks = reading.doc.tracks;
  const standing = Object.fromEntries(Object.entries(reading.state.world.tracks).map(([id, t]) => [id, t.stage]));
  const views = questViews(tracks, slice);
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
  const { slice, tracks, standing, views, open } = questsOf(reading);
  if (asked.toLowerCase() === QUESTS_POINT) return reply.data({ quests: views.map((q) => questLine(q, open.has(q.id), standing)) });
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
    messageOf: (item) => record.beatAt(item),
  });
  return reply.data(shown);
}

/** The quests `world_search` finds for the words, as the search gives its hits. */
export function searchedQuests(reading: Reading, words: string): StateHit[] {
  return searchQuests(questsOf(reading).views, words).map((h) => ({ ref: h.ref, name: h.name, what: h.what, matched: h.matched }));
}
