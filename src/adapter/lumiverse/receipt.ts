// A tagged chat reply's request, as RPE receives it (STANDALONE-PLAN §4.2, §10.1 step 4): the tag
// checked, its message list laid over the body, and the history window checked, or made here when the
// extension had no answer to cut by. What comes out is the prompt RPE passes on: never more history
// than the window lets through. A cut on receipt is the extension's, made on RPE's answer, or RPE's
// own: nothing is remembered from an earlier generation. Where the window is made here, it counts the
// chat's messages as Lumiverse's own rows have them, read as they stand when the request arrives, and
// only when the window is on.

import type { HistoryWindow, WindowStep } from "./answer";
import { overlay, readBodyMessages, rebuild, type LaidMessage, type Overlay } from "./overlay";
import type { LvRole } from "./rows";
import { historyCut, type KeepPoint, type Tag } from "./wire";

/** One of a chat's messages as Lumiverse's rows hold it: its id, the number Lumiverse stored for it (`index_in_chat`), whether the user hid it, and whose it is. */
export interface ChatRow {
  id: string;
  index: number;
  hidden: boolean;
  role: LvRole;
}

/** A chat's rows as they stand, every message in Lumiverse's order; null when the chat is not the user's. */
export type ChatRows = (chat: string, signal: AbortSignal) => Promise<readonly ChatRow[] | null>;

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
  /** By the extension, on RPE's answer; null when it had no answer. */
  byExtension: number | null;
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
 * The chat's messages the window counts on receipt, oldest first, as Lumiverse's rows have them (§4.2; READINGS R-21, R-103, R-202):
 * each at the number Lumiverse stored for it, gaps after deletes and all, and with whose it is, since two of the player's messages next
 * to each other reach the prompt as one (`src/services/prompt-assembly.service.ts:6754-6843` in Lumiverse), which the window keeps whole.
 * The same messages the question's path holds: the chat's rows less the hidden ones (R-21) and the reply being written, which Lumiverse
 * leaves out of the prompt (a new reply's empty message, the message a swipe or a regenerate replaces). The count stops where the
 * prompt's history stops (R-202): after the newest message the prompt names, only the player's messages Lumiverse joined into it count
 * (an Edit-and-Send made in place sends the history up to the edited message alone, `prompt-assembly.service.ts:1859-1904`). A message
 * the prompt names that is no longer among the rows (deleted since the prompt was made) still counts, since the prompt holds it.
 */
function windowPath(tag: Tag, rows: readonly ChatRow[]): WindowStep[] {
  const writing = tag.kind === "new" || tag.kind === "swipe" || tag.kind === "regenerate" ? tag.target.message : null;
  const named = tag.messages.flatMap((m) => (m.source === undefined ? [] : [{ ...m.source, user: m.role === "user" }]));
  const newest = named.reduce<(typeof named)[number] | null>((at, m) => (at === null || m.index > at.index ? m : at), null);
  if (newest === null) return [];
  const steps: WindowStep[] = [];
  let joining = newest.user;
  for (const r of rows) {
    if (r.hidden || r.id === writing) continue;
    const user = r.role === "user";
    if (r.index > newest.index) {
      if (!joining || !user) {
        joining = false;
        continue;
      }
    }
    steps.push({ id: r.id, index: r.index, user });
  }
  const held = new Set(steps.map((s) => s.id));
  for (const m of named) if (!held.has(m.id)) steps.push({ id: m.id, index: m.index, user: m.user });
  return steps.sort((a, b) => a.index - b.index);
}

/**
 * The tag checked against RPE's own user and laid over the body, and the window applied. Where the
 * extension cut on RPE's answer, the cut is checked and any history it left before the first kept
 * message is cut here. Where it had no answer, the window is asked here, over the chat's rows read now
 * (`rows`), and the cut made here. A cut made here needs every part of the body told apart; where they
 * can't be, the request is refused rather than sent with more history than the window allows, as it is
 * where the chat's rows cannot be read and the window is on.
 */
export async function receive(tag: Tag, body: Record<string, unknown>, own: { user: string; window: HistoryWindow; rows: ChatRows }, signal: AbortSignal): Promise<Received> {
  if (tag.user !== own.user) throw new Refused(403, "This reply's chat belongs to another Lumiverse user than the one this RPE plays for.");
  const messages = readBodyMessages(body.messages);
  if (messages === null) throw new Refused(400, "The request's messages are not in the chat format RPE reads.");
  const laid = overlay(tag.messages, messages);
  let keep: KeepPoint | null;
  if (tag.cut.answered) keep = tag.cut.keep;
  else {
    const generation = { id: tag.generation, type: LUMIVERSE_TYPE[tag.kind], target: tag.target, speaker: tag.speaker, model: null };
    const path = async (): Promise<WindowStep[]> => {
      const rows = await own.rows(tag.chat, signal);
      if (rows === null) throw new Refused(404, "RPE found no chat of yours in Lumiverse by this reply's chat, so it could not count your history window, and sent nothing.");
      return windowPath(tag, rows);
    };
    keep = await own.window({ user: tag.user, chat: tag.chat, generation, path }, signal);
  }
  const left = historyCut(tag.messages.map((m) => ({ history: m.history === true, index: m.source?.index ?? null })), keep);
  const cut: Cut = { keep, byExtension: tag.cut.answered ? tag.cut.removed : null, byRpe: left.length };
  if (left.length === 0) return { tag, overlay: laid, messages: laid.messages, cut };
  if (!laid.complete) throw new Refused(422, "RPE could not tell this prompt's parts apart, so it could not leave out the history beyond your window. Send the message again; if this keeps happening, turn off Lumiverse's prompt post-processing or Collapse for this chat.");
  return { tag, overlay: laid, messages: rebuild(laid, tag.messages, new Set(left)), cut };
}
