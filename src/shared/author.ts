// The author's records beside its notebook (DEPTH-PLAN §4.5, §5.2, §6.4): events of the `author` pack,
// each landing as a basis-anchored layer entry at the reply it read (§4.9), so a swipe of that reply
// takes them with it and a switch back brings them back.
//
//   author.poll     after each turn: what the author considered, whether it raised it and why (the
//                   log GM → Notebook shows), and the jobs it asked for now (who catches up, who
//                   reflects, its own reflection)
//   author.predict  at a reflection's end: what it predicts the player and the key characters will
//                   do next, each its own record, scored later as a test of its own understanding
//   author.score    a later poll's or reflection's verdict on a prediction, against what happened
//   author.drift    a reflection's check of a character's arc (in the notebook) against who the
//                   character has become (in its own mind), with what the author makes of it
//   author.edit     the player's edit of a reply as the author read it (his directive, §1.3): the
//                   reply as he made it, and the beats it amended and struck, or that it was
//                   cosmetic and amended nothing
//   author.spend    what a piece of work cost (§4.7), stored with the work it paid for: the turn's
//                   record, or the layer entry its job landed (a draft, a settlement, a drop, the
//                   step after a reply), so it folds wherever that work does and a swipe that
//                   discards a turn gives back what it spent, and nothing else
//   author.ask      an episode the poll opened that wants a treatment this story interval's
//                   allowance has spent, held for the player because the author judged the moment
//                   major (§6.5, D-7: "ask me"): the episode whole, the parts past their allowance
//   author.answer   the player's answer to an ask: spend one more, or draft it down the ladder
//
// They change no world state and validate structurally, like the narrative record's events; texts a
// reader shows are words, bounded. Pure.

import { DEPTH_ROLES, DEPTH_TREATMENTS, type DepthRole, type DepthTreatment } from "./depth-settings";
import { hashParts } from "./hash";
import type { EntityId, MessageId, PlaceId } from "./ids";
import { isRecord, type JsonObject } from "./json";
import type { PackEvent } from "./ledger";
import { isBlobHash } from "./stores";
import type { BlobRef } from "./story";

export const AUTHOR_POLL = "author.poll";
export const AUTHOR_PREDICT = "author.predict";
export const AUTHOR_SCORE = "author.score";
export const AUTHOR_DRIFT = "author.drift";
export const AUTHOR_EDIT = "author.edit";
export const AUTHOR_SPEND = "author.spend";
export const AUTHOR_ASK = "author.ask";
export const AUTHOR_ANSWER = "author.answer";
export const AUTHOR_ADOPT = "author.adopt";

/** The author's record types, which change no world state. */
export const AUTHOR_EVENTS: readonly string[] = [AUTHOR_POLL, AUTHOR_PREDICT, AUTHOR_SCORE, AUTHOR_DRIFT, AUTHOR_EDIT, AUTHOR_SPEND, AUTHOR_ASK, AUTHOR_ANSWER, AUTHOR_ADOPT];

/** The longest words a record keeps in one field, in characters; the author's whole thinking rides with the entry's reasoning. */
export const AUTHOR_WORDS_MAX = 2000;

/**
 * One job the poll asks for now (§6.4): a character catches up or reflects, the author reflects itself
 * (at a scene's end, or a chapter's), and off screen (§4.6) an episode it opened is drafted (its
 * draft carries the episode whole), or a draft settles, drops or is rebased.
 */
export type PollJob =
  | { kind: "catchup"; who: EntityId; why: string }
  | { kind: "reflect"; who: EntityId; why: string }
  | { kind: "author.reflect"; depth: "scene" | "chapter"; why: string }
  | { kind: "episode"; episode: string; why: string }
  | { kind: "settle" | "drop" | "rebase"; draft: string; why: string };

export const POLL_JOB_KINDS = ["catchup", "reflect", "author.reflect", "episode", "settle", "drop", "rebase"] as const;

/** One thing the poll considered, raised or not, with its reason. */
export interface PollConsidered {
  what: string;
  raised: boolean;
  why: string;
}

/** `author.poll`'s data. */
export interface PollData {
  /** The latest message the poll read. */
  through: MessageId | null;
  considered: PollConsidered[];
  jobs: PollJob[];
  /** The author's short account of the poll, a blob. */
  note?: BlobRef;
  /** The story clock (in minutes) past which it asked to be woken, and why. */
  wake?: { at: number; why: string };
}

