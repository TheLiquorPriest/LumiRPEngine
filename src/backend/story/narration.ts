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
//   (`HarnessTurn.stageBook`): each passage, by its number, with its beats, drafts and checks, and
//   whether it went out. Nothing of it is written to the record: what reached the player is the reply.
// - Each passage is numbered 1, 2, 3 in the order told, and a narrator names its passage by its
//   number: a read of the next number opens a new passage, a read of an open one gives it again, and
//   a narrator drafts only the passage its last read gave it. Which passage a draft is of is said,
//   never guessed, so several narrators at work at once each keep to their own, and a narrator sent
//   on to tell more opens the next one and never drafts over the one before.
// - A passage holds the beats of the turn that reached its point of view and no earlier passage
//   holds, as they stood when it opened; beats decided later are the next passage's. A revision is
//   given its own passage's beats again. Only a check that finds a draft at fault opens a revision: a
//   draft made while the latest still waits for its check takes its place and spends nothing.
// - What a narrator goes on from is the reply as far as it is known to reach the player: each
//   earlier passage whose latest draft passed its check (any drafted one, where no one checks). An
//   earlier one not settled yet is named to it, never handed: nothing is released before the turn's
//   end, and that is what the player would read once it is.
// - The gate holds each passage named to what the turn decided: its latest draft goes out once it
//   passed its check, or failed it with its drafts spent; where no one checks, once drafted. Each
//   goes out in the order named, a blank line between one and the next, with the author's own words
//   before or after them up to a length (`narration.ownChars`): alone, those are a line for an extra
//   or an answer out of character. Nothing goes out from an agent but the author. A character's
//   stream on the direct line is never asked about (AH6 §8): it is the turn's one release, and is
//   only told. Where the author's run ends with nothing released, a telling that is complete and
//   settled still goes out (`unreleasedReply`): every passage passed its check and every beat that
//   reached the reply's eyes is told; else nothing does. Each passage of it is marked as out only once
//   LumiAH says it went (`released` with no arguments, `releaseNoted`).
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

/** A passage of the reply: its number in the order told, whose eyes it is seen through, the beats it tells, the presentation asked for, its drafts, and whether it went out. */
export interface Passage {
  n: number;
  /** As the story record names them: "player" for the player's character. */
  pov: string;
  beats: string[];
  modules: string[];
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

/** Whether passage `p`'s telling is settled as far as is known: its latest draft passed its check, or it is drafted where no one checks. What a release would send of it, unless the author leaves it out. */
function settled(p: Passage, s: Pick<NarrationSettings, "check">): boolean {
  const last = p.drafts.at(-1);
  return last !== undefined && (s.check === "none" || last.check?.holds === true);
}

/** Each passage of the reply one turn is writing, by its number in the order told, and whether it went out. */
export class StageBook {
  readonly opened: Passage[] = [];
  /** The number of each passage the engine offered as the reply in the author's place (`unreleasedReply`), until LumiAH says it went out: an offer it never sent marks nothing. */
  offered: number[] = [];
  /** Each narrator's last read, by its agent's id in the run: the passage it was given, and the beats that had reached its eyes then. A narrator drafts only the passage it last read. */
  private readonly reads = new Map<string, { passage: Passage; seen: ReadonlySet<string> }>();
  private presetRead: Promise<StoryPresetRead | null> | null = null;

  /** `preset` reads the chat's preset (`readStoryPreset`), at most once for the turn; left out, the turn has none to give the narrator. */
  constructor(private readonly preset: () => Promise<StoryPresetRead | null> = async () => null) {}

  /** The chat's preset as this turn read it; null where it has none, or it couldn't be read. */
  presetOf(): Promise<StoryPresetRead | null> {
    this.presetRead ??= this.preset().catch(() => null);
    return this.presetRead;
  }

  /** The number the next new passage takes: each is numbered from 1 in the order told. */
  next(): number {
    return this.opened.length + 1;
  }

  /**
   * What the narrator of passage `n` goes on from (null: of a passage not opened yet, as the author
   * sees one): each passage before it whose telling is settled (`settled`), in order, joined as a
   * release joins them; and, by number, those before it that aren't, whose text it is never handed.
   * Nothing goes out before the turn's end, so this is the reply as far as it is known to reach the
   * player, as what was released was before.
   */
  toldBefore(n: number | null, s: Pick<NarrationSettings, "check">): { text: string; open: number[] } {
    const before = this.opened.filter((p) => n === null || p.n < n);
    return {
      text: before.flatMap((p) => (settled(p, s) ? p.drafts.slice(-1).map((d) => d.text) : [])).join(JOIN),
      open: before.filter((p) => !settled(p, s)).map((p) => p.n),
    };
  }

