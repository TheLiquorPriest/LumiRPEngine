// The stand-in Lumiverse's prompt (`lumiverse.ts` calls it for each generation), assembled in Lumiverse's
// order: the preset's blocks, with the chat's visible history at its history marker and queued sends joined
// in it, lore at the preset's World Info markers or just before and after the history, the pool of "at
// marker" lore inside the block that asks for it, and in-history blocks spliced in; then the prompt's end
// as Lumiverse makes it, the preset's completion settings over it all; and the breakdown Lumiverse keeps of
// it. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; paths are
// Lumiverse's `src/`. It resolves no macro but `{{wi_marker}}`, and a secret mark in lore.

import type { Entry } from "./lore";
import { indexInChat, type ChatMessage } from "./rows";
import { stripClosingTags, textOf, type LlmMessage, type LlmPart, type Role } from "./steps";

export interface Block {
  id: string;
  name: string;
  role: Role;
  content: string;
  /** Spliced into the chat history this many messages from its end, not as history: a block placed "in history". */
  depth?: number;
  /**
   * The marker it is, where it is one (`PromptBlock.marker`), its content not sent: `chat_history` places the chat's history,
   * `world_info_before` and `world_info_after` the lore of their position (`services/prompt-assembly.service.ts:3161`, `:3491-3561`).
   * A stand-in preset that marks no block `chat_history` has its history after its last block.
   */
  marker?: "chat_history" | "world_info_before" | "world_info_after";
}

/** A preset, with the parts of its `prompts` the stand-in reads. */
export interface Preset {
  id: string;
  name: string;
  blocks: Block[];
  /** "Collapse into single user message". */
  collapse?: boolean;
  /** The reply's start the preset gives (`prompts.completionSettings.assistantPrefill`). */
  assistantPrefill?: string;
  /** An impersonation's start, in place of `assistantPrefill` where set (`completionSettings.assistantImpersonation`). */
  assistantImpersonation?: string;
  /** "Continue prefill": a continue's message and an impersonation's prompt end the prompt as a reply to go on with (`completionSettings.continuePrefill`). */
  continuePrefill?: boolean;
  parameters?: Record<string, unknown>;
  /**
   * Put after a continued message's text, in the prompt and when the continue is saved (`prompts.completionSettings.continuePostfix`);
   * absent, none (`services/generate.service.ts:1975-1977`). Lumiverse's default preset says one space itself (`auth/default-preset.ts:316`).
   */
  continuePostfix?: string;
  /** The line that asks the model to go on with a continued message (`prompts.promptBehavior.continueNudge`): absent, Lumiverse's own; empty, none. */
  continueNudge?: string;
  /** "Squash system messages": a system message joins the system message before it (`completionSettings.squashSystemMessages`). */
  squashSystemMessages?: boolean;
  /** "Use system prompt": off, every system message is sent as the user's (`completionSettings.useSystemPrompt`); absent, on. */
  useSystemPrompt?: boolean;
  /** Names (`completionSettings.namesBehavior`): 0 none, 1 the speaker's name beside each user and assistant message, 2 written at the start of its text. */
  namesBehavior?: 0 | 1 | 2;
}

/** Lumiverse's own continue nudge, for a preset that sets none (`services/prompt-behavior.ts:10`). */
export const CONTINUE_NUDGE = "[Continue your last message without repeating its original content.]";

export type GenerationType = "normal" | "swipe" | "regenerate" | "continue" | "impersonate";

/** What the assembly is told of the generation whose prompt it ends. */
export interface Ending {
  type: GenerationType;
  /** The user's "Start Reply With": the connection's own where it binds one, an empty one included, else the user's setting (`services/prompt-assembly.service.ts:4130-4137`). */
  promptBias: string;
  /** A continue's message, where Lumiverse found one (`continueMessageId`), and the postfix resolved for it (`continuePostfix`). */
  continueMessageId?: string;
  continuePostfix?: string;
  /**
   * The names `namesBehavior` writes (`services/prompt-assembly.service.ts:7186-7208`): the persona's for the user's messages, else
   * "User", and the character's for the assistant's.
   */
  names: { user: string; character: string };
}

