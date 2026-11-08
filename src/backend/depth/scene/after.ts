// Right after a depth reply (DEPTH-PLAN §2.4, §4.4, §5.2, §5.3, §6.4): what reads the reply runs at the
// reply's basis and lands there as basis-anchored layer entries (§4.9), so a swipe of the reply takes
// all of it along and a switch back restores it. Its caller starts it from the commit and never awaits
// it there: every read and landing here runs on the ledger's queue. The end of a real-time talk the
// player left, and a clock he moved on, run it too, at the chat's last message (`occasion`).
//
//   1. remember    each character holding takes at the reply writes what it keeps of its scene, in
//                  its own voice (A2b's `rememberAfterReply`): this turn's players, and anyone whose
//                  scene ended without playing in it (a talk the author or the player ended, a
//                  remembering that failed before); a character whose real-time talk still runs keeps
//                  it open, in its working memory, until the talk ends or its takes reach the cap
//   2. truth-link  the GM files the facts the turn's beats establish and links what those who just
//                  remembered now believe (A1c's `truthLink`, `linkTruths`), at the GM's answer room
//                  (Settings → Depth) grown with what it reads, as the bootstrap's; the player
//                  character's holdings come from the beats that reached him
//   3. poll        unless a conversation defers it (a timelapse wakes it all the same), the author's
//                  poll (§6.4) over everything since it last looked: every live beat, and the story
//                  time that passed with the timelapses among it. Who catches up now and who reflects,
//                  its own reflection, its open predictions scored, what happens off screen (the
//                  episodes it opens, the drafts it settles, drops or rebases, read beside the open
//                  drafts and the budget dial's allowances, §4.6, §6.5), and its log of what it
//                  considered; the record and the scores land as one entry
//   4. jobs        the catch-ups the poll asked for, then the reflections, then the GM's truth link of
//                  what they wrote, then off screen (drops, rebases, settlements and their catch-ups,
//                  then the episodes drafted at their treatments, `offscreen/jobs.ts`), then the
//                  author's own reflection where Settings → Depth → Notebook revisions lets it through
//                  (a bound on how often the author is asked, never a judgment of what moved): its
//                  notebook revision, drift checks and predictions land as one entry
//
// The judgments are the agents'; this keeps the order, the facts each reads and the landing. A step
// that fails is said and the rest go on: a remember that failed keeps its takes for the next try, and
// a poll that couldn't be read decides nothing. With Settings → Depth's background lanes off only
// steps 1 and 2 run, and the rest waits for the next poll, which reads everything since the last.

import { AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, AUTHOR_SPEND, authorData, driftEvent, pollEvent, predictEvent, predictionId, scoreEvent, spendEvent, type PollConsidered, type PollData, type PollJob, type PredictData, type ScoreData } from "../../../shared/author";
import { exposedBeats, hasAgent, MIND_FILE_NAMES, MIND_INTERVIEW, mindedAt, mindFileOf, mindInterviewOf, mindV2At, mindWriteEvent, pendingFor, povOf, reachOf, takersAt, takesOf, writtenFromGone } from "../../../shared/character-engine";
import { DEPTH_CADENCE_LABEL, type DepthCadence } from "../../../shared/depth-settings";
import type { ChatId, EntityId, UserId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import type { Basis, LandResult } from "../../../shared/layer";
import { planWords } from "../../../shared/minds";
import { beatPeople, type Beat } from "../../../shared/story";
import { STORY_TALK, talkNow } from "../../../shared/talk";
import type { WorldDoc } from "../../../shared/world";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { layerEntryId } from "../../../engine/ledger/layer";
import { notebookOf } from "../../../engine/notebook";
import { own } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";
import { openPlans, readSlice } from "../../../packs/minds/core/state";
import { catchUpNow, interviewMind, land, portFor, readMind, reflectNow, type EngineRt } from "../../character-engine";
import type { BasisRead } from "../../ledger-io";
import { ceilingBinds, costTokens, daySpendOf } from "../budget";
import { beatTexts, twice } from "../common";
import { readNotebook } from "../notebook";
import { readPaged } from "../paging";
import type { ModelPort } from "../port";
import { linkTruths } from "../truth-link";
import type { ArchiveSource } from "../archive-tools";
import { authorPoll, authorReflect, namesOf, tag, type Names, type OffscreenFacts, type PendingLine, type PollResult } from "./author";
import type { AfterReply } from "./contract";
import { rememberAfterReply } from "./remember";
import { ASK_TYPES } from "../offscreen/asks";
import { DRAFT_TYPES } from "../offscreen/drafts";
import { offscreenFacts, offscreenJobs, type JobsRt, type OffscreenOut } from "../offscreen/jobs";
import { episodeOf, type OffscreenPlugs } from "../offscreen/episode";
import { metered, spendData } from "../spend";
import { chatBudget } from "../chat-allowances";

/** What the after-reply step reads of the runtime: the Character Engine's, the fold at a basis with the live events it asks for, the chain's bases, and the chat's own layer for the world beyond view (`Runtime` is one). */
export type AfterRt = JobsRt;

export interface AfterOptions {
  /** Every model call, each role on its Settings → Depth row (the user's own port by default). */
  model?: ModelPort;
  signal?: AbortSignal;
  /** The chat's archive through the reply this follows (`chatArchive`): the author's poll and reflection read it in JSON rounds before they answer. */
  archive?: ArchiveSource;
  /** The scene's stages an off-screen episode borrows (a character's play, the GM's resolution); the real ones by default. */
  plugs?: OffscreenPlugs;
  /** What runs it besides the reply's commit, at that reply or the chat's last message: the end of a real-time talk the player left, or the clock he moved on. Its own entries' ids name it, so they land beside the reply's. */
  occasion?: string;
  /** Story time that passed outside any turn, landed at the basis (the clock moved on, its minutes and why): it wakes the poll, which reads it beside what passed since it last looked, its minutes counted once (a poll that hasn't read through the basis yet already counts them there). */
  woken?: { minutes: number; why: string };
  /** Called once what the next turn reads is in (the remembering, its truth links and the catch-ups the poll asked for now): a turn waiting for it goes on from here, while reflections and the work off screen run on (DEPTH-PLAN §6). */
  ready?: () => void;
  /** Set on the one extra poll a settlement the off-screen jobs landed wakes: remembering and the turn's truth links are skipped, and it wakes nothing more. */
  wakeRound?: true;
}

/** What the after-reply step did. */
export interface AfterOut {
  remembered: EntityId[];
  /** The GM's truth links landed (or wait behind a turn in flight). */
  linked: boolean;
  /** The jobs the poll asked for that ran, as its record keeps them; null when no poll ran or its answer couldn't be read. */
  jobs: PollJob[] | null;
  caughtUp: EntityId[];
  reflected: EntityId[];
  /** The author's own reflection, when it landed. */
  authorReflected: "scene" | "chapter" | null;
  /** Each step that failed, in words; the others ran all the same. */
  failed: string[];
  /** What the off-screen jobs did; null when none ran. */
  offscreen: OffscreenOut | null;
  /** What a ceiling put off (§6.5), a line each: kept in the step's `author.spend` for the treatment log. */
  put: string[];
}

/** Plans falling due that the poll is told of: those under way or starting within this many story minutes. A prompt's bound, not a judgment. */
const DUE_WITHIN = 24 * 60;
/** The longest memory, newest point of view and the like the poll reads of each, in characters (the record keeps them whole). */
const KEPT_CHARS = 1500;
const LATEST_CHARS = 240;
/** What the step puts off with Settings → Depth's background lanes off, in one line. */
export const BACKGROUND_OFF = "The author's poll, with the catch-ups, reflections, the world off screen and the notebook it asks for: Background lanes are off (Settings → Depth → Background lanes)";

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * What the poll reads since it last looked (§6.4), at a fold through `basis`: every live beat on the
 * chain after the reply the last live poll read (from the first beat a turn decided where none ran),
 * newest kept, but the bootstrap's and an imported entry's, which the author read as it onboarded the
 * chat; the story minutes that passed there (every clock move, the scene's and a timelapse's alike);
 * each timelapse the player ran there, in words; and whether it reads the basis's own message (no
 * poll read through it yet). Facts, never a filter of what matters.
 */
function sinceLastPoll(at: Pick<BasisRead, "world" | "story" | "events">, bases: readonly Basis[], basis: Basis, most: number): { beats: Beat[]; minutes: number; spans: string[]; readsBasis: boolean } {
  const order = new Map(bases.map((b, i) => [b.message, i]));
  const place = (m: string): number => order.get(m) ?? -1;
  const through = at.events?.flatMap((e) => authorData<PollData>(e.event, AUTHOR_POLL)?.through ?? []).at(-1);
  const decided = at.story.beats.find((p) => "turn" in p.beat.by)?.from.messageId;
  const from = through !== undefined && order.has(through) ? place(through) + 1 : decided !== undefined ? place(decided) : place(basis.message);
  const beats = at.story.beats.filter((p) => place(p.from.messageId) >= from && !("bootstrap" in p.beat.by) && !("entry" in p.beat.by)).slice(-most).map((p) => p.beat);
  const cal = calendarOf(at.world);
  let minutes = 0;
  const spans: { from: number; to: number; stopped: string | null }[] = [];
  for (const e of at.events ?? []) {
    if (place(e.from.messageId) < from) continue;
    if (e.event.type === "clock") minutes += e.event.minutes;
    else if (e.event.type === "timelapse") {
      // A long run lands in segments, each from where the one before it ended.
      const last = spans.at(-1);
      if (last && e.event.segment > 1 && last.to === e.event.from) Object.assign(last, { to: e.event.to, stopped: e.event.stoppedBy });
      else spans.push({ from: e.event.from, to: e.event.to, stopped: e.event.stoppedBy });
    }
  }
  return { beats, minutes, spans: spans.map((s) => `a timelapse the player ran, from ${formatClock(cal, s.from)} to ${formatClock(cal, s.to)}${s.stopped !== null ? ` (stopped early: ${s.stopped})` : ""}`), readsBasis: from <= place(basis.message) };
}

