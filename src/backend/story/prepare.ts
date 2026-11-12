// The prepared start (DEPTH2-PLAN §1.11): "Prepare this story" is a job the player starts, the
// author's own run. Nothing here is a pipeline: every step that reads or writes the story is a tool
// call the author or the historian chose (`harness-tools/story-prepare.ts`). What is here is what
// those tools and the player's requests share.
//
// - The preparation's file (`author/prepare.md`, in the chat's own area): the plan as the author
//   wrote it, how far each stretch has come, the player's word on the plan and what the plan is
//   reckoned to cost, written for the author and the player to read, with the record the tools read
//   at its end. A run that carries the preparation on starts from it, so a job paused, stopped or
//   cancelled loses nothing.
// - The engine's reckoning of what the whole preparation costs, the author's own work included: its
//   model calls at what one of them weighs, as LumiAH measured it. The player's ceiling
//   (`StoryPrepare.askAboveTokens`) is held to it, whatever the author estimated; their cap holds
//   what the preparation has spent, as LumiAH counts it, with what the next stretch is reckoned at.
// - The player's requests (`lre.prepare`): start a preparation, give their word on its plan, speak
//   to it, hold or cancel it. The job and its controls are LumiAH's; the word is written into the
//   file as the player's own write, and a run that ended waiting for it is carried on by a new job.
// - The env a call of a job the player started runs with (`prepareEnv`): the chat's head, its
//   workspace and its story record, and no writer: a preparation changes nothing in the world. The
//   prepared start's story record is kept on the chat's first reply, so the past it records, its
//   casting and what each mind took in stay on every path through the chat; any other job the player
//   starts writes on the newest reply.
// - What the author is told of the preparation as a turn begins while it is unfinished
//   (`preparedNote`), and what a first turn still lacks of it (`preparationLeft`).
//
// Nothing here imports the harness's turn or its definitions: the tools import this file, and those
// import the tools' list.

import type { RoleTier } from "../../shared/agent-roles";
import { WRITE_NOTE } from "../../shared/agent-tools-write";
import { hashParts } from "../../shared/hash";
import { AUTHOR_FILE, HARNESS_AGENT, HARNESS_NOTE } from "../../shared/harness-texts";
import { PREPARE_NOTE, PREPARE_PATH } from "../../shared/harness-texts-prepare";
import type { ChatId, UserId } from "../../shared/ids";
import { isRecord } from "../../shared/json";
import type { PrepareCallFrom, PreparePlan, PrepareAsk, PrepareState as PageState, PrepareView, StoryNames } from "../../shared/story-pages";
import type { PromptTexts } from "../../shared/prompts";
import type { StoryPrepare } from "../../shared/settings";
import { castOn, type StoryPath } from "../../engine/story/record";
import type { HarnessFiles } from "../agents/tools/harness-ports";
import type { HarnessTurn, JobSpent } from "../agents/tools/harness-turn";
import { outsideReader } from "../agents/tools/read-view";
import type { ToolEnv } from "../agents/tools/registry";
import { chatHead } from "../agents/tools/workspace";
import type { OpRefusal } from "../agents/tools/writer";
import { knowledgeOn } from "../chat-knowledge-prefs";
import type { TurnAgent } from "../harness/turn";
import type { HostMessage } from "../host";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import { mindPath } from "./minds";
import { chatStoryPort } from "./record";

// ---------------------------------------------------------------- the state

/** How far a stretch has come: planned, open to the historian, recorded and closed, or dropped from the plan. */
export type StretchState = "planned" | "open" | "recorded" | "dropped";
const STRETCH_STATES: readonly StretchState[] = ["planned", "open", "recorded", "dropped"];

/** One stretch of the chat to relive: its messages by number, and their ids when it was planned. */
export interface PrepareStretch {
  /** s1, s2 and on, in the order the plans made them: kept through a plan written again. */
  id: string;
  from: number;
  to: number;
  /** The ids of its first and last messages when it was planned: a stretch whose messages moved since is planned again. */
  fromId: string;
  toId: string;
  why: string;
  /** The principals who relive it, by entity id. */
  who: string[];
  state: StretchState;
  /** The last message its beats cover so far; null before any. */
  through: number | null;
  /** The beats recorded of it, by id, in order. */
  beats: string[];
  /** What reliving it is reckoned at, in tokens: its model calls (`stretchCalls`) at what one weighed when it was planned. */
  reckoned: number;
}

/** A principal of the plan: their entity id, their name as it was when they were cast, and why. */
export interface PreparePrincipal {
  id: string;
  name: string;
  why: string;
}

/** The player's word on the plan. */
export interface PrepareWord {
  /** The plan waited for it: it was reckoned above their ceiling. */
  asked: boolean;
  /** Given, or needed none. */
  approved: boolean;
  /** The estimate the plan stood at when it was given: a plan written again above it asks again. */
  for: number;
  /** The player's ceiling when the plan was written: what the whole preparation's reckoning is held to. */
  ceiling: number;
  /** The most the whole preparation may spend, in tokens, as LumiAH counts it: no stretch is opened past it; null for none. */
  cap: number | null;
  /** What the player said to the preparation, oldest first. */
  said: string[];
}

/** The preparation as its file keeps it. */
export interface PrepareState {
  v: 1;
  /** A chat with a history to catch up on, or a new one with none. */
  kind: "history" | "new";
  about: string;
  principals: PreparePrincipal[];
  stretches: PrepareStretch[];
  fills: string;
  /**
   * The author's estimate of the whole preparation, and the engine's (`reckoned`: what it had spent,
   * as LumiAH counted it, and what was left of it at `call` tokens a model call, measured as `from`
   * says) when the plan was written. A plan written before the weight was kept reads with none (0).
   */
  estimate: { author: number; reckoned: number; call: number; from: PrepareCallFrom };
  word: PrepareWord;
  /** The author's closing note once it finished the preparation; null while it hasn't. */
  done: string | null;
  /** The version the scene and the notebook stood at when the first plan was written (null: there was no file): the preparation finishes once each was written since. */
  marks: { scene: string | null; notebook: string | null };
}

