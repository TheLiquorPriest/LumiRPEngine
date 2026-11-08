// A draft settles (DEPTH-PLAN §4.6): the author reads it against every live beat since its story
// time (its pins: whoever decided them, with no relevance filter) and settles it, adjusted only where
// they force it; drops it; or redrafts it for a later time. A settlement lands now at the frontier it
// read (t2): the draft's beats as settled, dated when they happened (the narrative is backdated),
// whoever they reached waiting to live them; then its world changes, the draft's kept ones and what
// the GM resolves now of what someone attempts, each validated in order on the state it lands on. It
// names its pins as a digest, so it lands only while they still stand (a later turn's beat, an undo
// or an amendment since refuses it; the job reads again), and only where every turn after its basis
// still folds as made with it (`LedgerCore.layerVerdict`). The participants' agents then catch up on
// what reached them.
//
// The reading itself (`readDraft`) is shared with the turn's walk-on (scene/turn.ts): when the
// player's scene reaches what an open draft holds, the author reads it the same way, against this
// turn's beats too, and settles it, drops it, or re-dates it past the scene, and the turn applies
// what it comes to in its own record, before anyone plays. What either costs rides with it as
// `author.spend` (§4.7): in the job's entry, or in the turn's record as a walk-on.

import { mindedAt, povOf } from "../../../shared/character-engine";
import { dropEvent, draftEvent, pinsOf, redatedDraft, settleEvent, STORY_SETTLE, AUTHOR_DROP, type DraftData } from "../../../shared/episodes";
import { AUTHOR_SPEND, spendEvent } from "../../../shared/author";
import { hashParts } from "../../../shared/hash";
import type { ChatId, EntityId, UserId } from "../../../shared/ids";
import type { Basis, LandResult } from "../../../shared/layer";
import type { LedgerEvent } from "../../../shared/ledger";
import type { PromptTexts } from "../../../shared/prompts";
import { beatEvent, beatId, type Beat, type Exposure } from "../../../shared/story";
import type { WorldDoc } from "../../../shared/world";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { layerEntryId } from "../../../engine/ledger/layer";
import type { Registry } from "../../../engine/registry-impl";
import type { WorldState } from "../../../engine/state";
import { catchUpNow, portFor } from "../../character-engine";
import { beatLine, beatTexts, putText, twice, type BeatText, type Blobs } from "../common";
import { readNotebook, type NotebookRead } from "../notebook";
import type { ModelPort } from "../port";
import { linkTruths } from "../truth-link";
import { SceneBook } from "../scene/book";
import { leadingTreatment, metered, spendData, spentSince } from "../spend";
import { DRAFT_TYPES, draftsOn } from "./drafts";
import { settleRead, type SettleAnswer } from "./author";
import { landEntry, OFFSCREEN_PLUGS, type OffscreenPlugs, type OffscreenRt } from "./episode";

/** The pins a settlement reads in one call at most: past it the draft waits, said, for the author to drop or redraft it (a prompt's bound; it never filters what a pin is). */
export const PINS_MOST = 200;

export interface SettleOut {
  /** What the author decided; null when nothing was asked (no such draft here, too many pins, the chain moved). */
  verdict: SettleAnswer["verdict"] | null;
  landed: LandResult | null;
  /** A redraft's start, in story minutes from the settlement's basis. */
  redraft: { in: number } | null;
  /** Who caught up on what reached them. */
  caughtUp: EntityId[];
  said: string[];
}

/** Exposure as a settlement writes it: who perceived the beat as the draft says, waiting for those with a mind (but the player character) to live it. */
function settledExposure(exposure: readonly Exposure[], minded: ReadonlySet<EntityId>, pov: EntityId, keepPov: boolean): Exposure[] {
  return exposure.map((x) => ({ who: x.who, channel: x.channel, reach: x.reach, ...(keepPov && x.pov ? { pov: x.pov } : {}), ...(x.who !== pov && minded.has(x.who) ? { pending: true as const } : {}) }));
}

