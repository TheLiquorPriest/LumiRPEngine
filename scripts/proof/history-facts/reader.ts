// The reader of the history gate's facts (STANDALONE-PLAN §17.3 l.1799), the one every package uses
// (PlanScenarios-7 to plant chat c, PlanGates-15 and PlanGates-40 to check, grade and report):
//   - the facts of a chat by name (`factsFor`);
//   - one match that finds a fact's answer in any form a writer or a model plausibly writes it
//     (`findAnswer`), which both the check and the judges use, so a reply is graded right by the
//     same code that says the answer has left the prompt (`grade`);
//   - the check of a chat at the moment each fact is asked (`checkChat`), with a report that says, fact
//     by fact, whether it can be asked and why.
//
// The plan's condition is "twenty facts are planted only in messages that have left the window and in
// no lore entry", and "a principal asked about what it did not [witness], it does not know". So a fact
// is whole at its moment when its line stands where the data puts it, shown, with no statement of its
// answer before it, none inside the window, and none in the card, an attached book or the world's own
// lore. It can be asked when it is whole and its last statement's reply has left the window too; in
// chat b only when that last statement lies in the far past the story so far gives by a chapter's
// summary or by the line that says it is not shown (§8.1 l.918); and, asked of its absent principal,
// only when that principal has not heard it since. A fact that cannot be asked is reported with why
// and counted neither as a pass nor as a miss.

import { isRecord } from "../../../src/shared/json";
import { FACTS, OPTIONS, PRINCIPALS, type Answer, type ChatName, type PlantedFact, type PrincipalId } from "./facts";

export { CHAT_NAMES, GATE_LENGTH, GATE_WINDOW, LAST_PLACE, OPTIONS, PRINCIPALS, type Answer, type ChatName, type PlantedFact, type PrincipalId } from "./facts";

/** The twenty facts asked in a chat, in the order of their places; chat b is chat a carried on, so it asks chat a's. */
export function factsFor(chat: ChatName): PlantedFact[] {
  const planted = chat === "c" ? "c" : "a";
  return FACTS.filter((fact) => fact.chat === planted).sort((x, y) => x.place - y.place);
}

/** Each of a chat's facts asked by its own question at one index: the planting check before any is asked. */
export function asksAt(chat: ChatName, at: number): Ask[] {
  return factsFor(chat).map((fact): Ask => ({ fact: fact.id, to: "question", at }));
}

// ---- The one match ----

interface Prepared {
  /** The text with accents taken off, for the digit forms. */
  raw: string;
  lower: string;
  /** Its words, lower case, one space apart and padded, for the spelled forms. */
  words: string;
  wordSet: ReadonlySet<string>;
  /** Its runs of letters, for names. */
  tokens: { text: string; start: number; end: number }[];
}

function prepare(text: string): Prepared {
  const raw = text.normalize("NFKD").replace(/\p{M}/gu, "");
  const lower = raw.toLowerCase();
  const list = lower.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = [...lower.matchAll(/\p{L}+/gu)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  return { raw, lower, words: ` ${list.join(" ")} `, wordSet: new Set(list), tokens };
}

/** Whether two words are at most one letter apart: one added, dropped, changed, or two side by side swapped. */
function withinOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// A name split at a syllable is split by one space or one hyphen.
const SPLIT = /^(?:[ \u00a0]|[-\u2010\u2011\u00ad])$/;

function findName(text: Prepared, wanted: string): string | null {
  const target = wanted.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const loose = target.length >= OPTIONS.nameOneOffFrom;
  const { tokens } = text;
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].text;
    if (word === target) return "as written";
    if (loose && withinOne(word, target)) return "one letter off";
    const next = tokens[i + 1];
    if (next === undefined) continue;
    const gap = text.lower.slice(tokens[i].end, next.start);
    if (!SPLIT.test(gap)) continue;
    const joined = word + next.text;
    if (joined === target) return gap.trim() === "" ? "split" : "hyphenated";
    if (loose && withinOne(joined, target)) return "split, one letter off";
  }
  return null;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ZERO = ["zero", "oh", "o", "nought"];
