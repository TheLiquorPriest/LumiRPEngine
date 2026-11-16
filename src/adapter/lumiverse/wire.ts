// What RPE and its light Lumiverse extension (`src/ext`) say to each other (STANDALONE-PLAN §4.2,
// §9.6): the one question the extension asks before lore activates, RPE's answer, and the tag the
// extension's prompt interceptor puts on a chat reply's request. Pure, and free of anything Lumiverse
// scans an extension's backend for, because the extension's bundle carries it too.

import { isRecord, type JsonObject } from "../../shared/json";

export type Role = "system" | "user" | "assistant";

/**
 * The request body field the tag rides in. The interceptor returns it as a generation parameter;
 * Lumiverse merges it over the preset's (`generate.service.ts:1436-1441`) and an OpenAI-compatible
 * connection copies every parameter it does not know into the body (`openai-compatible.ts:488-496`).
 */
export const TAG_FIELD = "rpe_turn";

/** RPE's route for the extension's question, under its own API. */
export const QUESTION_PATH = "/api/v1/ext/question";

/** The hash both sides give a text: the first 32 hex digits of SHA-256 over its UTF-8 (the contract's). */
export function textHash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);
}

/** A chat reply as RPE names it. */
export type ReplyKind = "new" | "swipe" | "regenerate" | "continue" | "impersonate";

/** Lumiverse's generation type (`InterceptorGenerationType`) as a reply kind; null for one that is no chat reply (`quiet`, anything unknown). */
export function replyKindOf(type: unknown): ReplyKind | null {
  if (type === "normal") return "new";
  return type === "swipe" || type === "regenerate" || type === "continue" || type === "impersonate" ? type : null;
}

const KINDS: readonly string[] = ["new", "swipe", "regenerate", "continue", "impersonate"];

/** A generation as Lumiverse announced it (`GENERATION_STARTED`, `generate.service.ts:2040-2055`). */
export interface GenerationFacts {
  id: string;
  /** Lumiverse's generation type, as it said it. */
  type: string;
  target: { message: string | null; swipe: number | null };
  speaker: { id: string | null; name: string | null };
  model: string | null;
}

/**
 * One message of the chat along the path the prompt is built from, oldest first, as the World Info interceptor's context gives it
 * (`prompt-assembly.service.ts:2289-2305`): its id, place and showing swipe (null where the speaker did not say), whether it is the
 * player's (`is_user`), and the hash of its shown text (`content`), the same `textHash` the tag's list uses. RPE finds the point of
 * the path from it, and the turn a reply's shown text is tied to.
 */
export interface PathStep {
  id: string;
  index: number;
  swipe: number | null;
  user: boolean;
  hash: string;
}

/** A candidate lore entry, as RPE needs to know it to answer for its secrets (§9.6). */
export interface QuestionEntry {
  id: string;
  book: string;
  disabled: boolean;
  /** The entry's text key as today's secrecy code makes it (`textOf`, `backend/lore-secrets.ts:23-26`): a twin of a secret has its secret's key. */
  key: string;
  /** Only for an entry with secret marks or RPE's fields: its text, its title and RPE's namespace of its extensions. */
  content?: string;
  comment?: string;
  extensions?: JsonObject;
}

export interface Question {
  v: 1;
  user: string;
  chat: string;
  /** "query" when another extension reads what lore a chat activates, with no prompt built. */
  purpose: "prompt" | "query";
  /** The generation Lumiverse last announced for the chat, when the extension heard it. */
  generation: GenerationFacts | null;
  path: PathStep[];
  entries: QuestionEntry[];
}

/** What each secret reads as in this prompt, as today's World Info interceptor answers (`backend/host.ts:214-223`). */
export interface SecrecyVerdict {
  disabled: string[];
  enabled: string[];
  mutated: { id: string; content: string }[];
}

/** The first chat history message the prompt keeps: older history is left out. */
export interface KeepPoint {
  id: string;
  index: number;
}

