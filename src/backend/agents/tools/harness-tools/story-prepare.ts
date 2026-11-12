// The prepared start's tools (DEPTH2-PLAN §1.11; `backend/story/prepare.ts`). The author surveys what
// there is to draw on, writes a plan before anything is spent, opens the stretches of the chat it
// chose to be relived, writes what each principal knows in outline, and closes the preparation; the
// historian reads an open stretch and records it as beats marked as recorded from the past. Each is a
// call one of them chose: nothing here runs a step for them.
//
// What matters is held here, not in a prompt: nothing is relived while the plan waits for the
// player's word, or past their cap on what reliving may spend; stretches are relived in the chat's
// order, so a mind takes in its past as it happened; no more principals have reliving outstanding at
// once than the player allows; a stretch is no longer than one historian run reads; a past beat
// carries its mark and a story time the world's calendar reads, and names whom it reached; and the
// preparation finishes only once it holds what a first turn needs.

import { AUTHOR_FILE, HARNESS_NOTE } from "../../../../shared/harness-texts";
import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import { PREPARE_NOTE, PREPARE_PATH, PREPARE_STORY, PREPARE_TOOL } from "../../../../shared/harness-texts-prepare";
import { RECORD_NOTE } from "../../../../shared/harness-texts-record";
import { hashParts } from "../../../../shared/hash";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { PREPARE_DEPTHS, type PrepareDepth } from "../../../../shared/story-pages";
import { BEAT_KINDS, BEAT_REACHES, type Beat, type Exposure } from "../../../../shared/ledger";
import { loreSourceOf } from "../../../../shared/lore";
import { calendarOf, clockOfStamp, formatStamp, placeOffset } from "../../../../engine/calendar";
import { own } from "../../../../engine/pack-kit";
import { isGone, placeOfEntity } from "../../../../engine/scope";
import { beatProblem, type StoryProblemCode } from "../../../../engine/story/checks";
import { storyName } from "../../../../engine/story/feed";
import type { StoryPath } from "../../../../engine/story/record";
import { readSlice } from "../../../../packs/minds/core/state";
import { bookEntryTitle } from "../../../book-lore";
import { type ChatRead, chatRead } from "../../../chat-read";
import type { HostBookEntry, HostMessage } from "../../../host";
import { renderPrompt } from "../../../prompts";
import { mindPath } from "../../../story/minds";
import { CALL_NOTE, callWeight, chatKind, DEPTH_NOTE, depthOf, depthsOffered, estimateOf, logPrepare, messageTokens, planned, planStretches, preparationLeft, type PrepareFile, type PrepareState, type PrepareStretch, readPrepare, reachedBy, reckonLeft, relivingNow, spanOf, stillToRelive, type StretchAsked, stretchMessages, stretchStands, SURVEY_PARTS, unanswered, unplanned, type Updated, updatePrepare, waits, withRelived, within, wordFor } from "../../../story/prepare";
import type { StoryRefusal } from "../../../story/record";
import type { ToolOutcome } from "../../runtime";
import type { HarnessFiles } from "../harness-ports";
import type { HarnessTurn } from "../harness-turn";
import { boolArg, missing } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { resolvePerson, resolvePlace } from "../resolve";
import { badValue, integer, intArg, jsonTextOf, needText, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, list, words } from "./kit";

const T = PREPARE_TOOL;

/** What a preparing tool works with: the view of the chat's head, the call's turn, and the chat's workspace; or the answer that says which is missing. */
async function prepared(env: ToolEnv): Promise<{ view: ToolReadView; turn: HarnessTurn; files: HarnessFiles } | ToolOutcome> {
  const view = await env.reader.view();
  if (!env.turn) return view.refuse(HARNESS_NOTE.noTurn);
  if (!env.files) return view.refuse(PREPARE_NOTE.noFiles);
  return { view, turn: env.turn, files: env.files };
}

/** How a tool that reads nothing of the chat answers: as a view does, in the user's own words. */
type Words = Pick<ToolReadView, "answer" | "refuse" | "text">;

/** What a preparing tool that reads only the file works with: the call's turn, the chat's workspace, and its words; or the answer that says which is missing. */
async function preparedWords(env: ToolEnv): Promise<{ words: Words; turn: HarnessTurn; files: HarnessFiles } | ToolOutcome> {
  if (!env.turn) return (await env.reader.view()).refuse(HARNESS_NOTE.noTurn);
  const { texts } = env.turn.settings.prompts;
  const words: Words = { answer: (value) => ({ text: JSON.stringify(value) }), refuse: (id, vars = {}) => ({ text: renderPrompt(id, texts, vars), error: true }), text: (id, vars = {}) => renderPrompt(id, texts, vars) };
  if (!env.files) return words.refuse(PREPARE_NOTE.noFiles);
  return { words, turn: env.turn, files: env.files };
}

/** The chat as the call reads it: the run's read of it, kept until the chat changes (`chatRead`). */
function chatOf(env: ToolEnv, turn: HarnessTurn): Promise<ChatRead> {
  return chatRead(turn.host, env, turn.settings.agents.kept.chatMs);
}

/** The preparation as its file holds it; or the answer for a file with no plan yet (it may hold only what the player said before one), or one whose record can't be read. */
function planIn(view: Pick<ToolReadView, "refuse">, file: PrepareFile): PrepareState | ToolOutcome {
  if (file.damaged) return view.refuse(PREPARE_NOTE.damaged);
  return file.state !== null && planned(file.state) ? file.state : view.refuse(PREPARE_NOTE.noPlan);
}

/** The answer while the player told the author something it hasn't answered: the plan is written again first; null where there is nothing. */
function wordsFirst(view: Pick<ToolReadView, "refuse">, state: PrepareState): ToolOutcome | null {
  const open = unanswered(state);
  return open.length === 0 ? null : view.refuse(PREPARE_NOTE.unanswered, { said: quoted(open) });
}

/** Story time `at` as the tools write a time: YYYY-MM-DD HH:MM in the world's calendar, at the player character's place. */
function stampOf(view: ToolReadView, at: number): string {
  return formatStamp(calendarOf(view.world), at, placeOffset(view.world, at, placeOfEntity(view.state, view.world.pov)));
}

/** A person's name as the view names them, the player's character's for "player". */
function nameOf(view: ToolReadView, who: string): string {
  return view.name(who === "player" ? view.pov : who);
}

/** A text no longer than `max`, or the answer that says it is too long. */
function fits(view: ToolReadView, field: string, said: string, max: number): ToolOutcome | null {
  return said.length > max ? view.refuse(PREPARE_NOTE.long, { field, size: said.length.toLocaleString("en-US"), max: max.toLocaleString("en-US") }) : null;
}

/** A list argument: a list as sent, or JSON text of one; null where it is left out or is neither. */
function listArg(args: JsonObject, key: string): JsonValue[] | null {
  const raw = args[key];
  const given = typeof raw === "string" ? jsonTextOf(raw) : raw;
  return Array.isArray(given) ? given : null;
}

/** The beats of the path recorded from one stretch, in order. */
function stretchBeats(path: StoryPath, s: Pick<PrepareStretch, "fromId" | "toId">): Beat[] {
  return path.beats.flatMap(({ beat }) => (beat.past !== undefined && beat.past.from === s.fromId && beat.past.to === s.toId ? [beat] : []));
}

/** The story along the chat's path, as the call reads it; or the answer that says the call reaches no story record. */
async function pathOf(view: ToolReadView, turn: HarnessTurn): Promise<StoryPath | ToolOutcome> {
  const read = turn.story ? await turn.story.read() : null;
  return read ? read.path : view.refuse(PREPARE_NOTE.noStory);
}

/** What a write of the file came to, as the tool answers it: the state written, the answer the change stopped with, or why it couldn't be written. */
function writtenOr(view: ToolReadView, out: Updated<ToolOutcome>): PrepareState | ToolOutcome {
  if ("stop" in out) return out.stop;
  if ("failed" in out) return view.refuse(PREPARE_NOTE.conflict);
  return out.state;
}