/** Words that would make a spelled number found inside a longer one ("a", "and", "o" and "oh" are too common to count). */
const NUMBER_WORDS = new Set([...ONES, ...TEENS, ...TENS.filter(Boolean), "hundred", "thousand", "million", "nought"]);

/** 0 to 99 in words, with spaces where a writer may put a hyphen. */
function under100(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  return n % 10 === 0 ? TENS[n / 10] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`;
}

/** The number as counted: "three thousand nine hundred and sixty two", with and without "and", "a" for a leading one. */
function cardinals(n: number): string[] {
  if (n < 100) return [under100(n)];
  const big = n >= 1000;
  const unit = big ? 1000 : 100;
  const head = Math.floor(n / unit);
  const rest = n % unit;
  const word = big ? "thousand" : "hundred";
  const heads = head === 1 ? [`one ${word}`, `a ${word}`] : [`${ONES[head]} ${word}`];
  if (rest === 0) return heads;
  const tails = rest < 100 ? [`and ${under100(rest)}`, under100(rest)] : cardinals(rest);
  return heads.flatMap((first) => tails.map((tail) => `${first} ${tail}`));
}

function digitByDigit(digits: string): string[] {
  let out = [""];
  for (const digit of digits) {
    const words = digit === "0" ? ZERO : [ONES[Number(digit)]];
    out = out.flatMap((so) => words.map((word) => (so === "" ? word : `${so} ${word}`)));
  }
  return out;
}

/** Two digits said after a first part: "seventeen", "oh five", or "hundred" for 00. */
function tailWords(two: string): string[] {
  if (two === "00") return ["hundred"];
  if (two[0] === "0") return ZERO.map((zero) => `${zero} ${ONES[Number(two[1])]}`);
  return [under100(Number(two))];
}

/** Every way the number is spelled out: counted, digit by digit, in pairs ("forty eight seventeen", "six fifteen") and in hundreds ("thirty nine hundred and sixty two"). */
function spelled(n: number): string[] {
  const digits = String(n);
  if (digits.length > OPTIONS.spelledDigits) return [];
  const out = new Set([...cardinals(n), ...digitByDigit(digits)]);
  if (digits.length === 3) for (const tail of tailWords(digits.slice(1))) out.add(`${ONES[Number(digits[0])]} ${tail}`);
  if (digits.length === 4) {
    const head = Number(digits.slice(0, 2));
    const rest = Number(digits.slice(2));
    for (const tail of tailWords(digits.slice(2))) out.add(`${under100(head)} ${tail}`);
    if (head % 10 !== 0 && rest !== 0) for (const and of ["and ", ""]) out.add(`${under100(head)} hundred ${and}${under100(rest)}`);
  }
  return [...out];
}

/** Whether a spelled phrase stands in the text on its own, not inside a longer spelled number. */
function phraseIn(text: Prepared, phrase: string, after?: (next: string) => boolean): boolean {
  for (const word of phrase.split(" ")) if (!text.wordSet.has(word)) return false;
  const needle = ` ${phrase} `;
  for (let at = text.words.indexOf(needle); at >= 0; at = text.words.indexOf(needle, at + 1)) {
    const before = text.words.slice(text.words.lastIndexOf(" ", at - 1) + 1, at);
    const rest = text.words.slice(at + needle.length);
    const next = rest.slice(0, rest.indexOf(" ") < 0 ? rest.length : rest.indexOf(" "));
    if (NUMBER_WORDS.has(before) || NUMBER_WORDS.has(next)) continue;
    if (after !== undefined && !after(rest)) continue;
    return true;
  }
  return false;
}

// A digit form stands alone: no digit, or digit and separator, on either side; an amount may end in ".00".
const NOT_AFTER_DIGIT = "(?<!\\d)(?<!\\d[,.'’\\u00a0\\u202f \\-–—·])";
const NOT_BEFORE_DIGIT = "(?!\\d)(?![,.'’\\u00a0\\u202f \\-–—·]\\d)";
const GROUP = "[,.'’\\u00a0\\u202f ]";
const DIGIT_GAP = "(?:\\s*[-–—.·]\\s*|\\s+)";
const PAIR_GAP = "(?:\\s*[-–—]\\s*|\\s+)";

function findAmount(text: Prepared, dollars: number): string | null {
  const d = String(dollars);
  const forms: [string, string][] = [["as written", d]];
  if (d.length >= 4) forms.push(["grouped", `${d.slice(0, -3)}${GROUP}${d.slice(-3)}`]);
  forms.push(["digit by digit", [...d].join(DIGIT_GAP)]);
  if (d.length === 4) forms.push(["in pairs", `${d.slice(0, 2)}${PAIR_GAP}${d.slice(2)}`]);
  for (const [form, body] of forms) if (new RegExp(`${NOT_AFTER_DIGIT}${body}(?:[.,]00(?!\\d))?${NOT_BEFORE_DIGIT}`, "u").test(text.raw)) return form;
  for (const phrase of spelled(dollars)) if (phraseIn(text, phrase)) return "spelled out";
  return null;
}

const AM_WORDS = /^\s*(?:a\.?\s?m\b\.?|in the morning)/i;
const PM_WORDS = /^\s*(?:p\.?\s?m\b\.?|in the (?:afternoon|evening)|at night|tonight)/i;
const AM_SPELLED = /^(?:a m|am|in the morning) /;
const PM_SPELLED = /^(?:p m|pm|in the (?:afternoon|evening)|at night|tonight) /;

function findTime(text: Prepared, at: string): string | null {
  const [hour, minute] = at.split(":").map(Number);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const pm = hour >= 12;
  const mm = String(minute).padStart(2, "0");
  // On the 12-hour clock a time with no half named is right; with the other half named it is another time.
  const sameHalf = (rest: string, am: RegExp, pmWords: RegExp): boolean => !(pm ? am.test(rest) : pmWords.test(rest));
  // A clock reading stands alone, seconds allowed ("3:38:20"); one inside a dotted run ("3.38.0", "1.3.38") is a version or a figure, not a time.
  const alone = (body: string): string => `(?<!\\d)(?<!\\d[.:])${body}(?::[0-5]\\d)?(?!\\d)(?![.:]\\d)`;
  for (const match of text.raw.matchAll(new RegExp(alone(`0?${twelve}[:.]${mm}`), "gu"))) {
    if (sameHalf(text.raw.slice(match.index + match[0].length), AM_WORDS, PM_WORDS)) return twelve === hour ? "as written" : "12-hour clock";
  }
  // The 24-hour reading of a morning time is its 12-hour one, already looked for with its half; only "0543 hours" is its own.
  const military = `(?<!\\d)0?${hour}${mm}(?=\\s*(?:hours|hrs)\\b)`;
  if (new RegExp(hour === twelve ? military : `${alone(`${hour}[:.h]${mm}`)}|${military}`, "u").test(text.raw)) return "24-hour clock";
  const minutes = minute < 10 ? ZERO.map((zero) => `${zero} ${ONES[minute]}`) : [under100(minute)];
  for (const words of minutes) {
    if (phraseIn(text, `${under100(twelve)} ${words}`, (rest) => sameHalf(rest, AM_SPELLED, PM_SPELLED))) return "spelled out";
    if (hour !== twelve && phraseIn(text, `${under100(hour)} ${words}`)) return "spelled out, 24-hour clock";
  }
  const past = [`${under100(minute)} minutes past`, `${under100(minute)} past`, `${under100(minute)} minutes after`, `${under100(minute)} after`].map((lead) => `${lead} ${under100(twelve)}`);
  const nextHour = twelve === 12 ? 1 : twelve + 1;
  const to = minute > 30 ? [`${under100(60 - minute)} minutes to`, `${under100(60 - minute)} to`, `${under100(60 - minute)} minutes before`].map((lead) => `${lead} ${under100(nextHour)}`) : [];
  for (const phrase of [...past, ...to]) if (phraseIn(text, phrase, (rest) => sameHalf(rest, AM_SPELLED, PM_SPELLED))) return "spelled out, minutes and hour";
  return null;
}

function findIn(text: Prepared, answer: Answer): string | null {
  if (answer.type === "name") return findName(text, answer.name);
  if (answer.type === "amount") return findAmount(text, answer.dollars);
  return findTime(text, answer.at);
}

/**
 * The form a text carries an answer in, or null when it carries none. Numbers and amounts: as written,
 * grouped ("3,962", "3.962", "3 962"), digit by digit ("4-8-1-7", "4 8 1 7", "4.8.1.7"), in pairs
 * ("48-17", "48 17"), spelled out up to `OPTIONS.spelledDigits` digits, and with letters or signs on
 * either side ("MC6258", "#6258", "No. 6258", "$3,962", "3962km"). Times: "4:37", "4.37", "04:37",
 * spelled out, on the 12- and the 24-hour clock. Names: any case, possessive, split or hyphenated at a
 * syllable, and one letter off from `OPTIONS.nameOneOffFrom` letters.
 */
export function findAnswer(text: string, answer: Answer): string | null {
  return findIn(prepare(text), answer);
}

export interface Grade {
  /** The reply carries the answer in a form the match finds. */
  right: boolean;
  /** That form, or null. */
  form: string | null;
}

/** How a judge grades a reply to a fact's question: right when it carries the answer, in the same match the check uses; wrong otherwise. Asked of the absent principal, `right` means it knows what it did not witness. */
export function grade(reply: string, fact: PlantedFact): Grade {
  const form = findAnswer(reply, fact.answer);
  return { right: form !== null, form };
}

const escapeText = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NAMING = new Map<PrincipalId, RegExp>(
  Object.values(PRINCIPALS).map((principal) => {
    const names = [principal.first, principal.surname, ...principal.roles].map(escapeText).join("|");
    return [principal.id, new RegExp(`(?<![\\p{L}\\p{N}])(?:${names})(?![\\p{L}\\p{N}])`, "iu")];
  }),
);

/** Whether a text names a principal by any name the starter world gives it: first name, surname or role. */
export function mentions(text: string, principal: PrincipalId): boolean {
  return NAMING.get(principal)?.test(text.replace(/[’‘]/g, "'")) ?? false;
}

/**
 * Every string and number inside a value, one to a line: a lore entry or a card as any reader returns
 * it, keys and titles included, so that no field that can reach a prompt is left out of the check.
 */
export function textOf(value: unknown): string {
  const out: string[] = [];
  const walk = (item: unknown): void => {
    if (typeof item === "string") out.push(item);
    else if (typeof item === "number" && Number.isFinite(item)) out.push(String(item));
    else if (Array.isArray(item)) for (const each of item) walk(each);
    else if (item !== null && typeof item === "object") for (const each of Object.values(item)) walk(each);
  };
  walk(value);
  // A bar between values, so that two numbers side by side in a record never read as one written digit by digit.
  return out.join("\n|\n");
}

// ---- The check ----

/**
 * A chat's message as Lumiverse keeps it (Lumiverse's `src/types/message.ts`): `content` is the shown
 * swipe's text. A history message reaches the prompt with more than its content: a user turn with its
 * regex appendix (`extra.associative_regex_append`, joined on in `src/services/prompt-assembly.service.ts:593-597`),
 * an assistant turn with its stored reasoning (`extra.reasoningCarrier`, `:287-327`) on a connection that replays it.
 */
export interface ChatMessage {
  index_in_chat: number;
  is_user: boolean;
  content: string;
  extra?: { readonly hidden?: unknown; readonly associative_regex_append?: unknown; readonly reasoningCarrier?: unknown } | null;
}

/** Text the chat is played with besides its messages, named as a report should name it. */
export interface Source {
  name: string;
  text: string;
}

/**
 * Which lore counts. The card and every Lumiverse book attached to the chat count, since both arms read
 * them, and so does the world's own lore as it was made before play. Lore that RPE's own agents wrote
 * into the world during play (or today's build's, for chat c) is the record the gate measures (§8.1):
 * it never counts against a fact, and the report lists it.
 */
export interface Lore {
  card: Source;
  books: readonly Source[];
  world: readonly Source[];
  played?: readonly Source[];
}

/** A run of messages, both ends included. */
export interface Span {
  from: number;
  to: number;
}

/** A part of the story so far the Author was given (§8.1 l.917-918), with the messages it stands for. */
export interface StoryPart extends Span {
  part: "chapter" | "scene" | "beats" | "not shown";
}

/** The summaries each arm read when a question was asked. */
export interface Reach {
  /** Plain generation: the messages Lumiverse's own summary covered then, as Lumiverse records it; null when it records none. */
  plain: Span | null;
  /** RPE: the story so far in that turn's briefing; null when the run gave none. */
  story: readonly StoryPart[] | null;
}

/** Who the cast record has on stage, by principal, for a run of messages. */
export interface Stage extends Span {
  on: readonly PrincipalId[];
}

/** One question asked in the chat: a fact's own, or the one put to its absent principal, and the index of the question's message. */
export interface Ask {
  fact: string;
  to: "question" | "absent";
  at: number;
  reach?: Reach;
}

export interface CheckInput {
  chat: ChatName;
  /** The chat's messages; for each question only those before it are read. */
  messages: readonly ChatMessage[];
  /** How many of the latest messages that are not hidden the prompt holds, the question itself among them. */
  window: number;
  /** Whether the chat's connection sends an assistant turn's stored reasoning back with it. */
  reasoning: "replayed" | "not replayed";
  lore: Lore;
  asks: readonly Ask[];
  /** The cast record's stage, where the run gives one: a statement made with the absent principal on stage is heard. */
  stage?: readonly Stage[];
}

export interface AskReport {
  fact: PlantedFact;
  to: "question" | "absent";
  at: number;
  /** The planting line's index, and its reply's when the reply carries the answer too. */
  plant: number[];
  /** The latest shown message before the question that carries the answer, with the form it is in. */
  last: { index: number; form: string } | null;
  /** The message after the last statement. */
  reply: number | null;
  /** By how many messages the last statement and its reply stand outside the window (0 or less: inside). */
  outside: { statement: number | null; reply: number | null };
  /** The oldest message before the question that the window holds; null when it holds none. */
  windowFrom: number | null;
  /** Every other statement of the answer after its line, hidden ones marked. */
  repeats: { index: number; hidden: boolean }[];
  /** For a witnessed fact: the statements its absent principal heard, by name or on stage. */
  heard: number[];
  /** Whether Lumiverse's own summary covered the last statement when the question was asked. */
  plain: "covers it" | "does not cover it" | "not recorded";
  /** The part of RPE's story so far that holds the last statement. */
  story: StoryPart["part"] | "in no part" | "not given";
  /** Lore written in play that holds the answer: listed, never a fault. */
  played: string[];
  /** What breaks the gate's condition for the fact at this moment, each naming its message or source. */
  faults: string[];
  /** What keeps a whole fact from being asked here. */
  holds: string[];
  whole: boolean;
  askable: boolean;
  /** The report's line: the fact, its indices and its verdict, with why. */
  line: string;
}

export interface ChatCheck {
  chat: ChatName;
  window: number;
  /** The sources and the message fields the check read. */
  read: { sources: string[]; fields: string[] };
  /** Faults of the messages as given, before any fact. */
  faults: string[];
  asks: AskReport[];
  /** No fault of the chat's own, and every fact asked was whole at its own moment. */
  whole: boolean;
}

// Lumiverse leaves a message out of the prompt when `extra.hidden` is true (Lumiverse's `src/services/prompt-assembly.service.ts:3252`).
const hidden = (message: ChatMessage): boolean => message.extra?.hidden === true;

/** The readable reasoning of an assistant turn's carrier; signatures and encrypted blocks are not text a model reads. */
function reasoningText(carrier: unknown): string[] {
  if (!isRecord(carrier)) return [];
  if (carrier.type === "reasoning_content" && typeof carrier.content === "string") return [carrier.content];
  if (carrier.type === "thinking_blocks" && Array.isArray(carrier.blocks)) return carrier.blocks.flatMap((block) => (isRecord(block) && typeof block.thinking === "string" ? [block.thinking] : []));
  if (carrier.type === "reasoning_details" && Array.isArray(carrier.details)) return carrier.details.flatMap((detail) => (isRecord(detail) ? [detail.text, detail.summary].filter((part): part is string => typeof part === "string") : []));
  return [];
}

/** What of a message reaches the prompt: its content, a user turn's regex appendix, a replayed assistant turn's reasoning. */
function readText(message: ChatMessage, replayed: boolean): string {
  const parts = [message.content];
  const appendix = message.extra?.associative_regex_append;
  if (message.is_user && Array.isArray(appendix)) for (const item of appendix) if (isRecord(item) && typeof item.content === "string") parts.push(item.content);
  if (!message.is_user && replayed) parts.push(...reasoningText(message.extra?.reasoningCarrier));
  return parts.join("\n");
}

const within = (span: Span, index: number): boolean => index >= span.from && index <= span.to;

/** Whether a chat can be asked its facts, each at its own moment, with the report each question needs. */
export function checkChat(input: CheckInput): ChatCheck {
  if (!Number.isInteger(input.window) || input.window < 1) throw new RangeError(`a window holds a whole number of messages, at least 1; ${input.window} was given`);
  const { card, books, world } = input.lore;
  if (card.text.trim() === "") throw new Error("The check needs the card the chat is played with: give it as the card source.");
  if (world.length === 0) throw new Error("The check needs the world's own lore: give every entry of the world the chat is played with.");
  const played = input.lore.played ?? [];
  const replayed = input.reasoning === "replayed";

  const messages = [...input.messages].sort((x, y) => x.index_in_chat - y.index_in_chat);
  const faults: string[] = [];
  const byIndex = new Map<number, ChatMessage>();
  for (const message of messages) {
    if (byIndex.has(message.index_in_chat)) faults.push(`two messages are at index ${message.index_in_chat}`);
    else byIndex.set(message.index_in_chat, message);
  }
  const texts = messages.map((message) => readText(message, replayed));
  const prepared = texts.map(prepare);
  const counting = [card, ...books, ...world].map((source) => ({ name: source.name, text: prepare(source.text) }));
  const writtenInPlay = played.map((source) => ({ name: source.name, text: prepare(source.text) }));
  const facts = new Map(factsFor(input.chat).map((fact) => [fact.id, fact]));
  const forms = new Map<string, (string | null)[]>();

  const asks = input.asks.map((ask): AskReport => {
    const fact = facts.get(ask.fact);
    if (fact === undefined) throw new Error(`chat ${input.chat} asks no fact ${ask.fact}`);
    if (ask.to === "absent" && fact.absent === null) throw new Error(`${fact.id} was witnessed by nobody, so it has no absent principal to ask`);
    if (!Number.isInteger(ask.at) || ask.at <= fact.place + 1) throw new RangeError(`${fact.id} is asked at ${ask.at}, which is not after its line at ${fact.place} and its reply`);
    let found = forms.get(fact.id);
    if (found === undefined) {
      found = prepared.map((text) => findIn(text, fact.answer));
      forms.set(fact.id, found);
    }
    const own: string[] = [];
    const holds: string[] = [];

    const line = byIndex.get(fact.place);
    let planted = false;
    if (line === undefined) own.push(`no message is at index ${fact.place}, where the line that plants it goes`);
    else if (!line.is_user) own.push(`the message at index ${fact.place} is not the player's, so the line that plants it is not there`);
    // A line whose spacing a composer or Lumiverse changed still stands where it was planted.
    else if (!line.content.replace(/\s+/g, " ").includes(fact.line.replace(/\s+/g, " ").trim())) own.push(`the message at index ${fact.place} does not hold the line that plants it`);
    else {
      planted = true;
      if (hidden(line)) own.push(`the line that plants it, at index ${fact.place}, is hidden, so it was never in a prompt`);
    }

    // The window at this question: the question and the latest shown messages before it, `window` in all.
    const before = messages.map((message, n) => ({ message, n })).filter(({ message }) => message.index_in_chat < ask.at);
    const shown = before.filter(({ message }) => !hidden(message));
    const firstKept = Math.max(0, shown.length - (input.window - 1));
    const windowFrom = shown[firstKept]?.message.index_in_chat ?? null;
    const position = new Map(shown.map(({ message }, p) => [message.index_in_chat, p]));
    const outsideBy = (index: number | null): number | null => {
      const p = index === null ? undefined : position.get(index);
      return p === undefined ? null : firstKept - p;
    };

    const statements = before.flatMap(({ message, n }) => {
      const form = found[n];
      return form === null ? [] : [{ index: message.index_in_chat, hidden: hidden(message), form, n }];
    });
    const plant = planted ? [fact.place] : [];
    const replyToLine = byIndex.get(fact.place + 1);
    if (planted && replyToLine !== undefined && !replyToLine.is_user && statements.some((s) => s.index === fact.place + 1)) plant.push(fact.place + 1);
    for (const s of statements) if (s.index < fact.place) own.push(`the answer is in message ${s.index}, before the line that plants it`);
    const shownStatements = statements.filter((s) => !s.hidden);
    const latest = shownStatements.at(-1);
    const last = latest === undefined ? null : { index: latest.index, form: latest.form };
    const lastAt = latest === undefined ? -1 : shown.findIndex(({ message }) => message.index_in_chat === latest.index);
    const reply = lastAt < 0 ? null : (shown[lastAt + 1]?.message.index_in_chat ?? null);
    for (const s of shownStatements) {
      const by = outsideBy(s.index);
      if (by !== null && by <= 0) own.push(s.index === fact.place ? `the line that plants it, message ${s.index}, is inside the window of the latest ${input.window} messages` : `the answer is in message ${s.index}, inside the window of the latest ${input.window} messages`);
    }
    const replyBy = reply === null ? (last === null ? null : 0) : outsideBy(reply);
    if (last !== null && (outsideBy(last.index) ?? 0) > 0 && (replyBy ?? 0) <= 0) holds.push(reply === null ? `its last statement, message ${last.index}, has no reply before the question` : `the reply to its last statement, message ${reply}, is still inside the window`);
    const repeats = statements.filter((s) => s.index > fact.place && !plant.includes(s.index)).map((s) => ({ index: s.index, hidden: s.hidden }));

    for (const source of counting) if (findIn(source.text, fact.answer) !== null) own.push(`the answer is in ${source.name}`);
    const inPlay = writtenInPlay.filter((source) => findIn(source.text, fact.answer) !== null).map((source) => source.name);

    const reachAt = last?.index ?? fact.place;
    const parts = ask.reach?.story ?? null;
    const holding = parts?.find((part) => within(part, reachAt));
    const story: AskReport["story"] = parts === null ? "not given" : (holding?.part ?? "in no part");
    if (input.chat === "b") {
      if (parts === null) holds.push("chat b's story so far was not given, so its far past cannot be told");
      else if (holding === undefined) holds.push(`its last statement, message ${reachAt}, is in no part of the story so far`);
      else if (holding.part === "scene" || holding.part === "beats") holds.push(`its last statement, message ${reachAt}, lies in the story so far's ${holding.part === "scene" ? "scene summaries" : "beats"} (${holding.from}-${holding.to}), not its far past`);
    }
    const plainSpan = ask.reach?.plain ?? null;
    const plain: AskReport["plain"] = plainSpan === null ? "not recorded" : within(plainSpan, reachAt) ? "covers it" : "does not cover it";

    const heard: number[] = [];
    if (fact.absent !== null) {
      const absent = fact.absent.principal;
      for (const s of statements) {
        if (s.index < fact.place) continue;
        const onStage = input.stage?.some((span) => within(span, s.index) && span.on.includes(absent)) ?? false;
        if (onStage || mentions(texts[s.n], absent)) heard.push(s.index);
      }
      if (ask.to === "absent" && heard.length > 0) holds.push(`its absent principal, ${PRINCIPALS[absent].first}, has heard it: message${heard.length > 1 ? "s" : ""} ${heard.join(", ")}`);
    }

    const whole = own.length === 0;
    const askable = whole && holds.length === 0;
    const statementBy = last === null ? null : outsideBy(last.index);
    const who = ask.to === "absent" && fact.absent !== null ? `asked of ${PRINCIPALS[fact.absent.principal].first}, who was not there` : fact.witness !== null ? `asked of ${PRINCIPALS[fact.witness].first}, who was there` : "its question";
    const where = last === null ? "no statement of it before the question" : `last stated in message ${last.index} (${last.form}), ${statementBy !== null && statementBy > 0 ? `${statementBy} outside the window` : "inside the window"}, its reply ${reply === null ? "none" : `message ${reply}${replyBy !== null && replyBy > 0 ? `, ${replyBy} outside` : ", inside"}`}`;
    const pieces = [
      `${fact.id} (${who}, at ${ask.at})`,
      `planted at ${plant.length > 0 ? plant.join(" and ") : `${fact.place} (not there)`}`,
      where,
      repeats.length > 0 ? `repeated in ${repeats.map((r) => `${r.index}${r.hidden ? " (hidden)" : ""}`).join(", ")}` : "never repeated",
      `Lumiverse's summary: ${plain}`,
      `story so far: ${story}`,
      ...(inPlay.length > 0 ? [`in lore written in play: ${inPlay.join(", ")}`] : []),
    ];
    const verdict = askable ? "can be asked" : `cannot be asked: ${[...own, ...holds].join("; ")}`;
    return {
      fact,
      to: ask.to,
      at: ask.at,
      plant,
      last,
      reply,
      outside: { statement: statementBy, reply: replyBy },
      windowFrom,
      repeats,
      heard,
      plain,
      story,
      played: inPlay,
      faults: own,
      holds,
      whole,
      askable,
      line: `${pieces.join("; ")}; ${verdict}.`,
    };
  });

  const fields = ["content", "extra.associative_regex_append (the player's turns)", replayed ? "extra.reasoningCarrier (the model's turns, which this connection replays)" : "not extra.reasoningCarrier (this connection does not replay it)"];
  const sources = [card.name, ...books.map((book) => book.name), ...world.map((entry) => entry.name), ...played.map((entry) => `${entry.name} (written in play: listed, not counted)`)];
  return { chat: input.chat, window: input.window, read: { sources, fields }, faults, asks, whole: faults.length === 0 && asks.every((ask) => ask.whole) };
}