export interface Answer {
  v: 1;
  /** What each secret reads as in this prompt; null when RPE could not work it out, and the extension keeps every marked secret out by its own fail-closed verdict (`ext/fail-closed.ts`), as with no answer at all. */
  secrecy: SecrecyVerdict | null;
  /** Where the history window starts (`keep` null: all history stays); null when RPE could not say, so the extension cuts nothing. */
  cut: { keep: KeepPoint | null } | null;
  /** Where RPE answered from: whether it knows the chat, and the turn the coming one follows (null at the world's start); null when that could not be worked out. */
  start?: { known: boolean; turn: string | null } | null;
}

/** One message of the prompt as the interceptor handed it on. Lengths are UTF-16 code units; the text is the content's text parts joined (Lumiverse's `getTextContent`, `llm/types.ts:109-115`). */
export interface TagMessage {
  role: Role;
  length: number;
  hash: string;
  /** Its text is empty or only whitespace: Lumiverse drops such a message after the interceptors unless it is joined to another (`generate.service.ts:1414-1426`). */
  blank?: true;
  /** Lumiverse's chat history flag, and the chat message it came from where Lumiverse said. */
  history?: true;
  source?: { id: string; index: number };
  /** Lumiverse's flag for a lore entry standing as a message of its own. */
  lore?: true;
  /** A history message Lumiverse's memory put in place of the messages it summarizes, this one the last of them (`__cortexHistorySummary`, `prompt-assembly.service.ts:3286-3292`). */
  summary?: true;
  /** A trailing assistant message the reply continues (a prefill). */
  partial?: true;
  /** The lengths of its text parts, when its content was a list of parts rather than one text. */
  parts?: number[];
  /** Its parts that are not text (pictures, audio). */
  media?: number;
}

/**
 * A lore entry Lumiverse activated for the prompt, as its `WORLD_INFO_ACTIVATED` event lists it (`activatedWorldInfo`,
 * `generate.service.ts:2868-2879`). RPE hears it on its event socket; the tag carries none. As the event gives it, `how` is
 * Lumiverse's own word ("keyword" or "vector"; nothing more is said) and `told` is false; the door (`activation.ts`) then tells
 * how the entry came in, by Lumiverse's counts, and names its book.
 */
export interface TagLore {
  id: string;
  book: string | null;
  /** Its book's name, where Lumiverse's event or the book's row gave it. */
  bookName: string | null;
  title: string;
  /** How it came into the prompt: always on, by one of its keys, by meaning, or still in force from earlier; null where it cannot be told. */
  how: "constant" | "keyword" | "vector" | "sticky" | null;
  /** `how` is known. False where the door could not tell the ways apart (the entry's sticky setting changed while its window was open, or its row could not be read): `how` is then null. */
  told: boolean;
}

/** The history cut the extension made: on RPE's answer, or none when it had no answer in time (RPE then cuts on receipt). */
export type TagCut = { answered: true; keep: KeepPoint | null; removed: number } | { answered: false };

/** Which secrecy verdict the extension applied: RPE's answer, or its own fail-closed one, and why. */
export type TagSecrecy = { by: "rpe" } | { by: "extension"; why: string };

export interface Tag {
  v: 1;
  user: string;
  chat: string;
  generation: string;
  kind: ReplyKind;
  target: { message: string | null; swipe: number | null };
  speaker: { id: string | null; name: string | null };
  connection: string;
  preset: string | null;
  persona: string | null;
  cut: TagCut;
  secrecy: TagSecrecy;
  /** The question's time, from asked to answered or given up at its wait, in milliseconds; null where none was asked for this prompt. */
  question: { ms: number; answered: boolean } | null;
  messages: TagMessage[];
}

/** A prompt message as the history window reads it: whether it is chat history, and its place in the chat where Lumiverse said. */
export interface CutItem {
  history: boolean;
  index: number | null;
}

/**
 * The places of the history messages the window leaves out: every history message before the first
 * one at or after `keep` in the chat (the kept message itself may be absent: hidden, or clipped by
 * Lumiverse). Nothing else is touched: lore or a note spliced into the history stays where it is.
 */
export function historyCut(items: readonly CutItem[], keep: KeepPoint | null): number[] {
  if (keep === null) return [];
  let first = items.length;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item !== undefined && item.history && item.index !== null && item.index >= keep.index) {
      first = i;
      break;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < first; i++) if (items[i]?.history === true) out.push(i);
  return out;
}

