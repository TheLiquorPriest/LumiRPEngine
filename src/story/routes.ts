// The Story page's routes (plan §14, §8.1): a chat's story record, at its newest turn or as it stood
// at one of its turns; and an item of it struck from the page, or its strike taken back. The timeline
// (chapters, scenes and beats, each where it lies in the chat, with the summaries the Author wrote),
// the story model's parts as recorded, the Author's horizon from the store, and the futures (today's
// drafts) apart. Every item comes with the turn that first wrote it, who wrote it (an agent's
// definition, the player, or the migration), whether it is closed or struck, and every write of it on
// the path; struck items are shown, marked. Every route is a page's: it answers only for the user this
// RPE belongs to. A list gives at most the story's own bound (the setting `story.queryItems`) at once,
// the newest of it, and counts what it left out on either side; the page reads further back with
// `part` and `skip`. The horizon is never cut.
//
// A strike is the player's own change, written by the story's own writer on the chat's newest turn,
// the turn the next one follows, as the play panels record a tap there: the item's `drop`, as
// `story_record` strikes, and `drop: false` to take it back. Nothing is struck or restored while a
// turn of the chat runs, since that turn reads the turn a strike is written on, nor in a branch whose
// newest turn is the chat's it was branched from, since a strike written there would change that chat
// too. The words of every refusal are lines of `.prompts/story-answers.md`, as the chat has it.

import type { JsonObject } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import type { Writes } from "../iface/kit";
import { type Fields, type GuidanceFiles } from "../iface/texts";
import { JoinedTurnError, type Store, type UserStore } from "../store";
import { STORY_DEFAULTS, type StoryClock, storyClock, storyLines, type StorySettings, valueView } from "./kit";
import { storyAt } from "./path";
import { type Span, type SpanPart, type StoryItem, StoryRecord, writeStory } from "./record";
import { type StoryAnswer, type StoryItemShown, type StoryList, type StoryListPart, type StoryStrike, type StoryStruck, type StoryWriteShown, storyListPart, storyReply, storyStrikeBody, storyStrikeReply } from "./shapes";

export const STORY_PATH = "/api/v1/chats/:chat/story";
export const STORY_STRIKE_PATH = "/api/v1/chats/:chat/story/strike";

/** Who a change from the page is by: the player, as the store's sources name them and the play panels record their taps. */
const PLAYER = "player";

export interface StoryRoutesDeps {
  /** RPE's store: its database holds the story record, and its state the horizon. */
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /** Whether a turn of the user's chat runs now: nothing is struck or restored while one does. */
  turning(user: string, chat: string): boolean;
  /** The guidance files in force for the chat: the page's words are lines of `.prompts/story-answers.md`. */
  files(user: string, chat: string): GuidanceFiles;
  /** The story's settings for the chat, over `STORY_DEFAULTS`: `queryItems` bounds each list. */
  settings(user: string, chat: string): Promise<Partial<StorySettings>>;
}

/** Why a page's request is not done: its status, and the line of the story's answers that says so. */
class Refused extends Error {
  constructor(
    readonly status: number,
    readonly line: string,
    readonly fields: Fields = {},
  ) {
    super(line);
  }
}

/** Runs a page's request; a refusal is answered in the story's words as the chat has them, none when the user deleted the line. */
async function inWords<T>(deps: StoryRoutesDeps, user: string, chat: string, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    const lines = await storyLines(deps.files(user, chat));
    throw new RouteError(error.status, lines.line(error.line, error.fields) ?? "");
  }
}

/** What a page reads: the record on the path read, story time there, and which turns a migration's import wrote. */
interface Reading {
  s: UserStore;
  record: StoryRecord;
  clock: StoryClock | null;
  imported(turn: string): boolean;
}

/** The record at `turn` of the chat (null: its newest), for a chat the user's store holds. */
function readingAt(store: Store, user: string, chat: string, turn: string | null): Reading {
  const s = store.user(user);
  const known = new Map<string, boolean>();
  return {
    s,
    record: StoryRecord.read(store, user, storyAt(s, chat, turn)),
    clock: storyClock(store, user, chat, turn),
    imported(t) {
      let was = known.get(t);
      if (was === undefined) known.set(t, (was = s.turn(t)?.imported === true));
      return was;
    },
  };
}