// ---------------------------------------------------------------- the survey

const PARTS = ["chat", "summaries", "lore", "world", "engine"] as const;

/** A summary's level, the highest first: LumiBooks' volumes, arcs and chapters, then any other entry titled as a summary. */
const LEVELS = ["volume", "arc", "chapter", "other"] as const;
type Level = (typeof LEVELS)[number];

/** The letter a summary's id in the survey starts with, by its level. */
const LEVEL_MARK: Readonly<Record<Level, string>> = { volume: "v", arc: "a", chapter: "c", other: "o" };

/** A summary of the story in the chat's World Info books: its id in the survey (its level's letter and its place in the story's order, c12), its book entry, its level and title, the messages it spans (none for one LumiBooks doesn't mark), and its text as the view may give it. */
interface Summary {
  id: string;
  entry: string;
  level: Level;
  title: string;
  span: { from: number; to: number } | null;
  text: string;
}

/** "msgs 31-40" in a LumiBooks entry's comment: counted from 1. */
const MSGS = /\bmsgs?\s+(\d+)\s*[-–]\s*(\d+)/i;
/** A title that names a summary of the story, where no LumiBooks mark says so. */
const SUMMARY_TITLE = /\b(summary|summaries|recap|story so far|previously)\b/i;

/** A LumiBooks summary's level, title and span, as its entry's marks say them (`lumibooks_summary`, `lumibooks`, or its comment's message numbers); null for an entry that isn't one. */
function lumibooksOf(entry: HostBookEntry): { level: Exclude<Level, "other">; title: string; span: { from: number; to: number } } | null {
  const marks = isRecord(entry.extensions.lumibooks_summary) ? entry.extensions.lumibooks_summary : null;
  const shelf = isRecord(entry.extensions.lumibooks) ? entry.extensions.lumibooks : null;
  if (marks === null && shelf === null) return null;
  const tier = marks?.tier ?? shelf?.tier;
  const comment = entry.comment.trim();
  const level = typeof tier === "number" ? (tier >= 3 ? "volume" : tier === 2 ? "arc" : "chapter") : /^vol/i.test(comment) ? "volume" : /^arc\b/i.test(comment) ? "arc" : "chapter";
  const indices = Array.isArray(marks?.messageIndices) ? marks.messageIndices.filter((n): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) : [];
  const first = shelf?.firstMsgIdx;
  const last = shelf?.lastMsgIdx;
  const said = MSGS.exec(comment);
  const range: [number, number] | null =
    indices.length > 0 ? [Math.min(...indices), Math.max(...indices)] : typeof first === "number" && typeof last === "number" && first <= last ? [first, last] : said ? [Number(said[1]) - 1, Number(said[2]) - 1] : null;
  if (range === null || range[0] < 0 || range[1] < range[0]) return null;
  return { level, title: comment || (typeof shelf?.title === "string" ? shelf.title : "") || entry.id, span: { from: range[0], to: range[1] } };
}

/**
 * The summaries of the story in the chat's World Info books, read from the entries as the books
 * hold them, an entry switched off in its book among them (LumiBooks keeps many of its summaries
 * so): each LumiBooks level in the story's order, then any other entry titled as a summary, in its
 * book's order. Their text is what the view may give of it.
 */
function summariesOf(view: ToolReadView, entries: readonly HostBookEntry[]): Summary[] {
  const read = entries.map((e) => ({ e, marked: lumibooksOf(e) }));
  const marked = read.flatMap(({ e, marked: m }) => (m ? [{ e, ...m }] : [])).sort((a, b) => a.span.from - b.span.from || b.span.to - a.span.to);
  const others = read.filter(({ e, marked: m }) => m === null && SUMMARY_TITLE.test(e.comment)).map(({ e }) => ({ e, level: "other" as const, title: e.comment.trim(), span: null }));
  return LEVELS.flatMap((level) => (level === "other" ? others : marked.filter((s) => s.level === level)).map((s, i) => ({ id: `${LEVEL_MARK[level]}${i + 1}`, entry: `${s.e.bookId}/${s.e.id}`, level, title: s.title, span: s.span, text: view.entryText(s.e.content) })));
}

/** A summary as an answer gives it: its id, level, title, the messages it spans, and its whole text. */
function summaryItem(s: Summary): JsonObject {
  return { id: s.id, level: s.level, title: s.title, ...(s.span ? { messages: spanOf(s.span) } : {}), text: s.text };
}

/** As many of `items`, in order, as fit in `room` characters given as `shown` makes each, each whole; and how many that was. */
function fitting<T>(items: readonly T[], room: number, shown: (item: T) => JsonValue): { kept: JsonValue[]; count: number } {
  const kept: JsonValue[] = [];
  let used = 0;
  for (const item of items) {
    const value = shown(item);
    const size = JSON.stringify(value).length + 1;
    if (used + size > room) break;
    kept.push(value);
    used += size;
  }
  return { kept, count: kept.length };
}

/** The chat's messages no summary spans, as runs of numbers. */
function uncovered(messages: readonly HostMessage[], spans: readonly { from: number; to: number }[]): string[] {
  const runs: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  for (const m of [...messages].sort((a, b) => a.index - b.index)) {
    const covered = spans.some((s) => s.from <= m.index && m.index <= s.to);
    if (!covered && start === null) start = m.index;
    if (covered && start !== null && previous !== null) {
      runs.push(`#${start} to #${previous}`);
      start = null;
    }
    previous = m.index;
  }
  if (start !== null && previous !== null) runs.push(`#${start} to #${previous}`);
  return runs;
}

