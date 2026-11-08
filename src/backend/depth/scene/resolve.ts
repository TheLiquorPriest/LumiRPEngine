// The GM inside a depth scene (DEPTH-PLAN §5.2 "GM, resolution", §1.3, §4.2): canon is decided by the
// simulation before the prose, and whoever decides a beat writes it.
//
//   playerBeats     the player's own beats from his input, read against the scene so far, beside today's
//                   engine run's resolutions of the actions he picked from the engine's list: his acts
//                   and words, each quoting the words of his message it rests on, the outcome of each
//                   picked action as the rules decided it, what else an act of his attempts, his inner
//                   life as a beat for him alone; his out-of-character lines come back as signals, never
//                   as beats
//   resolveAttempt  an act someone in the scene tries: the GM reads it against the actions the rules
//                   have for them now, as the intent reader and the judge read the player's words; the
//                   engine resolves it (requirements, the check under the chat's adjudication policy,
//                   effects, world rules and tracks) on the scene's state; and the GM writes the outcome
//                   beat when the rules decided something the act didn't already say. Each action it
//                   reads quotes the act's own words it plays: one that rests on none is a misread
//
// Pure apart from the model port: they return texts and events and land nothing; the scene writes
// the beats around them with the author's exposure. Bounded and deterministic where the rules settle
// things: the engine's own resolution, checks and odds, its own validation of every change, drawn
// from the turn's seed with the beat's id, so a Re-run rolls again and a Re-narrate copies the events
// the turn recorded. An outcome the GM's answer leaves out is still told, in the engine's own words
// and marked uncertain, since the rules decided it whether or not the GM wrote it down.

import type { ActionId, EntityId } from "../../../shared/ids";
import { hasOwn, type JsonObject } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import type { PromptTexts } from "../../../shared/prompts";
import { SCENE_GM_TEXT } from "../../../shared/scene-gm-prompts";
import { povOf } from "../../../shared/character-engine";
import { BEAT_ACTS, type BeatAct, type StoryRef } from "../../../shared/story";
import { hashParts } from "../../../shared/hash";
import { offersAction, type WorldDoc } from "../../../shared/world";
import { possessive } from "../../../shared/words";
import { actionWords, spanText } from "../../../engine/action-words";
import { policyOf, type Judgement } from "../../../engine/adjudication";
import { checkOf } from "../../../engine/checks";
import { allowedSkills, inferredOf, inferredRead, resolveTry, rolledByTry, skillSources, TRY_ACTION } from "../../../engine/inferred";
import { authorLines } from "../../../engine/player-events";
import type { Rejection } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { findAction, placeCandidates, resolveAction, type Resolution } from "../../../engine/resolve";
import { createRng } from "../../../engine/rng";
import { runRulesOnEvents } from "../../../engine/rules";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { ACTION_QUEUE_LIMIT } from "../../../engine/steps";
import { stepTracks } from "../../../engine/tracks";
import { Working } from "../../../engine/working";
import { own } from "../../../engine/pack-kit";
import { interpretCatalog, tryEntry, type CatalogEntry } from "../../interpret-context";
import { askRole, bareId, named, personNamed, placeNamed, spoken, type StageCost } from "../common";
import { addUsage, NO_USAGE, type ModelPort, type PortUsage } from "../port";
import { giveWay } from "../../give-way";

/** A beat's texts as the GM writes them; the scene sets its id, order, place, scene, minute, exposure and `by`. */
export interface GmBeatTexts {
  what: string;
  surface: string;
  quotes?: string;
  about: StoryRef[];
  /** The GM's own doubt, for the spot checks (`Beat.uncertain`). */
  uncertain?: string;
}

// ------------------------------------------------------------------ reading an answer

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A non-blank text, trimmed; else null. */
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** The people an answer named, each the one person it names (`personNamed`), once. */
function peopleOf(state: Readonly<WorldState>, raw: unknown): EntityId[] {
  return [...new Set(list(raw).flatMap((v) => (typeof v === "string" ? (personNamed(state, v) ?? []) : [])))];
}

/** What an answer says a beat concerns: each person, thing or place it named by id (or the one person or place a name names). */
function aboutOf(world: WorldDoc, state: Readonly<WorldState>, raw: unknown, also: readonly EntityId[] = []): StoryRef[] {
  const out: StoryRef[] = [];
  const seen = new Set<string>();
  const add = (ref: StoryRef, key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const id of also) add({ entity: id }, id);
  for (const v of list(raw)) {
    if (typeof v !== "string") continue;
    const id = bareId(v);
    if (own(state.entities, id)) add({ entity: id }, id);
    else if (own(world.places, id)) add({ place: id }, id);
    else {
      const person = personNamed(state, v);
      const place = person === null ? placeNamed(world, v) : null;
      if (person !== null) add({ entity: person }, person);
      else if (place !== null) add({ place }, place);
    }
  }
  return out;
}

// ------------------------------------------------------------------ the words a reading rests on

// LIVE3 L3a-5: handed the player's whole message, the GM read the door he opened as getting out of
// bed, from "roll out of bed" in another act of his, and "take the stairs after Danny" (down) as a
// climb up. So each beat of his own quotes the words of his message it rests on, and each action an
// act plays as quotes the act's own words, held to them word by word, near enough that a model's
// copying passes: case, quote marks, dashes, spacing and the punctuation at its edges aside, a word
// may be an inflection of it (rolls, rolled for roll) or a pronoun for one (his door for my door), and
// one word in four may differ outright, missing or added. A quote of other words is no act's.
//
// The matching is bounded (the depth release's late security review, S5, and its final one, F3): a
// quote and a message are the GM's and the player's to make as long as they like, and the worker
// every user shares runs one task at a time. A quote of more than an act's own words
// (QUOTE_WORDS_MOST) is refused unmatched; each text is read once; a quote is matched only near where
// its rarest words stand in the text, within a work budget (QUOTE_CELLS_MOST), and one whose words
// stand too often for that is refused unmatched; a beat or an action holds at most
// QUOTES_PER_BEAT_MOST quotes and an answer QUOTES_PER_ANSWER_MOST, the rest refused unmatched; and
// each quote gives way to the work already waiting first, then stops if the reply has.

