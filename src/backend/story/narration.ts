// A passage of the reply on its way out, on the harness engine (DEPTH2-PLAN §3.3). The author
// decides what happened as beats. The narrator, an agent, is handed only what of them reached one
// person, the point-of-view character, and drafts a passage. Whoever the settings name checks it
// against the beats whole. A turn's reply is released once, whole: the author calls LumiAH's
// `reply_write` in the shape this engine gives it (`replyTool`), naming each passage to release by
// its number, in order, with any words of its own, and never types a passage out again. LumiAH asks
// this file's gate what goes out (`releaseGate`, AH6 §8), which answers with the text itself, and
// tells it what went out (`releaseNoted`).
//
// - `StageBook` is a turn's own, in memory, one for each turn that writes a reply
//   (`HarnessTurn.stageBook`): each passage opened, with its beats, drafts and checks, and whether it
//   went out. Nothing of it is written to the record: what reached the player is the reply.
// - A passage holds the beats of the turn that reached its point of view and no earlier passage
//   holds, as they stood when it opened; beats decided later are the next passage's. A narrator keeps
//   its passage through its revisions. A new narrator for the same eyes takes over one that waits for
//   a draft or a revision, and otherwise opens the next. The reply as told so far, which a narrator
//   goes on from, is the latest draft of each passage opened before its own.
// - The gate holds each passage named to what the turn decided: its latest draft goes out once it
//   passed its check, or failed it with its drafts spent; where no one checks, once drafted. Each
//   goes out in the order named, a blank line between one and the next, with the author's own words
//   before or after them up to a length (`narration.ownChars`): alone, those are a line for an extra
//   or an answer out of character. Nothing goes out from an agent but the author. A character's
//   stream on the direct line is never asked about (AH6 §8): it is the turn's one release, and is
//   only told.
// - The settings (`UserSettings.narration`) say who checks, how many drafts a passage may have, how
//   much prose the narrator is handed for its voice, and what the author may release in its own words.
//
// No model is called here and nothing waits on a clock.

