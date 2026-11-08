// Real-time dialogue (DEPTH-PLAN §2.5, §6.6): while the player talks with someone line by line
// (`story.talk` on, `shared/talk.ts`), each line he speaks goes straight to that character as what
// it hears, verbatim, with what it can see of him: no scene setup and no point-of-view render. Its
// agent answers from its own mind (A2b's `play`, on Settings → Depth's real-time row for the
// character) while, at the same time, the author reads the line beside it, never in front of it
// (the watch, on the real-time row for the author's watch): can the character simply hear and answer
// it, or does it need the DM? It writes the player's line as a beat, says who else perceives the
// exchange, adds a world beat between lines when the world does something, ends the conversation,
// and says whether its poll waits for the conversation's end.
//
// A line that needs the DM goes back to the loop as a full scene (`takeover`), and the character's
// answer is dropped unrecorded: none of its events is returned, so nothing it read reaches its mind.
// Otherwise the answer is canon as decided (its beat, and an attempt in it resolved by the GM), the
// world's beats follow it, and the narrator renders the exchange, the character's words verbatim,
// checked by the GM and streamed (A2c's `Narration`, bound to the turn by the loop). Who perceived the
// answer, and how an attempt in it turned out, is the author's to write (§4.2), in one short call on
// the watch's row once both are decided (`answerExposure`): only words said aloud to the player
// character that attempt nothing reach him as they are, whole, as his line reaches the character:
// seen and heard face to face, heard alone with the two apart, over a phone line (LIVE3c L3c-4).
// The thinking block says each step, and ends the line with its latency, call by call.

import { hasAgent, heardAlone, mindedAt, povOf, presentAt, wordsAlone } from "../../../shared/character-engine";
import type { EntityId, UserId } from "../../../shared/ids";
import type { LedgerEvent } from "../../../shared/ledger";
import { REALTIME_TEXT } from "../../../shared/realtime-prompts";
import { beatEvent, beatId, type Beat, type Exposure, type ExposureChannel, type Staging, type StoryRef } from "../../../shared/story";
import { talkEvent } from "../../../shared/talk";
import type { WorldDoc } from "../../../shared/world";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { stagingBefore } from "../../../engine/ledger/story";
import { own } from "../../../engine/pack-kit";
import { together } from "../../../engine/presence";
import { placeOfEntity } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { povRender, type LivedPov, type PovStaging } from "../../character-agent";
import { mindInput, povRefs } from "../../character-engine";
import { renderPrompt } from "../../prompts";
import { beatLine, DepthAnswerError, nameKey, putText, readAnswer, twice, type BeatText, type Blobs, type StagingText } from "../common";
import type { ModelPort, PortUsage } from "../port";
import type { Moment, NarrationOutcome, RealtimeCtx, RealtimeOutcome, RenderBeat, SceneRt } from "./contract";
import { actBeatTexts, play, sceneRecall, sceneSoFar, type PlayAct, type PlayOut, type SceneRead } from "./play";
import { attemptSeed, resolveAttempt, type AttemptOut } from "./resolve";

/** The latest beats of the conversation's scene the watch reads (a context bound, not a judgment: the author's notebook holds the long view). */
export const WATCH_BEATS = 40;

const CHANNELS: readonly ExposureChannel[] = ["hearing", "sight", "touch"];

/** Someone the watch says is placed to perceive a beat, and how. */
export interface WatchPerceiver {
  who: EntityId;
  channel: ExposureChannel;
  reach: "whole" | "partial";
}

/** A world beat the watch adds between lines: what the world does, as the author decides it. */
export interface WatchWorld {
  what: string;
  surface: string;
  said: string | null;
  by: EntityId[];
  /** What those who act in it did and said, as they did it: each lives it as their own act (LIVE3 L3a-4); null when no one does, or the watch said nothing of it. */
  deed: string | null;
  perceived: WatchPerceiver[];
}

/** The player's line as the author writes its beat from his message: what he says and does, his exact words aloud, what he visibly does. */
export interface WatchLine {
  what: string;
  said: string | null;
  did: string | null;
}

/** The author's reading of one line, beside the character (§5.2, Author, real-time watch). */
export interface WatchAnswer {
  /** Why the line needs the DM: the turn becomes a full scene. Null: the character answers it. */
  takeover: string | null;
  /** The player's line as a beat; null with a takeover. */
  line: WatchLine | null;
  /** Anyone besides the two of them placed to perceive the exchange. */
  others: WatchPerceiver[];
  world: WatchWorld[];
  /** Why real-time dialogue ends after this line; null: it goes on. */
  end: string | null;
  /** Whether the poll runs after this line or waits for the conversation's end. */
  poll: "now" | "later";
  reasoning?: string;
  /** What the answer named that the exchange can't hold (someone not here, a world beat with nothing to sense), for the thinking block. */
  notes: string[];
}

/** The watch's call: its reading (null when the answer didn't read), the answer's text, and what it cost. */
export interface WatchResult {
  answer: WatchAnswer | null;
  text: string;
  usage?: PortUsage;
}