/** What a reading of a draft reads and runs on. */
export interface DraftReadInput {
  registry: Registry;
  world: WorldDoc;
  /** The state what it comes to lands on: the fold at the job's basis, or the turn's working state. */
  state: Readonly<WorldState>;
  userId: UserId;
  /** Texts: the turn's own first, then the user's store. */
  blobs: { get(userId: UserId, hash: string): Promise<string | null> };
  draft: DraftData;
  /** Every live beat from its story time on, in fold order: the chain's, then the turn's so far. */
  pins: readonly Beat[];
  notebook: NotebookRead;
  texts: PromptTexts;
  model: ModelPort;
  signal?: AbortSignal;
  /** The GM's resolution of what someone attempts now (the scene's or the episode's plug). */
  plugs: Pick<OffscreenPlugs, "resolveAttempt">;
  runSeed: string;
  /** What makes its ids and draws unique to this reading: the job's basis, or the turn. */
  seed: string;
  /** Why it is read now (the poll's line), for a settlement that gives no reason of its own. */
  why?: string;
  /** The player's scene reaches what it holds: what of the scene, in words, and the scene's minute. */
  walkOn?: { reach: readonly string[]; now: number };
}

/** What the author's reading of a draft comes to. */
export interface DraftRead {
  verdict: SettleAnswer["verdict"];
  /** The author's line on how it reads against the pins. */
  why: string;
  /**
   * Its events, in order: a settlement's (`story.settle`, the beats it made canon, the world changes
   * it kept and what the GM resolved now), a drop's or a redraft's (`author.drop`), a re-date's (the
   * drop, then the draft again, later). Empty when a settlement kept none of its beats (said).
   */
  events: LedgerEvent[];
  blobs: Blobs;
  /** The beats a settlement made canon, each reach to someone with a mind waiting to be lived. */
  beats: Beat[];
  /** A redraft's start, in story minutes from now. */
  redraft: { in: number } | null;
  reasoning?: string;
  said: string[];
}

/**
 * The author reads `draft` against its pins (§4.6) and what it decides is written as events on the
 * state given: settled (its beats dated when they happened, adjusted only where a pin forces it, a
 * reach to anyone with a mind pending; its kept world changes and what the GM resolves now), dropped,
 * redrafted for later (the poll's) or re-dated past the scene (a walk-on's). Throws only for what the
 * caller must say (an answer that can't be read twice).
 */