/** `author.predict`'s data: one prediction. */
export interface PredictData {
  /** Its id (`predictionId`), which a score names. */
  id: string;
  text: string;
  /** Whom it concerns: the player character, a character, or none named. */
  about: EntityId[];
  /** The reflection that made it: a scene's end or a chapter's. */
  from: "scene" | "chapter";
}

export const SCORE_OUTCOMES = ["hit", "miss", "partly"] as const;
export type ScoreOutcome = (typeof SCORE_OUTCOMES)[number];

/** `author.score`'s data: a prediction's verdict. */
export interface ScoreData {
  prediction: string;
  outcome: ScoreOutcome;
  note: string;
}

export const DRIFT_LEVELS = ["none", "some", "strong"] as const;
export type DriftLevel = (typeof DRIFT_LEVELS)[number];

/** `author.drift`'s data: one character's arc against who it has become. */
export interface DriftData {
  who: EntityId;
  drift: DriftLevel;
  /** What the author makes of it, and what it means to do through the world (it never writes a mind, D-11). */
  note: string;
}

/** `author.edit`'s data: the player's edit of a reply, as the author read it. */
export interface EditData {
  /** The reply he edited. */
  message: MessageId;
  /** The reply as he made it, a stored text: his next edit of it reads this as the reply was. */
  text: BlobRef;
  /** The author read it as cosmetic: it amends nothing. */
  cosmetic: boolean;
  /** What the author makes of it, in a line. */
  why: string;
  /** The beats it wrote in place of others, and the beats it struck, by id. */
  amended: string[];
  struck: string[];
}

/**
 * What a spend bought (§6.5): on screen, a turn's scene ("scene"), a settlement the player forced by
 * walking in on what a draft holds ("walk-on", its own line in the turn's budget), or the step after a
 * reply ("after"); off screen, an episode at its treatment (its leading part's), its settlement and
 * drop included. The lane follows: foreground, after the reply, background.
 */
export const SPEND_WORK = ["scene", "walk-on", "after", ...DEPTH_TREATMENTS] as const;
export type SpendWork = (typeof SPEND_WORK)[number];

export const SPEND_INTERVALS = ["day", "week", "month"] as const;

/** What work cost: its model calls, summed as the providers reported them. */
export interface SpendCost {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** The part of `tokensOut` spent reasoning, where the provider reports it apart. */
  reasoningOut?: number;
  /** Money, where the provider priced the calls. */
  money?: number;
}

/**
 * `author.adopt`'s data, in a turn's `pre` (DEPTH-PLAN §6.3, the adopt step of §2.3): the work
 * between turns this turn waited for before it read the fold (what it was and the message it read
 * through), and what it went on without because it wasn't ready in time. Nothing is marked adopted
 * anywhere else; the record is the citation.
 */
export interface AdoptData {
  waited: { what: string; message: string }[];
  without: { what: string; message: string }[];
  /** The layer entries it landed for the turn's read from what it waited for (`LedgerIO.adoptHeld`). */
  entries: string[];
}

/** `author.spend`'s data: what one piece of work cost, with what it bought and when. */
export interface SpendData {
  treatment: SpendWork;
  /** The story interval it counts in, as the budget dial set it then (§6.5): its unit and its first story minute. */
  interval: { unit: (typeof SPEND_INTERVALS)[number]; from: number };
  cost: SpendCost;
  /** The same, per depth role that spent. */
  roles: Partial<Record<DepthRole, SpendCost>>;
  /** The real day it was spent, UTC (`YYYY-MM-DD`): what a per-day ceiling counts. */
  day: string;
  /** What it paid for: the turn's generation, or the draft's id. */
  for: string;
  /** What a ceiling or an allowance put off meanwhile, in words, a line each (§6.5: never skipped silently). */
  put?: string[];
}

/** One part of an asked episode: whom or what it is, the treatment the author wanted, its reason, and whether the author judged it major. */
export interface AskPart {
  subject: { who: EntityId } | { event: string };
  treatment: DepthTreatment;
  rationale: string;
  /** Past its treatment's allowance, the player is asked rather than it sliding down the ladder. */
  major?: true;
}

/**
 * `author.ask`'s data (§6.5, D-7): an episode the poll opened, held for the player's answer, at the
 * treatments the author wanted; the parts past this story interval's allowance, each with the
 * allowance and what the interval had spent of it. Its basis is the poll's, so drafting it later
 * keeps the episode's id and minute.
 */
