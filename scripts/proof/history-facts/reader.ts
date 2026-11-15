// The reader of the history gate's facts (STANDALONE-PLAN §17.3 l.1799), the one every package uses:
// the facts of a chat by name, and the check that a chat can be asked them as the gate asks, run on the
// chat's messages as they stand at the moment its facts are about to be asked (for chats a and c at
// their 300th message, for chat b at its own end). The plan's condition is "twenty facts are planted
// only in messages that have left the window and in no lore entry". Read with the planner (PlanGates,
// 15 Nov), it fails a fact, naming the message:
//   - when its line is not where the data puts it, or is hidden (a hidden message is never in a prompt);
//   - when its answer is in a message before that line;
//   - when its answer is in one of the latest messages the window holds, hidden ones not counted
//     (READINGS R-21: hidden messages are not in the prompt and do not count toward the window's X);
//   - when its answer is in the card or in any lore entry.
// The planting line and the reply it got are the plant. A later message that repeats the answer and has
// also left the window is listed as a repeat and is no fault: the answer still comes only from beyond
// the window, and play makes such repeats.

import { FACTS, type ChatName, type PlantedFact } from "./facts";

export { CHAT_NAMES, GATE_LENGTH, GATE_WINDOW, type Asked, type ChatName, type PlantedFact } from "./facts";

/** The twenty facts asked in a chat, in the order of their places. */
export function factsFor(chat: ChatName): PlantedFact[] {
  return FACTS.filter((fact) => fact.chat === chat).sort((x, y) => x.place - y.place);
}

/**
 * Every fact whose line a chat holds, in the order of their places: the lines its script plants.
 * Chat b is chat a carried on, so chat a's script plants chat b's twenty as well (and asks only its own).
 */
export function plantedIn(chat: ChatName): PlantedFact[] {
  const shared: readonly ChatName[] = chat === "c" ? ["c"] : ["a", "b"];
  return FACTS.filter((fact) => shared.includes(fact.chat)).sort((x, y) => x.place - y.place);
}

function wordPattern(answer: string): RegExp {
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu");
}

/** Whether a text carries an answer: the whole word or number, in any case. */
export function holds(text: string, answer: string): boolean {
  return wordPattern(answer).test(text);
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
  return out.join("\n");
}

/** A chat's message as Lumiverse keeps it (Lumiverse's `src/types/message.ts`): `content` is the shown swipe's text. */
export interface ChatMessage {
  index_in_chat: number;
  is_user: boolean;
  content: string;
  extra?: { readonly hidden?: unknown } | null;
}

/** Text the chat is played with besides its messages, named as a report should name it. */
export interface Source {
  name: string;
  text: string;
}

export interface CheckInput {
  chat: ChatName;
  /** The chat's messages as they stand when its facts are about to be asked. */
  messages: readonly ChatMessage[];
  /** Every entry of every book the chat is played with, every entry of the world's own lore, and the card. */
  sources: readonly Source[];
  /** The chat's window: how many of the latest messages that are not hidden the prompt holds. */
  window: number;
}

export interface FactCheck {
  fact: PlantedFact;
  /** Where the answer stands as planted: the planting line, and the reply it got if that carries it. */
  plant: number[];
  /** Later messages, also outside the window, that repeat the answer: listed, and no fault. */
  repeats: number[];
  /** What keeps the fact from being asked as the gate asks it, each with the message or text it is in; empty when nothing does. */
  faults: string[];
}

export interface ChatCheck {
  chat: ChatName;
  window: number;
  /** The oldest message the window holds, by index; null when no message is shown. */
  windowFrom: number | null;
  /** Faults of the messages as given, before any fact. */
  faults: string[];
  facts: FactCheck[];
  ok: boolean;
}

// Lumiverse leaves a message out of the prompt when `extra.hidden` is true (Lumiverse's `src/services/prompt-assembly.service.ts:3252`).
const hidden = (message: ChatMessage): boolean => message.extra?.hidden === true;

/** Whether a chat can be asked its facts as the gate asks them, fact by fact. */
export function checkChat(input: CheckInput): ChatCheck {
  if (!Number.isInteger(input.window) || input.window < 1) throw new RangeError(`a window holds a whole number of messages, at least 1; ${input.window} was given`);
  const messages = [...input.messages].sort((x, y) => x.index_in_chat - y.index_in_chat);
  const faults: string[] = [];
  const byIndex = new Map<number, ChatMessage>();
  for (const message of messages) {
    if (byIndex.has(message.index_in_chat)) faults.push(`two messages are at index ${message.index_in_chat}`);
    else byIndex.set(message.index_in_chat, message);
  }
  const shown = messages.filter((message) => !hidden(message));
  const windowFrom = shown.length === 0 ? null : shown[Math.max(0, shown.length - input.window)].index_in_chat;

  const facts = factsFor(input.chat).map((fact): FactCheck => {
    const pattern = wordPattern(fact.answer);
    const place = fact.place;
    const line = byIndex.get(place);
    const own: string[] = [];
    let planted = false;
    if (line === undefined) own.push(`no message is at index ${place}, where the line that plants it goes`);
    else if (!line.is_user) own.push(`the message at index ${place} is not the player's, so the line that plants it is not there`);
    // A line whose spacing a composer or Lumiverse changed still stands where it was planted.
    else if (!line.content.replace(/\s+/g, " ").includes(fact.line.replace(/\s+/g, " ").trim())) own.push(`the message at index ${place} does not hold the line that plants it`);
    else {
      planted = true;
      if (hidden(line)) own.push(`the line that plants it, at index ${place}, is hidden, so it was never in a prompt`);
    }
    const reply = byIndex.get(place + 1);
    const replyIndex = planted && reply !== undefined && !reply.is_user ? place + 1 : null;

    const plant: number[] = [];
    const repeats: number[] = [];
    for (const message of messages) {
      if (!pattern.test(message.content)) continue;
      const at = message.index_in_chat;
      const isPlant = planted && (at === place || at === replyIndex);
      if (isPlant) plant.push(at);
      if (at < place) own.push(`the answer is in message ${at}, before the line that plants it`);
      if (windowFrom !== null && !hidden(message) && at >= windowFrom) own.push(at === place && planted ? `the line that plants it, at index ${at}, is one of the latest ${input.window} messages, which the prompt holds` : `the answer is in message ${at}, one of the latest ${input.window} messages, which the prompt holds`);
      else if (at > place && !isPlant) repeats.push(at);
    }
    for (const source of input.sources) if (pattern.test(source.text)) own.push(`the answer is in ${source.name}`);
    return { fact, plant, repeats, faults: own };
  });

  return { chat: input.chat, window: input.window, windowFrom, faults, facts, ok: faults.length === 0 && facts.every((fact) => fact.faults.length === 0) };
}