import { acts } from "../../engine/life";
import { own } from "../../engine/pack-kit";
import { playerKnows } from "../../engine/player-events";
import { together } from "../../engine/presence";
import type { Registry } from "../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { feedItem } from "../../engine/story/feed";
import { canSeeEntity, canSeePlace } from "../../engine/visibility";
import { HARNESS_AGENT } from "../../shared/harness-texts";
import { REPLY_ARG, REPLY_PLACES, type ReplyPlace, STAGE_NOTE, STAGE_TEXT } from "../../shared/harness-texts-stage";
import type { EntityId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { Beat } from "../../shared/ledger";
import type { PromptTexts } from "../../shared/prompts";
import type { NarrationSettings, UserSettings } from "../../shared/settings";
import type { WorldDoc } from "../../shared/world";
import { renderPrompt } from "../prompts";
import { PLAYER } from "./minds";
import type { StoryPresetRead } from "./preset";

// ---------------------------------------------------------------- the book

/** A check's verdict on a draft: whether it holds to its beats, what the narrator must change if not, and who checked (a definition's id). */
export interface PassageCheck {
  holds: boolean;
  changes: string[];
  by: string;
}

/** One draft of a passage, with its check once it has one. */
export interface PassageDraft {
  text: string;
  check: PassageCheck | null;
}

/** A passage of the reply: whose eyes it is seen through, the beats it tells, the presentation asked for, the narrator working it, its drafts, and whether it went out. */
export interface Passage {
  n: number;
  /** As the story record names them: "player" for the player's character. */
  pov: string;
  beats: string[];
  modules: string[];
  /** The narrator agent working it now, by its handle. */
  narrator: string;
  drafts: PassageDraft[];
  released: boolean;
}

/** Why a narration tool or the gate says no: the note that says it, and what fills it. */
export interface StageRefusal {
  note: string;
  vars?: Record<string, string>;
}

/** What stands between one passage and the next as the reply holds them, and between what the narrator wrote and the author's own words: a blank line. */
const JOIN = "\n\n";

/** The drafts a passage may have: its first, and one for each revision the settings allow. */
export function draftsAllowed(s: Pick<NarrationSettings, "revisions">): number {
  return 1 + s.revisions;
}

/** A passage's drafts still allowed. */
function draftsLeft(p: Passage, s: Pick<NarrationSettings, "revisions">): number {
  return Math.max(0, draftsAllowed(s) - p.drafts.length);
}

/** Each passage of the reply one turn is writing, in the order opened, and whether it went out. */
export class StageBook {
  readonly opened: Passage[] = [];
  private presetRead: Promise<StoryPresetRead | null> | null = null;

  /** `preset` reads the chat's preset (`readStoryPreset`), at most once for the turn; left out, the turn has none to give the narrator. */
  constructor(private readonly preset: () => Promise<StoryPresetRead | null> = async () => null) {}

  /** The chat's preset as this turn read it; null where it has none, or it couldn't be read. */
  presetOf(): Promise<StoryPresetRead | null> {
    this.presetRead ??= this.preset().catch(() => null);
    return this.presetRead;
  }

  /**
   * The reply as told before passage `n`, which its narrator goes on from: the latest draft of each
   * passage opened before it, in order, joined as a release joins them. Every drafted passage's for
   * null (what the author would see of a passage it hasn't opened). The reply goes out once, at the
   * turn's end, so nothing released is ever told before it.
   */
  toldBefore(n: number | null): string {
    return this.opened
      .filter((p) => n === null || p.n < n)
      .flatMap((p) => p.drafts.slice(-1).map((d) => d.text))
      .join(JOIN);
  }

  passage(n: number): Passage | null {
    return this.opened.find((p) => p.n === n) ?? null;
  }

  /** The passage `narrator` works now: its own, still to be released. */
  working(narrator: string): Passage | null {
    return this.opened.find((p) => p.narrator === narrator && !p.released) ?? null;
  }

  /** The beats of `reaching` that no passage holds yet, in their order. */
  untold(reaching: readonly string[]): string[] {
    const held = new Set(this.opened.flatMap((p) => p.beats));
    return reaching.filter((id) => !held.has(id));
  }

  /**
   * The passage a narrator works for the eyes of `pov`: its own; else the latest of those eyes that
   * waits for a first draft, or for a revision it still has drafts for, which it takes over; else a
   * new one of the beats of `reaching` (those that reached `pov`, in order) that no passage holds
   * yet. A passage whose drafts are spent is the author's to release or leave out: no narrator takes
   * it over. `modules` given are the passage's from then on. Null where there is nothing new to tell.
   */
  take(narrator: string, pov: string, reaching: readonly string[], modules: readonly string[], s: Pick<NarrationSettings, "revisions">): Passage | null {
    const waiting = this.working(narrator) ?? this.opened.findLast((p) => p.pov === pov && !p.released && (p.drafts.length === 0 || (p.drafts.at(-1)?.check?.holds === false && draftsLeft(p, s) > 0))) ?? null;
    if (waiting) {
      waiting.narrator = narrator;
      if (modules.length > 0) waiting.modules = [...modules];
      return waiting;
    }
    const beats = this.untold(reaching);
    if (beats.length === 0) return null;
    const p: Passage = { n: this.opened.length + 1, pov, beats, modules: [...modules], narrator, drafts: [], released: false };
    this.opened.push(p);
    return p;
  }

  /** Records `text` as the next draft of the passage `narrator` works, within the drafts and the length the settings allow. */
  draft(narrator: string, text: string, s: NarrationSettings): { passage: Passage; draft: number } | StageRefusal {
    const p = this.working(narrator);
    if (!p) return { note: STAGE_NOTE.readFirst };
    const n = String(p.n);
    const body = text.trim();
    if (body === "") return { note: STAGE_NOTE.draftEmpty };
    if (body.length > s.passageChars) return { note: STAGE_NOTE.draftLong, vars: { chars: String(s.passageChars) } };
    if (p.drafts.at(-1)?.check?.holds === true) return { note: STAGE_NOTE.draftPassed, vars: { n } };
    if (draftsLeft(p, s) === 0) return { note: STAGE_NOTE.draftSpent, vars: { n, made: String(p.drafts.length) } };
    p.drafts.push({ text: body, check: null });
    return { passage: p, draft: p.drafts.length };
  }

  /** Records `verdict` on passage `n`'s latest draft, which must be waiting for one: with how many drafts are still allowed. */
  check(n: number, verdict: PassageCheck, s: NarrationSettings): { passage: Passage; left: number } | StageRefusal {
    const p = this.passage(n);
    if (!p) return { note: STAGE_NOTE.noPassage, vars: { n: String(n) } };
    if (p.released) return { note: STAGE_NOTE.released, vars: { n: String(n) } };
    const last = p.drafts.at(-1);
    if (!last || last.check !== null) return { note: STAGE_NOTE.checkNothing, vars: { n: String(n) } };
    last.check = { holds: verdict.holds, changes: [...verdict.changes], by: verdict.by };
    return { passage: p, left: draftsLeft(p, s) };
  }

  /** Marks each passage of `pieces`, by its number, as gone out. */
  released(pieces: readonly number[]): void {
    for (const n of pieces) {
      const p = this.passage(n);
      if (p) p.released = true;
    }
  }
}

// ---------------------------------------------------------------- the reply tool and its gate (AH6 §8)

/**
 * LumiAH's `reply_write` as the author is given it in a chat this engine plays (`ChatClaim.replyTool`):
 * each passage to release by its number, in order (`pieces`), and the author's own words (`words`)
 * with where they go beside the narrator's (`place`). Nothing is typed out again: the gate sends the
 * drafts the book holds. Described in the user's own words where they wrote them.
 */
export function replyTool(settings: Pick<UserSettings, "prompts">): { description: string; parameters: JsonObject } {
  const say = (id: string): string => renderPrompt(id, settings.prompts.texts, {});
  return {
    description: say(STAGE_TEXT.replyTool),
    parameters: {
      type: "object",
      properties: {
        [REPLY_ARG.pieces]: { type: "array", items: { type: "integer", minimum: 1 }, description: say(STAGE_TEXT.replyArg(REPLY_ARG.pieces)) },
        [REPLY_ARG.words]: { type: "string", description: say(STAGE_TEXT.replyArg(REPLY_ARG.words)) },
        [REPLY_ARG.place]: { type: "string", enum: [...REPLY_PLACES], description: say(STAGE_TEXT.replyArg(REPLY_ARG.place)) },
      },
    },
  };
}

/** The reply tool's arguments as the gate reads them: each passage as it was named, in order, the author's own words, and where they go. */
interface ReleaseAsk {
  pieces: readonly unknown[];
  words: string;
  place: ReplyPlace;
}

/** `args` as the reply tool takes them: `pieces` a list (one number or numeral alone, a list of it), `words` text, `place` before or after (after where left out); else which of them isn't so. */
function askOf(args: Readonly<Record<string, unknown>>): ReleaseAsk | StageRefusal {
  const pieces = args[REPLY_ARG.pieces] ?? [];
  const words = args[REPLY_ARG.words] ?? "";
  const said = args[REPLY_ARG.place] ?? "after";
  const place = REPLY_PLACES.find((p) => typeof said === "string" && said.trim().toLowerCase() === p);
  if (!Array.isArray(pieces) && typeof pieces !== "number" && typeof pieces !== "string") return { note: STAGE_NOTE.gateArgs, vars: { arg: REPLY_ARG.pieces } };
  if (typeof words !== "string") return { note: STAGE_NOTE.gateArgs, vars: { arg: REPLY_ARG.words } };
  if (place === undefined) return { note: STAGE_NOTE.gateArgs, vars: { arg: REPLY_ARG.place } };
  return { pieces: Array.isArray(pieces) ? pieces : [pieces], words: words.trim(), place };
}

/** The passage of `book` a release names: by a whole number, or a numeral read as one; null where the turn holds none of it. */
function pieceOf(book: StageBook, named: unknown): Passage | null {
  const n = typeof named === "string" && named.trim() !== "" ? Number(named) : named;
  return typeof n === "number" && Number.isInteger(n) ? book.passage(n) : null;
}

/**
 * What goes out when an agent calls the reply tool with `args` (LumiAH's `releasing`): the text, or
 * the words it is told instead, and then nothing goes out. Only the author releases. Each passage named
 * goes out as its latest draft, in the order named, where the turn holds it, it is drafted, it isn't
 * out already and it is named once; and, where each passage is checked, where that draft passed its
 * check, or failed it with the passage's drafts spent. The first that doesn't is named in the refusal.
 * The author's own words go before or after them, where anything is checked no longer than it may
 * release with no check (`narration.ownChars`). A blank line stands between each part and the next.
 */
export function releaseGate(book: StageBook, settings: UserSettings, release: { role: string; args: Readonly<Record<string, unknown>> }): { text: string } | { refused: string } {
  const say = (note: string, vars: Readonly<Record<string, string>> = {}): { refused: string } => ({ refused: renderPrompt(note, settings.prompts.texts, vars) });
  if (release.role !== HARNESS_AGENT.author) return say(STAGE_NOTE.gateAuthor);
  const ask = askOf(release.args);
  if ("note" in ask) return say(ask.note, ask.vars);
  if (ask.pieces.length === 0 && ask.words === "") return say(STAGE_NOTE.gateNothing);
  const s = settings.narration;
  const drafts: string[] = [];
  const seen = new Set<number>();
  for (const piece of ask.pieces) {
    const p = pieceOf(book, piece);
    if (!p) return say(STAGE_NOTE.noPassage, { n: typeof piece === "string" ? piece : JSON.stringify(piece) });
    const n = String(p.n);
    if (seen.has(p.n)) return say(STAGE_NOTE.gateRepeated, { n });
    seen.add(p.n);
    if (p.released) return say(STAGE_NOTE.gateTwice, { n });
    const latest = p.drafts.at(-1);
    if (!latest) return say(STAGE_NOTE.gateUndrafted, { n });
    if (s.check !== "none") {
      if (latest.check === null) return say(STAGE_NOTE.gateUnchecked, { n });
      const left = draftsLeft(p, s);
      if (!latest.check.holds && left > 0) return say(STAGE_NOTE.gateFault, { n, left: String(left) });
    }
    drafts.push(latest.text);
  }
  const size = plainText(ask.words).length;
  if (s.check !== "none" && size > s.ownChars) return say(STAGE_NOTE.gateWords, { size: String(size), chars: String(s.ownChars) });
  const parts = ask.words === "" ? drafts : ask.place === "before" ? [ask.words, ...drafts] : [...drafts, ask.words];
  return { text: parts.join(JOIN) };
}

/** What went out (LumiAH's `released`, `args` the reply tool's as the author gave them): each passage they name is out. A character's stream on the direct line names none. */
export function releaseNoted(book: StageBook, args: Readonly<Record<string, unknown>>): void {
  const ask = askOf(args);
  if (!("note" in ask)) book.released(ask.pieces.flatMap((piece) => pieceOf(book, piece)?.n ?? []));
}

// ---------------------------------------------------------------- text

/** Text as the gate measures the author's own words, and as a draft's quotes are matched: compatibility forms folded, typographic quotes, apostrophes and dashes made plain, every run of space one. */
export function plainText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of `text`, lowercased: letters, digits and the apostrophes inside them. */
function wordsOf(text: string): string[] {
  return plainText(text).toLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}

/** Whether `run` stands in `words` as it is, word after word. */
function holdsRun(words: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0) return true;
  for (let i = 0; i + run.length <= words.length; i++) if (run.every((w, j) => words[i + j] === w)) return true;
  return false;
}