/** What the watch reads: its notebook, where everyone is, the conversation so far, and the player's message, verbatim. */
export interface WatchInput {
  world: WorldDoc;
  state: Readonly<WorldState>;
  pc: EntityId;
  with: EntityId;
  /** The scene's staging, by person, with its texts. */
  staging: ReadonlyMap<EntityId, StagingText>;
  /** The conversation's scene so far, as the author reads beats (truth-aware), newest last. */
  conversation: readonly BeatText[];
  /** Why real time began, in the author's words. */
  since?: string;
  notebook: string;
  line: string;
  texts: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

const nonBlank = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** A person's name at a state, else the world's, else the id. */
function nameOf(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): string {
  return own(state.entities, id)?.name ?? own(world.entities, id)?.name ?? id;
}

/** Seconds, as the thinking block says them: "2.4 s". */
export function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/**
 * The port real time's calls go through: the character agent's play on Settings → Depth's real-time
 * row for the character (§2.5, D-3); every other role (the watch, the GM's resolution, the
 * points of view, the narrator and its check) on its own row.
 */
export function realtimePort(model: ModelPort): ModelPort {
  return (role, messages, opts) => model(role === "character" ? "realtime" : role, messages, opts);
}

// ------------------------------------------------------------------ the watch

/** Reads an id the watch wrote for someone present: the id itself (bracketed or not), else the one person here by that name, spelled as an id or not (`nameKey`). */
function resolverOf(world: WorldDoc, state: Readonly<WorldState>, present: readonly EntityId[]): (said: unknown) => EntityId | null {
  return (said) => {
    const text = nonBlank(said)?.replace(/^\[(.*)\]$/, "$1");
    if (text === undefined) return null;
    if (present.includes(text)) return text;
    const key = nameKey(text);
    const hits = present.filter((id) => nameKey(nameOf(world, state, id)) === key);
    return hits.length === 1 ? (hits[0] ?? null) : null;
  };
}

function perceiversOf(raw: unknown, resolve: (said: unknown) => EntityId | null, notes: string[], skip: ReadonlySet<EntityId>): WatchPerceiver[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchPerceiver[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) continue;
    const r = p as Record<string, unknown>;
    const who = resolve(r.who);
    if (who === null) {
      notes.push(`The watch named ${typeof r.who === "string" ? `“${r.who}”` : "someone"} as perceiving it, who isn't here; left out.`);
      continue;
    }
    if (skip.has(who) || out.some((x) => x.who === who)) continue;
    const channel = CHANNELS.find((c) => c === r.channel);
    if (channel === undefined) {
      notes.push(`The watch gave ${who} no way of perceiving it (hearing, sight or touch); left out.`);
      continue;
    }
    out.push({ who, channel, reach: r.reach === "partial" ? "partial" : "whole" });
  }
  return out;
}

/**
 * The watch's answer as the exchange reads it; null when it holds neither a takeover nor the
 * player's line (an answer that doesn't read: the line then goes to a full scene, which reads it).
 */
export function readWatch(answer: Record<string, unknown> | null, ctx: { world: WorldDoc; state: Readonly<WorldState>; present: readonly EntityId[]; pc: EntityId; with: EntityId }): WatchAnswer | null {
  if (!answer) return null;
  const notes: string[] = [];
  const reasoning = nonBlank(answer.reasoning);
  const base = { others: [] as WatchPerceiver[], world: [] as WatchWorld[], end: nonBlank(answer.end), poll: answer.poll === "later" ? ("later" as const) : ("now" as const), ...(reasoning !== null ? { reasoning } : {}), notes };
  const takeover = nonBlank(answer.takeover);
  if (takeover !== null) return { ...base, takeover, line: null };
  const rawLine = typeof answer.line === "object" && answer.line !== null ? (answer.line as Record<string, unknown>) : null;
  const what = nonBlank(rawLine?.what);
  if (what === null) return null;
  const resolve = resolverOf(ctx.world, ctx.state, ctx.present);
  const others = perceiversOf(answer.others, resolve, notes, new Set([ctx.pc, ctx.with]));
  const world: WatchWorld[] = [];
  for (const raw of Array.isArray(answer.world) ? answer.world : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const w = raw as Record<string, unknown>;
    const whatW = nonBlank(w.what);
    if (whatW === null) continue;
    const said = nonBlank(w.said);
    const surface = nonBlank(w.surface) ?? said;
    if (surface === null) {
      notes.push(`The watch's world beat “${whatW}” said nothing there was to sense; left out.`);
      continue;
    }
    const by = [...new Set((Array.isArray(w.by) ? w.by : []).map(resolve).filter((id): id is EntityId => id !== null))];
    const deed = nonBlank(w.deed);
    if (deed !== null && by.length === 0) notes.push(`The watch's world beat “${whatW}” gave a deed but no one acts in it; its deed was left out.`);
    world.push({ what: whatW, surface, said, by, deed: by.length > 0 ? deed : null, perceived: perceiversOf(w.perceived, resolve, notes, new Set()) });
  }
  return { ...base, takeover: null, line: { what, said: nonBlank(rawLine?.said), did: nonBlank(rawLine?.did) }, others, world };
}

