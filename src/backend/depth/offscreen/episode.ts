// An episode off screen becomes a draft (DEPTH-PLAN §4.4, §4.6): run at its treatments, as a scene
// with no player in it. The author stages it and writes the beats of those it plays or handles and of
// the world; someone with a "live" part plays as their own agent, beat by beat, from their own mind
// and what reached them, between the author's steps; what anyone attempts that the rules decide goes
// to the GM, whose changes are the draft's world changes. Nothing of it is canon: the draft lands as
// one `story.draft` entry at the frontier it read, its beats dated from the episode's own minute and
// marked as the draft's own, the plays' working memory left out (whoever lived it catches up on what
// reached them once it settles). It holds whom and what it touches and from when: its people, the
// places it plays in, those its beats reached, and what the author names.
//
// Bookkeeping only here: who plays live (a live part with a mind; without one the author plays them,
// said), the bound on its steps, the draws its attempts take (the draft's id with the beat's), the
// digests of what it read (each mind file a play or the author's playing of someone showed, and the
// notebook files the author said it draws on), and what it cost (`author.spend` in its entry, §4.7). Every judgment is
// the author's, the characters' or the GM's. No one plays from what isn't canon (§4.6): while an open
// draft holds one of its people from before it starts, it isn't run (said), so the poll settles,
// drops or re-dates that one first.

import { MIND_FILE_NAMES, mindDir, mindedAt, mindV2At, povOf } from "../../../shared/character-engine";
import { draftEvent, draftId, episodeId, STORY_DRAFT, type DraftData, type DraftTouch, type EpisodePart, type StoryEpisode } from "../../../shared/episodes";
import { spendEvent } from "../../../shared/author";
import { DEPTH_TREATMENT_DEFS } from "../../../shared/depth-settings";
import { hashParts } from "../../../shared/hash";
import type { ChatId, EntityId, UserId } from "../../../shared/ids";
import type { Basis, LandResult, LayerDraft } from "../../../shared/layer";
import type { LedgerEvent } from "../../../shared/ledger";
import type { Beat, StoryRef } from "../../../shared/story";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { layerEntryId } from "../../../engine/ledger/layer";
import { inStoryOrder } from "../../../engine/ledger/story";
import { NOTEBOOK_DIR, notebookFiles } from "../../../engine/notebook";
import { own } from "../../../engine/pack-kit";
import { placeOfEntity } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { shownFiles } from "../../character-agent";
import { mindInput, portFor, readMind, type EngineRt } from "../../character-engine";
import type { BasisRead } from "../../ledger-io";
import { beatLine, beatTexts, DepthAnswerError, twice, type BeatText } from "../common";
import { readNotebook } from "../notebook";
import type { ModelPort } from "../port";
import { SceneBook } from "../scene/book";
import { actBeatTexts, play, sceneSoFar, type PlayInput, type PlayOut, type SceneRead } from "../scene/play";
import { resolveAttempt, type AttemptInput, type AttemptOut } from "../scene/resolve";
import type { DraftBeat, EpisodeAsk, PlayedMind } from "../scene/author";
import { leadingTreatment, metered, spendData } from "../spend";
import { episodeOpen, episodeStep, type EpisodeAnswer, type EpisodeView } from "./author";
import { DRAFT_TYPES, draftsOn, heldFrom } from "./drafts";

/** What the world beyond view reads of the runtime: the Character Engine's, the fold at a basis with the live events it asks for, and the chat's core for its run seed (`Runtime` is one). */
export interface OffscreenRt extends EngineRt {
  readonly ledger: Omit<EngineRt["ledger"], "foldAtBasis"> & {
    foldAtBasis(chatId: ChatId, userId: UserId, basis: Basis, types?: readonly string[]): Promise<BasisRead | null>;
    chainBases(chatId: ChatId, userId: UserId): Promise<Basis[]>;
    core(chatId: ChatId, userId: UserId): Promise<{ journal: { run?: { runSeed: string } } } | null>;
  };
}

/** The scene's stages an episode borrows: a character's play (A2b) and the GM's resolution of an attempt; a test binds scripted ones. */
export interface OffscreenPlugs {
  play(model: ModelPort, input: PlayInput): Promise<PlayOut>;
  sceneSoFar: typeof sceneSoFar;
  actBeatTexts: typeof actBeatTexts;
  resolveAttempt(model: ModelPort, input: AttemptInput): Promise<AttemptOut>;
}