/** Pronouns and possessives: any of them may stand for another in a quote, as a model writes "his" for the player's "my". */
const PRONOUNS: ReadonlySet<string> = new Set("i me my mine myself you your yours yourself yourselves he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves".split(" "));

/** One word of a text, as a quote is held to it: its stem, whether it is a pronoun, and where it stands in the text. */
interface QuoteWord {
  stem: string;
  pronoun: boolean;
  from: number;
  to: number;
}

/** A word's stem, as its inflections share it: "roll", "rolls", "rolled" and "rolling" are "rol"; "take", "takes" and "taking" are "tak". */
function stemOf(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else {
    const end = ["ing", "ed", "es", "s", "e"].find((e) => w.length - e.length >= 3 && w.endsWith(e));
    if (end) w = w.slice(0, -end.length);
  }
  // A doubled last consonant ("getting", "gett") is the stem's own ("get").
  const last = w.slice(-1);
  return w.length >= 4 && last === w.slice(-2, -1) && !"aeiou".includes(last) ? w.slice(0, -1) : w;
}

/** The most words a quote holds: an act's own words are a few lines, and a quote of more isn't held to a text at all. */
export const QUOTE_WORDS_MOST = 120;

/** The most places a quote's rarest words may stand in a text for it to be matched near them: more, and they stand too often to hold it to them. */
const QUOTE_REACHES_MOST = 1 << 14;

/** The most work holding one quote to its texts may take: cells of its edit distance (each quote word against each text word it is laid along), a few tens of milliseconds' worth. */
const QUOTE_CELLS_MOST = 1 << 22;

/** The most quotes held to the texts for one beat or action, and for one answer: as ACTION_QUEUE_LIMIT caps an answer's actions, these cap what holding its quotes may cost. */
export const QUOTES_PER_BEAT_MOST = 8;
export const QUOTES_PER_ANSWER_MOST = 32;

/** The words of `text`, as a quote is held to them: letters and digits, with an apostrophe inside a word, lowercase, accents and quote marks aside. Null once there are more than `most`, read no further. */
function quoteWords(text: string, most = Infinity): QuoteWord[] | null {
  const out: QuoteWord[] = [];
  for (const m of text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’‘ʼ][\p{L}\p{M}\p{N}]+)*/gu)) {
    if (out.length === most) return null;
    const from = m.index ?? 0;
    // Accents and curly quote marks are only where a word has a character past ASCII.
    const plain = /[^\x00-\x7f]/.test(m[0]) ? m[0].normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[’‘ʼ]/g, "'") : m[0].toLowerCase();
    // A possessive's or a contraction's ending is the word's own: "he's" is "he", "Danny's" is "danny".
    const base = plain.replace(/'(s|m|re|ve|ll|d)$/, "");
    out.push({ stem: stemOf(base), pronoun: PRONOUNS.has(base), from, to: from + m[0].length });
  }
  return out;
}

/** A text quotes are held to, its words read once: each word's stem as a number (the same for the same stem), whether it is a pronoun, and where each stem and each pronoun stands. */
interface QuoteText {
  text: string;
  words: QuoteWord[];
  stems: Int32Array;
  pronoun: Uint8Array;
  at: Map<string, { id: number; at: number[] }>;
  pronouns: number[];
}

function quoteText(text: string): QuoteText {
  const words = quoteWords(text) ?? [];
  const stems = new Int32Array(words.length);
  const pronoun = new Uint8Array(words.length);
  const at = new Map<string, { id: number; at: number[] }>();
  const pronouns: number[] = [];
  for (const [j, w] of words.entries()) {
    let stem = at.get(w.stem);
    if (!stem) at.set(w.stem, (stem = { id: at.size, at: [] }));
    stem.at.push(j);
    stems[j] = stem.id;
    if (w.pronoun) {
      pronoun[j] = 1;
      pronouns.push(j);
    }
  }
  return { text, words, stems, pronoun, at, pronouns };
}

/** Texts quotes are held to, each read when a quote is first held to them (`quoteText`), then kept for every other quote. */
function quoteTexts(texts: readonly string[]): () => readonly QuoteText[] {
  let read: QuoteText[] | null = null;
  return () => (read ??= texts.map(quoteText));
}

/**
 * Where the quote's words `q` are in `t`, near enough (above): the stretch of the text it matches,
 * as the text has it, or null, with the work it took (`cells`); or null where that work would pass
 * `budget`. Its words are laid in order along a stretch of the text's at the fewest changes (a word
 * not the same, one missing, one added: an edit distance over words, from any word of the text to
 * any), at most one change for every four words of the quote. A stretch that close keeps at least
 * one of any `most` + 1 of the quote's words as they are, each one not kept being a change, and lies
 * within `most` words of where that one stands as the quote has it: so only the text near where the
 * quote's rarest `most` + 1 words stand is matched, every such stretch of it in one go, and what is
 * found is what matching the whole text would find. Where those words stand in more places than
 * QUOTE_REACHES_MOST, or the stretches near them take more than `budget` to match, they stand too
 * often in the text to hold the quote to them, and it isn't matched at all.
 */