/** Where everyone is, a line each, as the author's real-time calls read it; the two of them, together, when the scene has no staging. */
function whereLines(input: { world: WorldDoc; state: Readonly<WorldState>; pc: EntityId; with: EntityId; staging: ReadonlyMap<EntityId, StagingText> }): string[] {
  const { world, state, pc } = input;
  const label = (id: EntityId): string => `${nameOf(world, state, id)} [${id}]`;
  const lines = [...input.staging.entries()].map(([who, s]) => `- ${label(who)}${who === pc ? " (the player character)" : who === input.with ? " (talking with him in real time)" : ""}: ${s.where.trim()}; ${s.doing.trim()}${s.occluded && s.occluded.trim() !== "" ? `; blocked: ${s.occluded.trim()}` : ""}`);
  return lines.length > 0 ? lines : [`- ${label(pc)} (the player character) and ${label(input.with)}, together`];
}

/** The watch's data: what it reads, after its system text. */
export function watchData(input: WatchInput): string {
  const { world, state, pc } = input;
  const label = (id: EntityId): string => `${nameOf(world, state, id)} [${id}]`;
  const place = placeOfEntity(state, pc);
  return [
    `## Your notebook\n${input.notebook.trim() === "" ? "(empty)" : input.notebook.trim()}`,
    `## Where everyone is\n${whereLines(input).join("\n")}`,
    `## The conversation so far\n${input.conversation.length > 0 ? input.conversation.map((b) => beatLine(world, state, b)).join("\n") : "(it starts with this line)"}`,
    `## Now\n${formatClock(calendarOf(world), state.clock)}${place !== null ? `, ${own(world.places, place)?.name ?? place}` : ""}. Real-time dialogue between ${label(pc)} and ${label(input.with)}${input.since ? `: ${input.since}` : "."}`,
    `## ${nameOf(world, state, pc)}'s message to ${nameOf(world, state, input.with)}, verbatim\n${input.line}`,
  ].join("\n\n");
}

/** The author's watch (§5.2): one short call on the real-time row for the watch, beside the character's play; an answer that isn't JSON reads as none, its keeper told why (`readAnswer`). */
export async function watch(model: ModelPort, input: WatchInput): Promise<WatchResult> {
  const name = nameOf(input.world, input.state, input.with);
  const system = `${renderPrompt(REALTIME_TEXT.watch, input.texts, { name })}\n\n${renderPrompt(REALTIME_TEXT.watchAnswer, input.texts, {})}`;
  const reply = await model("watch", [{ role: "system", content: system }, { role: "user", content: watchData(input) }], { json: true, ...(input.signal ? { signal: input.signal } : {}) });
  const present = [...new Set([input.pc, input.with, ...input.staging.keys()])];
  const read = readWatch(readAnswer("watch", reply).answer, { world: input.world, state: input.state, present, pc: input.pc, with: input.with });
  // The model's own reasoning stands in for an answer that gave none.
  const answer = read && read.reasoning === undefined && reply.reasoning ? { ...read, reasoning: reply.reasoning } : read;
  return { answer, text: reply.text, ...(reply.usage ? { usage: reply.usage } : {}) };
}

// ------------------------------------------------------------------ who perceived the answer

/** Who the author says perceived the character's answer, besides the character, and how an attempt in it turned out (§4.2). */
export interface AnswerExposure {
  answer: WatchPerceiver[];
  /** Empty when nothing was attempted, or no one perceived how it turned out. */
  outcome: WatchPerceiver[];
  reasoning?: string;
  /** What the answer named that the exchange can't hold (someone not here, no way of perceiving), for the thinking block. */
  notes: string[];
}

