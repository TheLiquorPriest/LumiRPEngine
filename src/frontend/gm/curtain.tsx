// The GM curtain as it shows (contract §4.5, principle 6): the gate in front of the truth, and the
// strip over a page while the truth shows, with Hide. Both wear GM gold, which marks GM chrome only.

import { Button } from "../components";
import { Icon } from "../icons";

/** In front of every page that shows the truth while the gate is closed; nothing behind it is asked for or drawn. */
export function Gate(props: { onReveal(): void }) {
  return (
    <div class="lre-gm-gate" data-lre-gm-gate>
      <span class="lre-gm-gate-icon">
        <Icon name="eye-off" size={24} />
      </span>
      <h2 class="lre-gm-gate-title">Spoilers ahead</h2>
      <p class="lre-gm-gate-text">GM mode shows and edits everything: secrets, hidden agendas, unrevealed truths, removed people and everyone's money. Each edit is a correction with its own Undo.</p>
      <Button variant="primary" icon="eye" onClick={props.onReveal}>
        Show the truth
      </Button>
      <p class="lre-gm-gate-note">This chat's rules and the Inspector don't need it.</p>
    </div>
  );
}

/** Over each page that shows the truth while it does: Hide closes the gate again. */
export function TruthBar(props: { onHide(): void }) {
  return (
    <div class="lre-gm-truthbar" role="status" data-lre-gm-truthbar>
      <Icon name="eye" />
      <span class="lre-gm-truthbar-text">The truth is showing</span>
      <Button variant="ghost" size="sm" icon="eye-off" onClick={props.onHide}>
        Hide
      </Button>
    </div>
  );
}