function quotedIn(q: readonly QuoteWord[], t: QuoteText, budget: number): { span: string | null; cells: number } | null {
  const n = q.length;
  const m = t.words.length;
  if (n === 0 || m === 0) return { span: null, cells: 0 };
  const most = Math.floor(n / 4);
  const ids = q.map((w) => t.at.get(w.stem)?.id ?? -1);
  const standing = q.map((w) => (t.at.get(w.stem)?.at.length ?? 0) + (w.pronoun ? t.pronouns.length : 0));
  const anchors = [...q.keys()].sort((a, b) => (standing[a] ?? 0) - (standing[b] ?? 0)).slice(0, most + 1);
  const places = anchors.reduce((sum, i) => sum + (standing[i] ?? 0), 0);
  if (places > QUOTE_REACHES_MOST) return null;
  // Each place an anchor stands reaches from `most` words before where the quote would start there to `most` words past its end; the stretches matched are where those reaches meet or touch.
  const starts = new Int32Array(places);
  let placed = 0;
  for (const i of anchors) {
    for (const j of t.at.get(q[i]?.stem ?? "")?.at ?? []) starts[placed++] = j - i - most;
    if (q[i]?.pronoun) for (const j of t.pronouns) starts[placed++] = j - i - most;
  }
  starts.sort();
  const stretches: [number, number][] = [];
  for (const s of starts) {
    const from = Math.max(0, s);
    const to = Math.min(m, s + n + 2 * most);
    const before = stretches.at(-1);
    if (before !== undefined && from <= before[1]) before[1] = Math.max(before[1], to);
    else stretches.push([from, to]);
  }
  const cells = n * stretches.reduce((sum, [from, to]) => sum + to - from, 0);
  if (cells > budget) return null;
  let end = -1;
  let least = most + 1;
  let begins = 0;
  // Over the stretch of words from..to: cost[k], the fewest changes by which the quote's words so far end before its word k; start[k], the word that stretch starts at.
  const match = (from: number, to: number): void => {
    const span = to - from;
    let cost = new Int32Array(span + 1);
    let start = Int32Array.from({ length: span + 1 }, (_, k) => from + k);
    let c = new Int32Array(span + 1);
    let s = new Int32Array(span + 1);
    for (const [i, w] of q.entries()) {
      const id = ids[i] ?? -1;
      c[0] = (cost[0] ?? 0) + 1;
      s[0] = from;
      for (let k = 1; k <= span; k++) {
        const x = from + k - 1;
        const same = t.stems[x] === id || (w.pronoun && t.pronoun[x] === 1);
        const kept = (cost[k - 1] ?? 0) + (same ? 0 : 1);
        const missing = (cost[k] ?? 0) + 1;
        const added = (c[k - 1] ?? 0) + 1;
        if (kept <= missing && kept <= added) {
          c[k] = kept;
          s[k] = start[k - 1] ?? 0;
        } else if (missing <= added) {
          c[k] = missing;
          s[k] = start[k] ?? 0;
        } else {
          c[k] = added;
          s[k] = s[k - 1] ?? 0;
        }
      }
      [cost, c] = [c, cost];
      [start, s] = [s, start];
    }
    for (let k = 1; k <= span; k++) {
      const v = cost[k] ?? least;
      if (v < least) {
        end = from + k;
        least = v;
        begins = start[k] ?? end;
      }
    }
  };
  for (const [from, to] of stretches) match(from, to);
  const first = end > 0 ? t.words[begins] : undefined;
  const last = end > 0 ? t.words[end - 1] : undefined;
  return { span: first && last && first.from < last.to ? t.text.slice(first.from, last.to) : null, cells };
}

/** Holding an answer's quotes to the texts: how many more it may hold (QUOTES_PER_ANSWER_MOST), and the stop it honours. */
interface Holding {
  left: number;
  signal?: AbortSignal;
}

function holdingFor(signal: AbortSignal | undefined): Holding {
  return { left: QUOTES_PER_ANSWER_MOST, ...(signal ? { signal } : {}) };
}

/**
 * The words a reading quotes in field `v` (one text, or a list of them, as DeepSeek writes quotes),
 * each held to `texts` (`quotedIn`): the stretch of them each matches, as they have it; or, where one
 * isn't in any of them, quotes more than an act's own words (`QUOTE_WORDS_MOST`), uses words that
 * stand too often in them to match near them, is past the most quotes held (`QUOTES_PER_BEAT_MOST`
 * of this field's, `holding`'s of the answer's), or it quotes none, why, as the reading is said back:
 * "“roll out of bed” isn't in your words". Each quote gives way to the work already waiting before it
 * is matched (`giveWay`), then stops if the reply has.
 */