/** What the author reads to write who perceived an answer: where everyone is, the conversation, the player's line, the answer as it happened (what it attempted too), and how the GM resolved that. */
export interface ExposureInput {
  world: WorldDoc;
  state: Readonly<WorldState>;
  pc: EntityId;
  with: EntityId;
  staging: ReadonlyMap<EntityId, StagingText>;
  conversation: readonly BeatText[];
  line: WatchLine;
  act: PlayAct;
  /** The GM's outcome of an attempt in the answer; null when nothing was attempted or the rules left nothing to tell. */
  outcome: { what: string; surface: string; quotes?: string } | null;
  texts: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

/** The author's account of who perceived an answer, as the exchange reads it; null when it holds no "answer" list. The character is left out of the answer's: it perceives its own act. */
export function readExposure(answer: Record<string, unknown> | null, ctx: { world: WorldDoc; state: Readonly<WorldState>; present: readonly EntityId[]; with: EntityId }): AnswerExposure | null {
  if (!answer || !Array.isArray(answer.answer)) return null;
  const notes: string[] = [];
  const resolve = resolverOf(ctx.world, ctx.state, ctx.present);
  const reasoning = nonBlank(answer.reasoning);
  return { answer: perceiversOf(answer.answer, resolve, notes, new Set([ctx.with])), outcome: perceiversOf(answer.outcome, resolve, notes, new Set()), ...(reasoning !== null ? { reasoning } : {}), notes };
}

/** The data the author reads to write who perceived an answer, after its system text. */
export function exposureData(input: ExposureInput): string {
  const { world, state, pc, act, outcome } = input;
  const label = (id: EntityId): string => `${nameOf(world, state, id)} [${id}]`;
  const answer = [
    `${act.act === "said" ? "Said aloud" : "Did"}: ${act.surface}`,
    ...(act.quotes ? [`Their exact words: “${act.quotes}”`] : []),
    ...(act.addressed && act.addressed.length > 0 ? [`To: ${act.addressed.map(label).join(", ")}`] : []),
    ...(act.attempt ? [`What they tried to bring about: ${act.attempt}`] : []),
  ];
  return [
    `## Where everyone is\n${whereLines(input).join("\n")}`,
    `## The conversation so far\n${input.conversation.length > 0 ? input.conversation.map((b) => beatLine(world, state, b)).join("\n") : "(it starts with this line)"}`,
    `## ${nameOf(world, state, pc)}'s line, as you wrote it\n${input.line.what}`,
    `## ${nameOf(world, state, input.with)}'s answer, as it happened\n${answer.join("\n")}`,
    ...(outcome ? [`## How it turned out, as the GM resolved it\n${outcome.what}\nWhat there was to sense of it: ${outcome.surface}${outcome.quotes ? `\nWords: “${outcome.quotes}”` : ""}`] : []),
  ].join("\n\n");
}

/** The author's account of who perceived an answer (§4.2): one short call on the watch's row once the answer and any outcome are decided; an answer that doesn't read fails (`DepthAnswerError`), its keeper told (`readAnswer`). */
export async function answerExposure(model: ModelPort, input: ExposureInput): Promise<AnswerExposure> {
  const name = nameOf(input.world, input.state, input.with);
  const system = `${renderPrompt(REALTIME_TEXT.exposure, input.texts, { name })}\n\n${renderPrompt(REALTIME_TEXT.exposureAnswer, input.texts, {})}`;
  const reply = await model("watch", [{ role: "system", content: system }, { role: "user", content: exposureData(input) }], { json: true, ...(input.signal ? { signal: input.signal } : {}) });
  const present = [...new Set([input.pc, input.with, ...input.staging.keys()])];
  const read = readExposure(readAnswer("watch", reply).answer, { world: input.world, state: input.state, present, with: input.with });
  if (read === null) throw new DepthAnswerError("watch", reply.text, reply);
  // The model's own reasoning stands in for an answer that gave none.
  return read.reasoning === undefined && reply.reasoning ? { ...read, reasoning: reply.reasoning } : read;
}

// ------------------------------------------------------------------ the exchange

/** The texts of `hashes`, by hash; one that is missing is left out. */
async function textsOf(rt: SceneRt, userId: UserId, hashes: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const hash of new Set(hashes)) {
    const text = await rt.blobs.get(userId, hash);
    if (text !== null) out[hash] = text;
  }
  return out;
}

/** A staging with its texts; null when its texts are gone. */
function stagingText(s: Staging, texts: Readonly<Record<string, string>>): StagingText | null {
  const where = texts[s.where];
  const doing = texts[s.doing];
  if (where === undefined || doing === undefined) return null;
  const occluded = s.occluded !== undefined ? texts[s.occluded] : undefined;
  return { staging: s, where, doing, ...(occluded !== undefined ? { occluded } : {}) };
}

/** A beat with its texts; null when its texts are gone. */
function beatText(beat: Beat, texts: Readonly<Record<string, string>>): BeatText | null {
  const what = texts[beat.what];
  const surface = texts[beat.surface];
  if (what === undefined || surface === undefined) return null;
  const quotes = beat.quotes !== undefined ? texts[beat.quotes] : undefined;
  return { beat, what, surface, ...(quotes !== undefined ? { quotes } : {}) };
}

/** An exposure for each perceiver: whole or in part, and pending for anyone with an agent, since none of them lived it in this call. */
function exposures(list: readonly WatchPerceiver[], world: WorldDoc, state: Readonly<WorldState>): Exposure[] {
  return list.map((p) => ({ who: p.who, channel: p.channel, reach: p.reach, ...(hasAgent(world, state, p.who) ? { pending: true as const } : {}) }));
}

const NOTHING_STREAMED: NarrationOutcome = { told: [], events: [], blobs: {}, streamedThrough: null, stopped: true, usage: { tokensIn: 0, tokensOut: 0 } };

/** A Stop before anything streamed: nothing of the exchange is kept. */
const STOPPED: RealtimeOutcome = { kind: "exchange", events: [], blobs: {}, narration: NOTHING_STREAMED };

/**
 * One line of real-time dialogue (§2.5): the character's play beside the author's watch, then
 * either a takeover (nothing written; the loop runs the turn as a full scene with `why` for the
 * author's setup) or the exchange: its beats, the character's own events from its play, an attempt
 * resolved by the GM, who perceived the answer and the outcome (the author's), the world's beats,
 * the talk's end, rendered and streamed. On a Stop the events are cut to the last moment whose
 * passage streamed, none when none did.
 */
