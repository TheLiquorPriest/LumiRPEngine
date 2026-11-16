// The feedback he typed in Lumiverse's own regenerate dialog, told apart from the prompt where that can be done without guessing (STANDALONE-PLAN §10.10; READINGS R-198).
// Lumiverse puts it in the request's own fields and then into the prompt: as a system message at the end of it, or appended after a line break to his last chat history
// message, by the player's `regenFeedback` setting (`services/prompt-assembly.service.ts:3920-3985`). Nothing marks it in the prompt the interceptor hands on, and the template of its
// words is his. So it is never found by the template: the setting says which case applies, and the feedback is what this attempt's prompt added to the prompt of the attempt it
// replaces, found only where that earlier prompt is RPE's own (kept on its turn's record) and the two are otherwise equal. Where that cannot be done, nothing is separated and the turn
// says so and where the feedback stands, if he typed any: the Author is given the whole prompt either way. Lumiverse names the system case "Regen Feedback" in the breakdown it stores
// with the saved reply (`GENERATION_BREAKDOWN_READY`, `events.ts`), which confirms or corrects what was found, or completes it.

import type { RawLayout, RawPart } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { LaidMessage } from "./overlay";
import type { LumiverseReads } from "./reads";
import { textHash, type Tag } from "./wire";

/** Where Lumiverse puts the feedback: a system message at the end of the prompt, or the end of his last chat history message. */
export type FeedbackPosition = "system" | "user";

/** Why feedback, if he typed any, was not separated. */
export type NotSeparated =
  /** The player's `regenFeedback` setting could not be read, so which case applies is not known: nothing is separated and where it stands is not said. */
  | "setting-unreadable"
  /** RPE has no prompt of its own for the attempt this one replaces to compare with. */
  | "no-earlier-prompt"
  /** The two prompts are not otherwise equal, so what this one added cannot be told from what else changed. */
  | "prompts-differ";

/** What a regeneration's prompt held of the feedback typed in Lumiverse's dialog. */
export type Feedback =
  /** The setting is off, or the two prompts are equal: he typed none. */
  | { found: "none" }
  /** The feedback as Lumiverse put it in the prompt (`text`, its words as the player's format made them), and where. */
  | { found: "separated"; position: FeedbackPosition; text: string }
  /** Not told apart. `position`: where Lumiverse puts it by the setting, so where it stands if he typed any; null where the setting could not be read. */
  | { found: "unseparated"; position: FeedbackPosition | null; why: NotSeparated };

/** The prompt RPE passed on for the attempt a regenerate or a swipe replaces, as its turn's record keeps it. */
export interface EarlierPrompt {
  prompt: readonly { role: string; content: string | unknown[] }[];
  layout: RawLayout;
}

/** The feedback of one reply: null for a reply that is not a regeneration, which has none. */
export type FeedbackFor = (tag: Tag, messages: readonly LaidMessage[]) => Promise<Feedback | null>;

/** The player's `regenFeedback` setting: whether it is on and where it puts the feedback (the frontend's defaults: off, `user`); null where the row is not one RPE reads. */
export async function readRegenFeedback(reads: Pick<LumiverseReads, "setting">): Promise<{ on: boolean; position: FeedbackPosition } | null> {
  let row;
  try {
    row = await reads.setting("regenFeedback");
  } catch {
    return null;
  }
  if (row === null) return { on: false, position: "user" };
  const value = row.value;
  if (!isRecord(value)) return null;
  return { on: value.enabled === true, position: value.position === "system" ? "system" : "user" };
}

/** A message's text as the model reads it: its text parts run together. */
function textOf(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (isRecord(p) && p.type === "text" && typeof p.text === "string" ? p.text : "")).join("");
}

/** The player's last chat history message among the listed ones: its place in the list and its id. */
function lastUserLine(tag: Tag): { member: number; id: string } | null {
  for (let i = tag.messages.length - 1; i >= 0; i--) {
    const m = tag.messages[i]!;
    if (m.history === true && m.role === "user" && m.source !== undefined) return { member: i, id: m.source.id };
  }
  return null;
}

/** A stretch of one message's text. */
interface Stretch {
  message: number;
  start: number;
  end: number;
}

/** Where the listed message stands in this prompt. */
function stretchHere(messages: readonly LaidMessage[], member: number): Stretch | null {
  for (const [message, m] of messages.entries()) {
    const place = m.places.find((p) => p.member === member);
    if (place !== undefined) return { message, start: place.start, end: place.end };
  }
  return null;
}

