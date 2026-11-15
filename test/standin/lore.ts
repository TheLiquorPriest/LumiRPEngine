// The stand-in Lumiverse's World Info (`lumiverse.ts` calls it for each prompt): the context its World Info
// interceptors are given, their chain as Lumiverse runs it before lore activates, which entries activate,
// and what the prompt interceptors' context says of them. What it copies from Lumiverse's source (staging at
// a70f4ed2) says the file and lines; what is its own (which entries activate) says so. Paths are
// Lumiverse's `src/`.

import { quietTimer, type Registration, type WorldInfoHandler } from "./host";
import type { Chat, ChatMessage } from "./rows";

export interface Entry {
  id: string;
  book: string;
  content: string;
  comment?: string;
  keys?: string[];
  constant?: boolean;
  disabled?: boolean;
  extensions?: Record<string, unknown>;
}

/**
 * What a World Info interceptor is told of the generation (`services/prompt-assembly.service.ts:2282-2313`):
 * the chat's messages the prompt is built from, hidden ones included, each with its text, its place in the
 * chat and the swipe it shows, a greeting marked as one (`:2289-2305`).
 */
export function worldInfoContext(chat: Chat, messages: readonly ChatMessage[]): Record<string, unknown> {
  const indexOf = (id: string): number => chat.messages.findIndex((m) => m.id === id);
  return {
    purpose: "prompt",
    chatId: chat.id,
    characterId: chat.character.id,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, is_user: m.role === "user", is_greeting: m.greeting !== undefined, ...(m.greeting !== undefined ? { greeting_index: m.greeting } : {}), swipe_id: m.swipeId ?? 0, index_in_chat: indexOf(m.id) })),
    chatTurn: messages.length,
    chatMetadata: chat.metadata ?? {},
    activationSettings: { globalScanDepth: null, maxRecursionPasses: 0 },
  };
}

/** The World Info chain (`spindle/world-info-interceptor.ts:206-407`), each handler behind its worker call (`spindle/worker-host.ts:4927-4955`). */
export async function worldInfoChain(registrations: readonly Registration<WorldInfoHandler>[], entries: readonly Entry[], ctx: Record<string, unknown>, userId: string, limit: { timeoutMs: number; log: string[] }): Promise<Entry[]> {
  const disabledByChain = new Set<string>();
  const enabledByChain = new Set<string>();
  const contentOverrides = new Map<string, string>();
  const candidateIds = new Set(entries.map((e) => e.id));
  let working: Entry[] = [...entries];
  const rebuildWorking = (): Entry[] =>
    entries.map((e) => {
      const isDisabled = disabledByChain.has(e.id);
      const wantsEnable = !isDisabled && enabledByChain.has(e.id) && e.disabled === true;
      const newContent = contentOverrides.get(e.id);
      if (!isDisabled && !wantsEnable && newContent === undefined) return e;
      return { ...e, ...(isDisabled ? { disabled: true } : {}), ...(wantsEnable ? { disabled: false } : {}), ...(newContent !== undefined ? { content: newContent } : {}) };
    });
  for (const registration of registrations) {
    const dto = { ...ctx, userId, entries: working.map((e) => ({ id: e.id, world_book_id: e.book, comment: e.comment ?? "", disabled: e.disabled === true, constant: e.constant === true, extensions: e.extensions ?? {}, key: e.keys ?? [], keysecondary: [], content: e.content })) };
    // The worker's call: a throw reaches the host as no result (`spindle/worker-runtime.ts:4970-4993`), and past the limit the host goes on without one (`spindle/worker-host.ts:4937-4943`).
    const call = registration.handler(structuredClone(dto)).catch((error: unknown) => {
      registration.ext.logs.push(`World-info interceptor error: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    const waited = Promise.withResolvers<undefined>();
    const timer = quietTimer(limit.timeoutMs, () => {
      limit.log.push("World-info interceptor timed out after 10s; skipping");
      waited.resolve(undefined);
    });
    const result = await Promise.race([call, waited.promise]);
    clearTimeout(timer);
    if (!result) continue;
    const copy = structuredClone(result);
    for (const id of copy.disabled ?? []) disabledByChain.add(id);
    for (const id of copy.enabled ?? []) enabledByChain.add(id);
    for (const m of copy.mutated ?? []) if (candidateIds.has(m.id) && m.content !== undefined) contentOverrides.set(m.id, m.content);
    working = rebuildWorking();
  }
  return working;
}

/** The stand-in's own activation: switched on and constant, or a key in a visible message. */
export function activate(entries: readonly Entry[], messages: readonly ChatMessage[]): Entry[] {
  const scanned = messages.filter((m) => !m.hidden).map((m) => m.content.toLowerCase()).join("\n");
  return entries.filter((e) => !e.disabled && (e.constant === true || (e.keys ?? []).some((k) => scanned.includes(k.toLowerCase()))));
}

/** The activated entries as the prompt interceptors' context carries them (`spindle/world-info-capture.ts:17-52`). */
export function activatedWorldInfo(active: readonly Entry[]): { id: string; comment: string; keys: string[]; source: string; bookId: string }[] {
  return active.map((e) => ({ id: e.id, comment: e.comment ?? "", keys: e.keys ?? [], source: "keyword", bookId: e.book }));
}