/** One entry of the assembly's breakdown (`AssemblyBreakdownEntry`). */
export interface BreakdownEntry {
  type: string;
  name: string;
  role?: string;
  content?: string;
  blockId?: string;
  messageCount?: number;
  firstMessageIndex?: number;
  marker?: string;
  /** Its tokens are already counted in the block that holds its text (`:3846`). */
  excludeFromTotal?: boolean;
}

export interface Assembled {
  prompt: LlmMessage[];
  breakdown: BreakdownEntry[];
}

/** `appendTextToMessage` (`services/prompt-assembly.service.ts:720-735`): the text after the last text part, or as a part of its own. */
function withText(message: LlmMessage, text: string): LlmMessage {
  if (text === "") return message;
  if (typeof message.content === "string") return { ...message, content: message.content + text };
  const parts = [...message.content];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.type !== "text") continue;
    parts[i] = { ...part, text: part.text + text };
    return { ...message, content: parts };
  }
  return { ...message, content: [...parts, { type: "text", text }] };
}

/**
 * `mergeConsecutiveUserMessages` (`services/prompt-assembly.service.ts:6754-6843`), in place over the `count` messages from
 * `start`: two user messages in a row (sends queued while a reply was written) become one, their texts joined by a blank line
 * and their pictures after the text, history if either was, with the first source either names (its id and its number). The
 * second message's id never reaches an interceptor. Gives how many messages the stretch holds now. (The stand-in makes none
 * of Lumiverse's memory summaries, which this leaves alone.)
 */
export function mergeQueuedUserMessages(result: LlmMessage[], start: number, count: number): number {
  let remaining = count;
  let i = start;
  while (i < start + remaining - 1) {
    const a = result[i]!;
    const b = result[i + 1]!;
    if (a.role !== "user" || b.role !== "user") {
      i++;
      continue;
    }
    const text = `${textOf(a)}\n\n${textOf(b)}`;
    const media = [a, b].flatMap((m) => (typeof m.content === "string" ? [] : m.content.filter((p) => p.type !== "text")));
    const merged: LlmMessage = { role: "user", content: media.length > 0 ? [{ type: "text", text }, ...media] : text };
    if (a.__chatHistorySource === true || b.__chatHistorySource === true) {
      merged.__chatHistorySource = true;
      if (a.__contextAnchorProtected === true || b.__contextAnchorProtected === true) merged.__contextAnchorProtected = true;
      const source = [a, b].find((m) => typeof m.__sourceMessageId === "string" && typeof m.__sourceIndexInChat === "number");
      if (source !== undefined) {
        merged.__sourceMessageId = source.__sourceMessageId;
        merged.__sourceIndexInChat = source.__sourceIndexInChat;
      }
    }
    if (a.__worldInfoSource === true || b.__worldInfoSource === true) merged.__worldInfoSource = true;
    result[i] = merged;
    result.splice(i + 1, 1);
    remaining--;
  }
  return remaining;
}

/**
 * `applyCompletionSettings` (`services/prompt-assembly.service.ts:7129-7231`), in place, in one pass: with "Squash system
 * messages" a system message joins the message before it when that one began as a system message, after a blank line, its other
 * marks gone with it (a continue's nudge never joins); with "Use system prompt" off a system message goes as the user's; names 1
 * set each user and assistant message's `name`, and names 2 write it at the start of its first text. A message that began as a
 * system message keeps the mark Lumiverse gives it (`_fromSystem`), which the interceptors are handed with the rest.
 */
export function applyCompletionSettings(result: LlmMessage[], preset: Pick<Preset, "squashSystemMessages" | "useSystemPrompt" | "namesBehavior">, names: Ending["names"]): void {
  const namesBehavior = preset.namesBehavior ?? 0;
  let write = 0;
  for (let read = 0; read < result.length; read++) {
    let msg = result[read]!;
    const isSystem = msg.role === "system";
    const prev = write > 0 ? result[write - 1]! : undefined;
    if (preset.squashSystemMessages === true && isSystem && msg.__continueNudge !== true && prev?._fromSystem === true) {
      // The text before takes the joining message's text only where that is one text (`:7166-7172`).
      const before = typeof prev.content === "string" ? prev.content : (prev.content.find((p) => p.type === "text")?.text ?? "");
      result[write - 1] = { ...prev, content: `${before}\n\n${typeof msg.content === "string" ? msg.content : ""}` };
      continue;
    }
    if (preset.useSystemPrompt === false && isSystem) msg = { ...msg, role: "user" };
    if (isSystem) msg._fromSystem = true;
    if (namesBehavior !== 0 && (msg.role === "user" || msg.role === "assistant")) {
      const name = msg.role === "user" ? names.user : names.character;
      if (namesBehavior === 1) msg = { ...msg, name };
      else if (typeof msg.content === "string") msg = { ...msg, content: `${name}: ${msg.content}` };
      else {
        const parts = [...msg.content];
        const at = parts.findIndex((p) => p.type === "text");
        const part = parts[at];
        if (part?.type === "text") parts[at] = { type: "text", text: `${name}: ${part.text}` };
        msg = { ...msg, content: parts };
      }
    }
    result[write] = msg;
    write++;
  }
  result.length = write;
}