/** Where the chat message `id` stands in the earlier prompt, by its layout's history part of it. */
function stretchThen(earlier: EarlierPrompt, id: string): Stretch | null {
  for (const [message, m] of earlier.layout.messages.entries()) {
    const part = m.parts.find((p) => p.kind === "history" && p.source?.id === id);
    if (part !== undefined) return { message, start: part.start, end: part.end };
  }
  return null;
}

/**
 * What this prompt added to the earlier one at `position`, or null where the two are not otherwise equal. Position `system`: one more message, the last, a system
 * one, every message before it as in the earlier prompt. Position `user`: the player's last line (by its id) is the earlier prompt's line and a line break and more,
 * everything else of the prompt as it was. Both equal (the dialog was skipped): empty text.
 */
function addedTo(position: FeedbackPosition, tag: Tag, messages: readonly LaidMessage[], earlier: EarlierPrompt): string | null {
  const before = earlier.prompt.map((m) => ({ role: m.role, text: textOf(m.content) }));
  const now = messages.map((m) => ({ role: m.role, text: m.text }));
  const same = (i: number): boolean => now[i]!.role === before[i]!.role && now[i]!.text === before[i]!.text;
  if (position === "system") {
    const kept = now.length === before.length ? now.length : now.length - 1;
    if (now.length !== before.length && now.length !== before.length + 1) return null;
    for (let i = 0; i < kept; i++) if (!same(i)) return null;
    if (now.length === before.length) return "";
    const last = now[kept]!;
    return last.role === "system" ? last.text : null;
  }
  const line = lastUserLine(tag);
  if (line === null || now.length !== before.length) return null;
  const here = stretchHere(messages, line.member);
  const then = stretchThen(earlier, line.id);
  if (here === null || then === null || here.message !== then.message) return null;
  for (let i = 0; i < now.length; i++) if (i !== here.message && !same(i)) return null;
  const mine = now[here.message]!;
  const was = before[here.message]!;
  // The message holds his line and nothing else changed in it: what stands before and after the line is as it was.
  if (mine.role !== was.role || mine.text.slice(0, here.start) !== was.text.slice(0, then.start) || mine.text.slice(here.end) !== was.text.slice(then.end)) return null;
  const own = mine.text.slice(here.start, here.end);
  const old = was.text.slice(then.start, then.end);
  if (own === old) return "";
  return own.startsWith(`${old}\n`) ? own.slice(old.length + 1) : null;
}

export interface FeedbackDeps {
  reads: Pick<LumiverseReads, "setting">;
  /** The turn lane: the prompt of the attempt this reply replaces, where it is RPE's own and kept; null where there is none. */
  replaced(tag: Tag): Promise<EarlierPrompt | null>;
}

export function createFeedback(deps: FeedbackDeps): FeedbackFor {
  return async (tag, messages) => {
    if (tag.kind !== "regenerate" && tag.kind !== "swipe") return null;
    const setting = await readRegenFeedback(deps.reads);
    if (setting === null) return { found: "unseparated", position: null, why: "setting-unreadable" };
    if (!setting.on) return { found: "none" };
    const earlier = await deps.replaced(tag).catch(() => null);
    if (earlier === null) return { found: "unseparated", position: setting.position, why: "no-earlier-prompt" };
    const added = addedTo(setting.position, tag, messages, earlier);
    if (added === null) return { found: "unseparated", position: setting.position, why: "prompts-differ" };
    return added === "" ? { found: "none" } : { found: "separated", position: setting.position, text: added };
  };
}

/**
 * A message's parts with the feedback apart from the player's last line, where it was appended to it after a line break (`position: user`): the line keeps its own text's hash,
 * so the prompt's map never takes it for an edited message, and the feedback is a part of its own after the break Lumiverse put there. Parts of any other message are as they were.
 */
export function apartFromLine(parts: readonly RawPart[], text: string, tag: Tag, feedback: string): RawPart[] {
  const line = lastUserLine(tag);
  const at = line === null ? -1 : parts.findIndex((p) => p.kind === "history" && p.source?.id === line.id);
  const part = parts[at];
  if (part === undefined || !text.slice(part.start, part.end).endsWith(`\n${feedback}`)) return [...parts];
  const own = part.end - feedback.length - 1;
  const { source: _source, summarized: _summarized, ...rest } = part;
  return [
    ...parts.slice(0, at),
    { ...part, end: own, hash: textHash(text.slice(part.start, own)) },
    { ...rest, start: own + 1, kind: "other", hash: textHash(feedback), blocks: [] },
    ...parts.slice(at + 1),
  ];
}