const isWord = (v: unknown): v is string => typeof v === "string" && v !== "";
const isText = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isWords = (v: unknown): v is string[] => Array.isArray(v) && v.every(isWord);

function stretchOf(raw: unknown): PrepareStretch | null {
  if (!isRecord(raw) || !isWord(raw.id) || !isCount(raw.from) || !isCount(raw.to) || raw.to < raw.from || !isWord(raw.fromId) || !isWord(raw.toId) || !isText(raw.why) || !isWords(raw.who) || !isWords(raw.beats) || !isCount(raw.reckoned)) return null;
  const state = STRETCH_STATES.find((s) => s === raw.state);
  if (state === undefined || !(raw.through === null || isCount(raw.through))) return null;
  return { id: raw.id, from: raw.from, to: raw.to, fromId: raw.fromId, toId: raw.toId, why: raw.why, who: raw.who, state, through: raw.through, beats: raw.beats, reckoned: raw.reckoned };
}

function principalOf(raw: unknown): PreparePrincipal | null {
  return isRecord(raw) && isWord(raw.id) && isText(raw.name) && isText(raw.why) ? { id: raw.id, name: raw.name, why: raw.why } : null;
}

function wordOf(raw: unknown): PrepareWord | null {
  if (!isRecord(raw) || typeof raw.asked !== "boolean" || typeof raw.approved !== "boolean" || !isCount(raw.for) || !isCount(raw.ceiling) || !(raw.cap === null || isCount(raw.cap)) || !Array.isArray(raw.said) || !raw.said.every(isText)) return null;
  return { asked: raw.asked, approved: raw.approved, for: raw.for, ceiling: raw.ceiling, cap: raw.cap, said: raw.said as string[] };
}

/** A preparation's record as stored, or null where it isn't one: every part checked, none left out, since the tools hold the player's word and spend to it. A record from before the cost was reckoned in calls reads with no weight. */
export function prepareStateOf(raw: unknown): PrepareState | null {
  if (!isRecord(raw) || raw.v !== 1 || (raw.kind !== "history" && raw.kind !== "new") || !isText(raw.about) || !isText(raw.fills) || !(raw.done === null || isText(raw.done)) || !isRecord(raw.marks)) return null;
  const e = isRecord(raw.estimate) ? raw.estimate : null;
  const estimate = e !== null && isCount(e.author) && isCount(e.reckoned) ? { author: e.author, reckoned: e.reckoned, call: isCount(e.call) ? e.call : 0, from: CALL_FROM.find((f) => f === e.from) ?? "default" } : null;
  const word = wordOf(raw.word);
  const { scene, notebook } = raw.marks;
  const principals = Array.isArray(raw.principals) ? raw.principals.map(principalOf) : [null];
  const stretches = Array.isArray(raw.stretches) ? raw.stretches.map(stretchOf) : [null];
  if (estimate === null || word === null || !(scene === null || isWord(scene)) || !(notebook === null || isWord(notebook)) || principals.some((p) => p === null) || stretches.some((s) => s === null)) return null;
  return { v: 1, kind: raw.kind, about: raw.about, principals: principals as PreparePrincipal[], stretches: stretches as PrepareStretch[], fills: raw.fills, estimate, word, done: raw.done, marks: { scene, notebook } };
}

/** The plan's estimate: the author's or the engine's reckoning, whichever is larger. */
export function estimateOf(state: Pick<PrepareState, "estimate">): number {
  return Math.max(state.estimate.author, state.estimate.reckoned);
}

/** The plan waits for the player's word. */
export function waits(state: PrepareState): boolean {
  return state.done === null && state.word.asked && !state.word.approved;
}

// ---------------------------------------------------------------- the file

/** Where the record the tools read begins and ends, at the end of the file. */
const STATE_OPEN = "<!-- lre-prepare";
const STATE_CLOSE = "-->";

/** The record `text` ends with: its state; null where it holds none; "damaged" where it holds one that can't be read. */
export function stateInText(text: string): PrepareState | "damaged" | null {
  const at = text.lastIndexOf(STATE_OPEN);
  if (at < 0) return null;
  const end = text.indexOf(STATE_CLOSE, at + STATE_OPEN.length);
  if (end < 0) return "damaged";
  try {
    return prepareStateOf(JSON.parse(text.slice(at + STATE_OPEN.length, end))) ?? "damaged";
  } catch {
    return "damaged";
  }
}

const count = (n: number): string => n.toLocaleString("en-US");

/** The file's text for `state`, in the user's words (`texts`), with its record at the end. */
export function prepareFileText(state: PrepareState, texts: PromptTexts): string {
  const t = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const none = t(PREPARE_NOTE.fileNone);
  const names = new Map(state.principals.map((p) => [p.id, p.name]));
  const recorded = state.stretches.filter((s) => s.state === "recorded").length;
  const live = state.stretches.filter((s) => s.state !== "dropped").length;
  const status = state.done !== null ? t(PREPARE_NOTE.fileDone, { note: state.done === "" ? "" : ` ${state.done}` }) : waits(state) ? t(PREPARE_NOTE.fileWaits, { estimate: count(estimateOf(state)), ceiling: count(state.word.ceiling) }) : t(PREPARE_NOTE.fileUnder, { recorded: String(recorded), stretches: String(live) });
  const stateWords = (s: PrepareStretch): string =>
    s.state === "open" ? t(PREPARE_NOTE.fileStateOpen, { beats: String(s.beats.length), through: s.through === null ? String(s.from - 1) : String(s.through) }) : s.state === "recorded" ? t(PREPARE_NOTE.fileStateRecorded, { beats: String(s.beats.length) }) : t(s.state === "dropped" ? PREPARE_NOTE.fileStateDropped : PREPARE_NOTE.fileStatePlanned);
  const principals = state.principals.map((p) => t(PREPARE_NOTE.filePrincipal, { name: p.name, id: p.id, why: p.why })).join("\n");
  const stretches = state.stretches.map((s) => t(PREPARE_NOTE.fileStretch, { stretch: s.id, from: String(s.from), to: String(s.to), state: stateWords(s), why: s.why, who: s.who.map((id) => names.get(id) ?? id).join(", ") || none })).join("\n");
  const cost = t(PREPARE_NOTE.fileCost, { estimate: count(estimateOf(state)), call: count(state.estimate.call), from: t(CALL_NOTE[state.estimate.from]), author: count(state.estimate.author), cap: state.word.cap === null ? "" : t(PREPARE_NOTE.fileCap, { cap: count(state.word.cap) }) });
  const word = (state.word.approved ? (state.word.asked ? t(PREPARE_NOTE.fileApproved) : t(PREPARE_NOTE.fileAuto, { ceiling: count(state.word.ceiling) })) : t(PREPARE_NOTE.fileAsked)) + state.word.said.map((text) => t(PREPARE_NOTE.fileSaid, { text })).join("");
  const body = t(PREPARE_NOTE.file, { status, about: state.about || none, principals: principals || none, stretches: stretches || none, fills: state.fills || none, cost, word });
  // A "-->" in a text the author wrote would end the record early: inside JSON's strings it is written escaped, which reads back the same.
  return `${body}\n\n${STATE_OPEN}\n${JSON.stringify(state).replaceAll("-->", "--\\u003e")}\n${STATE_CLOSE}\n`;
}