// ---------------------------------------------------------------- reading what the other side sent

const ROLES: readonly string[] = ["system", "user", "assistant"];

function str(v: unknown): v is string {
  return typeof v === "string";
}
function int(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function strOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function intOrNull(v: unknown): v is number | null {
  return v === null || int(v);
}
function ids(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(str);
}

function keepPoint(v: unknown): KeepPoint | null | undefined {
  if (v === null) return null;
  return isRecord(v) && str(v.id) && int(v.index) ? { id: v.id, index: v.index } : undefined;
}

function generationFacts(v: unknown): GenerationFacts | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || !str(v.id) || !str(v.type) || !isRecord(v.target) || !isRecord(v.speaker) || !strOrNull(v.model)) return undefined;
  const { target, speaker } = v;
  if (!strOrNull(target.message) || !intOrNull(target.swipe) || !strOrNull(speaker.id) || !strOrNull(speaker.name)) return undefined;
  return { id: v.id, type: v.type, target: { message: target.message, swipe: target.swipe }, speaker: { id: speaker.id, name: speaker.name }, model: v.model };
}

/** The extension's question, or null when it is not one this build reads. */
export function readQuestion(value: unknown): Question | null {
  if (!isRecord(value) || value.v !== 1 || !str(value.user) || !str(value.chat) || (value.purpose !== "prompt" && value.purpose !== "query")) return null;
  const generation = generationFacts(value.generation);
  if (generation === undefined || !Array.isArray(value.path) || !Array.isArray(value.entries)) return null;
  const path: PathStep[] = [];
  for (const s of value.path) {
    if (!isRecord(s) || !str(s.id) || !int(s.index) || !intOrNull(s.swipe) || typeof s.user !== "boolean" || !str(s.hash)) return null;
    path.push({ id: s.id, index: s.index, swipe: s.swipe, user: s.user, hash: s.hash });
  }
  const entries: QuestionEntry[] = [];
  for (const e of value.entries) {
    if (!isRecord(e) || !str(e.id) || !str(e.book) || typeof e.disabled !== "boolean" || !str(e.key)) return null;
    if ((e.content !== undefined && !str(e.content)) || (e.comment !== undefined && !str(e.comment)) || (e.extensions !== undefined && !isRecord(e.extensions))) return null;
    entries.push({
      id: e.id,
      book: e.book,
      disabled: e.disabled,
      key: e.key,
      ...(str(e.content) ? { content: e.content } : {}),
      ...(str(e.comment) ? { comment: e.comment } : {}),
      ...(isRecord(e.extensions) ? { extensions: e.extensions as JsonObject } : {}),
    });
  }
  return { v: 1, user: value.user, chat: value.chat, purpose: value.purpose, generation, path, entries };
}

/** A secrecy verdict as RPE answers it; undefined when it is not one this build reads. */
function verdictOf(v: unknown): SecrecyVerdict | undefined {
  if (!isRecord(v) || !ids(v.disabled) || !ids(v.enabled) || !Array.isArray(v.mutated)) return undefined;
  const mutated: { id: string; content: string }[] = [];
  for (const m of v.mutated) {
    if (!isRecord(m) || !str(m.id) || !str(m.content)) return undefined;
    mutated.push({ id: m.id, content: m.content });
  }
  return { disabled: [...v.disabled], enabled: [...v.enabled], mutated };
}

/** RPE's answer, or null when it is not one this build reads (the extension then answers by itself). */
export function readAnswer(value: unknown): Answer | null {
  if (!isRecord(value) || value.v !== 1) return null;
  const secrecy = value.secrecy === null ? null : verdictOf(value.secrecy);
  if (secrecy === undefined) return null;
  let cut: Answer["cut"];
  if (value.cut === null) cut = null;
  else if (isRecord(value.cut)) {
    const keep = keepPoint(value.cut.keep);
    if (keep === undefined) return null;
    cut = { keep };
  } else return null;
  const start = isRecord(value.start) && typeof value.start.known === "boolean" && strOrNull(value.start.turn) ? { known: value.start.known, turn: value.start.turn } : null;
  return { v: 1, secrecy, cut, start };
}

