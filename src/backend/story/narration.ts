// A passage of the reply on its way out, on the harness engine (DEPTH2-PLAN §3.3). The author
// decides what happened as beats. The narrator, an agent, is handed only what of them reached one
// person, the point-of-view character, and drafts a passage. Whoever the settings name checks it
// against the beats whole. The author releases it with LumiAH's `reply_write`, which asks this
// file's gate first (`releaseGate`, AH6 §8) and tells it what went out (`releaseNoted`).
//
// - `StageBook` is a turn's own, in memory, one for each turn that writes a reply
//   (`HarnessTurn.stageBook`): each passage opened, with its beats, drafts and checks, and what the reply
//   released so far. Nothing of it is written to the record: what reached the player is the reply.
// - A passage holds the beats of the turn that reached its point of view and no earlier passage
//   holds, as they stood when it opened; beats decided later are the next passage's. A narrator keeps
//   its passage through its revisions. A new narrator for the same eyes takes over one that waits for
//   a draft or a revision, and otherwise opens the next.
// - The gate lets out a passage whose latest draft passed its check, or whose drafts are spent once
//   checked; text of the author's own up to a length; and, where no one checks, anything the author
//   releases. Nothing else, and nothing from an agent but the author. A character's stream on the
//   direct line is never asked about (AH6 §8): it is told, and kept as the reply so far.
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
import { STAGE_NOTE, STAGE_TEXT } from "../../shared/harness-texts-stage";
import type { EntityId } from "../../shared/ids";
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

/** What went out into the reply, in order: a passage (its number), or text that is none (the author's own words, a character's stream on the direct line). */
export interface Release {
  text: string;
  /** The definition of the agent that released it. */
  by: string;
  passage: number | null;
}

/** Why a narration tool or the gate says no: the note that says it, and what fills it. */
export interface StageRefusal {
  note: string;
  vars?: Record<string, string>;
}

/** The drafts a passage may have: its first, and one for each revision the settings allow. */
export function draftsAllowed(s: Pick<NarrationSettings, "revisions">): number {
  return 1 + s.revisions;
}

/** A passage's drafts still allowed. */
function draftsLeft(p: Passage, s: Pick<NarrationSettings, "revisions">): number {
  return Math.max(0, draftsAllowed(s) - p.drafts.length);
}

/** Each passage of the reply one turn is writing, in the order opened, and what it released so far. */
export class StageBook {
  readonly opened: Passage[] = [];
  readonly releases: Release[] = [];
  private presetRead: Promise<StoryPresetRead | null> | null = null;

  /** `preset` reads the chat's preset (`readStoryPreset`), at most once for the turn; left out, the turn has none to give the narrator. */
  constructor(private readonly preset: () => Promise<StoryPresetRead | null> = async () => null) {}

  /** The chat's preset as this turn read it; null where it has none, or it couldn't be read. */
  presetOf(): Promise<StoryPresetRead | null> {
    this.presetRead ??= this.preset().catch(() => null);
    return this.presetRead;
  }