/** The preparation's file as it stands: its state (null for none), whether its record is damaged, and its version (null: no file). */
export interface PrepareFile {
  state: PrepareState | null;
  damaged: boolean;
  version: string | null;
}

export async function readPrepare(files: Pick<HarnessFiles, "read">): Promise<PrepareFile> {
  const file = await files.read(PREPARE_PATH);
  if (!file) return { state: null, damaged: false, version: null };
  const state = stateInText(file.text);
  return state === "damaged" ? { state: null, damaged: true, version: file.version } : { state, damaged: false, version: file.version };
}

/** How many times a change of the file is made again on what someone wrote between its read and its write. */
const WRITE_TRIES = 3;

/** How a change of the file went: written, with the state now; stopped by the change itself, with its answer; or not written, with why. */
export type Updated<T> = { state: PrepareState } | { stop: T } | { failed: string };

/**
 * Writes what `change` makes of the file as it stands, based on the version read, so nobody's write
 * between is lost: written meanwhile, it reads again and makes the change on what is there.
 */
export async function updatePrepare<T>(files: Pick<HarnessFiles, "read" | "write">, texts: PromptTexts, change: (now: PrepareFile) => PrepareState | { stop: T }): Promise<Updated<T>> {
  let reason = "";
  for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
    const now = await readPrepare(files);
    const next = change(now);
    if ("stop" in next) return next;
    const written = await files.write(PREPARE_PATH, prepareFileText(next, texts), now.version);
    if ("version" in written) return { state: next };
    reason = written.refused.reason;
    // A refusal that names the file's version now is someone's write between: read again and make the change on that.
    if (written.refused.version === null) break;
  }
  return { failed: reason };
}

// ---------------------------------------------------------------- the reckoning

/**
 * What the preparation costs, as the engine reckons it: each model call sends its agent's whole
 * prompt again, so the cost is in the calls, at what one of them weighs (`callWeight`). The calls:
 * for each stretch, the author's (open it, start the historian, start the reliving), the
 * historian's (one for each read the stretch takes, then its beats, its close and its report) and
 * those of each principal who relives it; for each principal, the author's casting and their core,
 * and with a past their outline; and the author's close (the scene, the notebook, the finish and its
 * report). What it has spent already is LumiAH's own count. These shape the estimate the player's
 * ceiling is held to and what the cap reckons a stretch at; they bound nothing themselves.
 */
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE = 12;
const AUTHOR_CALLS_A_STRETCH = 3;
const HISTORIAN_CALLS = 3;
const RELIVING_CALLS = 4;
const AUTHOR_CALLS_A_PRINCIPAL = 2;
const OUTLINE_CALLS = 1;
const CLOSING_CALLS = 4;

/** Where the weight of a call can come from, as the record keeps it. */
const CALL_FROM: readonly PrepareCallFrom[] = ["job", "chat", "default"];

/** How the file and the tools say where the weight of a call came from. */
export const CALL_NOTE: Readonly<Record<PrepareCallFrom, string>> = { job: PREPARE_NOTE.callJob, chat: PREPARE_NOTE.callChat, default: PREPARE_NOTE.callDefault };

/** A message's tokens, as reckoned: its text, its number and who wrote it. */
export function messageTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + PER_MESSAGE;
}

/** What one model call of the preparation weighs, in tokens, and where that was measured: LumiAH's figure where it has one (`spent`), else the player's setting for a call not yet measured. */
export function callWeight(spent: JobSpent | null, settings: Pick<StoryPrepare, "callTokens">): { tokens: number; from: PrepareCallFrom } {
  return spent?.call && spent.call.tokens > 0 ? { tokens: spent.call.tokens, from: spent.call.from } : { tokens: settings.callTokens, from: "default" };
}

/** The model calls reliving a stretch of `tokens` takes: the author's, the historian's (one for each read of `readChars` it takes, and its own), and each of its `relivers`'. */
export function stretchCalls(tokens: number, relivers: number, readChars: number): number {
  const reads = Math.max(1, Math.ceil((tokens * CHARS_PER_TOKEN) / readChars));
  return AUTHOR_CALLS_A_STRETCH + reads + HISTORIAN_CALLS + relivers * RELIVING_CALLS;
}

/** What is left of a plan, reckoned at `call` tokens a model call: its stretches still to relive (each as it was reckoned when planned), each principal's casting, core and, with a past, outline, and the author's close. */
export function reckonLeft(plan: Pick<PrepareState, "kind" | "stretches" | "principals">, call: number): number {
  const stretches = plan.stretches.filter((s) => s.state === "planned" || s.state === "open").reduce((sum, s) => sum + s.reckoned, 0);
  return stretches + (plan.principals.length * (AUTHOR_CALLS_A_PRINCIPAL + (plan.kind === "history" ? OUTLINE_CALLS : 0)) + CLOSING_CALLS) * call;
}

