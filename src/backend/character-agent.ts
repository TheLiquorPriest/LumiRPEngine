// The character agent's modes and the point-of-view render (DEPTH-PLAN §4.4, §5.2): pure stages
// that make their model call through the port they are given (`depth/port.ts`) and return what the
// agent wrote as events (each file's `engine.ws.write` then its `minds.v2.write`, after the
// batch's `minds.v2.lived`), with the blobs those events name. They never land anything: inside a
// turn the events ride its record, between turns their caller lands them as a basis-anchored layer
// entry (§4.9), so a fold, a Re-narrate and a replay never call a model.
//
//   catchUp     lives a batch of pending points of view, in order, and answers as remembering does
//   remember    when a scene ends for the character: the scene as it lived it, with its own takes
//   reflect     takes stock: self, on my mind, beliefs, people and plans, with core first
//   interview   a question in voice; only an answer marked neutral to the world folds into the mind
//   povRender   the truth-blind render: what reached each person a beat reached in part (or whole,
//               with someone they don't know), each person named only as its perceiver may name them
//   seedCore    core.md from a card, the world's own description, an imported entry or the history (D-17), no model call
//
// What a stage reads is what the character lived and its own mind, by construction: its inputs
// carry no beat's truth, no other mind and no one's take, and a memory may cite only the beats of
// its own batch. What the agent keeps is its own judgment; the stages only check an answer's shape
// and keep the user's pinned edits and the core out of its reach. Each answer is read through the
// shared `Reading` (`depth/common.ts`), so whatever of it isn't kept as written, an answer that isn't
// JSON included, is told to the call's keeper.

import { CHARACTER_TEXT } from "../shared/character-prompts";
import {
  MEMORIES_DIR,
  heardAlone,
  MIND_FILE_NAMES,
  PEOPLE_DIR,
  memoryName,
  memoryPath,
  mindFileWrite,
  mindInterviewEvent,
  mindLivedEvent,
  mindDir,
  mindPath,
  personPath,
  pinnedBy,
  type CoreSource,
  type InterviewAsker,
  type MindFileMeta,
  type MindMode,
  type MindPlanRef,
  type MindSingleKind,
  type ReachAs,
} from "../shared/character-engine";
import type { EntityId, UserId } from "../shared/ids";
import type { PackEvent } from "../shared/ledger";
import { PLAN_KINDS, type PlanKind } from "../shared/minds";
import type { PromptTexts } from "../shared/prompts";
import { exposureChannels, type Exposure } from "../shared/story";
import { hasOwn } from "../shared/json";
import { neutralizeMacros } from "../shared/macros";
import { addUsage, NO_USAGE, type ModelPort, type PortMessage, type PortUsage } from "./depth/port";
import { Reading, readAnswer, sameName } from "./depth/common";
import type { HostCharacter } from "./host";
import { renderPrompt } from "./prompts";

/** What a mind-writing stage returns: its events in fold order, the blobs they name (put them before landing), the call's reasoning and what it cost. */
export interface StageOut {
  events: PackEvent[];
  blobs: Record<string, string>;
  reasoning?: string;
  usage: PortUsage;
  /** A catch-up's files handed to it to rewrite that its answer gave no verdict on, asked twice: they stay out of the mind (§4.2, Retcons propagate). Absent when every one had a verdict, or the answer didn't read. */
  inert?: string[];
}

/** A mind's files as a stage reads them: path under the mind's folder ("core.md", "memories/000012345-1.md") → text. */
export type MindFiles = Readonly<Record<string, string>>;

/** What every mode is given: whose mind, its name, the story minute it writes at (its basis'), its files, and their bookkeeping (for pins and retcons). */
export interface MindInput {
  who: EntityId;
  name: string;
  /** The story minute the call writes at: its basis' clock. */
  at: number;
  mind: MindFiles;
  /** Each file's bookkeeping, by path under the folder (`mindMetaAt`): pinned files stay the user's. */
  meta?: Readonly<Record<string, MindFileMeta>>;
  /**
   * The people it may name by id: those it knows (its people files' ids are added), never anyone it
   * hasn't met; id → the name it knows them by. A name it writes that is none of these stays its own words.
   */
  known?: Readonly<Record<EntityId, string>>;
  /** Its people files to show, by id; absent: all of them. */
  people?: readonly EntityId[];
  /** Reads a time it wrote ("2026-10-19 18:30") as a story minute; null when it isn't one. */
  timeOf?: (text: string) => number | null;
  /** Reads a place it named as a place id; null when it names none. */
  placeOf?: (text: string) => string | null;
  /** Reads an amount it wrote ("$20", 20) as the world currency's minor units; null when it isn't one. */
  moneyOf?: (text: string) => number | null;
  /** The user's own texts (Settings → Prompts), by id. */
  texts?: PromptTexts;
  signal?: AbortSignal;
}

/** One point of view a character lived: the beat's id and minute, when and where in its words, what reached it, whether whole, the exact words where whole, and how it lived it where that wasn't as what it sensed. */
export interface LivedPov {
  beat: string;
  at: number;
  /** The story time in words ("Tuesday 14 May, 08:40"). */
  when?: string;
  /** Where it was, as the character would know the place: none for a message, received elsewhere or sent from wherever it was. */
  where?: string;
  channel?: string;
  whole: boolean;
  /** How it lived it (`reachOf`), where not as what it sensed: its own act, from the inside (`inside`), as it did it (`deed`) or as those there could sense it (`act`), or a message it received (`message`), whose text is the message's words. */
  as?: Exclude<ReachAs, "sensed">;
  /** A message's senders, by id: named as it knows them, else as someone it doesn't know. */
  from?: readonly EntityId[];
  text: string;
  /** Exact words: given only where they reached it whole. */
  quotes?: string;
}

/**
 * What of its mind a catch-up rewrites after an amendment or a strike (§4.2, Retcons propagate): the
 * beats that went otherwise, by id and as they had reached it, and the files whose latest write drew
 * on them, each rewritten whole at its own path (a file that drew on other beats too included).
 */
export interface MindRewrite {
  /** The ids of the beats an amendment or a strike replaced: a rewrite no longer draws on them. */
  gone: readonly string[];
  /** Those beats as they had reached it, in story order. */
  was: readonly LivedPov[];
  /** Path under the mind's folder → the file as it wrote it then. */
  files: Readonly<Record<string, string>>;
}

export interface CatchUpInput extends MindInput {
  /** In story order. */
  lived: readonly LivedPov[];
  rewrite?: MindRewrite;
}

export interface RememberInput extends CatchUpInput {
  /** Its own takes as it played the scene (A2's play), in order. */
  takes: readonly string[];
}

export interface InterviewInput extends MindInput {
  question: string;
  by: InterviewAsker;
  /** The author or the GM marked it neutral to the world: asked in its world's terms, revealing nothing it hasn't lived. Only then does the answer fold into the mind. */
  neutral: boolean;
}

/** One person a beat's staging places, by id: how each perceiver may name them is its own (`PovRefs`). */
export interface PovStaging {
  who: EntityId;
  where: string;
  doing: string;
  occluded?: string;
}

