// The author as DM (DEPTH-PLAN §4.4, §4.5, §5.2, §6.4): pure stages that ask the author through the
// port they are given and read its answer, checked against the people and places the chat has. The
// loop (`turn.ts`) turns what they give into beats, staging and events; the after-reply step
// (`after.ts`) lands the poll and the reflection as layer entries; an edit's amendment (`edit.ts`)
// lands the same way. A stage never lands anything.
//
//   setup     each turn: the scene, its staging, each character's effort, who perceived the player's
//             beats, an opening and the world's beats, who acts first, real time on or off; it may
//             read the chat's archive first, and pull excerpts of it for the narrator (quotes)
//   step      after a decided beat: who perceived it and how fully, what the world does now, the acts
//             of those the author plays or handles, who acts next, or the turn ends
//   ask       the narrator's question about a detail canon lacks: decided as a beat, or not at all
//   poll      after each turn: who catches up now, who reflects, the author's own reflection,
//             predictions scored, and a log of what it considered and didn't raise
//   reflect   a scene's or a chapter's end: the notebook revised, each arc checked for drift, and
//             predictions made
//   edit      the player's edit of a reply or of his own message, his directive: the beats it amends
//             or strikes, or none
//
// The author's judgment is its own: these stages only check an answer's shape and its ids. What
// isn't the author's to write (an act for a character playing as its own agent, the player
// character's acts, a pinned notebook file) is refused and said back, never silently dropped.

import { SCENE_TEXT } from "../../../shared/scene-prompts";
import type { DepthEffort } from "../../../shared/depth-views";
import { DEPTH_TREATMENTS, type DepthRole, type DepthTreatment } from "../../../shared/depth-settings";
import type { EntityId, PlaceId } from "../../../shared/ids";
import { hasOwn, type JsonObject } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import type { PromptTexts } from "../../../shared/prompts";
import { SCENE_EFFORTS, type SceneCast } from "../../../shared/scene";
import { BEAT_ACTS, EXPOSURE_CHANNELS, exposureChannels, type BeatAct, type BeatDecider, type ExposureChannel, type StoryRef } from "../../../shared/story";
import { SCORE_OUTCOMES, DRIFT_LEVELS, type DriftLevel, type PollConsidered, type ScoreOutcome } from "../../../shared/author";
import type { WorldDoc } from "../../../shared/world";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { isNotebookPath, notebookEvent, type NotebookEventData, type NotebookKind } from "../../../engine/notebook";
import { own } from "../../../engine/pack-kit";
import { placeDistance } from "../../../engine/place-names";
import { isGone } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { wsWrite } from "../../../engine/workspace";
import { renderPrompt } from "../../prompts";
import type { AgentTool } from "../../agents/runtime";
import { archiveTools, wholeArg, type ArchiveSource } from "../archive-tools";
import { onScreenOut, type OnScreenAllowance } from "../budget";
import { answerWhy, bareId, DepthAnswerError, nameKey, putText, readAnswer, spoken, type BeatText, type Blobs, type Reading, type StageCost } from "../common";
import { mindEditsText, type NotebookRead } from "../notebook";
import { addUsage, NO_USAGE, type ModelPort, type PortMessage, type PortUsage } from "../port";
import type { ArchivePassage } from "./contract";

// ------------------------------------------------------------------ what every stage shares

/** What every author stage reads: the world and the state it plays in, the user's texts, the player character, the port. */
export interface AuthorCtx {
  world: WorldDoc;
  state: Readonly<WorldState>;
  texts: PromptTexts;
  /** The player character (`povOf`, D-10). */
  pov: EntityId;
  model: ModelPort;
  signal?: AbortSignal;
}

/** Who was placed to perceive a beat, as an answer gives it. */
export interface ExposureDraft {
  who: EntityId;
  channel: ExposureChannel;
  reach: "whole" | "partial";
}

/** A beat as the author (or the GM, or a character's play) decided it, before the loop gives it its id, minute, order and place. Texts are words. */
export interface DraftBeat {
  /** The answer's own ref, which exposure and amendments name it by. */
  ref: string;
  decided: BeatDecider;
  actors: EntityId[];
  act: BeatAct;
  what: string;
  /** What its actors did and said, plainly, as they did it: each lives it as their own act (`reachOf`, LIVE3 L3a-4); only for a beat someone acts in. */
  deed?: string;
  /** What was there to sense, as anyone there could sense it, from no one's side. */
  surface: string;
  quotes?: string;
  addressed?: EntityId[];
  about: StoryRef[];
  /** Minutes since the beat before it. */
  after?: number;
  /** Its exposure, where the answer gave it; the next step writes it otherwise. */
  exposure: ExposureDraft[];
  /** The player character's inner life: a beat no one but him perceives, whatever exposure an answer gives it. */
  inner?: true;
  /** Its writer's doubt (the GM's, telling an outcome the rules decided). */
  uncertain?: string;
  /** What its actor tries that the world's rules decide, for the GM to resolve (an off-screen episode's beats, `offscreen/episode.ts`). */
  attempt?: string;
}

/** A staging as an answer gives it. */
export interface StagingDraft {
  who: EntityId;
  where: string;
  doing: string;
  occluded?: string;
  /** The world's place they are at, as the author placed them (the scene's own for everyone there in person): where the scene moves them when the state has them elsewhere (`Turn.placed`, LIVE3c L3c-2). */
  place?: PlaceId;
  /** Elsewhere, reached only from afar (the far end of a phone call, a radio, a screen): never moved (LIVE3c L3c-2). */
  remote?: true;
}

/** An exposure an answer writes for a beat decided before it, by the beat's ref. */
export interface ExposureFor extends ExposureDraft {
  beat: string;
}

const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The people, places and things an answer may name, by id, `[id]` or name. */
export interface Names {
  person(raw: unknown): EntityId | null;
  place(raw: unknown): PlaceId | null;
  ref(raw: unknown): StoryRef | null;
  name(id: EntityId): string;
}

/** The chat's people (every entity not gone, by id or name) and places, as the author's answers name them. */
export function namesOf(world: WorldDoc, state: Readonly<WorldState>): Names {
  const byName = new Map<string, EntityId>();
  for (const [id, e] of Object.entries(state.entities)) if (e && !isGone(state, id) && e.name) byName.set(nameKey(e.name), id);
  const places = new Map<string, PlaceId>();
  for (const [id, p] of Object.entries(world.places)) places.set(nameKey(p.name), id);
  const bare = (raw: unknown): string => (typeof raw === "string" ? raw.trim().replace(/^\[([^[\]]+)\]$/, "$1") : "");
  const person = (raw: unknown): EntityId | null => {
    const id = bare(raw);
    if (id === "") return null;
    if (hasOwn(state.entities, id) && !isGone(state, id)) return id;
    return byName.get(nameKey(id)) ?? null;
  };
  const place = (raw: unknown): PlaceId | null => {
    const id = bare(raw);
    if (id === "") return null;
    return hasOwn(world.places, id) ? id : (places.get(nameKey(id)) ?? null);
  };
  return {
    person,
    place,
    ref: (raw) => {
      const p = person(raw);
      if (p) return { entity: p };
      const pl = place(raw);
      return pl ? { place: pl } : null;
    },
    name: (id) => own(state.entities, id)?.name ?? own(world.entities, id)?.name ?? id,
  };
}

/** A person's name with its id, as the author reads and writes them: `Mira [mira]`. */
export function tag(names: Names, id: EntityId): string {
  const n = names.name(id);
  return n !== id ? `${n} [${id}]` : `[${id}]`;
}