async function heldTo(v: unknown, texts: () => readonly QuoteText[], whose: string, holding: Holding): Promise<{ spans: string[] } | { why: string }> {
  const cited = (Array.isArray(v) ? v : [v]).flatMap((x) => text(x) ?? []);
  if (cited.length === 0) return { why: `it quotes none of ${whose}` };
  const spans: string[] = [];
  const missing: string[] = [];
  const long: string[] = [];
  const often: string[] = [];
  const past: string[] = [];
  for (const [k, q] of cited.entries()) {
    // Past the most a beat or the answer holds: refused unmatched, as an over-long quote is, said back by its first words.
    if (k >= QUOTES_PER_BEAT_MOST || holding.left <= 0) {
      const first = q.split(/\s+/);
      past.push(`“${first.slice(0, 12).join(" ")}${first.length > 12 ? " …" : ""}”`);
      continue;
    }
    holding.left -= 1;
    await giveWay();
    holding.signal?.throwIfAborted();
    const words = quoteWords(q, QUOTE_WORDS_MOST);
    if (words === null) {
      // Said back by its first words: it is longer than any act's.
      long.push(`“${q.split(/\s+/).slice(0, 12).join(" ")} …”`);
      continue;
    }
    // One budget for the quote, however many texts it is held to.
    let budget = QUOTE_CELLS_MOST;
    let span: string | null = null;
    let common = false;
    for (const t of texts()) {
      const held = quotedIn(words, t, budget);
      if (held === null) {
        common = true;
        break;
      }
      budget -= held.cells;
      if ((span = held.span) !== null) break;
    }
    if (span !== null) spans.push(span);
    else if (common) often.push(`“${q}”`);
    else missing.push(`“${q}”`);
  }
  const why = [
    ...(long.length > 0 ? [`${long.join(" and ")} ${long.length === 1 ? "quotes" : "quote"} more than an act's own words`] : []),
    ...(past.length > 0 ? [`${past.join(" and ")} ${past.length === 1 ? "is" : "are"} past the most quotes held (${QUOTES_PER_BEAT_MOST} a beat, ${QUOTES_PER_ANSWER_MOST} an answer)`] : []),
    ...(often.length > 0 ? [`${often.join(" and ")} ${often.length === 1 ? "uses" : "use"} words that stand too often in ${whose} to be held to it`] : []),
    ...(missing.length > 0 ? [`${missing.join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} in ${whose}`] : []),
  ];
  return why.length === 0 ? { spans } : { why: why.join("; ") };
}

// ------------------------------------------------------------------ the rules' words

/** A check as rolled, in the GM's words: what was rolled against what, and how it fell. */
function checkWords(res: Resolution): string {
  const c = res.check;
  if (!c) return "";
  const against = c.dc !== null ? ` against ${c.dc}` : "";
  return `${c.check.id} check (${c.notation}${against}): rolled ${c.total}${c.natural !== null ? `, the die showing ${c.natural}` : ""}, ${res.outcome ?? "no outcome"}`;
}

/** One resolution as the GM reads it, out of world: what was tried by whom, how the rules decided it, what it took, and every change it made (secrets included). */
function resolutionLine(reg: Registry, world: WorldDoc, after: Readonly<WorldState>, res: Resolution, i: number): string {
  const label = res.told?.what ?? res.inferred?.label ?? findAction(reg, world, res.action)?.label ?? res.action;
  const parts: string[] = [];
  const why = res.failed?.words ?? res.failed?.reason ?? "the rules held it back";
  if (!res.ok) parts.push(res.roleplay ? `the rules couldn't play it as things stand (${why}), so it is his own roleplay and changes nothing the rules keep` : `it failed: ${why}`);
  if (res.check) parts.push(checkWords(res));
  else if (res.adjudged && !res.adjudged.rolled) parts.push(`no roll (${res.adjudged.why ?? "the policy decided"}): ${res.outcome ?? "no outcome"}`);
  else if (res.ok && res.outcome !== null && res.outcome !== "default") parts.push(`outcome: ${res.outcome}`);
  if (res.adjudged?.approach) parts.push(`the approach rated ${res.adjudged.approach.rating} of ${res.adjudged.approach.max}${res.adjudged.approach.reason ? ` (${res.adjudged.approach.reason})` : ""}`);
  if (res.adjudged?.close) parts.push(`a close call: ${Math.abs(res.adjudged.close.points)} points from ${res.adjudged.close.outcome}`);
  if (res.inferred) {
    for (const a of res.inferred.against) parts.push(`${a.name} resisted with ${a.score}${a.rolled ? " rolled" : ""}`);
    for (const c of res.inferred.companions) parts.push(`${c.name} rolled ${c.total}: ${c.outcome}`);
  }
  if (res.rejected.length > 0) parts.push(`not done: ${res.rejected.map((r) => r.rejection.reason).join("; ")}`);
  if (res.ok && res.duration > 0) parts.push(`it took ${spanText(res.duration)}`);
  const changes = authorLines(reg, world, after, res.events, 8);
  return `${i + 1}. ${label}, by ${named(world, after, res.actor)}: ${parts.join("; ") || "done"}${changes.length > 0 ? `. What changed: ${changes.join("; ")}` : ""}`;
}

/** Whether the rules decided something an act's own words don't already say: a check, the policy's verdict, a failure, or part of it not done. */
function decided(res: Resolution): boolean {
  return res.check !== null || res.adjudged !== null || (!res.ok && res.roleplay !== true) || res.rejected.length > 0;
}

/** An outcome the GM's answer left out, told in the engine's own words: the rules decided it either way. */
function engineOutcome(reg: Registry, world: WorldDoc, after: Readonly<WorldState>, res: Resolution, i: number): GmBeatTexts {
  const who = own(after.entities, res.actor)?.name ?? res.actor;
  const label = res.told?.what ?? res.inferred?.label ?? findAction(reg, world, res.action)?.label ?? res.action;
  const how = !res.ok ? "it doesn't come off" : (res.outcome ?? "it is done");
  return { what: resolutionLine(reg, world, after, res, i).replace(/^\d+\. /, ""), surface: `${who}: ${label}: ${how}.`, about: [{ entity: res.actor }], uncertain: "The GM's answer left this outcome out; it is told in the engine's own words." };
}

// ------------------------------------------------------------------ the player's beats

