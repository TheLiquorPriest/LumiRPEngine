// An agent turn's review card in the chat's chips area (INC2-SPEC C13; AGENT-LOOP-PLAN §9): one card per
// turn, listing every change of the turn that asks first in plain words, as the player character may
// read them, each with the role that staged it (or the reply's read), its change type and its key
// (shown with Show ids). While changes wait: Apply all, a pick of them (ticked, then Apply picked), or
// No; each sends one `lre.review` request (`apply` with its picked keys, or none for all; `reject`),
// whose answer is the chat's cards after it and, at a gate, how the waiting turn starts again. Once
// answered, each change says how it stood: applied (its Undo chip is with the turn's other changes),
// let through for the turn, turned down, or refused because it no longer applies. The card follows
// `lre.review.update`. `ReviewCard` and `reviewHandlers` are hook-free, so tests press them without a
// DOM; chips.tsx's `ReviewChip` keeps the state. Styles: styles/chat.ts and styles/assistant.ts.

import { agentLabel } from "../shared/agent-settings";
import type { ChatId } from "../shared/ids";
import type { GenerateAs, ResultBodies, ReviewCardView, ReviewItemView } from "../shared/protocol";
import { Badge, Button, IdText } from "./components";
import { humanize } from "./format";
import { Icon, type IconName } from "./icons";

/** A review request as the card sends it (C13 `lre.review`). */
export type ReviewBody = { type: "lre.review"; chatId: ChatId } & ({ op: "apply"; turn: string; keys?: string[] } | { op: "reject"; turn: string });

/** What the card's controls need from outside: the request, the busy flag, the pick, and what an answer does. */
export interface ReviewIo {
  /** Sends one request: its result, or null when it failed (the error already said in a toast). */
  ask(body: ReviewBody): Promise<ResultBodies["lre.review"] | null>;
  /** Runs a request under the card's busy flag. */
  run(task: () => Promise<unknown>): void;
  picked: readonly string[];
  setPicked(keys: readonly string[]): void;
  /** An answer came: the chat's cards after it, and at a gate how the waiting turn starts again. */
  answered(cards: ReviewCardView[], start: GenerateAs | null): Promise<void>;
}

export interface ReviewHandlers {
  pick(key: string, on: boolean): void;
  applyAll(): void;
  applyPicked(keys: readonly string[]): void;
  reject(): void;
}

/** The card's controls as requests (C13): Apply all names no change, Apply picked the ones picked in the card's order, No turns every waiting change down. */
export function reviewHandlers(chatId: ChatId, turn: string, io: ReviewIo): ReviewHandlers {
  const send = (body: ReviewBody) =>
    io.run(async () => {
      const result = await io.ask(body);
      if (!result) return;
      io.setPicked([]);
      await io.answered(result.cards, result.start ?? null);
    });
  return {
    pick: (key, on) => io.setPicked(on ? (io.picked.includes(key) ? io.picked : [...io.picked, key]) : io.picked.filter((k) => k !== key)),
    applyAll: () => send({ type: "lre.review", op: "apply", chatId, turn }),
    applyPicked: (keys) => {
      if (keys.length > 0) send({ type: "lre.review", op: "apply", chatId, turn, keys: [...keys] });
    },
    reject: () => send({ type: "lre.review", op: "reject", chatId, turn }),
  };
}

/** How an answered change stands, as its mark says it. */
const STATUS: Readonly<Record<Exclude<ReviewItemView["status"], "open">, { icon: IconName; words: string; tone: string }>> = {
  approved: { icon: "check", words: "Let through for the turn", tone: "lre-pos" },
  applied: { icon: "check", words: "Applied", tone: "lre-pos" },
  rejected: { icon: "minus", words: "Turned down", tone: "" },
  refused: { icon: "alert", words: "Refused", tone: "lre-neg" },
};

/** Who proposed a change, in words: the role that staged it, or the reply's read. */
function sourceWords(item: ReviewItemView): string {
  return item.source === "read" ? "From reading the reply" : agentLabel(item.role);
}

/**
 * The card: each change in plain words with who proposed it, its change type and key; while some wait,
 * a tick for each when there are several, Apply all, Apply picked and No; once answered, how each stood.
 */
