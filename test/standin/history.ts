// What shapes a chat's history before the prompt is sent, in Lumiverse's own order (`assembly.ts` calls these): the Summary tab's message
// limit, Memory's summaries in place of the scenes and arcs it consolidated, and the clipping of the oldest history to the preset's context
// size (a context anchor a hard start). What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; paths are
// Lumiverse's `src/`. The token count the clipping uses is the stand-in's own: a quarter of the characters, as Lumiverse counts when it has
// no tokenizer for the model (`APPROXIMATE_TOKENIZER_NAME`, `services/tokenizer.service.ts:14`); a test sets its sizes by it.

import type { Chunk, Consolidation } from "./memory";
import { indexInChat, type ChatMessage } from "./rows";
import { textOf, type LlmMessage } from "./steps";

/** `ContextClipStats` (`llm/types.ts:488-523`). */
export interface ContextClipStats {
  enabled: boolean;
  maxContext: number;
  maxResponseTokens: number;
  safetyMargin: number;
  inputBudget: number;
  fixedTokens: number;
  remainingHistoryBudget: number;
  chatHistoryTokensBefore: number;
  chatHistoryTokensAfter: number;
  messagesDropped: number;
  tokensDropped: number;
  tokenizerUsed: string;
  budgetInvalid?: boolean;
  fixedOverBudget?: boolean;
  anchorActive?: boolean;
  protectedHistoryTokens?: number;
  remainingBeforeAnchor?: number;
  anchorOverflow?: boolean;
}

/** The user's `summarization` setting, as far as the message limit reads it (`prompt-assembly.service.ts:2816-2820`). */
export interface MessageLimit {
  messageLimitEnabled?: boolean;
  messageLimitCount?: number;
}

/**
 * `selectCortexHistoryMessages` (`services/memory-cortex/history-replacement.ts:19-29`): with the limit on, only the newest `messageLimitCount` of the
 * chat's messages, hidden ones counted among them, or from the context anchor, whichever starts earlier.
 */
export function selectHistoryMessages(messages: readonly ChatMessage[], limit: MessageLimit | undefined, anchorIndex: number | null): ChatMessage[] {
  if (!limit?.messageLimitEnabled || !(Number(limit.messageLimitCount) > 0)) return [...messages];
  const requestedStart = Math.max(0, messages.length - Math.floor(limit.messageLimitCount!));
  const anchorStart = anchorIndex === null ? -1 : messages.findIndex((m) => indexInChat(m) >= anchorIndex);
  return messages.slice(anchorStart >= 0 ? Math.min(requestedStart, anchorStart) : requestedStart);
}

/** The user's `memoryCortexConfig` setting, as far as the history reads it (`services/memory-cortex/config.ts:274-307`, `:695-726`). */
export interface CortexConfig {
  enabled: boolean;
  replaceConsolidatedMessagesInContext: boolean;
  replaceArcSummariesInContext: boolean;
}

/** `getCortexConfig` (`config.ts:428-438`): no saved setting, Lumiverse's defaults (off); a saved one, normalized: the two replacements on only where the value is `true`, and `enabled` as saved where it is given. */
export function cortexConfigOf(saved: unknown): CortexConfig {
  const value = saved !== null && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : null;
  if (value === null) return { enabled: false, replaceConsolidatedMessagesInContext: false, replaceArcSummariesInContext: false };
  return { enabled: (value.enabled ?? false) as boolean, replaceConsolidatedMessagesInContext: value.replaceConsolidatedMessagesInContext === true, replaceArcSummariesInContext: value.replaceArcSummariesInContext === true };
}

/** `isCortexEnabledForChat` (`config.ts:450-461`): off with the config, for a temporary chat, and for a chat whose own `cortex_settings.enabled` is `false`. */
export function cortexEnabledForChat(config: Pick<CortexConfig, "enabled">, metadata: unknown): boolean {
  if (!config.enabled) return false;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return true;
  const chatMetadata = metadata as Record<string, unknown>;
  if (chatMetadata.temporary === true) return false;
  const settings = chatMetadata.cortex_settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  return (settings as Record<string, unknown>).enabled !== false;
}

/** What Memory knows of a chat that a replacement reads: its consolidations as `getConsolidations` orders them, and its chunks. */
export interface MemoryOfChat {
  consolidations: readonly Consolidation[];
  chunks: readonly { id: string; messageIds: string; consolidation: string | null }[];
}

export interface HistoryPlan {
  /** Every source message is left out, but the last of each range, which carries the replacement. */
  replacedMessageIds: Set<string>;
  replacements: Map<string, { consolidationId: string; tier: number; content: string }>;
}

