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
// A strike and a correction are the player's own change, written by the story's own writer as his: they belong to no turn, are
// placed after the newest reply on the chat's own line (a fresh branch's included) and so stay when that reply is swiped, and are
// made while a turn runs too: that turn goes on from the state it started with. A correction sets any field of any item, read as
// `story_record` reads the same fields of its part; a strike is the item's `drop`, and `drop: false` takes it back. The timeline
// route pages chapters, scenes and beats as one list in the chat's order; the coverage route tells every stretch of the chat the
// record covers or not, in and out of the prompt's window; the story-so-far route gives the block as the next briefing does.
// The words of every refusal are lines of `.prompts/story-answers.md`, as the chat has it.

import type { JsonObject } from "rp-harness/contract";
import { type FormProblem, route, RouteError, shape } from "../app";
import type { Writes } from "../iface/kit";
import { type Fields, type GuidanceFiles, textOf } from "../iface/texts";
import { JoinedTurnError, type Store, type UserStore } from "../store";
import { coverageOf } from "./cover";
import { STORY_DEFAULTS, type StoryClock, placeRefOf, storyClock, storyLines, type StorySettings, valueView } from "./kit";
import { storyAt } from "./path";
import { type Span, type SpanPart, type StoryItem, StoryRecord, writeStory } from "./record";
import type { StorySoFar } from "./sofar/index";
import {
  type StoryAnswer,
  type StoryCorrect,
  type StoryCorrected,
  type StoryCoverageAnswer,
  type StoryItemShown,
  type StoryList,
  type StoryListPart,
  type StorySoFarAnswer,
  type StoryStrike,
  type StoryStruck,
  type StoryTimelinePage,
  type StoryTimelineRow,
  type StoryWriteShown,
  storyCorrectBody,
  storyCorrectReply,
  storyCoverageReply,
  storyListPart,
  storyReply,
  storySoFarReply,
  storyStrikeBody,
  storyStrikeReply,
  storyTimelineReply,
} from "./shapes";
import { readCorrection } from "./write";

export const STORY_PATH = "/api/v1/chats/:chat/story";
export const STORY_STRIKE_PATH = "/api/v1/chats/:chat/story/strike";
export const STORY_CORRECT_PATH = "/api/v1/chats/:chat/story/correct";
export const STORY_TIMELINE_PATH = "/api/v1/chats/:chat/story/timeline";
export const STORY_COVERAGE_PATH = "/api/v1/chats/:chat/story/coverage";
export const STORY_SO_FAR_PATH = "/api/v1/chats/:chat/story/so-far";

/** Who a change from the page is by: the player, as the store's sources name them and the play panels record their taps. */
const PLAYER = "player";