/** One activated entry as the assembly places it: its text after the macro pass, its role, and the label it is named by. */
interface PlacedLore {
  content: string;
  role: Role;
  label: string;
}

/** A block, or a marker's lore, waiting to be spliced into the history (`pendingDepthBlocks`, `:3054-3064`). */
interface InHistory {
  role: Role;
  depth: number;
  content: string;
  name: string;
  blockId: string;
  worldInfo: boolean;
}

/** `{{wi_marker}}` and its alias (`macros/definitions/primitives.ts:159-171`). */
const WI_MARKER = /\{\{\s*(?:wi_marker|wiMarker)\s*\}\}/g;

/**
 * The activated entries by where they go (`bucketByPosition`, `services/world-info-activation.service.ts:952-1022`), each named by
 * its label (`getWorldInfoEntryLabel`, `:1036-1047`), then each text through the macro pass (`services/prompt-assembly.service.ts:2994-3025`),
 * which strips a lone secret mark (the stand-in's `stripClosingTags`), an entry left with no text dropped (`:3026`). The scan that
 * activated them read their raw text (`services/world-info-activation.service.ts:753-758`), so stripping a mark here changes no
 * entry's activation.
 */
function placedLore(active: readonly Entry[]): { before: PlacedLore[]; after: PlacedLore[]; atMarker: PlacedLore[] } {
  const placed = { before: [] as PlacedLore[], after: [] as PlacedLore[], atMarker: [] as PlacedLore[] };
  for (const e of active) {
    const content = stripClosingTags(e.content);
    if (content.trim() === "") continue;
    const keys = (e.keys ?? []).map((k) => k.trim()).filter((k) => k !== "");
    const label = e.comment?.trim() || (keys.length > 0 ? keys.join(", ") : `(unnamed entry ${e.id.slice(0, 8)})`);
    const lore = { content, role: e.role ?? "system", label };
    if (e.position === 1) placed.after.push(lore);
    else if (e.position === 7) placed.atMarker.push(lore);
    else placed.before.push(lore);
  }
  return placed;
}

/**
 * `insertBlocksIntoTaggedHistory` (`services/prompt-assembly.service.ts:378-402`), in place: every block's place found first, by
 * counting back `depth` history messages (`resolveChatHistoryInsertionIndex`, `:357-376`), then each spliced in from the last
 * place back, the later block first where two share a place, so they keep the preset's order; a marker's lore keeps its flag.
 */
function insertIntoHistory(messages: LlmMessage[], blocks: readonly InHistory[]): void {
  const history = messages.flatMap((m, i) => (m.__chatHistorySource === true ? [i] : []));
  const placeOf = (depth: number): number => {
    if (history.length === 0) return messages.length;
    const from = Math.max(0, history.length - Math.max(0, depth));
    return from >= history.length ? history.at(-1)! + 1 : history[from]!;
  };
  const placements = blocks.map((block, order) => ({ block, order, at: placeOf(block.depth) }));
  placements.sort((a, b) => b.at - a.at || b.order - a.order);
  for (const { block, at } of placements) messages.splice(at, 0, { role: block.role, content: block.content, ...(block.worldInfo ? { __worldInfoSource: true } : {}) });
}