export interface PlayerBeatsInput {
  registry: Registry;
  world: WorldDoc;
  /** The state after the engine run's events: what the GM reads the resolutions against. */
  state: Readonly<WorldState>;
  /** The player character (`povOf`, D-10). */
  pov: EntityId;
  /** His message, verbatim. */
  input: string;
  /** The scene playing, which the GM reads his words against (LIVE3 L3a-5): its beats so far as lines (`beatLine`, newest kept) and where everyone in it is; absent when none is, and his turn opens one. */
  scene?: { beats: readonly string[]; staging: readonly { who: EntityId; where: string; doing: string; occluded?: string }[] };
  /** The engine run's resolutions of the actions he picked from the engine's list (a palette or chip action), in order (`EngineTurnPlan.resolutions`): the run reads nothing else of his words on a depth turn. */
  resolutions: readonly Resolution[];
  /** The minutes the run let pass. */
  minutes?: number;
  texts?: PromptTexts;
  signal?: AbortSignal;
}

/** One of the player's beats as the GM writes it: his act, its outcome, or his inner life. */
export interface PlayerBeat extends GmBeatTexts {
  kind: "act" | "outcome" | "inner";
  act: BeatAct;
  actors: EntityId[];
  /** What its actors did and said, plainly, as they did it: each lives it as their own act (`reachOf`, LIVE3 L3a-4); only for a beat someone acts in. */
  deed?: string;
  addressed?: EntityId[];
  /** "player": his act or his inner life; "gm": an outcome the rules decided. */
  decided: "player" | "gm";
  /** An outcome: the resolution it tells, by its index in the input's `resolutions`. */
  resolution?: number;
  /** His act: what it tries to bring about that the world decides and no resolution tells, for the GM to resolve by the rules (`resolveAttempt`). */
  attempt?: string;
  /** His act or his inner life: the words of his message it rests on, as his message has them (the GM's quote of them, held to it: `heldTo`), one stretch after another; the act's own words, which what it attempts is read from. */
  words?: string;
  /** His inner life: a beat no one but him perceives. */
  inner?: true;
}

export interface PlayerBeatsOut extends StageCost {
  beats: PlayerBeat[];
  /** His out-of-character lines, verbatim: the player's signals (§4.5), never beats. */
  signals: string[];
  /** What of the answer wasn't kept, with why, for the thinking block: what an act of his attempts, where the act quotes no words of his message or words it doesn't hold (the act itself is kept). */
  refused: string[];
  usage: PortUsage;
}

/** Everyone at a place, out of world: the people there, by name and id. */
function peopleAt(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, place: string | null): EntityId[] {
  if (place === null) return [];
  return Object.keys(state.entities)
    .filter((id) => {
      const e = own(state.entities, id);
      return e !== undefined && kindIs(reg, world, e.kind, "person") && !isGone(state, id) && placeOfEntity(state, id) === place;
    })
    .sort();
}

/**
 * The player's own beats (§1.3, §4.2): the GM reads what he wrote against the scene so far, beside
 * how today's engine run resolved the actions he picked from its list, and writes his acts and words
 * as he wrote them (his exact words aloud as quotes), each picked action's outcome as the rules
 * decided it, what else an act of his attempts (for `resolveAttempt`, §5.2 "the player's action at
 * setup"), and his inner life as a beat no one but him perceives; his out-of-character lines come
 * back as signals. Each beat of his own quotes the words of his message it rests on, held to it
 * (`heldTo`): the act's own words, which what it attempts is read from (LIVE3 L3a-5). A beat of his
 * is his whatever its quote (the late correctness review, finding 1): one that quotes none of his
 * message, or words it doesn't hold (a model's tidying of his spelling among them), is kept with no
 * words, and what it attempts isn't read, said. An outcome the rules decided that the answer leaves
 * out is still told, in the engine's words, marked uncertain. An answer that isn't one JSON object
 * fails closed (`DepthAnswerError`).
 */
