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
import { PREPARE_NOTE, PREPARE_PATH, PREPARE_TOOL } from "../../../../shared/harness-texts-prepare";
import { RECORD_NOTE } from "../../../../shared/harness-texts-record";
import { hashParts } from "../../../../shared/hash";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { BEAT_KINDS, BEAT_REACHES, type Beat, type Exposure } from "../../../../shared/ledger";
import { loreSourceOf } from "../../../../shared/lore";
import { calendarOf, clockOfStamp, formatStamp, placeOffset } from "../../../../engine/calendar";
import { own } from "../../../../engine/pack-kit";
import { isGone, placeOfEntity } from "../../../../engine/scope";
import { beatProblem, type StoryProblemCode } from "../../../../engine/story/checks";
import { storyName } from "../../../../engine/story/feed";
import type { StoryPath } from "../../../../engine/story/record";
import { readSlice } from "../../../../packs/minds/core/state";
import type { HostBookEntry, HostMessage } from "../../../host";
import { mindPath } from "../../../story/minds";
import { byNumber, CALL_NOTE, callWeight, chatKind, estimateOf, messageTokens, planStretches, preparationLeft, type PrepareFile, type PrepareState, type PrepareStretch, readPrepare, reachedBy, reckonLeft, relivingNow, spanOf, type StretchAsked, stretchMessages, stretchStands, type Updated, updatePrepare, waits, wordFor } from "../../../story/prepare";
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