/** The words a passage speaks: what stands between quotation marks, each span as it is written. */
function spokenIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/“([^”]+)”|"([^"]+)"|«([^»]+)»|„([^“”]+)[“”]/g)) {
    const span = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (wordsOf(span).length > 0) out.push(span);
  }
  return out;
}

/** What a draft makes of the words spoken where its point of view heard them: the quotes it lacks, word for word, and the words it has spoken that no quote holds. */
export interface QuoteFindings {
  missing: string[];
  unheld: string[];
}

/**
 * The quotes of `quotes` that `draft` lacks, and the spoken words of `draft` that none of them holds.
 * A quote counts as there when its words stand, in order, in what the draft has spoken or anywhere
 * in it: narration that breaks a quote in two leaves its words in order across its spans. Spoken
 * words count as held when they stand in one quote: a part of it counts. Judged by whoever checks.
 */
export function quoteFindings(draft: string, quotes: readonly string[]): QuoteFindings {
  const spans = spokenIn(draft);
  const spoken = spans.flatMap(wordsOf);
  const all = wordsOf(draft);
  const runs = quotes.map(wordsOf);
  return {
    missing: quotes.filter((_, i) => !holdsRun(spoken, runs[i] ?? []) && !holdsRun(all, runs[i] ?? [])),
    unheld: spans.filter((span) => !runs.some((run) => holdsRun(run, wordsOf(span)))),
  };
}

