// What a page is told of a chat RPE is making ready for the build that runs (src/store/prepare.ts): a read of such a chat is answered at
// once with the id of its answer (`ANSWER_STATUS`, src/app/answers.ts), and that answer, and each read of its id while the chat is still
// being made ready, says how far the pass has got with it. The page says so where the HUD stands, until its reads are answered.

/** How far the pass that makes chats ready for this build is with one chat. */
export interface ChatPreparing {
  /** Chats the pass makes ready before this one: 0 while it makes this one ready. */
  ahead: number;
  /** How much of the chat is made ready (`done`) of what it wanted when the pass began it (`of`); `of` is null until the pass has counted it. */
  done: number;
  of: number | null;
}

/** The same, for the chat it names, as a waiting answer carries it (`{ answer, preparing }`). */
export interface PreparingShown extends ChatPreparing {
  chat: string;
}

/** A waiting answer's `preparing`, where it is one; null for anything else. */
export function preparingOf(value: unknown): PreparingShown | null {
  if (typeof value !== "object" || value === null) return null;
  const { chat, ahead, done, of } = value as Record<string, unknown>;
  if (typeof chat !== "string" || typeof ahead !== "number" || typeof done !== "number" || !(of === null || typeof of === "number")) return null;
  return { chat, ahead, done, of };
}