/**
 * How one perceiver may name the people of a beat's moment (`povRefs`): itself as "you"; each other
 * person there by the name it knows them by, or, for someone it doesn't know, by no name: only as
 * they appear. `absent`: the names it knows of people who weren't there, which its point of view may
 * not use (`unseenNames`). `strangers`: the names of those there it doesn't know, which never reach
 * the render and which a fallback tells as "someone" (`povFallback`). `world`: the names of the world,
 * its places and its things. A word that is one of theirs or of anyone there's never counts alone as
 * naming someone who wasn't there.
 */
export interface PovRefs {
  /** Its own name. */
  self: string;
  /** Each other person of the moment → the name it knows them by, or null: someone it doesn't know. */
  present: Readonly<Record<EntityId, string | null>>;
  absent: readonly string[];
  strangers: readonly string[];
  world: readonly string[];
}

/**
 * The point-of-view render's input (§4.2): what was there to sense and the exact words, what its
 * actors did as they did it (`deed`, shown only to those whose own act it is), who acted and who it
 * reached (by what and how fully), where everyone was (each perceiver shown only what its senses
 * reached of it, `stagingFor`), and how each perceiver may name each person there. It has no place
 * for the beat's truth, a mind or a take, so the render can't leak what it never sees.
 */
export interface PovInput {
  beat: { id: string; surface: string; deed?: string; quotes?: string; actors: readonly EntityId[]; exposure: readonly Pick<Exposure, "who" | "channel" | "also" | "reach">[] };
  staging: readonly PovStaging[];
  /** The people whose points of view to write. */
  who: readonly EntityId[];
  /** How each of them may name the people of the moment (`povRefs`). */
  refs: Readonly<Record<EntityId, PovRefs>>;
  texts?: PromptTexts;
  signal?: AbortSignal;
}

export interface PovOut {
  /** A point of view for everyone asked: the render's, else the plain one it falls back to (`fellBack`). */
  povs: Record<EntityId, string>;
  /** Those whose point of view the render, asked twice, wrote naming someone who wasn't there (`unseenNames`), with the names, or didn't write (no names): theirs is the fallback (`povFallback`), never left out. */
  fellBack: Record<EntityId, string[]>;
  reasoning?: string;
  usage: PortUsage;
}

// ------------------------------------------------------------------ the mind as a prompt

const TEXTS: PromptTexts = {};

/** A section of the context: its heading and text, or nothing when there is no text. */
function section(heading: string, text: string | undefined): string {
  const body = text?.trim() ?? "";
  return body === "" ? "" : `## ${heading}\n${body}`;
}

/** A mind's single file's text, or undefined. */
function single(mind: MindFiles, kind: MindSingleKind): string | undefined {
  return mind[MIND_FILE_NAMES[kind]];
}

/** The people files a call shows: the ones asked for, else all, by id, each with the name it knows them by. */
function peopleFiles(input: MindInput): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const [rel, text] of Object.entries(input.mind)) {
    if (!rel.startsWith(PEOPLE_DIR) || !rel.endsWith(".md")) continue;
    const id = rel.slice(PEOPLE_DIR.length, -3);
    if (input.people === undefined || input.people.includes(id)) out.push({ id, text });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The names it may use for people, by id: those it was told it knows, and everyone it has a file on. */
export function knownNames(input: MindInput): Record<string, string> {
  const out: Record<string, string> = { ...(input.known ?? {}) };
  for (const rel of Object.keys(input.mind)) {
    if (!rel.startsWith(PEOPLE_DIR) || !rel.endsWith(".md")) continue;
    const id = rel.slice(PEOPLE_DIR.length, -3);
    out[id] ??= id;
  }
  delete out[input.who];
  return out;
}

/** The single files the stable prefix shows, in order (`systemOf`): core, its story of itself, what it keeps in mind. */
const PREFIX_FILES = [["core", "Who you are at root"], ["self", "Your story of yourself"], ["mind", "What you keep in mind"]] as const satisfies readonly (readonly [MindSingleKind, string])[];
/** The single files the rest of the context shows, in order (`mindContext`): how it is now, its beliefs, its plans. */
const CONTEXT_FILES = [["now", "How you are right now"], ["beliefs", "What you believe"], ["plans", "What you mean to do"]] as const satisfies readonly (readonly [MindSingleKind, string])[];

/**
 * The system message: the agent's system prompt, then the stable prefix that makes each call start
 * as the same person (§4.4, How it stays itself): core first, then its story of itself and what it
 * keeps in mind. Every mode's, a play's included (`depth/scene/play.ts`).
 */
export function systemOf(input: MindInput): PortMessage {
  const texts = input.texts ?? TEXTS;
  const parts = [renderPrompt(CHARACTER_TEXT.system, texts, { name: input.name }), ...PREFIX_FILES.map(([kind, heading]) => section(heading, single(input.mind, kind)))];
  return { role: "system", content: parts.filter((p) => p !== "").join("\n\n") };
}

/** The rest of the mind a call reads: how it is right now, what it believes, its plans, and the people it knows, with the ids it may name them by. */
export function mindContext(input: MindInput): string {
  const people = peopleFiles(input);
  const names = knownNames(input);
  const named = Object.entries(names).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    ...CONTEXT_FILES.map(([kind, heading]) => section(heading, single(input.mind, kind))),
    people.length > 0 ? `## The people you know\n${people.map((p) => `### ${names[p.id] && names[p.id] !== p.id ? `${names[p.id]} (${p.id})` : p.id}\n${p.text.trim()}`).join("\n\n")}` : "",
    named.length > 0 ? `## People you can name, by id\n${named.map(([id, name]) => (name === id ? `- ${id}` : `- ${id}: ${name}`)).join("\n")}` : "",
  ]
    .filter((p) => p !== "")
    .join("\n\n");
}

/** The files of its mind that `systemOf` and `mindContext` show, by path under its folder: what a call made of the two read of it (a draft's inputs, §4.6). */
export function shownFiles(input: MindInput): string[] {
  const singles = [...PREFIX_FILES, ...CONTEXT_FILES].map(([kind]) => MIND_FILE_NAMES[kind]).filter((rel) => (input.mind[rel]?.trim() ?? "") !== "");
  return [...singles, ...peopleFiles(input).map((p) => `${PEOPLE_DIR}${p.id}.md`)];
}

/**
 * How a point of view reached it, as its heading says: its own act (from the inside or as it did it,
 * or as those there could see and hear it), a message to it from whom it came (by the name it knows
 * them by, in `names`, else as someone it doesn't know), or what it sensed, whole or in part.
 */
export function reachedHow(p: Pick<LivedPov, "as" | "whole" | "from">, names: Readonly<Record<string, string>> = {}): string {
  if (p.as === "inside" || p.as === "deed") return "(your own act)";
  if (p.as === "act") return "(your own act, as those there could see and hear it)";
  if (p.as === "message") {
    const from = [...new Set((p.from ?? []).map((id) => (hasOwn(names, id) ? (names[id] ?? id) : "someone you don't know")))];
    return from.length > 0 ? `(a message to you from ${from.join(" and ")})` : "(a message to you)";
  }
  return p.whole ? "(it reached you whole)" : "(it reached you in part)";
}