  passage(n: number): Passage | null {
    return this.opened.find((p) => p.n === n) ?? null;
  }

  /** The beats of `reaching` that no passage holds yet, in their order. */
  untold(reaching: readonly string[]): string[] {
    const held = new Set(this.opened.flatMap((p) => p.beats));
    return reaching.filter((id) => !held.has(id));
  }

  /**
   * Passage `n` as `reader`, a narrator that sees through the eyes of `pov`, reads it: the one of that
   * number, as it opened, `modules` given becoming its own; else, where `n` is the next number, a new
   * one of the beats of `reaching` (those that reached `pov`, in order) that no passage holds yet, and
   * null where none is left to tell. A number past the next is refused, naming the next; so is a
   * passage seen through other eyes, which a narrator is never handed. What it was given becomes the
   * passage it drafts (`draft`).
   */
  take(reader: string, n: number, pov: string, reaching: readonly string[], modules: readonly string[]): Passage | StageRefusal | null {
    const known = this.passage(n);
    if (known) {
      if (known.pov !== pov) return { note: STAGE_NOTE.passageEyes, vars: { n: String(n) } };
      if (modules.length > 0) known.modules = [...modules];
      this.reads.set(reader, { passage: known, seen: new Set(reaching) });
      return known;
    }
    if (n !== this.next()) return { note: STAGE_NOTE.passageNext, vars: { n: String(n), next: String(this.next()) } };
    const beats = this.untold(reaching);
    if (beats.length === 0) return null;
    const p: Passage = { n, pov, beats, modules: [...modules], drafts: [], released: false };
    this.opened.push(p);
    this.reads.set(reader, { passage: p, seen: new Set(reaching) });
    return p;
  }

