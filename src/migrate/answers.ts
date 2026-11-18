// A chat today's build held paused on a keep-or-discard question, answered from RPE (STANDALONE-PLAN §15.3 step 7, §6.3,
// §10.10; R-54, D-26). His answer is kept in RPE's database and written at every later run as today's own pause chip writes
// it, over the read-only stand-in, so today's fold carries the held turns' changes (keep) or leaves their replies plain
// (discard). At once, the turns the run imported for the chat take what today's fold now applies at each of them: on their
// own turns, never after the newest reply, the later turns' changes applied again on top in order, a value a later turn set
// keeping the later value, what no longer applies reported and the stretch named in the chat's next briefing (the store's
// `addEarlier`). The same holds for a chat not yet played on RPE, which the next run imports again with the answer in
// today's data. Today's data is never written: the answer lives in RPE's database alone, so going back finds today's chat
// paused as it was.

import type { Database } from "bun:sqlite";
import type { Registry } from "../engine/registry-impl";
import type { ChatId, UserId } from "../shared/ids";
import { JoinedTurnError, type ChangeInput, type EarlierLanded, type UserStore } from "../store";
import { CapturingFold } from "./capture";
import { chainOf, placements } from "./own-path";
import { importedTurns, keepAnswer } from "./tables";
import { openToday, type Sources } from "./today";

export type PauseChoice = "keep" | "discard";

/** His answer to the question a chat was paused on: the chat, the edited message the pause names, keep or discard, and when he gave it. */
export interface PauseAnswer {
  chat: string;
  message: string;
  choice: PauseChoice;
  at: number;
}

/** What an answer did: whether today's build holds it for a reply still under way in the chat (it lands at the run after that reply's window closes), the turns whose held changes landed, and per chat through them what no longer applied and the stretch its next briefing names. */
export interface AnsweredPaused {
  answer: PauseAnswer;
  held: boolean;
  /** The imported turns that took changes today's fold now applies there, each with how many. */
  turns: { turn: string; changes: number }[];
  landed: EarlierLanded[];
}

export class NotPaused extends Error {
  override name = "NotPaused";
}

/**
 * Lands the held turns' changes, each on its own turn, as `addEarlier` places them. A turn the store refuses because RPE joined
 * it to another (a continue's held turn) is followed through the `joined` the store names, never refused.
 */
function landEarlier(s: UserStore, turn: string, changes: readonly ChangeInput[]): { turn: string; landed: EarlierLanded[] } {
  let at = turn;
  for (;;) {
    try {
      return { turn: at, landed: s.addEarlier(at, changes).landed };
    } catch (error) {
      if (!(error instanceof JoinedTurnError) || error.joined === at) throw error;
      at = error.joined;
    }
  }
}

/**
 * Answers the question `chat` was paused on in today's data (`sources`), and lands what it frees on the turns a run imported. The
 * answer is kept (`keepAnswer`) and the store written inside `write`, the caller's one writer of RPE's database. Refused with
 * `NotPaused` where today's chat is not paused on that message (`message`; the first pause where none is named).
 */
export async function answerPaused(input: { db: Database; s: UserStore; registry: Registry; sources: Sources; chat: string; message?: string; choice: PauseChoice; now: number; write<T>(work: () => T): Promise<T> }): Promise<AnsweredPaused> {
  const { db, s, sources, chat } = input;
  const user = sources.userId as UserId;
  const id = chat as ChatId;
  const today = await openToday(sources);
  try {
    const reader = today.reader;
    const paused = await reader.pausedOn(id, user);
    const message = input.message ?? paused[0];
    if (message === undefined || !paused.includes(message)) throw new NotPaused(`Chat ${chat} is not paused on ${input.message === undefined ? "any question" : `message ${input.message}`} in the previous build's data.`);
    const answer: PauseAnswer = { chat, message, choice: input.choice, at: input.now };
    const before = await reader.today(id, user);
    if (before === null) throw new NotPaused(`The previous build's reader can't open chat ${chat}.`);
    const came = await reader.answer(id, user, answer);
    const after = await reader.today(id, user);
    if (after === null) throw new NotPaused(`The previous build's reader can't open chat ${chat}.`);
    // What today's fold applies at each swipe now, against what it applied while the chat was paused: the held turns' changes.
    const was = new CapturingFold(input.registry);
    const now = new CapturingFold(input.registry);
    const tied = new Map(importedTurns(db, s.id, chat).map((t) => [`${t.message}:${t.swipe}`, t.turn]));
    const chain = after.input.chain;
    const order = placements(chain, after.input.tombstones).sort((a, b) => a.at - b.at || a.swipe - b.swipe);
    const held: { turn: string; changes: ChangeInput[] }[] = [];
    for (const p of order) {
      const m = chain[p.at];
      const turn = m === undefined ? undefined : tied.get(`${m.id}:${p.swipe}`);
      if (turn === undefined) continue;
      const then = was.last({ ...before.input, chain: chainOf(before.input.chain, p) }).changes;
      const freed = now.last({ ...after.input, chain: chainOf(chain, p) }).changes;
      if (then.length === 0 && freed.length > 0) held.push({ turn, changes: freed });
    }
    return await input.write(() => {
      keepAnswer(db, s.id, answer);
      const turns: { turn: string; changes: number }[] = [];
      const landed: EarlierLanded[] = [];
      for (const h of held) {
        const done = landEarlier(s, h.turn, h.changes);
        turns.push({ turn: done.turn, changes: h.changes.length });
        landed.push(...done.landed);
      }
      return { answer, held: came === "held", turns, landed };
    });
  } finally {
    today.close();
  }
}
