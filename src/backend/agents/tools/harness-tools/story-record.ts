// The story record's tools on the harness engine (DEPTH2-PLAN §4, §5): the beats that happened and
// whom each reached, what reached one person, the cast, and the drafts kept until the story needs
// them. Each reads and writes through the call's story port (`HarnessTurn.story`): in a turn a change
// is staged with the turn and lands on its record as it commits; in a job it is written on the record
// of the turn the job belongs to. Nothing here moves the world: the story record is the reply's
// record's own part, outside every hash.
//
// Who may call which is held here, by the definition the calling agent runs as, whatever tools its
// definition lists (the bridge's gate holds `HARNESS_OWN_NEEDS` first):
// - `beat_write`: the author and the game master any beat; a character's agent only its own acts,
//   as the person it runs as (`ToolEnv.agent.as`): what they say, do or think, never what the world
//   does. Exposure left out is proposed from who is there (`inReach`): the author and the game
//   master confirm or adjust it before anything is written, since who caught what is theirs to
//   judge; a character's own act is written with it at once. A thought reaches no one.
// - `feed_read`: a character's agent, for the person it runs as, held to their casting by the mind
//   tools' own gate (`characterSelf`): what reached them since their mind last took things in, never
//   a beat's `what` unless the beat is their own.
// - `cast_set`: the author alone; a standing the player pinned is refused, and so is the player's
//   character, whose mind is the player's setting.
// - Every other: the author and the game master.
// Every limit is the player's (`story.limits`, `story.budget`), and every text is theirs to edit.

import { HARNESS_AGENT, HARNESS_FAMILY } from "../../../../shared/harness-texts";
import { RECORD_NOTE, RECORD_TOOL } from "../../../../shared/harness-texts-record";
import { hashParts } from "../../../../shared/hash";
import { isRecord, type JsonObject } from "../../../../shared/json";
import { BEAT_KINDS, BEAT_REACHES, type Beat, CAST_STANDINGS, type Draft, DRAFT_TIERS, type Exposure } from "../../../../shared/ledger";
import { calendarOf, clockOfStamp, formatStamp, placeOffset } from "../../../../engine/calendar";
import { placeOfEntity } from "../../../../engine/scope";
import { beatProblem, draftProblem, inReach, lengthProblem, type StoryProblem, type StoryProblemCode } from "../../../../engine/story/checks";
import { draftsDue } from "../../../../engine/story/drafts";
import { storyName } from "../../../../engine/story/feed";
import { beatOn, castOn, draftOn } from "../../../../engine/story/record";
import { budgetRefusal, overBudget } from "../../../story/budget";
import { feedFor } from "../../../story/feed";
import { characterSelf } from "../../../story/minds";
import type { StoryPort, StoryRead, StoryRefusal, StoryWritten } from "../../../story/record";
import type { ToolOutcome } from "../../runtime";
import type { HarnessTurn } from "../harness-turn";
import { boolArg, missing, wordsArg } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { resolvePerson, resolvePlace } from "../resolve";
import { argGiven, badValue, integer, intArg, jsonTextOf, needText, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, list, words } from "./kit";

const T = RECORD_TOOL;

/** Who calls a story tool, by the definition it runs as: the author (its turn's main agent, or the author's definition in a job), the game master, a character's agent, or anyone else. */
type Caller = "author" | "gm" | "character" | "other";

function callerOf(env: ToolEnv): Caller {
  if (env.turn?.main === true || env.agent.role === HARNESS_AGENT.author) return "author";
  if (env.agent.role === HARNESS_AGENT.gm) return "gm";
  return env.agent.role === HARNESS_AGENT.character ? "character" : "other";
}

/** The call's turn, its story port and the story as it reads now; or the answer that says the call reaches none. */
async function storyOf(view: ToolReadView, env: ToolEnv): Promise<{ turn: HarnessTurn; port: StoryPort; read: StoryRead } | ToolOutcome> {
  const turn = env.turn;
  const port = turn?.story;
  const read = port ? await port.read() : null;
  return turn && port && read ? { turn, port, read } : view.refuse(RECORD_NOTE.noRecord);
}

/** A person as the story record names them: "player" for the player's character (said as player, or by their id or name), else their entity's id; or the answer that says who isn't found. */
function storyPerson(view: ToolReadView, said: string): { id: string } | { refused: ToolOutcome } {
  if (said.trim().toLowerCase() === "player") return { id: "player" };
  const found = resolvePerson(view, said);
  return "refused" in found ? found : { id: storyName(found.id, view.pov) };
}

