// What a tagged reply's request carries, as RPH takes it (Appendix A `TurnRequest`): the assembled
// prompt in order with its pictures, the preset's prefill, its sampling and its longest reply, and the
// stretch of history the window left out. All of it is the request's own; nothing is judged here.

import type { HistoryRange, PromptMessage, PromptPart, Sampling } from "rp-harness/contract";
import type { LvStep } from "../adapter/lumiverse/reads";
import type { Tag } from "../adapter/lumiverse/wire";
import type { TaggedTurn } from "../adapter/lumiverse/provider";
import { isRecord } from "../shared/json";
import type { NotGiven } from "./runs";

/** A picture as an OpenAI-compatible request carries it: a data address with its type, or a web address. */
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;
const WEB_URL = /^https?:\/\//i;

/** What of a prompt's messages an agent's model is not given, by kind (`NotGiven`). */
type LeftKind = "pictures" | "parts";

/**
 * The prompt as an agent's model takes it (plan §4.2 "A prompt with pictures", §10.2 block 2): every message in its place with its
 * role as Lumiverse sent it, its text, or its parts in order, a picture by its data or by its web address kept as a picture in any
 * message where the model takes pictures (`pictures`: whether it is known to). What is not kept is given back as facts for the briefing
 * to tell, with the messages that held it (places from 0): pictures the model does not take, and parts that are neither text nor a
 * picture (audio). The one means the Author's prompt and a narrator's use.
 */
export function promptOf(prompt: TaggedTurn["prompt"], pictures: boolean): { messages: PromptMessage[]; left: NotGiven[] } {
  const held: Record<LeftKind, { messages: number[]; count: number }> = { pictures: { messages: [], count: 0 }, parts: { messages: [], count: 0 } };
  const leave = (what: LeftKind, message: number): void => {
    const kind = held[what];
    if (kind.messages.at(-1) !== message) kind.messages.push(message);
    kind.count++;
  };
  const messages = prompt.map((m, message): PromptMessage => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    const parts: PromptPart[] = [];
    for (const part of m.content) {
      if (!isRecord(part)) continue;
      if (part.type === "text" && typeof part.text === "string") parts.push({ type: "text", text: part.text });
      else if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
        const { url } = part.image_url;
        const data = DATA_URL.exec(url);
        const picture: PromptPart | null = data !== null && data[1] !== undefined && data[2] !== undefined ? { type: "image", mimeType: data[1], data: data[2] } : WEB_URL.test(url) ? { type: "image", url } : null;
        if (picture === null) leave("parts", message);
        else if (!pictures) leave("pictures", message);
        else parts.push(picture);
      } else leave("parts", message);
    }
    return { role: m.role, content: parts };
  });
  const left = (["pictures", "parts"] as const).flatMap((what): NotGiven[] => (held[what].count === 0 ? [] : [{ what, ...held[what] }]));
  return { messages, left };
}

/** The text of a prompt message: its text parts run together. */
export function textOf(message: PromptMessage): string {
  return typeof message.content === "string" ? message.content : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** The preset's prefill: the last message, when the interceptor saw it as a partial reply the answer continues. */
export function prefillOf(turn: TaggedTurn, messages: readonly PromptMessage[]): string | undefined {
  const last = messages.at(-1);
  return turn.tag.messages.at(-1)?.partial === true && last?.role === "assistant" ? textOf(last) : undefined;
}

const SAMPLING_NUMBERS = ["temperature", "top_p", "top_k", "min_p", "frequency_penalty", "presence_penalty", "repetition_penalty", "seed"] as const;

/** The preset's sampling, as the request's own fields carry it; undefined when it carries none. */
export function samplingOf(parameters: TaggedTurn["parameters"]): Sampling | undefined {
  const out: Sampling = {};
  for (const name of SAMPLING_NUMBERS) {
    const value = parameters[name];
    if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
  }
  const stop = parameters.stop;
  if (typeof stop === "string") out.stop = [stop];
  else if (Array.isArray(stop) && stop.every((s) => typeof s === "string")) out.stop = stop as string[];
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The preset's longest reply, in tokens, where the request names one. */
export function maxTokensOf(parameters: TaggedTurn["parameters"]): number | undefined {
  const value = parameters.max_tokens ?? parameters.max_completion_tokens;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The history the window left out of the prompt, by place on the chat's path (`path`, every message's
 * id in order): everything before the first message kept, as stretches each wholly covered by the
 * story record or wholly not (`covered`, the ids the record covers along the turn's own line), in
 * order. None when the window kept it all, or when the kept message is not on the path.
 */
export function leftOutOf(keep: { id: string } | null, path: readonly string[], covered: ReadonlySet<string>): HistoryRange[] {
  const at = keep === null ? -1 : path.indexOf(keep.id);
  const out: HistoryRange[] = [];
  for (let i = 0; i < at; i++) {
    const isCovered = covered.has(path[i] ?? "");
    const last = out.at(-1);
    if (last !== undefined && last.covered === isCovered) last.to = i + 1;
    else out.push({ from: i, to: i + 1, covered: isCovered });
  }
  return out;
}

/**
 * The messages Lumiverse's memory stands in for with a summary in this prompt. A history message the
 * tag marks as a summary stands in place of a run of visible messages ending at its source: those after
 * the history message before it, up to and including its source (Lumiverse's
 * `memory-cortex/history-replacement.ts:99-131`).
 */
export function summarizedOf(tag: Tag, steps: readonly LvStep[]): string[] {
  const place = new Map(steps.map((s, i) => [s.id, i]));
  const out: string[] = [];
  let after = -1;
  for (const m of tag.messages) {
    if (m.history !== true || m.source === undefined) continue;
    const at = place.get(m.source.id);
    if (at === undefined) continue;
    if (m.summary === true) {
      for (let i = after + 1; i <= at; i++) {
        const step = steps[i];
        if (step !== undefined && !step.hidden) out.push(step.id);
      }
    }
    after = at;
  }
  return out;
}
