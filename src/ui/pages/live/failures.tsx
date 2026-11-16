// What is told to a chat outside any run, as the Live page draws it (plan §14, §17.2 "failure is visible",
// §18.4): an engine handler that failed on a change, with its time, the turn, the change and the handler's
// words, and a link to that turn's page. It shows whether a run goes on or not, and stays until it is
// dismissed.

import { Banner, Button } from "../../atoms";
import type { FailureShown } from "../../live-watch";
import { clock } from "../../words";

export function FailureLines(props: { failures: readonly FailureShown[]; onOpenTurn(turn: string): void; onDismiss(seq: number): void }) {
  if (props.failures.length === 0) return null;
  return (
    <div class="lre-stack" data-failures>
      {props.failures.map((failure) => (
        <Banner
          key={failure.seq}
          tone="neg"
          icon="alert"
          title={`A handler failed at ${clock(failure.at)}`}
          actions={
            <span class="lre-inline">
              <Button small onClick={() => props.onOpenTurn(failure.turn)}>
                Its turn's page
              </Button>
              <Button small kind="ghost" onClick={() => props.onDismiss(failure.seq)}>
                Dismiss
              </Button>
            </span>
          }
        >
          <span data-failure={failure.seq}>
            {failure.op}
            {failure.change === null ? "" : `, change ${failure.change}`} on turn {failure.turn}: {failure.error}
          </span>
        </Banner>
      ))}
    </div>
  );
}