// ---------------------------------------------------------------- the chat

/** The chat's messages by their number, as the chat tools number them (`#12`). */
export function byNumber(messages: readonly HostMessage[]): Map<number, HostMessage> {
  return new Map(messages.map((m) => [m.index, m]));
}

/** A chat with a history to catch up on, or a new one: no message of the player's yet. */
export function chatKind(messages: readonly HostMessage[]): PrepareState["kind"] {
  return messages.some((m) => m.isUser) ? "history" : "new";
}

/** A stretch's messages, first to last, as they stand. */
export function stretchMessages(numbered: ReadonlyMap<number, HostMessage>, from: number, to: number): HostMessage[] {
  const out: HostMessage[] = [];
  for (let n = from; n <= to; n++) {
    const m = numbered.get(n);
    if (m) out.push(m);
  }
  return out;
}

/** Whether the stretch still begins and ends with the messages it was planned on. */
export function stretchStands(numbered: ReadonlyMap<number, HostMessage>, s: Pick<PrepareStretch, "from" | "to" | "fromId" | "toId">): boolean {
  return numbered.get(s.from)?.id === s.fromId && numbered.get(s.to)?.id === s.toId;
}

/** A stretch as the author asks for it in a plan. */
export interface StretchAsked {
  from: number;
  to: number;
  why: string;
  who: string[];
}

/** What a plan's stretches came to: the stretches, with how each asked for was split; or the first problem, as a text's id and its values. */
export type Planned = { stretches: PrepareStretch[]; splits: { from: number; to: number; count: number }[] } | { problem: { id: string; vars: Record<string, string> } };

/**
 * The plan's stretches: what the author asked for, each split into stretches of at most `most`
 * messages, after those already open or recorded, which stay as they are. A stretch asked for
 * that is one of those keeps it. Ids are kept and new ones follow the highest given. Each new one
 * is reckoned at its model calls (`stretchCalls`, with `reckon.readChars`) at `reckon.call` tokens a call.
 */
export function planStretches(asked: readonly StretchAsked[], numbered: ReadonlyMap<number, HostMessage>, most: number, held: readonly PrepareStretch[], reckon: { readChars: number; call: number }): Planned {
  const numbers = [...numbered.keys()];
  const first = numbers.length > 0 ? Math.min(...numbers) : 0;
  const last = numbers.length > 0 ? Math.max(...numbers) : 0;
  const kept = held.filter((s) => s.state === "open" || s.state === "recorded");
  let next = held.reduce((n, s) => Math.max(n, Number(s.id.slice(1)) || 0), 0);
  const out: PrepareStretch[] = [...kept];
  const splits: { from: number; to: number; count: number }[] = [];
  const sorted = [...asked].sort((a, b) => a.from - b.from);
  for (const a of sorted) {
    if (a.to < a.from || !numbered.has(a.from) || !numbered.has(a.to)) return { problem: { id: PREPARE_NOTE.badRange, vars: { from: String(a.from), to: String(a.to), first: String(first), last: String(last) } } };
    if (kept.some((k) => k.from === a.from && k.to === a.to)) continue;
    const clash = out.find((s) => s.from <= a.to && a.from <= s.to);
    if (clash) {
      const [earlier, later] = clash.from <= a.from ? [clash, a] : [a, clash];
      return { problem: { id: PREPARE_NOTE.overlap, vars: { first: String(earlier.from), to: String(earlier.to), from: String(later.from) } } };
    }
    const pieces = Math.ceil((a.to - a.from + 1) / most);
    if (pieces > 1) splits.push({ from: a.from, to: a.to, count: pieces });
    for (let from = a.from; from <= a.to; from += most) {
      const to = Math.min(a.to, from + most - 1);
      // A piece whose ends the chat has no message at takes the messages it has inside it.
      const inside = stretchMessages(numbered, from, to);
      const head = inside[0];
      const tail = inside.at(-1);
      if (!head || !tail) continue;
      const tokens = inside.reduce((sum, m) => sum + messageTokens(m.content), 0);
      next++;
      out.push({ id: `s${next}`, from: head.index, to: tail.index, fromId: head.id, toId: tail.id, why: a.why, who: [...a.who], state: "planned", through: null, beats: [], reckoned: stretchCalls(tokens, a.who.length, reckon.readChars) * reckon.call });
    }
  }
  return { stretches: out.sort((x, y) => x.from - y.from), splits };
}

/**
 * The player's word on a plan reckoned at `estimate`, against their ceiling: within it, none is
 * needed; above it, the word given before still stands where that plan stood as high; else the plan
 * waits. A cap and what they said carry over.
 */
export function wordFor(estimate: number, ceiling: number, before: PrepareWord | null): PrepareWord {
  const kept = { cap: before?.cap ?? null, said: before?.said ?? [] };
  if (estimate <= ceiling) return { asked: false, approved: true, for: estimate, ceiling, ...kept };
  if (before && before.approved && before.asked && estimate <= before.for) return { ...before, ceiling };
  return { asked: true, approved: false, for: estimate, ceiling, ...kept };
}

// ---------------------------------------------------------------- reliving

/** Whether `beat` is part of the past `who` lives: their own, or one that reached them. */
function pastOf(beat: StoryPath["beats"][number]["beat"], who: string): boolean {
  if (beat.past === undefined || beat.struck !== undefined) return false;
  return beat.by === who || (beat.kind !== "inner" && beat.exposure.some((e) => e.who === who));
}

/**
 * The principals among `who` with moments of the past still to relive: a beat recorded from the
 * past that is theirs or reached them lies past the last beat their mind took in.
 */
export function relivingNow(path: StoryPath, who: readonly string[]): string[] {
  const at = new Map(path.beats.map((b, i) => [b.beat.id, i]));
  return who.filter((p) => {
    const last = path.beats.findLastIndex((b) => pastOf(b.beat, p));
    if (last < 0) return false;
    const mark = castOn(path, p)?.digestedTo;
    return (mark === undefined ? -1 : (at.get(mark) ?? -1)) < last;
  });
}