/** The last `chars` characters of `text`, from the start of a word; all of it where it is no longer. */
export function tail(text: string, chars: number): string {
  const t = text.trim();
  if (t.length <= chars) return t;
  if (chars <= 0) return "";
  const cut = t.slice(t.length - chars);
  const at = cut.search(/\s/);
  return (at >= 0 ? cut.slice(at) : cut).trim();
}

// ---------------------------------------------------------------- what the point of view sees

/** Where the point-of-view character is and who is plainly there, and how they know the people and places a beat names. */
export interface SceneView {
  /** The point-of-view character's name. */
  pov: string;
  where: string | null;
  present: string[];
  /** Someone as they know them (the player's character as "player"): their name, someone they haven't met, or null for the world itself. */
  person(who: string): string | null;
  /** A place's name where they could know it; null where they couldn't, or it names none. */
  place(id: string | null): string | null;
}

/** The scene as `pov` (as the story record names them) finds it in `state`. */
export function sceneOf(input: { registry: Registry; world: WorldDoc; state: Readonly<WorldState>; pov: string; texts: PromptTexts }): SceneView {
  const { registry: reg, world, state, texts } = input;
  const me: EntityId = input.pov === PLAYER ? world.pov : input.pov;
  const named = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const name = named(me);
  const stranger = renderPrompt(STAGE_TEXT.stranger, texts, { pov: name });
  const place = (id: string | null): string | null => (id !== null && canSeePlace(reg, world, state, me, id) ? (own(world.places, id)?.name ?? null) : null);
  const here = placeOfEntity(state, me);
  const present = here === null ? [] : Object.keys(state.entities).sort().filter((id) => id !== me && together(world, here, placeOfEntity(state, id)) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id) && canSeeEntity(reg, world, state, me, id));
  const person = (who: string): string | null => {
    if (who === "world") return null;
    const id = who === PLAYER ? world.pov : who;
    if (id === me) return name;
    return own(state.entities, id) && playerKnows(reg, world, state, me, id) ? named(id) : stranger;
  };
  return { pov: name, where: place(here), present: present.map((id) => person(id) ?? id), person, place };
}

