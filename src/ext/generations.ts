// Which generation a prompt belongs to, and the history cut RPE answered for it (STANDALONE-PLAN §4.2,
// second workaround). Lumiverse's interceptor context carries no generation id at this checkout
// (`generate.service.ts:1063-1072`), but `GENERATION_STARTED` carries it, with the target message and
// swipe, the speaker and the kind, and Lumiverse emits it before the prompt is assembled
// (`generate.service.ts:2040-2055`, then the assembly in the detached continuation from `:2068`). One
// generation runs per chat at a time: a new one stops the one before (`generate.service.ts:1601-1651`).
// So the latest announced generation of a chat is the one its next prompt belongs to. The World Info
// interceptor and the prompt interceptor of one generation run in this one worker, so RPE's answer to
// the question is held here per chat from the first to the second. Nothing outlives a generation.

import { isRecord } from "../shared/json";
import type { Answer, GenerationFacts } from "../adapter/lumiverse/wire";

interface Announced {
  facts: GenerationFacts;
  /** A prompt interceptor took it: no other prompt is paired with it. */
  taken: boolean;
}

interface Held {
  /** The generation announced for the chat when the question was asked; null when none was. */
  generation: string | null;
  cut: Answer["cut"];
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
  private readonly announced = new Map<string, Announced>();
  private readonly held = new Map<string, Held>();

  /** `most`: how many chats are followed at once; past it the one heard from longest ago is dropped. */
  constructor(private readonly most: number) {}

  private bound<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
    for (const oldest of map.keys()) {
      if (map.size <= this.most) break;
      map.delete(oldest);
    }
  }

  /** `GENERATION_STARTED`: the chat's next prompt is this generation's. */
  started(payload: unknown, user: string | undefined): void {
    const read = factsOf(payload);
    if (read === null || user === undefined) return;
    const key = `${user}\u0000${read.chat}`;
    this.bound(this.announced, key, { facts: read.facts, taken: false });
    this.held.delete(key);
  }

  /** `GENERATION_ENDED` or `GENERATION_STOPPED`: what was held for that generation goes. */
  over(payload: unknown, user: string | undefined): void {
    if (!isRecord(payload) || user === undefined) return;
    const chat = str(payload.chatId);
    const id = str(payload.generationId);
    if (chat === null || id === null) return;
    const key = `${user}\u0000${chat}`;
    if (this.announced.get(key)?.facts.id === id) this.announced.delete(key);
    if (this.held.get(key)?.generation === id) this.held.delete(key);
  }

  /** The generation announced for the chat whose prompt has not been taken yet: the one a question asked now belongs to. */
  pending(user: string, chat: string): GenerationFacts | null {
    const a = this.announced.get(`${user}\u0000${chat}`);
    return a !== undefined && !a.taken ? a.facts : null;
  }

  /** The question's answer on the cut, held for the prompt interceptor of the generation it was asked for (null: no answer). */
  hold(user: string, chat: string, generation: string | null, cut: Answer["cut"]): void {
    this.bound(this.held, `${user}\u0000${chat}`, { generation, cut });
  }

  /**
   * The generation a prompt of this chat and type belongs to, taken so no other prompt is paired with
   * it: the one Lumiverse names in the context where it does, else the one announced for the chat.
   * Null when none fits.
   */
  take(user: string, chat: string, type: string, named: string | null): GenerationFacts | null {
    const a = this.announced.get(`${user}\u0000${chat}`);
    if (named !== null) {
      if (a !== undefined && a.facts.id === named) {
        a.taken = true;
        return a.facts;
      }
      return { id: named, type, target: { message: null, swipe: null }, speaker: { id: null, name: null }, model: null };
    }
    if (a === undefined || a.taken || a.facts.type !== type) return null;
    a.taken = true;
    return a.facts;
  }

  /** The cut RPE answered for this generation, once; null when it gave none. */
  cutFor(user: string, chat: string, generation: string): Answer["cut"] {
    const key = `${user}\u0000${chat}`;
    const h = this.held.get(key);
    if (h === undefined || h.generation !== generation) return null;
    this.held.delete(key);
    return h.cut;
  }
}