/** The principals among `who` that a stretch's beats reached or are by, in `who`'s order. */
export function reachedBy(path: StoryPath, beats: readonly string[], who: readonly string[]): string[] {
  const ids = new Set(beats);
  const inStretch = path.beats.filter((b) => ids.has(b.beat.id));
  return who.filter((p) => inStretch.some((b) => pastOf(b.beat, p)));
}

// ---------------------------------------------------------------- what is left

/** A stretch's messages, as the tools and their answers name them. */
export const spanOf = (s: Pick<PrepareStretch, "from" | "to">): string => `#${s.from} to #${s.to}`;

/**
 * What a first turn still lacks of the preparation, a line each in `texts`: stretches neither
 * recorded nor dropped, principals with moments of the past still to relive (`path`: the story as it
 * stands), cores and, with a past, outlines not written, and the scene and the notebook not written
 * since the plan. What `prepare_finish` holds the preparation to, and what the author is told of it
 * as a turn begins.
 */
export async function preparationLeft(files: Pick<HarnessFiles, "read">, state: PrepareState, path: StoryPath | null, texts: PromptTexts): Promise<string[]> {
  const t = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const name = (id: string): string => state.principals.find((p) => p.id === id)?.name ?? id;
  const [scene, notebook, minds] = await Promise.all([
    files.read(AUTHOR_FILE.scene),
    files.read(AUTHOR_FILE.notebook),
    Promise.all(state.principals.map(async (p) => ({ p, core: (await files.read(mindPath(p.id, "core"))) !== null, outline: (await files.read(mindPath(p.id, "outline"))) !== null }))),
  ]);
  return [
    ...state.stretches.filter((s) => s.state === "planned" || s.state === "open").map((s) => t(PREPARE_NOTE.leftStretch, { stretch: s.id, span: spanOf(s) })),
    ...(path ? relivingNow(path, state.principals.map((p) => p.id)) : []).map((id) => t(PREPARE_NOTE.leftRelive, { name: name(id) })),
    ...minds.flatMap(({ p, core, outline }) => [...(core ? [] : [t(PREPARE_NOTE.leftCore, { name: p.name })]), ...(outline || state.kind === "new" ? [] : [t(PREPARE_NOTE.leftOutline, { name: p.name })])]),
    ...(scene === null || scene.version === state.marks.scene ? [t(PREPARE_NOTE.leftScene)] : []),
    ...(notebook === null || notebook.version === state.marks.notebook ? [t(PREPARE_NOTE.leftNotebook)] : []),
  ];
}

/** What the author is told of the preparation as a turn begins, while it waits or is under way: how far it has come and what a first turn still lacks of it (`path`: the story as it stands). Null where there is none, or it is done. */
export async function preparedNote(files: Pick<HarnessFiles, "read">, texts: PromptTexts, path: StoryPath | null): Promise<string | null> {
  const { state } = await readPrepare(files);
  if (!state || state.done !== null) return null;
  const live = state.stretches.filter((s) => s.state !== "dropped");
  const left = await preparationLeft(files, state, path, texts);
  const note = renderPrompt(PREPARE_NOTE.turnNote, texts, { state: renderPrompt(waits(state) ? PREPARE_NOTE.turnWaits : PREPARE_NOTE.turnUnder, texts, {}), recorded: String(live.filter((s) => s.state === "recorded").length), stretches: String(live.length) });
  return left.length === 0 ? note : `${note} ${renderPrompt(PREPARE_NOTE.turnLeft, texts, { left: left.join("; ") })}`;
}

// ---------------------------------------------------------------- a job the player started

/**
 * What a call of a job the player started runs with (no turn's record holds it: the preparation,
 * or any other job they start on a chat the harness plays): the chat's head as the agent's view
 * reads it, the chat's workspace, and the story record, its beats under the job's id. The prepared
 * start's (`prepared`: the preparation's job, or one its agents started) is written on the chat's
 * first reply, any other's on the newest (`chatStoryPort`). No writer, no world's document, and a
 * change of the world is refused: a preparation notes what the world should be, and the first turn
 * makes it so; any other job the player started is tied to no reply, so it changes nothing of the
 * world either. `tier`: where the caller stands, as the bridge worked it out (`standingOf`,
 * `reach`). `directed`: the claim's word for the run, that the player directs the story.
 */
export async function prepareEnv(rt: Runtime, at: { chatId: ChatId; userId: UserId; job: string; prepared: boolean; directed: boolean; agent: TurnAgent; tier: RoleTier; files: HarnessFiles | null; as: string | null; signal: AbortSignal }): Promise<ToolEnv | OpRefusal> {
  const { chatId, userId, agent } = at;
  const core = rt.harness.core;
  const settings = await rt.settings.get(userId);
  const note = (id: string): string => renderPrompt(id, settings.prompts.texts, {});
  const head = await chatHead(rt, chatId, userId);
  if (!head) return { refused: true, code: "no_world", reason: note(WRITE_NOTE.noWorld) };
  const { view, marks } = agent.role ?? { view: "everyone" as const, marks: true };
  const reader = outsideReader(rt, { userId, chatId, knowledge: view, marks });
  const turn: HarnessTurn = {
    main: false,
    tier: at.tier,
    directed: at.directed,
    grant: () => false,
    knowing: knowledgeOn(await rt.chatKnowledge.get(chatId, userId), head.world, settings),
    settings,
    host: rt.host,
    seed: hashParts("lre.prepare", at.job),
    runSeed: head.run.runSeed,
    start: head.state,
    landed: () => [],
    said: { messageId: null, user: "", before: "" },
    reply: null,
    job: { id: at.job, byUser: true, ...(at.prepared && core !== null ? { spent: () => preparationSpent(core, { chatId, userId }) } : {}) },
    stage: () => Promise.resolve(at.prepared ? { refused: true, code: "prepare_world", reason: note(PREPARE_NOTE.worldless) } : { refused: true, code: "no_basis", reason: note(HARNESS_NOTE.noBasis) }),
    commit: () => Promise.resolve({ refused: true, code: "not_turn", reason: note(HARNESS_NOTE.notTurn) }),
    story: chatStoryPort(rt, { chatId, userId, turn: at.job, on: at.prepared ? "first" : "last" }),
  };
  return { userId, chatId, knowledge: view, marks, reader, writer: null, agent: { role: agent.def, id: agent.id, ...(at.as !== null ? { as: at.as } : {}) }, signal: at.signal, build: null, files: at.files, turn };
}