// ---------------------------------------------------------------- what the narrator is handed

/** What a narrator is handed for a passage, or what the author would see of one it hasn't opened (`n` null). */
export interface NarrationInput {
  passage: { n: number | null; pov: string; beats: readonly string[]; drafts: readonly PassageDraft[] };
  /** The turn's beats: the passage's are taken from them by id. */
  beats: readonly Beat[];
  scene: SceneView;
  /** The end of the reply as told before the passage (`StageBook.toldBefore`). */
  reply: string;
  recent: string;
  presentation: readonly { name: string; text: string }[];
  /** The engine's own prose, where the chat's preset gives the narrator none. */
  prose: string | null;
  allowed: number;
}

/**
 * The narrator's material, what it acts on first: while revising, its last draft with the changes its
 * check asked for; the passage's beats as they reached its point of view, in order (a place named
 * where it changes), and never more of a beat than reached them; where they are and who is plainly
 * there; the presentation the author asked for and how to write; and last, for its voice, the end of
 * the reply as told so far and the story's recent prose.
 */
export function narrationOf(input: NarrationInput): Record<string, unknown> {
  const { passage, scene } = input;
  const byId = new Map(input.beats.map((b) => [b.id, b]));
  const happened: Record<string, unknown>[] = [];
  let lastAt: string | null = null;
  for (const id of passage.beats) {
    const beat = byId.get(id);
    const item = beat ? feedItem(beat, passage.pov) : null;
    if (!item) continue;
    const at = scene.place(item.where);
    const where = at !== null && at !== lastAt ? { at } : {};
    if (at !== null) lastAt = at;
    if (item.reach === "whole") {
      const by = scene.person(item.by);
      happened.push({ reach: "whole", ...(by !== null ? { by } : {}), sensed: item.surface, ...(item.quotes ? { words: item.quotes } : {}), ...where });
    } else if (item.reach === "own") {
      happened.push({ reach: "own", kind: item.kind, what: item.what, ...(item.quotes ? { words: item.quotes } : {}), ...where });
    } else {
      const from = item.from !== undefined ? scene.person(item.from) : null;
      happened.push({ reach: item.reach, got: item.got, ...(from !== null ? { from } : {}), ...where });
    }
  }
  const last = passage.drafts.at(-1);
  return {
    ...(passage.n !== null ? { passage: passage.n, drafts: { made: passage.drafts.length, allowed: input.allowed } } : {}),
    ...(last?.check?.holds === false ? { revise: { draft: last.text, changes: last.check.changes } } : {}),
    pov: scene.pov,
    ...(scene.where !== null ? { where: scene.where } : {}),
    ...(scene.present.length > 0 ? { present: scene.present } : {}),
    happened,
    ...(input.presentation.length > 0 ? { presentation: input.presentation } : {}),
    ...(input.prose !== null ? { prose: input.prose } : {}),
    ...(input.reply !== "" ? { reply: input.reply } : {}),
    ...(input.recent !== "" ? { recent: input.recent } : {}),
  };
}