function tagMessage(v: unknown): TagMessage | null {
  if (!isRecord(v) || !str(v.role) || !ROLES.includes(v.role) || !int(v.length) || !str(v.hash)) return null;
  const out: TagMessage = { role: v.role as Role, length: v.length, hash: v.hash };
  for (const flag of ["blank", "history", "lore", "summary", "partial"] as const) {
    if (v[flag] === undefined) continue;
    if (v[flag] !== true) return null;
    out[flag] = true;
  }
  if (v.source !== undefined) {
    if (!isRecord(v.source) || !str(v.source.id) || !int(v.source.index)) return null;
    out.source = { id: v.source.id, index: v.source.index };
  }
  if (v.parts !== undefined) {
    if (!Array.isArray(v.parts) || !v.parts.every(int) || v.parts.reduce((a: number, b: number) => a + b, 0) !== v.length) return null;
    out.parts = [...v.parts];
  }
  if (v.media !== undefined) {
    if (!int(v.media)) return null;
    out.media = v.media;
  }
  return out;
}

/** The tag in a provider request's body: absent, one this build reads, or why it is not. */
export function readTag(body: unknown): { tag: Tag } | { absent: true } | { invalid: string } {
  if (!isRecord(body) || body[TAG_FIELD] === undefined) return { absent: true };
  const v = body[TAG_FIELD];
  if (!isRecord(v)) return { invalid: "the tag is not an object" };
  if (v.v !== 1) return { invalid: `the tag is version ${String(v.v)}, and this RPE reads version 1` };
  const kind = v.kind;
  if (!str(v.user) || !str(v.chat) || !str(v.generation) || !str(kind) || !KINDS.includes(kind)) return { invalid: "the tag does not say whose reply, in which chat, of which kind" };
  if (!isRecord(v.target) || !strOrNull(v.target.message) || !intOrNull(v.target.swipe) || !isRecord(v.speaker) || !strOrNull(v.speaker.id) || !strOrNull(v.speaker.name)) return { invalid: "the tag's target or speaker is malformed" };
  if (!str(v.connection) || !strOrNull(v.preset) || !strOrNull(v.persona)) return { invalid: "the tag's connection, preset or persona is malformed" };
  if (!isRecord(v.cut)) return { invalid: "the tag does not say what was cut" };
  let cut: TagCut;
  if (v.cut.answered === false) cut = { answered: false };
  else {
    const at = v.cut.answered === true ? keepPoint(v.cut.keep) : undefined;
    if (at === undefined || !int(v.cut.removed)) return { invalid: "the tag's cut is malformed" };
    cut = { answered: true, keep: at, removed: v.cut.removed };
  }
  const secrecy: TagSecrecy | null = isRecord(v.secrecy) && v.secrecy.by === "rpe" ? { by: "rpe" } : isRecord(v.secrecy) && v.secrecy.by === "extension" && str(v.secrecy.why) ? { by: "extension", why: v.secrecy.why } : null;
  if (secrecy === null) return { invalid: "the tag does not say whose secrecy verdict was applied" };
  const question = v.question === null ? null : isRecord(v.question) && int(v.question.ms) && typeof v.question.answered === "boolean" ? { ms: v.question.ms, answered: v.question.answered } : undefined;
  if (question === undefined) return { invalid: "the tag's question time is malformed" };
  if (!Array.isArray(v.messages)) return { invalid: "the tag lists no messages" };
  const messages: TagMessage[] = [];
  for (const m of v.messages) {
    const read = tagMessage(m);
    if (read === null) return { invalid: `the tag's message ${messages.length} is malformed` };
    messages.push(read);
  }
  return {
    tag: {
      v: 1,
      user: v.user,
      chat: v.chat,
      generation: v.generation,
      kind: kind as ReplyKind,
      target: { message: v.target.message, swipe: v.target.swipe },
      speaker: { id: v.speaker.id, name: v.speaker.name },
      connection: v.connection,
      preset: v.preset,
      persona: v.persona,
      cut,
      secrecy,
      question,
      messages,
    },
  };
}