// ---------------------------------------------------------------- the player's requests

/** A request the preparation can't do as asked: the protocol's code, and plain words for the page. */
export class PrepareRefused extends Error {
  constructor(
    readonly code: "bad_request" | "not_found" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PrepareRefused";
  }
}

/** What the player reads on the page: why the start is offered, why a request is refused, why a preparation waits or stopped, and what isn't prepared yet. */
const WORDS = {
  offerHistory: "This chat has a history. Prepare the story, and the author catches up on it and gives the people it turns on minds of their own before the first reply.",
  offerNew: "A new story. Prepare it, and the author casts the people it turns on and gives each a core of who they are before the first reply.",
  noHarness: "This chat isn't played by the harness engine, so there is nothing to prepare. Choose Harness in GM → This chat → Engine first.",
  noCore: "The harness isn't running for this chat, so its preparation can't be reached now.",
  running: "The story is being prepared already. Pause, steer or cancel it.",
  noPlan: "There is no plan yet: the author writes one first.",
  noWords: "Say something first.",
  noJob: "Nothing is preparing this story now.",
  done: "This story is prepared already.",
  badCap: "A cap is a whole number of tokens, or none.",
  damaged: "The preparation's file can't be read: it was edited. Start the preparation again, and the author plans afresh.",
  unwritten: "The preparation's file couldn't be written",
  held: "Held. Resume lets it go on.",
  stopped: "It stopped before it finished. Resume carries it on from its file.",
  cancelled: "Cancelled. What it prepared stays, and resume carries it on from its file.",
  noPlanMade: "It ended before it wrote a plan.",
  scene: "The scene isn't set yet (author/scene.md).",
  notebook: "The author's notebook isn't written yet (author/notebook.md).",
} as const;

/** A job of LumiAH's as its pages list one: what the requests read of it, with what its record says it spent (its tokens in and out, and its model calls). */
interface JobRow {
  id: string;
  state: string;
  agent: string;
  paused: boolean;
  plan: string | null;
  byUser: boolean;
  tokens: number;
  calls: number;
  reason: string | null;
}

function jobRowOf(raw: unknown): JobRow | null {
  if (!isRecord(raw) || !isWord(raw.id) || !isWord(raw.state)) return null;
  const usage = isRecord(raw.usage) ? raw.usage : {};
  const tokens = (isCount(usage.in) ? usage.in : 0) + (isCount(usage.out) ? usage.out : 0);
  return { id: raw.id, state: raw.state, agent: isWord(raw.agent) ? raw.agent : "", paused: raw.paused === true || raw.state === "paused", plan: isWord(raw.plan) ? raw.plan : null, byUser: isRecord(raw.by) && raw.by.who === "user", tokens, calls: isCount(usage.calls) ? usage.calls : 0, reason: isWord(raw.reason) ? raw.reason : null };
}

/** A job that hasn't ended: waiting for its place, running, or held. */
const UNDER_WAY: readonly string[] = ["queued", "running", "paused"];

/** How many of the chat's latest jobs are looked through for its preparation. */
const JOBS_LOOKED = 50;

type Core = NonNullable<Runtime["harness"]["core"]>;

/** The chat's latest jobs, as LumiAH lists them, the latest first. */
async function jobRows(core: Core, at: { chatId: ChatId; userId: UserId }): Promise<JobRow[]> {
  const page = await core.ask(at.userId, "jobs.list", { chatId: at.chatId, cursor: null, limit: JOBS_LOOKED }, { chat: at.chatId });
  const rows: unknown[] = isRecord(page) && Array.isArray(page.jobs) ? page.jobs : [];
  return rows.flatMap((raw) => jobRowOf(raw) ?? []);
}

/** A job that prepares the story: one the player started with the preparation's file as its plan. */
const preparing = (job: JobRow): boolean => job.byUser && job.plan === PREPARE_PATH;

/**
 * What preparing the story has spent so far, as LumiAH counts it, from the chat's jobs (`rows`):
 * every job the player started on it, each as LumiAH's live view counts it while it runs and as its
 * record does once it stopped. And what one model call of it weighs: the latest while one runs, else
 * the mean of its calls; before it made one, the mean of this chat's last author run (an author's
 * job, or else the chat's latest reply turn); null where LumiAH measured none.
 */
function spentOf(core: Core, at: { chatId: ChatId; userId: UserId }, rows: readonly JobRow[]): JobSpent {
  let tokens = 0;
  let calls = 0;
  let last = 0;
  for (const job of rows.filter(preparing)) {
    const live = UNDER_WAY.includes(job.state) ? (core.spent?.(at.userId, job.id) ?? null) : null;
    tokens += live ? live.in + live.out : job.tokens;
    calls += live ? live.calls : job.calls;
    if (live && live.last > 0) last = live.last;
  }
  if (calls > 0) return { tokens, calls, call: { tokens: last > 0 ? last : Math.round(tokens / calls), from: "job" } };
  const author = rows.find((job) => job.agent === HARNESS_AGENT.author && job.calls > 0);
  const reply = author ? null : (core.spent?.(at.userId, at.chatId) ?? null);
  const before = author ?? (reply !== null && reply.calls > 0 ? { tokens: reply.in + reply.out, calls: reply.calls } : null);
  return { tokens, calls, call: before ? { tokens: Math.round(before.tokens / before.calls), from: "chat" } : null };
}

/** What preparing the story has spent so far (`spentOf`), from the chat's jobs as LumiAH lists them now. */
export async function preparationSpent(core: Core, at: { chatId: ChatId; userId: UserId }): Promise<JobSpent> {
  return spentOf(core, at, await jobRows(core, at));
}