export interface AskData {
  /** The episode's id (`episodeOf` at the poll's basis), which an answer names. */
  id: string;
  /** Its place among the episodes its poll opened. */
  index: number;
  why: string;
  /** Story minutes from the poll's clock until it starts, and how long it runs. */
  in: number;
  minutes: number;
  places: PlaceId[];
  people: EntityId[];
  parts: AskPart[];
  /** Each part past its allowance, by its place in `parts`. */
  over: { part: number; allowance: number; spent: number }[];
  interval: (typeof SPEND_INTERVALS)[number];
}

/** `author.answer`'s data: the player's answer to ask `ask`: spend past the allowance, or draft it down the ladder. */
export interface AnswerData {
  ask: string;
  spend: boolean;
}

const words = (v: unknown, empty = false): v is string => typeof v === "string" && (empty || v.trim() !== "") && v.length <= AUTHOR_WORDS_MAX;
const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function costProblem(c: unknown): string | null {
  if (!isRecord(c) || !count(c.calls) || !count(c.tokensIn) || !count(c.tokensOut)) return "a spend's cost counts its calls and tokens in and out";
  if (c.reasoningOut !== undefined && !count(c.reasoningOut)) return "a spend's reasoning tokens are a count";
  return c.money === undefined || count(c.money) ? null : "a spend's money is an amount";
}

function askPartProblem(p: unknown): string | null {
  if (!isRecord(p) || !isRecord(p.subject)) return "an asked part names whom or what it is";
  if (!(nonBlank(p.subject.who) || nonBlank(p.subject.event))) return "an asked part names whom or what it is";
  if (typeof p.treatment !== "string" || !(DEPTH_TREATMENTS as readonly string[]).includes(p.treatment)) return `an asked part's treatment is one of ${DEPTH_TREATMENTS.join(", ")}`;
  if (!words(p.rationale, true)) return "an asked part's rationale is words";
  return p.major === undefined || p.major === true ? null : "an asked part is major or not marked";
}

function jobProblem(j: unknown): string | null {
  if (!isRecord(j) || typeof j.kind !== "string" || !(POLL_JOB_KINDS as readonly string[]).includes(j.kind)) return `a poll's job is one of ${POLL_JOB_KINDS.join(", ")}`;
  if (!words(j.why, true)) return "a poll's job gives its reason in words";
  if (j.kind === "author.reflect") return j.depth === "scene" || j.depth === "chapter" ? null : "the author reflects at a scene's end or a chapter's";
  if (j.kind === "episode") return nonBlank(j.episode) ? null : "an episode's job names its episode";
  if (j.kind === "settle" || j.kind === "drop" || j.kind === "rebase") return nonBlank(j.draft) ? null : "a draft's job names its draft";
  return nonBlank(j.who) ? null : "a character's job names who";
}