export interface StoryRoutesDeps {
  /** RPE's store: its database holds the story record, and its state the horizon. */
  store: Store;
  /** The application's write queue: every write goes through it. */
  writes: Writes;
  /**
   * The prompt's window for the chat as the last prompt put it: the id of the first history message it keeps (null: it keeps them
   * all, or no prompt was made yet), and whether agents may read the messages the player hid. Left out, the window is not known
   * and the coverage route tells every stretch as inside it.
   */
  window?(user: string, chat: string): Promise<{ edge: string | null; hiddenReadable: boolean }>;
  /** The story so far worked out at the chat's head as the next briefing works it out. Left out, the story-so-far route says it is not worked out here. */
  soFar?(user: string, chat: string): Promise<StorySoFar>;
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

/** The form's refusal of a page's query or body, in the story's words as the chat has them: a field it could not read, one it does not take, a page asked larger than the route gives, or a cursor that is not the list's. */
function formWords(deps: StoryRoutesDeps) {
  const line = { unreadable: "unreadable", not_taken: "page_not_taken", page_size: "page_size", cursor: "page_cursor" } as const;
  return async (problem: FormProblem, { user, params }: { user: string; params: { readonly chat: string } }): Promise<string> => {
    const fields: Fields = { field: problem.field, ...(problem.value !== undefined ? { value: JSON.stringify(problem.value) } : {}), ...(problem.choices.length > 0 ? { choices: textOf(problem.choices) } : {}), ...(problem.most !== undefined ? { most: String(problem.most) } : {}) };
    return (await storyLines(deps.files(user, params.chat))).line(line[problem.kind], fields) ?? "";
  };
}

/** What a page reads: the record on the path read, story time there, and which turns a migration's import wrote. */
interface Reading {
  s: UserStore;
  record: StoryRecord;
  clock: StoryClock | null;
  imported(turn: string): boolean;
}

/** The record at `turn` of the chat (null: its newest); a chat the user's store does not hold reads as an untouched one. */
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

/** The user's store, holding the chat the path names: for a change of it, whose route took the chat on first. */
function chatHeld(store: Store, user: string, chat: string): UserStore {
  const s = store.user(user);
  if (s.chat(chat) === null) throw new Refused(404, "no_chat", { id: chat });
  return s;
}

/**
 * The turn the query names, one of the chat's (none named: the chat's newest); a chat the user's store does not hold has none. A turn
 * that was joined to another (a continue's held turn) is answered as a fact naming the turn it joined, for the server to answer in its one place.
 */
function asked(store: Store, user: string, chat: string, turn: string | undefined): string | null {
  const s = store.user(user);
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

/** Writes one write of an item as the player's own change: no turn's, after the chat's newest reply on its own line, whatever runs. */
function playerWrite(deps: StoryRoutesDeps, user: string, chat: string, item: StoryItem, value: JsonObject): void {
  writeStory(deps.store, { user, chat, turn: null, by: PLAYER, agent: null, job: null, source: "player" }, [{ part: item.part, item: item.id, value }]);
}

/** Writes a strike, or takes one back, as the player's own change, inside one queued write that reads the record it changes. Whether anything was recorded. */
function struck(deps: StoryRoutesDeps, user: string, chat: string, ask: StrikeAsked): Promise<boolean> {
  return deps.writes.run(() => {
    const r = readingAt(deps.store, user, chat, null);
    const item = r.record.items.get(ask.id);
    if (item === undefined) throw new Refused(404, "unknown_id", { id: JSON.stringify(ask.id) });
    if (item.dropped === ask.struck) return false;
    playerWrite(deps, user, chat, item, ask.struck ? { drop: true, ...(ask.why !== null ? { why: ask.why } : {}) } : { drop: false });
    return true;
  }, "striking an item of the story record from a page");
}

/** Writes a correction of an item's fields as the player's own change; the lines that say what of it was not read. */
async function corrected(deps: StoryRoutesDeps, user: string, chat: string, ask: StoryCorrect): Promise<string[]> {
  const lines = await storyLines(deps.files(user, chat));
  return deps.writes.run(() => {
    const r = readingAt(deps.store, user, chat, null);
    const item = r.record.items.get(ask.id.trim());
    if (item === undefined) throw new Refused(404, "unknown_id", { id: JSON.stringify(ask.id) });
    const view = r.s.view(chat);
    const read = readCorrection({ record: r.record, clock: r.clock, lines, placeRef: (words) => placeRefOf(view, words) }, item, ask.fields);
    if ("refused" in read) throw new Refused(400, read.refused.line, read.refused.fields);
    playerWrite(deps, user, chat, item, read.value);
    return read.said;
  }, "correcting an item of the story record from a page");
}

/** A row of the timeline before it is shown: the item, where it lies, and the chapter and scene around it. */
interface TimelineEntry {
  kind: "chapter" | "scene" | "beat";
  rank: number;
  item: StoryItem;
  at: Span | null;
  n: number;
}

/** Every chapter, scene and beat of the record, struck ones among them, in the chat's order: by where each starts, a chapter before a scene before a beat, then as first written; what cannot be placed last. */
function timelineEntries(record: StoryRecord): TimelineEntry[] {
  const entries = (["chapter", "scene", "beat"] as const).flatMap((kind, rank) => {
    const place = placesOf(record, kind);
    return record.of(kind, true).map((item, n): TimelineEntry => ({ kind, rank, item, at: place(item), n }));
  });
  return entries.sort((a, b) => (a.at?.from ?? Number.POSITIVE_INFINITY) - (b.at?.from ?? Number.POSITIVE_INFINITY) || a.rank - b.rank || a.n - b.n);
}

/** The id of the one of `stretches` that lies around message `at`: the last to start at or before it that reaches it. */
function around(stretches: readonly { id: string; from: number; to: number | null }[], at: number | null): string | null {
  if (at === null) return null;
  let found: string | null = null;
  for (const s of stretches) if (s.from <= at && (s.to === null || at <= s.to)) found = s.id;
  return found;
}

/** One page of the timeline: the entries after the one named (the first, none named), each with the chapter and scene around it and a beat's messages. */
function timelinePage(r: Reading, after: string | undefined, limit: number): StoryTimelinePage {
  const all = timelineEntries(r.record);
  const start = after === undefined ? 0 : all.findIndex((e) => e.item.id === after) + 1;
  if (start === 0 && after !== undefined) throw new Refused(409, "timeline_gone", { id: JSON.stringify(after) });
  const page = all.slice(start, start + limit);
  const stretches = (kind: "chapter" | "scene") => all.flatMap((e) => (e.kind === kind && e.at?.from != null ? [{ id: e.item.id, from: e.at.from, to: e.at.to }] : []));
  const chapters = stretches("chapter");
  const scenes = stretches("scene");
  const messages = r.record.at.messages;
  const items = page.map((e): StoryTimelineRow => {
    const from = e.at?.from ?? null;
    const held = e.kind === "beat" && from !== null ? Array.from({ length: (e.at?.to ?? from) - from + 1 }, (_, i) => ({ number: from + i, id: messages[from + i]?.message ?? "" })) : [];
    return {
      kind: e.kind,
      item: itemShown(r, e.item, e.at),
      chapter: e.kind === "chapter" ? null : around(chapters, from),
      scene: e.kind === "beat" ? around(scenes, from) : null,
      messages: held.filter((m) => m.id !== ""),
    };
  });
  const last = page.at(-1);
  return { items, next: last !== undefined && start + page.length < all.length ? last.item.id : null };
}

/** What the record covers of the whole chat, with the prompt's window and the count above its edge. */
function coverageAnswer(r: Reading, chat: string, window: { edge: string | null; hiddenReadable: boolean }): StoryCoverageAnswer {
  const messages = r.record.at.messages;
  const coverage = coverageOf(r.record);
  const found = window.edge === null ? -1 : messages.findIndex((m) => m.message === window.edge);
  const edge = found < 0 ? null : found;
  const hidden = messages.flatMap((m, i) => (m.hidden ? [i] : []));
  // Above the edge, a message the record does not cover is counted, a hidden one only where agents may read what the player hid.
  const above = edge === null ? 0 : messages.slice(0, edge).filter((m) => !coverage.covered.has(m.message) && (window.hiddenReadable || !m.hidden)).length;
  const stretches = coverage.stretches.flatMap((s) => {
    const mark = { covered: s.covered, beats: s.beats, summarized: s.summarized };
    if (edge === null || s.to < edge) return [{ from: s.from, to: s.to, ...mark, window: edge === null }];
    if (s.from >= edge) return [{ from: s.from, to: s.to, ...mark, window: true }];
    return [
      { from: s.from, to: edge - 1, ...mark, window: false },
      { from: edge, to: s.to, ...mark, window: true },
    ];
  });
  return { chat, messages: messages.length, edge, hiddenReadable: window.hiddenReadable, hidden, above, stretches };
}

/** An item as the page shows it, lying at `at` in the chat. */
function itemShown(r: Reading, item: StoryItem, at: Span | null): StoryItemShown {
  return {
    id: item.id,
    part: item.part,
    fields: valueView(r.record, item.fields, r.clock),
    from: at?.from ?? null,
    to: at?.to ?? null,
    turn: item.opened === "" ? null : item.opened,
    message: r.record.at.replyOf(item.opened),
    imported: r.imported(item.opened),
    by: item.rows[0]?.by ?? null,
    closed: item.closedBy !== null,
    struck: item.dropped,
    writes: item.rows.map((row): StoryWriteShown => ({ turn: row.turn === "" ? null : row.turn, message: r.record.at.replyOf(row.turn), imported: r.imported(row.turn), by: row.by, wrote: valueView(r.record, row.value, r.clock) })),
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
  /** A page of the timeline holds the story's own bound of items (`story.queryItems`) unless the caller asks for fewer; at most ten times that. */
  const sizes = async ({ params, user }: { params: Readonly<Record<string, string>>; user: string | null }): Promise<{ default: number; most: number }> => {
    const size = { ...STORY_DEFAULTS, ...(user === null ? {} : await deps.settings(user, params.chat ?? "")) }.queryItems;
    return { default: size, most: size * 10 };
  };
  const refusal = formWords(deps);
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
      refusal,
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
            horizon: r.record.horizon.map((h) => {
              const ref = view.resolve(h.at);
              return { at: h.at, ref, name: ref === null ? null : view.nameOf(ref), depth: h.depth };
            }),
            futures: list("future"),
          };
        }),
    }),
    route({
      method: "POST",
      path: STORY_CORRECT_PATH,
      access: "page",
      group: "story",
      does: "Corrects any field of any item of the story record (a beat's text, a thread's state, a summary, the premise, a reading of the player), read as `story_record` reads the same fields of its part, as the player's own change placed after the chat's newest reply on its own line: swiping that reply keeps it, a turn that is running goes on from the state it started with, and a fresh branch takes it on its own line. Says what of it could not be read and the item as it stands.",
      body: storyCorrectBody,
      reply: storyCorrectReply,
      refusal,
      handle: ({ user, params, body }) =>
        inWords(deps, user, params.chat, async (): Promise<StoryCorrected> => {
          chatHeld(deps.store, user, params.chat);
          const said = await corrected(deps, user, params.chat, body);
          const r = readingAt(deps.store, user, params.chat, null);
          const item = r.record.items.get(body.id.trim()) as StoryItem;
          return { changed: true, said, item: itemShown(r, item, item.part === "premise" ? null : placesOf(r.record, item.part)(item)) };
        }),
    }),
    route({
      method: "GET",
      path: STORY_TIMELINE_PATH,
      access: "page",
      group: "story",
      does: "The chat's chapters, scenes and beats as one list in the chat's order, oldest first, a page at a time: each with the chapter and the scene it lies in, and a beat with the messages it stands for, by number and id.",
      reply: storyTimelineReply,
      paged: { sizes },
      refusal,
      handle: ({ user, params, query }) =>
        inWords(deps, user, params.chat, (): StoryTimelinePage => {
          return timelinePage(readingAt(deps.store, user, params.chat, null), query.after, query.limit);
        }),
    }),
    route({
      method: "GET",
      path: STORY_COVERAGE_PATH,
      access: "page",
      group: "story",
      does: "What the record covers of the whole chat: every stretch of messages with the same marks, in and out of the prompt's window, each hidden message, the window's edge, and how many messages above that edge the record does not cover.",
      reply: storyCoverageReply,
      refusal,
      handle: ({ user, params }) =>
        inWords(deps, user, params.chat, async (): Promise<StoryCoverageAnswer> => {
          const window = (await deps.window?.(user, params.chat)) ?? { edge: null, hiddenReadable: false };
          return coverageAnswer(readingAt(deps.store, user, params.chat, null), params.chat, window);
        }),
    }),
    route({
      method: "GET",
      path: STORY_SO_FAR_PATH,
      access: "page",
      group: "story",
      does: "The story so far as the next briefing gives it to the Author, worked out at the chat's head: its text, its size against its budget, and each stretch it had no room for.",
      reply: storySoFarReply,
      refusal,
      handle: ({ user, params }) =>
        inWords(deps, user, params.chat, async (): Promise<StorySoFarAnswer> => {
          if (deps.soFar === undefined) throw new Refused(404, "so_far_unavailable");
          const { text, tokens, budget, leftOut } = await deps.soFar(user, params.chat);
          return { text, tokens, budget, leftOut };
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
      refusal,
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
