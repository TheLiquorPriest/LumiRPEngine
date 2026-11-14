// A tagged chat reply's request, as RPE receives it (STANDALONE-PLAN §4.2, §10.1 step 4): the tag
// checked, its message list laid over the body, and the history window checked, or made here when the
// extension had no answer to cut by. What comes out is the prompt RPE passes on: never more history
// than the window lets through.

import type { HistoryWindow } from "./answer";
import { overlay, readBodyMessages, rebuild, type LaidMessage, type Overlay } from "./overlay";
import { historyCut, type KeepPoint, type PathStep, type Tag } from "./wire";

/** Why a tagged request is not played; the words reach the user as the reply's error. */
export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "Refused";
  }
}

/** The window's cut: where the kept history starts, and who left how many history messages out. */
export interface Cut {
  keep: KeepPoint | null;
  /** By the extension: on RPE's answer, or where RPE last said to cut this chat (`remembered`); null when it cut nothing. */
  byExtension: number | null;
  /** The extension had no answer and cut where RPE last said to: RPE worked the window out again here. */
  remembered: boolean;
  /** Here, on receipt. */
  byRpe: number;
}

export interface Received {
  tag: Tag;
  overlay: Overlay;
  /** The prompt RPE passes on, in order: the body's messages after the window's cut. */
  messages: LaidMessage[];
  cut: Cut;
}

/** Lumiverse's own name for a reply kind, for the window asked on receipt. */
const LUMIVERSE_TYPE: Record<Tag["kind"], string> = { new: "normal", swipe: "swipe", regenerate: "regenerate", continue: "continue", impersonate: "impersonate" };

/**
 * The tag checked against RPE's own user and laid over the body, and the window applied. Where the
 * extension cut on RPE's answer, the cut is checked and any history it left before the first kept
 * message is cut here. Where it had no answer, the window is asked here, from the prompt's history, and
 * the cut made here; what the extension already cut where RPE last said to cannot be put back. A cut
 * made here needs every part of the body told apart; where they can't be, the request is refused
 * rather than sent with more history than the window allows.
 */
export async function receive(tag: Tag, body: Record<string, unknown>, own: { user: string; window: HistoryWindow }, signal: AbortSignal): Promise<Received> {
  if (tag.user !== own.user) throw new Refused(403, "This reply's chat belongs to another Lumiverse user than the one this RPE plays for.");
  const messages = readBodyMessages(body.messages);
  if (messages === null) throw new Refused(400, "The request's messages are not in the chat format RPE reads.");
  const laid = overlay(tag.messages, messages);
  let keep: KeepPoint | null;
  if (tag.cut.answered) keep = tag.cut.keep;
  else {
    const path: PathStep[] = tag.messages.flatMap((m) => (m.history && m.source ? [{ id: m.source.id, index: m.source.index, swipe: null }] : []));
    const generation = { id: tag.generation, type: LUMIVERSE_TYPE[tag.kind], target: tag.target, speaker: tag.speaker, model: null };
    keep = await own.window({ user: tag.user, chat: tag.chat, generation, path }, signal);
  }
  const left = historyCut(tag.messages.map((m) => ({ history: m.history === true, index: m.source?.index ?? null })), keep);
  const remembered = !tag.cut.answered && tag.cut.remembered !== null;
  const cut: Cut = { keep, byExtension: tag.cut.answered || remembered ? tag.cut.removed : null, remembered, byRpe: left.length };
  if (left.length === 0) return { tag, overlay: laid, messages: laid.messages, cut };
  if (!laid.complete) throw new Refused(422, "RPE could not tell this prompt's parts apart, so it could not leave out the history beyond your window. Send the message again; if this keeps happening, turn off Lumiverse's prompt post-processing or Collapse for this chat.");
  return { tag, overlay: laid, messages: rebuild(laid, tag.messages, new Set(left)), cut };
}