export async function realtimeTurn(ctx: RealtimeCtx): Promise<RealtimeOutcome> {
  const { at, talk, userId, sink } = ctx;
  const { world, state } = at;
  const texts = ctx.settings.prompts.texts;
  const whole = ctx.settings.depth.thinking === "whole";
  // A line for the thinking block: a paragraph when it shows the whole thinking (D-5), else a progress line.
  const say = (text: string): void => (whole ? sink.reasoning(`\n\n${text.trim()}\n\n`) : sink.progress(text.trim()));
  const thought = (text: string): void => {
    if (whole && text.trim() !== "") sink.reasoning(`\n\n${text.trim()}\n\n`);
  };
  const who = talk.with;
  const pc = povOf(world, state);
  const name = nameOf(world, state, who);

  // Real time runs only with someone who has an agent and a mind of their own (§4.4, D-10).
  if (!hasAgent(world, state, who)) return { kind: "takeover", why: `${name} is the player character now, so there is no one to talk with in real time.` };
  if (!mindedAt(state).includes(who)) return { kind: "takeover", why: `${name} has no mind of their own yet, so they can't answer in real time.` };
  // A ceiling that binds (§6.5): no one plays as their own agent past it, so the line plays as a scene, where the author plays them (the cheaper rung).
  const bind = ctx.binds?.() ?? null;
  if (bind) {
    const why = `The budget: ${bind.words}, so ${name} doesn't answer this line as their own agent: the author plays them in a scene, spending less.`;
    say(why);
    return { kind: "takeover", why, put: `${name}'s real-time line, played by the author in a scene rather than their own agent: ${bind.words}` };
  }

  sink.progress(renderPrompt(REALTIME_TEXT.lineHears, texts, { name }));
  const t0 = performance.now();

  // The conversation's scene: where everyone is, and its beats so far.
  const sceneStaging = stagingBefore(at.story, Number.MAX_SAFE_INTEGER, ctx.scene);
  const sceneBeats = at.story.beats.filter((p) => p.beat.scene === ctx.scene);
  const recent = sceneBeats.slice(-WATCH_BEATS);
  const stored = await textsOf(ctx.rt, userId, [
    ...[...sceneStaging.values()].flatMap((s) => [s.where, s.doing, ...(s.occluded !== undefined ? [s.occluded] : [])]),
    ...recent.flatMap((p) => [p.beat.what, p.beat.surface, ...(p.beat.quotes !== undefined ? [p.beat.quotes] : [])]),
  ]);
  const staging = new Map<EntityId, StagingText>();
  for (const [id, s] of sceneStaging) {
    const t = stagingText(s, stored);
    if (t) staging.set(id, t);
  }
  const conversation = recent.map((p) => beatText(p.beat, stored)).filter((b): b is BeatText => b !== null);
  const place = placeOfEntity(state, pc) ?? sceneBeats.at(-1)?.beat.place ?? placeOfEntity(state, who);
  if (place === null) return { kind: "takeover", why: `No place is known for ${nameOf(world, state, pc)} and ${name}, so the line needs a scene to set one.` };
  const clock = state.clock;
  const order = sceneBeats.reduce((n, p) => Math.max(n, p.beat.order + 1), 0);

  // What the character hears, verbatim, and what it can see of him.
  const lineId = beatId(ctx.turn, "talk", "line");
  const answerId = beatId(ctx.turn, "talk", "answer");
  const mind = await mindInput(ctx.rt, userId, at, who, ctx.settings);
  const pcAs = mind.known?.[pc] ?? "someone you don't know";
  const heard: LivedPov = {
    beat: lineId,
    at: clock,
    when: formatClock(calendarOf(world), clock),
    where: own(world.places, place)?.name ?? place,
    channel: "hearing",
    whole: true,
    // His words and what he does as he says them come in the line itself; his staging is the author's, never the character's to read (§4.2).
    text: `${pcAs} speaks to you.`,
    quotes: ctx.line,
  };
  const read: SceneRead = { world, state, story: at.story };
  const so = await sceneSoFar(ctx.rt.blobs, userId, read, who);

  // The play and the watch at once. A takeover stops the play: its answer is dropped either way.
  const playStop = new AbortController();
  const onStop = (): void => playStop.abort(ctx.signal.reason);
  ctx.signal.addEventListener("abort", onStop, { once: true });
  const playStarted = performance.now();
  const playing = play(realtimePort(ctx.model), { ...mind, beat: answerId, scene: so.scene, reached: [...so.reached, heard], recall: sceneRecall(ctx.rt.blobs, userId, read, who), signal: playStop.signal }).then((out) => ({ out, ms: performance.now() - playStarted }));
  // Nothing awaits the play until the watch has answered; its failure is read then.
  playing.catch(() => undefined);
  const watchStarted = performance.now();
  let watched: WatchResult;
  try {
    watched = await watch(ctx.model, { world, state, pc, with: who, staging, conversation, ...(talk.why ? { since: talk.why } : {}), notebook: ctx.notebook, line: ctx.line, texts, signal: ctx.signal });
  } catch (error) {
    playStop.abort(error);
    ctx.signal.removeEventListener("abort", onStop);
    if (ctx.signal.aborted) return STOPPED;
    throw error;
  }
  const watchMs = performance.now() - watchStarted;
  const w = watched.answer;
  if (w === null || w.takeover !== null) {
    playStop.abort(new Error("the author took the line into a scene"));
    ctx.signal.removeEventListener("abort", onStop);
    if (ctx.signal.aborted) return STOPPED;
    const why = w === null ? "The author's watch didn't answer in a form that could be read, so the author reads the line in a scene." : `${w.takeover}${w.end !== null ? ` The conversation ends: ${w.end}` : ""}`;
    thought(w?.reasoning ?? "");
    say(renderPrompt(REALTIME_TEXT.lineTaken, texts, { name, why }));
    return { kind: "takeover", why };
  }
  let played: { out: PlayOut; ms: number };
  try {
    played = await playing;
  } catch (error) {
    if (ctx.signal.aborted) return STOPPED;
    if (!(error instanceof DepthAnswerError)) throw error;
    const why = `${name}'s answer didn't come back in a form that could be read, so the author plays the line as a scene.`;
    say(renderPrompt(REALTIME_TEXT.lineTaken, texts, { name, why }));
    return { kind: "takeover", why };
  } finally {
    ctx.signal.removeEventListener("abort", onStop);
  }
  const act = played.out.act;
  if (act === null) {
    const why = `${name} let the line pass, doing nothing the player could perceive, so the author plays the line as a scene.`;
    say(renderPrompt(REALTIME_TEXT.lineTaken, texts, { name, why }));
    return { kind: "takeover", why };
  }
  thought(w.reasoning ?? "");
  for (const note of w.notes) thought(note);
  const line = w.line;
  // The watch gives the line whenever it doesn't take it (`readWatch`).
  if (line === null) return { kind: "takeover", why: "The author's watch didn't write the player's line, so the author reads it in a scene." };

  try {
    return await exchange(ctx, { w, line, answer: played.out, act, playMs: played.ms, watchMs, t0, name, pc, place, clock, order, staging, conversation, lineId, answerId, say, thought });
  } catch (error) {
    if (ctx.signal.aborted) return STOPPED;
    throw error;
  }
}