/**
 * Why Settings → Depth → Notebook revisions holds back the author's own reflection now, or null when
 * it lets it through: "After any turn" lets every one through; "At a scene's end" only once the scene
 * ended; "At a chapter's end" only a chapter's re-read.
 */
export function cadenceHolds(cadence: DepthCadence, depth: "scene" | "chapter", sceneEnded: boolean): string | null {
  if (cadence === "scenes" && !sceneEnded) return `Settings → Depth → Notebook revisions is “${DEPTH_CADENCE_LABEL.scenes}”, and the scene goes on.`;
  if (cadence === "chapters" && depth !== "chapter") return `Settings → Depth → Notebook revisions is “${DEPTH_CADENCE_LABEL.chapters}”.`;
  return null;
}

// Asked again once when an answer can't be read, and beats with their texts: shared with the edit's directive and the world beyond view.
export { beatTexts, twice };

/** The memories the turn's remembering wrote, in their writers' words: what they said will stay with them, or won't. */
async function keptOf(rt: Pick<EngineRt, "blobs">, userId: UserId, entries: readonly LandResult[]): Promise<{ who: EntityId; text: string }[]> {
  const out: { who: EntityId; text: string }[] = [];
  for (const r of entries) {
    if (r.status !== "landed") continue;
    for (const e of r.entry.events) {
      const w = mindWriteEvent(e);
      if (!w || mindFileOf(w.path)?.kind !== "memory") continue;
      const text = (await rt.blobs.get(userId, w.hash))?.trim() ?? "";
      if (text !== "") out.push({ who: w.who, text: clip(text, KEPT_CHARS) });
    }
  }
  return out;
}

/** Plans under way or falling due within `DUE_WITHIN`, soonest first, the first `most` (Settings → Depth's `reads.due`, a prompt's bound), in words; a plan everyone in it shares, once. */
function dueOf(world: WorldDoc, state: Readonly<WorldState>, names: Names, most: number): string[] {
  const cal = calendarOf(world);
  const seen = new Set<string>();
  const due: { at: number; text: string }[] = [];
  for (const [who, c] of Object.entries(readSlice(state).chars)) {
    if (!hasOwn(state.entities, who)) continue;
    for (const p of openPlans(c)) {
      if (seen.has(p.id) || p.when.to <= state.clock || p.when.from > state.clock + DUE_WITHIN) continue;
      seen.add(p.id);
      const where = p.where !== null ? ` at ${own(world.places, p.where)?.name ?? p.where}` : "";
      const others = p.with.filter((x) => x !== who);
      due.push({ at: p.when.from, text: `${tag(names, who)}: ${planWords(p, who)}, ${formatClock(cal, p.when.from)}${where}${others.length > 0 ? `, with ${others.map((x) => tag(names, x)).join(", ")}` : ""}` });
    }
  }
  return due
    .sort((a, b) => a.at - b.at)
    .slice(0, most)
    .map((d) => d.text);
}

