// Settings → Writes (under Agents): what happens to a change the player makes while the engine works
// on a turn before its reply (DESIGN §4.3 P2). One made while the reply streams always waits for it;
// a GM agent's writes and workspace saves wait for the turn whatever this says.

import type { JsonObject } from "../../shared/json";
import { HostSwitch, Section } from "../components";

export function WritesPage(props: { holdWrites: boolean; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <div class="lre-stack" data-lre-settings-page="writes">
      <p class="lre-set-lead">What happens to a change you make while the engine works on a turn, before its reply starts. One you make while the reply is being written always waits for it.</p>
      <Section title="While the engine runs">
        <div class="lre-field" data-lre-hold-writes>
          <HostSwitch label="Hold writes during the engine run" checked={props.holdWrites} disabled={props.busy} onChange={(holdWrites) => props.patch({ holdWrites })} />
          <span class="lre-field-help">
            {props.holdWrites
              ? "A chip you answer, a ✎ fix or any other change you make then waits for the turn and lands once its reply is in, over whatever the turn did, and the reply starts as planned. If the turn stops without a reply, it lands then."
              : "A chip you answer, a ✎ fix or any other change you make then lands at once, and the turn's reply doesn't start: the chat says so, and Retry runs the engine again with your change."}
          </span>
        </div>
      </Section>
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        A GM agent's changes and workspace saves always wait for the turn. Editing or deleting a message still stops the turn's reply, whatever this says.
      </p>
    </div>
  );
}