export async function playerBeats(model: ModelPort, input: PlayerBeatsInput): Promise<PlayerBeatsOut> {
  const { registry: reg, world, state, pov } = input;
  const here = placeOfEntity(state, pov);
  const people = peopleAt(reg, world, state, here);
  const scene = input.scene;
  const data = [
    `The player character: ${named(world, state, pov)}${here ? `, at ${named(world, state, here)}` : ""}.`,
    ...(scene
      ? [
          `The scene so far (each beat opens with its id):\n${scene.beats.join("\n") || "- (nothing yet)"}`,
          `Where everyone in it is:\n${scene.staging.map((s) => `- ${named(world, state, s.who)}: ${s.where}; ${s.doing}${s.occluded ? `; can't see or hear: ${s.occluded}` : ""}`).join("\n") || "- (no one is staged)"}`,
        ]
      : ["No scene is playing: his turn opens one."]),
    `What the player wrote, verbatim:\n${input.input}`,
    `How the rules resolved the actions he picked from the engine's list, in order (cite one by its number):\n${input.resolutions.map((r, i) => resolutionLine(reg, world, state, r, i)).join("\n") || "None: he picked none, so what his acts attempt is yours to name."}`,
    ...(input.minutes !== undefined && input.minutes > 0 ? [`Time the turn let pass: ${spanText(input.minutes)}.`] : []),
    `Who is here (name each by the id given):\n${people.map((id) => `- ${named(world, state, id)}${id === pov ? ": the player character" : ""}`).join("\n") || "- no one but him"}`,
  ].join("\n\n");
  const asked = await askRole(model, "gm", SCENE_GM_TEXT.player, { world, state, texts: input.texts ?? {}, data, ...(input.signal ? { signal: input.signal } : {}) });
  const beats: PlayerBeat[] = [];
  const refused: string[] = [];
  const told = new Set<number>();
  const message = quoteTexts([input.input]);
  const holding = holdingFor(input.signal);
  for (const [i, raw] of list(asked.answer.beats).entries()) {
    const b = record(raw);
    const what = text(b?.what);
    const surface = text(b?.surface);
    if (!b || what === null || surface === null) continue;
    const kind = b.kind === "outcome" || b.kind === "inner" ? b.kind : "act";
    // His act, his words or his inner life rests on words of his message: held to it, they are that act's own words, which what it attempts is read from.
    const held = kind === "outcome" ? null : await heldTo(b.words, message, "your message", holding);
    // A beat of his is kept whatever its quote: one whose words his message doesn't hold has none, and what it attempts isn't read from them.
    const unheld = held && "why" in held ? held.why : null;
    const tried = kind === "act" ? text(b.attempt) : null;
    if (unheld !== null) {
      asked.read.drop(`beats[${i}].words`, b.words, unheld);
      if (tried !== null) {
        refused.push(`“${surface}” stands, but not what it attempts (“${tried}”): ${unheld}`);
        asked.read.drop(`beats[${i}].attempt`, b.attempt, unheld);
      }
    }
    const n = typeof b.resolution === "number" && Number.isInteger(b.resolution) ? b.resolution - 1 : -1;
    const resolution = kind === "outcome" && n >= 0 && n < input.resolutions.length ? n : undefined;
    if (resolution !== undefined) told.add(resolution);
    const actors = peopleOf(state, b.actors);
    const act: BeatAct = typeof b.act === "string" && (BEAT_ACTS as readonly string[]).includes(b.act) ? (b.act as BeatAct) : kind === "outcome" ? "happened" : "did";
    const addressed = peopleOf(state, b.addressed).filter((id) => id !== pov);
    const quotes = spoken(b.quotes) || null;
    const uncertain = text(b.uncertain);
    const attempt = unheld === null ? tried : null;
    const who = kind === "outcome" ? actors : actors.length > 0 ? actors : [pov];
    // What its actors did and said as they did it, which each lives as their own act: a beat no one acts in has none.
    const deed = who.length > 0 ? text(b.deed) : null;
    beats.push({
      kind,
      act,
      actors: who,
      ...(addressed.length > 0 ? { addressed } : {}),
      what,
      ...(deed !== null ? { deed } : {}),
      surface,
      ...(quotes !== null ? { quotes } : {}),
      ...(attempt !== null ? { attempt } : {}),
      ...(held && "spans" in held ? { words: held.spans.join(" … ") } : {}),
      about: aboutOf(world, state, b.about),
      decided: kind === "outcome" ? "gm" : "player",
      ...(resolution !== undefined ? { resolution } : {}),
      ...(kind === "inner" ? { inner: true as const } : {}),
      ...(uncertain !== null ? { uncertain } : {}),
    });
  }
  // Every outcome the rules decided is a beat, told after the last beat before it.
  input.resolutions.forEach((res, i) => {
    if (told.has(i) || !decided(res)) return;
    beats.push({ kind: "outcome", act: "happened", actors: [], decided: "gm", resolution: i, ...engineOutcome(reg, world, state, res, i) });
  });
  const signals = list(asked.answer.signals).flatMap((v) => text(v) ?? []);
  return { beats, signals, refused, ...(asked.reasoning ? { reasoning: asked.reasoning } : {}), usage: addUsage(NO_USAGE, asked.usage) };
}

// ------------------------------------------------------------------ an attempt in the scene

export interface AttemptInput {
  registry: Registry;
  world: WorldDoc;
  /** The scene's state at this moment: the turn's working state with every beat's events before this one applied. */
  state: Readonly<WorldState>;
  /** The act as decided: who, what there was to sense of it and its words, what they try (a character's `PlayAct.attempt`), and for the player character his own words for it (the words of his message it rests on: `PlayerBeat.words`), never the rest of his message. Each action the GM reads it as quotes these, the act's own words: his own where given, else its surface, words and attempt. */
  act: { actor: EntityId; surface: string; quotes?: string; attempt?: string; input?: string };
  /** Draws for this beat: the turn's seed with the beat's id (`hashParts(seed, beat)`). */
  seed: string;
  runSeed: string;
  /** The scene's beats so far as lines (`beatLine`), for the GM's context. */
  scene?: readonly string[];
  texts?: PromptTexts;
  signal?: AbortSignal;
}

/** The GM's read of an act: the engine actions it plays as, in order, the judged approach, or none and why; and what was refused of it as a misread (no action by that id, one whose quote isn't the act's own words, a param that names nothing). */
export interface AttemptRead {
  actions: { action: ActionId; params: JsonObject; text?: string }[];
  judgement?: Judgement;
  none?: string;
  dropped: { action: string; why: string }[];
}

export interface AttemptOut extends StageCost {
  read: AttemptRead;
  /** How the rules resolved each action it played, in order; the queue stops at a check or a failure, as a turn's does. */
  resolutions: Resolution[];
  /** The world's changes, in fold order: materialization, effects, the rules and tracks they fired. */
  events: LedgerEvent[];
  /** The scene's state after them. */
  state: WorldState;
  /** Minutes the actions took: the scene's clock moves by them only as the scene says. */
  minutes: number;
  /** The outcome beat's texts (decided "gm"); null when the rules left nothing the act didn't already say. */
  outcome: GmBeatTexts | null;
  usage: PortUsage;
}

/** Codes of a read the engine can't play (no such action, a param it lacks or that names nothing fitting): the GM's misread, never an outcome of the story. */
const MISREADS: Readonly<Record<string, true>> = { unknown_action: true, missing_actor: true, missing_param: true, bad_param: true };

/**
 * The actions the rules have for `actor` now, as the intent reader's catalog offers them to the player
 * character (`interpretCatalog`), read from the actor's own standing: its params' candidates, its
 * places, what it may act for. The GM is out of world, so nothing is withheld from it. While the
 * chat infers checks, Try something stands in for the world's own skill actions. Never a time skip:
 * time in a scene is the scene's.
 */