/** The user's store, holding the chat the path names. */
function chatHeld(store: Store, user: string, chat: string): UserStore {
  const s = store.user(user);
  if (s.chat(chat) === null) throw new Refused(404, "no_chat", { id: chat });
  return s;
}

/**
 * The turn the query names, one of the chat's (none named: the chat's newest), of a chat the user's store holds. A turn that was
 * joined to another (a continue's held turn) is answered as a fact naming the turn it joined, for the server to answer in its one place.
 */
function asked(store: Store, user: string, chat: string, turn: string | undefined): string | null {
  const s = chatHeld(store, user, chat);
  if (turn === undefined) return null;
  const row = s.turn(turn);
  if (row?.chat !== chat) throw new Refused(404, "no_turn", { id: turn });
  if (row.joined !== null) throw new JoinedTurnError(turn, row.joined);
  return turn;
}

/** A strike as read from the page: the item, whether it is struck or its strike taken back, and why, where the player said. */
interface StrikeAsked {
  id: string;
  struck: boolean;
  why: string | null;
}

/** A strike as the page sends it, in the form the story takes it in: the item without the space around it, and why only where there is some. */
function strikeOf(body: StoryStrike): StrikeAsked {
  return { id: body.id.trim(), struck: body.struck, why: typeof body.why === "string" && body.why.trim() !== "" ? body.why.trim() : null };
}

/**
 * Writes a strike, or takes one back, as the player's on the chat's newest turn, inside one queued write that reads the record it
 * changes. Whether anything was recorded. It is refused in that write while a turn of the chat runs: a continue takes its marks in a
 * write of its own, and a strike that checked before its own write could land after them and be taken back with the continue. It is
 * refused too where that newest turn is another chat's (a branch with no turn of its own yet), since a strike written there would
 * change that chat as well.
 */
function struck(deps: StoryRoutesDeps, user: string, chat: string, ask: StrikeAsked): Promise<boolean> {
  return deps.writes.run(() => {
    if (deps.turning(user, chat)) throw new Refused(409, "page_turning");
    const r = readingAt(deps.store, user, chat, null);
    const item = r.record.items.get(ask.id);
    if (item === undefined) throw new Refused(404, "unknown_id", { id: JSON.stringify(ask.id) });
    if (item.dropped === ask.struck) return false;
    // The item was written on a turn of the chat's path, so the path has a newest turn.
    const turn = r.record.at.turns.at(-1) as string;
    if (r.s.turn(turn)?.chat !== chat) throw new Refused(409, "page_branch_no_turn");
    const value: JsonObject = ask.struck ? { drop: true, ...(ask.why !== null ? { why: ask.why } : {}) } : { drop: false };
    writeStory(deps.store, { user, turn, by: PLAYER, agent: null, job: null, source: "player" }, [{ part: item.part, item: item.id, value }]);
    return true;
  }, "striking an item of the story record from a page");
}

/** An item as the page shows it, lying at `at` in the chat. */
function itemShown(r: Reading, item: StoryItem, at: Span | null): StoryItemShown {
  return {
    id: item.id,
    part: item.part,
    fields: valueView(r.record, item.fields, r.clock),
    from: at?.from ?? null,
    to: at?.to ?? null,
    turn: item.opened,
    message: r.record.at.replyOf(item.opened),
    imported: r.imported(item.opened),
    by: item.rows[0]?.by ?? null,
    closed: item.closedBy !== null,
    struck: item.dropped,
    writes: item.rows.map((row): StoryWriteShown => ({ turn: row.turn, message: r.record.at.replyOf(row.turn), imported: r.imported(row.turn), by: row.by, wrote: valueView(r.record, row.value, r.clock) })),
  };
}

/** Where each item of a part lies in the chat: a beat's messages; a scene's or a chapter's span, one struck from where it starts to the last message it names. Null for the other parts. */
function placesOf(record: StoryRecord, part: StoryListPart): (item: StoryItem) => Span | null {
  if (part === "beat") return (beat) => record.beatSpan(beat);
  if (part !== "chapter" && part !== "scene") return () => null;
  const spans = record.spans(part);
  return (item) => spans.get(item.id) ?? { from: record.startOf(item), to: record.numberOf(item.fields.last) };
}