export async function readDraft(input: DraftReadInput): Promise<DraftRead> {
  const { registry, world, state, userId, draft, model, texts, plugs } = input;
  const signal = input.signal ? { signal: input.signal } : {};
  const said: string[] = [];
  const pov = povOf(world, state);
  const reader = { blobs: input.blobs };
  const refs = draft.beats.map((b, i) => ({ ref: `d${i + 1}`, beat: b }));
  const beatsRead = (await beatTexts(reader, userId, draft.beats)).map((beat, i) => ({ ref: `d${i + 1}`, beat }));
  const pinned = input.pins.filter((b) => b.at >= draft.at);
  const pins = (await beatTexts(reader, userId, pinned)).map((beat, i) => ({ ref: `p${i + 1}`, beat }));
  const ctx = registry.context(world, state);
  const effects = draft.effects.map((e) => {
    try {
      return registry.get(e.type)?.describe(e, ctx) ?? e.type;
    } catch {
      return e.type;
    }
  });
  const answer = await twice(() => settleRead({ world, state, texts, pov, model, ...signal, notebook: input.notebook, episode: draft.episode, summary: draft.summary, at: draft.at, beats: beatsRead, effects, pins, ...(input.walkOn ? { walkOn: input.walkOn } : {}) }), input.signal);
  for (const r of answer.refused) said.push(`The author: ${r}`);
  const out = (events: LedgerEvent[], blobs: Blobs, beats: Beat[]): DraftRead => ({ verdict: answer.verdict, why: answer.why, events, blobs, beats, redraft: answer.verdict === "redraft" ? answer.redraft : null, ...(answer.reasoning ? { reasoning: answer.reasoning } : {}), said });

  if (answer.verdict === "drop" || answer.verdict === "redraft") {
    const why = answer.verdict === "redraft" ? `Redrafted for later: ${answer.why}` : answer.why;
    return out([dropEvent({ draft: draft.id, why: why || "The story overtook it." })], {}, []);
  }
  if (answer.verdict === "redate") {
    // It happens as drafted, later: from `in` minutes after the scene's minute.
    const now = input.walkOn?.now ?? state.clock;
    const by = now + (answer.redraft?.in ?? 1) - draft.episode.span[0];
    const later = redatedDraft(draft, Math.max(1, by));
    const when = formatClock(calendarOf(world), later.episode.span[0]);
    return out([dropEvent({ draft: draft.id, why: `Re-dated to ${when}${answer.why ? `: ${answer.why}` : ""}` }), draftEvent(later)], {}, []);
  }

  // The settlement: the draft's beats as the author settled them, then its world changes and what the GM resolves now.
  const book = new SceneBook({ registry, world, state, prefix: [], turn: hashParts(draft.id, "settle", input.seed), userId, blobs: input.blobs, pov, say: (line) => said.push(line) });
  book.scene = draft.episode.id;
  book.place = draft.episode.places[0] ?? draft.beats[0]?.place ?? "";
  const minded = new Set(mindedAt(state));
  const beats: Beat[] = [];
  for (const { ref, beat } of refs) {
    const v = answer.beats.get(ref);
    if (v && !v.keep) continue;
    const adjusted = v !== undefined && (v.what !== undefined || v.surface !== undefined || v.quotes !== undefined);
    if (!adjusted) {
      beats.push({ ...beat, exposure: settledExposure(beat.exposure, minded, pov, true) });
      continue;
    }
    const read = beatsRead.find((b) => b.ref === ref)?.beat;
    const surface = v.surface ?? read?.surface ?? "";
    const quotes = v.quotes ?? read?.quotes;
    const exposure = settledExposure(beat.exposure, minded, pov, false);
    const newId = beatId(draft.id, "settled", ref);
    // The draft's deed told the beat as drafted: rewritten, it keeps none, so its actors live it from the inside, as the point-of-view render tells it (`SceneBook.povs`), rather than an act it no longer holds.
    const { deed: _drafted, ...settled } = beat;
    await book.povs({ id: newId, surface, ...(quotes ? { quotes } : {}), actors: beat.actors, about: beat.about, ...(beat.addressed ? { addressed: beat.addressed } : {}) }, exposure, model, texts, input.signal);
    beats.push({ ...settled, id: newId, what: putText(book.blobs, v.what ?? read?.what ?? ""), surface: putText(book.blobs, surface), ...(quotes ? { quotes: putText(book.blobs, quotes) } : {}), exposure });
  }
  const kept: LedgerEvent[] = [];
  draft.effects.forEach((e, i) => {
    if (answer.effects.get(i + 1) === false) return;
    kept.push(...book.apply([e], 0));
  });
  const outcomes: BeatText[] = [];
  for (const [i, a] of answer.attempts.entries()) {
    const r = await plugs.resolveAttempt(model, { registry, world, state: book.state, act: { actor: a.who, surface: a.attempt, attempt: a.attempt }, seed: hashParts(draft.id, "settle", input.seed, String(i)), runSeed: input.runSeed, scene: pins.map((p) => beatLine(world, state, p.beat)), texts, ...signal });
    kept.push(...book.apply(r.events, 0));
    if (!r.outcome) continue;
    const b = await book.write({ ref: `a${i + 1}`, decided: "gm", actors: [], act: "happened", what: r.outcome.what, surface: r.outcome.surface, ...(r.outcome.quotes ? { quotes: r.outcome.quotes } : {}), about: r.outcome.about, exposure: [{ who: a.who, channel: "sight", reach: "whole" }] }, "gm", 0, { model, texts, ...signal });
    if (b) outcomes.push(b);
  }
  for (const b of outcomes) beats.push({ ...b.beat, by: { draft: draft.id } });
  if (beats.length === 0) {
    said.push("the author kept none of its beats, so it wasn't settled");
    return out([], {}, []);
  }
  const settle = settleEvent({ draft: draft.id, at: draft.at, pins: pinsOf({ beats: pinned.map((beat) => ({ beat })) }, draft.at), why: answer.why || input.why || "Nothing seen since says otherwise.", beats: beats.map((b) => b.id) });
  return out([settle, ...beats.map((b) => beatEvent(b)), ...kept], book.blobs, beats);
}

/**
 * Settles draft `id` at `basis` (the chat's head by default) as the author reads it against its pins:
 * lands the settlement or the drop, with what reading it cost, runs the catch-ups of whoever its
 * beats reached, and the GM's truth link of its beats and what those catch-ups wrote (`linkTruths`,
 * keyed by the draft; what those cost lands beside it). Throws only for what the caller must say (an
 * answer that can't be read twice).
 */