/** The prompt for these messages, each history message carrying the number Lumiverse stored for it (`:229-231`, `:3361`, `:3398`). */
export function assemble(preset: Preset, active: readonly Entry[], messages: readonly ChatMessage[], ending: Ending): Assembled {
  const breakdown: BreakdownEntry[] = [];
  const prompt: LlmMessage[] = [];
  const lore = placedLore(active);
  const pending: InHistory[] = [];
  let firstChatIdx = -1;
  let chatHistoryCount = 0;
  let hasWiBefore = false;
  let hasWiAfter = false;
  const blocks = preset.blocks.some((b) => b.marker === "chat_history") ? preset.blocks : [...preset.blocks, { id: "", name: "Chat History", role: "system" as const, content: "", marker: "chat_history" as const }];
  // The assembly loop (`services/prompt-assembly.service.ts:3110-3664`), block by block in the preset's order.
  for (const block of blocks) {
    // A second World Info marker of one kind is skipped (`:3147-3148`).
    if ((block.marker === "world_info_before" && hasWiBefore) || (block.marker === "world_info_after" && hasWiAfter)) continue;
    if (block.marker === "chat_history") {
      // The chat's history (`:3236-3463`): its visible messages, each flagged with its id and number, then queued sends joined before
      // anything is spliced into it. Its breakdown entry is pushed with the count before the join, and read again at the end.
      firstChatIdx = prompt.length;
      let count = 0;
      for (const m of messages) {
        if (m.hidden) continue;
        const content: string | LlmPart[] = m.images ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image" as const, ...i }))] : m.content;
        prompt.push({ role: m.role, content, __chatHistorySource: true, __sourceMessageId: m.id, __sourceIndexInChat: indexInChat(m) });
        count++;
      }
      breakdown.push({ type: "chat_history", name: "Chat History", messageCount: count, firstMessageIndex: firstChatIdx });
      chatHistoryCount = mergeQueuedUserMessages(prompt, firstChatIdx, count);
      continue;
    }
    if (block.marker === "world_info_before" || block.marker === "world_info_after") {
      // A World Info marker (`:3491-3561`): its position's lore here, each entry a flagged message in the marker's role, or spliced
      // into the history where the marker is placed there; named by the position and its label, with no block id.
      const before = block.marker === "world_info_before";
      if (before) hasWiBefore = true;
      else hasWiAfter = true;
      for (const entry of before ? lore.before : lore.after) {
        const name = `${before ? "World Info Before" : "World Info After"}: ${entry.label}`;
        if (block.depth !== undefined) pending.push({ role: block.role, depth: Math.max(0, block.depth), content: entry.content, name, blockId: block.id, worldInfo: true });
        else {
          prompt.push({ role: block.role, content: entry.content, __worldInfoSource: true });
          breakdown.push({ type: "world_info", name, role: block.role, content: entry.content });
        }
      }
      continue;
    }
    // A block's own text (`:3600-3663`), its `{{wi_marker}}` taking the "at marker" lore joined by a blank line (`:3034-3041`): lore
    // inside the block's text, with no flag of its own.
    const content = block.content.replace(WI_MARKER, () => lore.atMarker.map((e) => e.content).join("\n\n"));
    if (block.depth !== undefined) pending.push({ role: block.role, depth: Math.max(0, block.depth), content, name: block.name, blockId: block.id, worldInfo: false });
    else {
      prompt.push({ role: block.role, content });
      breakdown.push({ type: "block", name: block.name, role: block.role, content, blockId: block.id });
    }
  }
  // Lore of a position with no marker in the preset (`:3728-3756`): "before" just before the history, "after" just after it.
  if (!hasWiBefore && lore.before.length > 0) {
    prompt.splice(firstChatIdx, 0, ...lore.before.map((e): LlmMessage => ({ role: e.role, content: e.content, __worldInfoSource: true })));
    for (const e of lore.before) breakdown.push({ type: "world_info", name: `World Info Before (auto): ${e.label}`, role: e.role, content: e.content });
    firstChatIdx += lore.before.length;
  }
  if (!hasWiAfter && lore.after.length > 0) {
    prompt.splice(Math.min(firstChatIdx + chatHistoryCount, prompt.length), 0, ...lore.after.map((e): LlmMessage => ({ role: e.role, content: e.content, __worldInfoSource: true })));
    for (const e of lore.after) breakdown.push({ type: "world_info", name: `World Info After (auto): ${e.label}`, role: e.role, content: e.content });
  }
  // The "at marker" lore, named in the breakdown, its tokens counted in the block that holds it (`:3838-3847`).
  for (const e of lore.atMarker) breakdown.push({ type: "world_info", name: `WI At Marker: ${e.label}`, role: e.role, content: e.content, marker: "wi_marker", excludeFromTotal: true });
  // In-history blocks and markers spliced in, then named (`:3881-3902`).
  insertIntoHistory(prompt, pending);
  for (const p of pending) breakdown.push(p.worldInfo ? { type: "world_info", name: p.name, role: p.role, content: p.content } : { type: "block", name: p.name, role: p.role, content: p.content, blockId: p.blockId });
  // A continue's nudge, without "Continue prefill" (`services/prompt-assembly.service.ts:3987-4008`): marked, so that it is moved to stand
  // after the continued message below.
  if (ending.type === "continue" && preset.continuePrefill !== true) {
    const nudge = preset.continueNudge ?? CONTINUE_NUDGE;
    if (nudge !== "") {
      prompt.push({ role: "system", content: nudge, __continueNudge: true });
      breakdown.push({ type: "utility", name: "Continue Nudge", role: "system", content: nudge });
    }
  }
  // The prefill (`services/prompt-assembly.service.ts:4120-4198`): the user's "Start Reply With", unless it is blank, then the preset's
  // start, as one partial assistant message, and nothing at all when both are empty. A continue has none: its own message is the reply
  // it goes on with. An impersonation has one only with "Continue prefill" on, the preset's impersonation start where it sets one. The
  // stand-in resolves no macros in them, and its connections are custom ones, which take no reasoning prefill (`:4164-4181`).
  const startsReply = ending.type !== "impersonate" || preset.continuePrefill === true;
  const prefill: string[] = [];
  if (startsReply && ending.type !== "continue" && ending.promptBias.trim() !== "") prefill.push(ending.promptBias);
  const presetStart = ending.type === "continue" || !startsReply ? "" : ending.type === "impersonate" && preset.assistantImpersonation ? preset.assistantImpersonation : (preset.assistantPrefill ?? "");
  if (presetStart !== "") prefill.push(presetStart);
  if (prefill.length > 0) {
    const text = prefill.join("");
    prompt.push({ role: "assistant", content: text, partial: true });
    breakdown.push({ type: "utility", name: "Assistant Prefill", role: "assistant", content: text });
  }
  // The preset's completion settings, over the whole prompt before any interceptor sees it (`:4210`).
  applyCompletionSettings(prompt, preset, ending.names);
  // `finalizeContinuePrompt` (`:742-775`, called at `:4314-4338`): the continued message, the newest assistant history message with the
  // continued message's id (or the newest of all, where Lumiverse found none), leaves the history: the postfix is appended, it is a
  // partial reply with "Continue prefill" on, it loses its history mark and keeps its other keys, its source among them, and it goes
  // last, the nudge after it. Where it is not in the history (hidden, or no assistant's), nothing moves.
  if (ending.type === "continue") {
    let at = -1;
    for (let i = prompt.length - 1; i >= 0; i--) {
      const m = prompt[i]!;
      if (m.role !== "assistant" || m.__chatHistorySource !== true) continue;
      if (ending.continueMessageId !== undefined && m.__sourceMessageId !== ending.continueMessageId) continue;
      at = i;
      break;
    }
    if (at >= 0) {
      const [found] = prompt.splice(at, 1);
      const moved: LlmMessage = { ...withText(found!, ending.continuePostfix ?? ""), ...(preset.continuePrefill === true ? { partial: true } : {}) };
      delete moved.__chatHistorySource;
      delete moved.__contextAnchorProtected;
      prompt.push(moved);
      const nudge = prompt.findIndex((m) => m.__continueNudge === true);
      if (nudge >= 0) prompt.push(...prompt.splice(nudge, 1));
      breakdown.push({ type: "utility", name: "Continue Target", role: "assistant", content: textOf(moved) });
    }
  }
  // The chat history's bounds read again from where its messages ended up (`:4415-4442`).
  const historyEntry = breakdown.find((e) => e.type === "chat_history");
  if (historyEntry !== undefined) {
    const first = prompt.findIndex((m) => m.__chatHistorySource === true);
    historyEntry.firstMessageIndex = first >= 0 ? first : undefined;
    historyEntry.messageCount = prompt.filter((m) => m.__chatHistorySource === true).length;
  }
  return { prompt, breakdown };
}
