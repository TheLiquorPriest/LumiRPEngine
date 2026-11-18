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
import { JoinedTurnError, type ChangeInput, type ChangeRow, type EarlierLanded, type UserStore } from "../store";
import { CapturingFold } from "./capture";
import { chainOf, placements } from "./own-path";
import { answersOf, importedTurns, keepAnswer } from "./tables";
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

/** The question was answered already: an answer is given once, and the first is the only one. Refused like a chat that is not paused. */
export class AlreadyAnswered extends NotPaused {
  override name = "AlreadyAnswered";
  constructor(readonly answered: PauseAnswer) {
    super(`You answered this question already: you chose ${answered.choice === "keep" ? "Keep" : "Discard"} at ${new Date(answered.at).toISOString()}. An answer is given once and is not changed; nothing was laid on the chat's turns this time.`);
  }
}

/** Throws `AlreadyAnswered` where `chat` has an answer kept to the question on `message`. */
function refuseSecond(db: Database, user: string, chat: string, message: string): void {
  const first = answersOf(db, user).find((a) => a.chat === chat && a.message === message);
  if (first !== undefined) throw new AlreadyAnswered(first);
}

/**
 * Lands the held turns' changes, each on its own turn, as `addEarlier` places them: those the turn does not hold yet, never one it does
 * (a change it holds is matched once to a held change equal to it), so that landing again lands nothing more. A turn the store refuses
 * because RPE joined it to another (a continue's held turn) is followed through the `joined` the store names, never refused. The turn
 * they landed on, and how many of them were not there before.
 */
function landEarlier(s: UserStore, turn: string, changes: readonly ChangeInput[]): { turn: string; laid: number; landed: EarlierLanded[] } {
  let at = turn;
  for (;;) {
    const held = s.changes(at).map(identity);
    const fresh = changes.filter((c) => {
      const i = held.indexOf(identity(c));
      if (i >= 0) held.splice(i, 1);
      return i < 0;
    });
    try {
      return { turn: at, laid: fresh.length, landed: fresh.length === 0 ? [] : s.addEarlier(at, fresh).landed };
    } catch (error) {
      if (!(error instanceof JoinedTurnError) || error.joined === at) throw error;
      at = error.joined;
    }
  }
}

/** What makes a change the same as another: where it is written, what it writes, and who decided it, from what source. */
function identity(c: ChangeInput | ChangeRow): string {
  return JSON.stringify([c.lane, c.op, c.value, c.by ?? null, c.handle ?? null, c.standing ?? null, c.precision ?? null, c.source ?? null, c.cite ?? null]);
}

/**
 * Answers the question `chat` was paused on in today's data (`sources`), and lands what it frees on the turns a run imported. The
 * answer is kept (`keepAnswer`) and the store written inside `write`, the caller's one writer of RPE's database. An answer is given
 * once: a question answered already is refused with `AlreadyAnswered`, which says what was chosen and when, and lands nothing; and
 * what is landed is only what the turn does not hold yet. Refused with `NotPaused` where today's chat is not paused on that message
 * (`message`; the first pause not answered yet where none is named).
 */
export async function answerPaused(input: { db: Database; s: UserStore; registry: Registry; sources: Sources; chat: string; message?: string; choice: PauseChoice; now: number; write<T>(work: () => T): Promise<T> }): Promise<AnsweredPaused> {
  const { db, s, sources, chat } = input;
  const user = sources.userId as UserId;
  const id = chat as ChatId;
  const today = await openToday(sources);
  try {
    const reader = today.reader;
    const paused = await reader.pausedOn(id, user);
    const given = answersOf(db, s.id).filter((a) => a.chat === chat);
    const message = input.message ?? paused.find((m) => !given.some((a) => a.message === m)) ?? paused[0];
    if (message !== undefined) refuseSecond(db, s.id, chat, message);
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
      // Asked again while this was read: the first answer stands, here where nothing else writes.
      refuseSecond(db, s.id, chat, message);
      keepAnswer(db, s.id, answer);
      const turns: { turn: string; changes: number }[] = [];
      const landed: EarlierLanded[] = [];
      for (const h of held) {
        const done = landEarlier(s, h.turn, h.changes);
        if (done.laid > 0) turns.push({ turn: done.turn, changes: done.laid });
        landed.push(...done.landed);
      }
      return { answer, held: came === "held", turns, landed };
    });
  } finally {
    today.close();
  }
}
