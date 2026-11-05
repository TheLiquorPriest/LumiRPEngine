// The ask before a swipe's reply starts (Build C item 1). With Settings → Swipes → Ask what should
// change on each swipe on, a host swipe the backend prepared opens this sheet first (restart.ts):
// Swipe sends what the player typed with the turn's claim, Swipe as it is (or closing the sheet)
// sends nothing, and the reply starts either way. Only the narrator reads the answer, for that
// telling alone; the backend trims it and makes it safe to send (`swipeDirectionOf`).
// `SwipeAskForm` is hook-free, so tests press it without a DOM. Styles: the shared form look.

import { render } from "preact";
import type { SpindleModalHandle } from "lumiverse-spindle-types";
import { SWIPE_DIRECTION_CHARS } from "../shared/prompts";
import type { HostUi } from "../spindle-augment";
import { Button, Field } from "./components";

/** The sheet's title: what it asks. */
export const SWIPE_ASK_TITLE = "What should change?";

/** The ask, without hooks: the text kept in `draft` as it is typed; Swipe answers with it, Swipe as it is with none. */
export function SwipeAskForm(props: { draft: { text: string }; onAnswer(direction: string): void }) {
  return (
    <form
      class="lre-stack"
      data-lre-swipe-ask
      onSubmit={(event) => {
        event.preventDefault();
        props.onAnswer(props.draft.text.trim());
      }}
    >
      <Field label="For the narrator (optional)" help="A word or two on how this telling should differ. Only the narrator reads it, for this swipe alone; leave it empty and the swipe goes ahead as it is.">
        <textarea
          class="lre-input"
          aria-label={SWIPE_ASK_TITLE}
          rows={3}
          maxLength={SWIPE_DIRECTION_CHARS}
          onInput={(event) => {
            props.draft.text = event.currentTarget.value;
          }}
          autoFocus
        />
      </Field>
      <div class="lre-inline">
        <Button type="submit" variant="primary" icon="refresh">
          Swipe
        </Button>
        <Button variant="ghost" onClick={() => props.onAnswer("")}>
          Swipe as it is
        </Button>
      </div>
    </form>
  );
}

/**
 * Opens the sheet in the host's modal and answers what the player asked: "" for none (Swipe as it
 * is, or the sheet closed). A sheet the host can't open answers none, so the reply never waits on it.
 */
export function askSwipeDirection(ui: Pick<HostUi, "showModal">): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let modal: SpindleModalHandle;
  try {
    modal = ui.showModal({ title: SWIPE_ASK_TITLE });
  } catch {
    resolve("");
    return promise;
  }
  let open = true;
  let answered = false;
  const answer = (direction: string): void => {
    if (answered) return;
    answered = true;
    resolve(direction);
    if (open) modal.dismiss();
  };
  modal.onDismiss(() => {
    open = false;
    render(null, modal.root);
    answer("");
  });
  render(
    <div class="lre">
      <SwipeAskForm draft={{ text: "" }} onAnswer={answer} />
    </div>,
    modal.root,
  );
  return promise;
}