/** The preparation as its file holds it; or the answer for a file with no plan, or one whose record can't be read. */
function planIn(view: ToolReadView, file: PrepareFile): PrepareState | ToolOutcome {
  if (file.damaged) return view.refuse(PREPARE_NOTE.damaged);
  return file.state ?? view.refuse(PREPARE_NOTE.noPlan);
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

/** A summary LumiBooks keeps in a World Info book: its level, its title, and the messages it spans, with the id lore_read takes. */
interface Summary {
  id: string;
  level: "volume" | "arc" | "chapter";
  title: string;
  from: number;
  to: number;
}

/** "msgs 31-40" in a LumiBooks entry's comment: counted from 1. */
const MSGS = /\bmsgs?\s+(\d+)\s*[-–]\s*(\d+)/i;
/** A title that names a summary of the story, where no LumiBooks mark says so. */
const SUMMARY_TITLE = /\b(summary|summaries|recap|story so far|previously)\b/i;

/** A LumiBooks summary, as its entry's marks say it (`lumibooks_summary`, `lumibooks`, or its comment's message numbers); null for an entry that isn't one. */
function summaryOf(entry: HostBookEntry): Summary | null {
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
  return { id: `${entry.bookId}/${entry.id}`, level, title: comment || (typeof shelf?.title === "string" ? shelf.title : "") || entry.id, from: range[0], to: range[1] };
}

/** The chat's messages no summary spans, as runs of numbers. */
function uncovered(messages: readonly HostMessage[], summaries: readonly Summary[]): string[] {
  const runs: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  for (const m of [...messages].sort((a, b) => a.index - b.index)) {
    const covered = summaries.some((s) => s.from <= m.index && m.index <= s.to);
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

async function survey(view: ToolReadView, env: ToolEnv, turn: HarnessTurn, files: HarnessFiles, part: string | null): Promise<JsonObject> {
  const want = (p: (typeof PARTS)[number]): boolean => part === null || part === p;
  const out: JsonObject = {};
  const messages = want("chat") || want("summaries") ? await turn.host.chats.messages(env.chatId, env.userId) : [];
  if (want("chat")) {
    const players = messages.filter((m) => m.isUser).length;
    const numbers = messages.map((m) => m.index);
    out.chat = { messages: messages.length, ...(numbers.length > 0 ? { first: `#${Math.min(...numbers)}`, last: `#${Math.max(...numbers)}` } : {}), player: players, replies: messages.length - players, tokens: messages.reduce((sum, m) => sum + messageTokens(m.content), 0), kind: chatKind(messages) };
  }
  const entries = want("summaries") || want("lore") ? await view.bookEntries() : [];
  if (want("summaries")) {
    const lumibooks = entries.flatMap((e) => summaryOf(e) ?? []).sort((a, b) => a.from - b.from || b.to - a.to);
    const others = entries.filter((e) => summaryOf(e) === null && SUMMARY_TITLE.test(e.comment)).map((e) => ({ id: `${e.bookId}/${e.id}`, title: e.comment.trim() }));
    out.summaries = { lumibooks: lumibooks.map((s) => ({ id: s.id, level: s.level, title: s.title, messages: spanOf(s) })), ...(lumibooks.length > 0 ? { notCovered: uncovered(messages, lumibooks) } : {}), others };
  }
  if (want("lore")) {
    const authored = Object.values((await view.lore()).lore).filter((e) => loreSourceOf(e.source).kind !== "book").length;
    const names = new Map((await turn.host.books.list(env.userId)).map((b) => [b.id, b.name]));
    const counts = new Map<string, { entries: number; summaries: number }>();
    for (const e of entries) {
      const held = counts.get(e.bookId) ?? { entries: 0, summaries: 0 };
      counts.set(e.bookId, { entries: held.entries + 1, summaries: held.summaries + (summaryOf(e) === null ? 0 : 1) });
    }
    out.lore = { world: authored, books: [...counts].map(([id, c]) => ({ book: names.get(id) ?? id, entries: c.entries, summaries: c.summaries })) };
  }
  if (want("world")) {
    const people = Object.keys(view.state.entities)
      .filter((id) => view.isPerson(id) && view.seesEntity(id) && !isGone(view.state, id))
      .map((id) => {
        const at = placeOfEntity(view.state, id);
        return { id, name: view.entity(id)?.name ?? id, ...(at ? { at: view.place(at)?.name ?? at } : {}), ...(id === view.pov ? { player: true } : {}) };
      });
    out.world = { player: { id: view.pov, name: nameOf(view, "player") }, people, places: Object.keys(view.world.places).length };
  }
  if (want("engine")) {
    const read = turn.story ? await turn.story.read() : null;
    const listed = await files.list("");
    const minds = listed.flatMap((f) => {
      const folder = /(?:^|\/)minds\/([^/]+)\/core\.md$/.exec(f.path)?.[1];
      return folder === undefined ? [] : [decodeURIComponent(folder)];
    });
    const file = await readPrepare(files);
    out.engine = {
      now: stampOf(view, view.state.clock),
      ...(read ? { cast: read.path.cast.map((c) => ({ id: c.entity, name: nameOf(view, c.entity), standing: c.standing })), beats: { all: read.path.beats.length, past: read.path.beats.filter((b) => b.beat.past !== undefined).length } } : {}),
      minds: minds.map((id) => ({ id, name: nameOf(view, id) })),
      olderMinds: Object.keys(readSlice(view.state).chars).map((id) => ({ id, name: nameOf(view, id) })),
      preparation: file.damaged ? "damaged" : file.state === null ? "none" : file.state.done !== null ? "done" : waits(file.state) ? "waits for the player's word" : "under way",
    };
  }
  return out;
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
    out.push({ from, to, why, who });
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
    parameters: () => objectSchema({ part: text(PARTS) }),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const part = textArg(args, "part");
      if (part !== null && !(PARTS as readonly string[]).includes(part)) return badValue(view, T.survey, "part", part, PARTS);
      return view.answer(await survey(view, env, turn, files, part));
    },
  },
  {
    name: T.status,
    family: HARNESS_FAMILY.prepare,
    tier: "read",
    parameters: () => objectSchema({ stretch: text() }),
    async run(args, env) {
      const ready = await prepared(env);
      if (!("view" in ready)) return ready;
      const { view, turn, files } = ready;
      const state = planIn(view, await readPrepare(files));
      if (!("v" in state)) return state;
      const read = turn.story ? await turn.story.read() : null;
      const name = (id: string): string => state.principals.find((p) => p.id === id)?.name ?? id;
      const asked = textArg(args, "stretch");
      if (asked !== null) {
        const s = state.stretches.find((x) => x.id === asked);
        if (!s) return view.refuse(PREPARE_NOTE.noStretch, { stretch: asked });
        const beats = read ? stretchBeats(read.path, s) : [];
        const reached = read ? reachedBy(read.path, beats.map((b) => b.id), state.principals.map((p) => p.id)) : [];
        const reliving = read ? relivingNow(read.path, reached) : [];
        return view.answer({ stretch: s.id, messages: spanOf(s), why: s.why, relivedBy: s.who.map(name), state: s.state, beats: beats.length, ...(s.through !== null ? { through: `#${s.through}` } : {}), reached: reached.map(name), stillToRelive: reliving.map(name) });
      }
      const has = async (path: string): Promise<boolean> => (await files.read(path)) !== null;
      const principals = await Promise.all(state.principals.map(async (p) => ({ id: p.id, name: p.name, why: p.why, core: await has(mindPath(p.id, "core")), outline: await has(mindPath(p.id, "outline")) })));
      const reliving = read ? relivingNow(read.path, state.principals.map((p) => p.id)) : [];
      const spent = (await turn.job?.spent?.()) ?? null;
      return view.answer({
        status: state.done !== null ? "done" : waits(state) ? "waits for the player's word" : "under way",
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
        ...(state.word.said.length > 0 ? { playerSaid: state.word.said } : {}),
        ...(waits(state) ? { note: view.text(PREPARE_NOTE.waits, { estimate: estimateOf(state).toLocaleString("en-US"), ceiling: state.word.ceiling.toLocaleString("en-US") }) } : {}),
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
          stretches: list(objectSchema({ from: integer({ minimum: 0 }), to: integer({ minimum: 0 }), why: text(), who: words() }, ["from", "to"])),
          fills: text(),
          estimate: integer({ minimum: 0 }),
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
      const long = fits(view, "about", about, limits.textChars) ?? fits(view, "fills", fills, limits.textChars);
      if (long) return long;
      const principals = principalsArg(view, args, limits.textChars);
      if (!Array.isArray(principals)) return principals;
      const asked = stretchesArg(view, args, principals, limits.textChars);
      if (!Array.isArray(asked)) return asked;
      const author = intArg(args, "estimate") ?? 0;
      // What the preparation has spent so far, as LumiAH counts it, and what one of its model calls weighs: the rest of the plan is reckoned at that.
      const spent = (await turn.job?.spent?.()) ?? null;
      const call = callWeight(spent, limits);
      const messages = await turn.host.chats.messages(env.chatId, env.userId);
      const kind = chatKind(messages);
      if (kind === "new" && asked.length > 0) return view.refuse(PREPARE_NOTE.newChat);
      const numbered = byNumber(messages);
      // Where the scene and the notebook stood when the first plan was written: the preparation finishes once each was written since.
      const [scene, notebook] = await Promise.all([files.read(AUTHOR_FILE.scene), files.read(AUTHOR_FILE.notebook)]);
      let splits: { from: number; to: number; count: number }[] = [];
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (now) => {
        const before = now.state;
        const planned = planStretches(asked, numbered, limits.stretchMessages, before?.stretches ?? [], { readChars: limits.readChars, call: call.tokens });
        if ("problem" in planned) return { stop: view.refuse(planned.problem.id, planned.problem.vars) };
        splits = planned.splits;
        const draft = { kind, stretches: planned.stretches, principals };
        const reckoned = (spent?.tokens ?? 0) + reckonLeft(draft, call.tokens);
        return {
          v: 1,
          kind,
          about,
          principals,
          stretches: planned.stretches,
          fills,
          estimate: { author, reckoned, call: call.tokens, from: call.from },
          word: wordFor(Math.max(author, reckoned), limits.askAboveTokens, before?.word ?? null),
          done: null,
          marks: before?.marks ?? { scene: scene?.version ?? null, notebook: notebook?.version ?? null },
        };
      });
      const state = writtenOr(view, out);
      if (!("v" in state)) return state;
      const estimate = estimateOf(state).toLocaleString("en-US");
      const note = waits(state) ? view.text(PREPARE_NOTE.waits, { estimate, ceiling: state.word.ceiling.toLocaleString("en-US") }) : view.text(PREPARE_NOTE.stands, { estimate });
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
      const [messages, path] = drop ? [[], null] : await Promise.all([turn.host.chats.messages(env.chatId, env.userId), pathOf(view, turn)]);
      if (path !== null && !("beats" in path)) return path;
      const numbered = byNumber(messages);
      // What the cap is held to: what the preparation has spent so far, as LumiAH counts it.
      const used = drop ? 0 : (((await turn.job?.spent?.()) ?? null)?.tokens ?? 0);
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (now) => {
        const state = planIn(view, now);
        if (!("v" in state)) return { stop: state };
        const s = state.stretches.find((x) => x.id === id);
        if (!s) return { stop: view.refuse(PREPARE_NOTE.noStretch, { stretch: id }) };
        if (s.state === "recorded") return { stop: view.refuse(PREPARE_NOTE.recordedAlready, { stretch: s.id }) };
        if (s.state === "dropped") return { stop: view.refuse(PREPARE_NOTE.droppedAlready, { stretch: s.id }) };
        const changed = (next: PrepareStretch): PrepareState => ({ ...state, stretches: state.stretches.map((x) => (x.id === s.id ? next : x)) });
        if (drop) return changed({ ...s, state: "dropped" });
        if (s.state === "open") return { stop: view.answer({ stretch: s.id, note: view.text(PREPARE_NOTE.openAlready, { stretch: s.id, span: spanOf(s), through: String(s.through ?? s.from - 1) }) }) };
        if (waits(state)) return { stop: view.refuse(PREPARE_NOTE.waits, { estimate: estimateOf(state).toLocaleString("en-US"), ceiling: state.word.ceiling.toLocaleString("en-US") }) };
        const before = state.stretches.find((x) => x.from < s.from && (x.state === "planned" || x.state === "open"));
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
      const numbered = byNumber(await turn.host.chats.messages(env.chatId, env.userId));
      if (!stretchStands(numbered, s)) return view.refuse(PREPARE_NOTE.chatChanged, { stretch: s.id, span: spanOf(s) });
      const start = Math.min(s.to + 1, Math.max(s.from, intArg(args, "from") ?? (s.through ?? s.from - 1) + 1));
      const most = turn.settings.story.prepare.readChars;
      const read: JsonObject[] = [];
      let used = 0;
      let next: number | null = null;
      for (const m of stretchMessages(numbered, start, s.to)) {
        if (read.length > 0 && used + m.content.length > most) {
          next = m.index;
          break;
        }
        // A message longer than one read gives is given cut, whole up to what a read holds.
        const text = m.content.length > most ? `${m.content.slice(0, most)}…` : m.content;
        used += text.length;
        read.push({ n: m.index, by: m.name, player: m.isUser, text });
      }
      const path = turn.story ? await turn.story.read() : null;
      const lastPast = path?.path.beats.findLast((b) => b.beat.past !== undefined && b.beat.struck === undefined);
      const names = s.who.map((p) => state.principals.find((x) => x.id === p)?.name ?? p);
      return view.answer({
        stretch: s.id,
        messages: spanOf(s),
        why: s.why,
        relivedBy: names,
        now: stampOf(view, view.state.clock),
        ...(lastPast ? { lastRecorded: stampOf(view, lastPast.beat.at) } : {}),
        read,
        note: next === null ? view.text(PREPARE_NOTE.readEnd) : view.text(PREPARE_NOTE.readMore, { next: String(next) }),
      });
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
        return { ...state, stretches: state.stretches.map((x) => (x.id === s.id ? { ...x, state: "recorded", beats } : x)) };
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
        if ("version" in written) return { text: view.text(PREPARE_NOTE.outlined, { name: principal.name }) };
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
      // What a first turn needs, each checked: nothing left of the plan, every principal's past taken in, their core and (with a past) their outline written, the scene and the notebook written since the plan.
      const left = await preparationLeft(files, state, read?.path ?? null, turn.settings.prompts.texts);
      if (left.length > 0) return view.refuse(PREPARE_NOTE.unfinished, { left: left.join("; ") });
      const out = await updatePrepare<ToolOutcome>(files, turn.settings.prompts.texts, (fresh) => {
        const current = planIn(view, fresh);
        return "v" in current ? { ...current, done: note } : { stop: current };
      });
      const done = writtenOr(view, out);
      return "v" in done ? { text: view.text(PREPARE_NOTE.finished) } : done;
    },
  },
];