function gmCatalog(reg: Registry, asActor: WorldDoc, state: Readonly<WorldState>): { entries: CatalogEntry[]; checks: Map<string, string[]>; named: EntityId[]; places: string[] } {
  const all = [...reg.actions.values(), ...Object.values(asActor.actions)].filter((a) => offersAction(asActor, a));
  const inferred = inferredOf(asActor, state);
  const sources = skillSources(reg, asActor, state);
  const skills = allowedSkills(inferred, sources);
  const trying = inferred.mode !== "off" && skills.length > 0;
  const offered = interpretCatalog(reg, asActor, state, trying ? all.filter((a) => !rolledByTry(a, sources)) : all, () => true);
  const checks = new Map<string, string[]>();
  for (const { action } of offered.entries) if (checkOf(asActor, action.check) !== null) checks.set(action.id, Object.keys(action.outcomes));
  const entries = [...offered.entries.map((o) => o.entry), ...(trying ? [tryEntry(inferred, skills)] : [])];
  if (trying) checks.set(TRY_ACTION, ["success", "failure"]);
  const places = placeCandidates(reg, asActor, state).map((id) => `- ${id}: ${own(asActor.places, id)?.name ?? id}`);
  return { entries, checks, named: offered.named, places };
}

/** How the chat decides checks, as the GM rates an approach. */
function policyWords(world: WorldDoc, state: Readonly<WorldState>): string {
  const p = policyOf(world, state);
  const who = p.authority === "narrative" ? "the story decides a check from your odds of each outcome (the dice decide without them)" : p.authority === "hybrid" ? "the dice decide, and a close roll may cost something or give partial progress" : "the dice decide";
  const approach = p.description.weight === "none" ? "the approach doesn't count: give no judgement" : `rate the approach from 0 to ${p.description.max}`;
  return `${who}; ${approach}.`;
}

/**
 * An attempt in the scene (§5.2 "GM, resolution"): the GM reads the act against the actions the
 * rules have for its actor, as `interpret` and `judge` read the player's words; the engine resolves
 * what it read on the scene's state, in order, each against the state the one before it left, the
 * queue stopping at a check or a failure (the actor sees how it fell first); then the world's rules
 * and tracks hear what changed. When the rules decided something the act didn't already say, the GM
 * writes the outcome beat. A read the engine can't play (no such action, a param naming nothing) is
 * dropped as the GM's misread, never told as the story's outcome, and so is an action whose quote of
 * the act's own words isn't in them (`heldTo`; LIVE3 L3a-5): the player character's own words for
 * the act where given, else its surface, words and attempt. Requirements hold whoever acts: a
 * character acts from what it believes, and the world answers.
 */
