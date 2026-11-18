// The Quests page's routes (plan §8.3, §14): the player's journal, at the chat's newest turn or as it stood at one of its turns; the
// chat's quests in brief, a page at a time; and one quest in full with its history. The journal draws only what the player may see;
// the records give all of it (the Quests page keeps them behind its spoiler gate). Every route is a page's: it answers only for the
// user this RPE belongs to. The words of every refusal are lines of `.prompts/story-answers.md`, as the chat has them.

import { route, RouteError, shape } from "../app";
import { trackKnown } from "../engine/visibility";
import type { GuidanceFiles } from "../iface/texts";
import type { TrackDef } from "../shared/world";
import { JoinedTurnError, type Store, type UserStore } from "../store";
import { storySliceOf } from "../story/fold";
import { storyLines, type StorySettings } from "../story/kit";
import { QUESTS_DEFAULTS, type QuestsSettings } from "./settings";
import { journalOf, recordOf } from "./journal";
import { findQuest, openQuests, type QuestView, questSliceOf, questViews } from "./record";
import { threadClosedAt } from "./thread";
import { movesAsHistory, type QuestTrails, trailsOf, withTrails } from "./trail";
import { type JournalAnswer, journalReply, type QuestAnswer, type QuestsPage, questReply, questsReply } from "./shapes";

export const JOURNAL_PATH = "/api/v1/chats/:chat/journal";
export const QUESTS_PATH = "/api/v1/chats/:chat/quests";
export const QUEST_PATH = "/api/v1/chats/:chat/quests/:quest";

export interface QuestRoutesDeps {
  store: Store;
  /** The guidance files in force for the chat: the page's words are lines of `.prompts/story-answers.md`. */
  files(user: string, chat: string): GuidanceFiles;
  /** The story's settings for the chat, over `STORY_DEFAULTS`. */
  settings(user: string, chat: string): Promise<Partial<StorySettings>>;
  /** The quests' settings for the chat, over `QUESTS_DEFAULTS`: `page` bounds a page of the records. Left out, the defaults. */
  quests?(user: string, chat: string): Promise<Partial<QuestsSettings>>;
  /**
   * Whether the player's character knows a quest the world made known to some, where the application has a rule of its own for it. Left out,
   * the world's own rule reads it from the state at the point read (`trackKnown`): the quest's owner, whoever knows the owner, whoever its
   * `knownBy` matches.
   */
  knows?(user: string, chat: string, quest: string): boolean;
}

/** Why a page's request is not done: its status, and the line of the story's answers that says so. */
async function refuse(deps: QuestRoutesDeps, user: string, chat: string, status: number, line: string, fields: Record<string, string | number>): Promise<never> {
  const lines = await storyLines(deps.files(user, chat));
  throw new RouteError(status, lines.line(line, fields) ?? "");
}

/** The chat's quests as they stand at the newest turn (`turn` null) or at one of its turns, with what the world's tracks stand on. */
interface Standing {
  views: QuestView[];
  open: ReadonlySet<string>;
  standing: Record<string, string>;
  tracks: Readonly<Record<string, TrackDef>>;
  /** How each world quest that has moved was moved, from the ledger (`trail.ts`). */
  trails: QuestTrails;
  /** Whether the player's character knows a quest the world made known to some, at the point read, by the world's own rule. */
  knows(quest: string): boolean;
}

async function standingAt(deps: QuestRoutesDeps, user: string, chat: string, turn: string | null): Promise<Standing> {
  const s: UserStore = deps.store.user(user);
  // A chat RPE does not hold reads as an untouched one.
  const row = s.chatOrUntouched(chat);
  if (turn !== null) {
    const t = s.turn(turn);
    if (t?.chat !== chat) return refuse(deps, user, chat, 404, "no_turn", { id: turn });
    if (t.joined !== null) throw new JoinedTurnError(turn, t.joined);
  }
  const folded = turn === null ? s.headState(chat) : s.stateAt(turn);
  const doc = row.revision === null ? undefined : deps.store.env.worlds(row.revision);
  const tracks = doc?.tracks ?? {};
  const standing = Object.fromEntries(Object.entries(folded.state.world.tracks).map(([id, t]) => [id, t.stage]));
  const slice = questSliceOf(folded.state);
  const knows = (quest: string): boolean => {
    const track = Object.hasOwn(tracks, quest) ? tracks[quest] : undefined;
    return doc !== undefined && track !== undefined && trackKnown(deps.store.env.registry, doc, folded.state.world, doc.pov, track);
  };
  const trails = trailsOf(s, deps.store.env, chat, turn, tracks, folded.state.world.tracks);
  return { views: withTrails(questViews(tracks, slice), tracks, trails), open: new Set(openQuests(tracks, slice, standing).map((q) => q.id)), standing, tracks, trails, knows };
}