export function ReviewCard(props: { card: ReviewCardView; picked: readonly string[]; busy: boolean; on: ReviewHandlers }) {
  const { card, on } = props;
  const open = card.items.filter((i) => i.status === "open");
  const several = open.length > 1;
  // In the card's order, whatever order they were ticked in.
  const picked = open.filter((i) => props.picked.includes(i.key)).map((i) => i.key);
  const gate = card.placement === "gate";
  return (
    <div class={props.busy ? "lre-chat-decision busy" : "lre-chat-decision"} data-kind="review" data-tone="warn" role="group" aria-label="Changes that ask first" data-lre-review={card.turn} data-lre-review-placement={card.placement}>
      {open.length > 0 ? (
        <span class="lre-chat-due">
          <Icon name="send" size={14} />
          {gate ? "The turn waits for your answer" : "Answer before you send"}
        </span>
      ) : null}
      <div class="lre-chat-decision-head">
        <Icon name="checklist" class="lre-chat-decision-icon" />
        <div class="lre-chat-decision-text">
          <strong class="lre-chat-decision-label">{open.length > 0 ? `${card.items.length === 1 ? "A change asks" : `${card.items.length} changes ask`} first` : "Changes that asked first"}</strong>
          <span class="lre-chat-decision-detail">{open.length === 0 ? "Answered." : gate ? "The reply waits until you answer: what you apply lands before it." : "The narrator isn't told of a change until you apply it."}</span>
        </div>
      </div>
      <div class="lre-gm-assist-ops" role="list">
        {card.items.map((item) => {
          const status = item.status === "open" ? null : STATUS[item.status];
          return (
            <div key={item.key} class="lre-gm-assist-op" role="listitem" data-lre-review-item={item.key} data-lre-review-status={item.status} data-lre-change-type={item.changeType}>
              {item.status === "open" && several ? (
                <label class="lre-check">
                  <input type="checkbox" aria-label={`Pick: ${item.lines[0] ?? humanize(item.changeType)}`} checked={picked.includes(item.key)} disabled={props.busy} onChange={(event) => on.pick(item.key, event.currentTarget.checked)} />
                </label>
              ) : status ? (
                <span class={`lre-gm-assist-op-mark ${status.tone}`.trim()} role="img" aria-label={status.words}>
                  <Icon name={status.icon} size={16} />
                </span>
              ) : null}
              <div class="lre-gm-assist-op-body">
                {(item.lines.length > 0 ? item.lines : [humanize(item.changeType)]).map((line, i) => (
                  <span key={i} class="lre-gm-assist-op-line">
                    {line}
                  </span>
                ))}
                <span class="lre-gm-assist-op-note">
                  {sourceWords(item)} · {humanize(item.changeType)}
                  {status ? ` · ${item.undone ? "Undone" : status.words}` : ""} <IdText id={item.key} />
                </span>
                {item.refused ? <span class="lre-gm-assist-op-note lre-neg">{item.refused.reason}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      {open.length > 0 ? (
        <div class="lre-chat-actions">
          <Button variant="primary" icon="check" disabled={props.busy} onClick={on.applyAll}>
            Apply all
          </Button>
          {several ? (
            <Button icon="checklist" disabled={props.busy || picked.length === 0} onClick={() => on.applyPicked(picked)}>
              {picked.length === 0 ? "Apply picked" : `Apply ${picked.length} picked`}
            </Button>
          ) : null}
          <Button variant="ghost" icon="close" disabled={props.busy} onClick={on.reject}>
            No
          </Button>
        </div>
      ) : (
        <Badge tone="neutral">{gate ? "Answered: the turn went on" : "Answered"}</Badge>
      )}
    </div>
  );
}

/**
 * Follows a chat's review cards: asks for them once (`lre.review get`) and hears their pushes from
 * then on. A push that came while `get` was out is newer than its answer; a `get` that failed with no
 * push since is `failed`, and a push afterwards clears it. Returns the stop.
 */
export function followReview(
  chatId: ChatId,
  io: { onReview(listener: (update: { chatId: ChatId; cards: ReviewCardView[] }) => void): () => void; get(): Promise<ResultBodies["lre.review"] | null> },
  out: { cards(cards: ReviewCardView[]): void; failed(failed: boolean): void },
): () => void {
  let live = true;
  let pushed = false;
  out.failed(false);
  const off = io.onReview((update) => {
    if (update.chatId !== chatId) return;
    pushed = true;
    out.failed(false);
    out.cards(update.cards);
  });
  void io.get().then((result) => {
    if (!live || pushed) return;
    if (result) out.cards(result.cards);
    else out.failed(true);
  });
  return () => {
    live = false;
    off();
  };
}

/** The card when the chat's cards couldn't be read (`lre.review get` failed): it says so, with Retry, so a turn waiting at its gate always has something to press. */
export function ReviewUnread(props: { onRetry(): void }) {
  return (
    <div class="lre-chat-decision" data-kind="review" data-tone="neg" role="group" aria-label="Changes that ask first" data-lre-review="unread">
      <div class="lre-chat-decision-head">
        <Icon name="alert" class="lre-chat-decision-icon" />
        <div class="lre-chat-decision-text">
          <strong class="lre-chat-decision-label">Couldn't read the changes that ask first</strong>
          <span class="lre-chat-decision-detail">The engine didn't answer with this turn's review card. Retry asks again; a turn waiting on the card goes on once you answer it.</span>
        </div>
      </div>
      <div class="lre-chat-actions">
        <Button variant="primary" icon="refresh" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}