/** Each person a list argument names, as the story record names them; or the answer for the first not found. */
function storyPeople(view: ToolReadView, args: JsonObject, key: string): { ids: string[] } | { refused: ToolOutcome } {
  const ids: string[] = [];
  for (const said of wordsArg(args, key) ?? []) {
    const found = storyPerson(view, said);
    if ("refused" in found) return found;
    if (!ids.includes(found.id)) ids.push(found.id);
  }
  return { ids };
}

/** A person's name as the view names them, the player's character's for "player". */
function nameOf(view: ToolReadView, who: string): string {
  return view.name(who === "player" ? view.pov : who);
}

/** The story's clock now: the turn's, with what every agent staged on top, else the chat's head's. */
function nowOf(view: ToolReadView, turn: HarnessTurn): number {
  return (turn.whole?.() ?? view.state).clock;
}

/** Story time `at` as the tools write a time: YYYY-MM-DD HH:MM in the world's calendar, at the player character's place. */
function stampOf(view: ToolReadView, at: number): string {
  return formatStamp(calendarOf(view.world), at, placeOffset(view.world, at, placeOfEntity(view.state, view.world.pov)));
}

/** A time argument as story time (null: left out), read as `stampOf` writes one; or the answer that says how to write it. */
function timeArg(view: ToolReadView, args: JsonObject, key: string, now: number): number | null | ToolOutcome {
  const said = textArg(args, key);
  if (said === null) return null;
  const at = clockOfStamp(calendarOf(view.world), said);
  return at === null ? view.refuse(RECORD_NOTE.badWhen, { arg: key, now: stampOf(view, now) }) : at - placeOffset(view.world, at, placeOfEntity(view.state, view.world.pov));
}

const PROBLEM_NOTE: Readonly<Record<StoryProblemCode, string>> = { long: RECORD_NOTE.long, many: RECORD_NOTE.many, blank: RECORD_NOTE.blank, inner_reach: RECORD_NOTE.innerReach, reach_actor: RECORD_NOTE.reachActor, reach_twice: RECORD_NOTE.reachTwice, got_missing: RECORD_NOTE.gotMissing };

function problemAnswer(view: ToolReadView, problem: StoryProblem): ToolOutcome {
  return view.refuse(PROBLEM_NOTE[problem.code], problem.vars);
}

const REFUSAL_NOTE: Readonly<Record<StoryRefusal, string>> = { none: RECORD_NOTE.noRecord, closed: RECORD_NOTE.closed, off_path: RECORD_NOTE.offPath, no_basis: RECORD_NOTE.noBasis };

/** Where a change stands once written, in the player's words; or the answer that says why the record took none of it. */
function landed(view: ToolReadView, port: StoryPort, out: StoryWritten): string | ToolOutcome {
  return "refused" in out ? view.refuse(REFUSAL_NOTE[out.refused]) : view.text(port.staged ? RECORD_NOTE.staged : RECORD_NOTE.written);
}

/** Whom a beat reached, as a call gives it (a list, or JSON text of one); or the answer that says what to fix. */
function exposureArg(view: ToolReadView, raw: unknown): { exposure: Exposure[] } | { refused: ToolOutcome } {
  const given = typeof raw === "string" ? jsonTextOf(raw) : raw;
  if (!Array.isArray(given)) return { refused: missing(view, T.beatWrite, "exposure") };
  const exposure: Exposure[] = [];
  for (const entry of given) {
    if (!isRecord(entry) || typeof entry.who !== "string") return { refused: missing(view, T.beatWrite, "exposure.who") };
    const who = storyPerson(view, entry.who);
    if ("refused" in who) return who;
    const reach = BEAT_REACHES.find((r) => r === entry.reach);
    if (reach === undefined) return { refused: badValue(view, T.beatWrite, "exposure.reach", typeof entry.reach === "string" ? entry.reach : "", BEAT_REACHES) };
    const from = typeof entry.from === "string" && entry.from.trim() !== "" ? storyPerson(view, entry.from) : null;
    if (from && "refused" in from) return from;
    const got = typeof entry.got === "string" ? entry.got.trim() : "";
    exposure.push({ who: who.id, reach, ...(got !== "" ? { got } : {}), ...(from ? { from: from.id } : {}) });
  }
  return { exposure };
}

