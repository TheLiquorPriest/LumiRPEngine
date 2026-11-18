import type { CardChange, CardQuestion, ReviewCardReply } from "../../../../shared/api";
import { Badge, Banner, Button, Disclosure, Pre } from "../../../../frontend/components";
import { when } from "../../../words";
import { valueWords } from "../changes";
import { madeWords } from "../../../marks";
import type { ReviewShown } from "../review";
import type { TurnSection } from "../types";

const LANE_WORDS: Readonly<Record<string, string>> = { story: "The story's changes", engine: "The engine's changes" };

/** Where a question stands, in words, with his answer once given. */
export function questionWords(q: CardQuestion): string {
  if (q.state === "waiting") return "waits for your word";
  if (q.state === "taken_down") return "was taken down when the turn stopped";
  return q.answer === null ? "was answered" : q.answer.go ? "went ahead on your word" : `did not go ahead${q.answer.reason === undefined ? "" : `: ${q.answer.reason}`}`;
}

function CardChangeLine(props: { change: CardChange; dropped: boolean; busy: string | null; onUndo(change: string): void }) {
  const { change } = props;
  const undone = change.undoneBy.length > 0;
  return (
    <li class="rpe-entry lre-stack" data-card-change={change.id} data-applied={change.applied ? "yes" : "no"}>
      <p class="rpe-line">
        <span class="rpe-strong">{change.words}</span> {change.applied ? <Badge tone="pos">applied</Badge> : props.dropped ? <Badge tone="warn">dropped</Badge> : <Badge tone="warn">held</Badge>}
        {undone ? <Badge>undone</Badge> : null}
      </p>
      <p class="rpe-meta">
        {madeWords(change)}
        {undone ? " It has been undone since." : ""}
      </p>
      {change.reportWords.length === 0 ? null : (
        <ul class="rpe-reports">
          {change.reportWords.map((words, i) => (
            <li key={i}>{words}</li>
          ))}
        </ul>
      )}
      {undone || !change.applied ? null : (
        <div class="lre-inline rpe-wrap">
          <Button size="sm" variant="ghost" busy={props.busy === change.id} disabled={change.undo.ops.length === 0} onClick={() => props.onUndo(change.id)}>
            Undo it
          </Button>
          <span class="rpe-meta" data-undo>
            {[change.undo.words, ...change.undo.leftWords].filter((said) => said !== "").join(" ")}
          </span>
        </div>
      )}
      <Disclosure summary="The record as written" class="rpe-record">
        <div class="lre-stack" data-record>
          <p class="rpe-line">
            <span class="rpe-strong">{change.op}</span> {valueWords(change.value)}
          </p>
          {change.reports.map((r, i) => (
            <p key={i} class="rpe-meta">
              {r.code}
              {r.values === undefined ? "" : `: ${valueWords(r.values)}`}
            </p>
          ))}
          <p class="rpe-meta">
            {change.undo.ops.length === 0 ? "No reversal is kept." : `Undo records: ${change.undo.ops.join(", ")}.`}
            {change.undo.left.length === 0 ? "" : ` Left as it is: ${change.undo.left.map((r) => r.code).join(", ")}.`}
            {undone ? ` Reversed by ${change.undoneBy.join(", ")}.` : ""}
          </p>
        </div>
      </Disclosure>
    </li>
  );
}

function QuestionLine(props: { question: CardQuestion; busy: string | null; onAnswer(question: string, go: boolean): void }) {
  const q = props.question;
  return (
    <li class="rpe-entry lre-stack" data-question={q.id} data-state={q.state}>
      <p class="rpe-line">
        <span class="rpe-strong">{q.agent}</span> asked to call {q.tool} <Badge>{q.lane}</Badge> {when(q.asked)}: it {questionWords(q)}.
      </p>
      <Pre text={valueWords(q.args)} />
      {q.state !== "waiting" ? null : (
        <div class="lre-inline rpe-wrap">
          <Button size="sm" busy={props.busy === q.id} onClick={() => props.onAnswer(q.id, true)}>
            Let it go ahead
          </Button>
          <Button size="sm" variant="ghost" busy={props.busy === q.id} onClick={() => props.onAnswer(q.id, false)}>
            Do not
          </Button>
        </div>
      )}
    </li>
  );
}

/** A turn's one review card: whether the turn was dropped with nothing saved, its changes by lane, each held, applied or dropped, with its undo; the questions asked on it, those waiting first, each answered here as in the chat; and the cards an earlier engine kept. */
export function ReviewCard(props: { card: ReviewCardReply; review: Pick<ReviewShown, "busy" | "said" | "onUndo" | "onAnswer"> }) {
  const { card, review } = props;
  return (
    <div class="lre-stack" data-review-card={card.turn}>
      {review.said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{review.said}</span>
        </Banner>
      )}
      {card.dropped ? (
        <Banner tone="warn" icon="alert" title="Nothing of this turn stands">
          <span data-dropped>It ended with nothing of its reply saved, so the changes it had made were dropped with it.</span>
        </Banner>
      ) : null}
      {card.lanes.map(({ lane, changes }) => (
        <div key={lane} class="lre-stack" data-lane={lane}>
          <span class="rpe-caption">{LANE_WORDS[lane] ?? `The ${lane} lane`}</span>
          {changes.length === 0 ? (
            <p class="rpe-meta">The turn changed nothing there.</p>
          ) : (
            <ul class="rpe-plain lre-stack">
              {changes.map((change) => (
                <CardChangeLine key={change.id} change={change} dropped={card.dropped} busy={review.busy} onUndo={review.onUndo} />
              ))}
            </ul>
          )}
        </div>
      ))}
      {card.questions.length === 0 ? null : (
        <div class="lre-stack" data-questions>
          <span class="rpe-caption">Questions asked on it</span>
          <ul class="rpe-plain lre-stack">
            {card.questions.map((q) => (
              <QuestionLine key={q.id} question={q} busy={review.busy} onAnswer={review.onAnswer} />
            ))}
          </ul>
        </div>
      )}
      {card.imported.length === 0 ? null : (
        <div class="lre-stack" data-imported>
          <span class="rpe-caption">Cards the earlier engine kept for it</span>
          <ul class="rpe-plain lre-stack">
            {card.imported.map((c) => (
              <li key={c.id} class="rpe-entry lre-stack" data-imported-card={c.id}>
                <p class="rpe-line">
                  <span class="rpe-strong">{c.kind}</span> {when(c.at)}
                </p>
                <Pre text={valueWords(c.data)} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const section: TurnSection = {
  id: "review",
  order: 102,
  title: "The review card",
  spoiler: true,
  body: ({ review }) => {
    if (review === undefined) return null;
    if (review.card === null) return review.problem === null ? <p class="lre-muted rpe-line">{review.loading ? "Reading the card…" : "No card is read."}</p> : <p class="rpe-line" data-problem>{review.problem}</p>;
    return <ReviewCard card={review.card} review={review} />;
  },
};
