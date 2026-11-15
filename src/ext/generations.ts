// Which generation a prompt belongs to, and what its World Info interceptor hands its prompt interceptor
// (STANDALONE-PLAN §4.2, second workaround; PlanAdapter-3). Lumiverse never puts a generation id in the
// interceptor's context (`generate.service.ts:1064-1072`), but `GENERATION_STARTED` carries it, with the
// target message and swipe, the speaker and the kind, and Lumiverse emits it before the prompt is
// assembled (`generate.service.ts:2040-2055`, then the assembly in the detached continuation from
// `:2068`). One generation runs per chat at a time: a new one stops the one before
// (`generate.service.ts:1601-1651`). So a chat's latest announced generation is the one its next prompt
// belongs to, and the chat's next replaces it. The World Info interceptor and the prompt interceptor of
// one generation run in this one worker, so RPE's cut, whose secrecy verdict was applied, the question's
// time and, for a continue, the message the lore stage saw it would continue are handed from the first to
// the second. That is all the extension holds, and only while the generation runs: taken, ended or
// stopped, it goes; nothing outlives a generation.

import { isRecord } from "../shared/json";
import type { GenerationFacts, KeepPoint, TagSecrecy } from "../adapter/lumiverse/wire";

/** What a generation's World Info interceptor hands its prompt interceptor. */
export interface Handoff {
  /** RPE's cut, where it answered one; null: the extension cuts nothing, and RPE cuts on receipt. */
  cut: { keep: KeepPoint | null } | null;
  /** Whose secrecy verdict was applied to the lore. */
  secrecy: TagSecrecy;
  /** The question's time, asked to answered or given up at its wait; null where none was asked. */
  question: { ms: number; answered: boolean } | null;
  /**
   * For a continue: the chat's last message not the player's, as the lore stage's context showed it (its
   * id and shown text), which Lumiverse continues where its caller names none; null for any other kind,
   * or where the context showed none.
   */
  continued: { id: string; text: string } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** A generation's facts from `GENERATION_STARTED`'s payload; null when it names no generation and chat. */
function factsOf(payload: unknown): { chat: string; facts: GenerationFacts } | null {
  if (!isRecord(payload)) return null;
  const id = str(payload.generationId);
  const chat = str(payload.chatId);
  const type = str(payload.generationType);
  if (id === null || chat === null || type === null) return null;
  return {
    chat,
    facts: {
      id,
      type,
      target: { message: str(payload.targetMessageId), swipe: num(payload.targetSwipeId) },
      speaker: { id: str(payload.characterId), name: str(payload.characterName) },
      model: str(payload.model),
    },
  };
}

export class Generations {
  /** By user and chat: the generation running there whose prompt has not been taken. */
  private readonly announced = new Map<string, GenerationFacts>();
  /** By user and chat: what that generation's World Info interceptor handed on. */
  private readonly held = new Map<string, { generation: string; handoff: Handoff }>();

  /** `GENERATION_STARTED`: the chat's next prompt is this generation's; whatever was held for the chat's last goes. */
  started(payload: unknown, user: string | undefined): void {
    const read = factsOf(payload);
    if (read === null || user === undefined) return;
    const key = `${user}\u0000${read.chat}`;
    this.announced.set(key, read.facts);
    this.held.delete(key);
  }

  /** `GENERATION_ENDED` or `GENERATION_STOPPED`: what was held for that generation goes. */
  over(payload: unknown, user: string | undefined): void {
    if (!isRecord(payload) || user === undefined) return;
    const chat = str(payload.chatId);
    const id = str(payload.generationId);
    if (chat === null || id === null) return;
    const key = `${user}\u0000${chat}`;
    if (this.announced.get(key)?.id === id) this.announced.delete(key);
    if (this.held.get(key)?.generation === id) this.held.delete(key);
  }

  /** The generation running in the chat whose prompt has not been taken yet: the one a question asked now belongs to. */
  pending(user: string, chat: string): GenerationFacts | null {
    return this.announced.get(`${user}\u0000${chat}`) ?? null;
  }

  /** What the generation's World Info interceptor hands its prompt interceptor. */
  hold(user: string, chat: string, generation: string, handoff: Handoff): void {
    this.held.set(`${user}\u0000${chat}`, { generation, handoff });
  }

  /** The generation a prompt of this chat and type belongs to, taken so no other prompt is paired with it; null when none fits. */
  take(user: string, chat: string, type: string): GenerationFacts | null {
    const key = `${user}\u0000${chat}`;
    const facts = this.announced.get(key);
    if (facts === undefined || facts.type !== type) return null;
    this.announced.delete(key);
    return facts;
  }

  /** What was handed on for this generation, taken; null when its World Info interceptor handed nothing. */
  handoffFor(user: string, chat: string, generation: string): Handoff | null {
    const key = `${user}\u0000${chat}`;
    const h = this.held.get(key);
    if (h === undefined || h.generation !== generation) return null;
    this.held.delete(key);
    return h.handoff;
  }
}