/** A part's items, struck ones among them, each where it lies: the timeline's by where they start, what cannot be placed last; the others as first written. */
function listOf(r: Reading, part: StoryListPart): { item: StoryItem; at: Span | null }[] {
  const place = placesOf(r.record, part);
  const all = r.record.of(part, true).map((item, n) => ({ item, at: place(item), n }));
  // As the record places its own spans: by where each starts, then as first written.
  if (part === "beat" || part === "chapter" || part === "scene") all.sort((a, b) => (a.at?.from ?? Number.POSITIVE_INFINITY) - (b.at?.from ?? Number.POSITIVE_INFINITY) || a.n - b.n);
  return all;
}

/** The newest `size` of a list after passing over its newest `skip`, with what was left out on either side. */
function bounded(r: Reading, list: readonly { item: StoryItem; at: Span | null }[], size: number, skip: number): StoryList {
  const end = Math.max(0, list.length - skip);
  const start = Math.max(0, end - size);
  return { items: list.slice(start, end).map(({ item, at }) => itemShown(r, item, at)), total: list.length, before: start, after: list.length - end };
}

/** The scene or chapter the chat is in now: the current one while it is open. */
function openNow(record: StoryRecord, part: SpanPart): string | null {
  const current = record.current(part);
  return current !== null && current.closedBy === null ? current.id : null;
}

export function storyRoutes(deps: StoryRoutesDeps) {
  return [
    route({
      method: "GET",
      path: STORY_PATH,
      access: "page",
      group: "story",
      does: "A chat's story record, at its newest turn or as it stood at one of its turns: the timeline, the story model's parts, the Author's horizon and the futures; each list bounded by the story's own setting, read further back with `part` and `skip`.",
      query: {
        turn: shape.optional(shape.turnId(), "A turn's id: the record as it stood at that turn; left out, at the chat's newest."),
        part: shape.optional(storyListPart, "Read this list further back: with no part named, every list."),
        skip: shape.optional(shape.whole({ least: 0 }), "How many of a list's newest items to pass over; 0 when left out."),
      },
      reply: storyReply,
      joined: true,
      handle: ({ user, params, query }) =>
        inWords(deps, user, params.chat, async (): Promise<StoryAnswer> => {
          const turn = asked(deps.store, user, params.chat, query.turn);
          const part = query.part ?? null;
          const skip = query.skip ?? 0;
          const size = { ...STORY_DEFAULTS, ...(await deps.settings(user, params.chat)) }.queryItems;
          const r = readingAt(deps.store, user, params.chat, turn);
          const list = (p: StoryListPart): StoryList => bounded(r, listOf(r, p), size, part === null || part === p ? skip : 0);
          const premise = r.record.of("premise", true)[0];
          const view = turn === null ? r.s.view(params.chat) : r.s.viewAt(turn);
          return {
            chat: params.chat,
            turn,
            now: r.clock === null ? null : r.clock.text(r.clock.now),
            listed: size,
            timeline: { chapter: list("chapter"), scene: list("scene"), beat: list("beat") },
            current: { chapter: openNow(r.record, "chapter"), scene: openNow(r.record, "scene") },
            model: { premise: premise === undefined ? null : itemShown(r, premise, null), thread: list("thread"), arc: list("arc"), player: list("player"), canon: list("canon"), retcon: list("retcon"), record: list("record") },
            horizon: view.horizon(),
            futures: list("future"),
          };
        }),
    }),
    route({
      method: "POST",
      path: STORY_STRIKE_PATH,
      access: "page",
      group: "story",
      does: "Strikes an item of the story record, or takes its strike back, as the player's own change on the chat's newest turn; says whether anything was recorded and the item as it stands.",
      body: storyStrikeBody,
      reply: storyStrikeReply,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, async (): Promise<StoryStruck> => {
          chatHeld(deps.store, user, params.chat);
          const ask = strikeOf(body);
          const changed = await struck(deps, user, params.chat, ask);
          const r = readingAt(deps.store, user, params.chat, null);
          const item = r.record.items.get(ask.id) as StoryItem;
          return { changed, item: itemShown(r, item, item.part === "premise" ? null : placesOf(r.record, item.part)(item)) };
        }),
    }),
  ] as const;
}