/** The quotes that reached `pov` (as the story record names them) in `ids` of `beats`: what a passage of theirs must hold word for word. */
export function quotesReaching(beats: readonly Beat[], ids: readonly string[], pov: string): string[] {
  const byId = new Map(beats.map((b) => [b.id, b]));
  return ids.flatMap((id) => {
    const beat = byId.get(id);
    const item = beat ? feedItem(beat, pov) : null;
    return item && (item.reach === "whole" || item.reach === "own") ? (item.quotes ?? []) : [];
  });
}

/**
 * A passage as whoever checks it reads it, what it is held to first: each beat it tells whole (what
 * happened, what could be sensed of it, the words spoken) with how it reached the point of view, the
 * beats of the turn that never reached them, and the checks so far; then its latest draft.
 */
export function passageView(input: { passage: Passage; beats: readonly Beat[]; label(who: string): string; scene: SceneView; allowed: number }): Record<string, unknown> {
  const { passage: p, label } = input;
  const told = new Set(p.beats);
  const whole = (b: Beat): Record<string, unknown> => ({ id: b.id, by: label(b.by), kind: b.kind, what: b.what, sensed: b.surface, ...(b.quotes?.length ? { words: b.quotes } : {}), ...(b.where !== null ? { at: input.scene.place(b.where) ?? b.where } : {}) });
  const beats = input.beats.filter((b) => told.has(b.id)).map((b) => {
    const item = feedItem(b, p.pov);
    const how = item === null ? { reached: "no longer" } : item.reach === "part" || item.reach === "told" ? { reached: item.reach, got: item.got, ...(item.from !== undefined ? { from: label(item.from) } : {}) } : { reached: item.reach };
    return { ...whole(b), ...how };
  });
  const notGiven = input.beats.filter((b) => !told.has(b.id) && feedItem(b, p.pov) === null).map(whole);
  const latest = p.drafts.at(-1);
  const checks = p.drafts.flatMap((d, i) => (d.check ? [{ draft: i + 1, holds: d.check.holds, ...(d.check.changes.length > 0 ? { changes: d.check.changes } : {}) }] : []));
  return {
    passage: p.n,
    pov: label(p.pov),
    ...(input.scene.where !== null ? { where: input.scene.where } : {}),
    ...(input.scene.present.length > 0 ? { present: input.scene.present } : {}),
    ...(p.modules.length > 0 ? { presentation: p.modules } : {}),
    beats,
    ...(notGiven.length > 0 ? { notGiven } : {}),
    ...(checks.length > 0 ? { checks } : {}),
    draft: latest ? { number: p.drafts.length, of: input.allowed, text: latest.text, checked: latest.check !== null } : null,
    ...(p.released ? { released: true } : {}),
  };
}

// ---------------------------------------------------------------- what other agents are given

/**
 * What a character whose answer is the reply itself (the direct line) is handed about writing it:
 * the engine's line on it, then how lines are written here, from the chat's preset (its voice part),
 * or the engine's own where the preset says nothing of it. Null where the settings have the narrator
 * tell the direct line's passage afterwards (`narration.directLine`): the character then writes none.
 */
export function directLineGuidance(read: StoryPresetRead | null, settings: Pick<UserSettings, "narration" | "prompts">): string | null {
  if (settings.narration.directLine === "narrated") return null;
  const texts = settings.prompts.texts;
  const voice = read?.parts.voice.trim() ?? "";
  return [renderPrompt(STAGE_TEXT.lineIntro, texts, {}), voice !== "" ? voice : renderPrompt(STAGE_TEXT.lineVoice, texts, {})].join("\n\n");
}

/** The lines the author's guidance carries for the narration settings: who checks a passage, what the author may release in its own words, and whose the direct line's passage is. */
export function narrationGuidance(settings: Pick<UserSettings, "narration" | "prompts">): string {
  const s = settings.narration;
  const say = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, settings.prompts.texts, vars);
  const own = s.check === "none" ? "" : s.ownChars > 0 ? say(STAGE_TEXT.own, { chars: String(s.ownChars) }) : say(STAGE_TEXT.ownNone);
  return [say(STAGE_TEXT.check(s.check), { revisions: String(s.revisions) }), own, say(STAGE_TEXT.directLine(s.directLine))].filter((t) => t.trim() !== "").join("\n");
}