/** The points of view of a batch, in order, each by its beat's id (`ids: false`: without it, for beats it no longer lives); `names`: the people it may name, by id (`knownNames`), for whom a message came from. */
export function livedText(lived: readonly LivedPov[], o: { ids?: boolean; names?: Readonly<Record<string, string>> } = {}): string {
  return lived
    .map((p) => {
      const head = [o.ids === false ? undefined : `[beat ${p.beat}]`, p.when, p.where ? `at ${p.where}` : undefined, reachedHow(p, o.names)].filter((s): s is string => s !== undefined && s !== "").join(" ");
      const words = p.as !== "message" && p.whole && p.quotes && p.quotes.trim() !== "" ? `\nWords said: ${p.quotes.trim()}` : "";
      return `${head}\n${p.text.trim()}${words}`;
    })
    .join("\n\n");
}

/** The model's call, its text and its answer as an object (null when the answer holds none, which its keeper is told), with the `Reading` its fields are read through. */
async function ask(model: ModelPort, role: "character" | "pov", messages: PortMessage[], signal: AbortSignal | undefined): Promise<{ answer: Record<string, unknown> | null; read: Reading; text: string; reasoning?: string; usage: PortUsage }> {
  const r = await model(role, messages, { json: true, ...(signal ? { signal } : {}) });
  const { answer, read } = readAnswer(role, r);
  return { answer, read, text: r.text, ...(r.reasoning ? { reasoning: r.reasoning } : {}), usage: addUsage(NO_USAGE, r.usage) };
}