  /** The reply as released so far. */
  reply(): string {
    return this.releases.map((r) => r.text).join("");
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

  /** The passage one of whose drafts is `text` (the newest such), and which draft; null where none is. */
  find(text: string): { passage: Passage; index: number } | null {
    const said = plainText(text);
    if (said === "") return null;
    for (const p of [...this.opened].reverse()) {
      const index = p.drafts.findLastIndex((d) => plainText(d.text) === said);
      if (index >= 0) return { passage: p, index };
    }
    return null;
  }

  /** The passage still to be released whose latest draft `text` is close to (most of their words shared); null where none is. */
  closest(text: string): Passage | null {
    let best: { p: Passage; score: number } | null = null;
    for (const p of this.opened) {
      const latest = p.drafts.at(-1);
      if (p.released || !latest) continue;
      const score = likeness(text, latest.text);
      if (score >= CLOSE && (best === null || score > best.score)) best = { p, score };
    }
    return best?.p ?? null;
  }

  /** What went out: the passage it is the latest draft of, released now, or text that is none. */
  note(release: { role: string; text: string }): void {
    const found = this.find(release.text);
    const p = found && !found.passage.released && found.index === found.passage.drafts.length - 1 ? found.passage : null;
    if (p) p.released = true;
    this.releases.push({ text: release.text, by: release.role, passage: p ? p.n : null });
  }
}

// ---------------------------------------------------------------- the gate (AH6 §8)

/**
 * Whether `release`, about to go out by `reply_write`, may: null lets it go; else the words the
 * agent is told. Only the author releases. A passage goes out as its latest draft: where each passage
 * is checked, once that draft passed, or failed with its drafts spent; where no one checks, as it is.
 * Text that is no passage goes out where no one checks, or where it is no longer than the author may
 * release in its own words (`narration.ownChars`): a line for an extra, an answer out of character.
 */
export function releaseGate(book: StageBook, settings: UserSettings, release: { role: string; text: string }): { refused: string } | null {
  const say = (note: string, vars: Readonly<Record<string, string>> = {}): { refused: string } => ({ refused: renderPrompt(note, settings.prompts.texts, vars) });
  if (release.role !== HARNESS_AGENT.author) return say(STAGE_NOTE.gateAuthor);
  const s = settings.narration;
  const found = book.find(release.text);
  if (found) {
    const { passage: p, index } = found;
    const n = String(p.n);
    if (p.released) return say(STAGE_NOTE.gateTwice, { n });
    if (index < p.drafts.length - 1) return say(STAGE_NOTE.gateEarlier, { n, draft: String(p.drafts.length) });
    if (s.check === "none") return null;
    const check = p.drafts[index]?.check ?? null;
    if (check === null) return say(STAGE_NOTE.gateUnchecked, { n });
    const left = draftsLeft(p, s);
    return !check.holds && left > 0 ? say(STAGE_NOTE.gateFault, { n, left: String(left) }) : null;
  }
  if (s.check === "none" || plainText(release.text).length <= s.ownChars) return null;
  const close = book.closest(release.text);
  return close ? say(STAGE_NOTE.gateClose, { n: String(close.n) }) : say(STAGE_NOTE.gateUnknown, { chars: String(s.ownChars) });
}

/** What went out into the reply (`reply_write`, or a character's whole stream on the direct line): the reply so far, and the passage it released. */
export function releaseNoted(book: StageBook, release: { role: string; text: string }): void {
  book.note(release);
}

// ---------------------------------------------------------------- text

/** Text as a release is matched to a draft: compatibility forms folded, typographic quotes, apostrophes and dashes made plain, every run of space one. */
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

/** How close a release must be to a draft for the gate to name it: most words in common. */
const CLOSE = 0.85;

/** How much of their words two texts share (Dice's measure on their words, each counted once): 1 for the same words, 0 for none in common. */
function likeness(a: string, b: string): number {
  const x = new Set(wordsOf(a));
  const y = new Set(wordsOf(b));
  if (x.size + y.size === 0) return 1;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return (2 * shared) / (x.size + y.size);
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
  reply: string;
  recent: string;
  presentation: readonly { name: string; text: string }[];
  /** The engine's own prose, where the chat's preset gives the narrator none. */
  prose: string | null;
  allowed: number;
}

/**
 * The narrator's material: the passage's beats as they reached its point of view, in order (a
 * place named where it changes), and never more of a beat than reached them; where they are and who
 * is plainly there; the end of the reply so far and the story's recent prose; the presentation the
 * author asked for; and, while revising, its last draft with the changes its check asked for.
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
    ...(passage.n !== null ? { passage: passage.n } : {}),
    pov: scene.pov,
    ...(scene.where !== null ? { where: scene.where } : {}),
    ...(scene.present.length > 0 ? { present: scene.present } : {}),
    happened,
    ...(input.reply !== "" ? { reply: input.reply } : {}),
    ...(input.recent !== "" ? { recent: input.recent } : {}),
    ...(input.presentation.length > 0 ? { presentation: input.presentation } : {}),
    ...(input.prose !== null ? { prose: input.prose } : {}),
    ...(last?.check?.holds === false ? { revise: { draft: last.text, changes: last.check.changes } } : {}),
    ...(passage.n !== null ? { drafts: { made: passage.drafts.length, allowed: input.allowed } } : {}),
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
 * A passage as whoever checks it reads it: its latest draft with what its quotes come to, each beat
 * it tells whole (what happened, what could be sensed of it, the words spoken) with how it reached
 * the point of view, the beats of the turn that never reached them, and the checks so far.
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
    draft: latest ? { number: p.drafts.length, of: input.allowed, text: latest.text, checked: latest.check !== null } : null,
    ...(checks.length > 0 ? { checks } : {}),
    beats,
    ...(notGiven.length > 0 ? { notGiven } : {}),
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