/** Holds a call to the author and the game master; null where it may. */
function authorOrGm(view: ToolReadView, env: ToolEnv, tool: string): ToolOutcome | null {
  const caller = callerOf(env);
  return caller === "author" || caller === "gm" ? null : view.refuse(RECORD_NOTE.notAuthorGm, { tool });
}

/** A draft as the answers show it: its time written as a time. */
function draftShown(view: ToolReadView, draft: Draft): Record<string, unknown> {
  return { id: draft.id, what: draft.what, tier: draft.tier, who: draft.who, ...(draft.where ? { where: draft.where } : {}), when: stampOf(view, draft.when), state: draft.state, ...(draft.notes !== undefined ? { notes: draft.notes } : {}) };
}

/** A beat as the author and the game master read it: all of it, its time written as a time. */
function beatShown(view: ToolReadView, beat: Beat): Record<string, unknown> {
  return { ...beat, time: stampOf(view, beat.at) };
}

/** Settles or drops the draft a call names: only an open one (or one gone stale). */
async function closeDraft(view: ToolReadView, env: ToolEnv, tool: string, args: JsonObject, state: "settled" | "dropped"): Promise<ToolOutcome> {
  const held = authorOrGm(view, env, tool);
  if (held) return held;
  const story = await storyOf(view, env);
  if ("text" in story) return story;
  const id = needText(view, tool, args, "draft");
  if (typeof id !== "string") return id;
  const on = draftOn(story.read.path, id);
  if (!on) return view.refuse(RECORD_NOTE.noDraft, { draft: id });
  if (on.draft.state === "settled" || on.draft.state === "dropped") return view.refuse(RECORD_NOTE.draftNotOpen, { draft: id, state: on.draft.state });
  const said = state === "dropped" ? needText(view, tool, args, "why") : (textArg(args, "notes") ?? "");
  if (typeof said !== "string") return said;
  const limits = story.turn.settings.story.limits;
  const long = lengthProblem(state === "dropped" ? "why" : "notes", said, state === "dropped" ? limits.whyChars : limits.draftChars);
  if (long) return problemAnswer(view, long);
  const lands = landed(view, story.port, await story.port.write({ drafts: [{ ...on.draft, state, ...(said !== "" ? { notes: said } : {}) }] }));
  if (typeof lands !== "string") return lands;
  return view.answer({ [state]: { draft: id, lands } });
}