/** Why `data` isn't a well-formed author record of `type`, or null. Structural only. */
export function authorProblem(type: string, data: unknown): string | null {
  if (!isRecord(data)) return "an author's record is an object";
  switch (type) {
    case AUTHOR_POLL: {
      if (!(data.through === null || nonBlank(data.through))) return "a poll names the latest message it read, or none";
      if (!Array.isArray(data.considered) || !data.considered.every((c) => isRecord(c) && words(c.what) && typeof c.raised === "boolean" && words(c.why, true))) return "a poll's log is what it considered, whether it raised it, and why";
      if (!Array.isArray(data.jobs)) return "a poll lists its jobs";
      for (const j of data.jobs) {
        const p = jobProblem(j);
        if (p) return p;
      }
      if (data.wake !== undefined && !(isRecord(data.wake) && typeof data.wake.at === "number" && Number.isFinite(data.wake.at) && words(data.wake.why, true))) return "a poll's wake is a story time and why";
      return data.note === undefined || isBlobHash(data.note) ? null : "a poll's note is a stored text";
    }
    case AUTHOR_PREDICT:
      if (!nonBlank(data.id)) return "a prediction has an id";
      if (!words(data.text)) return "a prediction is words";
      if (!Array.isArray(data.about) || !data.about.every(nonBlank)) return "a prediction names whom it concerns";
      return data.from === "scene" || data.from === "chapter" ? null : "a prediction comes from a scene's or a chapter's reflection";
    case AUTHOR_SCORE:
      if (!nonBlank(data.prediction)) return "a score names its prediction";
      if (typeof data.outcome !== "string" || !(SCORE_OUTCOMES as readonly string[]).includes(data.outcome)) return `a score is one of ${SCORE_OUTCOMES.join(", ")}`;
      return words(data.note, true) ? null : "a score's note is words";
    case AUTHOR_DRIFT:
      if (!nonBlank(data.who)) return "a drift check names whom";
      if (typeof data.drift !== "string" || !(DRIFT_LEVELS as readonly string[]).includes(data.drift)) return `a drift check finds ${DRIFT_LEVELS.join(", ")}`;
      return words(data.note, true) ? null : "a drift check's note is words";
    case AUTHOR_EDIT: {
      if (!nonBlank(data.message)) return "an edit names the reply it edited";
      if (!isBlobHash(data.text)) return "an edit keeps the reply as he made it, a stored text";
      if (typeof data.cosmetic !== "boolean") return "an edit is cosmetic or not";
      if (!words(data.why, true)) return "an edit's reading is words";
      const { amended, struck } = data;
      if (!Array.isArray(amended) || !amended.every(nonBlank) || !Array.isArray(struck) || !struck.every(nonBlank)) return "an edit lists the beats it amended and struck, by id";
      return data.cosmetic && amended.length + struck.length > 0 ? "a cosmetic edit amends nothing" : null;
    }
    case AUTHOR_SPEND: {
      if (typeof data.treatment !== "string" || !(SPEND_WORK as readonly string[]).includes(data.treatment)) return `a spend bought one of ${SPEND_WORK.join(", ")}`;
      const i = data.interval;
      if (!isRecord(i) || typeof i.unit !== "string" || !(SPEND_INTERVALS as readonly string[]).includes(i.unit) || typeof i.from !== "number" || !Number.isFinite(i.from)) return "a spend counts in a story day, week or month, from its first minute";
      const cost = costProblem(data.cost);
      if (cost) return cost;
      if (!isRecord(data.roles)) return "a spend's roles are a map";
      for (const [role, c] of Object.entries(data.roles)) {
        if (!(DEPTH_ROLES as readonly string[]).includes(role)) return `a spend's role is one of ${DEPTH_ROLES.join(", ")}`;
        const p = costProblem(c);
        if (p) return p;
      }
      if (typeof data.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.day)) return "a spend says the day it was spent on";
      if (!nonBlank(data.for)) return "a spend names what it paid for";
      return data.put === undefined || (Array.isArray(data.put) && data.put.every((p) => words(p))) ? null : "what a spend put off is words, a line each";
    }
    case AUTHOR_ASK: {
      if (!nonBlank(data.id)) return "an ask names its episode";
      if (!count(data.index) || !Number.isInteger(data.index)) return "an ask says its episode's place in its poll";
      if (!words(data.why, true)) return "an ask's reason is words";
      if (typeof data.in !== "number" || !Number.isFinite(data.in) || !count(data.minutes)) return "an ask says when its episode starts and how long it runs";
      if (!Array.isArray(data.places) || !data.places.every(nonBlank) || !Array.isArray(data.people) || !data.people.every(nonBlank)) return "an ask names its places and people";
      if (!Array.isArray(data.parts) || data.parts.length === 0) return "an ask holds its episode's parts";
      for (const p of data.parts) {
        const problem = askPartProblem(p);
        if (problem) return problem;
      }
      const parts = data.parts.length;
      if (!Array.isArray(data.over) || data.over.length === 0 || !data.over.every((o) => isRecord(o) && count(o.part) && Number.isInteger(o.part) && o.part < parts && count(o.allowance) && count(o.spent))) return "an ask names the parts past their allowance";
      return typeof data.interval === "string" && (SPEND_INTERVALS as readonly string[]).includes(data.interval) ? null : "an ask counts in a story day, week or month";
    }
    case AUTHOR_ANSWER:
      if (!nonBlank(data.ask)) return "an answer names its ask";
      return typeof data.spend === "boolean" ? null : "an answer spends or doesn't";
    case AUTHOR_ADOPT: {
      const cited = (list: unknown): boolean => Array.isArray(list) && list.every((c) => isRecord(c) && nonBlank(c.what) && nonBlank(c.message));
      if (!Array.isArray(data.entries) || !data.entries.every(nonBlank)) return "an adoption lists the entries it landed, by id";
      return cited(data.waited) && cited(data.without) ? null : "an adoption names the work it waited for and went without, each with its message";
    }
    default:
      return `${type} isn't an author's record`;
  }
}

const bounded = (s: string): string => {
  const t = s.trim();
  return t.length > AUTHOR_WORDS_MAX ? `${t.slice(0, AUTHOR_WORDS_MAX - 1)}…` : t;
};