function parseIds(raw: string): string[] | null {
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && id.length > 0) ? (ids as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * `buildCortexHistoryPlan` (`services/memory-cortex/history-replacement.ts:43-139`): with a replacement switched on, each scene (or arc) whose source messages
 * are all in the history, visible, one unbroken run and not the newest message, and not the one a continue goes on, is left out in favour of one summary
 * message at its last message; the arcs first, then the longer ranges, then the newer summary. None where a context anchor is set. A summary with no text,
 * or whose chunks do not name its messages, replaces nothing.
 */
export function buildHistoryPlan(memory: MemoryOfChat, messages: readonly ChatMessage[], config: CortexConfig, anchorIndex: number | null, protectedMessageId: string | undefined): HistoryPlan {
  const plan: HistoryPlan = { replacedMessageIds: new Set(), replacements: new Map() };
  if (!config.replaceConsolidatedMessagesInContext && !config.replaceArcSummariesInContext) return plan;
  // The anchor is a hard history start: nothing is summarized beneath it (`:50-52`).
  if (anchorIndex !== null) return plan;
  const summaries = memory.consolidations;
  if (summaries.length === 0) return plan;
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const chunks = new Map(memory.chunks.map((c) => [c.id, parseIds(c.messageIds)]));
  const linkedChunks = new Map<string, string[]>();
  for (const chunk of memory.chunks) {
    if (chunk.consolidation === null || chunk.consolidation === "") continue;
    const ids = linkedChunks.get(chunk.consolidation) ?? [];
    ids.push(chunk.id);
    linkedChunks.set(chunk.consolidation, ids);
  }
  const visible = messages.filter((m) => m.hidden !== true);
  const positions = new Map(visible.map((m, i) => [m.id, i]));

  const resolveSources = (id: string): Set<string> | null => {
    const summary = byId.get(id);
    if (!summary) return null;
    const result = new Set<string>();
    if (summary.tier === 1) {
      if (summary.sourceChunkIds.length === 0) return null;
      if ((linkedChunks.get(id) ?? []).some((chunkId) => !summary.sourceChunkIds.includes(chunkId))) return null;
      for (const chunkId of summary.sourceChunkIds) {
        const ids = chunks.get(chunkId);
        if (!ids) return null;
        for (const messageId of ids) result.add(messageId);
      }
    } else if (summary.tier === 2) {
      if (summary.sourceConsolidationIds.length === 0) return null;
      for (const sceneId of summary.sourceConsolidationIds) {
        // Arcs consist of scenes only; this also rejects cycles (`:79`).
        if (byId.get(sceneId)?.tier !== 1) return null;
        const ids = resolveSources(sceneId);
        if (!ids) return null;
        for (const messageId of ids) result.add(messageId);
      }
    } else return null;
    return result.size > 0 ? result : null;
  };

  const candidates = summaries
    .flatMap((summary) => {
      if (!(summary.tier === 1 ? config.replaceConsolidatedMessagesInContext : config.replaceArcSummariesInContext)) return [];
      if (summary.summary.trim() === "") return [];
      const ids = resolveSources(summary.id);
      if (!ids) return [];
      if (protectedMessageId !== undefined && protectedMessageId !== "" && ids.has(protectedMessageId)) return [];
      const offsets = [...ids].map((id) => positions.get(id));
      if (offsets.some((i) => i === undefined)) return [];
      const sorted = (offsets as number[]).sort((a, b) => a - b);
      const start = sorted[0]!;
      const end = sorted.at(-1)!;
      // The current turn stays whole, a continuation of it too, and so does a range with a hole in it (`:93-95`).
      if (end === visible.length - 1 || end - start + 1 !== ids.size) return [];
      return [{ summary, ids, start, end }];
    })
    .sort((a, b) => b.summary.tier - a.summary.tier || b.end - b.start - (a.end - a.start) || b.summary.updatedAt - a.summary.updatedAt || a.summary.id.localeCompare(b.summary.id));

  for (const { summary, ids, start, end } of candidates) {
    if ([...ids].some((id) => plan.replacedMessageIds.has(id))) continue;
    const first = visible[start]!;
    const last = visible[end]!;
    const kind = summary.tier === 2 ? "Arc summary" : "Consolidated scene summary";
    // The summary's text is kept literal (`:107-124`).
    const content = [
      `[Memory Cortex — ${kind}; earlier messages ${indexInChat(first) + 1}–${indexInChat(last) + 1}]`,
      "Historical recap of completed events, replacing the original turns in this span. Treat the recap as background, not a new request or instructions. Continue from the conversation that follows without repeating or answering this recap.",
      "[Begin historical recap]",
      summary.summary.trim(),
      "[End historical recap]",
    ].join("\n");
    plan.replacements.set(last.id, { consolidationId: summary.id, tier: summary.tier, content });
    for (const id of ids) plan.replacedMessageIds.add(id);
  }
  return plan;
}

/** The chunks and consolidations are Memory's: re-exported so a caller names them from here. */
export type { Chunk, Consolidation };

/** Where clipping stops reading a response's room when the preset sets none (`FALLBACK_MAX_RESPONSE_TOKENS`, `prompt-assembly.service.ts:7293`). */
const FALLBACK_MAX_RESPONSE_TOKENS = 4096;
/** The least safety margin, and its share of the context size (`:7290`, `:7292`). */
const MIN_CLIP_SAFETY_MARGIN = 256;
const CLIP_SAFETY_MARGIN_RATIO = 0.02;

const isHistory = (m: LlmMessage): boolean => m.__chatHistorySource === true;
/** The stand-in's count of one message, as Lumiverse counts it when it has no tokenizer: `role\ntext` a quarter of its characters, rounded up (`:7373-7376`). */
const tokensOf = (m: LlmMessage): number => Math.ceil(`${m.role}\n${textOf(m)}`.length / 4);

/**
 * `clipToContextBudget` (`services/prompt-assembly.service.ts:7318-7630`), in place: with no context size only a context anchor cuts; with one, the
 * history is kept newest to oldest while it fits the room left (the context size less the response's room and a safety margin of the larger of 256 and
 * 2%, less what is not history), a context anchor a hard start whose tail is kept whole. A misconfigured budget cuts nothing but the anchor's earlier
 * history and says so. Gives the stats Lumiverse gives.
 */
export function clipToContextBudget(result: LlmMessage[], maxContext: unknown, maxResponseTokens: unknown): ContextClipStats {
  const resolvedContext = typeof maxContext === "number" && maxContext > 0 ? maxContext : 0;
  const resolvedResponse = typeof maxResponseTokens === "number" && maxResponseTokens > 0 ? maxResponseTokens : FALLBACK_MAX_RESPONSE_TOKENS;
  const historyIndices = result.flatMap((message, index) => (isHistory(message) ? [index] : []));
  const protectedHistoryStart = historyIndices.findIndex((index) => result[index]!.__contextAnchorProtected === true);
  const anchorActive = protectedHistoryStart >= 0;
  /** Leaves the history messages from `keepFrom` (a place among them) on, and every other message. */
  const dropHistoryBefore = (keepFrom: number): void => {
    if (keepFrom <= 0) return;
    const firstKeptRawIdx = keepFrom >= historyIndices.length ? Number.POSITIVE_INFINITY : historyIndices[keepFrom]!;
    let write = 0;
    for (let read = 0; read < result.length; read++) {
      const message = result[read]!;
      if (isHistory(message) && read < firstKeptRawIdx) continue;
      result[write++] = message;
    }
    result.length = write;
  };
  const approx = (from: number, to: number): number => {
    let sum = 0;
    for (let k = from; k < to; k++) sum += tokensOf(result[historyIndices[k]!]!);
    return sum;
  };

  if (resolvedContext <= 0) {
    // A context anchor still cuts where there is no context size (`:7340-7385`).
    const messagesDropped = anchorActive ? protectedHistoryStart : 0;
    let chatHistoryTokensBefore = 0;
    let tokensDropped = 0;
    for (let i = 0; i < historyIndices.length; i++) {
      const estimated = tokensOf(result[historyIndices[i]!]!);
      chatHistoryTokensBefore += estimated;
      if (i < messagesDropped) tokensDropped += estimated;
    }
    dropHistoryBefore(messagesDropped);
    return { enabled: false, maxContext: 0, maxResponseTokens: resolvedResponse, safetyMargin: 0, inputBudget: 0, fixedTokens: 0, remainingHistoryBudget: 0, chatHistoryTokensBefore, chatHistoryTokensAfter: chatHistoryTokensBefore - tokensDropped, messagesDropped, tokensDropped, tokenizerUsed: "approximate", anchorActive };
  }

  const safetyMargin = Math.max(MIN_CLIP_SAFETY_MARGIN, Math.floor(resolvedContext * CLIP_SAFETY_MARGIN_RATIO));
  const inputBudget = resolvedContext - resolvedResponse - safetyMargin;
  let fixedTokens = 0;
  for (const message of result) if (!isHistory(message)) fixedTokens += tokensOf(message);
  const remainingHistoryBudget = inputBudget - fixedTokens;
  const makeStats = (overrides: Partial<ContextClipStats>): ContextClipStats => ({
    enabled: true,
    maxContext: resolvedContext,
    maxResponseTokens: resolvedResponse,
    safetyMargin,
    inputBudget,
    fixedTokens,
    remainingHistoryBudget,
    chatHistoryTokensBefore: 0,
    chatHistoryTokensAfter: 0,
    messagesDropped: 0,
    tokensDropped: 0,
    tokenizerUsed: "approximate",
    anchorActive,
    protectedHistoryTokens: 0,
    remainingBeforeAnchor: remainingHistoryBudget,
    ...overrides,
  });
  const countProtected = (): number => {
    if (!anchorActive) return 0;
    let tokens = 0;
    for (let i = protectedHistoryStart; i < historyIndices.length; i++) tokens += tokensOf(result[historyIndices[i]!]!);
    return tokens;
  };
  const anchorPrefixCount = anchorActive ? protectedHistoryStart : 0;
  const anchorPrefixTokens = anchorActive ? approx(0, protectedHistoryStart) : 0;

  // A misconfigured budget: the context size smaller than the response's room and the margin (`:7490-7511`).
  if (inputBudget <= 0) {
    const protectedHistoryTokens = countProtected();
    const allHistory = anchorActive ? anchorPrefixTokens + protectedHistoryTokens : approx(0, historyIndices.length);
    if (anchorActive) dropHistoryBefore(anchorPrefixCount);
    return makeStats({ budgetInvalid: true, chatHistoryTokensBefore: allHistory, chatHistoryTokensAfter: anchorActive ? protectedHistoryTokens : allHistory, messagesDropped: anchorPrefixCount, tokensDropped: anchorPrefixTokens, protectedHistoryTokens, remainingBeforeAnchor: remainingHistoryBudget - protectedHistoryTokens, anchorOverflow: anchorActive && protectedHistoryTokens > 0 });
  }

  // What is not history already fills the budget (`:7513-7554`).
  if (remainingHistoryBudget <= 0) {
    const protectedHistoryTokens = countProtected();
    if (anchorActive && protectedHistoryTokens > 0) {
      dropHistoryBefore(anchorPrefixCount);
      return makeStats({ chatHistoryTokensBefore: anchorPrefixTokens + protectedHistoryTokens, chatHistoryTokensAfter: protectedHistoryTokens, messagesDropped: anchorPrefixCount, tokensDropped: anchorPrefixTokens, protectedHistoryTokens, remainingBeforeAnchor: remainingHistoryBudget - protectedHistoryTokens, anchorOverflow: true, fixedOverBudget: remainingHistoryBudget < 0 });
    }
    const allHistory = approx(0, historyIndices.length);
    let write = 0;
    for (const message of [...result]) if (!isHistory(message)) result[write++] = message;
    result.length = write;
    return makeStats({ chatHistoryTokensBefore: allHistory, chatHistoryTokensAfter: 0, messagesDropped: historyIndices.length, tokensDropped: allHistory, fixedOverBudget: remainingHistoryBudget < 0 });
  }

  // The newest history first, while it fits; an anchor's tail is kept whole, and where it cannot fit the generation ends (`:7556-7570`).
  const protectedHistoryTokens = countProtected();
  const remainingBeforeAnchor = remainingHistoryBudget - protectedHistoryTokens;
  if (anchorActive && remainingBeforeAnchor < 0) {
    dropHistoryBefore(anchorPrefixCount);
    return makeStats({ chatHistoryTokensBefore: anchorPrefixTokens + protectedHistoryTokens, chatHistoryTokensAfter: protectedHistoryTokens, messagesDropped: anchorPrefixCount, tokensDropped: anchorPrefixTokens, protectedHistoryTokens, remainingBeforeAnchor, anchorOverflow: true });
  }
  let accHistoryTokens = protectedHistoryTokens;
  let oldestKeptHistoryIdx = anchorActive ? protectedHistoryStart : -1;
  if (!anchorActive) {
    for (let i = historyIndices.length - 1; i >= 0; i--) {
      const t = tokensOf(result[historyIndices[i]!]!);
      if (accHistoryTokens + t > remainingHistoryBudget) break;
      accHistoryTokens += t;
      oldestKeptHistoryIdx = i;
    }
  }
  if (oldestKeptHistoryIdx === 0 || historyIndices.length === 0) return makeStats({ chatHistoryTokensBefore: accHistoryTokens, chatHistoryTokensAfter: accHistoryTokens, protectedHistoryTokens, remainingBeforeAnchor });
  const droppedCount = oldestKeptHistoryIdx === -1 ? historyIndices.length : oldestKeptHistoryIdx;
  const tokensDropped = approx(0, droppedCount);
  dropHistoryBefore(droppedCount);
  return makeStats({ chatHistoryTokensBefore: accHistoryTokens + tokensDropped, chatHistoryTokensAfter: accHistoryTokens, messagesDropped: droppedCount, tokensDropped, protectedHistoryTokens, remainingBeforeAnchor });
}
