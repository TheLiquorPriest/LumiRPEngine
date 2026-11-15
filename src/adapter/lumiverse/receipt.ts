// A tagged chat reply's request, as RPE receives it (STANDALONE-PLAN §4.2, §10.1 step 4; READINGS
// R-103): the tag checked, its message list laid over the body by the joining Lumiverse's settings say it
// made, and the history window checked, or made here when the extension had no answer to cut by. What
// comes out is the prompt RPE passes on, with the window applied as far as the body can be told apart:
// no joining mode refuses a reply. A cut on receipt is the extension's, made on RPE's answer, or RPE's
// own: nothing is remembered from an earlier generation. Where the window is made here, it counts the
// chat's messages as Lumiverse's own rows have them, read as they stand when the request arrives, and
// only when the window is on. What the turn's record keeps of it (`Cut`): where the window starts, who
// left how much out, how Lumiverse joined the prompt, how many of the window's messages Lumiverse's own
// clipping left out, and a notice for each thing in the body that is not as the tag listed it.

import type { HistoryWindow, WindowStep } from "./answer";
import { joiningOf, overlay, partialCut, readBodyMessages, rebuild, type Joining, type LaidMessage, type Overlay } from "./overlay";
import type { LumiverseReads } from "./reads";
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

/** What the receipt reads of Lumiverse, through RPE's own reads, with no model call. */
export interface PromptReads {
  rows: ChatRows;
  /** How Lumiverse joins a prompt after its interceptors: the user's post-processing setting and the preset's collapse. */
  joining(preset: string | null, signal: AbortSignal): Promise<Joining>;
  /** The Summary tab's message limit (`summarization`), where it is on: how many of the newest messages Lumiverse keeps; null where it is off. */
  messageLimit(signal: AbortSignal): Promise<number | null>;
}

/** The receipt's reads made from RPE's reads of Lumiverse (`reads.ts`). */
export function promptReads(reads: LumiverseReads): PromptReads {
  return {
    rows: (chat, signal) => reads.path(chat, signal),
    async joining(preset) {
      const [post, row] = await Promise.all([reads.setting("promptPostProcessing"), preset === null ? null : reads.preset(preset)]);
      return joiningOf(post?.value, row?.prompts);
    },
    async messageLimit() {
      // `selectCortexHistoryMessages` (`services/memory-cortex/history-replacement.ts:19-29`): on only with a count above 0.
      const value = (await reads.setting("summarization"))?.value;
      if (value === null || typeof value !== "object" || Array.isArray(value) || value.messageLimitEnabled !== true) return null;
      const count = Number(value.messageLimitCount);
      return count > 0 ? Math.floor(count) : null;
    },
  };
}

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

/** Something in the body that is not as the tag listed it, told on the turn (R-103): the Prompt page and the briefing say it. */
export type PromptNotice =
  /** Listed messages not found in the body as Lumiverse's joining makes it: the prompt is not told apart, and slicing it is not supported. */
  | { kind: "unmatched"; missing: number }
  /** Pictures or other parts the interceptor saw that the body does not carry (a join drops them); nothing is put back. */
  | { kind: "pictures"; dropped: number }
  /** History before the window's start that stays in the prompt, because the body is not told apart where it stands. */
  | { kind: "uncut"; history: number }
  /** Lumiverse's joining settings could not be read; the joining was found from the body. */
  | { kind: "joining-unread"; why: string };

/** Lumiverse's own clipping inside RPE's window (§4.2): how many of the window's messages the prompt lacks, and which of Lumiverse's settings left them out where that can be told. */
export interface Clipped {
  count: number;
  /** Memory's summaries stand for them; the Summary tab's message limit keeps fewer than the window; else the preset's context size. Null with none left out. */
  by: "memory" | "message-limit" | "context-size" | null;
}