/** The page's line for a plan that waits for the player's word. */
function waitsWords(state: PrepareState): string {
  return `The plan is reckoned at ${count(estimateOf(state))} tokens in all, the author's own work included, above your ceiling of ${count(state.word.ceiling)}. Approve it, steer it, or cap what the whole preparation may spend.`;
}

/** Where the preparation stands, as the page says it, from its file and its latest job. */
function pageState(state: PrepareState | null, job: JobRow | null): { state: PageState; note: string | null } {
  if (state !== null && state.done !== null) return { state: "done", note: null };
  if (job !== null && UNDER_WAY.includes(job.state)) {
    if (job.paused) return { state: "paused", note: WORDS.held };
    if (state === null) return { state: "planning", note: null };
    return waits(state) ? { state: "waiting", note: waitsWords(state) } : { state: "running", note: null };
  }
  if (state === null) {
    if (job === null) return { state: "none", note: null };
    return job.state === "cancelled" ? { state: "cancelled", note: WORDS.cancelled } : { state: "failed", note: job.reason ?? WORDS.noPlanMade };
  }
  if (waits(state)) return { state: "waiting", note: waitsWords(state) };
  if (job?.state === "cancelled") return { state: "cancelled", note: WORDS.cancelled };
  if (job !== null && job.state !== "done") return { state: "failed", note: job.reason ?? WORDS.stopped };
  return { state: "paused", note: WORDS.stopped };
}

/** What isn't prepared yet, a line each: stretches not recorded, principals with moments still to relive, cores and outlines not written, the scene and the notebook not written since the plan. */
async function notYetOf(rt: Runtime, at: { chatId: ChatId; userId: UserId }, files: HarnessFiles, state: PrepareState): Promise<string[]> {
  const name = (id: string): string => state.principals.find((p) => p.id === id)?.name ?? id;
  const out = state.stretches.filter((s) => s.state === "planned" || s.state === "open").map((s) => `${s.id}, #${s.from} to #${s.to}: ${s.state === "open" ? "being recorded" : "not relived yet"}`);
  const read = await chatStoryPort(rt, { ...at, turn: "", on: "first" }).read();
  if (read) for (const id of relivingNow(read.path, state.principals.map((p) => p.id))) out.push(`${name(id)}: moments recorded, not relived yet`);
  const versionOf = async (path: string): Promise<string | null> => (await files.read(path))?.version ?? null;
  for (const p of state.principals) {
    const [core, outline] = await Promise.all([versionOf(mindPath(p.id, "core")), state.kind === "history" ? versionOf(mindPath(p.id, "outline")) : Promise.resolve("")]);
    if (core === null) out.push(`${p.name}: no core yet`);
    if (outline === null) out.push(`${p.name}: nothing in outline yet`);
  }
  const [scene, notebook] = await Promise.all([versionOf(AUTHOR_FILE.scene), versionOf(AUTHOR_FILE.notebook)]);
  if (scene === null || scene === state.marks.scene) out.push(WORDS.scene);
  if (notebook === null || notebook === state.marks.notebook) out.push(WORDS.notebook);
  return out;
}

/** The chat's prepared start as the page shows it. */
async function viewOf(rt: Runtime, chatId: ChatId, userId: UserId): Promise<PrepareView> {
  const none = (note: string): PrepareView => ({ offer: null, state: "none", plan: null, estimate: null, spent: 0, cap: null, steered: [], notYet: [], note, names: {} });
  if ((await rt.chatKnowledge.engine(chatId, userId)) !== "harness") return none(WORDS.noHarness);
  const core = rt.harness.core;
  const files = rt.harness.files?.({ chatId, userId }) ?? null;
  if (core === null || files === null) return none(WORDS.noCore);
  const [file, rows, messages] = await Promise.all([readPrepare(files), jobRows(core, { chatId, userId }), rt.host.chats.messages(chatId, userId)]);
  const { state } = file;
  const shown = pageState(state, rows.find(preparing) ?? null);
  const names: StoryNames = Object.fromEntries((state?.principals ?? []).map((p) => [p.id, p.name]));
  const plan: PreparePlan | null = state
    ? {
        story: state.about,
        principals: state.principals.map((p) => ({ entity: p.id, why: p.why })),
        stretches: state.stretches.map((s) => ({ id: s.id, from: s.from, to: s.to, why: s.why, who: [...s.who], state: s.state, beats: s.beats.length })),
        summaries: state.fills === "" ? null : state.fills,
        authorEstimate: state.estimate.author,
        reckoned: state.estimate.reckoned,
        call: state.estimate.call > 0 ? { tokens: state.estimate.call, from: state.estimate.from } : null,
        ceiling: state.word.ceiling,
      }
    : null;
  return {
    offer: shown.state === "none" ? ((state?.kind ?? chatKind(messages)) === "new" ? WORDS.offerNew : WORDS.offerHistory) : null,
    state: shown.state,
    plan,
    estimate: state ? estimateOf(state) : null,
    spent: spentOf(core, { chatId, userId }, rows).tokens,
    cap: state?.word.cap ?? null,
    steered: state ? [...state.word.said] : [],
    notYet: state && state.done === null ? await notYetOf(rt, { chatId, userId }, files, state) : [],
    note: file.damaged ? WORDS.damaged : shown.note,
    names,
  };
}

/** The task of a job that starts or carries on the preparation, in the user's words: carried on, with the player's word on the plan and what they said. */
function taskOf(texts: PromptTexts, kind: PrepareState["kind"], word: PrepareWord | null): string {
  if (word === null) return renderPrompt(kind === "new" ? PREPARE_NOTE.taskNew : PREPARE_NOTE.taskHistory, texts, {});
  const approved = word.asked && word.approved ? renderPrompt(PREPARE_NOTE.taskApproved, texts, { cap: word.cap === null ? "" : renderPrompt(PREPARE_NOTE.taskCap, texts, { cap: count(word.cap) }) }) : "";
  const said = word.said.length === 0 ? "" : renderPrompt(PREPARE_NOTE.taskWords, texts, { text: word.said.join(" ") });
  return renderPrompt(PREPARE_NOTE.taskCarry, texts, { word: approved, words: said });
}