/** What each character with an agent has waiting to be lived, as the poll reads it. */
async function pendingOf(rt: Pick<EngineRt, "blobs">, userId: UserId, at: Pick<BasisRead, "world" | "state" | "story">, played: readonly EntityId[], takesKept: number): Promise<PendingLine[]> {
  const { beats } = exposedBeats(at.story);
  const replaced = new Set(at.story.replaced.map((r) => r.id));
  const out: PendingLine[] = [];
  for (const who of mindedAt(at.state)) {
    if (!hasAgent(at.world, at.state, who)) continue;
    const mind = mindV2At(at.state, who);
    const waiting = pendingFor(beats, mind, who);
    // The files a retcon put out of mind (written from a beat since amended or struck, with no verdict since): the poll decides whether a reflection rewrites them.
    // A file a reflection wrote is flagged apart: rerunning the reflection, not a catch-up, rewrites it.
    const gone = Object.entries(mind.files).flatMap(([path, m]) => (writtenFromGone(m, mind, replaced) ? [m.mode === "reflect" ? `${path} (written by a reflection)` : path] : []));
    // A mind near the count that calls its remembering asks for a reflection (§4.4): the poll hears how full it is.
    const takes = takesOf(at.state, who).length;
    const near = takes >= Math.floor((takesKept * 3) / 4);
    const newest = waiting[waiting.length - 1];
    // Its own ask, from its play, to take stock (§4.4, Reflect "or when it asks"): the poll decides.
    const asks = mind.asks?.why;
    if (!newest && gone.length === 0 && !near && asks === undefined) continue;
    const reach = newest ? reachOf(newest, who) : null;
    const latest = reach ? ((await rt.blobs.get(userId, reach.text))?.trim() ?? "") : "";
    out.push({ who, pending: waiting.length, ...(latest !== "" ? { latest: clip(latest, LATEST_CHARS) } : {}), played: played.includes(who), ...(gone.length > 0 ? { gone } : {}), ...(near ? { takes } : {}), ...(asks !== undefined ? { asks } : {}) });
  }
  // Whoever the story reached who has no mind yet (someone met from afar, on a call, by a rumor): listed too, so the poll may catch them up, which forms their mind first (`catchUpNow`).
  const minded = new Set(mindedAt(at.state));
  const unminded = [...new Set(beats.flatMap((b) => b.exposure.map((x) => x.who)))].filter((who) => !minded.has(who) && hasOwn(at.state.entities, who) && hasAgent(at.world, at.state, who));
  for (const who of unminded) {
    const waiting = pendingFor(beats, mindV2At(at.state, who), who);
    if (waiting.length > 0) out.push({ who, pending: waiting.length, played: false, unminded: true });
  }
  return out;
}

/** The answers to the author's interviews since its last poll (§4.4, Interview), each with its question, in fold order: the poll reads what it asked. */
async function answersSince(rt: Pick<EngineRt, "blobs">, userId: UserId, at: Pick<BasisRead, "events">): Promise<{ who: EntityId; question: string; answer: string }[]> {
  const events = at.events ?? [];
  const last = events.reduce((n, e, i) => (authorData<PollData>(e.event, AUTHOR_POLL) ? i : n), -1);
  const out: { who: EntityId; question: string; answer: string }[] = [];
  for (const e of events.slice(last + 1)) {
    if (e.event.type !== MIND_INTERVIEW || !("data" in e.event)) continue;
    const d = mindInterviewOf(e.event.data);
    if (typeof d === "string" || d.by !== "author") continue;
    out.push({ who: d.who, question: clip((await rt.blobs.get(userId, d.question)) ?? "", LATEST_CHARS), answer: clip((await rt.blobs.get(userId, d.answer)) ?? "", LATEST_CHARS) });
  }
  return out;
}

/** The turns since the last chapter the author closed, through `basis`: replies holding a turn record. */
function turnsSince(bases: readonly Basis[], basis: Basis, through: string | null): number {
  const upTo = bases.findIndex((b) => b.message === basis.message);
  const from = through === null ? -1 : bases.findIndex((b) => b.message === through);
  return bases.slice(from + 1, upTo + 1).filter((b) => b.swipe.startsWith("r")).length;
}

/**
 * Runs everything that follows a depth reply, at its `basis`, as `after` (the turn's `DepthTurnResult.after`)
 * says. Each step starts only while no ceiling binds (§6.5): the turn's (its scene's spend, `after.spent`,
 * and this step's so far) and today's; what a ceiling puts off is said, and what the step spent lands
 * with it at the reply as its `author.spend` (the off-screen jobs record their own, in their entries).
 * Never throws: what failed is in the answer, and logged.
 */