export async function settleDraft(rt: OffscreenRt, chatId: ChatId, userId: UserId, id: string, o: { basis?: Basis; why?: string; model?: ModelPort; signal?: AbortSignal; plugs?: OffscreenPlugs } = {}): Promise<SettleOut> {
  const out: SettleOut = { verdict: null, landed: null, redraft: null, caughtUp: [], said: [] };
  const signal = o.signal ? { signal: o.signal } : {};
  const basis = o.basis ?? (await rt.ledger.basisFor(chatId, userId));
  const at = basis ? await rt.ledger.foldAtBasis(chatId, userId, basis, DRAFT_TYPES) : null;
  if (!basis || !at) return { ...out, said: ["the chat moved on while the draft was read"] };
  const found = draftsOn(at.events).find((d) => d.draft.id === id);
  if (!found) return { ...out, said: [`there is no draft ${id} on this chain`] };
  if (found.state !== "open") return { ...out, said: [`the draft is already ${found.state} here`] };
  const draft: DraftData = found.draft;
  const { world, state, story } = at;
  const settings = await rt.settings.get(userId);
  const pinned = story.beats.filter((p) => p.beat.at >= draft.at);
  if (pinned.length > PINS_MOST) return { ...out, said: [`${pinned.length} beats have come since its story time, more than a settlement reads at once (${PINS_MOST}): drop it, or redraft it for later`] };
  const meter = metered(o.model ?? portFor(rt, userId));
  const runSeed = (await rt.ledger.core(chatId, userId))?.journal.run?.runSeed ?? chatId;
  const read = await readDraft({
    registry: rt.registry,
    world,
    state,
    userId,
    blobs: rt.blobs,
    draft,
    pins: pinned.map((p) => p.beat),
    notebook: await readNotebook(rt, userId, state),
    texts: settings.prompts.texts,
    model: meter.port,
    ...signal,
    plugs: o.plugs ?? OFFSCREEN_PLUGS,
    runSeed,
    seed: hashParts(basis.message, basis.swipe),
    ...(o.why ? { why: o.why } : {}),
  });
  out.verdict = read.verdict;
  out.said.push(...read.said);
  out.redraft = read.redraft;
  if (read.events.length === 0) return out;
  // What reading it cost rides in its entry: the story interval it counts in is the draft's own.
  const spending = { treatment: leadingTreatment(draft.episode.parts), interval: settings.depth.budget.interval, at: draft.at, for: id } as const;
  const spend = spendData(meter.spent(), spending);
  const events = [...read.events, ...(spend ? [spendEvent(spend)] : [])];
  const kind = read.verdict === "settle" ? STORY_SETTLE : AUTHOR_DROP;
  out.landed = await landEntry(rt, chatId, userId, { id: layerEntryId(kind, chatId, id, basis.message, basis.swipe), basis, kind, events, by: { role: "author" } }, read.blobs, read.reasoning);
  if (read.verdict !== "settle" || out.landed.status !== "landed") return out;

  // Whoever its beats reached lives them now, in story order; then the GM links what the settlement made canon and what they wrote (§4.4): the facts its beats establish, a secret a letter or a rumor revealed to the player character among them, and the beliefs its catch-ups wrote.
  const before = meter.spent();
  const waiting = [...new Set(read.beats.flatMap((b) => b.exposure.filter((x) => x.pending).map((x) => x.who)))];
  for (const who of waiting) {
    try {
      if ((await catchUpNow(rt, chatId, userId, who, { basis, model: meter.port, ...signal })).lived > 0) out.caughtUp.push(who);
    } catch (error) {
      out.said.push(`${state.entities[who]?.name ?? who}'s catch-up didn't go through: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    const r = await linkTruths(rt, chatId, userId, basis, { who: out.caughtUp, beats: read.beats, key: ["settle", id], model: meter.port, ...signal });
    out.said.push(...r.refused.map((line) => `the GM's truth-link: ${line}`));
  } catch (error) {
    out.said.push(`the GM's truth-link didn't go through: ${error instanceof Error ? error.message : String(error)}`);
  }
  const caughtUp = spendData(spentSince(before, meter.spent()), spending);
  if (caughtUp) {
    const r = await landEntry(rt, chatId, userId, { id: layerEntryId(AUTHOR_SPEND, chatId, id, "catch-up", basis.message, basis.swipe), basis, kind: AUTHOR_SPEND, events: [spendEvent(caughtUp)], by: { role: "author" } }, {});
    if (r.status === "refused") out.said.push(`what its catch-ups and truth link cost wasn't kept: ${r.reason}`);
  }
  return out;
}