  /**
   * Records `text` as `reader`'s draft of passage `n`, within the drafts and the length the settings
   * allow. A narrator drafts only the passage its last read gave it (`take`), revisions included, so
   * one sent on to read a further passage never drafts over the one before. Only a check that finds a
   * draft at fault opens a revision: a draft made while the latest still waits for its check takes its
   * place and spends nothing, so a narrator that drafts again of itself leaves the revisions to the
   * check. It takes its place only while nothing that no passage tells reached the passage's eyes
   * (`reaching`: the beats that reached them now) since the narrator read it: that is a further
   * passage's, and a narrator sent on to tell it without reading never writes over the telling it gave.
   */
  draft(reader: string, n: number, text: string, s: NarrationSettings, reaching: readonly string[]): { passage: Passage; draft: number } | StageRefusal {
    const read = this.reads.get(reader);
    if (!read) return { note: STAGE_NOTE.readFirst, vars: { n: String(n) } };
    if (read.passage.n !== n) return { note: STAGE_NOTE.draftNotRead, vars: { n: String(n), read: String(read.passage.n) } };
    const p = read.passage;
    const vars = { n: String(n), next: String(this.next()) };
    const body = text.trim();
    if (body === "") return { note: STAGE_NOTE.draftEmpty };
    if (body.length > s.passageChars) return { note: STAGE_NOTE.draftLong, vars: { chars: String(s.passageChars) } };
    if (p.released) return { note: STAGE_NOTE.released, vars };
    const last = p.drafts.at(-1);
    if (last?.check?.holds === true) return { note: STAGE_NOTE.draftPassed, vars };
    if (last && last.check === null) {
      if (this.untold(reaching).some((id) => !read.seen.has(id))) return { note: STAGE_NOTE.draftWaits, vars: { n: String(n) } };
      p.drafts[p.drafts.length - 1] = { text: body, check: null };
      return { passage: p, draft: p.drafts.length };
    }
    if (draftsLeft(p, s) === 0) return { note: STAGE_NOTE.draftSpent, vars: { ...vars, made: String(p.drafts.length) } };
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
 * Why passage `p` can't go out as it stands, where it can't: it is out already, or has no draft; or,
 * where each passage is checked, its latest draft waits for its check, or was found at fault while
 * it may still be drafted again. A draft at fault with its drafts spent goes out as it stands.
 */
function heldBack(p: Passage, s: Pick<NarrationSettings, "check" | "revisions">): StageRefusal | null {
  const n = String(p.n);
  if (p.released) return { note: STAGE_NOTE.gateTwice, vars: { n } };
  const latest = p.drafts.at(-1);
  if (!latest) return { note: STAGE_NOTE.gateUndrafted, vars: { n } };
  if (s.check === "none") return null;
  if (latest.check === null) return { note: STAGE_NOTE.gateUnchecked, vars: { n } };
  const left = draftsLeft(p, s);
  return !latest.check.holds && left > 0 ? { note: STAGE_NOTE.gateFault, vars: { n, left: String(left) } } : null;
}

/**
 * What goes out when an agent calls the reply tool with `args` (LumiAH's `releasing`): the text, or
 * the words it is told instead, and then nothing goes out. Only the author releases. Each passage named
 * goes out as its latest draft, in the order named, where the turn holds it, it is named once and
 * nothing holds it back (`heldBack`); the first that doesn't is named in the refusal. The author's
 * own words go before or after them, where anything is checked no longer than it may release with no
 * check (`narration.ownChars`). A blank line stands between each part and the next.
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
    if (seen.has(p.n)) return say(STAGE_NOTE.gateRepeated, { n: String(p.n) });
    seen.add(p.n);
    const held = heldBack(p, s);
    if (held) return say(held.note, held.vars);
    drafts.push(p.drafts.at(-1)?.text ?? "");
  }
  const size = plainText(ask.words).length;
  if (s.check !== "none" && size > s.ownChars) return say(STAGE_NOTE.gateWords, { size: String(size), chars: String(s.ownChars) });
  const parts = ask.words === "" ? drafts : ask.place === "before" ? [ask.words, ...drafts] : [...drafts, ask.words];
  return { text: parts.join(JOIN) };
}

/**
 * What went out (LumiAH's `released`, `args` the reply tool's as the author gave them): each passage
 * they name is out. A call with no arguments is a character's stream on the direct line, which names
 * none, or the reply the engine offered in the author's place (`unreleasedReply`), each passage of
 * which is out now that LumiAH says it went.
 */
export function releaseNoted(book: StageBook, args: Readonly<Record<string, unknown>>): void {
  if (Object.keys(args).length === 0) {
    book.released(book.offered);
    book.offered = [];
    return;
  }
  const ask = askOf(args);
  if (!("note" in ask)) book.released(ask.pieces.flatMap((piece) => pieceOf(book, piece)?.n ?? []));
}

/**
 * The reply a turn's telling makes where the author's run ended with nothing released (LumiAH's
 * `unreleased`: a limit, a failed call, or its own end): only a telling that is complete and settled,
 * or nothing. Every passage opened this turn must be settled (`settled`: its latest draft passed its
 * check, or is drafted where no one checks; never a draft at fault, even with no drafts left, as no
 * one named it), and every beat of `reaching` (those that reached the reply's eyes this turn) must
 * be held by a passage: then what the turn commits is exactly what the chat tells. They go out in
 * order, joined as a release joins them, kept as offered and marked as out only when LumiAH says the
 * text went (`releaseNoted`): it may still send nothing (its wait ran out, the player stopped the
 * turn, the reply closed). Null otherwise: the turn fails as it would without this, with nothing kept.
 */
export function unreleasedReply(book: StageBook, s: Pick<NarrationSettings, "check">, reaching: readonly string[]): { text: string } | null {
  if (book.opened.length === 0 || !book.opened.every((p) => settled(p, s)) || book.untold(reaching).length > 0) return null;
  book.offered = book.opened.map((p) => p.n);
  return { text: book.opened.map((p) => p.drafts.at(-1)?.text ?? "").join(JOIN) };
}

/**
 * Where each passage of the turn stands, at a glance, as the author and whoever checks read it to
 * know what is ready without reading any passage's text (`pieces`, the word `reply_write` names them
 * by): its number, whose eyes, its latest draft's number and length, its check, the drafts it has
 * left, and whether a release would let it go now; with the number the next new passage takes.
 */
export function stageList(book: StageBook, s: Pick<NarrationSettings, "check" | "revisions">, label: (who: string) => string): Record<string, unknown> {
  return {
    pieces: book.opened.map((p) => {
      const latest = p.drafts.at(-1);
      const check = latest === undefined || s.check === "none" ? {} : { check: latest.check === null ? "waits" : latest.check.holds ? "holds" : "at fault" };
      return { passage: p.n, pov: label(p.pov), draft: p.drafts.length, of: draftsAllowed(s), chars: latest?.text.length ?? 0, ...check, left: draftsLeft(p, s), ready: heldBack(p, s) === null, ...(p.released ? { released: true } : {}) };
    }),
    next: book.next(),
  };
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
  /** The end of the reply as far as it is known before the passage (`StageBook.toldBefore`). */
  reply: string;
  /** The number of each earlier passage whose telling isn't settled, in the narrator's words; null where there is none. */
  open: string | null;
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
 * there; the presentation the author asked for and how to write; and last, for its voice, which
 * earlier passage isn't settled yet, the end of the reply as far as it is known, and the story's
 * recent prose.
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
    ...(input.open !== null ? { open: input.open } : {}),
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