export async function afterDepthReply(rt: AfterRt, chatId: ChatId, userId: UserId, basis: Basis, after: AfterReply, o: AfterOptions = {}): Promise<AfterOut> {
  const out: AfterOut = { remembered: [], linked: false, jobs: null, caughtUp: [], reflected: [], authorReflected: null, failed: [], offscreen: null, put: [] };
  const fail = (what: string, error: unknown): void => {
    const why = error instanceof Error ? error.message : String(error);
    out.failed.push(`${what}: ${why}`);
    rt.host.log("warn", `[LumiRPEngine] chat ${chatId}, after the reply: ${what} didn't go through: ${why}`, userId);
  };
  const said = (what: string, lines: readonly string[]): void => {
    for (const line of lines) rt.host.log("info", `[LumiRPEngine] chat ${chatId}, after the reply: ${what}: ${line}`, userId);
  };
  // What the step's own work spent lands with it at the reply, with what a ceiling put off; set once the reply's clock is read.
  let keepSpend: (() => Promise<void>) | null = null;
  try {
    const signal = o.signal ? { signal: o.signal } : {};
    const settings = await rt.settings.get(userId);
    const texts = settings.prompts.texts;
    const day = daySpendOf(rt.host);
    await day.load(userId);
    const base = o.model ?? portFor(rt, userId);
    // Two meters: the step's own work, and the off-screen jobs, whose drafts and settlements record their own spend.
    const mine = metered(base);
    const offMeter = metered(base);
    const model = mine.port;
    const binds = () => ceilingBinds(settings.depth.budget, (after.spent ?? 0) + costTokens(mine.spent().cost) + costTokens(offMeter.spent().cost), day.tokens(userId));
    // A ceiling that binds puts off what hasn't started, a line each.
    const held = (what: string): boolean => {
      const bind = binds();
      if (bind) out.put.push(`${what}: ${bind.words}`);
      return bind !== null;
    };
    const start = await rt.ledger.foldAtBasis(chatId, userId, basis, [STORY_TALK]);
    if (!start) {
      out.failed.push("the reply is no longer on the chat's chain");
      return out;
    }
    const clock = start.state.clock;
    const occasion = o.occasion !== undefined ? [o.occasion] : [];
    keepSpend = async () => {
      const data = spendData(mine.spent(), { treatment: "after", interval: settings.depth.budget.interval, at: clock, for: after.turn ?? basis.message, put: out.put });
      if (!data) return;
      said("put off by a ceiling", out.put);
      await land(rt, chatId, userId, basis, AUTHOR_SPEND, { events: [spendEvent(data)], blobs: {} }, layerEntryId(AUTHOR_SPEND, chatId, "after", basis.message, basis.swipe, ...occasion), "author");
    };

    // 1. Whoever holds takes here remembers its scene, but whoever is still talking in real time, until its takes reach the cap.
    const talk = talkNow(start.events, null);
    const talking = talk && talk.state === "on" ? talk.with : null;
    const rememberers = takersAt(start.state).filter((who) => hasAgent(start.world, start.state, who) && (who !== talking || takesOf(start.state, who).length >= settings.depth.takesKept));
    let kept: { who: EntityId; text: string }[] = [];
    if (!o.wakeRound && rememberers.length > 0 && !held(`Remembering the scene (${rememberers.map((id) => namesOf(start.world, start.state).name(id)).join(", ")})`)) {
      try {
        const r = await rememberAfterReply(rt, chatId, userId, { basis, model, who: rememberers, ...signal });
        out.remembered = r.remembered;
        for (const f of r.failed) fail(`${namesOf(start.world, start.state).name(f.who)}'s remembering`, f.why);
        kept = await keptOf(rt, userId, r.entries);
      } catch (error) {
        fail("remembering", error);
      }
    }

    // 2. The GM's truth links for the turn's beats and what the rememberers now believe.
    const at = await rt.ledger.foldAtBasis(chatId, userId, basis, [AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, MIND_INTERVIEW, "clock", "timelapse", ...DRAFT_TYPES, ...ASK_TYPES]);
    if (!at) {
      out.failed.push("the reply left the chat's chain");
      return out;
    }
    const names = namesOf(at.world, at.state);
    const turnIds = new Set(after.beats);
    const turnBeats = at.story.beats.filter((p) => turnIds.has(p.beat.id)).map((p) => p.beat);
    if (!o.wakeRound && (turnBeats.length > 0 || out.remembered.length > 0) && !held("The GM's truth-link of the turn's beats")) {
      try {
        const r = await linkTruths(rt, chatId, userId, basis, { who: out.remembered, beats: turnBeats, ...(o.occasion !== undefined ? { key: occasion } : {}), model, ...signal, ...(o.archive ? { archive: o.archive } : {}) });
        said("the GM's truth-link", r.refused);
        out.linked = r.linked;
      } catch (error) {
        fail("the GM's truth-link", error);
      }
    }

    // 3. The author's poll: who catches up and who reflects now, its own reflection, its predictions scored, and what happens off screen. Off with the background lanes: it waits for the next poll, which reads everything since this one.
    if (!settings.depth.background.on) {
      out.put.push(BACKGROUND_OFF);
      return out;
    }
    const bases = await rt.ledger.chainBases(chatId, userId);
    const since = sinceLastPoll(at, bases, basis, settings.depth.reads.pollBeats);
    // Story time passing by a timelapse the player ran in this reply, or the clock he moved on, wakes a poll a conversation put off to its end; so does the story clock passing the time the last poll asked to be woken at.
    const lastPoll = at.events.flatMap((e) => authorData<PollData>(e.event, AUTHOR_POLL) ?? []).at(-1);
    const asked = lastPoll?.wake && at.state.clock >= lastPoll.wake.at ? lastPoll.wake : null;
    const woken = o.woken !== undefined || asked !== null || at.events.some((e) => e.event.type === "timelapse" && e.from.messageId === basis.message);
    if ((!after.poll && !woken) || held("The author's poll: who catches up and reflects, and what happens off screen")) return out;
    const pov = povOf(at.world, at.state);
    const scored = new Set(at.events.flatMap((e) => authorData<ScoreData>(e.event, AUTHOR_SCORE)?.prediction ?? []));
    const predictions = at.events.flatMap((e) => {
      const d = authorData<PredictData>(e.event, AUTHOR_PREDICT);
      return d && !scored.has(d.id) ? [{ id: d.id, text: d.text }] : [];
    });
    const chapters = notebookOf(at.state).chapters;
    const lastChapter = chapters[chapters.length - 1];
    // Facts that can't be read leave the world off screen out of this poll.
    let offscreen: OffscreenFacts | undefined;
    try {
      offscreen = await offscreenFacts(rt, chatId, userId, at, await chatBudget(rt.host, chatId, userId, settings.depth.budget));
    } catch (error) {
      fail("reading the drafts off screen", error);
    }
    // A poll run at a reply where one already ran (the clock moved on since) opens its episodes after that one's.
    const first = at.events.reduce((n, e) => n + (e.from.messageId === basis.message ? (authorData<PollData>(e.event, AUTHOR_POLL)?.jobs.filter((j) => j.kind === "episode").length ?? 0) : 0), 0);
    let poll: PollResult;
    try {
      const input = {
        world: at.world,
        state: at.state,
        texts,
        pov,
        model,
        ...signal,
        notebook: await readNotebook(rt, userId, at.state),
        beats: (await beatTexts(rt, userId, since.beats)).map((beat, i) => ({ ref: `b${i + 1}`, beat })),
        kept,
        minutes: since.minutes + (o.woken && !since.readsBasis ? o.woken.minutes : 0),
        spans: [...since.spans, ...(o.woken ? [o.woken.why] : []), ...(asked ? [`reaching ${formatClock(calendarOf(at.world), asked.at)}, when you asked to be woken${asked.why !== "" ? ` (${asked.why})` : ""}`] : [])],
        due: dueOf(at.world, at.state, names, settings.depth.reads.due),
        pending: await pendingOf(rt, userId, at, after.remember, settings.depth.takesKept),
        answers: await answersSince(rt, userId, at),
        predictions,
        signals: after.signals ?? [],
        sceneEnded: after.ended,
        sinceChapter: turnsSince(bases, basis, lastChapter?.through ?? null),
        cadence: settings.depth.cadence,
        ...(offscreen ? { offscreen } : {}),
        ...(o.archive ? { archive: o.archive } : {}),
      };
      poll = await twice(() => authorPoll(input), o.signal);
    } catch (error) {
      fail("the author's poll", error);
      return out;
    }
    said("the author's poll", poll.refused);
    const jobs: PollJob[] = [
      ...poll.catchup.map((c): PollJob => ({ kind: "catchup", ...c })),
      ...poll.reflect.map((c): PollJob => ({ kind: "reflect", ...c })),
      ...poll.interview.map((c): PollJob => ({ kind: "interview", ...c })),
      ...poll.drop.map((d): PollJob => ({ kind: "drop", ...d })),
      ...poll.rebase.map((d): PollJob => ({ kind: "rebase", ...d })),
      ...poll.settle.map((d): PollJob => ({ kind: "settle", ...d })),
      ...poll.episodes.map((e, i): PollJob => ({ kind: "episode", episode: episodeOf(chatId, basis, first + i, e, at.state.clock).id, why: e.why })),
    ];
    const considered: PollConsidered[] = [...poll.considered];
    let reflection: { depth: "scene" | "chapter"; why: string } | null = null;
    if (poll.author) {
      const held = cadenceHolds(settings.depth.cadence, poll.author.depth, after.ended);
      if (held === null) {
        reflection = poll.author;
        jobs.push({ kind: "author.reflect", ...poll.author });
      } else considered.push({ what: poll.author.depth === "chapter" ? "My own re-read of the chapter" : "My own reflection on the scene", raised: false, why: [poll.author.why, `Held back: ${held}`].filter((s) => s !== "").join(" ") });
    }
    try {
      const events = [pollEvent({ through: basis.message, considered, jobs, ...(poll.wake ? { wake: { at: at.state.clock + poll.wake.minutes, why: poll.wake.why } } : {}) }), ...poll.scores.map((s) => scoreEvent(s))];
      const thought = [...(poll.reads ?? []), ...(poll.reasoning ? [poll.reasoning] : [])].join("\n\n");
      await land(rt, chatId, userId, basis, AUTHOR_POLL, { events, blobs: {}, ...(thought ? { reasoning: thought } : {}) }, layerEntryId(AUTHOR_POLL, chatId, basis.message, basis.swipe, ...occasion), "author");
    } catch (error) {
      fail("keeping the author's poll", error);
    }
    out.jobs = jobs;

    // 4. Its jobs: the catch-ups, then the reflections (which read what was caught up), then the GM's truth link of what they wrote, then off screen, then its own.
    const ran = async (list: readonly { who: EntityId }[], what: string, job: (who: EntityId) => Promise<boolean>): Promise<EntityId[]> =>
      (
        await Promise.all(
          list.map(async ({ who }) => {
            try {
              return (await job(who)) ? [who] : [];
            } catch (error) {
              fail(`${names.name(who)}'s ${what}`, error);
              return [];
            }
          }),
        )
      ).flat();
    if (poll.catchup.length > 0 && !held(`Catch-ups (${poll.catchup.map((c) => names.name(c.who)).join(", ")})`)) {
      out.caughtUp = await ran(poll.catchup, "catch-up", async (who) => {
        const r = await catchUpNow(rt, chatId, userId, who, { basis, model, ...signal });
        // An open draft holds back what reached them after its story time, until it settles or drops.
        if (r.held.length > 0) said(`${names.name(who)}'s catch-up`, [`waits for draft ${r.held.join(", ")} to settle or drop before living what came after its story time`]);
        return r.lived > 0;
      });
    }
    o.ready?.();
    if (poll.reflect.length > 0 && !held(`Reflections (${poll.reflect.map((c) => names.name(c.who)).join(", ")})`)) out.reflected = await ran(poll.reflect, "reflection", async (who) => (await reflectNow(rt, chatId, userId, who, { basis, model, ...signal })) !== null);
    // Its interviews (§4.4), asked of each mind as it stands once caught up and reflected: kept apart from the mind as probes, and read by its next poll.
    if (poll.interview.length > 0 && !held(`Interviews (${poll.interview.map((c) => names.name(c.who)).join(", ")})`)) {
      await ran(poll.interview, "interview", async (who) => {
        const q = poll.interview.find((c) => c.who === who);
        return q ? (await interviewMind(rt, chatId, userId, who, q.question, false, model, { by: "author", basis, ...signal })).answer !== "" : false;
      });
    }
    // What the catch-ups and reflections wrote is linked as the reply's remembering is (§4.4): a character the author played or handled only catches up, and gets its holdings here.
    const wrote = [...new Set([...out.caughtUp, ...out.reflected])];
    if (wrote.length > 0 && !held(`The GM's truth-link of what ${wrote.map((id) => names.name(id)).join(", ")} wrote`)) {
      try {
        const r = await linkTruths(rt, chatId, userId, basis, { who: wrote, beats: [], key: ["jobs", ...occasion], model, ...signal, ...(o.archive ? { archive: o.archive } : {}) });
        said("the GM's truth-link of the poll's jobs", r.refused);
      } catch (error) {
        fail("the GM's truth-link of the poll's jobs", error);
      }
    }
    // Off screen (§4.6): drops, rebases, settlements and their catch-ups, then the episodes drafted at their treatments, each started only while no ceiling binds.
    if (offscreen && poll.drop.length + poll.rebase.length + poll.settle.length + poll.episodes.length > 0) {
      try {
        out.offscreen = await offscreenJobs(rt, chatId, userId, basis, poll, { budget: await chatBudget(rt.host, chatId, userId, settings.depth.budget), model: offMeter.port, ...signal, ...(o.plugs ? { plugs: o.plugs } : {}), binds, first });
        out.put.push(...out.offscreen.put);
        said("off screen", out.offscreen.said);
      } catch (error) {
        fail("the work off screen", error);
      }
    }
    // A settlement landed off screen wakes the poll once more at once: what it made canon may call for a catch-up or an episode. That round wakes nothing more.
    const settled = out.offscreen?.settled ?? [];
    if (settled.length > 0 && !o.wakeRound) {
      const { ready: _ready, ...rest } = o;
      const round = await afterDepthReply(rt, chatId, userId, basis, { ...after, poll: false, beats: [], spent: (after.spent ?? 0) + costTokens(mine.spent().cost) + costTokens(offMeter.spent().cost) }, { ...rest, occasion: [...occasion, "settled"].join("."), woken: { minutes: 0, why: `the settling of draft${settled.length === 1 ? "" : "s"} ${settled.join(", ")} into canon off screen` }, wakeRound: true });
      out.jobs = [...(out.jobs ?? []), ...(round.jobs ?? [])];
      out.caughtUp.push(...round.caughtUp);
      out.reflected.push(...round.reflected);
      out.failed.push(...round.failed.map((f) => `after the settlement: ${f}`));
      out.authorReflected ??= round.authorReflected;
      if (round.offscreen && out.offscreen) for (const k of ["dropped", "rebased", "settled", "drafted", "asked", "said"] as const) out.offscreen[k].push(...round.offscreen[k]);
    }
    if (!reflection || held(reflection.depth === "chapter" ? "The author's re-read of the chapter" : "The author's reflection on the scene")) return out;
    try {
      const now = await rt.ledger.foldAtBasis(chatId, userId, basis);
      if (!now) throw new Error("the reply left the chat's chain");
      const depth = reflection.depth;
      const order = new Map(bases.map((b, i) => [b.message, i]));
      const closed = lastChapter?.through ? (order.get(lastChapter.through) ?? -1) : -1;
      // Every beat of the stretch, oldest first, read a page of Settings → Depth's rereadBeats at a time (W5: never cut for size).
      const stretch = now.story.beats.filter((p) => (depth === "scene" ? (after.scene !== null ? p.beat.scene === after.scene : turnIds.has(p.beat.id)) : (order.get(p.from.messageId) ?? -1) > closed)).map((p) => p.beat);
      const involved = new Set(stretch.flatMap(beatPeople));
      const becoming: { who: EntityId; self?: string; mind?: string }[] = [];
      for (const who of mindedAt(now.state)) {
        if (!involved.has(who) || !hasAgent(now.world, now.state, who)) continue;
        const files = await readMind(rt.blobs, userId, now.state, who, new Set(now.story.replaced.map((r) => r.id)));
        const self = files[MIND_FILE_NAMES.self];
        const mind = files[MIND_FILE_NAMES.mind];
        becoming.push({ who, ...(self ? { self } : {}), ...(mind ? { mind } : {}) });
      }
      const chapter = notebookOf(now.state).chapters.length;
      const refs = (await beatTexts(rt, userId, stretch)).map((beat, i) => ({ b: beat.beat, ref: `b${i + 1}`, beat }));
      // Each page reads the notebook as the pages before it left it and answers it with edits; each page's revision lands as its own entry with its reasoning.
      let state = now.state;
      await readPaged(refs, settings.depth.rereadBeats, async (page) => {
        const notebook = await readNotebook(rt, userId, state);
        const beats = page.items.map(({ ref, beat }) => ({ ref, beat }));
        // His signals this turn, and each beat of the page that stands in for one an edit or a correction struck: what he changed says what he wants.
        const amended = page.items.flatMap(({ b, ref }) => (b.supersedes && b.supersedes.length > 0 ? [`${ref} stands in for an earlier beat (his edit of a reply, or a correction)`] : []));
        const paged = page.of > 1 ? { index: page.index, of: page.of } : undefined;
        const tail = paged && page.index > 1 ? [`p${page.index}`] : [];
        const r = await twice(() => authorReflect({ world: now.world, state, texts, pov: povOf(now.world, state), model, ...signal, notebook, depth, beats, becoming, chapter, through: basis.message, signals: [...(after.signals ?? []), ...amended], ...(paged ? { page: paged } : {}), ...(o.archive ? { archive: o.archive } : {}) }), o.signal);
        said(paged ? `the author's reflection (page ${page.index} of ${page.of})` : "the author's reflection", r.refused);
        const events = [...r.events, ...r.drift.map((d) => driftEvent(d)), ...r.predictions.map((p, i) => predictEvent({ id: predictionId(chatId, basis.message, basis.swipe, ...occasion, ...tail, String(i)), text: p.text, about: p.about, from: depth }))];
        if (events.length === 0) return;
        const thought = [...(r.reads ?? []), ...(r.reasoning ? [r.reasoning] : [])].join("\n\n");
        await land(rt, chatId, userId, basis, "notebook", { events, blobs: r.blobs, ...(thought ? { reasoning: thought } : {}) }, layerEntryId("author.reflect", chatId, basis.message, basis.swipe, ...occasion, ...tail), "author");
        out.authorReflected = depth;
        if (page.index < page.of) state = (await rt.ledger.foldAtBasis(chatId, userId, basis))?.state ?? state;
      }, o.signal);
    } catch (error) {
      fail("the author's reflection", error);
    }
  } catch (error) {
    fail("the after-reply step", error);
  } finally {
    try {
      await keepSpend?.();
    } catch (error) {
      fail("keeping what the step spent", error);
    }
  }
  return out;
}