/** The window's cut and what the receipt found of the prompt, kept whole on the turn's record. */
export interface Cut {
  keep: KeepPoint | null;
  /** By the extension, on RPE's answer; null when it had no answer. */
  byExtension: number | null;
  /** Here, on receipt. */
  byRpe: number;
  /** How Lumiverse joined the prompt after its interceptors, and whether that was read from its settings or found from the body. */
  joining: Joining & { from: "settings" | "body" };
  /** Every listed message was found in the body: false lists the prompt as unsupported for slicing, and its layout carries each message whole. */
  told: boolean;
  /** Lumiverse's own clipping inside the window; null where the chat's rows could not be read to tell. */
  clipped: Clipped | null;
  notices: PromptNotice[];
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
 * How many of the window's messages the prompt lacks (§4.2: "If Lumiverse's own clipping is cutting inside RPE's window"): the
 * messages of the window's path from its first kept one that the prompt holds neither as a listed history message nor joined into the
 * player's message before it. Memory's summary stands for the messages up to the one it names (`__cortexHistorySummary`,
 * `prompt-assembly.service.ts:3286-3292`); the Summary tab's limit keeps only the newest of its count (`:2816-2820`); what neither
 * explains is the preset's context size, which clips the oldest history first (`:7297-7318`).
 */
async function clippedIn(tag: Tag, path: readonly WindowStep[], keep: KeepPoint | null, limit: () => Promise<number | null>): Promise<Clipped> {
  const listed = new Set(tag.messages.flatMap((m) => (m.history === true && m.source !== undefined ? [m.source.id] : [])));
  const summary = tag.messages.reduce<number | null>((at, m) => (m.summary === true && m.source !== undefined && (at === null || m.source.index > at) ? m.source.index : at), null);
  let count = 0;
  let summarized = 0;
  let inWindow = 0;
  let before: { held: boolean; user: boolean } | null = null;
  for (const step of path) {
    const held: boolean = listed.has(step.id) || (step.user === true && before !== null && before.user && before.held);
    before = { held, user: step.user === true };
    if (keep !== null && step.index < keep.index) continue;
    inWindow++;
    if (held) continue;
    count++;
    if (summary !== null && step.index <= summary) summarized++;
  }
  if (count === 0) return { count, by: null };
  if (summarized === count) return { count, by: "memory" };
  const kept = await limit();
  return { count, by: kept !== null && kept < inWindow ? "message-limit" : "context-size" };
}

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The tag checked against RPE's own user and laid over the body, and the window applied. Where the
 * extension cut on RPE's answer, the cut is checked and any history it left before the first kept
 * message is cut here. Where it had no answer, the window is asked here, over the chat's rows read now,
 * and the cut made here: by the tag's list over the body where every listed message is found; where some
 * are not, the body messages that are wholly history before the window's start are left out, the rest
 * goes as it came, and the turn's notices say what stays. A window that is on and a chat whose rows
 * cannot be read are refused rather than sent with more history than the window allows.
 */
export async function receive(tag: Tag, body: Record<string, unknown>, own: { user: string; window: HistoryWindow; reads: PromptReads }, signal: AbortSignal): Promise<Received> {
  if (tag.user !== own.user) throw new Refused(403, "This reply's chat belongs to another Lumiverse user than the one this RPE plays for.");
  const messages = readBodyMessages(body.messages);
  if (messages === null) throw new Refused(400, "The request's messages are not in the chat format RPE reads.");
  const notices: PromptNotice[] = [];
  let joining: Joining | null = null;
  try {
    joining = await own.reads.joining(tag.preset, signal);
  } catch (error) {
    notices.push({ kind: "joining-unread", why: words(error) });
  }
  const laid = overlay(tag.messages, messages, joining);
  // The chat's rows, read once at most: for the window made here, and to tell Lumiverse's own clipping inside it.
  let rowsRead: Promise<readonly ChatRow[] | null> | null = null;
  const rows = (): Promise<readonly ChatRow[] | null> => (rowsRead ??= own.reads.rows(tag.chat, signal));
  let keep: KeepPoint | null;
  if (tag.cut.answered) keep = tag.cut.keep;
  else {
    const generation = { id: tag.generation, type: LUMIVERSE_TYPE[tag.kind], target: tag.target, speaker: tag.speaker, model: null };
    const path = async (): Promise<WindowStep[]> => {
      const read = await rows();
      if (read === null) throw new Refused(404, "RPE found no chat of yours in Lumiverse by this reply's chat, so it could not count your history window, and sent nothing.");
      return windowPath(tag, read);
    };
    keep = await own.window({ user: tag.user, chat: tag.chat, generation, path }, signal);
  }
  const left = new Set(historyCut(tag.messages.map((m) => ({ history: m.history === true, index: m.source?.index ?? null })), keep));
  let sent: LaidMessage[] = laid.messages;
  let byRpe = left.size;
  if (left.size > 0 && laid.complete) sent = rebuild(laid, tag.messages, left);
  else if (left.size > 0) {
    const cut = partialCut(laid, left);
    sent = cut.messages;
    byRpe -= cut.stillSent;
    if (cut.stillSent > 0) notices.push({ kind: "uncut", history: cut.stillSent });
  }
  if (!laid.complete) notices.push({ kind: "unmatched", missing: laid.missing.length });
  else if (laid.pictures.sent < laid.pictures.listed) notices.push({ kind: "pictures", dropped: laid.pictures.listed - laid.pictures.sent });
  let clipped: Clipped | null = null;
  try {
    const read = await rows();
    if (read !== null) clipped = await clippedIn(tag, windowPath(tag, read), keep, () => own.reads.messageLimit(signal));
  } catch {
    // Only told: a chat whose rows cannot be read now has its clipping not known.
  }
  const cut: Cut = { keep, byExtension: tag.cut.answered ? tag.cut.removed : null, byRpe, joining: { ...laid.joining, from: joining === null ? "body" : "settings" }, told: laid.complete, clipped, notices };
  return { tag, overlay: laid, messages: sent, cut };
}