export function questRoutes(deps: QuestRoutesDeps) {
  /** A page of quests holds the quests' own bound (`quests.page`) unless the caller asks for fewer; at most ten times that. */
  const sizes = async ({ params, user }: { params: Readonly<Record<string, string>>; user: string | null }): Promise<{ default: number; most: number }> => {
    const size = { ...QUESTS_DEFAULTS, ...(user === null || deps.quests === undefined ? {} : await deps.quests(user, params.chat ?? "")) }.page;
    return { default: size, most: size * 10 };
  };
  return [
    route({
      method: "GET",
      path: JOURNAL_PATH,
      access: "page",
      group: "quests",
      does: "The player's journal: each quest he may see, at the chat's newest turn or as it stood at one of its turns, with the stages he may see, each with what the Author called on it and why. A quest the Author set to show him nothing is absent, with no count.",
      query: { turn: shape.optional(shape.turnId(), "A turn's id: the journal as it stood at that turn; left out, at the chat's newest.") },
      reply: journalReply,
      joined: true,
      handle: async ({ user, params, query }): Promise<JournalAnswer> => {
        const turn = query.turn ?? null;
        const at = await standingAt(deps, user, params.chat, turn);
        const quests = journalOf(at.views, at.standing, (v) => deps.knows?.(user, params.chat, v.id) ?? at.knows(v.id));
        return { chat: params.chat, turn, open: quests.filter((q) => at.open.has(q.id)).length, quests };
      },
    }),
    route({
      method: "GET",
      path: QUESTS_PATH,
      access: "page",
      group: "quests",
      does: "The chat's quests, the world's and those opened in play, in brief, a page at a time: each with what it is, its stages and what was called on them, who and where, its stakes, how it was shown to the player and whether it is open.",
      reply: questsReply,
      paged: { sizes },
      handle: async ({ user, params, query }): Promise<QuestsPage> => {
        const at = await standingAt(deps, user, params.chat, null);
        const start = query.after === undefined ? 0 : at.views.findIndex((q) => q.id === query.after) + 1;
        if (start === 0 && query.after !== undefined) return refuse(deps, user, params.chat, 409, "quest_gone", { id: query.after });
        const page = at.views.slice(start, start + query.limit);
        const last = page.at(-1);
        return { items: page.map((q) => recordOf(q, at.standing, at.open.has(q.id))), next: last !== undefined && start + page.length < at.views.length ? last.id : null };
      },
    }),
    route({
      method: "GET",
      path: QUEST_PATH,
      access: "page",
      group: "quests",
      does: "One quest of the chat in full, by its id or its name: its record, and every write made to it in the order made.",
      reply: questReply,
      handle: async ({ user, params }): Promise<QuestAnswer> => {
        const at = await standingAt(deps, user, params.chat, null);
        const state = deps.store.user(user).headState(params.chat).state;
        const slice = questSliceOf(state);
        const found = at.views.find((q) => q.id === params.quest) ?? at.views.find((q) => q.id === findQuest(slice, params.quest)?.id) ?? at.views.find((q) => q.name.toLowerCase() === params.quest.toLowerCase());
        if (found === undefined) return refuse(deps, user, params.chat, 404, "no_quest", { id: params.quest });
        const doc = slice.quests[found.id];
        const rows = (doc?.rows ?? []).map((r) => ({ n: r.n, turn: r.turn === "" ? null : r.turn, by: r.by, op: r.op, value: r.value }));
        // The turn its thread closed is in its history (R-169), where the thread is closed on this path.
        const thread = doc?.thread == null ? undefined : storySliceOf(state).items[doc.thread];
        const closed = thread === undefined ? null : threadClosedAt(thread);
        const moved = movesAsHistory(at.trails[found.id] ?? []);
        const history = [...rows, ...moved, ...(thread === undefined || closed === null ? [] : [{ n: closed.n, turn: closed.turn, by: null, op: "thread_closed", value: { thread: thread.id } }])].sort((a, b) => a.n - b.n).map(({ n: _n, ...r }) => r);
        return { quest: recordOf(found, at.standing, at.open.has(found.id)), history };
      },
    }),
  ] as const;
}