export const RECORD_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: T.beatWrite,
    family: HARNESS_FAMILY.story,
    tier: "write",
    parameters: () =>
      objectSchema(
        {
          by: text(),
          kind: text(BEAT_KINDS),
          what: text(),
          surface: text(),
          quotes: words(),
          to: words(),
          where: text(),
          when: text(),
          exposure: list(objectSchema({ who: text(), reach: text(BEAT_REACHES), got: text(), from: text() }, ["who", "reach"])),
          settles: text(),
        },
        ["by", "kind", "what"],
      ),
    async run(args, env) {
      const view = await env.reader.view();
      const caller = callerOf(env);
      if (caller === "other") return view.refuse(RECORD_NOTE.notWriter, { tool: T.beatWrite });
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const { turn, port, read } = story;
      const bySaid = needText(view, T.beatWrite, args, "by");
      if (typeof bySaid !== "string") return bySaid;
      const actor = bySaid.toLowerCase() === "world" ? { id: "world" } : storyPerson(view, bySaid);
      if ("refused" in actor) return actor.refused;
      const by = actor.id;
      const kindSaid = needText(view, T.beatWrite, args, "kind");
      if (typeof kindSaid !== "string") return kindSaid;
      const kind = BEAT_KINDS.find((k) => k === kindSaid);
      if (kind === undefined) return badValue(view, T.beatWrite, "kind", kindSaid, BEAT_KINDS);
      // A character's agent writes only its own acts, as the person it runs as.
      if (caller === "character") {
        const as = env.agent.as;
        if (as === undefined) return view.refuse(RECORD_NOTE.noSelf);
        const self = storyName(as, view.pov);
        if (by !== self) return view.refuse(RECORD_NOTE.notOwn, { self: nameOf(view, self), other: by === "world" ? by : nameOf(view, by) });
        if (kind === "happen") return view.refuse(RECORD_NOTE.notOwnKind);
      }
      const what = needText(view, T.beatWrite, args, "what");
      if (typeof what !== "string") return what;
      const to = storyPeople(view, args, "to");
      if ("refused" in to) return to.refused;
      const state = turn.whole?.() ?? view.state;
      const placeSaid = textArg(args, "where");
      const place = placeSaid === null ? null : resolvePlace(view, placeSaid);
      if (place && "refused" in place) return place.refused;
      const where = place ? place.id : by === "world" ? null : placeOfEntity(state, by === "player" ? view.pov : by);
      const now = nowOf(view, turn);
      const when = timeArg(view, args, "when", now);
      if (when !== null && typeof when !== "number") return when;
      const at = when ?? now;
      const settles = textArg(args, "settles");
      if (settles !== null && !draftOn(read.path, settles)) return view.refuse(RECORD_NOTE.noDraft, { draft: settles });
      // Exposure left out: who is there. For the author and the game master it is proposed and nothing is written, since who caught what is their judgement. A person writing their own act knows only that they did it: theirs is written with who is there, which costs them no second call and is the author's to adjust. A thought reaches no one.
      let exposure: Exposure[] = [];
      if (argGiven(args, "exposure")) {
        const given = exposureArg(view, args.exposure);
        if ("refused" in given) return given.refused;
        exposure = given.exposure;
      } else if (kind !== "inner") {
        const there = inReach(view.registry, view.world, state, where, by);
        if (caller !== "character") return view.answer({ proposed: { by, kind, where, time: stampOf(view, at), exposure: there }, note: view.text(RECORD_NOTE.proposed) });
        exposure = there;
      }
      const quotes = wordsArg(args, "quotes") ?? [];
      const id = `b${hashParts("lre.story.beat", port.turn, by, kind, what, String(at)).slice(0, 12)}`;
      const beat: Beat = {
        id,
        turn: port.turn,
        at,
        where,
        by,
        kind,
        what,
        surface: textArg(args, "surface") ?? "",
        ...(quotes.length > 0 ? { quotes } : {}),
        ...(to.ids.length > 0 ? { to: to.ids } : {}),
        exposure,
        decidedBy: { agent: env.agent.role, ...(env.agent.as !== undefined ? { as: storyName(env.agent.as, view.pov) } : {}) },
        ...(settles !== null ? { settles } : {}),
      };
      const limits = turn.settings.story.limits;
      const problem = beatProblem(beat, limits);
      if (problem) return problemAnswer(view, problem);
      const own = read.own.beats;
      if (!own.some((b) => b.id === id) && own.length >= limits.beatsPerTurn) return view.refuse(RECORD_NOTE.full, { count: String(own.length), what: "beats" });
      const lands = landed(view, port, await port.write({ beats: [beat] }));
      if (typeof lands !== "string") return lands;
      return view.answer({ written: { beat: id, by, kind, where, time: stampOf(view, at), exposure, lands } });
    },
  },
  {
    name: T.beatsRead,
    family: HARNESS_FAMILY.story,
    tier: "read",
    parameters: () => objectSchema({ who: text(), where: text(), since: text(), struck: { type: "boolean" } }),
    async run(args, env) {
      const view = await env.reader.view();
      const held = authorOrGm(view, env, T.beatsRead);
      if (held) return held;
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const whoSaid = textArg(args, "who");
      const who = whoSaid === null ? null : storyPerson(view, whoSaid);
      if (who && "refused" in who) return who.refused;
      const placeSaid = textArg(args, "where");
      const place = placeSaid === null ? null : resolvePlace(view, placeSaid);
      if (place && "refused" in place) return place.refused;
      const now = nowOf(view, story.turn);
      const since = timeArg(view, args, "since", now);
      if (since !== null && typeof since !== "number") return since;
      const struck = boolArg(args, "struck") !== false;
      const fit = story.read.path.beats
        .map(({ beat }) => beat)
        .filter((b) => (who === null || b.by === who.id || (b.to ?? []).includes(who.id) || b.exposure.some((e) => e.who === who.id)) && (place === null || b.where === place.id) && (since === null || b.at >= since) && (struck || b.struck === undefined));
      const shown = fit.slice(-story.turn.settings.story.limits.beatsRead);
      return view.answer({ now: stampOf(view, now), beats: shown.map((b) => beatShown(view, b)), ...(fit.length > shown.length ? { earlier: fit.length - shown.length } : {}) });
    },
  },
  {
    name: T.beatStrike,
    family: HARNESS_FAMILY.story,
    tier: "write",
    parameters: () => objectSchema({ beat: text(), why: text() }, ["beat", "why"]),
    async run(args, env) {
      const view = await env.reader.view();
      const held = authorOrGm(view, env, T.beatStrike);
      if (held) return held;
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const id = needText(view, T.beatStrike, args, "beat");
      if (typeof id !== "string") return id;
      const why = needText(view, T.beatStrike, args, "why");
      if (typeof why !== "string") return why;
      const on = beatOn(story.read.path, id);
      if (!on) return view.refuse(RECORD_NOTE.noBeat, { beat: id });
      if (on.beat.struck !== undefined) return view.refuse(RECORD_NOTE.struckAlready, { beat: id, why: on.beat.struck });
      const long = lengthProblem("why", why, story.turn.settings.story.limits.whyChars);
      if (long) return problemAnswer(view, long);
      const lands = landed(view, story.port, await story.port.write({ struck: [{ beat: id, why }] }));
      if (typeof lands !== "string") return lands;
      return view.answer({ struck: { beat: id, why, by: on.beat.by, reached: on.beat.exposure, lands }, note: view.text(RECORD_NOTE.struck) });
    },
  },
  {
    name: T.feedRead,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    parameters: () => objectSchema({ after: text() }),
    async run(args, env) {
      const view = await env.reader.view();
      // A character's agent alone, for the person it runs as, as their casting allows.
      const self = await characterSelf(view, env, T.feedRead);
      if (!("who" in self)) return self;
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const after = textArg(args, "after");
      if (after !== null && !beatOn(story.read.path, after)) return view.refuse(RECORD_NOTE.noAfter, { beat: after });
      const feed = await feedFor(env, self.who, after ?? undefined);
      if (!feed) return view.refuse(RECORD_NOTE.noRecord);
      const note = feed.more > 0 ? view.text(RECORD_NOTE.feedMore, { more: String(feed.more) }) : feed.items.length === 0 ? view.text(RECORD_NOTE.feedNone) : undefined;
      return view.answer({ who: self.who, items: feed.items.map((item) => ({ ...item, time: stampOf(view, item.at) })), last: feed.last, ...(feed.more > 0 ? { more: feed.more } : {}), ...(note !== undefined ? { note } : {}) });
    },
  },
  {
    name: T.castSet,
    family: HARNESS_FAMILY.story,
    tier: "write",
    parameters: () => objectSchema({ who: text(), standing: text(CAST_STANDINGS), why: text() }, ["who", "standing", "why"]),
    async run(args, env) {
      const view = await env.reader.view();
      if (callerOf(env) !== "author") return view.refuse(RECORD_NOTE.notAuthor, { tool: T.castSet });
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const whoSaid = needText(view, T.castSet, args, "who");
      if (typeof whoSaid !== "string") return whoSaid;
      const who = storyPerson(view, whoSaid);
      if ("refused" in who) return who.refused;
      if (who.id === "player") return view.refuse(RECORD_NOTE.playerCast, { name: nameOf(view, who.id) });
      const standingSaid = needText(view, T.castSet, args, "standing");
      if (typeof standingSaid !== "string") return standingSaid;
      const standing = CAST_STANDINGS.find((s) => s === standingSaid);
      if (standing === undefined) return badValue(view, T.castSet, "standing", standingSaid, CAST_STANDINGS);
      const why = needText(view, T.castSet, args, "why");
      if (typeof why !== "string") return why;
      const long = lengthProblem("why", why, story.turn.settings.story.limits.whyChars);
      if (long) return problemAnswer(view, long);
      const cast = castOn(story.read.path, who.id);
      if (cast?.pinned === true) return view.refuse(RECORD_NOTE.pinned, { name: nameOf(view, who.id), standing: cast.standing });
      const lands = landed(view, story.port, await story.port.write({ cast: [{ ...cast, entity: who.id, standing, why }] }));
      if (typeof lands !== "string") return lands;
      return view.answer({ cast: { who: who.id, name: nameOf(view, who.id), standing, why, lands } });
    },
  },
  {
    name: T.castList,
    family: HARNESS_FAMILY.story,
    tier: "read",
    parameters: () => objectSchema({ standing: text(CAST_STANDINGS) }),
    async run(args, env) {
      const view = await env.reader.view();
      const held = authorOrGm(view, env, T.castList);
      if (held) return held;
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const standingSaid = textArg(args, "standing");
      const standing = standingSaid === null ? null : CAST_STANDINGS.find((s) => s === standingSaid);
      if (standingSaid !== null && standing === undefined) return badValue(view, T.castList, "standing", standingSaid, CAST_STANDINGS);
      return view.answer({ cast: story.read.path.cast.filter((c) => standing === null || c.standing === standing).map((c) => ({ ...c, name: nameOf(view, c.entity) })) });
    },
  },
  {
    name: T.draftOpen,
    family: HARNESS_FAMILY.story,
    tier: "write",
    parameters: () => objectSchema({ what: text(), tier: integer({ minimum: 1, maximum: 4 }), who: words(), where: words(), when: text(), notes: text() }, ["what", "tier", "when"]),
    async run(args, env) {
      const view = await env.reader.view();
      const held = authorOrGm(view, env, T.draftOpen);
      if (held) return held;
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const { turn, port, read } = story;
      const what = needText(view, T.draftOpen, args, "what");
      if (typeof what !== "string") return what;
      const tierSaid = intArg(args, "tier");
      const tier = DRAFT_TIERS.find((t) => t === tierSaid);
      if (tier === undefined) return argGiven(args, "tier") ? badValue(view, T.draftOpen, "tier", String(args.tier), DRAFT_TIERS.map(String)) : missing(view, T.draftOpen, "tier");
      const who = storyPeople(view, args, "who");
      if ("refused" in who) return who.refused;
      const where: string[] = [];
      for (const said of wordsArg(args, "where") ?? []) {
        const place = resolvePlace(view, said);
        if ("refused" in place) return place.refused;
        if (!where.includes(place.id)) where.push(place.id);
      }
      const when = timeArg(view, args, "when", nowOf(view, turn));
      if (when === null) return missing(view, T.draftOpen, "when");
      if (typeof when !== "number") return when;
      if (read.basis === null) return view.refuse(RECORD_NOTE.noBasis);
      const notes = textArg(args, "notes");
      const draft: Draft = { id: `d${hashParts("lre.story.draft", port.turn, what, String(when)).slice(0, 12)}`, what, tier, who: who.ids, ...(where.length > 0 ? { where } : {}), when, basis: read.basis, state: "open", ...(notes !== null ? { notes } : {}) };
      const { limits, budget } = turn.settings.story;
      const problem = draftProblem(draft, limits);
      if (problem) return problemAnswer(view, problem);
      const own = read.own.drafts;
      if (!own.some((d) => d.id === draft.id) && own.length >= limits.draftsPerTurn) return view.refuse(RECORD_NOTE.full, { count: String(own.length), what: "drafts" });
      // The same draft opened again in this turn is the one opened: it is counted once.
      const spent = overBudget({ ...read, path: { ...read.path, drafts: read.path.drafts.filter((d) => d.draft.id !== draft.id) } }, budget, { tier, at: when });
      if (spent) return budgetRefusal(view, spent);
      const lands = landed(view, port, await port.write({ drafts: [draft] }));
      if (typeof lands !== "string") return lands;
      return view.answer({ opened: { ...draftShown(view, draft), lands } });
    },
  },
  {
    name: T.draftSettle,
    family: HARNESS_FAMILY.story,
    tier: "write",
    parameters: () => objectSchema({ draft: text(), notes: text() }, ["draft"]),
    run: async (args, env) => closeDraft(await env.reader.view(), env, T.draftSettle, args, "settled"),
  },
  {
    name: T.draftDrop,
    family: HARNESS_FAMILY.story,
    tier: "write",
    parameters: () => objectSchema({ draft: text(), why: text() }, ["draft", "why"]),
    run: async (args, env) => closeDraft(await env.reader.view(), env, T.draftDrop, args, "dropped"),
  },
  {
    name: T.draftsDue,
    family: HARNESS_FAMILY.story,
    tier: "read",
    parameters: () => objectSchema({ all: { type: "boolean" } }),
    async run(args, env) {
      const view = await env.reader.view();
      const held = authorOrGm(view, env, T.draftsDue);
      if (held) return held;
      const story = await storyOf(view, env);
      if ("text" in story) return story;
      const now = nowOf(view, story.turn);
      const due = draftsDue(story.read.path, now, story.read.onPath, boolArg(args, "all") === true);
      const drafts = due.map((d) => {
        const stale = d.basisGone || d.beats.length > 0 || d.draft.state === "stale";
        return { ...draftShown(view, d.draft), due: d.due, ...(stale ? { stale: { basisGone: d.basisGone, beats: d.beats.map((b) => beatShown(view, b)), note: view.text(RECORD_NOTE.stale) } } : {}) };
      });
      return view.answer({ now: stampOf(view, now), drafts, ...(drafts.length === 0 ? { note: view.text(RECORD_NOTE.noDue) } : {}) });
    },
  },
];