export function pollEvent(d: PollData): PackEvent {
  const data: JsonObject = {
    through: d.through,
    considered: d.considered.map((c) => ({ what: bounded(c.what), raised: c.raised, why: bounded(c.why) })),
    jobs: d.jobs.map((j): JsonObject => {
      if (j.kind === "author.reflect") return { kind: j.kind, depth: j.depth, why: bounded(j.why) };
      if (j.kind === "episode") return { kind: j.kind, episode: j.episode, why: bounded(j.why) };
      if ("draft" in j) return { kind: j.kind, draft: j.draft, why: bounded(j.why) };
      return { kind: j.kind, who: j.who, why: bounded(j.why) };
    }),
  };
  if (d.note !== undefined) data.note = d.note;
  if (d.wake !== undefined) data.wake = { at: d.wake.at, why: bounded(d.wake.why) };
  return { type: AUTHOR_POLL, data };
}

/** A prediction's id, from what makes it unique to the reflection that made it (its chat, the basis it read, its place among that reflection's predictions): `p` and 31 hex digits. */
export function predictionId(...parts: string[]): string {
  return `p${hashParts("lre.prediction", ...parts).slice(1)}`;
}

export function predictEvent(d: PredictData): PackEvent {
  return { type: AUTHOR_PREDICT, data: { id: d.id, text: bounded(d.text), about: [...d.about], from: d.from } };
}

export function scoreEvent(d: ScoreData): PackEvent {
  return { type: AUTHOR_SCORE, data: { prediction: d.prediction, outcome: d.outcome, note: bounded(d.note) } };
}

export function driftEvent(d: DriftData): PackEvent {
  return { type: AUTHOR_DRIFT, data: { who: d.who, drift: d.drift, note: bounded(d.note) } };
}

export function editEvent(d: EditData): PackEvent {
  return { type: AUTHOR_EDIT, data: { message: d.message, text: d.text, cosmetic: d.cosmetic, why: bounded(d.why), amended: [...d.amended], struck: [...d.struck] } };
}

function costData(c: SpendCost): JsonObject {
  return { calls: c.calls, tokensIn: c.tokensIn, tokensOut: c.tokensOut, ...(c.reasoningOut !== undefined ? { reasoningOut: c.reasoningOut } : {}), ...(c.money !== undefined ? { money: c.money } : {}) };
}

export function spendEvent(d: SpendData): PackEvent {
  const roles: JsonObject = {};
  for (const role of DEPTH_ROLES) {
    const c = d.roles[role];
    if (c) roles[role] = costData(c);
  }
  return { type: AUTHOR_SPEND, data: { treatment: d.treatment, interval: { unit: d.interval.unit, from: d.interval.from }, cost: costData(d.cost), roles, day: d.day, for: d.for, ...(d.put && d.put.length > 0 ? { put: d.put.map(bounded).filter((p) => p !== "") } : {}) } };
}

export function askEvent(d: AskData): PackEvent {
  const parts = d.parts.map((p): JsonObject => ({ subject: "who" in p.subject ? { who: p.subject.who } : { event: bounded(p.subject.event) }, treatment: p.treatment, rationale: bounded(p.rationale), ...(p.major ? { major: true } : {}) }));
  return { type: AUTHOR_ASK, data: { id: d.id, index: d.index, why: bounded(d.why), in: d.in, minutes: d.minutes, places: [...d.places], people: [...d.people], parts, over: d.over.map((o) => ({ part: o.part, allowance: o.allowance, spent: o.spent })), interval: d.interval } };
}

export function answerEvent(d: AnswerData): PackEvent {
  return { type: AUTHOR_ANSWER, data: { ask: d.ask, spend: d.spend } };
}

export function adoptEvent(d: AdoptData): PackEvent {
  const list = (l: AdoptData["waited"]): JsonObject[] => l.map((c) => ({ what: bounded(c.what), message: c.message }));
  return { type: AUTHOR_ADOPT, data: { waited: list(d.waited), without: list(d.without), entries: [...d.entries] } };
}

/** The data of an author's record when `e` is a well-formed one of `type`. */
export function authorData<T>(e: { type: string; data?: unknown }, type: string): T | null {
  return e.type === type && authorProblem(type, e.data) === null ? (e.data as T) : null;
}

/** The blobs an author's record names (the sweep keeps them). */
export function authorBlobs(type: unknown, data: unknown): string[] {
  if (!isRecord(data)) return [];
  if (type === AUTHOR_POLL) return isBlobHash(data.note) ? [data.note] : [];
  return type === AUTHOR_EDIT && isBlobHash(data.text) ? [data.text] : [];
}