/** Starts the author's job that prepares the story, as the player's own: it writes the chat's own area, and keeps its plan in the preparation's file. */
async function startJob(core: Core, at: { chatId: ChatId; userId: UserId }, task: string): Promise<void> {
  await core.ask(at.userId, "jobs.start", { chatId: at.chatId, agent: HARNESS_AGENT.author, task, when: "now", area: "chat", plan: PREPARE_PATH }, { chat: at.chatId });
}

/**
 * One of the player's requests about the chat's prepared start (`lre.prepare`), answered with it as
 * it then stands. `start` starts the author's job, which carries on from the file where a plan is
 * there; `approve` writes the player's word into the file, then tells a run under way or starts one
 * that carries on; `steer` and `cap` are kept in the file, which every run reads, and told to a run
 * under way; `pause`, `resume` and `cancel` are LumiAH's own on the latest preparation job, and
 * `resume` with none under way carries an unfinished preparation on. Refused with `PrepareRefused`.
 */
export async function preparePage(rt: Runtime, at: { chatId: ChatId; userId: UserId }, ask: PrepareAsk): Promise<PrepareView> {
  const { chatId, userId } = at;
  if (ask.op === "get") return viewOf(rt, chatId, userId);
  if ((await rt.chatKnowledge.engine(chatId, userId)) !== "harness") throw new PrepareRefused("conflict", WORDS.noHarness);
  const core = rt.harness.core;
  const files = rt.harness.files?.({ chatId, userId }) ?? null;
  if (core === null || files === null) throw new PrepareRefused("unavailable", WORDS.noCore);
  const { texts } = (await rt.settings.get(userId)).prompts;
  const job = (await jobRows(core, at)).find(preparing) ?? null;
  const active = job !== null && UNDER_WAY.includes(job.state) ? job : null;
  const say = async (text: string): Promise<boolean> => {
    if (active === null || active.state !== "running") return false;
    const said = await core.ask(userId, "run.say", { run: active.id, text }, { job: active.id });
    return isRecord(said) && said.said === true;
  };
  // A change of the file the player asks for: made on the file as it stands, refused where there is no plan to change.
  const change = async (make: (state: PrepareState) => PrepareState | PrepareRefused): Promise<PrepareState> => {
    const out = await updatePrepare<PrepareRefused>(files, texts, (now) => {
      if (now.damaged) return { stop: new PrepareRefused("conflict", WORDS.damaged) };
      if (!now.state) return { stop: new PrepareRefused("not_found", WORDS.noPlan) };
      const next = make(now.state);
      return next instanceof PrepareRefused ? { stop: next } : next;
    });
    if ("stop" in out) throw out.stop;
    if ("failed" in out) throw new PrepareRefused("conflict", `${WORDS.unwritten}: ${out.failed}`);
    return out.state;
  };
  switch (ask.op) {
    case "start": {
      if (active) throw new PrepareRefused("conflict", WORDS.running);
      const file = await readPrepare(files);
      if (file.state !== null && file.state.done !== null) throw new PrepareRefused("conflict", WORDS.done);
      // A damaged file is planned afresh: the new plan is written over it.
      await startJob(core, at, taskOf(texts, file.state?.kind ?? chatKind(await rt.host.chats.messages(chatId, userId)), file.state?.word ?? null));
      break;
    }
    case "approve": {
      const state = await change((s) => (s.done !== null ? new PrepareRefused("conflict", WORDS.done) : { ...s, word: { ...s.word, approved: true, for: Math.max(s.word.for, estimateOf(s)) } }));
      const cap = state.word.cap === null ? "" : renderPrompt(PREPARE_NOTE.taskCap, texts, { cap: count(state.word.cap) });
      // The run that wrote the plan ends to wait for this word: a new one carries the preparation on. One still under way is told.
      if (!(await say(renderPrompt(PREPARE_NOTE.sayApproved, texts, { cap }))) && active === null) await startJob(core, at, taskOf(texts, state.kind, state.word));
      break;
    }
    case "steer": {
      const words = ask.text.trim();
      if (words === "") throw new PrepareRefused("bad_request", WORDS.noWords);
      const kept = (await readPrepare(files)).state !== null;
      if (kept) await change((s) => ({ ...s, word: { ...s.word, said: [...s.word.said, words] } }));
      if (!(await say(renderPrompt(PREPARE_NOTE.sayWords, texts, { text: words }))) && !kept) throw new PrepareRefused("not_found", WORDS.noJob);
      break;
    }
    case "cap": {
      const { tokens } = ask;
      if (tokens !== null && !isCount(tokens)) throw new PrepareRefused("bad_request", WORDS.badCap);
      await change((s) => ({ ...s, word: { ...s.word, cap: tokens } }));
      await say(tokens === null ? renderPrompt(PREPARE_NOTE.sayUncapped, texts, {}) : renderPrompt(PREPARE_NOTE.sayCap, texts, { cap: count(tokens) }));
      break;
    }
    case "pause": {
      if (active === null) throw new PrepareRefused("not_found", WORDS.noJob);
      await core.ask(userId, "run.pause", { run: active.id, on: true }, { job: active.id });
      break;
    }
    case "resume": {
      if (active !== null) {
        const letGo = await core.ask(userId, "run.pause", { run: active.id, on: false }, { job: active.id });
        // A job a restart left held has no run to let go: resumed, LumiAH queues it again.
        if (!(isRecord(letGo) && letGo.took === true) && active.paused) await core.ask(userId, "job.resume", { id: active.id }, { job: active.id });
        break;
      }
      const { state } = await readPrepare(files);
      if (state === null || state.done !== null) throw new PrepareRefused("not_found", WORDS.noJob);
      await startJob(core, at, taskOf(texts, state.kind, state.word));
      break;
    }
    case "cancel": {
      if (active === null) throw new PrepareRefused("not_found", WORDS.noJob);
      await core.ask(userId, "jobs.cancel", { id: active.id }, { job: active.id });
      break;
    }
  }
  return viewOf(rt, chatId, userId);
}