/** Asks the author with its editable system text and the data it reads, for one JSON object, with the `Reading` it is read through; one that holds none fails, its keeper told (`readAnswer`). */
export async function ask(ctx: AuthorCtx, id: string, data: string): Promise<{ answer: Record<string, unknown>; read: Reading } & StageCost> {
  const system = renderPrompt(id, ctx.texts, { world: ctx.world.name, pov: own(ctx.state.entities, ctx.pov)?.name ?? ctx.pov });
  const reply = await ctx.model("author", [{ role: "system", content: system }, { role: "user", content: data }], { json: true, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  const { answer, read } = readAnswer("author", reply);
  if (!answer) throw new DepthAnswerError("author", reply.text, reply);
  return { answer, read, ...(reply.reasoning ? { reasoning: reply.reasoning } : {}), ...(reply.usage ? { usage: reply.usage } : {}) };
}

/** A conversation with the author: its messages so far, and what its answers cost. */
export interface Talk {
  messages: PortMessage[];
  reasoning: string[];
  usage?: PortUsage;
  /** The last answer's reading (`readAnswer`), for a stage that keeps what it dropped. */
  read?: Reading;
}

/** A conversation's start: the stage's editable system text, then the data it reads. */
export function talkOf(ctx: AuthorCtx, id: string, data: string): Talk {
  const system = renderPrompt(id, ctx.texts, { world: ctx.world.name, pov: own(ctx.state.entities, ctx.pov)?.name ?? ctx.pov });
  return { messages: [{ role: "system", content: system }, { role: "user", content: data }], reasoning: [] };
}

/** Who answers a conversation (the author, by default; the GM for its own stages) and the room its answer has. */
export interface TalkCall {
  role: DepthRole;
  maxTokens?: number;
}

/** The author's next answer in a conversation, kept in it: one JSON object; one that holds none fails, its keeper told (`readAnswer`). */
async function answerIn(ctx: AuthorCtx, talk: Talk, call: TalkCall = { role: "author" }): Promise<Record<string, unknown>> {
  const reply = await ctx.model(call.role, talk.messages, { json: true, ...(call.maxTokens !== undefined ? { maxTokens: call.maxTokens } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
  if (reply.usage) talk.usage = addUsage(talk.usage ?? NO_USAGE, reply.usage);
  if (reply.reasoning) talk.reasoning.push(reply.reasoning);
  const { answer, read } = readAnswer(call.role, reply);
  if (!answer) throw new DepthAnswerError(call.role, reply.text, reply);
  talk.read = read;
  talk.messages.push({ role: "assistant", content: reply.text });
  return answer;
}

/** Rounds of archive reads the setup may take before it answers, and reads per round (a prompt's bound, not a judgment). */
export const ARCHIVE_ROUNDS = 3;
const READS_PER_ROUND = 6;
/** Excerpts one setup may pull for the narrator where none is given (a prompt's bound; Settings → Depth's `reads.narratorQuotes`). */
export const QUOTES_MOST = 6;

/** The archive's tools as the setup's data describes them: each one's name, what it does, and its arguments. */
export function toolsText(tools: readonly AgentTool[]): string {
  return tools
    .map((t) => {
      const props = record(t.parameters.properties) ?? {};
      const args = Object.entries(props).map(([name, p]) => `${name} (${text(record(p)?.description)})`);
      return `- ${t.name}: ${t.description}${args.length > 0 ? ` Arguments: ${args.join("; ")}.` : ""}`;
    })
    .join("\n");
}

/**
 * The setup's answer, with the archive's tools read as JSON rounds (the depth port is text): an
 * answer holding `"archive": [{"tool": name, ...its arguments}]` gets what each read found, and the
 * author answers again, up to `ARCHIVE_ROUNDS`; after the last, its next answer is taken whatever it
 * holds. Each read is said back for the thinking block (`reads`). No tools: one answer. `answering`
 * names what it answers once it has read (the scene, by default; a page of a settlement's pins).
 */
export async function askReading(ctx: AuthorCtx, talk: Talk, tools: readonly AgentTool[], answering = "the scene", call?: TalkCall): Promise<{ answer: Record<string, unknown>; reads: string[] }> {
  const signal = ctx.signal ?? new AbortController().signal;
  const reads: string[] = [];
  for (let round = 0; ; round++) {
    const answer = await answerIn(ctx, talk, call);
    const wanted = tools.length === 0 ? [] : list(answer.archive).map(record).filter((r): r is Record<string, unknown> => r !== null);
    if (wanted.length === 0 || round >= ARCHIVE_ROUNDS) return { answer, reads };
    const found: string[] = [];
    for (const [i, w] of wanted.slice(0, READS_PER_ROUND).entries()) {
      const { tool: name, ...args } = w;
      const tool = tools.find((t) => t.name === name);
      const asked = `${typeof name === "string" ? name : "?"} ${JSON.stringify(args)}`;
      const out = tool ? await tool.run(args as JsonObject, { signal, agentId: "author", role: "author", callId: `setup.${round}.${i}` }) : { text: `No tool "${String(name)}": the archive's are ${tools.map((t) => t.name).join(" and ")}.`, error: true as const };
      reads.push(`The ${call?.role === "gm" ? "GM" : "author"} reads the archive: ${asked}${out.error ? ` (${out.text})` : ""}`);
      found.push(`### ${asked}\n${out.text}`);
    }
    if (wanted.length > READS_PER_ROUND) found.push(`(Only the first ${READS_PER_ROUND} reads of a round are made; the other ${wanted.length - READS_PER_ROUND} weren't.)`);
    const left = ARCHIVE_ROUNDS - round - 1;
    talk.messages.push({ role: "user", content: `What the archive gave:\n\n${found.join("\n\n")}\n\n${left > 0 ? `Read more (${left} ${left === 1 ? "round" : "rounds"} left), or answer ${answering}.` : `That was your last read: answer ${answering} now.`}` });
  }
}

/** The archive as a stage past setup offers it (Y8): its tools, and the line its data closes with, saying them and their bound; none without an archive. */
export function archiveOffer(ctx: AuthorCtx, archive: ArchiveSource | undefined, answering: string): { tools: AgentTool[]; line: string } {
  const tools = archive ? archiveTools({ texts: ctx.texts, world: ctx.world, state: ctx.state, source: archive }) : [];
  const line =
    tools.length > 0
      ? `The chat's archive, its own prose as it was written, is yours to read before you answer: answer {"archive": [{"tool": a tool's name, then its arguments}]} alone, and what each read found comes back; up to ${ARCHIVE_ROUNDS} rounds of reading (${READS_PER_ROUND} reads each), then you answer ${answering}. Its tools:\n${toolsText(tools)}`
      : "";
  return { tools, line };
}

/** A stage's answer with the chat's archive to hand, read in the setup's JSON rounds (`askReading`); no archive, one answer. */
export async function askArchive(ctx: AuthorCtx, id: string, data: string, archive: ArchiveSource | undefined, answering: string): Promise<{ answer: Record<string, unknown>; reads: string[] } & StageCost> {
  const { tools, line } = archiveOffer(ctx, archive, answering);
  const talk = talkOf(ctx, id, line !== "" ? `${data}\n\n${line}` : data);
  const { answer, reads } = await askReading(ctx, talk, tools, answering);
  return { answer, reads, ...(talk.reasoning.length > 0 ? { reasoning: talk.reasoning.join("\n\n") } : {}), ...(talk.usage ? { usage: talk.usage } : {}) };
}

/** The excerpts a setup's `quotes` name, read from the archive exactly as written; each it can't take is said back. */
async function quotesOf(raw: unknown, archive: ArchiveSource | undefined, world: WorldDoc, refused: string[], most: number = QUOTES_MOST): Promise<ArchivePassage[]> {
  const asked = list(raw).map(record).filter((r): r is Record<string, unknown> => r !== null);
  if (asked.length === 0) return [];
  if (!archive) {
    refused.push("the archive can't be read this turn, so no quote reaches the narrator");
    return [];
  }
  if (asked.length > most) refused.push(`only the first ${most} quotes reach the narrator; the other ${asked.length - most} don't`);
  const cal = calendarOf(world);
  const out: ArchivePassage[] = [];
  for (const q of asked.slice(0, most)) {
    const messageId = typeof q.message === "string" ? bareId(q.message) : "";
    if (messageId === "") {
      refused.push("a quote named no message");
      continue;
    }
    const from = wholeArg(q.from);
    const to = wholeArg(q.to);
    const got = await archive.quote({ messageId, ...(from !== null && to !== null && to > from ? { span: [Math.max(0, from), to] as [number, number] } : {}) });
    if (!got) {
      refused.push(`a quote named ${messageId}, which isn't a message of this chat's story before this turn`);
      continue;
    }
    if (got.text.trim() === "") {
      refused.push(`a quote of ${messageId} held no words`);
      continue;
    }
    out.push({ messageId: got.messageId, index: got.index, when: got.storyTime !== null ? formatClock(cal, got.storyTime) : null, text: got.text, truncated: got.truncated, why: text(q.why) });
  }
  return out;
}

function exposureOf(raw: unknown, names: Names, refused: string[], what: string): ExposureDraft | null {
  const x = record(raw);
  if (!x) return null;
  const who = names.person(x.who);
  if (!who) {
    refused.push(`${what}: an exposure named someone the chat doesn't have (${text(x.who) || "no one"})`);
    return null;
  }
  const channel = (EXPOSURE_CHANNELS as readonly string[]).includes(text(x.channel)) ? (text(x.channel) as ExposureChannel) : "sight";
  return { who, channel, reach: x.reach === "partial" ? "partial" : "whole" };
}

/** Exposure entries, one per person (the first given wins). */
function exposuresOf(raw: unknown, names: Names, refused: string[], what: string): ExposureDraft[] {
  const out: ExposureDraft[] = [];
  for (const r of list(raw)) {
    const x = exposureOf(r, names, refused, what);
    if (x && !out.some((o) => o.who === x.who)) out.push(x);
  }
  return out;
}

/** Who may act in the author's own beats: anyone but the player character and those playing as their own agents. */
export interface Authorship {
  /** Characters playing as their own agents this scene: they decide their own acts. */
  agents: ReadonlySet<EntityId>;
  /** The scene plays where the player character is: a beat that named him beside its actors and as the one they addressed has him perceive it, whole by sight, where the answer left him out, as each of its actors does. */
  onScreen?: true;
}

/** A beat an answer wrote for someone whose acts aren't the author's to write (the player character, someone playing as their own agent): refused, with whom. */
export interface NotTheirs {
  beat: string;
  who: EntityId[];
}

/**
 * The beats an answer writes for the author (world beats, and the acts of those it plays or handles),
 * checked; refusals say why, and a beat refused for whose acts it wrote is in `taken`. The player
 * character named beside others among its actors, where the answer also names him as the one they
 * addressed, is that (LIVE3 lane 1b): being addressed is not acting, so he leaves its actors and is
 * kept as addressed, said so the author hears it in its next step. Anywhere else among its actors, a
 * beat's sole actor or one of several the answer didn't say addressed him, he acts in it: no reading
 * of the author's intent takes him out of a joint act, so the beat is an act of his, and is refused.
 */
export function draftBeats(raw: unknown, names: Names, ctx: AuthorCtx, who: Authorship, refused: string[], prefix: string, taken?: NotTheirs[]): DraftBeat[] {
  const out: DraftBeat[] = [];
  list(raw).forEach((r, i) => {
    const b = record(r);
    if (!b) return;
    const ref = str(b.ref) ? b.ref.trim() : `${prefix}${i + 1}`;
    const what = text(b.what);
    const surface = text(b.surface);
    if (what === "" || surface === "") {
      refused.push(`beat ${ref}: a beat needs what happened and what was there to sense`);
      return;
    }
    const named = [...new Set(list(b.actors).map((a) => names.person(a)).filter((a): a is EntityId => a !== null))];
    const addressedNamed = list(b.addressed).map((a) => names.person(a)).filter((a): a is EntityId => a !== null);
    const addressedPc = named.length > 1 && named.includes(ctx.pov) && addressedNamed.includes(ctx.pov);
    const actors = addressedPc ? named.filter((a) => a !== ctx.pov) : named;
    const notTheirs = [...actors.filter((a) => a === ctx.pov), ...actors.filter((a) => a !== ctx.pov && who.agents.has(a))];
    if (notTheirs.length > 0) {
      const agents = notTheirs.length - (notTheirs.includes(ctx.pov) ? 1 : 0);
      const why = !notTheirs.includes(ctx.pov) ? `playing as their own ${agents === 1 ? "agent" : "agents"}` : agents === 0 ? "the player character is the player's" : `the player character is the player's, and ${agents === 1 ? "the other plays as their own agent" : "the others play as their own agents"}`;
      // Beside others, he may have been only the one they spoke to or acted on: the answer says so in its "addressed", never this reading.
      const beside = notTheirs.includes(ctx.pov) && named.length > 1 ? `; where the others only spoke to him or acted on him, name ${tag(names, ctx.pov)} in its "addressed" and its exposure, never its actors` : "";
      refused.push(`beat ${ref}: ${notTheirs.map((a) => tag(names, a)).join(", ")} ${notTheirs.length === 1 ? "decides" : "decide"} their own acts (${why}); the beat wasn't kept${beside}`);
      taken?.push({ beat: ref, who: notTheirs });
      return;
    }
    if (addressedPc) refused.push(`beat ${ref}: ${tag(names, ctx.pov)} isn't one of its actors: being addressed is not acting, and his acts are the player's. It was kept as the act of ${actors.map((a) => tag(names, a)).join(", ")}, with him as the one addressed; put him in a beat's exposure, never its actors`);
    const act = (BEAT_ACTS as readonly string[]).includes(text(b.act)) ? (text(b.act) as BeatAct) : actors.length > 0 ? "did" : "happened";
    const quotes = spoken(b.quotes);
    const addressed = [...new Set(addressedNamed)];
    const about = list(b.about)
      .map((a) => names.ref(a))
      .filter((a): a is StoryRef => a !== null);
    const after = typeof b.after === "number" && Number.isFinite(b.after) && b.after > 0 ? Math.round(b.after) : undefined;
    const attempt = text(b.attempt);
    // What its actors did and said as they did it, which each lives as their own act (LIVE3 L3a-4): a beat no one acts in has none, and one whose actors have none they live from the inside, as the point-of-view render tells it (`ownActWithoutDeed`).
    const deed = text(b.deed);
    if (deed !== "" && actors.length === 0) refused.push(`beat ${ref}: no one acts in it, so its deed wasn't kept`);
    const exposure = exposuresOf(b.exposure, names, refused, `beat ${ref}`);
    if (addressedPc && who.onScreen && !exposure.some((x) => x.who === ctx.pov)) exposure.push({ who: ctx.pov, channel: "sight", reach: "whole" });
    out.push({
      ref,
      decided: "author",
      actors,
      act,
      what,
      ...(deed !== "" && actors.length > 0 ? { deed } : {}),
      surface,
      ...(quotes !== "" ? { quotes } : {}),
      ...(addressed.length > 0 ? { addressed } : {}),
      about,
      ...(after !== undefined ? { after } : {}),
      exposure,
      ...(attempt !== "" && actors.length > 0 ? { attempt } : {}),
    });
  });
  return out;
}

/** Whom a scene's staging gives neither a place nor "remote" (`stagingsOf`): `pov` aside, since the player character given no place is at the scene's place (`Turn.placed`). */
export interface Unplaced {
  pov: EntityId;
  who: EntityId[];
}

/**
 * The stagings an answer gives, checked. A scene's (`placing`, the setup's and each step's) says
 * where each person is (LIVE3c L3c-2): a place of the world's, or reached from afar. A place the world
 * lacks is said back, and places them nowhere: no place is guessed. One that gives someone neither (a
 * Prompts override of its text written before either was asked, the final correctness review's
 * finding 1) is said back, and they are in `placing.who`, for the author to be asked once more
 * (`askAgain`); still given none, they stay where they were.
 */
export function stagingsOf(raw: unknown, names: Names, refused: string[], placing?: Unplaced): StagingDraft[] {
  const out: StagingDraft[] = [];
  for (const r of list(raw)) {
    const s = record(r);
    if (!s) continue;
    const who = names.person(s.who);
    if (!who) {
      refused.push(`a staging named someone the chat doesn't have (${text(s.who) || "no one"})`);
      continue;
    }
    const where = text(s.where);
    const doing = text(s.doing);
    if (where === "" || doing === "") continue;
    const occluded = text(s.occluded);
    const remote = s.remote === true;
    const said = remote ? "" : text(s.place);
    const place = said !== "" ? names.place(said) : null;
    if (said !== "" && place === null) refused.push(`the staging placed ${tag(names, who)} at "${said}", which isn't one of the world's places, so they stay where they were`);
    else if (placing && !remote && said === "" && who !== placing.pov) {
      refused.push(`the staging gave ${tag(names, who)} neither the place they are at nor "remote", so they stay where they were: no place is guessed`);
      if (!placing.who.includes(who)) placing.who.push(who);
    }
    out.push({ who, where, doing, ...(occluded !== "" ? { occluded } : {}), ...(remote ? { remote: true as const } : place !== null ? { place } : {}) });
  }
  return out;
}

export function exposureForOf(raw: unknown, names: Names, refs: ReadonlySet<string>, refused: string[]): ExposureFor[] {
  const out: ExposureFor[] = [];
  for (const r of list(raw)) {
    const x = record(r);
    if (!x) continue;
    const beat = text(x.beat);
    if (!refs.has(beat)) {
      refused.push(`an exposure named a beat that isn't waiting for one (${beat || "none"})`);
      continue;
    }
    const e = exposureOf(x, names, refused, `beat ${beat}`);
    if (e && !out.some((o) => o.beat === beat && o.who === e.who)) out.push({ beat, ...e });
  }
  return out;
}

/** Who acts next on their own, of those an answer names: each playing as their own agent; anyone else is refused, said with what to do instead (the player character's turn is the player's answer). */
export function nextOf(raw: unknown, names: Names, agents: ReadonlySet<EntityId>, refused: string[], pov?: EntityId): EntityId[] {
  const out: EntityId[] = [];
  for (const r of list(raw)) {
    const who = names.person(r);
    if (!who) continue;
    if (who === pov) {
      refused.push(`${tag(names, who)} is the player character: what he does next is the player's, so end the turn where his answer is wanted`);
      continue;
    }
    if (!agents.has(who)) {
      refused.push(`${tag(names, who)} doesn't play as their own agent this scene, so they don't act next on their own; write their acts yourself`);
      continue;
    }
    if (!out.includes(who)) out.push(who);
  }
  return out;
}

// ------------------------------------------------------------------ an answer that can't all be kept

/**
 * The setup or a step asked again (LIVE3 L3a-3, L3a-8, L3b-3, and a staging that places someone
 * nowhere, the final correctness review's finding 1): what its answer couldn't keep is said back to
 * the author, each with why, with what to do instead for what it wrote that wasn't its, or left out
 * (`wrote`), and it answers the same step again, whole, in the same conversation. Null when that
 * answer can't be read: the first then stands, without what couldn't be kept.
 */
async function askAgain(ctx: AuthorCtx, talk: Talk, names: Names, unkept: readonly string[], what: string, wrote: { theirs: boolean; place?: boolean; realtime?: boolean; staged?: boolean; screen?: boolean }): Promise<Record<string, unknown> | null> {
  const notes = [
    ...(wrote.theirs ? [`${tag(names, ctx.pov)} is the player's: never write an act of his; where the moment turns to him, end the turn for his answer. Whoever plays as their own agent decides their own acts: name them in "next", and their own agent plays them now.`] : []),
    ...(wrote.place ? ["Name the scene's place by the id of one of the world's places, as listed."] : []),
    ...(wrote.realtime ? ['Real-time dialogue is with someone playing as their own agent: to enter it, cast them "agent" and name them in "realtime"; else give no "realtime".'] : []),
    ...(wrote.staged ? ['Give each person you stage "place": the id of the world\'s place where they are, as listed (the scene\'s own place for everyone there in person), or "remote": true, with no place, for someone elsewhere whom the scene reaches only from afar (the far end of a phone call, a radio, a screen).'] : []),
    ...(wrote.screen ? ['The on-screen allowance is spent: cast no one "agent" this turn. Play whom you would have given their own agent yourself ("author"), or handle them as part of the world ("world"); real-time dialogue waits for the allowance.'] : []),
  ];
  talk.messages.push({ role: "user", content: `Not all of your answer could be kept:\n${unkept.map((r) => `- ${r}`).join("\n")}\n\nAnswer ${what} again, whole, as one JSON object of the same shape: it replaces your answer above. ${notes.join(" ")}` });
  try {
    return await answerIn(ctx, talk);
  } catch (error) {
    if (!(error instanceof DepthAnswerError) || ctx.signal?.aborted) throw error;
    return null;
  }
}

/**
 * Whoever the answer the turn goes on with still wrote an act for, of those playing as their own
 * agents (LIVE3 L3a-3), acts now as their own agent in its place: named next, and the turn doesn't
 * end before they have; said. The player character's act is only refused: his next act is the player's.
 */
function theirsNow(taken: readonly NotTheirs[], agents: ReadonlySet<EntityId>, names: Names, read: { next: EntityId[]; end: string | null }, refused: string[]): { next: EntityId[]; end: string | null } {
  const due = [...new Set(taken.flatMap((t) => t.who))].filter((who) => agents.has(who));
  if (due.length === 0) return { next: read.next, end: read.end };
  const one = due.length === 1;
  refused.push(`${due.map((who) => tag(names, who)).join(", ")} ${one ? "plays as their own agent: their own agent acts" : "play as their own agents: their own agents act"} now in place of the ${one ? "act" : "acts"} written for them${read.end !== null ? `, and the turn goes on to ${one ? "it" : "them"} rather than ending` : ""}`);
  return { next: [...new Set([...read.next, ...due])], end: null };
}

// ------------------------------------------------------------------ the data a stage reads

/** The notebook as the author's stable prefix reads it: every file, the pinned ones marked, and the player's edits it hasn't written over. */
export function notebookText(notebook: NotebookRead): string {
  const pinned = new Set(notebook.pinned.map((p) => p.path));
  const files = Object.entries(notebook.files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, body]) => `### ${path}${pinned.has(path) ? " (pinned: the player's own words)" : ""}\n${body}`);
  const edits = notebook.pinned.map((p) => `### ${p.path}\nYou last wrote:\n${p.before || "(nothing: he wrote this file)"}\nHe made it:\n${p.after}`);
  return [`Your notebook:\n\n${files.join("\n\n") || "(empty: this is its start)"}`, ...(edits.length > 0 ? [`The player edited your notebook (each a directive):\n\n${edits.join("\n\n")}`] : []), ...mindEditsText(notebook)].join("\n\n");
}

/** One beat of the scene as the author reads it: its ref, minute, place, who did what (the truth), the words, and who perceived it, by every way it reached them. */
export function beatText(world: WorldDoc, names: Names, ref: string, b: BeatText): string {
  const { beat } = b;
  const exposure = beat.exposure.map((x) => `${tag(names, x.who)} by ${exposureChannels(x).join(" and ")}${x.reach === "partial" ? ", in part" : ""}`).join("; ");
  const place = own(world.places, beat.place)?.name ?? beat.place;
  const by = "turn" in beat.by ? beat.by.decided : "draft" in beat.by ? "a draft" : "history";
  return `- (${ref}) ${formatClock(calendarOf(world), beat.at)}, ${place}; ${beat.act} by ${beat.actors.map((a) => tag(names, a)).join(", ") || "no one"} (decided by ${by}): ${b.what}${b.quotes ? ` Words: “${b.quotes}”` : ""} Perceived by: ${exposure || "no one yet"}.`;
}

/** A draft beat waiting for its exposure, as the author reads it. */
export function draftText(names: Names, d: DraftBeat): string {
  return `- (${d.ref}) ${d.act} by ${d.actors.map((a) => tag(names, a)).join(", ") || "no one"} (decided by ${d.decided})${d.inner ? " (his inner life: no one but him perceives it)" : ""}: ${d.what}${d.quotes ? ` Words: “${d.quotes}”` : ""} What was there to sense: ${d.surface}`;
}

/** A staging as the author reads it, with where it placed them when it said. */
export function stagingText(names: Names, s: StagingDraft): string {
  return `- ${tag(names, s.who)}: ${s.where}; ${s.doing}${s.occluded ? `; blocked: ${s.occluded}` : ""}${s.remote ? " (remote: reached from afar)" : s.place ? ` (at [${s.place}])` : ""}`;
}

/** The world's places the setup reads at most, nearest the player character first (a prompt's bound). */
export const PLACES_READ = 60;

/** The world's places as the setup reads them, each by its name and id, with the place it is in: where a scene may play (LIVE3 L3a-8). Nearest `here` first, up to `most` (Settings → Depth's `reads.places`; `PLACES_READ` where none is given). */
export function placesText(world: WorldDoc, here: PlaceId | null, most: number = PLACES_READ): string {
  const all = Object.entries(world.places);
  const shown = all.sort(([a, x], [b, y]) => (here !== null ? placeDistance(world, here, a) - placeDistance(world, here, b) : 0) || x.name.localeCompare(y.name)).slice(0, most);
  const lines = shown.map(([id, p]) => {
    const parent = p.parent !== undefined ? own(world.places, p.parent) : undefined;
    return `- ${p.name} [${id}]${parent ? `, in ${parent.name}` : ""}`;
  });
  const more = all.length - shown.length;
  return `The world's places, each by its id (a scene plays at one of them):\n${lines.join("\n") || "- (none)"}${more > 0 ? `\n(and ${more} more, farther off: name one by its id or name)` : ""}`;
}

/** A person the scene may hold, as the author reads them: who, where, whether they have a mind (and so may play as their own agent). */
export interface Present {
  who: EntityId;
  /** Where they are, in words, when they aren't with the player character. */
  where?: string;
  mind: boolean;
}

/** A character the author plays, as it reads them: their core, story of themselves, how they are now, and what they keep in mind. */
export interface PlayedMind {
  who: EntityId;
  files: { core?: string; self?: string; now?: string; mind?: string };
}

export function playedText(names: Names, played: readonly PlayedMind[]): string {
  return played
    .map((p) => {
      const parts = [p.files.core && `Who they are at root:\n${p.files.core}`, p.files.self && `Their story of themselves:\n${p.files.self}`, p.files.now && `How they are now:\n${p.files.now}`, p.files.mind && `What they keep in mind:\n${p.files.mind}`].filter((x): x is string => typeof x === "string" && x !== "");
      return `### ${tag(names, p.who)}\n${parts.join("\n\n") || "(no mind written yet)"}`;
    })
    .join("\n\n");
}

// ------------------------------------------------------------------ setup

export interface SetupInput extends AuthorCtx {
  /** What the setup reads at most (Settings → Depth's `reads`): the places it lists and the archive quotes that reach the narrator; the constants where none is given. */
  reads?: { places: number; narratorQuotes: number };
  notebook: NotebookRead;
  /** The player's message, verbatim; null when he sent none (an empty Send: he asks the story to go on). */
  input: string | null;
  /** The player's own beats, as the GM wrote them (his act, his inner life, the outcomes the rules resolved), each with its ref. */
  playerBeats: readonly DraftBeat[];
  /** What the engine run resolved of his input, in words. */
  resolved: readonly string[];
  /** His out-of-character lines and other signals. */
  signals: readonly string[];
  /** The scene the last turn played, when it didn't end: its id, place, cast, current staging and its beats. */
  scene: { id: string; place: PlaceId; cast: readonly SceneCast[]; staging: readonly StagingDraft[]; beats: readonly { ref: string; beat: BeatText }[] } | null;
  /** Everyone the scene may reach (LIVE3d L3d-5): those with the player character (no `where`), and those elsewhere it may reach only from afar or bring in (`where`). The player character is listed whether or not this holds him. */
  present: readonly Present[];
  /** Where the player character is now. */
  place: PlaceId | null;
  /** A real-time line the author's watch took into a scene, with its reason; the talk that runs, if one does. */
  takeover?: string;
  talk?: { with: EntityId } | null;
  /** Settings → Depth → real-time dialogue: on the author's judgment, or offered with a chip. */
  realtime: "judged" | "chip";
  /** The minds of those the author may play, by id. */
  minds?: readonly PlayedMind[];
  /** The chat's archive through the message the turn answers: the setup may read it first, and pull excerpts of it for the narrator. */
  archive?: ArchiveSource;
  /** What became of the drafts this scene reached, just now, before it plays (§4.6): settled, dropped or re-dated, each in a line. */
  offscreen?: readonly string[];
  /** What the budget dial leaves the turn, in words (`budgetWords`, §6.5): the author spends by it, from each character's effort on. */
  budget?: string;
  /** The on-screen allowance this story interval (W17): once spent, no one plays as their own agent; a cast that gives someone one is said back, then slid to the author's own playing. */
  onScreen?: OnScreenAllowance | null;
}

export interface SetupResult extends StageCost {
  continues: boolean;
  place: PlaceId | null;
  ends: boolean;
  staging: StagingDraft[];
  cast: SceneCast[];
  exposure: ExposureFor[];
  beats: DraftBeat[];
  next: EntityId[];
  end: string | null;
  realtime: { with: EntityId; why: string } | { end: string } | null;
  excerpts: string[];
  /** Each passage of the archive the author pulled for the narrator, exactly as written. */
  quotes: ArchivePassage[];
  /** Each archive read the setup made, said for the thinking block. */
  reads: string[];
  note: string;
  /** What of the answer the turn goes on with couldn't be taken, and why: the thinking block says each, and the author's first step hears it. */
  refused: string[];
  /** What its first answer couldn't keep (an act for someone not the author's, LIVE3 L3a-3; a place the world lacks, L3a-8; real time with someone it didn't cast as their own agent, L3b-3; someone its staging gave neither a place nor "remote"), said back to it, why the scene was set again; empty when it wasn't. */
  redone: string[];
  /** Whom the setup brought into the world (`newcomersOf`): the turn makes each a person before it casts the scene. */
  newcomers: NewcomerDraft[];
}

/** Someone the world doesn't have yet whom an answer brings in (a walk-in the player met): the id the turn gives them, their name as the story has it, who they are as anyone could tell, and whether the author gives them a mind of their own. */
export interface NewcomerDraft {
  id: EntityId;
  name: string;
  who: string;
  mind: boolean;
}

/**
 * The newcomers an answer brings in (seen live: a walk-in the player greeted by name had no person to
 * cast, stage or form a mind for), each under an id of its own (its ref where that is free, else one
 * made from its name), and `names` knowing them by that id, their ref or their name. One the world has
 * already is no newcomer: its ref names that person. One with no name is refused, said.
 */
function newcomersOf(raw: unknown, names: Names, state: Readonly<WorldState>, refused: string[]): { newcomers: NewcomerDraft[]; names: Names } {
  const newcomers: NewcomerDraft[] = [];
  const known = new Map<string, EntityId>();
  for (const r of list(raw)) {
    const c = record(r);
    if (!c) continue;
    const name = text(c.name);
    const ref = bareId(text(c.ref));
    if (name === "") {
      refused.push(`a newcomer needs a name (${ref || "no ref"}); they weren't brought in`);
      continue;
    }
    const there = names.person(name) ?? (ref !== "" ? names.person(ref) : null) ?? known.get(nameKey(name)) ?? null;
    if (there) {
      if (ref !== "") known.set(ref, there);
      continue;
    }
    const base = (ref !== "" ? ref : name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "newcomer";
    let id = base;
    for (let i = 2; hasOwn(state.entities, id) || newcomers.some((n) => n.id === id); i++) id = `${base}_${i}`;
    newcomers.push({ id, name, who: text(c.who), mind: c.mind === true });
    for (const k of [id, ref, nameKey(name)]) if (k !== "") known.set(k, id);
  }
  if (known.size === 0) return { newcomers, names };
  const fresh = (raw: unknown): EntityId | null => {
    const id = typeof raw === "string" ? raw.trim().replace(/^\[([^[\]]+)\]$/, "$1") : "";
    return id === "" ? null : (known.get(id) ?? known.get(nameKey(id)) ?? null);
  };
  return {
    newcomers,
    names: {
      person: (raw) => names.person(raw) ?? fresh(raw),
      place: (raw) => names.place(raw),
      ref: (raw) => {
        const p = fresh(raw);
        return names.person(raw) === null && p !== null ? { entity: p } : names.ref(raw);
      },
      name: (id) => newcomers.find((n) => n.id === id)?.name ?? names.name(id),
    },
  };
}

/** The cast an answer gives: everyone present but the player character, each at an effort; "agent" for someone with no mind yet forms theirs (the turn's `formMinds`). */
function castOf(raw: unknown, names: Names, ctx: AuthorCtx, refused: string[]): SceneCast[] {
  const out: SceneCast[] = [];
  for (const r of list(raw)) {
    const c = record(r);
    if (!c) continue;
    const who = names.person(c.who);
    if (!who) {
      refused.push(`the cast named someone the chat doesn't have (${text(c.who) || "no one"}): someone new comes into the world through "newcomers" first`);
      continue;
    }
    if (who === ctx.pov) continue;
    if (out.some((o) => o.who === who)) continue;
    const effort = (SCENE_EFFORTS as readonly string[]).includes(text(c.effort)) ? (text(c.effort) as DepthEffort) : "world";
    out.push({ who, effort, why: text(c.why) });
  }
  return out;
}

/** The author sets the scene for the player's turn (§5.2, Author, scene setup). */
export async function authorSetup(input: SetupInput): Promise<SetupResult> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const tools = input.archive ? archiveTools({ texts: input.texts, world, state, source: input.archive }) : [];
  // Everyone the scene may reach, each by their id (LIVE3d L3d-5): the player character always, wherever he is.
  const others = input.present.filter((p) => p.who !== input.pov);
  const here = others.filter((p) => p.where === undefined);
  const elsewhere = others.filter((p) => p.where !== undefined);
  const presentLine = (p: Present): string => `- ${tag(names, p.who)}${p.mind ? ", has a mind" : ", no mind yet"}${p.where ? `, at ${p.where}` : ""}`;
  const data = [
    notebookText(input.notebook),
    input.scene
      ? [
          `The scene that is playing (${input.scene.id}), at ${own(world.places, input.scene.place)?.name ?? input.scene.place}. Its cast last turn: ${input.scene.cast.map((c) => `${tag(names, c.who)} as ${c.effort}`).join("; ") || "no one"}.`,
          `Its staging:\n${input.scene.staging.map((s) => stagingText(names, s)).join("\n") || "- (none)"}`,
          `Its beats so far:\n${input.scene.beats.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
        ].join("\n\n")
      : "No scene is playing: this turn opens one.",
    `${tag(names, input.pov)} is ${input.place ? `at ${own(world.places, input.place)?.name ?? input.place} [${input.place}]` : "nowhere the world places"}. It is ${formatClock(calendarOf(world), state.clock)}.`,
    placesText(world, input.place, input.reads?.places),
    `The people the scene may reach, each by their id:\n- ${tag(names, input.pov)} (the player character)${input.place ? `, at ${own(world.places, input.place)?.name ?? input.place}` : ", nowhere the world places"}`,
    `With him:\n${here.map(presentLine).join("\n") || "- no one"}`,
    ...(elsewhere.length > 0 ? [`Elsewhere, whom the scene reaches only from afar (the far end of a phone call, a radio, a screen) unless it brings them there:\n${elsewhere.map(presentLine).join("\n")}`] : []),
    ...(input.offscreen && input.offscreen.length > 0 ? [`Off screen, just now, before this scene (what you settled is canon now):\n${input.offscreen.map((l) => `- ${l}`).join("\n")}`] : []),
    ...(input.minds && input.minds.length > 0 ? [`The minds of those present who have one (read them if you play someone):\n\n${playedText(names, input.minds)}`] : []),
    input.input === null ? "The player sent no new message: he asks the story to go on from here." : `The player's message, verbatim:\n${input.input}`,
    `His beats, as the GM wrote them:\n${input.playerBeats.map((b) => draftText(names, b)).join("\n") || "- (none: he wrote nothing that happens)"}`,
    ...(input.resolved.length > 0 ? [`What the rules resolved:\n${input.resolved.map((r) => `- ${r}`).join("\n")}`] : []),
    ...(input.signals.length > 0 ? [`His signals beyond the story (out-of-character lines and the like):\n${input.signals.map((s) => `- ${s}`).join("\n")}`] : []),
    ...(input.talk ? [`Real-time dialogue with ${tag(names, input.talk.with)} is running.`] : []),
    ...(input.takeover ? [`Your watch took his line out of real-time dialogue: ${input.takeover}`] : []),
    input.realtime === "chip" ? "Real-time dialogue starts only from the player's chip: if you judge the moment a conversation, entering it offers it to him." : "Real-time dialogue starts on your judgment.",
    ...(input.budget ? [input.budget] : []),
    tools.length > 0
      ? `The chat's archive, its own prose as it was written, is yours to read before you answer: answer {"archive": [{"tool": a tool's name, then its arguments}]} alone, and what each read found comes back; up to ${ARCHIVE_ROUNDS} rounds of reading (${READS_PER_ROUND} reads each), then you answer the scene. Its tools:\n${toolsText(tools)}\nTo hand the narrator words from it for a callback, name them in "quotes" (at most ${QUOTES_MOST}): he gets each exactly as it was written.`
      : "The chat's archive can't be read this turn: give no quotes.",
  ].join("\n\n");
  const talk = talkOf(input, SCENE_TEXT.setup, data);
  const asked = await askReading(input, talk, tools);
  const playerRefs = new Set(input.playerBeats.map((b) => b.ref));
  // An answer as the turn would go on with it: each part checked, what can't be kept refused with why.
  const read = (a: Record<string, unknown>, slide = false) => {
    const refused: string[] = [];
    const taken: NotTheirs[] = [];
    // Whom it brings into the world first, so its cast, staging and beats may name them.
    const fresh = newcomersOf(a.newcomers, namesOf(world, state), state, refused);
    const names = fresh.names;
    const sc = record(a.scene);
    const castAsked = castOf(a.cast, names, input, refused);
    // The on-screen allowance spent (W17): no one plays as their own agent this turn. A first answer that casts someone so is said back and the scene set again; one that still does, each slides to the author's own playing (the cheaper rung).
    const screen = input.onScreen;
    const spent = screen !== null && screen !== undefined && onScreenOut(screen);
    const overScreen = spent ? castAsked.filter((c) => c.effort === "agent").map((c) => c.who) : [];
    if (spent && overScreen.length > 0) refused.push(`the on-screen allowance is spent (${screen.spent} of ${screen.limit} turns this story ${screen.interval}), so no one plays as their own agent this turn: ${overScreen.map((w) => tag(names, w)).join(", ")} ${slide ? "you play yourself" : `can't be cast "agent"`}`);
    const cast = slide && overScreen.length > 0 ? castAsked.map((c): SceneCast => (c.effort === "agent" ? { ...c, effort: "author" } : c)) : castAsked;
    const agents = new Set(cast.filter((c) => c.effort === "agent").map((c) => c.who));
    const rt = record(a.realtime);
    let realtime: SetupResult["realtime"] = null;
    // Real time with someone not cast as their own agent: said back, and the scene set again (LIVE3 L3b-3).
    let unplayed = false;
    if (rt && str(rt.end)) realtime = { end: rt.end.trim() };
    else if (rt) {
      const withWho = names.person(rt.with);
      if (withWho && withWho !== input.pov) {
        if (agents.has(withWho)) realtime = { with: withWho, why: text(rt.why) };
        else {
          // Real time goes to the character's own agent: one the author plays itself, or handles as world, can't take it.
          const effort = cast.find((c) => c.who === withWho)?.effort;
          unplayed = true;
          refused.push(`real-time dialogue with ${tag(names, withWho)} needs them playing as their own agent ("effort": "agent")${effort === "author" ? ", and you cast them as yours to play" : effort === "world" ? ", and you cast them as part of the world" : ", and you didn't cast them"}; it wasn't entered`);
        }
      } else if (rt.with !== undefined) refused.push(`real-time dialogue needs someone with an agent of their own to talk with (${text(rt.with) || "no one"})`);
    }
    // A place the world doesn't have is never dropped silently (LIVE3 L3a-8): said back, and where the scene plays without it.
    const said = text(sc?.place);
    const place = names.place(sc?.place);
    const strayed = said !== "" && place === null;
    if (strayed) refused.push(`the scene's place "${said}" isn't one of the world's places, so it plays ${input.place ? `where ${tag(names, input.pov)} is, at ${own(world.places, input.place)?.name ?? input.place} [${input.place}]` : "where the scene stands"}`);
    // Whom its staging gives neither a place nor "remote": said back, and the scene set again.
    const placing: Unplaced = { pov: input.pov, who: [] };
    return {
      a,
      refused,
      taken,
      strayed,
      unplayed,
      overScreen: !slide && overScreen.length > 0,
      placing,
      agents,
      continues: sc?.continues === true && input.scene !== null,
      place: place ?? input.place,
      ends: sc?.ends === true,
      staging: stagingsOf(a.staging, names, refused, placing),
      cast,
      exposure: exposureForOf(a.exposure, names, playerRefs, refused),
      beats: draftBeats(a.beats, names, input, { agents, onScreen: true }, refused, "w", taken),
      next: nextOf(a.next, names, agents, refused, input.pov),
      end: str(a.end) ? a.end.trim() : null,
      realtime,
      newcomers: fresh.newcomers,
    };
  };
  let got = read(asked.answer);
  let redone: string[] = [];
  if (got.taken.length > 0 || got.strayed || got.unplayed || got.placing.who.length > 0 || got.overScreen) {
    const again = await askAgain(input, talk, names, got.refused, "the scene's setup", { theirs: got.taken.length > 0, place: got.strayed, realtime: got.unplayed, staged: got.placing.who.length > 0, screen: got.overScreen });
    if (again) {
      redone = got.refused;
      got = read(again, true);
    } else {
      if (got.overScreen) got = read(asked.answer, true);
      got.refused.push("its answer, once told why, couldn't be read, so the first stands without what couldn't be kept");
    }
  }
  const { a, refused } = got;
  const { next, end } = theirsNow(got.taken, got.agents, names, got, refused);
  const account = answerWhy(a);
  return {
    continues: got.continues,
    place: got.place,
    ends: got.ends,
    staging: got.staging,
    cast: got.cast,
    exposure: got.exposure,
    beats: got.beats,
    next,
    end,
    realtime: got.realtime,
    excerpts: list(a.excerpts).filter(str).map((e) => e.trim()),
    quotes: await quotesOf(a.quotes, input.archive, world, refused, input.reads?.narratorQuotes),
    reads: asked.reads,
    note: text(a.note),
    refused,
    redone,
    newcomers: got.newcomers,
    ...(talk.reasoning.length > 0 ? { reasoning: talk.reasoning.join("\n\n") } : account !== "" ? { reasoning: account } : {}),
    ...(talk.usage ? { usage: talk.usage } : {}),
  };
}

// ------------------------------------------------------------------ the steps between beats

export interface StepInput extends AuthorCtx {
  notebook: NotebookRead;
  scene: { id: string; place: PlaceId; cast: readonly SceneCast[]; staging: readonly StagingDraft[]; beats: readonly { ref: string; beat: BeatText }[] };
  /** The beats just decided (a character's act, an outcome the GM resolved), waiting for their exposure. */
  decided: readonly DraftBeat[];
  /** The minds of those the author plays this scene. */
  played: readonly PlayedMind[];
  /** What the last answer couldn't keep, said back. */
  refusedBefore?: readonly string[];
  /** Steps left before the turn ends whatever happens (a bound, said so the author can pace the scene). */
  left: number;
  /** What the budget dial leaves the turn, in words (`budgetWords`, §6.5). */
  budget?: string;
  /** Those the budget slid from their own agents to the author this turn (§6.5): it plays them now, and `next` may name them for its next step. */
  slid?: readonly EntityId[];
  /** Of those, the ones due to act now (named next before the slide, or by its last step): their acts are this step's to write. */
  handed?: readonly EntityId[];
  /** Nothing beyond the player's own beats has reached the player character this turn, which would end there (LIVE3c L3c-5): this is the one more step the author is given for what does. */
  unreached?: true;
  /** The chat's archive through the message the turn answers, read before the step answers (JSON rounds, `askReading`). */
  archive?: ArchiveSource;
  /** A ceiling binds (§6.5): what the turn has left, in words; the step is asked who slides down the ladder and how far (`slide`), or to end the scene at the next beat. */
  ceiling?: string;
}

export interface StepResult extends StageCost {
  exposure: ExposureFor[];
  staging: StagingDraft[];
  beats: DraftBeat[];
  next: EntityId[];
  end: string | null;
  sceneEnds: boolean;
  /** What of the answer the turn goes on with couldn't be taken, and why: the thinking block says each, and the author's next step hears it. */
  refused: string[];
  /** What its first answer couldn't keep (an act for someone not the author's, LIVE3 L3a-3; someone its staging gave neither a place nor "remote"), said back to it, why the step was taken again; empty when it wasn't. */
  redone: string[];
  /** Each archive read the step made, said for the thinking block. */
  reads?: string[];
  /** Under a binding ceiling (`ceiling`), those the author slid from their own agents, and how far: played by it, or handled as world. */
  slide: { who: EntityId; to: "author" | "world" }[];
  /** Whom the step brought into the world (`newcomersOf`): someone arriving mid-scene. */
  newcomers: NewcomerDraft[];
}

/** One of the author's steps between beats (§5.2, Author, between beats). */
export async function authorStep(input: StepInput): Promise<StepResult> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const agents = new Set(input.scene.cast.filter((c) => c.effort === "agent").map((c) => c.who));
  const slid = input.slid ?? [];
  const handed = input.handed ?? [];
  const offer = archiveOffer(input, input.archive, "this step");
  const data = [
    notebookText(input.notebook),
    `The scene (${input.scene.id}) at ${own(world.places, input.scene.place)?.name ?? input.scene.place}. It is ${formatClock(calendarOf(world), state.clock)}.`,
    `Its cast: ${input.scene.cast.map((c) => `${tag(names, c.who)} ${c.effort === "agent" ? "plays as their own agent" : c.effort === "author" ? "is played by you" : "is part of the world"}`).join("; ") || "no one"}. ${tag(names, input.pov)} is the player's.`,
    `Its staging:\n${input.scene.staging.map((s) => stagingText(names, s)).join("\n") || "- (none)"}`,
    `The scene so far:\n${input.scene.beats.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (nothing yet)"}`,
    ...(input.played.length > 0 ? [`The minds of those you play:\n\n${playedText(names, input.played)}`] : []),
    `Just decided, waiting for who perceived it:\n${input.decided.map((d) => draftText(names, d)).join("\n") || (handed.length > 0 ? "- (nothing yet: those due now are yours to play)" : input.unreached ? "- (nothing: no one was due to act)" : "- (nothing: the characters playing as their own agents passed)")}`,
    ...(input.refusedBefore && input.refusedBefore.length > 0 ? [`What your last answer couldn't keep:\n${input.refusedBefore.map((r) => `- ${r}`).join("\n")}`] : []),
    ...(input.unreached
      ? [`Nothing this turn has reached ${tag(names, input.pov)} beyond the player's own beats: no beat anyone else decided reached him, so the reply would have nothing to tell him. The turn would end here, so you are given this one more step: write what reaches him now (what someone you play or handle does or says, or what the world does, with him in its exposure as far as he perceives it), or give his exposure to what was just decided where he perceives it. If nothing would reach him, end the turn as it is.`]
      : []),
    ...(handed.length > 0 ? [`Due to act now, whom you play: ${handed.map((id) => tag(names, id)).join(", ")}. Write what they do and say now among your beats, from their minds.`] : []),
    ...(slid.length > 0 ? [`You slid ${slid.map((id) => tag(names, id)).join(", ")} to yourself this turn under the budget: you play them from their minds. Name any of them in "next" to write their next acts in your next step, as far as the scene should go.`] : []),
    ...(input.budget ? [input.budget] : []),
    ...(input.ceiling ? [`${input.ceiling} Who slides down the ladder, and how far, is yours to say: add "slide": [{"who": an id of someone playing as their own agent, "to": "author" (you play them, one call for several) or "world" (handled as part of the world)}] to your answer, or end the scene at the next beat ("end"). The ceiling stays the hard stop: if anyone you name in "next" still plays as their own agent, the scene ends at the next beat.`] : []),
    input.left === 0 ? "This is your last step before this turn ends whatever happens: bring the moment to where the player answers." : input.left <= 2 ? `Only ${input.left} step${input.left === 1 ? "" : "s"} remain${input.left === 1 ? "s" : ""} after this one before this turn ends whatever happens: bring the moment to where the player answers.` : "",
    offer.line,
  ]
    .filter((p) => p !== "")
    .join("\n\n");
  const talk = talkOf(input, SCENE_TEXT.step, data);
  const decided = new Set(input.decided.map((d) => d.ref));
  // An answer as the turn would go on with it: each part checked, what can't be kept refused with why.
  const read = (a: Record<string, unknown>) => {
    const refused: string[] = [];
    const taken: NotTheirs[] = [];
    const placing: Unplaced = { pov: input.pov, who: [] };
    // Whom it brings into the world first, so its staging and beats may name them.
    const fresh = newcomersOf(a.newcomers, namesOf(world, state), state, refused);
    const names = fresh.names;
    return {
      a,
      refused,
      taken,
      placing,
      exposure: exposureForOf(a.exposure, names, decided, refused),
      staging: stagingsOf(a.staging, names, refused, placing),
      beats: draftBeats(a.beats, names, input, { agents, onScreen: true }, refused, "s", taken),
      next: nextOf(a.next, names, new Set([...agents, ...slid]), refused, input.pov),
      end: str(a.end) ? a.end.trim() : null,
      sceneEnds: a.sceneEnds === true,
      slide: input.ceiling ? slidesOf(a.slide, names, agents, refused) : [],
      newcomers: fresh.newcomers,
    };
  };
  const first = await askReading(input, talk, offer.tools, "this step");
  let got = read(first.answer);
  let redone: string[] = [];
  if (got.taken.length > 0 || got.placing.who.length > 0) {
    const again = await askAgain(input, talk, names, got.refused, "this step", { theirs: got.taken.length > 0, staged: got.placing.who.length > 0 });
    if (again) {
      redone = got.refused;
      got = read(again);
    } else got.refused.push("its answer, once told why, couldn't be read, so the first stands without what couldn't be kept");
  }
  const { next, end } = theirsNow(got.taken, agents, names, got, got.refused);
  const account = answerWhy(got.a);
  return {
    exposure: got.exposure,
    staging: got.staging,
    beats: got.beats,
    next,
    end,
    sceneEnds: got.sceneEnds,
    slide: got.slide,
    refused: got.refused,
    redone,
    newcomers: got.newcomers,
    ...(first.reads.length > 0 ? { reads: first.reads } : {}),
    ...(talk.reasoning.length > 0 ? { reasoning: talk.reasoning.join("\n\n") } : account !== "" ? { reasoning: account } : {}),
    ...(talk.usage ? { usage: talk.usage } : {}),
  };
}

/** The author's slides under a binding ceiling (§6.5): each one playing as their own agent it moves down the ladder, to itself or to the world; anyone else refused, said. */
function slidesOf(raw: unknown, names: Names, agents: ReadonlySet<EntityId>, refused: string[]): StepResult["slide"] {
  const out: StepResult["slide"] = [];
  for (const x of list(raw)) {
    const r = record(x);
    const who = r ? names.person(r.who) : null;
    const to = r?.to === "author" || r?.to === "world" ? r.to : null;
    if (who === null || to === null || !agents.has(who)) {
      refused.push(`a slide (${JSON.stringify(x)}) names no one playing as their own agent, or no rung ("author" or "world"): it wasn't kept`);
      continue;
    }
    if (!out.some((s) => s.who === who)) out.push({ who, to });
  }
  return out;
}

// ------------------------------------------------------------------ the narrator's question

export interface AskInput extends AuthorCtx {
  notebook: NotebookRead;
  scene: StepInput["scene"];
  /** The moment the narrator is rendering, by its beats' refs. */
  moment: readonly string[];
  questions: readonly string[];
}

export interface AskResult extends StageCost {
  beats: DraftBeat[];
  refused: string[];
}

/** The narrator asks for a detail canon lacks; the author decides it as beats of that moment, or none (§1.3). */
export async function authorAsk(input: AskInput): Promise<AskResult> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const agents = new Set(input.scene.cast.filter((c) => c.effort === "agent").map((c) => c.who));
  const data = [
    notebookText(input.notebook),
    `The scene (${input.scene.id}) at ${own(world.places, input.scene.place)?.name ?? input.scene.place}.`,
    `Its staging:\n${input.scene.staging.map((s) => stagingText(names, s)).join("\n") || "- (none)"}`,
    `The scene so far:\n${input.scene.beats.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (nothing yet)"}`,
    `The narrator is rendering the moment of ${input.moment.map((r) => `(${r})`).join(", ")}, and asks:\n${input.questions.map((q) => `- ${q}`).join("\n")}`,
  ].join("\n\n");
  const asked = await ask(input, SCENE_TEXT.ask, data);
  const refused: string[] = [];
  const account = answerWhy(asked.answer);
  return {
    beats: draftBeats(asked.answer.beats, names, input, { agents, onScreen: true }, refused, "a"),
    refused,
    ...(asked.reasoning ? { reasoning: asked.reasoning } : account !== "" ? { reasoning: account } : {}),
    ...(asked.usage ? { usage: asked.usage } : {}),
  };
}

// ------------------------------------------------------------------ the poll

/** What a character has waiting, as the poll reads it. */
export interface PendingLine {
  who: EntityId;
  /** Points of view it received and hasn't lived. */
  pending: number;
  /** The newest of them, in words. */
  latest?: string;
  /** It played this turn as its own agent (it remembers the scene anyway). */
  played: boolean;
  /** Its files a retcon put out of mind (written from a beat since amended or struck, with no verdict since), by path under its folder: a reflection rewrites them. */
  gone?: string[];
  /** The takes its working memory holds unremembered, given only when they near the count that calls its remembering: a mind near it asks for a reflection. */
  takes?: number;
  /** Its own ask, from its play, to take stock, in its words: a reflection answers it. */
  asks?: string;
  /** No mind yet: the story reached them (from afar, say), and a catch-up would form their mind first, from their card or what the world knows of them. */
  unminded?: true;
}

export interface PollInput extends AuthorCtx {
  notebook: NotebookRead;
  /** The chat's archive through the reply it follows, read before the poll answers (JSON rounds, `askReading`). */
  archive?: ArchiveSource;
  /** The beats since it last looked (§6.4: the turn's, and any a poll put off or a conversation deferred left unread), as the author reads them. */
  beats: readonly { ref: string; beat: BeatText }[];
  /** What characters wrote this turn that will stay with them, in their words. */
  kept: readonly { who: EntityId; text: string }[];
  /** Story minutes that passed since it last looked. */
  minutes: number;
  /** How story time passed outside the scene meanwhile, in words: each timelapse the player ran, a clock he moved on. */
  spans?: readonly string[];
  /** Plans falling due, in words. */
  due: readonly string[];
  pending: readonly PendingLine[];
  /** The author's open predictions, by id. */
  predictions: readonly { id: string; text: string }[];
  /** The player's signals: how this turn came (a swipe, a Regenerate, a Re-narrate), his out-of-character lines, his edits. */
  signals: readonly string[];
  /** The scene ended with this turn; a chapter-sized stretch has passed since the author last re-read (in turns). */
  sceneEnded: boolean;
  sinceChapter: number;
  /** Settings → Depth → cadence: the lightest revision the author may make (it judges whether to revise). */
  cadence: "turns" | "scenes" | "chapters";
  /** Off screen (§4.6): the open drafts, those a swipe took off the chain, and what the budget dial leaves; absent: nothing off screen is offered. */
  offscreen?: OffscreenFacts;
  /** The answers to the interviews it asked since it last looked (§4.4, Interview), each in the character's voice. */
  answers?: readonly { who: EntityId; question: string; answer: string }[];
}

/** An open draft as the poll reads it (§4.6): facts, never a verdict. */
export interface DraftLine {
  id: string;
  /** When it happens, in words. */
  when: string;
  summary: string;
  /** Each part's treatment, in words. */
  treatments: string;
  /** Whom and what it holds, and from when, in words. */
  holds: string;
  /** Live beats on the chain from its story time on: the pins its settlement reads. */
  since: number;
  /** What it read that has changed since it was drafted (someone's mind, the notebook), in words. */
  changed: string[];
}

/** What the poll reads of the world beyond view. */
export interface OffscreenFacts {
  drafts: readonly DraftLine[];
  /** Drafts whose basis a swipe of a later reply took off the chain: rebase candidates. */
  rebase: readonly DraftLine[];
  /** What the budget dial leaves of this interval's allowances, per treatment, in words. */
  allowances: readonly string[];
  /** The player's own words on what deserves more than written. */
  threshold: string;
  /** Episodes held for the player's answer past an allowance (§6.5 "ask me"), in words: the poll opens none of them again. */
  asked?: readonly string[];
  /** Settings → Depth → Budget → Ask me is on: a part marked major is asked about rather than slid down once its allowance is spent. */
  ask?: boolean;
}

/** An episode the poll opens (§4.6), as its answer gives it: when, where, who, why, and each part's treatment with the author's grade. */
export interface EpisodeAsk {
  why: string;
  /** Story minutes from now until it starts (negative when it already began). */
  in: number;
  minutes: number;
  places: PlaceId[];
  people: EntityId[];
  /** `major`: the author judged the moment major, so past its treatment's allowance the player is asked (§6.5) rather than it sliding down the ladder. */
  parts: { subject: { who: EntityId } | { event: string }; treatment: DepthTreatment; rationale: string; major?: true }[];
}

export interface PollResult extends StageCost {
  catchup: { who: EntityId; why: string }[];
  reflect: { who: EntityId; why: string }[];
  /** Each archive read the poll made, said for the thinking block. */
  reads?: string[];
  /** The characters it interviews (§4.4): its question to each, asked of their mind, answered in voice; what they say comes back at its next look. */
  interview: { who: EntityId; question: string; why: string }[];
  author: { depth: "scene" | "chapter"; why: string } | null;
  scores: { prediction: string; outcome: ScoreOutcome; note: string }[];
  /** Off screen: the episodes it opens, and the drafts it settles, drops or rebases, by id. */
  episodes: EpisodeAsk[];
  settle: { draft: string; why: string }[];
  drop: { draft: string; why: string }[];
  rebase: { draft: string; why: string }[];
  considered: PollConsidered[];
  refused: string[];
  /** The story minutes from now after which it asks to be woken, and why; null when it asks nothing. */
  wake: { minutes: number; why: string } | null;
}

function draftLines(lines: readonly DraftLine[]): string {
  return lines.map((d) => `- [${d.id}] ${d.when}: ${d.summary} (${d.treatments}). It holds ${d.holds}. ${d.since} beat${d.since === 1 ? "" : "s"} since its time.${d.changed.length > 0 ? ` Changed since it was drafted: ${d.changed.join("; ")}.` : ""}`).join("\n");
}

/** The episodes an answer opens: each with a reason, a place and someone in it; the player character is never in one (he is on screen); a part's treatment from the registry. */
function episodesOf(raw: unknown, names: Names, pov: EntityId, refused: string[]): EpisodeAsk[] {
  const out: EpisodeAsk[] = [];
  list(raw).forEach((r, i) => {
    const e = record(r);
    if (!e) return;
    const what = `episode ${i + 1}`;
    const people = [...new Set(list(e.people).map((p) => names.person(p)).filter((p): p is EntityId => p !== null))];
    if (people.includes(pov)) refused.push(`${what}: ${tag(names, pov)} is on screen, the player's own; an episode off screen goes on without him`);
    const cast = people.filter((p) => p !== pov);
    const places = [...new Set(list(e.places).map((p) => names.place(p)).filter((p): p is PlaceId => p !== null))];
    const parts: EpisodeAsk["parts"] = [];
    for (const raw of list(e.parts)) {
      const p = record(raw);
      if (!p) continue;
      const treatment = text(p.treatment);
      if (!(DEPTH_TREATMENTS as readonly string[]).includes(treatment)) {
        refused.push(`${what}: a part's treatment is one of ${DEPTH_TREATMENTS.join(", ")} (not "${treatment}")`);
        continue;
      }
      const who = p.who !== undefined ? names.person(p.who) : null;
      const event = text(p.event);
      if (who !== null && !cast.includes(who)) {
        refused.push(`${what}: ${tag(names, who)} has a part but isn't among its people`);
        continue;
      }
      if (who === null && event === "") continue;
      parts.push({ subject: who !== null ? { who } : { event }, treatment: treatment as DepthTreatment, rationale: text(p.rationale), ...(p.major === true ? { major: true as const } : {}) });
    }
    const minutes = typeof e.minutes === "number" && Number.isFinite(e.minutes) && e.minutes > 0 ? Math.round(e.minutes) : 60;
    const at = typeof e.in === "number" && Number.isFinite(e.in) ? Math.round(e.in) : 0;
    if (cast.length === 0 || parts.length === 0) {
      refused.push(`${what}: an episode needs someone in it and a part with its treatment; it wasn't opened`);
      return;
    }
    out.push({ why: text(e.why), in: at, minutes, places, people: cast, parts });
  });
  return out;
}

/** The drafts an answer settles, drops or rebases: by an id the poll was given, each once. */
function verdictsOf(raw: unknown, known: ReadonlySet<string>, refused: string[], what: string): { draft: string; why: string }[] {
  const out: { draft: string; why: string }[] = [];
  for (const r of list(raw)) {
    const v = record(r);
    const id = v ? text(v.draft).replace(/^\[([^[\]]+)\]$/, "$1") : "";
    if (!v || id === "") continue;
    if (!known.has(id)) {
      refused.push(`${what}: there is no such draft here (${id})`);
      continue;
    }
    if (!out.some((o) => o.draft === id)) out.push({ draft: id, why: text(v.why) });
  }
  return out;
}

/** The interviews an answer asks: one question to each character with an agent, never the player character. */
function interviewsOf(raw: unknown, names: Names, pov: EntityId, refused: string[]): PollResult["interview"] {
  const out: PollResult["interview"] = [];
  for (const r of list(raw)) {
    const c = record(r);
    const id = c ? names.person(c.who) : null;
    const question = c ? text(c.question) : "";
    if (!c || !id || question === "") continue;
    if (id === pov) {
      refused.push(`${tag(names, id)} is the player character, who has no agent to interview`);
      continue;
    }
    if (!out.some((o) => o.who === id)) out.push({ who: id, question, why: text(c.why) });
  }
  return out;
}

/** The author's poll after a turn (§6.4): the only thing that decides who catches up now, and what happens off screen (§4.6). */
export async function authorPoll(input: PollInput): Promise<PollResult> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const data = [
    notebookText(input.notebook),
    `It is ${formatClock(calendarOf(world), state.clock)}; since you last looked, ${input.minutes} story minute${input.minutes === 1 ? "" : "s"} passed${(input.spans ?? []).length > 0 ? `, by ${(input.spans ?? []).join("; ")}` : ""}.`,
    `The beats since you last looked:\n${input.beats.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
    `What characters wrote that will stay with them:\n${input.kept.map((k) => `- ${tag(names, k.who)}: ${k.text}`).join("\n") || "- (nothing yet)"}`,
    `Plans falling due:\n${input.due.map((d) => `- ${d}`).join("\n") || "- (none)"}`,
    `What waits to be lived:\n${input.pending.map((p) => `- ${tag(names, p.who)}: ${p.pending} point${p.pending === 1 ? "" : "s"} of view waiting${p.latest ? `, the newest ${p.latest}` : ""}${p.played ? " (played this turn as their own agent)" : ""}${p.unminded ? " (no mind yet: a catch-up forms one, from their card or what the world knows of them, then lives these)" : ""}${p.gone && p.gone.length > 0 ? `; out of mind since a correction struck what they were written from: ${p.gone.join(", ")} (a reflection rewrites them)` : ""}${p.takes !== undefined ? `; their working memory is nearly full (${p.takes} takes unremembered): they ask to reflect` : ""}${p.asks !== undefined ? `; they ask to reflect, in their words: ${p.asks}` : ""}`).join("\n") || "- (no one)"}`,
    `What the characters you interviewed answered:\n${(input.answers ?? []).map((x) => `- ${tag(names, x.who)}, asked "${x.question}": ${x.answer}`).join("\n") || "- (no interview since you last looked)"}`,
    `Your open predictions:\n${input.predictions.map((p) => `- [${p.id}] ${p.text}`).join("\n") || "- (none)"}`,
    `The player's signals:\n${input.signals.map((s) => `- ${s}`).join("\n") || "- (none)"}`,
    `${input.sceneEnded ? "The scene ended with this turn." : "The scene goes on."} ${input.sinceChapter} turn${input.sinceChapter === 1 ? "" : "s"} since you last re-read a chapter. Your cadence: ${input.cadence === "turns" ? "you may revise lightly after any turn" : input.cadence === "scenes" ? "you reflect at a scene's end at the soonest" : "you reflect only at a chapter's end"}.`,
    ...(input.offscreen
      ? [
          `Your open drafts (off screen, not canon yet):\n${draftLines(input.offscreen.drafts) || "- (none)"}`,
          `Drafts a swipe took off the chain:\n${draftLines(input.offscreen.rebase) || "- (none)"}`,
          `What this interval's allowances leave: ${input.offscreen.allowances.join("; ") || "no limits"}. The player's threshold for what deserves more than written: ${input.offscreen.threshold.trim() || "(none given)"}. ${input.offscreen.ask ? "Where you judge a moment major, mark its part major: once its treatment's allowance is spent, the player is asked whether to spend one more rather than it sliding down." : "The player asked not to be asked: a part past its treatment's allowance slides down the ladder."}`,
          `Episodes waiting on the player's answer past an allowance (don't open them again):\n${(input.offscreen.asked ?? []).map((a) => `- ${a}`).join("\n") || "- (none)"}`,
        ]
      : []),
  ].join("\n\n");
  const asked = await askArchive(input, SCENE_TEXT.poll, data, input.archive, "the poll");
  const a = asked.answer;
  const refused: string[] = [];
  const who = (key: "catchup" | "reflect"): { who: EntityId; why: string }[] => {
    const out: { who: EntityId; why: string }[] = [];
    for (const r of list(a[key])) {
      const c = record(r);
      const id = c ? names.person(c.who) : null;
      if (!c || !id) continue;
      if (id === input.pov) {
        refused.push(`${tag(names, id)} is the player character, who has no agent to ${key === "catchup" ? "catch up" : "reflect"}`);
        continue;
      }
      if (!out.some((o) => o.who === id)) out.push({ who: id, why: text(c.why) });
    }
    return out;
  };
  const au = record(a.author);
  const depth = au && (au.depth === "scene" || au.depth === "chapter") ? au.depth : null;
  const wk = record(a.wake);
  const wake = wk && typeof wk.minutes === "number" && Number.isFinite(wk.minutes) && wk.minutes > 0 ? { minutes: Math.round(wk.minutes), why: text(wk.why) } : null;
  const known = new Set(input.predictions.map((p) => p.id));
  const scores: PollResult["scores"] = [];
  for (const r of list(a.scores)) {
    const s = record(r);
    const id = s ? text(s.prediction) : "";
    if (!s || !known.has(id)) continue;
    if (!(SCORE_OUTCOMES as readonly string[]).includes(text(s.outcome))) continue;
    if (!scores.some((x) => x.prediction === id)) scores.push({ prediction: id, outcome: text(s.outcome) as ScoreOutcome, note: text(s.note) });
  }
  const considered: PollConsidered[] = [];
  for (const r of list(a.considered)) {
    const c = record(r);
    if (c && str(c.what)) considered.push({ what: c.what.trim(), raised: c.raised === true, why: text(c.why) });
  }
  const drafts = new Set((input.offscreen?.drafts ?? []).map((d) => d.id));
  const swiped = new Set((input.offscreen?.rebase ?? []).map((d) => d.id));
  const account = answerWhy(a);
  return {
    catchup: who("catchup"),
    reflect: who("reflect"),
    interview: interviewsOf(a.interview, names, input.pov, refused),
    author: depth ? { depth, why: text(au?.why) } : null,
    scores,
    episodes: input.offscreen ? episodesOf(a.episodes, names, input.pov, refused) : [],
    settle: verdictsOf(a.settle, drafts, refused, "settle"),
    drop: verdictsOf(a.drop, new Set([...drafts, ...swiped]), refused, "drop"),
    rebase: verdictsOf(a.rebase, swiped, refused, "rebase"),
    considered,
    refused,
    wake,
    ...(asked.reasoning ? { reasoning: asked.reasoning } : account !== "" ? { reasoning: account } : {}),
    ...(asked.usage ? { usage: asked.usage } : {}),
    ...(asked.reads.length > 0 ? { reads: asked.reads } : {}),
  };
}

// ------------------------------------------------------------------ reflection

export interface ReflectInput extends AuthorCtx {
  notebook: NotebookRead;
  /** The chat's archive through the reply it follows, read before the reflection answers (JSON rounds, `askReading`). */
  archive?: ArchiveSource;
  depth: "scene" | "chapter";
  /** The stretch it reflects on (the scene, or the chapter), its beats in order. */
  beats: readonly { ref: string; beat: BeatText }[];
  /** Who each character has become, from their own mind: their story of themselves and what they keep in mind. */
  becoming: readonly { who: EntityId; self?: string; mind?: string }[];
  /** The chapter a re-read would close: its place among chapters (from 0). */
  chapter: number;
  /** The latest message the reflection read. */
  through: string | null;
  /** The player's signals the reflection weighs for player.md: how his turns came (a swipe, a Regenerate, a Re-narrate), his out-of-character lines, his edits. */
  signals: readonly string[];
  /** A stretch longer than a page is read a page at a time, oldest first: this one's place (1-based). Only the last page may close the chapter. */
  page?: { index: number; of: number };
}

export interface ReflectResult extends StageCost {
  /** The notebook revision (its writes, then `engine.notebook`); none when nothing moved. */
  events: PackEvent[];
  /** Each archive read the reflection made, said for the thinking block. */
  reads?: string[];
  blobs: Blobs;
  drift: { who: EntityId; drift: DriftLevel; note: string }[];
  predictions: { text: string; about: EntityId[] }[];
  chapter: { ends: boolean; title: string | null };
  refused: string[];
}

/** The author's notebook revision from an answer's files and comments: pinned files and paths outside the notebook refused. */
export function notebookRevision(answer: Record<string, unknown>, notebook: NotebookRead, kind: NotebookKind, through: string | null, chapter: { index: number; title: string } | null, reason: string | undefined): { events: PackEvent[]; blobs: Blobs; refused: string[] } {
  const blobs: Blobs = {};
  const refused: string[] = [];
  const pinned = new Set(notebook.pinned.map((p) => p.path));
  const files: Record<string, string> = {};
  const events: PackEvent[] = [];
  for (const raw of list(answer.files)) {
    const f = record(raw);
    if (!f || !str(f.path) || !str(f.text)) continue;
    const path = f.path.trim();
    if (!isNotebookPath(path)) {
      refused.push(`a file outside the notebook: ${path}`);
      continue;
    }
    if (pinned.has(path)) {
      refused.push(`${path} is pinned (the player's edit): it may be commented on, never rewritten`);
      continue;
    }
    if (own(notebook.files, path) === f.text || own(files, path) !== undefined) continue;
    files[path] = putText(blobs, f.text);
    events.push(wsWrite(path, files[path]));
  }
  const comments: Record<string, string> = {};
  for (const raw of list(answer.comments)) {
    const c = record(raw);
    if (c && str(c.path) && pinned.has(c.path.trim()) && str(c.text)) comments[c.path.trim()] = c.text.trim();
  }
  if (events.length > 0 || Object.keys(comments).length > 0 || chapter) {
    const data: NotebookEventData = { kind, files, through, ...(chapter ? { chapter } : {}), ...(reason ? { reason } : {}), ...(Object.keys(comments).length > 0 ? { comments } : {}) };
    events.push(notebookEvent(data));
  }
  return { events, blobs, refused };
}

/** The author's reflection (§4.5, §5.2): its notebook revised, each arc checked for drift, predictions made. */
export async function authorReflect(input: ReflectInput): Promise<ReflectResult> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const data = [
    notebookText(input.notebook),
    (input.depth === "chapter" ? `Re-read the chapter: it would be chapter ${input.chapter + 1}.` : "Take stock at the scene's end.") +
      (input.page ? ` Its beats come a page at a time, oldest first: this is page ${input.page.index} of ${input.page.of}, and the notebook above is as the pages before it left it. Answer this page with edits of the files it changes (a file you leave out stands as it is), not a rewrite of the notebook.${input.page.index < input.page.of && input.depth === "chapter" ? " Pages follow, so the chapter can't end on this one." : ""} This page's beats, in order:` : " Its beats, in order:"),
    input.beats.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (none)",
    `Who the characters have become, in their own words:\n\n${input.becoming.map((b) => `### ${tag(names, b.who)}\n${[b.self && `Their story of themselves:\n${b.self}`, b.mind && `What they keep in mind:\n${b.mind}`].filter(Boolean).join("\n\n") || "(nothing written yet)"}`).join("\n\n") || "(no one has a mind yet)"}`,
    `The player's signals beyond his words (what he swiped, regenerated or edited, his out-of-character lines), the evidence for what he wants (player.md):\n${input.signals.map((s) => `- ${s}`).join("\n") || "- (none)"}`,
  ].join("\n\n");
  const asked = await askArchive(input, SCENE_TEXT.reflect, data, input.archive, "the reflection");
  const a = asked.answer;
  const ch = record(a.chapter);
  const ends = input.depth === "chapter" && ch?.ends === true && (!input.page || input.page.index === input.page.of);
  const title = ends ? (str(ch?.title) ? ch.title.trim() : `Chapter ${input.chapter + 1}`) : null;
  const reason = answerWhy(a).slice(0, 2000) || undefined;
  const rev = notebookRevision(a, input.notebook, input.depth === "chapter" ? "chapter" : "scene", input.through, ends && title ? { index: input.chapter, title } : null, reason);
  const drift: ReflectResult["drift"] = [];
  for (const r of list(a.drift)) {
    const d = record(r);
    const who = d ? names.person(d.who) : null;
    if (!d || !who || who === input.pov || drift.some((x) => x.who === who)) continue;
    const level = (DRIFT_LEVELS as readonly string[]).includes(text(d.drift)) ? (text(d.drift) as DriftLevel) : null;
    if (level) drift.push({ who, drift: level, note: text(d.note) });
  }
  const predictions: ReflectResult["predictions"] = [];
  for (const r of list(a.predictions)) {
    const p = record(r);
    if (!p || !str(p.text)) continue;
    predictions.push({ text: p.text.trim(), about: [...new Set(list(p.about).map((x) => names.person(x)).filter((x): x is EntityId => x !== null))] });
  }
  return {
    events: rev.events,
    blobs: rev.blobs,
    drift,
    predictions,
    chapter: { ends, title },
    refused: rev.refused,
    ...(asked.reasoning ? { reasoning: asked.reasoning } : reason ? { reasoning: reason } : {}),
    ...(asked.usage ? { usage: asked.usage } : {}),
    ...(asked.reads.length > 0 ? { reads: asked.reads } : {}),
  };
}

// ------------------------------------------------------------------ the player's edit of a message

export interface EditInput extends AuthorCtx {
  notebook: NotebookRead;
  /** The edited message is the player's own (what he did and said), not a reply. */
  own: boolean;
  /** The message as it was and as he made it. */
  before: string;
  after: string;
  /** The beats made from it (a reply's, its turn's), each with its ref. */
  beats: readonly { ref: string; beat: BeatText }[];
  /** Characters playing as their own agents in that scene: an amendment of their act is theirs to have done, so it stands as the player's directive. */
  /** Those whose minds lived a beat made from it: an amendment puts what they wrote from it out of mind until they catch up. */
  lived?: readonly EntityId[];
}

export interface EditResult extends StageCost {
  cosmetic: boolean;
  /** Each amended beat, with the refs of the beats it replaces. */
  amend: (DraftBeat & { replaces: string[] })[];
  /** Refs of beats taken out with nothing in their place. */
  strike: string[];
  why: string;
  refused: string[];
  /** Who catches up now, in the author's order (S9); null when it named no one: everyone who lived a replaced beat does. Anyone it leaves out waits for its poll. */
  catchup: EntityId[] | null;
}

/**
 * The player's edit of a reply, or of his own message (what he now says he did or said), is his
 * directive (§1.3, §4.2): the author decides which of the beats made from it the edit amends.
 */
export async function authorEdit(input: EditInput): Promise<EditResult> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const refs = new Set(input.beats.map((b) => b.ref));
  const of = input.own ? "his message" : "the reply";
  const beats = input.beats.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (none)";
  const data = [
    notebookText(input.notebook),
    input.own ? `The beats made from his message:\n${beats}` : `The beats the reply rendered:\n${beats}`,
    input.own ? `His message as it was:\n${input.before}` : `The reply as it was:\n${input.before}`,
    input.own ? `His message as he now made it, what he now says he did or said:\n${input.after}` : `The reply as the player made it:\n${input.after}`,
    `Who lived these beats with a mind of their own: ${(input.lived ?? []).map((id) => tag(names, id)).join(", ") || "(no one)"}. Those you name in "catchup" catch up now, in that order; anyone you leave out waits for your poll, which hears what fell out of their mind.`,
  ].join("\n\n");
  const asked = await ask(input, input.own ? SCENE_TEXT.editOwn : SCENE_TEXT.edit, data);
  const a = asked.answer;
  const refused: string[] = [];
  // The player's directive may amend anyone's act, his own character's included: it is his to say what happened.
  const drafts = draftBeats(a.amend, names, { ...input, pov: "" }, { agents: new Set() }, refused, "e");
  const amend: EditResult["amend"] = [];
  list(a.amend).forEach((raw, i) => {
    const r = record(raw);
    const ref = r && str(r.ref) ? r.ref.trim() : `e${i + 1}`;
    const d = drafts.find((x) => x.ref === ref);
    if (!r || !d) return;
    const replaces = list(r.replaces).map(text).filter((x) => refs.has(x));
    if (replaces.length === 0) {
      refused.push(`amendment ${ref} names no beat of ${of} it replaces`);
      return;
    }
    amend.push({ ...d, replaces });
  });
  const strike = [...new Set(list(a.strike).map(text).filter((x) => refs.has(x)))];
  const lived = new Set(input.lived ?? []);
  const catchup = Array.isArray(a.catchup) ? [...new Set(list(a.catchup).flatMap((c) => names.person(c) ?? []))].filter((id) => lived.has(id) || (refused.push(`${tag(names, id)} lived no beat of ${of}: no catch-up`), false)) : null;
  const cosmetic = a.cosmetic === true && amend.length === 0 && strike.length === 0;
  return {
    cosmetic,
    amend,
    strike,
    why: text(a.why),
    refused,
    catchup,
    ...(asked.reasoning ? { reasoning: asked.reasoning } : str(a.reasoning) ? { reasoning: a.reasoning.trim() } : {}),
    ...(asked.usage ? { usage: asked.usage } : {}),
  };
}
