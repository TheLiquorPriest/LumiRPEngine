// The stand-in Lumiverse's prompt (`lumiverse.ts` calls it for each generation), assembled the stand-in's own
// way: the preset's blocks, then each activated lore entry as a message of its own, then the chat's visible
// messages as history, with any depth block spliced in; then the prompt's end as Lumiverse makes it; and the
// breakdown Lumiverse keeps of it. What it copies from Lumiverse's source (staging at a70f4ed2) says the
// file and lines; paths are Lumiverse's `src/`.

import type { Entry } from "./lore";
import type { ChatMessage } from "./rows";
import { stripClosingTags, textOf, type LlmMessage, type LlmPart, type Role } from "./steps";

export interface Block {
  id: string;
  name: string;
  role: Role;
  content: string;
  /** Spliced into the chat history this many messages from its end, not as history. */
  depth?: number;
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

/** The prompt for these messages: `indexOf` gives each one's place in the chat. */
export function assemble(preset: Preset, active: readonly Entry[], messages: readonly ChatMessage[], indexOf: (id: string) => number, ending: Ending): Assembled {
  const breakdown: BreakdownEntry[] = [];
  const prompt: LlmMessage[] = [];
  for (const block of preset.blocks.filter((b) => b.depth === undefined)) {
    prompt.push({ role: block.role, content: block.content });
    breakdown.push({ type: "block", name: block.name, role: block.role, content: block.content, blockId: block.id });
  }
  for (const e of active) {
    // The host strips a mark when it inserts the entry.
    const text = stripClosingTags(e.content);
    if (text.trim() === "") continue;
    prompt.push({ role: "system", content: text, __worldInfoSource: true });
    breakdown.push({ type: "world_info", name: e.comment || "World Info", role: "system", content: text });
  }
  const history: LlmMessage[] = messages
    .filter((m) => !m.hidden)
    .map((m) => {
      const content: string | LlmPart[] = m.images ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image" as const, ...i }))] : m.content;
      return { role: m.role, content, __chatHistorySource: true, __sourceMessageId: m.id, __sourceIndexInChat: indexOf(m.id) };
    });
  breakdown.push({ type: "chat_history", name: "Chat History", messageCount: history.length, firstMessageIndex: prompt.length });
  for (const block of preset.blocks.filter((b) => b.depth !== undefined)) {
    history.splice(Math.max(0, history.length - block.depth!), 0, { role: block.role, content: block.content });
    breakdown.push({ type: "block", name: block.name, role: block.role, content: block.content, blockId: block.id });
  }
  prompt.push(...history);
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