export const OFFSCREEN_PLUGS: OffscreenPlugs = { play, sceneSoFar, actBeatTexts, resolveAttempt };

/** The author's steps an episode takes at most while someone plays it live: a bound on its length, never a judgment of it. */
export const EPISODE_STEPS_MOST = 8;
/** The story's newest beats the author reads beside an episode (a prompt's bound). */
const RECENT_BEATS = 40;

export interface DraftOut {
  draft: DraftData | null;
  landed: LandResult | null;
  /** What the run said: refusals, slides down the ladder, a step that couldn't be read. */
  said: string[];
}

/** The single files the author reads of someone it plays from their mind (`playedText`). */
const PLAYED_FILES = ["core", "self", "now", "mind"] as const;

/**
 * What of a draft's inputs changed underneath it at `state` (§4.6), each seen on its own: the mind
 * files a play or the author's playing of someone showed it, by whose mind (one of its people's), and
 * the notebook files the author said it draws on, by path, whose body is another now or is gone. A
 * revision of a file it never read, or a write to a mind it never read, isn't one. An input it can't
 * place (another build's) is left out.
 */
export function changedInputs(state: Readonly<WorldState>, draft: Pick<DraftData, "inputs" | "episode">): { minds: EntityId[]; notebook: string[] } {
  const people = [...new Set([...draft.episode.people, ...draft.episode.parts.flatMap((p) => ("who" in p.subject ? [p.subject.who] : []))])];
  const notebook = new Map(notebookFiles(state).map((f) => [f.path, f.hash]));
  const out: { minds: EntityId[]; notebook: string[] } = { minds: [], notebook: [] };
  for (const [path, hash] of Object.entries(draft.inputs)) {
    if (path.startsWith(NOTEBOOK_DIR)) {
      if (notebook.get(path) !== hash) out.notebook.push(path);
      continue;
    }
    const who = people.find((w) => path.startsWith(mindDir(w)));
    if (who === undefined || out.minds.includes(who)) continue;
    if (own(mindV2At(state, who).files, path.slice(mindDir(who).length))?.hash !== hash) out.minds.push(who);
  }
  return out;
}

/** The episode the poll opened, as the draft keeps it: its id from the poll's basis and its place among that poll's episodes. */
export function episodeOf(chatId: ChatId, basis: Basis, index: number, ask: EpisodeAsk, now: number): StoryEpisode {
  const start = now + ask.in;
  return { id: episodeId(chatId, basis.message, basis.swipe, String(index)), span: [start, start + Math.max(1, ask.minutes)], places: [...ask.places], people: [...ask.people], why: ask.why, parts: ask.parts.map((p): EpisodePart => ({ subject: p.subject, treatment: p.treatment, rationale: p.rationale })) };
}

/** Whom and what the draft holds and from when: its people and places from its start, everyone its beats reached from that beat's minute, and what the author named; each at its earliest. */
function touchesOf(episode: StoryEpisode, beats: readonly Beat[], named: readonly { ref: StoryRef; after: number }[], pov: EntityId): DraftTouch[] {
  const out = new Map<string, DraftTouch>();
  const add = (ref: StoryRef, from: number): void => {
    const key = JSON.stringify(ref);
    const had = out.get(key);
    if (!had || from < had.from) out.set(key, { ref, from });
  };
  const start = episode.span[0];
  for (const who of episode.people) add({ entity: who }, start);
  for (const place of episode.places) add({ place }, start);
  for (const b of beats) for (const x of b.exposure) if (x.who !== pov) add({ entity: x.who }, b.at);
  for (const t of named) add(t.ref, start + t.after);
  return [...out.values()];
}

/**
 * What a draft's world changes hold (§4.6): every person or thing whose record they wrote (made,
 * changed or removed) between `was` and `now`, and the places it was at before and after, but the
 * player character and his place, so no scene plays from a version of them that isn't canon yet.
 */
export function effectTouches(was: Pick<WorldState, "entities">, now: Pick<WorldState, "entities">, pov: EntityId): StoryRef[] {
  const ids = new Set([...Object.keys(was.entities), ...Object.keys(now.entities)]);
  const changed = [...ids].filter((id) => id !== pov && JSON.stringify(own(was.entities, id) ?? null) !== JSON.stringify(own(now.entities, id) ?? null));
  const refs: StoryRef[] = changed.map((entity) => ({ entity }));
  const pc = new Set([placeOfEntity(was, pov), placeOfEntity(now, pov)]);
  const places = new Set<string>();
  for (const id of changed) for (const p of [placeOfEntity(was, id), placeOfEntity(now, id)]) if (p !== null && !pc.has(p)) places.add(p);
  for (const place of places) refs.push({ place });
  return refs;
}

