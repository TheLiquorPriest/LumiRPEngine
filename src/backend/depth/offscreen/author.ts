// The author off screen (DEPTH-PLAN §4.6, §5.2): pure stages that ask the author through the port
// they are given and read its answer, checked against the people and places the chat has. The
// episode runner (`episode.ts`) and the settle job (`settle.ts`) turn what they give into a draft and
// a settlement; a stage never lands anything.
//
//   open     an episode the poll opened: its staging, the beats of those the author plays or handles
//            and of the world (what anyone attempts, for the GM), who playing live acts first, and
//            whom and what it touches from when
//   step     after the beats those playing live decided: who perceived them, what the world and the
//            author's own players do now, who acts next, or the episode's end
//   settle   a draft read against every beat since its story time: settle it (each beat kept,
//            adjusted or left out; each world change kept or left out; what must change now
//            attempted), drop it, or redraft it for a later time; as a walk-on (the player's scene
//            reaches what it holds), settle it, drop it, or re-date it past the scene
//
// The author's judgment is its own: these stages only check an answer's shape and its ids. What isn't
// the author's to write (an act for someone playing live, the player character's acts) is refused and
// said back, never silently dropped.

import { OFFSCREEN_TEXT } from "../../../shared/offscreen-prompts";
import { hasOwn } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { StoryEpisode } from "../../../shared/episodes";
import type { StoryRef } from "../../../shared/story";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { NOTEBOOK_DIR } from "../../../engine/notebook";
import { own } from "../../../engine/pack-kit";
import { answerWhy, DepthAnswerError, spoken, type BeatText, type StageCost } from "../common";
import type { NotebookRead } from "../notebook";
import type { AgentTool } from "../../agents/runtime";
import { ARCHIVE_ROUNDS, ask, askReading, beatText, draftBeats, draftText, exposureForOf, namesOf, nextOf, notebookText, playedText, stagingsOf, stagingText, tag, talkOf, toolsText, type AuthorCtx, type DraftBeat, type ExposureFor, type Names, type PlayedMind, type StagingDraft } from "../scene/author";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const record = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ------------------------------------------------------------------ an episode

/** An episode as the author runs it: the poll's episode, who plays live, the minds it plays, and the story's newest beats. */
export interface EpisodeView {
  episode: StoryEpisode;
  /** Those playing as their own agents (a live part with a mind). */
  live: readonly EntityId[];
  /** Those the author plays from their minds (a campfire part, or a live part with no mind to play it). */
  played: readonly PlayedMind[];
  /** The story's newest beats on the chain, as the author reads them (a prompt's bound). */
  recent: readonly { ref: string; beat: BeatText }[];
}

export interface EpisodeInput extends AuthorCtx {
  notebook: NotebookRead;
  view: EpisodeView;
  /** For a step: the episode so far (its staging and beats), the beats just decided waiting for who perceived them, and the steps left. */
  so?: { staging: readonly StagingDraft[]; beats: readonly { ref: string; beat: BeatText }[]; decided: readonly DraftBeat[]; left: number };
}

/** Whom or what an episode touches, and from how many minutes after it starts. */
export interface TouchAsk {
  ref: StoryRef;
  after: number;
}

export interface EpisodeAnswer extends StageCost {
  staging: StagingDraft[];
  /** Who perceived each beat just decided (a step's). */
  exposure: ExposureFor[];
  /** The beats of those the author plays or handles and of the world; `attempt` where the GM resolves one. */
  beats: DraftBeat[];
  next: EntityId[];
  end: string | null;
  touches: TouchAsk[];
  /** The notebook's files the episode draws on, by path: a later revision of one of them is what changed underneath the draft (§4.6), a revision elsewhere in the notebook isn't. */
  cites: string[];
  summary: string;
  refused: string[];
}

