// What a turn runs on (DESIGN §5.1): the user's settings and the chat's own choices (whether it
// tracks knowledge, what the narrator knows, which engine plays it) as they stood when its engine run
// started. From that run to its reply's commit, every read of them in the turn's own work is the
// frame's, so a change made meanwhile, in Settings or GM → This chat, applies from the chat's next
// turn and never stops this one. The frame rides the turn's asynchronous work: the ledger enters it
// for the engine run, the guard's write of the turn's sections and the reply's read (`LedgerService`),
// and everything those start inherits it; the chat's queue runs every other operation outside any.
// `SettingsStore` and `ChatKnowledge` answer from it for its user and chat; a view, built from the
// chat as it stands, reads outside it.

import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatId, UserId } from "../shared/ids";
import type { UserSettings } from "../shared/settings";
import type { ChatKnowledgePrefs } from "./chat-knowledge-prefs";

export interface TurnFrame {
  readonly userId: UserId;
  readonly chatId: ChatId;
  /** The user's settings as the turn's engine run started, and the store's revision of them then (`SettingsStore.revision`). */
  readonly settings: UserSettings;
  readonly revision: number;
  /** The chat's own choices then (`ChatKnowledge`). */
  readonly chat: ChatKnowledgePrefs;
}

const frames = new AsyncLocalStorage<TurnFrame>();

/** The frame of the turn whose work is running, if any. */
export function turnFrame(): TurnFrame | undefined {
  return frames.getStore();
}

/** Runs `fn` as the work of the turn `frame` is, whatever frame its caller is in. */
export function inTurn<T>(frame: TurnFrame, fn: () => Promise<T>): Promise<T> {
  return frames.run(frame, fn);
}

/** Runs `fn` outside every turn's frame: it reads the settings and choices as they stand. */
export function outsideTurns<T>(fn: () => T): T {
  return frames.exit(fn);
}