/** The spans the summaries cover, merged where they touch or overlap, in the chat's order. */
function coveredBy(spans: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** The summaries left out for size, each level's as a run of ids and the messages they span. */
function leftOutText(left: readonly Summary[]): string {
  return LEVELS.flatMap((level) => {
    const at = left.filter((s) => s.level === level).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const first = at[0];
    const last = at.at(-1);
    if (!first || !last) return [];
    const ids = first === last ? first.id : `${first.id} to ${last.id}`;
    return [first.span && last.span ? `${level} ${ids} (${spanOf({ from: first.span.from, to: last.span.to })})` : `${level} ${ids}`];
  }).join("; ");
}

/** What a call of the survey asks beyond its part. */
interface SurveyAsk {
  part: (typeof PARTS)[number] | null;
  level: Level | null;
  from: number | null;
  to: number | null;
  summary: string | null;
  book: string | null;
}

/**
 * The summaries part: one summary whole (`summary`); one level's in the story's order within a span
 * of messages, as many as fit, and where to read on (`level`, `from`, `to`); else the story so far,
 * the highest level first and the lower levels newest first, as many as fit, with what was left out
 * and how to read it. Where the books hold no summary, how to read the chat in outline instead.
 */
function summariesPart(view: ToolReadView, all: readonly Summary[], messages: readonly HostMessage[], size: number, ask: SurveyAsk): JsonObject | ToolOutcome {
  if (ask.summary !== null) {
    const one = all.find((s) => s.id === ask.summary || s.entry === ask.summary);
    return one ? { summary: summaryItem(one) } : view.refuse(PREPARE_NOTE.surveyNoSummary, { id: ask.summary });
  }
  if (all.length === 0) return { none: true, note: view.text(PREPARE_NOTE.surveyNone) };
  const end = view.text(PREPARE_NOTE.surveyEnd);
  if (ask.level !== null) {
    const level = all.filter((s) => s.level === ask.level);
    const from = ask.from ?? 0;
    const asked = level.filter((s, i) => (s.span === null ? i + 1 >= Math.max(1, from) : s.span.to >= from && (ask.to === null || s.span.from <= ask.to)));
    const more = view.text(PREPARE_NOTE.surveyMore, { next: "0000000" });
    const { kept, count } = fitting(asked, size - more.length - 64, summaryItem);
    const next = asked[count];
    return { summaries: kept, note: next === undefined ? end : view.text(PREPARE_NOTE.surveyMore, { next: String(next.span ? next.span.from : level.indexOf(next) + 1) }) };
  }
  const order = LEVELS.flatMap((level) => all.filter((s) => s.level === level).reverse());
  const lead = view.text(PREPARE_NOTE.surveyOrder, { size: size.toLocaleString("en-US") });
  const notCovered = uncovered(
    messages,
    all.flatMap((s) => (s.span ? [s.span] : [])),
  );
  const frame = JSON.stringify({ order: lead, notCovered, leftOut: view.text(PREPARE_NOTE.surveyLeft, { left: leftOutText(order) }) }).length + 64;
  const { kept, count } = fitting(order, size - frame, summaryItem);
  const left = order.slice(count);
  return { order: lead, summaries: kept, ...(notCovered.length > 0 ? { notCovered } : {}), ...(left.length > 0 ? { leftOut: view.text(PREPARE_NOTE.surveyLeft, { left: leftOutText(left) }) } : { note: end }) };
}

/** The lore part: the world's own entries and each World Info book the chat reads, with its size and how many of its entries are always on; or one book's entries (`book`), those always on first, each whole, as many as fit from `from`. Summaries are left to their own part. */
async function lorePart(view: ToolReadView, env: ToolEnv, turn: HarnessTurn, entries: readonly HostBookEntry[], size: number, ask: SurveyAsk): Promise<JsonObject | ToolOutcome> {
  const names = new Map((await turn.host.books.list(env.userId)).map((b) => [b.id, b.name]));
  const books = [...new Set(entries.map((e) => e.bookId))];
  if (ask.book !== null) {
    const wanted = ask.book.trim().toLowerCase();
    const id = books.find((b) => b === ask.book || (names.get(b) ?? "").trim().toLowerCase() === wanted);
    if (id === undefined) return view.refuse(PREPARE_NOTE.surveyNoBook, { book: ask.book });
    const own = entries.filter((e) => e.bookId === id && e.content.trim() !== "" && lumibooksOf(e) === null && !SUMMARY_TITLE.test(e.comment));
    const ordered = [...own.filter((e) => e.constant), ...own.filter((e) => !e.constant)];
    const start = Math.max(1, ask.from ?? 1);
    const more = view.text(PREPARE_NOTE.surveyMore, { next: "0000000" });
    const { kept, count } = fitting(ordered.slice(start - 1), size - more.length - 128, (e) => ({ title: bookEntryTitle(e), ...(e.constant ? { alwaysOn: true } : {}), ...(e.disabled ? { switchedOff: true } : {}), text: view.entryText(e.content) }));
    const next = start + count;
    return { book: names.get(id) ?? id, entries: ordered.length, from: start, read: kept, note: next <= ordered.length ? view.text(PREPARE_NOTE.surveyMore, { next: String(next) }) : view.text(PREPARE_NOTE.surveyEnd) };
  }
  const authored = Object.values((await view.lore()).lore).filter((e) => loreSourceOf(e.source).kind !== "book").length;
  const listed = books.map((id) => {
    const own = entries.filter((e) => e.bookId === id);
    return { book: names.get(id) ?? id, entries: own.length, alwaysOn: own.filter((e) => e.constant && !e.disabled).length, switchedOff: own.filter((e) => e.disabled).length, summaries: own.filter((e) => lumibooksOf(e) !== null).length, chars: own.reduce((sum, e) => sum + e.content.length, 0) };
  });
  return { world: authored, books: listed, note: view.text(PREPARE_NOTE.surveyBooks) };
}

/** The world part: the player's character, the world's people as many as fit from `from`, each with where they are, and how many places there are. */
function worldPart(view: ToolReadView, size: number, ask: SurveyAsk): JsonObject {
  const people = Object.keys(view.state.entities)
    .filter((id) => view.isPerson(id) && view.seesEntity(id) && !isGone(view.state, id))
    .map((id) => {
      const at = placeOfEntity(view.state, id);
      return { id, name: view.entity(id)?.name ?? id, ...(at ? { at: view.place(at)?.name ?? at } : {}), ...(id === view.pov ? { player: true } : {}) };
    });
  const start = Math.max(1, ask.from ?? 1);
  const { kept, count } = fitting(people.slice(start - 1), size - 256, (p) => p);
  const next = start + count;
  return { player: { id: view.pov, name: nameOf(view, "player") }, people: kept, of: people.length, places: Object.keys(view.world.places).length, note: next <= people.length ? view.text(PREPARE_NOTE.surveyMore, { next: String(next) }) : view.text(PREPARE_NOTE.surveyEnd) };
}

/** The chat part: how long the chat is, its first and last message, who wrote how many, its tokens (counted once for the read), and whether it has a history. */
function chatPart(chat: ChatRead): JsonObject {
  const { messages, players } = chat;
  const first = messages[0];
  const last = messages.at(-1);
  return { messages: messages.length, ...(first && last ? { first: `#${first.index}`, last: `#${last.index}` } : {}), player: players, replies: messages.length - players, tokens: chat.tokens(messageTokens), kind: chatKind(messages) };
}

/** How the preparation stands, in the survey's and the status's words. */
function standing(file: PrepareFile): string {
  if (file.damaged) return "damaged";
  if (file.state === null) return "none";
  if (!planned(file.state)) return "no plan yet";
  return file.state.done !== null ? "done" : waits(file.state) ? "waits for the player's word" : "under way";
}

/**
 * What the survey answers: without a part, what there is in outline (counts and how to read each
 * part), else the part asked for, each within the player's size for an answer of the survey.
 */
async function survey(view: ToolReadView, env: ToolEnv, turn: HarnessTurn, files: HarnessFiles, ask: SurveyAsk): Promise<JsonObject | ToolOutcome> {
  const size = turn.settings.story.prepare.surveyChars;
  const { part } = ask;
  if (part === "chat") return { chat: chatPart(await chatOf(env, turn)) };
  const entries = part === null || part === "summaries" || part === "lore" ? await view.bookEntries() : [];
  if (part === "summaries") return summariesPart(view, summariesOf(view, entries), (await chatOf(env, turn)).messages, size, ask);
  if (part === "lore") return lorePart(view, env, turn, entries, size, ask);
  if (part === "world") return worldPart(view, size, ask);
  const read = turn.story ? await turn.story.read() : null;
  const minds = (await files.list("")).flatMap((f) => {
    const folder = /(?:^|\/)minds\/([^/]+)\/core\.md$/.exec(f.path)?.[1];
    return folder === undefined ? [] : [decodeURIComponent(folder)];
  });
  const preparation = standing(await readPrepare(files));
  if (part === "engine") {
    return {
      engine: {
        now: stampOf(view, view.state.clock),
        ...(read ? { cast: read.path.cast.map((c) => ({ id: c.entity, name: nameOf(view, c.entity), standing: c.standing })), beats: { all: read.path.beats.length, past: read.path.beats.filter((b) => b.beat.past !== undefined).length } } : {}),
        minds: minds.map((id) => ({ id, name: nameOf(view, id) })),
        olderMinds: Object.keys(readSlice(view.state).chars).map((id) => ({ id, name: nameOf(view, id) })),
        preparation,
      },
    };
  }
  const summaries = summariesOf(view, entries);
  const people = Object.keys(view.state.entities).filter((id) => view.isPerson(id) && view.seesEntity(id) && !isGone(view.state, id)).length;
  return {
    chat: chatPart(await chatOf(env, turn)),
    summaries: Object.fromEntries(LEVELS.map((level) => [level, summaries.filter((s) => s.level === level).length])),
    lore: { books: new Set(entries.map((e) => e.bookId)).size, entries: entries.length, alwaysOn: entries.filter((e) => e.constant && !e.disabled).length, chars: entries.reduce((sum, e) => sum + e.content.length, 0) },
    world: { player: nameOf(view, "player"), people, places: Object.keys(view.world.places).length },
    engine: { now: stampOf(view, view.state.clock), cast: read?.path.cast.length ?? 0, beats: read?.path.beats.length ?? 0, minds: minds.length, preparation },
    note: view.text(PREPARE_NOTE.surveyOutline),
  };
}

// ---------------------------------------------------------------- the player's words in an answer

/** What the player said, quoted, as a tool's answer tells the author of it. */
function quoted(said: readonly { text: string }[]): string {
  return said.map((s) => `“${s.text}”`).join(" ");
}

// ---------------------------------------------------------------- the plan

/** The plan's principals as the call names them, each a person of the world and not the player's character; or the answer that says what to fix. */
function principalsArg(view: ToolReadView, args: JsonObject, max: number): { id: string; name: string; why: string }[] | ToolOutcome {
  const given = listArg(args, "principals");
  if (given === null) return missing(view, T.plan, "principals");
  const out: { id: string; name: string; why: string }[] = [];
  for (const entry of given) {
    if (!isRecord(entry) || typeof entry.who !== "string" || entry.who.trim() === "") return missing(view, T.plan, "principals.who");
    const found = resolvePerson(view, entry.who);
    if ("refused" in found) return found.refused;
    if (found.id === view.pov) return view.refuse(PREPARE_NOTE.playerCast, { name: nameOf(view, "player") });
    const why = typeof entry.why === "string" ? entry.why.trim() : "";
    const long = fits(view, "principals.why", why, max);
    if (long) return long;
    if (!out.some((p) => p.id === found.id)) out.push({ id: found.id, name: own(view.state.entities, found.id)?.name ?? found.id, why });
  }
  return out.length > 0 ? out : view.refuse(PREPARE_NOTE.noPrincipals);
}

/** The stretches as the call asks for them, each relived only by principals of the plan; or the answer that says what to fix. */
function stretchesArg(view: ToolReadView, args: JsonObject, principals: readonly { id: string; name: string }[], max: number): StretchAsked[] | ToolOutcome {
  const given = listArg(args, "stretches") ?? [];
  const out: StretchAsked[] = [];
  for (const entry of given) {
    const from = isRecord(entry) ? intArg(entry, "from") : null;
    const to = isRecord(entry) ? intArg(entry, "to") : null;
    if (!isRecord(entry) || from === null) return missing(view, T.plan, "stretches.from");
    if (to === null) return missing(view, T.plan, "stretches.to");
    const why = typeof entry.why === "string" ? entry.why.trim() : "";
    const long = fits(view, "stretches.why", why, max);
    if (long) return long;
    const who: string[] = [];
    for (const said of Array.isArray(entry.who) ? entry.who : []) {
      if (typeof said !== "string" || said.trim() === "") continue;
      const found = resolvePerson(view, said);
      if ("refused" in found) return found.refused;
      if (!principals.some((p) => p.id === found.id)) return view.refuse(PREPARE_NOTE.notPrincipal, { name: nameOf(view, found.id) });
      if (!who.includes(found.id)) who.push(found.id);
    }
    out.push({ from, to, why, who, key: entry.key === true });
  }
  return out;
}

// ---------------------------------------------------------------- the historian's beats

const PROBLEM_NOTE: Readonly<Record<StoryProblemCode, string>> = { long: RECORD_NOTE.long, many: RECORD_NOTE.many, blank: RECORD_NOTE.blank, inner_reach: RECORD_NOTE.innerReach, reach_actor: RECORD_NOTE.reachActor, reach_twice: RECORD_NOTE.reachTwice, got_missing: RECORD_NOTE.gotMissing };
const REFUSAL_NOTE: Readonly<Record<StoryRefusal, string>> = { none: PREPARE_NOTE.noStory, closed: RECORD_NOTE.closed, off_path: RECORD_NOTE.offPath, no_basis: RECORD_NOTE.noBasis };

/** A person as the story record names them: "player" for the player's character, else their entity's id; or why not, in the lookup's words. */
function storyPerson(view: ToolReadView, said: string): { id: string } | { why: string } {
  if (said.trim().toLowerCase() === "player") return { id: "player" };
  const found = resolvePerson(view, said);
  return "refused" in found ? { why: found.refused.text } : { id: storyName(found.id, view.pov) };
}

/** One beat as the historian gives it, made whole: its time read in the world's calendar, its people and place found, its mark set from the stretch; or why it can't be. */
function pastBeat(view: ToolReadView, env: ToolEnv, turn: HarnessTurn, written: string, stretch: PrepareStretch, raw: JsonValue): Beat | { why: string } {
  if (!isRecord(raw)) return { why: missing(view, T.beats, "beats").text };
  const when = textArg(raw, "when");
  if (when === null) return { why: missing(view, T.beats, "beats.when").text };
  const read = clockOfStamp(calendarOf(view.world), when);
  if (read === null) return { why: view.text(PREPARE_NOTE.badWhen, { when, now: stampOf(view, view.state.clock) }) };
  const at = read - placeOffset(view.world, read, placeOfEntity(view.state, view.world.pov));
  const whereSaid = textArg(raw, "where");
  const place = whereSaid === null ? null : resolvePlace(view, whereSaid);
  if (place !== null && "refused" in place) return { why: place.refused.text };
  const bySaid = textArg(raw, "by");
  if (bySaid === null) return { why: missing(view, T.beats, "beats.by").text };
  const by = bySaid.toLowerCase() === "world" ? { id: "world" } : storyPerson(view, bySaid);
  if ("why" in by) return by;
  const kind = BEAT_KINDS.find((k) => k === raw.kind);
  if (kind === undefined) return { why: badValue(view, T.beats, "beats.kind", typeof raw.kind === "string" ? raw.kind : "", BEAT_KINDS).text };
  const what = textArg(raw, "what");
  if (what === null) return { why: missing(view, T.beats, "beats.what").text };
  const to: string[] = [];
  for (const said of Array.isArray(raw.to) ? raw.to : []) {
    if (typeof said !== "string" || said.trim() === "") continue;
    const who = storyPerson(view, said);
    if ("why" in who) return who;
    if (!to.includes(who.id)) to.push(who.id);
  }
  const given = typeof raw.exposure === "string" ? jsonTextOf(raw.exposure) : raw.exposure;
  if (!Array.isArray(given)) return { why: view.text(PREPARE_NOTE.exposure) };
  const exposure: Exposure[] = [];
  for (const entry of given) {
    if (!isRecord(entry) || typeof entry.who !== "string") return { why: missing(view, T.beats, "beats.exposure.who").text };
    const who = storyPerson(view, entry.who);
    if ("why" in who) return who;
    const reach = BEAT_REACHES.find((r) => r === entry.reach);
    if (reach === undefined) return { why: badValue(view, T.beats, "beats.exposure.reach", typeof entry.reach === "string" ? entry.reach : "", BEAT_REACHES).text };
    const from = typeof entry.from === "string" && entry.from.trim() !== "" ? storyPerson(view, entry.from) : null;
    if (from !== null && "why" in from) return from;
    const got = typeof entry.got === "string" ? entry.got.trim() : "";
    exposure.push({ who: who.id, reach, ...(got !== "" ? { got } : {}), ...(from !== null ? { from: from.id } : {}) });
  }
  const quotes = Array.isArray(raw.quotes) ? raw.quotes.filter((q): q is string => typeof q === "string" && q.trim() !== "").map((q) => q.trim()) : [];
  const surface = typeof raw.surface === "string" ? raw.surface.trim() : "";
  const beat: Beat = {
    id: `b${hashParts("lre.story.past", written, stretch.id, String(at), by.id, kind, what).slice(0, 12)}`,
    turn: written,
    at,
    where: place === null ? null : place.id,
    by: by.id,
    kind,
    what,
    surface,
    ...(quotes.length > 0 ? { quotes } : {}),
    ...(to.length > 0 ? { to } : {}),
    exposure,
    decidedBy: { agent: env.agent.role, ...(env.agent.as !== undefined ? { as: env.agent.as } : {}) },
    past: { from: stretch.fromId, to: stretch.toId },
  };
  const problem = beatProblem(beat, turn.settings.story.limits);
  return problem ? { why: view.text(PROBLEM_NOTE[problem.code], problem.vars) } : beat;
}

/** The line a tool adds where beats are later than the world's clock now; empty where none is. */
function laterNote(view: ToolReadView, beats: readonly Beat[]): string {
  const later = beats.filter((b) => b.at > view.state.clock).length;
  return later === 0 ? "" : ` ${view.text(PREPARE_NOTE.later, { count: String(later), now: stampOf(view, view.state.clock) })}`;
}

// ---------------------------------------------------------------- the tools

export const PREPARE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: T.survey,
    family: HARNESS_FAMILY.prepare,
    tier: "read",
    parameters: () => objectSchema({ part: text(PARTS), level: text(LEVELS), from: integer({ minimum: 0 }), to: integer({ minimum: 0 }), summary: text(), book: text() }),
    // An answer reaches the author whole: each part is held to the player's size for one. One summary asked for by its id is given whole, and LumiAH keeps what is past that size for scratch_read.
    wholeChars: (settings) => settings.story.prepare.surveyChars,
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const part = textArg(args, "part");
      if (part !== null && !(PARTS as readonly string[]).includes(part)) return badValue(view, T.survey, "part", part, PARTS);
      const level = textArg(args, "level");
      if (level !== null && !(LEVELS as readonly string[]).includes(level)) return badValue(view, T.survey, "level", level, LEVELS);
      const summary = textArg(args, "summary");
      const book = textArg(args, "book");
      // A level or a summary is the summaries part's, a book the lore's, whichever part was named.
      const ask: SurveyAsk = { part: level !== null || summary !== null ? "summaries" : book !== null ? "lore" : (PARTS.find((p) => p === part) ?? null), level: LEVELS.find((l) => l === level) ?? null, from: intArg(args, "from"), to: intArg(args, "to"), summary, book };
      const out = await survey(view, env, turn, files, ask);
      if (out.error === true) return out as ToolOutcome;
      // What the plan is held to: the story so far and the lore, noted in the preparation's file as given, so a later run need not read them again.
      if (ask.part === "summaries" || ask.part === "lore") {
        const given = ask.part;
        const noted = (await readPrepare(files)).state;
        if (noted?.surveyed !== true && !noted?.read?.includes(given)) {
          const kind = noted?.kind ?? chatKind((await chatOf(env, turn)).messages);
          // A file whose record can't be read is planned afresh anyway: the note starts a preparation with no plan in its place.
          await updatePrepare<null>(files, turn.settings.prompts.texts, (now) => {
            const s = now.state ?? unplanned(kind, [], false);
            return s.surveyed || s.read?.includes(given) ? { stop: null } : { ...s, read: [...(s.read ?? []), given] };
          });
        }
      }
      return view.answer(out);
    },
  },
  {
    name: T.status,
    family: HARNESS_FAMILY.prepare,
    tier: "read",
    parameters: () => objectSchema({ stretch: text() }),
    async run(args, env) {
      const ready = await preparedWords(env);
      if (!("words" in ready)) return ready;
      const { words, turn, files } = ready;
      const file = await readPrepare(files);
      const playerSaid = (s: PrepareState) => s.word.said.map((x) => ({ said: x.text, ...(x.answer !== null ? { yourAnswer: x.answer } : { answered: false }) }));
      // Before a plan the file keeps only what the player said: the plan answers it.
      if (file.state !== null && !planned(file.state)) return words.answer({ status: standing(file), ...(file.state.word.said.length > 0 ? { playerSaid: playerSaid(file.state) } : {}), note: words.text(PREPARE_NOTE.noPlan) });
      const state = planIn(words, file);
      if (!("v" in state)) return state;
      // Everything here is the file's: whom a recorded stretch reached, and who took it in as of the last relive or finish.
      const name = (id: string): string => state.principals.find((p) => p.id === id)?.name ?? id;
      const asked = textArg(args, "stretch");
      if (asked !== null) {
        const s = state.stretches.find((x) => x.id === asked);
        if (!s) return words.refuse(PREPARE_NOTE.noStretch, { stretch: asked });
        const reached = s.reached ?? null;
        const owed = reached === null ? [] : reached.filter((id) => !(s.relived ?? []).includes(id));
        return words.answer({ stretch: s.id, messages: spanOf(s), why: s.why, relivedBy: s.who.map(name), state: s.state, beats: s.beats.length, ...(s.through !== null ? { through: `#${s.through}` } : {}), ...(reached !== null ? { reached: reached.map(name), stillToRelive: owed.map(name) } : {}) });
      }
      const has = async (path: string): Promise<boolean> => (await files.read(path)) !== null;
      const principals = await Promise.all(state.principals.map(async (p) => ({ id: p.id, name: p.name, why: p.why, core: await has(mindPath(p.id, "core")), outline: await has(mindPath(p.id, "outline")) })));
      const reliving = stillToRelive(state);
      const spent = (await turn.job?.spent?.()) ?? null;
      const first = wordsFirst(words, state);
      return words.answer({
        status: standing({ state, damaged: false, version: null }),
        kind: state.kind,
        about: state.about,
        principals: principals.map((p) => ({ ...p, stillToRelive: reliving.includes(p.id) })),
        stretches: state.stretches.map((s) => ({ stretch: s.id, messages: spanOf(s), why: s.why, relivedBy: s.who.map(name), state: s.state, beats: s.beats.length, ...(s.through !== null ? { through: `#${s.through}` } : {}) })),
        fills: state.fills,
        estimate: estimateOf(state),
        authorEstimate: state.estimate.author,
        ceiling: state.word.ceiling,
        ...(spent !== null ? { spentSoFar: spent.tokens } : {}),
        ...(state.word.cap !== null ? { cap: state.word.cap } : {}),
        playerApproved: state.word.asked && state.word.approved,
        ...(state.word.said.length > 0 ? { playerSaid: playerSaid(state) } : {}),
        ...(first !== null ? { note: first.text } : waits(state) ? { note: state.word.revised ? words.text(PREPARE_NOTE.waitsRevised) : words.text(PREPARE_NOTE.waits, { estimate: estimateOf(state).toLocaleString("en-US"), ceiling: state.word.ceiling.toLocaleString("en-US") }) } : {}),
      });
    },
  },
  {
    name: T.plan,
    family: HARNESS_FAMILY.prepare,
    tier: "write",
    parameters: () =>
      objectSchema(
        {
          about: text(),
          principals: list(objectSchema({ who: text(), why: text() }, ["who"])),
          stretches: list(objectSchema({ from: integer({ minimum: 0 }), to: integer({ minimum: 0 }), why: text(), who: words(), key: { type: "boolean" } }, ["from", "to"])),
          fills: text(),
          estimate: integer({ minimum: 0 }),
          answer: text(),
          depth: text(PREPARE_DEPTHS),
          depthWhy: text(),
        },
        ["about", "principals"],
      ),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const limits = turn.settings.story.prepare;
      const about = needText(view, T.plan, args, "about");
      if (typeof about !== "string") return about;
      const fills = textArg(args, "fills") ?? "";
      const answer = textArg(args, "answer");
      const depthSaid = textArg(args, "depth");
      const recommended = depthSaid === null ? null : (PREPARE_DEPTHS.find((d) => d === depthSaid) ?? null);
      if (depthSaid !== null && recommended === null) return badValue(view, T.plan, "depth", depthSaid, PREPARE_DEPTHS);
      const depthWhy = textArg(args, "depthWhy") ?? "";
      const long = fits(view, "about", about, limits.textChars) ?? fits(view, "fills", fills, limits.textChars) ?? fits(view, "answer", answer ?? "", limits.textChars) ?? fits(view, "depthWhy", depthWhy, limits.textChars);
      if (long) return long;
      const principals = principalsArg(view, args, limits.textChars);
      if (!Array.isArray(principals)) return principals;
      const asked = stretchesArg(view, args, principals, limits.textChars);
      if (!Array.isArray(asked)) return asked;
      const author = intArg(args, "estimate") ?? 0;
      const { messages, numbered } = await chatOf(env, turn);
      const kind = chatKind(messages);
      if (kind === "new" && asked.length > 0) return view.refuse(PREPARE_NOTE.newChat);
      // On a chat with a history the plan is written with the story so far and its lore read in this preparation, and the story as the author understands it kept in its file, which every later run reads first.
      const noted = (await readPrepare(files)).state;
      const unread = kind === "history" && noted?.surveyed !== true ? SURVEY_PARTS.filter((p) => !noted?.read?.includes(p)) : [];
      if (unread.length > 0) return view.refuse(PREPARE_NOTE.surveyFirst, { parts: unread.join(", ") });
      if (kind === "history" && ((await files.read(PREPARE_STORY))?.text.trim() ?? "") === "") return view.refuse(PREPARE_NOTE.storyFirst);
      // What the preparation has spent so far, as LumiAH counts it, and what one of its model calls weighs: the rest of the plan is reckoned at that.
      const spent = (await turn.job?.spent?.()) ?? null;
      const call = callWeight(spent, limits);
      // Where the scene and the notebook stood when the first plan was written: the preparation finishes once each was written since. And the chat as the plan found it, with what its summaries cover.
      const [scene, notebook, entries] = await Promise.all([files.read(AUTHOR_FILE.scene), files.read(AUTHOR_FILE.notebook), view.bookEntries()]);
      const numbers = messages.map((m) => m.index);
      const chat = { messages: messages.length, first: numbers.length > 0 ? Math.min(...numbers) : 0, last: numbers.length > 0 ? Math.max(...numbers) : 0, covered: coveredBy(entries.flatMap((e) => lumibooksOf(e)?.span ?? [])) };
      const at = Date.now();
      let splits: { from: number; to: number; count: number }[] = [];
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (now) => {
        const before = now.state;
        // What the player said that the author hasn't answered is answered with this plan: their words never approve it, so a plan written for them waits for their word, whatever their ceiling.
        const open = before ? unanswered(before) : [];
        if (open.length > 0 && answer === null) return { stop: view.refuse(PREPARE_NOTE.needAnswer, { said: quoted(open) }) };
        const spoke = open.some((s) => s.how !== "start");
        const word = before ? { ...before.word, said: before.word.said.map((s) => (s.answer === null && answer !== null ? { ...s, answer } : s)), ...(spoke ? { approved: false, revised: true } : {}) } : null;
        const made = planStretches(asked, numbered, limits.stretchMessages, before?.stretches ?? [], { readChars: limits.readChars, call: call.tokens });
        if ("problem" in made) return { stop: view.refuse(made.problem.id, made.problem.vars) };
        splits = made.splits;
        // The depths the plan offers, each reckoned from it: the author recommends one and the player picks; a pick they made carries over where the plan still offers it.
        const offered = depthsOffered(made.stretches);
        if (recommended === null && made.stretches.some((s) => s.state === "planned")) return { stop: view.refuse(PREPARE_NOTE.needDepth) };
        const pick = recommended ?? "outline";
        if (!offered.includes(pick)) return { stop: view.refuse(PREPARE_NOTE.depthOffered, { depth: view.text(DEPTH_NOTE[pick]), offered: offered.map((d) => view.text(DEPTH_NOTE[d])).join(", ") }) };
        const reckonAt = (depth: PrepareDepth): number => (spent?.tokens ?? 0) + reckonLeft({ kind, stretches: made.stretches.filter((s) => within(s, depth)), principals }, call.tokens);
        const depths = { outline: reckonAt("outline"), key: offered.includes("key") ? reckonAt("key") : null, all: reckonAt("all") };
        const picked = word?.depth !== undefined && offered.includes(word.depth) ? word.depth : null;
        const reckoned = depths[picked ?? pick] ?? depths.all;
        const revised = before !== null && planned(before);
        const next: PrepareState = {
          v: 1,
          kind,
          about,
          principals,
          stretches: made.stretches,
          fills,
          estimate: { author, reckoned, call: call.tokens, from: call.from, depths },
          depth: { recommended: pick, why: depthWhy },
          word: wordFor(Math.max(author, reckoned), limits.askAboveTokens, word === null ? null : { asked: word.asked, approved: word.approved, for: word.for, ceiling: word.ceiling, cap: word.cap, said: word.said, revised: word.revised, ...(picked !== null ? { depth: picked } : {}) }),
          done: null,
          marks: before && revised ? before.marks : { scene: scene?.version ?? null, notebook: notebook?.version ?? null },
          surveyed: true,
          ...(before?.read ? { read: before.read } : {}),
          chat,
          ...(before?.log ? { log: before.log } : {}),
          ...(before?.relivedAt !== undefined ? { relivedAt: before.relivedAt } : {}),
          // What its runs spent stays with it, so a plan written again never counts the preparation as having spent less.
          ...(before?.runs ? { runs: before.runs } : {}),
        };
        const answered = open.length > 0 && answer !== null ? logPrepare(next, { at, what: "answered", text: answer }) : next;
        return logPrepare(answered, { at, what: revised ? "revised" : "planned", count: next.stretches.length });
      });
      const state = writtenOr(view, out);
      if (!("v" in state)) return state;
      const estimate = estimateOf(state).toLocaleString("en-US");
      const note = waits(state) ? (state.word.revised ? view.text(PREPARE_NOTE.waitsRevised) : view.text(PREPARE_NOTE.waits, { estimate, ceiling: state.word.ceiling.toLocaleString("en-US") })) : view.text(PREPARE_NOTE.stands, { estimate });
      const split = splits.map((s) => view.text(PREPARE_NOTE.split, { from: String(s.from), to: String(s.to), most: String(limits.stretchMessages), count: String(s.count) }));
      return view.answer({
        file: PREPARE_PATH,
        stretches: state.stretches.map((s) => ({ stretch: s.id, messages: spanOf(s), relivedBy: s.who.map((id) => principals.find((p) => p.id === id)?.name ?? id), state: s.state, reckoned: s.reckoned })),
        estimate: estimateOf(state),
        reckoned: state.estimate.reckoned,
        spentSoFar: spent?.tokens ?? 0,
        call: { tokens: call.tokens, measured: view.text(CALL_NOTE[call.from]) },
        note: [...split, note].join(" "),
      });
    },
  },
  {
    name: T.relive,
    family: HARNESS_FAMILY.prepare,
    tier: "write",
    parameters: () => objectSchema({ stretch: text(), drop: { type: "boolean" } }, ["stretch"]),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const id = needText(view, T.relive, args, "stretch");
      if (typeof id !== "string") return id;
      const limits = turn.settings.story.prepare;
      const drop = boolArg(args, "drop") === true;
      // What opening is checked against beyond the file: the chat as it stands, and who has moments still to relive.
      const [chat, path] = drop ? [null, null] : await Promise.all([chatOf(env, turn), pathOf(view, turn)]);
      if (path !== null && !("beats" in path)) return path;
      const numbered: ReadonlyMap<number, HostMessage> = chat?.numbered ?? new Map();
      // What the cap is held to: what the preparation has spent so far, as LumiAH counts it.
      const used = drop ? 0 : (((await turn.job?.spent?.()) ?? null)?.tokens ?? 0);
      const at = Date.now();
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (now) => {
        const state = planIn(view, now);
        if (!("v" in state)) return { stop: state };
        // The player's words come first: nothing is opened or dropped until the plan is written again for them.
        const first = wordsFirst(view, state);
        if (first) return { stop: first };
        const s = state.stretches.find((x) => x.id === id);
        if (!s) return { stop: view.refuse(PREPARE_NOTE.noStretch, { stretch: id }) };
        if (s.state === "recorded") return { stop: view.refuse(PREPARE_NOTE.recordedAlready, { stretch: s.id }) };
        if (s.state === "dropped") return { stop: view.refuse(PREPARE_NOTE.droppedAlready, { stretch: s.id }) };
        // Opening a stretch, who has taken in each recorded one is worked out from the story record at hand.
        const changed = (next: PrepareStretch): PrepareState => {
          const made = { ...state, stretches: state.stretches.map((x) => (x.id === s.id ? next : x)) };
          return logPrepare(path ? withRelived(made, path, at) : made, { at, what: next.state === "dropped" ? "dropped" : "opened", stretch: s.id });
        };
        if (drop) return changed({ ...s, state: "dropped" });
        if (s.state === "open") return { stop: view.answer({ stretch: s.id, note: view.text(PREPARE_NOTE.openAlready, { stretch: s.id, span: spanOf(s), through: String(s.through ?? s.from - 1) }) }) };
        if (waits(state)) return { stop: state.word.revised ? view.refuse(PREPARE_NOTE.waitsRevised) : view.refuse(PREPARE_NOTE.waits, { estimate: estimateOf(state).toLocaleString("en-US"), ceiling: state.word.ceiling.toLocaleString("en-US") }) };
        // Only what the depth the player chose holds is opened, in the chat's order among it.
        const depth = depthOf(state);
        if (!within(s, depth)) return { stop: view.refuse(PREPARE_NOTE.notChosen, { stretch: s.id, depth: view.text(DEPTH_NOTE[depth]) }) };
        const before = state.stretches.find((x) => x.from < s.from && (x.state === "open" || (x.state === "planned" && within(x, depth))));
        if (before) return { stop: view.refuse(PREPARE_NOTE.order, { before: before.id, span: spanOf(before) }) };
        if (s.to - s.from + 1 > limits.stretchMessages) return { stop: view.refuse(PREPARE_NOTE.tooLong, { stretch: s.id, span: spanOf(s), most: String(limits.stretchMessages) }) };
        if (!stretchStands(numbered, s)) return { stop: view.refuse(PREPARE_NOTE.chatChanged, { stretch: s.id, span: spanOf(s) }) };
        const { cap } = state.word;
        if (cap !== null && used + s.reckoned > cap) return { stop: view.refuse(PREPARE_NOTE.capped, { stretch: s.id, cost: s.reckoned.toLocaleString("en-US"), spent: used.toLocaleString("en-US"), cap: cap.toLocaleString("en-US") }) };
        if (s.who.length > limits.reliveAtOnce) return { stop: view.refuse(PREPARE_NOTE.crowd, { stretch: s.id, count: String(s.who.length), most: String(limits.reliveAtOnce) }) };
        // Who has moments still to take in: past beats recorded that their minds haven't, and the principals of any stretch the historian is recording.
        const outstanding = new Set([...(path ? relivingNow(path, state.principals.map((p) => p.id)) : []), ...state.stretches.filter((x) => x.state === "open").flatMap((x) => x.who)]);
        if (outstanding.size > 0 && new Set([...outstanding, ...s.who]).size > limits.reliveAtOnce) {
          const names = [...outstanding].map((p) => state.principals.find((x) => x.id === p)?.name ?? p);
          return { stop: view.refuse(PREPARE_NOTE.atOnce, { reliving: names.join(", "), most: String(limits.reliveAtOnce), stretch: s.id }) };
        }
        return changed({ ...s, state: "open" });
      });
      const state = writtenOr(view, out);
      if (!("v" in state)) return state;
      const s = state.stretches.find((x) => x.id === id);
      if (!s) return view.refuse(PREPARE_NOTE.noStretch, { stretch: id });
      if (drop) return { text: view.text(PREPARE_NOTE.dropped, { stretch: s.id, span: spanOf(s) }) };
      const who = s.who.map((p) => state.principals.find((x) => x.id === p)?.name ?? p).join(", ");
      return { text: view.text(PREPARE_NOTE.opened, { stretch: s.id, span: spanOf(s), why: s.why, who: who || view.text(PREPARE_NOTE.noneReached) }) };
    },
  },
  {
    name: T.read,
    family: HARNESS_FAMILY.prepare,
    tier: "read",
    parameters: () => objectSchema({ stretch: text(), from: integer({ minimum: 0 }) }, ["stretch"]),
    // A read reaches the historian whole: it is what the historian is there to read, and it is held to the player's size for one.
    wholeChars: (settings) => settings.story.prepare.readChars,
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const id = needText(view, T.read, args, "stretch");
      if (typeof id !== "string") return id;
      const state = planIn(view, await readPrepare(files));
      if (!("v" in state)) return state;
      const s = state.stretches.find((x) => x.id === id);
      if (!s) return view.refuse(PREPARE_NOTE.noStretch, { stretch: id });
      if (s.state !== "open") return view.refuse(PREPARE_NOTE.notOpen, { stretch: s.id });
      const { numbered } = await chatOf(env, turn);
      if (!stretchStands(numbered, s)) return view.refuse(PREPARE_NOTE.chatChanged, { stretch: s.id, span: spanOf(s) });
      const start = Math.min(s.to + 1, Math.max(s.from, intArg(args, "from") ?? (s.through ?? s.from - 1) + 1));
      const path = turn.story ? await turn.story.read() : null;
      const lastPast = path?.path.beats.findLast((b) => b.beat.past !== undefined && b.beat.struck === undefined);
      const names = s.who.map((p) => state.principals.find((x) => x.id === p)?.name ?? p);
      const head = { stretch: s.id, messages: spanOf(s), why: s.why, relivedBy: names, now: stampOf(view, view.state.clock), ...(lastPast ? { lastRecorded: stampOf(view, lastPast.beat.at) } : {}) };
      // The whole answer is held to the player's size for a read, as the historian's model is sent it: what goes with the messages, with the longer of its two notes, counts too.
      const notes = [view.text(PREPARE_NOTE.readEnd), view.text(PREPARE_NOTE.readMore, { next: String(s.to) })];
      const most = turn.settings.story.prepare.readChars;
      let used = Math.max(...notes.map((note) => JSON.stringify({ ...head, read: [], note }).length));
      const read: JsonObject[] = [];
      let next: number | null = null;
      for (const m of stretchMessages(numbered, start, s.to)) {
        const item = { n: m.index, by: m.name, player: m.isUser, text: m.content };
        const size = JSON.stringify(item).length + 1;
        if (read.length > 0 && used + size > most) {
          next = m.index;
          break;
        }
        // A message is never cut: one longer than a read by itself is given whole, and LumiAH keeps what is past the read for scratch_read.
        used += size;
        read.push(item);
      }
      return view.answer({ ...head, read, note: next === null ? view.text(PREPARE_NOTE.readEnd) : view.text(PREPARE_NOTE.readMore, { next: String(next) }) });
    },
  },
  {
    name: T.beats,
    family: HARNESS_FAMILY.prepare,
    tier: "write",
    parameters: () =>
      objectSchema(
        {
          stretch: text(),
          through: integer({ minimum: 0 }),
          beats: list(
            objectSchema(
              {
                when: text(),
                where: text(),
                by: text(),
                kind: text(BEAT_KINDS),
                what: text(),
                surface: text(),
                quotes: words(),
                to: words(),
                exposure: list(objectSchema({ who: text(), reach: text(BEAT_REACHES), got: text(), from: text() }, ["who", "reach"])),
              },
              ["when", "by", "kind", "what", "exposure"],
            ),
          ),
        },
        ["stretch", "through", "beats"],
      ),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const id = needText(view, T.beats, args, "stretch");
      if (typeof id !== "string") return id;
      const port = turn.story;
      if (!port) return view.refuse(PREPARE_NOTE.noStory);
      const state = planIn(view, await readPrepare(files));
      if (!("v" in state)) return state;
      const s = state.stretches.find((x) => x.id === id);
      if (!s) return view.refuse(PREPARE_NOTE.noStretch, { stretch: id });
      if (s.state !== "open") return view.refuse(PREPARE_NOTE.notOpen, { stretch: s.id });
      const through = intArg(args, "through");
      if (through === null || through < s.from || through > s.to) return view.refuse(PREPARE_NOTE.through, { stretch: s.id, span: spanOf(s) });
      const given = listArg(args, "beats");
      if (given === null || given.length === 0) return missing(view, T.beats, "beats");
      const beats: Beat[] = [];
      for (const [n, raw] of given.entries()) {
        const beat = pastBeat(view, env, turn, port.turn, s, raw);
        if ("why" in beat) return view.refuse(PREPARE_NOTE.badBeat, { n: String(n + 1), why: beat.why });
        if (!beats.some((b) => b.id === beat.id)) beats.push(beat);
      }
      const path = await pathOf(view, turn);
      if (!("beats" in path)) return path;
      const held = stretchBeats(path, s);
      const fresh = beats.filter((b) => !held.some((h) => h.id === b.id));
      const most = turn.settings.story.prepare.beatsPerStretch;
      if (held.length + fresh.length > most) return view.refuse(PREPARE_NOTE.beatsFull, { stretch: s.id, count: String(held.length), most: String(most) });
      if (fresh.length > 0) {
        const written = await port.write({ beats: fresh });
        if ("refused" in written) return view.refuse(REFUSAL_NOTE[written.refused]);
      }
      const ids = [...held, ...fresh].map((b) => b.id);
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (now) => {
        const current = planIn(view, now);
        if (!("v" in current)) return { stop: current };
        return { ...current, stretches: current.stretches.map((x) => (x.id === s.id ? { ...x, beats: ids, through: Math.max(through, x.through ?? through) } : x)) };
      });
      const after = writtenOr(view, out);
      if (!("v" in after)) return after;
      return { text: `${view.text(PREPARE_NOTE.recorded, { count: String(fresh.length), stretch: s.id, through: String(through), held: String(ids.length) })}${laterNote(view, fresh)}` };
    },
  },
  {
    name: T.done,
    family: HARNESS_FAMILY.prepare,
    tier: "write",
    parameters: () => objectSchema({ stretch: text() }, ["stretch"]),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const id = needText(view, T.done, args, "stretch");
      if (typeof id !== "string") return id;
      const path = await pathOf(view, turn);
      if (!("beats" in path)) return path;
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (now) => {
        const state = planIn(view, now);
        if (!("v" in state)) return { stop: state };
        const s = state.stretches.find((x) => x.id === id);
        if (!s) return { stop: view.refuse(PREPARE_NOTE.noStretch, { stretch: id }) };
        if (s.state === "recorded") return { stop: view.refuse(PREPARE_NOTE.recordedAlready, { stretch: s.id }) };
        if (s.state !== "open") return { stop: view.refuse(PREPARE_NOTE.notOpen, { stretch: s.id }) };
        const beats = stretchBeats(path, s).map((b) => b.id);
        // Whom its beats reached is kept with it, for the page and for who relives it.
        const reached = reachedBy(path, beats, state.principals.map((p) => p.id));
        return logPrepare({ ...state, stretches: state.stretches.map((x) => (x.id === s.id ? { ...x, state: "recorded" as const, beats, reached, relived: [] } : x)) }, { at: Date.now(), what: "recorded", stretch: s.id, count: beats.length });
      });
      const state = writtenOr(view, out);
      if (!("v" in state)) return state;
      const s = state.stretches.find((x) => x.id === id);
      if (!s) return view.refuse(PREPARE_NOTE.noStretch, { stretch: id });
      const beats = stretchBeats(path, s);
      const reached = reachedBy(path, s.beats, state.principals.map((p) => p.id)).map((p) => state.principals.find((x) => x.id === p)?.name ?? p);
      return { text: `${view.text(PREPARE_NOTE.closed, { stretch: s.id, span: spanOf(s), count: String(beats.length), who: reached.length > 0 ? reached.join(", ") : view.text(PREPARE_NOTE.noneReached) })}${laterNote(view, beats)}` };
    },
  },
  {
    name: T.outline,
    family: HARNESS_FAMILY.prepare,
    tier: "write",
    parameters: () => objectSchema({ who: text(), text: text() }, ["who", "text"]),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const whoSaid = needText(view, T.outline, args, "who");
      if (typeof whoSaid !== "string") return whoSaid;
      const said = needText(view, T.outline, args, "text");
      if (typeof said !== "string") return said;
      const state = planIn(view, await readPrepare(files));
      if (!("v" in state)) return state;
      const first = wordsFirst(view, state);
      if (first) return first;
      const found = resolvePerson(view, whoSaid);
      if ("refused" in found) return found.refused;
      if (found.id === view.pov) return view.refuse(PREPARE_NOTE.playerCast, { name: nameOf(view, "player") });
      const principal = state.principals.find((p) => p.id === found.id);
      if (!principal) return view.refuse(PREPARE_NOTE.outlineWho, { name: nameOf(view, found.id) });
      const body = `${view.text(PREPARE_NOTE.outlineHead, { name: principal.name })}\n\n${said}\n`;
      const max = turn.settings.story.minds.chars.outline;
      if (body.length > max) return view.refuse(PREPARE_NOTE.outlineLong, { size: body.length.toLocaleString("en-US"), max: max.toLocaleString("en-US") });
      const path = mindPath(principal.id, "outline");
      // Written whole, in place of what was there: read again where someone wrote it between.
      for (let attempt = 0; attempt < 2; attempt++) {
        const written = await files.write(path, body, (await files.read(path))?.version ?? null);
        if ("version" in written) {
          // The log says whose outline was written; the outline stands whether or not that line could be kept.
          await updatePrepare<null>(files, turn.settings.prompts.texts, (now) => (now.state ? logPrepare(now.state, { at: Date.now(), what: "outlined", who: principal.id }) : { stop: null }));
          return { text: view.text(PREPARE_NOTE.outlined, { name: principal.name }) };
        }
        if (written.refused.version === null) return { text: written.refused.reason, error: true };
      }
      return view.refuse(PREPARE_NOTE.conflict);
    },
  },
  {
    name: T.finish,
    family: HARNESS_FAMILY.prepare,
    tier: "write",
    parameters: () => objectSchema({ note: text() }),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const note = textArg(args, "note") ?? "";
      const long = fits(view, "note", note, turn.settings.story.prepare.textChars);
      if (long) return long;
      const read = turn.story ? await turn.story.read() : null;
      const now = await readPrepare(files);
      const state = planIn(view, now);
      if (!("v" in state)) return state;
      if (state.done !== null) return { text: view.text(PREPARE_NOTE.finished) };
      const first = wordsFirst(view, state);
      if (first) return first;
      // What a first turn needs, each checked: nothing left of the plan, every principal's past taken in, their core and (with a past) their outline written, the scene and the notebook written since the plan.
      const left = await preparationLeft(files, state, read?.path ?? null, turn.settings.prompts.texts);
      if (left.length > 0) return view.refuse(PREPARE_NOTE.unfinished, { left: left.join("; ") });
      const at = Date.now();
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (fresh) => {
        const current = planIn(view, fresh);
        if (!("v" in current)) return { stop: current };
        return logPrepare({ ...(read ? withRelived(current, read.path, at) : current), done: note }, { at, what: "finished" });
      });
      const done = writtenOr(view, out);
      return "v" in done ? { text: view.text(PREPARE_NOTE.finished) } : done;
    },
  },
];