/**
 * Drafts episode `ask` (the `index`th the poll at `basis` opened) at its treatments and lands it as a
 * draft at `basis`. Throws only for what the caller must say (an answer that can't be read twice);
 * a refused landing comes back as its result.
 */
export async function draftEpisode(rt: OffscreenRt, chatId: ChatId, userId: UserId, basis: Basis, ask: EpisodeAsk, o: { index: number; model?: ModelPort; signal?: AbortSignal; plugs?: OffscreenPlugs }): Promise<DraftOut> {
  const said: string[] = [];
  const plugs = o.plugs ?? OFFSCREEN_PLUGS;
  const meter = metered(o.model ?? portFor(rt, userId));
  const model = meter.port;
  const signal = o.signal ? { signal: o.signal } : {};
  const settings = await rt.settings.get(userId);
  const texts = settings.prompts.texts;
  const at = await rt.ledger.foldAtBasis(chatId, userId, basis, DRAFT_TYPES);
  if (!at) return { draft: null, landed: null, said: ["the reply it was opened at left the chat's chain"] };
  const { world, state, story } = at;
  const pov = povOf(world, state);
  const episode = episodeOf(chatId, basis, o.index, ask, state.clock);
  const id = draftId(chatId, episode.id);
  const name = (who: EntityId): string => state.entities[who]?.name ?? who;

  // An open draft holding one of its people from before it starts comes first: the episode would play them past it.
  const open = draftsOn(at.events);
  const people = [...new Set([...episode.people, ...episode.parts.flatMap((p) => ("who" in p.subject ? [p.subject.who] : []))])];
  const held = people.flatMap((who) => {
    const h = heldFrom(open, who);
    return h && h.from <= episode.span[0] ? [`${name(who)} is held by an open draft (${h.drafts.map((d) => d.id).join(", ")}) from ${formatClock(calendarOf(world), h.from)}: it settles, is dropped or is re-dated before this episode plays them`] : [];
  });
  if (held.length > 0) return { draft: null, landed: null, said: held };
  const runSeed = (await rt.ledger.core(chatId, userId))?.journal.run?.runSeed ?? chatId;
  const replaced = new Set(story.replaced.map((r) => r.id));
  const minded = new Set(mindedAt(state));
  // What it reads, by workspace path, at the body it read (§4.6): each mind file a play or the author's playing of someone shows, only where it is canon (one the episode itself wrote is no input), and the notebook files the author says it draws on.
  const inputs: Record<string, string> = {};
  const readFiles = (at: Readonly<WorldState>, who: EntityId, rels: readonly string[]): void => {
    for (const rel of rels) {
      const hash = own(mindV2At(state, who).files, rel)?.hash;
      if (hash !== undefined && own(mindV2At(at, who).files, rel)?.hash === hash) inputs[`${mindDir(who)}${rel}`] ??= hash;
    }
  };
  const cited = new Set<string>();

  // Who plays live: a live part with a mind to play it; anyone else with a part of their own the author plays from their mind.
  const live: EntityId[] = [];
  const played: PlayedMind[] = [];
  for (const p of episode.parts) {
    if (!("who" in p.subject)) continue;
    const who = p.subject.who;
    const plays = DEPTH_TREATMENT_DEFS[p.treatment].plays;
    if (plays === "agent" && who !== pov && minded.has(who)) {
      if (!live.includes(who)) live.push(who);
      continue;
    }
    if (plays === "agent") said.push(`${who} has no mind to play live: the author plays them from what it knows`);
    if (plays !== "author") {
      const files = await readMind(rt.blobs, userId, state, who, replaced);
      const shown: PlayedMind["files"] = {};
      for (const kind of PLAYED_FILES) {
        const text = files[MIND_FILE_NAMES[kind]];
        if (!text) continue;
        shown[kind] = text;
        readFiles(state, who, [MIND_FILE_NAMES[kind]]);
      }
      played.push({ who, files: shown });
    }
  }
  // The latest beats as the story tells them: a settled draft's backdated beats read in their place, not where they landed.
  const recent = (await beatTexts(rt, userId, inStoryOrder(story.beats).slice(-RECENT_BEATS).map((p) => p.beat))).map((beat, i) => ({ ref: `r${i + 1}`, beat }));
  const view: EpisodeView = { episode, live, played, recent };
  const notebook = await readNotebook(rt, userId, state);

  const book = new SceneBook({ registry: rt.registry, world, state, prefix: [], turn: id, userId, blobs: rt.blobs, pov, say: (line) => said.push(line) });
  book.scene = episode.id;
  book.place = episode.places[0] ?? episode.people.map((w) => placeOfEntity(state, w)).find((p): p is string => p !== null) ?? placeOfEntity(state, pov) ?? "";
  book.minute = episode.span[0];
  const effects: LedgerEvent[] = [];
  const reasoning: string[] = [];
  const named: { ref: StoryRef; after: number }[] = [];
  let summary = "";
  const ctx = { world, state, texts, pov, model, ...signal, notebook, view };

  /** What the GM resolves of an attempt on the working state: its kept changes join the draft's, its outcome is a beat of its own (decided "gm") perceived by those who perceived the attempt. */
  const resolve = async (beat: BeatText, attempt: string, mark: number): Promise<void> => {
    const actor = beat.beat.actors[0];
    if (actor === undefined) return;
    const r = await plugs.resolveAttempt(model, { registry: rt.registry, world, state: book.state, act: { actor, surface: beat.surface, ...(beat.quotes ? { quotes: beat.quotes } : {}), attempt }, seed: hashParts(id, "attempt", beat.beat.id), runSeed, scene: book.beats.map((b) => beatLine(world, book.state, b)), texts, ...signal });
    if (r.reasoning) reasoning.push(`The GM: ${r.reasoning}`);
    const was = structuredClone({ entities: book.state.entities });
    effects.push(...book.apply(r.events, mark));
    // What the change wrote of the world is held from this minute, as what the author named is.
    for (const ref of effectTouches(was, book.state, pov)) named.push({ ref, after: Math.max(0, book.minute - episode.span[0]) });
    book.minute += Math.max(0, r.minutes);
    if (!r.outcome) return;
    const exposure = beat.beat.exposure.map(({ who, channel, reach }) => ({ who, channel, reach }));
    await book.write({ ref: `${beat.beat.id}-outcome`, decided: "gm", actors: [], act: "happened", what: r.outcome.what, surface: r.outcome.surface, ...(r.outcome.quotes ? { quotes: r.outcome.quotes } : {}), about: r.outcome.about, exposure, ...(r.outcome.uncertain ? { uncertain: r.outcome.uncertain } : {}) }, "gm", mark, { model, texts, ...signal });
  };

  /** The author's own beats of an answer, written whole, each attempt resolved after its beat. */
  const authored = async (answer: EpisodeAnswer, mark: number, after?: string): Promise<void> => {
    for (const r of answer.refused) said.push(`The author: ${r}`);
    if (answer.reasoning) reasoning.push(`The author: ${answer.reasoning}`);
    if (answer.summary) summary = answer.summary;
    named.push(...answer.touches);
    for (const path of answer.cites) cited.add(path);
    book.stage(answer.staging, mark, after);
    for (const d of answer.beats) {
      const b = await book.write(d, "author", mark, { model, texts, ...signal });
      if (b && d.attempt) await resolve(b, d.attempt, mark);
    }
  };

  const opened = await twice(() => episodeOpen(ctx), o.signal);
  await authored(opened, 0);
  let next = opened.end === null ? opened.next : [];
  for (let step = 1; next.length > 0 && step <= EPISODE_STEPS_MOST && !o.signal?.aborted; step++) {
    const read: SceneRead = { world, state: book.state, story, beats: book.beats.map((b) => b.beat) };
    const decided: { id: string; draft: DraftBeat; attempt?: string }[] = [];
    for (const who of next) {
      const beatIdOf = book.nextId();
      let out: PlayOut;
      let shown: string[];
      try {
        const mind = await mindInput({ registry: rt.registry, blobs: book.reader }, userId, { state: book.state, world, story }, who, settings);
        shown = shownFiles(mind);
        const so = await plugs.sceneSoFar(book.reader, userId, read, who);
        out = await plugs.play(model, { ...mind, beat: beatIdOf, scene: so.scene, reached: so.reached, ...signal });
      } catch (error) {
        if (!(error instanceof DepthAnswerError) || o.signal?.aborted) throw error;
        said.push(`${name(who)}'s agent gave no answer that could be read, so they let the moment pass`);
        continue;
      }
      // What its play read of its mind, before the play's own writes join the working state.
      readFiles(book.state, who, shown);
      // Its working memory of the episode stays in the episode's working state: once the draft settles, it lives what reached it.
      book.apply(out.events, step);
      Object.assign(book.blobs, out.blobs);
      if (out.reasoning) reasoning.push(`${name(who)}: ${out.reasoning}`);
      if (out.act === null) continue;
      const t = plugs.actBeatTexts(out.act, name(who));
      decided.push({ id: beatIdOf, draft: { ref: `p${step}-${decided.length + 1}`, decided: "character", actors: [who], act: out.act.act, ...t, ...(out.act.addressed ? { addressed: out.act.addressed } : {}), about: [], exposure: [] }, ...(out.act.attempt ? { attempt: out.act.attempt } : {}) });
    }
    let answer: EpisodeAnswer | null = null;
    try {
      const so = { staging: [...book.staging.values()], beats: book.beats.map((b, i) => ({ ref: `t${i + 1}`, beat: b })), decided: decided.map((d) => d.draft), left: EPISODE_STEPS_MOST - step };
      answer = await twice(() => episodeStep({ ...ctx, state: book.state, so }), o.signal);
    } catch (error) {
      if (!(error instanceof DepthAnswerError) || o.signal?.aborted) throw error;
      said.push("The author's step couldn't be read twice: the episode ends where it is");
    }
    let last: string | undefined;
    for (const d of decided) {
      const exposure = (answer?.exposure ?? []).filter((x) => x.beat === d.draft.ref).map(({ who, channel, reach }) => ({ who, channel, reach }));
      const b = await book.write({ ...d.draft, exposure }, "character", step, { id: d.id, model, texts, ...signal });
      if (!b) continue;
      last = b.beat.id;
      if (d.attempt) await resolve(b, d.attempt, step);
    }
    if (!answer) break;
    await authored(answer, step, last);
    next = answer.end === null ? answer.next : [];
    if (next.length > 0 && step === EPISODE_STEPS_MOST) said.push(`The episode reached its ${EPISODE_STEPS_MOST} steps and ends there`);
  }
  if (o.signal?.aborted) return { draft: null, landed: null, said: [...said, "stopped before it was drafted"] };
  if (book.beats.length === 0) return { draft: null, landed: null, said: [...said, "the author wrote nothing of it, so nothing was drafted"] };

  const beats = book.beats.map((b): Beat => ({ ...b.beat, by: { draft: id } }));
  const bodies = new Map(notebookFiles(state).map((f) => [f.path, f.hash]));
  for (const path of cited) {
    const hash = bodies.get(path);
    if (hash !== undefined) inputs[path] ??= hash;
  }
  const draft: DraftData = {
    id,
    episode,
    at: Math.min(...beats.map((b) => b.at)),
    inputs,
    beats,
    effects,
    touches: touchesOf(episode, beats, named, pov),
    summary: summary || episode.why,
  };
  const thinking = reasoning.join("\n\n");
  // What drafting it cost rides in its entry, counted at its treatment (its leading part's) in the story interval of its own time.
  const spend = spendData(meter.spent(), { treatment: leadingTreatment(episode.parts), interval: settings.depth.budget.interval, at: draft.at, for: id });
  const events = [draftEvent(draft), ...(spend ? [spendEvent(spend)] : [])];
  const landed = await landEntry(rt, chatId, userId, { id: layerEntryId(STORY_DRAFT, chatId, id, basis.message, basis.swipe), basis, kind: STORY_DRAFT, events, by: { role: "author" } }, book.blobs, thinking);
  return { draft, landed, said };
}

/** Puts a job's texts and its thinking, then lands its entry; a refusal comes back as the result, for the caller to say. */
export async function landEntry(rt: Pick<OffscreenRt, "blobs" | "ledger">, chatId: ChatId, userId: UserId, draft: LayerDraft, blobs: Readonly<Record<string, string>>, thinking?: string): Promise<LandResult> {
  for (const text of Object.values(blobs)) await rt.blobs.put(userId, text);
  const reasoning = thinking ? await rt.blobs.put(userId, thinking) : undefined;
  return rt.ledger.landLayer(chatId, userId, { ...draft, ...(reasoning !== undefined ? { reasoning } : {}) });
}