/** The episode as the author reads it: when, where, who, why, each part's treatment, who plays live, the minds it plays, and the story's newest beats. */
function episodeText(input: EpisodeInput, names: Names): string {
  const { world, state, view } = input;
  const cal = calendarOf(world);
  const e = view.episode;
  const place = (id: PlaceId): string => `${own(world.places, id)?.name ?? id} [${id}]`;
  const parts = e.parts.map((p) => `- ${"who" in p.subject ? tag(names, p.subject.who) : p.subject.event}: ${p.treatment}${p.rationale ? ` (${p.rationale})` : ""}`).join("\n");
  return [
    notebookText(input.notebook),
    `The episode [${e.id}]: ${e.why || "(no reason given)"}`,
    `When: from ${formatClock(cal, e.span[0])} to ${formatClock(cal, e.span[1])}; it is now ${formatClock(cal, state.clock)} on screen.`,
    `Where: ${e.places.map(place).join(", ") || "(where its people are)"}`,
    `Who: ${e.people.map((w) => tag(names, w)).join(", ")}`,
    `Each part's treatment:\n${parts}`,
    `Playing live, as their own agents: ${view.live.map((w) => tag(names, w)).join(", ") || "(no one)"}`,
    ...(view.played.length > 0 ? [`Those you play, from their minds:\n${playedText(names, view.played)}`] : []),
    `The story's newest beats, on screen and off:\n${view.recent.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
  ].join("\n\n");
}

/** Whom and what an answer says the episode touches: people and places by id, things in words. */
function touchesOf(raw: unknown, names: Names): TouchAsk[] {
  const out: TouchAsk[] = [];
  for (const r of list(raw)) {
    const t = record(r);
    if (!t) continue;
    const after = typeof t.after === "number" && Number.isFinite(t.after) && t.after > 0 ? Math.round(t.after) : 0;
    const who = t.who !== undefined ? names.person(t.who) : null;
    const place = t.place !== undefined ? names.place(t.place) : null;
    const thing = text(t.thing);
    const ref: StoryRef | null = who ? { entity: who } : place ? { place } : thing !== "" ? { thing } : null;
    if (ref) out.push({ ref, after });
  }
  return out;
}

/** The notebook files an answer says the episode draws on, each by its path as the notebook showed it (or under the notebook's folder); one the notebook doesn't hold is refused and said. */
function citesOf(raw: unknown, notebook: NotebookRead, refused: string[]): string[] {
  const out: string[] = [];
  for (const c of list(raw)) {
    const said = text(c);
    if (said === "") continue;
    const path = hasOwn(notebook.files, said) ? said : hasOwn(notebook.files, `${NOTEBOOK_DIR}${said}`) ? `${NOTEBOOK_DIR}${said}` : null;
    if (path === null) refused.push(`"${said}" isn't a file of your notebook, so the draft doesn't cite it`);
    else if (!out.includes(path)) out.push(path);
  }
  return out;
}

function episodeAnswer(a: Record<string, unknown>, input: EpisodeInput, names: Names, refused: string[], prefix: string, cost: StageCost): EpisodeAnswer {
  const live = new Set(input.view.live);
  const decided = new Set((input.so?.decided ?? []).map((d) => d.ref));
  const end = text(a.end);
  const account = answerWhy(a);
  return {
    staging: stagingsOf(a.staging, names, refused),
    exposure: exposureForOf(a.exposure, names, decided, refused),
    beats: draftBeats(a.beats, names, input, { agents: live }, refused, prefix),
    next: nextOf(a.next, names, live, refused),
    end: end !== "" ? end : null,
    touches: touchesOf(a.touches, names),
    cites: citesOf(a.notebook, input.notebook, refused),
    summary: text(a.summary),
    refused,
    ...(cost.reasoning ? { reasoning: cost.reasoning } : account !== "" ? { reasoning: account } : {}),
    ...(cost.usage ? { usage: cost.usage } : {}),
  };
}

/** The author opens an episode off screen (§4.6): its staging, its first beats, who playing live acts first, whom and what it touches. */
export async function episodeOpen(input: EpisodeInput): Promise<EpisodeAnswer> {
  const names = namesOf(input.world, input.state);
  const asked = await ask(input, OFFSCREEN_TEXT.episode, episodeText(input, names));
  return episodeAnswer(asked.answer, input, names, [], "o", asked);
}

/** One of the author's steps in an episode someone plays live: who perceived the beats just decided, the world's and its own players' beats, who acts next, or the end. */
export async function episodeStep(input: EpisodeInput & { so: NonNullable<EpisodeInput["so"]> }): Promise<EpisodeAnswer> {
  const names = namesOf(input.world, input.state);
  const so = input.so;
  const data = [
    episodeText(input, names),
    `The episode's staging:\n${so.staging.map((s) => stagingText(names, s)).join("\n") || "- (none)"}`,
    `The episode so far:\n${so.beats.map((b) => beatText(input.world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
    `Just decided, waiting for who perceived them:\n${so.decided.map((d) => draftText(names, d)).join("\n") || "- (none)"}`,
    so.left <= 2 ? `${so.left} step${so.left === 1 ? "" : "s"} left before the episode must end.` : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n");
  const asked = await ask(input, OFFSCREEN_TEXT.episodeStep, data);
  return episodeAnswer(asked.answer, input, names, [], `s${so.left}-`, asked);
}

// ------------------------------------------------------------------ settling a draft

export interface SettleInput extends AuthorCtx {
  notebook: NotebookRead;
  /** The draft's episode, its summary and when it happens. */
  episode: StoryEpisode;
  summary: string;
  at: number;
  /** Its beats with their texts, by ref. */
  beats: readonly { ref: string; beat: BeatText }[];
  /** Its world changes, in order, in words. */
  effects: readonly string[];
  /** Every live beat on the chain from its story time on, as the author reads them: its pins (with `pages`, none: what each page came to stands in for them). */
  pins: readonly { ref: string; beat: BeatText }[];
  /** Its pins read a page at a time, in story order (W5): each page's verdict. With any page contradicting it, a settlement that changes nothing is refused. */
  pages?: readonly PageVerdict[];
  /**
   * The player's scene reaches what it holds (a walk-on, §4.6's invariant): what of the scene it
   * holds and from when, in words, and the scene's minute. The author settles it, drops it, or
   * re-dates it past the scene (`redate`); never a redraft.
   */
  walkOn?: { reach: readonly string[]; now: number };
}

/** What the author's reading of one page of a draft's pins came to (W5). */
export interface PageVerdict {
  /** 1-based, of `of`, in story order. */
  page: number;
  of: number;
  /** The story times the page runs over, in words. */
  span: string;
  verdict: "holds" | "contradicts";
  why: string;
  forces: string[];
}

/** The verdicts of the pages read so far, as the author reads them. */
function pagesText(pages: readonly PageVerdict[]): string {
  return pages.map((p) => `- Page ${p.page} of ${p.of} (${p.span}): ${p.verdict === "holds" ? "it holds" : "it contradicts the draft"}${p.why ? `: ${p.why}` : ""}${p.forces.map((f) => `\n  - forces: ${f}`).join("")}`).join("\n");
}

/** The draft as every settlement reading shows it: the notebook, its summary, its episode and time, its beats and its world changes. */
function draftData(input: Omit<SettleInput, "pins" | "pages">, names: Names): string[] {
  const cal = calendarOf(input.world);
  const e = input.episode;
  return [
    notebookText(input.notebook),
    `The draft: ${input.summary || "(no summary)"}`,
    `Its episode [${e.id}]: ${e.why || "(no reason given)"}. It happens from ${formatClock(cal, e.span[0])} (its beats from ${formatClock(cal, input.at)}); it is now ${formatClock(cal, input.walkOn?.now ?? input.state.clock)}.`,
    `Its beats:\n${input.beats.map((b) => beatText(input.world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
    `The world changes it would make:\n${input.effects.map((w, i) => `${i + 1}. ${w}`).join("\n") || "- (none)"}`,
  ];
}

/**
 * The author reads one page of a draft's pins (W5), in story order, with what the earlier pages came
 * to and the chat's archive to hand (`tools`, JSON rounds as the setup reads them): whether the draft
 * holds against it, or what on it contradicts the draft and what that forces. An answer that names
 * neither fails (`DepthAnswerError`).
 */
export async function settlePage(input: Omit<SettleInput, "pins" | "pages"> & { page: { index: number; of: number; span: string; pins: readonly { ref: string; beat: BeatText }[] }; before: readonly PageVerdict[]; tools: readonly AgentTool[] }): Promise<PageVerdict & { reads: string[] }> {
  const names = namesOf(input.world, input.state);
  const { page, tools } = input;
  const data = [
    ...draftData(input, names),
    `What the earlier pages came to:\n${input.before.length > 0 ? pagesText(input.before) : "- (this is the first page)"}`,
    `Page ${page.index} of ${page.of} of its pins (${page.span}), in story order:\n${page.pins.map((b) => beatText(input.world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
    tools.length > 0
      ? `The chat's archive, its own prose as it was written, is yours to read before you answer: answer {"archive": [{"tool": a tool's name, then its arguments}]} alone, and what each read found comes back; up to ${ARCHIVE_ROUNDS} rounds of reading, then you answer this page. Its tools:\n${toolsText(tools)}`
      : "The chat's archive can't be read for this page.",
  ].join("\n\n");
  const { answer: a, reads } = await askReading(input, talkOf(input, OFFSCREEN_TEXT.settlePage, data), tools, "this page");
  const verdict = a.verdict === "holds" || a.verdict === "contradicts" ? a.verdict : null;
  if (verdict === null) throw new DepthAnswerError("author", JSON.stringify(a));
  return { page: page.index, of: page.of, span: page.span, verdict, why: answerWhy(a), forces: list(a.forces).map(text).filter((f) => f !== ""), reads };
}

/** How the author settles a draft's beat: kept as it is, kept with adjusted words, or left out. */
export interface BeatVerdict {
  keep: boolean;
  what?: string;
  surface?: string;
  quotes?: string;
  /** The beat's deed, restated for the beat as settled (L-9): absent, a rewritten beat keeps none. */
  deed?: string;
}

export interface SettleAnswer extends StageCost {
  /** A walk-on answers settle, drop or redate; the poll's settlement settle, drop or redraft. */
  verdict: "settle" | "drop" | "redraft" | "redate";
  why: string;
  /** Each of the draft's beats by ref; one the answer doesn't name is kept as it is. */
  beats: Map<string, BeatVerdict>;
  /** Each world change by its number (1-based, as the author reads them); one not named is kept. */
  effects: Map<number, boolean>;
  /** What someone attempts now, for the GM to resolve, where the world must change otherwise. */
  attempts: { who: EntityId; attempt: string }[];
  /** A redraft's or a re-date's start, in story minutes from now (a re-date's always one at least). */
  redraft: { in: number } | null;
  refused: string[];
}

/**
 * The author reads a draft against its pins (§4.6): settle it, adjusted only where they force it;
 * drop it; or redraft it for later. A walk-on (`walkOn`) is the same reading as the player's scene
 * reaches it, whose third way is a re-date past the scene: one that says no time can't be read.
 */
export async function settleRead(input: SettleInput): Promise<SettleAnswer> {
  const { world, state } = input;
  const names = namesOf(world, state);
  const walkOn = input.walkOn;
  const data = [
    ...draftData(input, names),
    ...(walkOn ? [`What of this scene it holds:\n${walkOn.reach.map((r) => `- ${r}`).join("\n") || "- (nothing)"}`] : []),
    input.pages ? `Its pins, every beat since its story time, read a page at a time in story order; what each page came to:\n${pagesText(input.pages)}` : `Its pins, every beat since its story time:\n${input.pins.map((b) => beatText(world, names, b.ref, b.beat)).join("\n") || "- (none)"}`,
  ].join("\n\n");
  const asked = await ask(input, walkOn ? OFFSCREEN_TEXT.walkOn : OFFSCREEN_TEXT.settle, data);
  const a = asked.answer;
  const refused: string[] = [];
  const refs = new Set(input.beats.map((b) => b.ref));
  const later = a.verdict === "redraft" || a.verdict === "redate";
  const verdict = a.verdict === "drop" ? "drop" : later ? (walkOn ? "redate" : "redraft") : "settle";
  const beats = new Map<string, BeatVerdict>();
  for (const r of list(a.beats)) {
    const b = record(r);
    const ref = b ? text(b.ref) : "";
    if (!b || !refs.has(ref)) {
      if (ref !== "") refused.push(`a beat the draft doesn't hold (${ref})`);
      continue;
    }
    const what = text(b.what);
    const surface = text(b.surface);
    const quotes = spoken(b.quotes);
    const deed = text(b.deed);
    beats.set(ref, { keep: b.keep !== false, ...(what !== "" ? { what } : {}), ...(surface !== "" ? { surface } : {}), ...(quotes !== "" ? { quotes } : {}), ...(deed !== "" ? { deed } : {}) });
  }
  const effects = new Map<number, boolean>();
  for (const r of list(a.effects)) {
    const x = record(r);
    const index = x && typeof x.index === "number" && Number.isInteger(x.index) ? x.index : 0;
    if (!x || index < 1 || index > input.effects.length) continue;
    effects.set(index, x.keep !== false);
  }
  const attempts: SettleAnswer["attempts"] = [];
  for (const r of list(a.attempts)) {
    const x = record(r);
    const who = x ? names.person(x.who) : null;
    const attempt = x ? text(x.attempt) : "";
    if (!x || attempt === "") continue;
    if (!who) {
      refused.push(`an attempt named someone the chat doesn't have (${text(x.who) || "no one"})`);
      continue;
    }
    if (who === input.pov) {
      refused.push(`${tag(names, who)} is the player's own: his acts are never decided off screen`);
      continue;
    }
    attempts.push({ who, attempt });
  }
  const rd = record(a.redate) ?? record(a.redraft);
  const minutes = rd && typeof rd.in === "number" && Number.isFinite(rd.in) ? Math.round(rd.in) : 0;
  if (verdict === "redate" && minutes < 1) {
    asked.read.drop("verdict", a.verdict, "a re-date that says no time a minute or more past the scene");
    throw new DepthAnswerError("author", JSON.stringify(a));
  }
  const redraft = later ? { in: minutes } : null;
  // A page found the draft contradicted (W5): it can't settle exactly as drafted. Said back, and asked again.
  const contradicted = (input.pages ?? []).filter((p) => p.verdict === "contradicts");
  if (verdict === "settle" && contradicted.length > 0 && beats.size === 0 && [...effects.values()].every((k) => k) && attempts.length === 0) {
    asked.read.drop("verdict", a.verdict, `a settlement that changes nothing, though page${contradicted.length === 1 ? "" : "s"} ${contradicted.map((p) => p.page).join(", ")} found the draft contradicted`);
    throw new DepthAnswerError("author", JSON.stringify(a));
  }
  return {
    verdict,
    why: text(a.why),
    beats,
    effects,
    attempts,
    redraft,
    refused,
    ...(asked.reasoning ? { reasoning: asked.reasoning } : text(a.reasoning) !== "" ? { reasoning: text(a.reasoning) } : {}),
    ...(asked.usage ? { usage: asked.usage } : {}),
  };
}