/** A non-blank text, trimmed; else null. */
export function textIn(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** A list of non-blank texts, trimmed; anything else empty. */
export function textsIn(v: unknown): string[] {
  return Array.isArray(v) ? v.map(textIn).filter((t): t is string => t !== null) : [];
}

// ------------------------------------------------------------------ answers as writes

/** What a stage builds its writes with: the call's input, its mode, the beats it lived (for citations), the `Reading` its answer is read through, and what it has written so far. */
export class Writes {
  readonly events: PackEvent[] = [];
  readonly blobs: Record<string, string> = {};
  /** The files handed to it after an amendment or a strike that an answer gave a verdict on (`rewrites`). */
  readonly verdicts = new Set<string>();
  /** The files it wrote, by path under the mind's folder. */
  readonly written = new Set<string>();
  private readonly taken = new Set<string>();
  private readonly meta: Readonly<Record<string, MindFileMeta>>;

  constructor(
    private readonly input: MindInput,
    private readonly mode: MindMode,
    private readonly lived: readonly string[],
    private readonly read: Reading = new Reading(),
  ) {
    this.meta = input.meta ?? {};
    // Every file's name is taken, those a retcon left out of the mind included, so a new memory never lands on one.
    for (const rel of [...Object.keys(input.mind), ...Object.keys(this.meta)]) if (rel.startsWith(MEMORIES_DIR) && rel.endsWith(".md")) this.taken.add(rel.slice(MEMORIES_DIR.length, -3));
  }

  /** An id it named for a person or a place: one it may name, by id or by the name it knows them by, as an answer may write a name (`sameName`); else null. */
  person(said: string): EntityId | null {
    const names = knownNames(this.input);
    if (hasOwn(names, said)) return said;
    const hit = Object.entries(names).filter(([, name]) => sameName(said, name));
    return hit.length === 1 ? (hit[0]?.[0] ?? null) : null;
  }

  /** What a write is about (`field` of the answer): the ids it named that it may name, and places it named that are places; any other name is dropped. */
  about(field: string, raw: unknown): string[] {
    const out: string[] = [];
    for (const [k, v] of this.read.list(field, raw).entries()) {
      const said = this.read.text(`${field}[${k}]`, v);
      if (said === "") continue;
      const id = this.person(said) ?? this.input.placeOf?.(said) ?? null;
      if (id === null) this.read.drop(`${field}[${k}]`, said, "no one or nowhere it may name");
      else if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  /** Writes `text` to a file under the mind's folder, unless the user's edit pins it or it is the core; whether it was written. */
  file(rel: string, path: string, text: string, extra: { lived?: readonly string[]; about?: readonly string[]; plans?: MindPlanRef[]; supersedes?: string } = {}): boolean {
    if (rel === MIND_FILE_NAMES.core || pinnedBy(this.meta[rel], rel)) return false;
    if ((this.input.mind[rel] ?? "").trim() === text.trim() && (extra.plans === undefined || extra.plans.length === 0)) return false;
    const w = mindFileWrite({ who: this.input.who, path, at: this.input.at, mode: this.mode, lived: [...(extra.lived ?? this.lived)], about: [...(extra.about ?? [])], ...(extra.plans && extra.plans.length > 0 ? { plans: extra.plans } : {}), ...(extra.supersedes !== undefined ? { supersedes: extra.supersedes } : {}) }, text);
    this.events.push(...w.events);
    Object.assign(this.blobs, w.blobs);
    this.written.add(rel);
    return true;
  }

  /**
   * An answer's verdicts on the files it was handed after an amendment or a strike (§4.2, Retcons
   * propagate), each at its own path: `{"verdict": "rewrite", "text": …}` writes the file whole,
   * drawing on what it drew on still and on the batch; `{"verdict": "keep"}` writes it as it was
   * (the same body), drawing on what it drew on still. Either supersedes the first replaced beat it
   * drew on, so it is back in the mind and its recall without the old beat. Anything else is no
   * verdict, told to the keeper of the call it came from (`read`: the one asked again, for its answer).
   */
  rewrites(rw: MindRewrite, raw: unknown, read: Reading = this.read): void {
    const verdicts = read.record("rewrites", raw);
    if (!verdicts) return;
    const gone = new Set(rw.gone);
    const dir = mindDir(this.input.who);
    for (const [said, v] of Object.entries(verdicts)) {
      const field = `rewrites[${JSON.stringify(said)}]`;
      const rel = said.trim().startsWith(dir) ? said.trim().slice(dir.length) : said.trim();
      if (!hasOwn(rw.files, rel) || this.verdicts.has(rel)) {
        read.drop(field, v, hasOwn(rw.files, rel) ? "a second verdict on one file" : "no file it was handed");
        continue;
      }
      const r = read.record(field, v);
      if (!r) continue;
      const verdict = typeof r.verdict === "string" ? r.verdict.trim().toLowerCase() : "";
      const text = verdict === "keep" ? (rw.files[rel] ?? null) : verdict === "rewrite" ? textIn(r.text) : null;
      if (text === null) {
        read.drop(field, r, verdict === "rewrite" ? "a rewrite with no text" : "neither keep nor rewrite");
        continue;
      }
      const meta = this.meta[rel];
      const still = (meta?.lived ?? []).filter((b) => !gone.has(b));
      const supersedes = meta?.lived.find((b) => gone.has(b));
      this.verdicts.add(rel);
      this.file(rel, `${dir}${rel}`, text, { lived: verdict === "keep" ? still : [...new Set([...still, ...this.lived])], about: meta?.about ?? [], ...(supersedes !== undefined ? { supersedes } : {}) });
    }
  }

  /** The mind's `kind` file from `field` of the answer, where it wrote one. */
  single(kind: MindSingleKind, field: string, raw: unknown, extra: { lived?: readonly string[]; plans?: MindPlanRef[] } = {}): void {
    const text = this.read.text(field, raw);
    if (text !== "") this.file(MIND_FILE_NAMES[kind], mindPath(this.input.who, kind), text, extra);
  }

  /** Its people files from `field` of the answer: each by the id or the name it knows them by, its own words where it knows no id; never one of itself. */
  people(field: string, raw: unknown, lived?: readonly string[]): void {
    const files = this.read.record(field, raw);
    if (!files) return;
    for (const [key, value] of Object.entries(files)) {
      const at = `${field}[${JSON.stringify(key)}]`;
      const text = this.read.text(at, value);
      if (text === "") continue;
      const id = this.person(key) ?? key.trim();
      if (id === "" || id === this.input.who) {
        this.read.drop(at, text, "a file of no one, or of itself");
        continue;
      }
      const path = personPath(this.input.who, id);
      this.file(path.slice(mindDir(this.input.who).length), path, text, { ...(lived ? { lived } : {}), about: [id] });
    }
  }

  /** The plans its answer laid out (`field`, its `planned`), each with what it could read of when and until, its kind, where, with whom and what it hands over. */
  plans(field: string, raw: unknown): MindPlanRef[] {
    const out: MindPlanRef[] = [];
    for (const [i, p] of this.read.list(field, raw).entries()) {
      const g = `${field}[${i}]`;
      const r = this.read.record(g, p);
      if (!r) continue;
      const what = textIn(r.what);
      if (what === null) {
        this.read.drop(g, r, "a plan with no what");
        continue;
      }
      const whenWords = this.read.text(`${g}.when`, r.when);
      const when = whenWords === "" ? undefined : (this.input.timeOf?.(whenWords) ?? whenWords);
      const untilWords = this.read.text(`${g}.until`, r.until);
      const until = untilWords === "" || typeof when !== "number" ? null : (this.input.timeOf?.(untilWords) ?? null);
      if (untilWords !== "" && (until === null || typeof when !== "number" || until < when)) this.read.drop(`${g}.until`, untilWords, typeof when !== "number" ? "its plan has no time it can read to run from" : until === null ? "no time it can read" : "before the plan starts");
      const kindWord = this.read.text(`${g}.kind`, r.kind).toLowerCase();
      const kind = (PLAN_KINDS as readonly string[]).includes(kindWord) ? (kindWord as PlanKind) : null;
      if (kind === null) this.read.drop(`${g}.kind`, kindWord, "no kind of plan");
      const whereWords = this.read.text(`${g}.where`, r.where);
      const where = whereWords === "" ? null : (this.input.placeOf?.(whereWords) ?? null);
      if (where === null) this.read.drop(`${g}.where`, whereWords, "no place it knows");
      const withIds: string[] = [];
      for (const [k, s] of this.read.list(`${g}.with`, r.with).entries()) {
        const said = this.read.text(`${g}.with[${k}]`, s);
        const id = said === "" ? null : this.person(said);
        if (id !== null) withIds.push(id);
        else this.read.drop(`${g}.with[${k}]`, said, "no one it may name");
      }
      const amount = typeof r.amount === "number" ? String(r.amount) : this.read.text(`${g}.amount`, r.amount);
      const cents = amount === "" ? null : (this.input.moneyOf?.(amount) ?? null);
      const paid = cents !== null && Number.isInteger(cents) && cents > 0;
      if (!paid) this.read.drop(`${g}.amount`, amount, "no amount of money");
      out.push({
        what,
        ...(when !== undefined ? { when } : {}),
        ...(until !== null && typeof when === "number" && until >= when ? { until } : {}),
        ...(kind !== null ? { kind } : {}),
        ...(where !== null ? { where } : {}),
        ...(withIds.length > 0 ? { with: withIds } : {}),
        ...(paid ? { cents } : {}),
      });
    }
    return out;
  }

  /**
   * plans.md's new text from `field` of the answer: its own; else, when it laid out plans without
   * rewriting the file, the file as it stands (the plans ride its write), or, with no file yet, those
   * plans in its own words.
   */
  plansText(field: string, raw: unknown, planned: readonly MindPlanRef[]): string | null {
    const own = this.read.text(field, raw);
    if (own !== "") return own;
    if (planned.length === 0) return null;
    const current = single(this.input.mind, "plans")?.trim() ?? "";
    return current !== "" ? current : planned.map((p) => `- ${p.what}`).join("\n");
  }

  /** A memory, named by when what it cites happened: unique in the mind, the same however often the same call is run. */
  memory(text: string, lived: readonly string[], about: readonly string[], at: number): void {
    const name = memoryName(at, this.taken);
    this.taken.add(name);
    const path = memoryPath(this.input.who, name);
    this.file(`${MEMORIES_DIR}${name}.md`, path, text, { lived, about });
  }
}

/**
 * The answer to catch up or remember, as writes, read through its call's `Reading`: the batch lived,
 * the verdicts on the files it was handed after an amendment or a strike (`Writes.rewrites`), its
 * memories citing only its own beats, then the rest of its mind it rewrote. An answer that doesn't
 * read as one gives no events at all, not even the lived batch, so its beats stay pending for the
 * next call rather than lived with nothing kept.
 */
function keepAnswer(input: CatchUpInput, mode: MindMode, answer: Record<string, unknown> | null, read: Reading): Writes {
  const ids = input.lived.map((p) => p.beat);
  const w = new Writes(input, mode, ids, read);
  if (!answer) return w;
  if (ids.length > 0) w.events.push(mindLivedEvent({ who: input.who, beats: ids, at: input.at, mode }));
  if (input.rewrite) w.rewrites(input.rewrite, answer.rewrites);
  const minute = new Map(input.lived.map((p) => [p.beat, p.at]));
  for (const [i, raw] of read.list("memories", answer.memories).entries()) {
    const g = `memories[${i}]`;
    const m = read.record(g, raw);
    if (!m) continue;
    const text = textIn(m.text);
    if (text === null) {
      read.drop(g, m, "a memory with no text");
      continue;
    }
    // A memory cites only beats of its own batch; one that cites none cites the whole batch.
    const cited: string[] = [];
    for (const [k, id] of read.list(`${g}.lived`, m.lived).entries()) {
      const beat = read.text(`${g}.lived[${k}]`, id);
      if (minute.has(beat)) cited.push(beat);
      else read.drop(`${g}.lived[${k}]`, beat, "no beat of its batch");
    }
    const lived = cited.length > 0 ? [...new Set(cited)] : ids;
    const at = Math.min(...lived.map((id) => minute.get(id) ?? input.at));
    w.memory(text, lived, w.about(`${g}.about`, m.about), Number.isFinite(at) ? at : input.at);
  }
  w.single("beliefs", "beliefs", answer.beliefs);
  w.people("people", answer.people);
  const plans = w.plans("planned", answer.planned);
  w.single("plans", "plans", w.plansText("plans", answer.plans, plans), { plans });
  w.single("now", "now", answer.now);
  w.single("mind", "on_my_mind", answer.on_my_mind);
  return w;
}

function out(w: Writes, r: { reasoning?: string; usage: PortUsage }): StageOut {
  return { events: w.events, blobs: w.blobs, ...(r.reasoning ? { reasoning: r.reasoning } : {}), usage: r.usage };
}

// ------------------------------------------------------------------ the modes

/** A catch-up's sections for the files it is handed after an amendment or a strike: the beats as they had reached it, then each file as it wrote it then. */
function rewriteSections(rw: MindRewrite, files: readonly string[], names: Readonly<Record<string, string>>): string[] {
  return [
    rw.was.length > 0 ? `## What went otherwise\n${livedText(rw.was, { ids: false, names })}` : "",
    `## What you wrote from it\n${[...files]
      .sort()
      .map((rel) => `### ${rel}\n${(rw.files[rel] ?? "").trim()}`)
      .join("\n\n")}`,
  ];
}

/**
 * Catch up (§4.4): one call lives a batch of pending points of view, in order, and answers as
 * remembering does. How a character the author played or handled, one off stage, one in an
 * episode, or one in the bootstrap's history forms its own memories. Handed files to rewrite after
 * an amendment or a strike (`rewrite`), its answer gives each a verdict, rewrite or keep; those it
 * leaves without one are asked once more, alone, and any still without one are `inert`.
 */
export async function catchUp(model: ModelPort, input: CatchUpInput): Promise<StageOut> {
  const texts = input.texts ?? TEXTS;
  const rw = input.rewrite && Object.keys(input.rewrite.files).length > 0 ? input.rewrite : null;
  const names = knownNames(input);
  const reached = input.lived.length > 0 ? `## What reached you\n${livedText(input.lived, { names })}` : "";
  const user = [
    mindContext(input),
    reached,
    input.lived.length > 0 ? renderPrompt(CHARACTER_TEXT.catchUp, texts, { name: input.name }) : "",
    ...(rw ? rewriteSections(rw, Object.keys(rw.files), names) : []),
    rw ? renderPrompt(CHARACTER_TEXT.rewrite, texts, { name: input.name }) : "",
    renderPrompt(CHARACTER_TEXT.keepAnswer, texts, {}),
    rw ? renderPrompt(CHARACTER_TEXT.rewriteAnswer, texts, {}) : "",
  ]
    .filter((p) => p !== "")
    .join("\n\n");
  const r = await ask(model, "character", [systemOf(input), { role: "user", content: user }], input.signal);
  const w = keepAnswer(input, "catch-up", r.answer, r.read);
  const left = (): string[] => (rw ? Object.keys(rw.files).filter((rel) => !w.verdicts.has(rel) && !w.written.has(rel)) : []);
  const omitted = r.answer ? left() : [];
  if (!rw || omitted.length === 0) return out(w, r);
  // The files its answer gave no verdict on are asked about once more, alone, beside what reached it.
  const again = [mindContext(input), reached, ...rewriteSections(rw, omitted, names), renderPrompt(CHARACTER_TEXT.rewrite, texts, { name: input.name }), renderPrompt(CHARACTER_TEXT.rewriteAgain, texts, {})]
    .filter((p) => p !== "")
    .join("\n\n");
  const r2 = await ask(model, "character", [systemOf(input), { role: "user", content: again }], input.signal);
  w.rewrites({ ...rw, files: Object.fromEntries(omitted.map((rel) => [rel, rw.files[rel] ?? ""])) }, r2.answer?.rewrites, r2.read);
  const inert = left();
  const reasoning = [r.reasoning, r2.reasoning].filter((s): s is string => s !== undefined && s !== "").join("\n\n");
  return { ...out(w, { ...(reasoning !== "" ? { reasoning } : {}), usage: addUsage(r.usage, r2.usage) }), ...(inert.length > 0 ? { inert } : {}) };
}

/** Remember (§4.4): when a scene ends for the character, it writes what it keeps of the scene as it lived it, with its own takes. */
export async function remember(model: ModelPort, input: RememberInput): Promise<StageOut> {
  const texts = input.texts ?? TEXTS;
  const takes = input.takes.filter((t) => t.trim() !== "");
  const user = [
    mindContext(input),
    `## The scene as you lived it\n${livedText(input.lived, { names: knownNames(input) })}`,
    takes.length > 0 ? `## Your own takes, as you had them\n${takes.map((t) => `- ${t.trim()}`).join("\n")}` : "",
    renderPrompt(CHARACTER_TEXT.remember, texts, { name: input.name }),
    renderPrompt(CHARACTER_TEXT.keepAnswer, texts, {}),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
  const r = await ask(model, "character", [systemOf(input), { role: "user", content: user }], input.signal);
  return out(keepAnswer(input, "remember", r.answer, r.read), r);
}

/** The memories a reflection reads: those written since it last took stock (all, when it never has), oldest first. */
function sinceLastStock(input: MindInput): { rel: string; text: string }[] {
  const meta = input.meta ?? {};
  const self = meta[MIND_FILE_NAMES.self];
  const last = self && self.mode === "reflect" ? self.at : -Infinity;
  return Object.entries(input.mind)
    .filter(([rel]) => rel.startsWith(MEMORIES_DIR))
    .filter(([rel]) => (meta[rel]?.at ?? Infinity) >= last)
    .map(([rel, text]) => ({ rel, text }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * Reflect (§4.4): reads its recent memories, what it keeps in mind, its beliefs, people, plans and
 * self, with core first; revises what it holds, rewrites self and on my mind, makes plans, lets
 * things go. Its writes cite the beats behind the memories it read, so a retcon finds them.
 */
export async function reflect(model: ModelPort, input: MindInput): Promise<StageOut> {
  const texts = input.texts ?? TEXTS;
  const recent = sinceLastStock(input);
  const lived = [...new Set(recent.flatMap((m) => input.meta?.[m.rel]?.lived ?? []))];
  const user = [
    mindContext(input),
    recent.length > 0 ? `## What you have lived since you last took stock\n${recent.map((m) => m.text.trim()).join("\n\n")}` : "## What you have lived since you last took stock\nNothing new.",
    renderPrompt(CHARACTER_TEXT.reflect, texts, { name: input.name }),
    renderPrompt(CHARACTER_TEXT.reflectAnswer, texts, {}),
  ].join("\n\n");
  const r = await ask(model, "character", [systemOf(input), { role: "user", content: user }], input.signal);
  const w = new Writes(input, "reflect", lived, r.read);
  if (r.answer) {
    w.single("self", "self", r.answer.self);
    w.single("mind", "on_my_mind", r.answer.on_my_mind);
    w.single("beliefs", "beliefs", r.answer.beliefs);
    w.people("people", r.answer.people);
    const plans = w.plans("planned", r.answer.planned);
    w.single("plans", "plans", w.plansText("plans", r.answer.plans, plans), { plans });
    w.single("now", "now", r.answer.now);
  }
  return out(w, r);
}

/**
 * Interview (§4.4): the author, the GM or the player asks it a question, and it answers in voice.
 * The question and answer are always recorded apart from the mind (a probe, readable in Minds);
 * only when the author or the GM marked the question neutral to the world does what answering
 * changed in its story of itself fold into the mind.
 */
export async function interview(model: ModelPort, input: InterviewInput): Promise<{ answer: string; folded: boolean; out: StageOut }> {
  const texts = input.texts ?? TEXTS;
  const user = [mindContext(input), renderPrompt(CHARACTER_TEXT.interview, texts, { name: input.name, question: input.question.trim() }), renderPrompt(CHARACTER_TEXT.interviewAnswer, texts, {})].filter((p) => p !== "").join("\n\n");
  const r = await ask(model, "character", [systemOf(input), { role: "user", content: user }], input.signal);
  const answer = r.read.text("answer", r.answer?.answer);
  const w = new Writes(input, "interview", [], r.read);
  const neutral = input.neutral && answer !== "";
  const probe = mindInterviewEvent({ who: input.who, at: input.at, by: input.by, question: input.question.trim(), answer: answer === "" ? "(no answer)" : answer, neutral });
  w.events.push(probe.event);
  Object.assign(w.blobs, probe.blobs);
  const before = w.events.length;
  if (neutral) w.single("self", "self", r.answer?.self);
  return { answer, folded: w.events.length > before, out: out(w, r) };
}

/** How a beat reached someone, each way in the render's words. */
const CHANNEL_WORDS: Readonly<Record<string, string>> = { sight: "by sight", hearing: "by hearing", touch: "by touch", told: "told of it", message: "by message", rumor: "by rumor", record: "from a record" };

/**
 * What `who` could sense of where everyone was as the moment began (§4.2), by id: its own line (where
 * it was, what it was doing, what blocked its view or hearing), then of the others only what the
 * senses the beat reached it by could reach: where each was, and by sight what each was doing;
 * nothing of them where it reached it only by message, word or record, elsewhere.
 */
function stagingFor(input: PovInput, who: EntityId): string[] {
  const x = input.beat.exposure.find((e) => e.who === who);
  const ways: readonly string[] = x ? exposureChannels(x) : [];
  const sees = ways.includes("sight");
  const senses = sees || ways.includes("hearing") || ways.includes("touch");
  const own = input.staging.filter((s) => s.who === who).map((s) => `- ${s.who}: ${s.where.trim()}; ${s.doing.trim()}${s.occluded && s.occluded.trim() !== "" ? `; blocked: ${s.occluded.trim()}` : ""}`);
  const others = senses ? input.staging.filter((s) => s.who !== who).map((s) => `- ${s.who}: ${s.where.trim()}${sees ? `; ${s.doing.trim()}` : ""}`) : [];
  return [...own, ...others];
}

/**
 * The render's request: what was there to sense and the exact words, and for each person to write,
 * how it reached them (and whether it was their own act, with what they did as they did it where the
 * beat says), what they could sense of where everyone was (`stagingFor`, by id), and how they may
 * name each person of the moment: themselves as "you", someone they know by that name, anyone else by
 * no name at all. No name reaches the render but those, and no one's staging but as far as each
 * perceiver's senses reached.
 */
function povAsk(input: PovInput, texts: PromptTexts): string {
  const deed = input.beat.deed?.trim() ?? "";
  const each = input.who.map((who) => {
    const x = input.beat.exposure.find((e) => e.who === who);
    const own = input.beat.actors.includes(who);
    const how = [x ? exposureChannels(x).map((c) => CHANNEL_WORDS[c] ?? `by ${c}`).join(" and ") : undefined, x ? (x.reach === "partial" ? "in part" : "whole") : undefined, own ? "their own act" : undefined].filter((s): s is string => s !== undefined);
    const staged = stagingFor(input, who);
    const others = Object.entries(input.refs[who]?.present ?? {}).map(([id, name]) => `- ${id}: ${name ?? "no name (someone they don't know)"}`);
    return [
      `### ${who}${how.length > 0 ? `: ${how.join("; ")}` : ""}`,
      ...(own && deed !== "" ? [`What they did and said, as they did it: ${deed}`] : []),
      ...(staged.length > 0 ? ["What they could sense of where everyone was as it began:", ...staged] : []),
      "Whom they may name, and how:",
      `- ${who}: you`,
      ...others,
    ].join("\n");
  });
  return [
    `## What was there to sense\n${input.beat.surface.trim()}`,
    input.beat.quotes && input.beat.quotes.trim() !== "" ? `## The exact words, said or written\n${input.beat.quotes.trim()}` : "",
    `## Write what reached each of these\n${each.join("\n\n")}`,
    renderPrompt(CHARACTER_TEXT.povAnswer, texts, {}),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
}

/** The points of view an answer holds for `who`, read through its call's `Reading`: a point of view for anyone else is dropped. */
function povsIn(answer: Record<string, unknown> | null, who: readonly EntityId[], read: Reading): Record<EntityId, string> {
  const out: Record<EntityId, string> = {};
  const povs = answer ? read.record("povs", answer.povs) : null;
  if (!povs) return out;
  for (const [key, v] of Object.entries(povs)) {
    const field = `povs[${JSON.stringify(key)}]`;
    if (!who.includes(key)) {
      read.drop(field, v, "no one it was asked about");
      continue;
    }
    const text = read.text(field, v);
    if (text !== "") out[key] = text;
  }
  return out;
}

/** A name's words that could name its person in a text: the whole name, and each of its words of two letters or more that starts with a capital. */
function nameWords(name: string): string[] {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))
    .filter((w) => w.length >= 2 && /^\p{Lu}/u.test(w));
  return [...new Set([name.trim(), ...words])].filter((w) => w !== "");
}

/** `word` as a whole word in a pattern: never inside a longer word or number. */
function wordPattern(word: string): string {
  return `(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`;
}

/** Whether `text` holds `word` as a whole word: as written, or in any case (`anyCase`). */
function holdsWord(text: string, word: string, anyCase = false): boolean {
  return new RegExp(wordPattern(word), anyCase ? "iu" : "u").test(text);
}

/** The names whose words alone never name someone who wasn't there, in any case: those of everyone there, known or not, and of the world, its places and its things. */
function sharedWords(refs: PovRefs): Set<string> {
  const there = [refs.self, ...Object.values(refs.present).filter((n): n is string => n !== null), ...refs.strangers];
  return new Set([...there, ...refs.world].flatMap(nameWords).map((w) => w.toLowerCase()));
}

/**
 * The names of people who weren't there (`refs.absent`, people its perceiver knows) that a point of
 * view uses, as it would to mislabel someone who was: each whole name, or a word of it as written,
 * that is no name or word of a name of anyone there (known to it or not) or of the world, its places
 * and its things (`sharedWords`: alone, the word may well be theirs), and that neither what was there
 * to sense nor the exact words hold in any case (a name said aloud is reproduced, not given).
 */
export function unseenNames(pov: string, refs: PovRefs, beat: { surface: string; quotes?: string }): string[] {
  const shared = sharedWords(refs);
  const sensed = `${beat.surface}\n${beat.quotes ?? ""}`;
  return refs.absent.filter((name) => nameWords(name).some((w) => !shared.has(w.toLowerCase()) && holdsWord(pov, w) && !holdsWord(sensed, w, true)));
}

/** Each point of view that names someone who wasn't there, with the names. */
function unseenIn(povs: Readonly<Record<EntityId, string>>, input: PovInput): Record<EntityId, string[]> {
  const out: Record<EntityId, string[]> = {};
  for (const [who, text] of Object.entries(povs)) {
    const refs = input.refs[who];
    const names = refs ? unseenNames(text, refs, input.beat) : [];
    if (names.length > 0) out[who] = names;
  }
  return out;
}

/** How something reached someone, in a fallback's words. */
const REACHED_WORDS: Readonly<Record<string, string>> = { sight: "by sight", hearing: "by hearing", touch: "by touch", told: "by word of mouth", message: "by message", rumor: "by rumor", record: "from a record" };

/**
 * `text` with each person of `strangers` told as "someone" ("Someone" where a sentence starts),
 * outside the words it quotes, which keep the names said or written: their whole names, then each
 * word of them that is no word of a name in `keep` (anyone else's, or the world's), which may be
 * theirs.
 */
function unnamed(text: string, strangers: readonly string[], keep: readonly string[]): string {
  const kept = new Set(keep.flatMap(nameWords).map((w) => w.toLowerCase()));
  const words = [...new Set(strangers.flatMap((name) => nameWords(name).filter((w, i) => i === 0 || !kept.has(w.toLowerCase()))))].sort((a, b) => b.length - a.length);
  const trimmed = text.trim();
  if (words.length === 0) return trimmed;
  const pattern = new RegExp(words.map(wordPattern).join("|"), "gu");
  let out = "";
  for (const [i, part] of trimmed.split(/(“[^”]*”|"[^"]*")/u).entries()) {
    out += i % 2 === 1 ? part : part.replace(pattern, (_m: string, at: number) => (/(?:^|[.!?…]["”’)]?)\s*$/u.test(out + part.slice(0, at)) ? "Someone" : "someone"));
  }
  return out;
}

/**
 * What reaches `who` of a beat when the render, asked twice, gave it no point of view it could keep
 * (§4.2): the beat is never lost to it, and no name it may not use reaches it. A message it received:
 * only that one came (in part where it was). Anything that reached it in part, its own act with no
 * deed included: only that something did, by what way. Its own act as its deed has it, or a whole
 * reach as what was there to sense: that text, with everyone there it doesn't know told as
 * "someone" (`unnamed`).
 */
export function povFallback(input: Pick<PovInput, "beat" | "refs">, who: EntityId): string {
  const x = input.beat.exposure.find((e) => e.who === who);
  const own = input.beat.actors.includes(who);
  const deed = own && input.beat.deed !== undefined && input.beat.deed.trim() !== "" ? input.beat.deed : undefined;
  if (x?.channel === "message" && !own) return x.reach === "partial" ? "A message reached you, only in part." : "A message reached you.";
  if (x?.reach === "partial" && deed === undefined) return `Something reached you ${exposureChannels(x).map((c) => REACHED_WORDS[c] ?? `by ${c}`).join(" and ")}, only in part.`;
  // Heard alone, never what there was to see (LIVE3c L3c-4): its exact words, else only that something was heard.
  if (x !== undefined && heardAlone(input.beat, who)) return input.beat.quotes && input.beat.quotes.trim() !== "" ? `You hear: “${input.beat.quotes.trim()}”` : "Something reached you by hearing.";
  const refs = input.refs[who];
  return unnamed(deed ?? input.beat.surface, refs?.strangers ?? [], refs ? [refs.self, ...Object.values(refs.present).filter((n): n is string => n !== null), ...refs.absent, ...refs.world] : []);
}

/** What a stage says of a point of view the render fell back on (`PovOut.fellBack`), for `who` of `beat` ("beat b3", "the amended beat b3"). */
export function fellBackLine(who: string, beat: string, names: readonly string[]): string {
  const why = names.length > 0 ? `The point of view for ${who} of ${beat} named someone who wasn't there (${names.join(", ")}), and again when redrafted` : `No point of view was written for ${who} of ${beat}, asked twice`;
  return `${why}: in its place ${who} gets a plain one that names no one they may not name.`;
}

/**
 * The point-of-view render (§4.2, §5.2): for each person it is asked about (a beat that reached them
 * in part, or whole but involving someone they don't know), what reached them from where they were,
 * in the order it reached their senses, without ranking what matters: their own act from the inside,
 * a message they received as its words. One call covers them all. Each is told exactly how they may
 * name each person of the moment (`refs`), and nobody's name reaches the render otherwise. A point of
 * view that names someone who wasn't there with a name its perceiver knows (`unseenNames`) is
 * redrafted once, told which names, and anyone the answer left out is asked for again in the same
 * call; one still naming them, or still missing, gets the plain fallback (`povFallback`, `fellBack`),
 * so everyone asked has one. Truth-blind by construction: its input holds only the surface, the exact
 * words, an actor's own deed, who acted and was reached, and what each could sense of the staging.
 */
export async function povRender(model: ModelPort, input: PovInput): Promise<PovOut> {
  if (input.who.length === 0) return { povs: {}, fellBack: {}, usage: NO_USAGE };
  const texts = input.texts ?? TEXTS;
  const messages: PortMessage[] = [
    { role: "system", content: renderPrompt(CHARACTER_TEXT.pov, texts, {}) },
    { role: "user", content: povAsk(input, texts) },
  ];
  const r = await ask(model, "pov", messages, input.signal);
  const povs = povsIn(r.answer, input.who, r.read);
  const unseen = unseenIn(povs, input);
  const again = input.who.filter((who) => povs[who] === undefined || unseen[who] !== undefined);
  if (again.length === 0) return { povs, fellBack: {}, ...(r.reasoning ? { reasoning: r.reasoning } : {}), usage: r.usage };
  for (const who of again) delete povs[who];
  const named = again.filter((who) => unseen[who] !== undefined);
  const missing = again.filter((who) => unseen[who] === undefined);
  const redo = [
    named.length > 0 ? renderPrompt(CHARACTER_TEXT.povAgain, texts, { names: named.map((who) => `- ${who}: ${(unseen[who] ?? []).join(", ")}`).join("\n") }) : "",
    missing.length > 0 ? renderPrompt(CHARACTER_TEXT.povMissing, texts, { who: missing.map((who) => `- ${who}`).join("\n") }) : "",
    renderPrompt(CHARACTER_TEXT.povAgainAnswer, texts, {}),
  ].filter((p) => p !== "");
  const r2 = await ask(model, "pov", [...messages, { role: "assistant", content: r.text }, { role: "user", content: redo.join("\n\n") }], input.signal);
  const second = povsIn(r2.answer, again, r2.read);
  const still = unseenIn(second, input);
  const fellBack: Record<EntityId, string[]> = {};
  for (const who of again) {
    const text = second[who];
    if (text !== undefined && still[who] === undefined) povs[who] = text;
    else {
      fellBack[who] = still[who] ?? [];
      povs[who] = povFallback(input, who);
    }
  }
  const reasoning = [r.reasoning, r2.reasoning].filter((s): s is string => s !== undefined && s !== "").join("\n\n");
  return { povs, fellBack, ...(reasoning !== "" ? { reasoning } : {}), usage: addUsage(r.usage, r2.usage) };
}

// ------------------------------------------------------------------ seeding the core (D-17)

/**
 * A character's core from its source (D-17): its card, the world's own description of it, an
 * imported memory entry, or the author's reading of the history. A core from anything but the card
 * or the world waits for the user's review, as one with a World Info entry in it does (`review`).
 * No model call; the agent reads it first and never rewrites it.
 */
export function seedCore(input: { who: EntityId; at: number; source: CoreSource; text: string; review?: boolean }): StageOut {
  const review = input.review ?? (input.source !== "card" && input.source !== "world");
  const w = mindFileWrite({ who: input.who, path: mindPath(input.who, "core"), at: input.at, mode: "seed", lived: [], about: [], source: input.source, ...(review ? { review: true as const } : {}) }, input.text.trim());
  return { events: w.events, blobs: w.blobs, usage: NO_USAGE };
}

/** A card's or the world's text with its own macros read as the story has them: `{{char}}` its character's name, `{{user}}` the player character's; any other left out. */
function cardText(text: string, name: string, player: string): string {
  return neutralizeMacros(text.replace(/\{\{\s*char\s*\}\}/gi, name).replace(/\{\{\s*user\s*\}\}/gi, player)).trim();
}

/** A filled core template without the headings whose part is empty: one followed only by blank lines up to a heading of its own level or higher, or the end. */
function withoutEmptyParts(filled: string): string {
  const lines = filled.split("\n");
  const level = (line: string | undefined): number => /^(#{1,6}) /.exec(line ?? "")?.[1]?.length ?? 0;
  const kept = lines.filter((line, i) => {
    const own = level(line);
    if (own === 0) return true;
    let j = i + 1;
    while (j < lines.length && level(lines[j]) === 0 && (lines[j] ?? "").trim() === "") j++;
    return j < lines.length && (level(lines[j]) === 0 || level(lines[j]) > own);
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A card as core text (D-17), by the user's own template (Settings → Prompts → Character agents →
 * Core from a card): its description, personality, scenario and example messages, each part the
 * card leaves empty left out with its heading.
 */
export function cardCoreText(card: HostCharacter, o: { name?: string; player: string; texts?: PromptTexts }): string {
  const name = o.name ?? card.name;
  return withoutEmptyParts(
    renderPrompt(CHARACTER_TEXT.coreCard, o.texts ?? TEXTS, {
      name,
      description: cardText(card.description, name, o.player),
      personality: cardText(card.personality, name, o.player),
      scenario: cardText(card.scenario, name, o.player),
      examples: cardText(card.examples, name, o.player),
    }),
  );
}

/**
 * The world's own description of a character as core text (D-17), by the user's own template
 * (Settings → Prompts → Character agents → Core from the world): its entity's role with its age,
 * description and traits (`fields`), and the lore about it (`lore`, each entry's text), each part the
 * world leaves empty left out with its heading. "" when the world says nothing of it but its age.
 */
export function worldCoreText(o: { name: string; fields: Readonly<Record<string, unknown>>; lore: readonly string[]; player: string; texts?: PromptTexts }): string {
  const str = (v: unknown): string => (typeof v === "string" ? cardText(v, o.name, o.player) : "");
  const role = str(o.fields.role).replace(/[\s.]+$/, "");
  const age = typeof o.fields.age === "number" && Number.isFinite(o.fields.age) && o.fields.age >= 0 ? String(o.fields.age) : "";
  const description = str(o.fields.description);
  const traits = (Array.isArray(o.fields.traits) ? o.fields.traits : []).map(str).filter((t) => t !== "");
  const lore = o.lore.map((t) => cardText(t, o.name, o.player)).filter((t) => t !== "");
  if (role === "" && description === "" && traits.length === 0 && lore.length === 0) return "";
  return withoutEmptyParts(
    renderPrompt(CHARACTER_TEXT.coreWorld, o.texts ?? TEXTS, {
      name: o.name,
      role: role !== "" ? `${role}${age !== "" ? `, ${age}` : ""}.` : age !== "" ? `Aged ${age}.` : "",
      description,
      traits: traits.map((t) => `- ${t}`).join("\n"),
      lore: lore.join("\n\n"),
    }),
  );
}

/** A card the host has, for `characterId`; null without the `characters` permission, or when there is none. */
export async function readCard(host: { characters?: { get(id: string, userId: UserId): Promise<HostCharacter | null> } }, characterId: string, userId: UserId): Promise<HostCharacter | null> {
  if (!host.characters) return null;
  try {
    return await host.characters.get(characterId, userId);
  } catch {
    return null;
  }
}

/** The host's cards, as forming a core reads them. */
export interface CardHost {
  characters?: { get(id: string, userId: UserId): Promise<HostCharacter | null>; ofChat(chatId: string, userId: UserId): Promise<string | null> };
}

/**
 * A mind formed in play (D-17), for someone the author first casts as their own agent with no mind
 * yet: someone first met after opt-in, a new person, everyone on a chat turned on without the
 * bootstrap. core.md from their card (the one the world links them to, else the chat's own card when
 * it bears their name), else from the world's own description of them, which waits for the user's
 * review; null when neither says anything of them. No model call.
 */
export async function formCore(input: { who: EntityId; name: string; player: string; at: number; fields: Readonly<Record<string, unknown>>; characterId?: string; host?: CardHost; chatId: string; userId: UserId; texts?: PromptTexts }): Promise<(StageOut & { source: "card" | "world" }) | null> {
  const host = input.host;
  const texts = input.texts ? { texts: input.texts } : {};
  let card: HostCharacter | null = null;
  if (host?.characters) {
    if (input.characterId) card = await readCard(host, input.characterId, input.userId);
    else {
      const own = await host.characters.ofChat(input.chatId, input.userId).catch(() => null);
      const chats = own ? await readCard(host, own, input.userId) : null;
      if (chats && sameName(chats.name, input.name)) card = chats;
    }
  }
  const fromCard = card ? cardCoreText(card, { name: input.name, player: input.player, ...texts }) : "";
  if (fromCard !== "") return { ...seedCore({ who: input.who, at: input.at, source: "card", text: fromCard }), source: "card" };
  const fromWorld = worldCoreText({ name: input.name, fields: input.fields, lore: [], player: input.player, ...texts });
  return fromWorld !== "" ? { ...seedCore({ who: input.who, at: input.at, source: "world", text: fromWorld, review: true }), source: "world" } : null;
}