export async function resolveAttempt(model: ModelPort, input: AttemptInput): Promise<AttemptOut> {
  const { registry: reg, world, state, act } = input;
  const texts = input.texts ?? {};
  const signal = input.signal ? { signal: input.signal } : {};
  // The actor's own standing: its catalog, and an inferred check it rolls, read as the engine reads the player character's (the engine reads the doc's own pov as `self`).
  const asActor: WorldDoc = act.actor === world.pov ? world : { ...world, pov: act.actor };
  // The player character is the one the player plays now (`povOf`, D-10): after Play as, not the world's own.
  const pc = povOf(world, state);
  const catalog = gmCatalog(reg, asActor, state);
  const name = own(state.entities, act.actor)?.name ?? act.actor;
  const lines = catalog.entries.map((e) => {
    const outcomes = catalog.checks.get(e.id);
    return `- ${e.id}: ${e.label}${e.description ? `: ${e.description}` : ""}. Params: ${e.params.join("; ") || "none"}.${e.needs.length > 0 ? ` Needs: ${e.needs.join("; ")}.` : ""}${outcomes ? ` Rolls a check (outcomes: ${outcomes.join(" | ") || "as its check reads"}).` : ""}`;
  });
  const data = [
    ...(input.scene && input.scene.length > 0 ? [`The scene so far (each beat opens with its id):\n${input.scene.join("\n")}`] : []),
    [
      `The act, by ${named(world, state, act.actor)}${act.actor === pc ? ", the player character" : ""}:`,
      `What there was to sense: ${act.surface}`,
      ...(act.quotes ? [`Words said: ${act.quotes}`] : []),
      ...(act.attempt ? [`What they try to bring about: ${act.attempt}`] : []),
      ...(act.input ? [`The player's own words for this act: ${act.input}`] : []),
    ].join("\n"),
    `What ${name} can do now, by the rules (each action by its id; name params by the ids given):\n${lines.join("\n") || "- nothing the rules list"}`,
    ...(catalog.named.length > 0 ? [`Who and what the actions name:\n${catalog.named.map((id) => `- ${named(world, state, id)}`).join("\n")}`] : []),
    ...(catalog.places.length > 0 ? [`The places a place param may name:\n${catalog.places.join("\n")}`] : []),
    `How checks are decided here: ${policyWords(world, state)}`,
  ].join("\n\n");
  const asked = await askRole(model, "gm", SCENE_GM_TEXT.resolve, { world, state, texts, data, ...signal });
  let usage = addUsage(NO_USAGE, asked.usage);
  const reasoning = asked.reasoning ? [asked.reasoning] : [];

  const known = new Set(catalog.entries.map((e) => e.id));
  // The act's own words, which each action it plays as quotes: the player character's own for it, else what there was to sense, its words and what they try.
  const acted = quoteTexts(act.input ? [act.input] : [act.surface, act.quotes ?? "", act.attempt ?? ""]);
  const holding = holdingFor(input.signal);
  const whose = act.input ? "your words" : `${possessive(name)} act`;
  const read: AttemptRead = { actions: [], dropped: [] };
  for (const [i, raw] of list(asked.answer.actions).slice(0, ACTION_QUEUE_LIMIT).entries()) {
    const a = record(raw);
    const id = text(a?.action);
    if (!a || id === null) continue;
    if (!known.has(id)) {
      read.dropped.push({ action: id, why: "no such action for them now" });
      continue;
    }
    const held = await heldTo(a.words, acted, whose, holding);
    if ("why" in held) {
      read.dropped.push({ action: id, why: held.why });
      asked.read.drop(`actions[${i}]`, raw, held.why);
      continue;
    }
    const words = text(a.text);
    read.actions.push({ action: id, params: (record(a.params) ?? {}) as JsonObject, ...(words !== null ? { text: words } : {}) });
  }
  const j = record(asked.answer.judgement);
  if (j && typeof j.rating === "number" && Number.isFinite(j.rating)) {
    const outcomes = record(j.outcomes);
    const odds = outcomes ? Object.fromEntries(Object.entries(outcomes).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] >= 0)) : null;
    read.judgement = { rating: Math.max(0, j.rating), reason: text(j.reason) ?? "", ...(odds && Object.keys(odds).length > 0 ? { outcomes: odds } : {}) };
  }
  const none = text(asked.answer.none);
  if (none !== null) read.none = none;

  const w = new Working(reg, world, state);
  const rng = createRng(input.seed);
  const resolutions: Resolution[] = [];
  // The judged approach rides on the first action whose check it rates, as a turn's does.
  const judged = read.actions.findIndex((s) => catalog.checks.has(s.action));
  let minutes = 0;
  for (const [i, step] of read.actions.entries()) {
    const draws = i === 0 ? rng : rng.fork(`queue:${i}`);
    const seed = i === 0 ? input.seed : hashParts(input.seed, "queue", i);
    const opts = { runSeed: input.runSeed, ...(i === judged && read.judgement ? { judgement: read.judgement } : {}) };
    const mark = w.events.length;
    const def = step.action === TRY_ACTION ? undefined : findAction(reg, w.world, step.action);
    // Its picks in words as they stand before it plays, so a thing it hands over or uses up is still named.
    const picks = def ? actionWords(reg, w.world, w.state, def, step.params) : "";
    let res: Resolution;
    if (step.action === TRY_ACTION) {
      const verdict = inferredRead(reg, asActor, w.state, step.params);
      if (!verdict.ok) {
        read.dropped.push({ action: step.action, why: verdict.why });
        continue;
      }
      // Rolled from the actor's own standing, then made the scene's: each change is checked again on its state, all or nothing.
      const before = w.mark();
      res = resolveTry(reg, new Working(reg, asActor, w.state), verdict.params, draws, { ...opts, heard: [act.surface, act.quotes ?? "", act.input ?? ""].join("\n") });
      let refused: Rejection | null = null;
      for (const e of res.events) if ((refused = w.apply(e)) !== null) break;
      if (refused) {
        w.restore(before);
        read.dropped.push({ action: step.action, why: refused.reason });
        break;
      }
      res = { ...res, events: w.events.slice(mark) };
    } else {
      res = resolveAction(reg, w, { action: step.action, actor: act.actor, params: step.params }, draws, opts);
      if (!res.ok && hasOwn(MISREADS, res.failed?.code ?? "")) {
        read.dropped.push({ action: step.action, why: res.failed?.reason ?? "the engine couldn't read it" });
        continue;
      }
      if (def) res = { ...res, told: { what: picks !== "" ? `${def.label} (${picks})` : def.label, changes: [], minutes: res.duration } };
    }
    const done = w.events.slice(mark);
    if (done.length > 0) runRulesOnEvents(reg, w, done, { seed });
    stepTracks(reg, w, hashParts(seed, "tracks"));
    resolutions.push(res);
    if (res.ok) minutes += res.duration;
    if (decided(res)) break;
  }

  let outcome: GmBeatTexts | null = null;
  const telling = resolutions.findIndex(decided);
  if (telling >= 0) {
    const told = await askRole(model, "gm", SCENE_GM_TEXT.outcome, {
      world,
      state: w.state,
      texts,
      data: [`The act, by ${named(world, state, act.actor)}:\nWhat there was to sense: ${act.surface}${act.quotes ? `\nWords said: ${act.quotes}` : ""}${act.attempt ? `\nWhat they tried to bring about: ${act.attempt}` : ""}`, `How the rules resolved it, in order:\n${resolutions.map((r, i) => resolutionLine(reg, world, w.state, r, i)).join("\n")}`].join("\n\n"),
      ...signal,
    });
    usage = addUsage(usage, told.usage);
    if (told.reasoning) reasoning.push(told.reasoning);
    const what = text(told.answer.what);
    const surface = text(told.answer.surface);
    const quotes = spoken(told.answer.quotes) || null;
    const res = resolutions[telling];
    outcome =
      what !== null && surface !== null
        ? { what, surface, ...(quotes !== null ? { quotes } : {}), about: aboutOf(world, w.state, told.answer.about, [act.actor]) }
        : res
          ? engineOutcome(reg, world, w.state, res, telling)
          : null;
  }
  return { read, resolutions, events: [...w.events], state: w.state, minutes, outcome, ...(reasoning.length > 0 ? { reasoning: reasoning.join("\n\n") } : {}), usage };
}

/** The draws an attempt takes in a turn: the turn's action seed with the beat the attempt resolves, so each beat rolls its own and a Re-run rolls again. */
export function attemptSeed(turnSeed: string, beat: string): string {
  return hashParts(turnSeed, "attempt", beat);
}