/** What the exchange is made from, once the watch let the line through and the character answered it. */
interface ExchangeInput {
  w: WatchAnswer;
  line: WatchLine;
  /** The character's play, whose events are its own (the beats it lived, its take, its now). */
  answer: PlayOut;
  act: PlayAct;
  playMs: number;
  watchMs: number;
  t0: number;
  name: string;
  pc: EntityId;
  place: string;
  clock: number;
  order: number;
  staging: ReadonlyMap<EntityId, StagingText>;
  conversation: readonly BeatText[];
  lineId: string;
  answerId: string;
  say(text: string): void;
  thought(text: string): void;
}

/**
 * The exchange as decided: the player's line (the author wrote it from his message), the answer
 * (the character's own), an attempt's outcome (the GM's), who perceived the answer and the outcome
 * (the author's, unless the answer is words said to the player character), the world's beats (the
 * author's), with points of view for whoever a beat reached only in part, rendered in two moments;
 * its events cut on a Stop.
 */
async function exchange(ctx: RealtimeCtx, x: ExchangeInput): Promise<RealtimeOutcome> {
  const { at, sink } = ctx;
  const { world, state } = at;
  const texts = ctx.settings.prompts.texts;
  const { w, line, act, pc, name, place, clock, order } = x;
  const who = ctx.talk.with;
  const blobs: Blobs = {};

  const lineChannel: ExposureChannel = line.said !== null ? "hearing" : "sight";
  // Face to face, the exchange is seen as well as heard; unless the world places the two together (one of them
  // unplaced is someone on the line the world never placed), it is only heard, and neither lives what there was
  // to see of the other's side (LIVE3c L3c-4).
  const [pcAt, withAt] = [placeOfEntity(state, pc), placeOfEntity(state, who)];
  const apart = (pcAt !== null || withAt !== null) && !together(world, pcAt, withAt);
  const heard = (said: boolean): Pick<Exposure, "channel" | "also"> => (apart ? { channel: "hearing" } : said ? { channel: "sight", also: ["hearing"] } : { channel: "sight" });
  const lineBeat: Beat = {
    id: x.lineId,
    at: clock,
    order,
    scene: ctx.scene,
    place,
    actors: [pc],
    act: line.said !== null ? "said" : "did",
    about: [{ entity: who }],
    what: putText(blobs, line.what),
    surface: putText(blobs, ctx.line),
    ...(line.said !== null ? { quotes: putText(blobs, line.said) } : {}),
    addressed: [who],
    exposure: [{ who: pc, channel: lineChannel, reach: "whole" }, { who, ...heard(line.said !== null), reach: "whole" }, ...exposures(w.others, world, state)],
    by: { turn: ctx.turn, decided: "player" },
  };
  const answerTexts = actBeatTexts(act, name);
  const answerChannel: ExposureChannel = act.act === "said" ? "hearing" : "sight";
  const addressed = act.addressed && act.addressed.length > 0 ? act.addressed : [pc];
  const attempting = act.attempt !== undefined && act.attempt.trim() !== "";
  Object.assign(blobs, x.answer.blobs);
  x.thought(`${name}: ${answerTexts.surface}`);

  // An attempt in the answer goes to the GM, by the rules (§1.3): its world changes and its outcome follow the answer.
  let attempt: { out: AttemptOut; ms: number } | null = null;
  if (attempting) {
    sink.progress(`The GM resolves what ${name} attempts`);
    const started = performance.now();
    const out = await resolveAttempt(ctx.model, {
      registry: ctx.rt.registry,
      world,
      state,
      act: { actor: who, surface: answerTexts.surface, ...(answerTexts.quotes !== undefined ? { quotes: answerTexts.quotes } : {}), attempt: act.attempt },
      seed: attemptSeed(ctx.seed, x.answerId),
      runSeed: ctx.runSeed,
      scene: x.conversation.map((b) => beatLine(world, state, b)),
      texts,
      signal: ctx.signal,
    });
    attempt = { out, ms: performance.now() - started };
    x.thought(out.reasoning ?? "");
    for (const d of out.read.dropped) x.thought(`The GM's reading of what ${name} attempts dropped ${d.action}: ${d.why}.`);
  }
  const after = attempt?.out.state ?? state;
  const outcome = attempt?.out.outcome ?? null;
  if (outcome !== null) x.thought(`The GM: ${outcome.what}`);

  // Who perceived the answer, and how an attempt in it turned out, is the author's to write, as for
  // every beat (§4.2), once both are decided. Only words said aloud to the player character that
  // attempt nothing reach him as they are, whole, as his line reaches the character (seen and heard
  // face to face, heard alone apart), with whoever else the watch placed to perceive the exchange.
  // Unreadable twice, the line is a scene's.
  let seen: { by: AnswerExposure; ms: number } | null = null;
  if (act.act !== "said" || attempting || !addressed.includes(pc)) {
    sink.progress(`The author reads who perceived what ${name} did`);
    const started = performance.now();
    try {
      const by = await twice(() => answerExposure(ctx.model, { world, state: after, pc, with: who, staging: x.staging, conversation: x.conversation, line, act, outcome, texts, signal: ctx.signal }), ctx.signal);
      seen = { by, ms: performance.now() - started };
    } catch (error) {
      if (ctx.signal.aborted || !(error instanceof DepthAnswerError)) throw error;
      const why = `The author's account of who perceived ${name}'s answer couldn't be read, so the author plays the line as a scene.`;
      x.say(renderPrompt(REALTIME_TEXT.lineTaken, texts, { name, why }));
      return { kind: "takeover", why };
    }
    x.thought(seen.by.reasoning ?? "");
    for (const note of seen.by.notes) x.thought(note);
  }
  const heardBy: Exposure[] = seen ? exposures(seen.by.answer, world, state) : [{ who: pc, ...heard(act.act === "said"), reach: "whole" }, ...exposures(w.others, world, state)];
  const answerBeat: Beat = {
    id: x.answerId,
    at: clock,
    order: order + 1,
    scene: ctx.scene,
    place,
    actors: [who],
    act: act.act,
    about: addressed.map((id): StoryRef => ({ entity: id })),
    what: putText(blobs, answerTexts.what),
    surface: putText(blobs, answerTexts.surface),
    ...(answerTexts.quotes !== undefined && answerTexts.quotes.trim() !== "" ? { quotes: putText(blobs, answerTexts.quotes) } : {}),
    addressed,
    // The character perceives its own act whole; everyone else as decided above.
    exposure: [{ who, channel: answerChannel, reach: "whole" }, ...heardBy],
    by: { turn: ctx.turn, decided: "character" },
  };
  const outcomeBeat: Beat | null =
    outcome === null
      ? null
      : {
          id: beatId(ctx.turn, "talk", "outcome"),
          at: after.clock,
          order: order + 2,
          scene: ctx.scene,
          place,
          actors: [who],
          act: "happened",
          about: outcome.about,
          what: putText(blobs, outcome.what),
          surface: putText(blobs, outcome.surface),
          ...(outcome.quotes !== undefined && outcome.quotes.trim() !== "" ? { quotes: putText(blobs, outcome.quotes) } : {}),
          // Whom the author says it reached, the character included where it did: it lives how it went with its next play or catch-up.
          exposure: exposures(seen?.by.outcome ?? [], world, state),
          by: { turn: ctx.turn, decided: "gm" },
        };

  const worldBeats: Beat[] = w.world.map((wb, i) => {
    // Whoever acts in it perceives their own act (whole, by sight, where the watch left them out), and lives it as its deed.
    const exposure = exposures(wb.perceived, world, state);
    for (const a of wb.by) if (!exposure.some((x) => x.who === a)) exposure.push(...exposures([{ who: a, channel: "sight", reach: "whole" }], world, state));
    return {
      id: beatId(ctx.turn, "talk", "world", String(i)),
      at: after.clock,
      order: order + (outcomeBeat ? 3 : 2) + i,
      scene: ctx.scene,
      place,
      actors: wb.by,
      act: wb.said !== null ? "said" : "happened",
      about: wb.by.map((id): StoryRef => ({ entity: id })),
      what: putText(blobs, wb.what),
      ...(wb.deed !== null ? { deed: putText(blobs, wb.deed) } : {}),
      surface: putText(blobs, wb.surface),
      ...(wb.said !== null ? { quotes: putText(blobs, wb.said) } : {}),
      exposure,
      by: { turn: ctx.turn, decided: "author" },
    };
  });
  for (const wb of w.world) x.thought(`The world: ${wb.what}`);

  // Points of view for whoever a beat reached only in part, or by hearing alone where it holds more
  // than words (§4.2, LIVE3c L3c-4: a phone line never carries what there was to see): the player
  // character's before the narrator renders the beat; anyone else's beside the narration, off the line's critical path.
  const povStaging: PovStaging[] = [...x.staging.entries()].map(([id, s]) => ({ who: id, where: s.where, doing: s.doing, ...(s.occluded !== undefined ? { occluded: s.occluded } : {}) }));
  const needs = (beat: Beat, e: Exposure): boolean => e.reach === "partial" || (heardAlone(beat, e.who) && !wordsAlone(beat));
  const renderPov = async (beat: Beat): Promise<void> => {
    const partial = beat.exposure.filter((e) => needs(beat, e)).map((e) => e.who);
    if (partial.length === 0) return;
    const quotes = beat.quotes !== undefined ? blobs[beat.quotes] : undefined;
    const refs = povRefs(ctx.rt, at, partial, [...presentAt(beat), ...povStaging.map((s) => s.who)]);
    const deed = beat.deed !== undefined ? blobs[beat.deed] : undefined;
    const r = await povRender(ctx.model, { beat: { id: beat.id, surface: blobs[beat.surface] ?? "", ...(deed !== undefined ? { deed } : {}), ...(quotes !== undefined ? { quotes } : {}), actors: beat.actors, exposure: beat.exposure }, staging: povStaging, who: partial, refs, texts, signal: ctx.signal });
    beat.exposure = beat.exposure.map((e) => {
      const pov = partial.includes(e.who) ? r.povs[e.who] : undefined;
      return pov !== undefined ? { ...e, pov: putText(blobs, pov) } : e;
    });
  };
  const pcInPart = (beat: Beat): boolean => beat.exposure.some((e) => e.who === pc && needs(beat, e));
  const exchanged = [lineBeat, answerBeat, ...(outcomeBeat ? [outcomeBeat] : [])];
  const beats = [...exchanged, ...worldBeats];
  await Promise.all(beats.filter(pcInPart).map(renderPov));
  const renderBeat = (beat: Beat): RenderBeat => {
    const pov = beat.exposure.find((e) => e.who === pc && needs(beat, e))?.pov;
    const quotes = beat.quotes !== undefined ? blobs[beat.quotes] : undefined;
    const povText = pov !== undefined ? blobs[pov] : undefined;
    return { beat, what: blobs[beat.what] ?? "", surface: blobs[beat.surface] ?? "", ...(quotes !== undefined ? { quotes } : {}), ...(povText !== undefined ? { pov: povText } : {}) };
  };

  // The events in decision order, in the two moments they render in: the line and its answer (with
  // an attempt's world changes and outcome), then the world's beats; the talk's end closes them.
  const first: LedgerEvent[] = [beatEvent(lineBeat), beatEvent(answerBeat), ...x.answer.events, ...(attempt?.out.events ?? []), ...(outcomeBeat ? [beatEvent(outcomeBeat)] : [])];
  const then: LedgerEvent[] = worldBeats.map(beatEvent);
  const end = w.end !== null ? talkEvent({ with: who, state: "off", by: "author", scene: ctx.scene, why: w.end }) : null;
  if (end) (then.length > 0 ? then : first).push(end);

  const narration = ctx.narrate((mark) => (mark <= 0 ? first.length : first.length + then.length));
  const staged = x.staging.get(pc);
  narration.add({ beats: exchanged.map(renderBeat), ...(staged ? { staging: staged } : {}), mark: 0 } satisfies Moment);
  if (worldBeats.length > 0) narration.add({ beats: worldBeats.map(renderBeat), ...(staged ? { staging: staged } : {}), mark: 1 } satisfies Moment);
  const [narrated] = await Promise.all([narration.drain(), ...beats.filter((b) => !pcInPart(b)).map(renderPov)]);

  // A Stop keeps the moments whose prose streamed (§9.2): none, the line and its answer, or all.
  const kept = !narrated.stopped ? [...first, ...then] : narrated.streamedThrough === null ? [] : narrated.streamedThrough === 0 ? first : [...first, ...then];
  const ended = end !== null && kept.includes(end);
  if (ended) x.say(renderPrompt(REALTIME_TEXT.lineEnded, texts, { name, why: w.end ?? "" }));
  if (!narrated.stopped) {
    const render = narrated.told.reduce((n, p) => n + p.ms.render, 0);
    const check = narrated.told.reduce((n, p) => n + p.ms.check, 0);
    const vars = { name, play: seconds(x.playMs), watch: seconds(x.watchMs), render: seconds(render), check: seconds(check), total: seconds(performance.now() - x.t0) };
    if (seen) x.say(renderPrompt(REALTIME_TEXT.lineExposure, texts, { name, exposure: seconds(seen.ms) }));
    x.say(attempt ? renderPrompt(REALTIME_TEXT.lineLatencyGm, texts, { ...vars, gm: seconds(attempt.ms) }) : renderPrompt(REALTIME_TEXT.lineLatency, texts, vars));
  }
  return {
    kind: "exchange",
    events: kept,
    blobs: kept.length > 0 ? blobs : {},
    narration: narrated,
    ...(w.poll === "later" && !ended ? { pollDeferred: true } : {}),
    ...(ended ? { ended: true } : {}),
  };
}
