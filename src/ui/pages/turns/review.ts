// What the Turn page's review card and carried record need beyond the turn: the turn's one card (its changes by lane, the questions asked on it, the
// cards an earlier engine kept), what an old engine recorded on a carried reply, and the two things he does on the card, undo one change and answer
// a question that waits. Read once the spoiler gate is open, for both can give away what the Author did.

import { useState } from "preact/hooks";
import type { CarriedTurnReply, ReviewCardReply } from "../../../shared/api";
import { useApp } from "../../app";
import { replyOf } from "../../client";
import { useRead } from "../../reading";
import { errorWords } from "../../words";

/** The card as the page holds it, with what is being done on it and what came of the last thing. */
export interface ReviewShown {
  card: ReviewCardReply | null;
  carried: CarriedTurnReply | null;
  /** Why the card or the record could not be read, in RPE's words. */
  problem: string | null;
  loading: boolean;
  /** The change being undone, or the question being answered, now. */
  busy: string | null;
  /** What came of the last undo or answer, in words; a refusal is in RPE's own. */
  said: string | null;
  onUndo(change: string): void;
  onAnswer(question: string, go: boolean): void;
}

/** Reads the card of `turn` (and the record an old engine kept, for a turn carried in) while `gateOpen`; `again` reads the turn itself afresh after a change on the card. */
export function useReview(chat: string, turn: string, carried: boolean, gateOpen: boolean, stamp: number, again: () => void): ReviewShown {
  const app = useApp();
  const [nth, setNth] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const card = useRead(gateOpen ? () => app.client.call("GET /api/v1/chats/:chat/turns/:turn/card", { chat, turn }).then(replyOf) : null, [chat, turn, gateOpen, stamp, nth]);
  const record = useRead(gateOpen && carried ? () => app.client.call("GET /api/v1/chats/:chat/turns/:turn/carried", { chat, turn }).then(replyOf) : null, [chat, turn, gateOpen, carried]);
  const done = (words: string): void => {
    setBusy(null);
    setSaid(words);
    setNth((n) => n + 1);
    again();
  };
  const failed = (error: unknown): void => {
    setBusy(null);
    setSaid(errorWords(error));
  };
  return {
    card: card.value,
    carried: record.value,
    problem: card.problem ?? record.problem,
    loading: card.loading || record.loading,
    busy,
    said,
    onUndo(change) {
      if (busy !== null) return;
      setBusy(change);
      setSaid(null);
      app.client.call("POST /api/v1/chats/:chat/turns/:turn/changes/:change/undo", { chat, turn, change }).then(replyOf).then(
        (answer) => done(answer.recorded.length === 0 ? "Nothing was recorded to undo it." : `Undone: ${answer.recorded.length} ${answer.recorded.length === 1 ? "change was" : "changes were"} recorded to reverse it${answer.left.length === 0 ? "." : `; ${answer.left.length} could not be reversed: ${answer.left.map((r) => r.code).join(", ")}.`}`),
        failed,
      );
    },
    onAnswer(question, go) {
      if (busy !== null) return;
      setBusy(question);
      setSaid(null);
      app.client.call("POST /api/v1/chats/:chat/approvals/:approval/answer", { chat, approval: question }, { body: { go } }).then(replyOf).then(
        (answer) => done(answer.state === "answered" ? (go ? "It goes ahead." : "It does not go ahead.") : answer.state === "settled" ? "It was settled already." : "No question of that id is waiting."),
        failed,
      );
    },
  };
}
