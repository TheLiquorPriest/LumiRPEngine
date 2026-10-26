// How checks are decided (DESIGN §11). For new chats (Settings → Checks): the user's own policy,
// which fills in for a world that sets none (or replaces a world's, with the switch on). For this
// chat (GM → This chat → Checks): the policy in force in the running chat, changed through an
// `adjudicate` marker.

import { useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { UserSettings } from "../../shared/settings";
import type { ControlsView } from "../../shared/state-view";
import type { AdjudicationDef } from "../../shared/world";
import { useApp } from "../app";
import { AdjudicationForm } from "../adjudication-form";
import { Button, Empty, HostSwitch, useBusy } from "../components";
import { adjudicateMarker } from "../requests";

export function AdjudicationSeed(props: { settings: UserSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const mine = props.settings.overrideWorldAdjudication;
  return (
    <div class="lre-stack" data-lre-adjudication="seed">
      <div class="lre-field">
        <HostSwitch label="Use my check rules instead of a world's for new chats" checked={mine} disabled={props.busy} onChange={(checked) => props.patch({ overrideWorldAdjudication: checked })} />
        <span class="lre-field-help">{mine ? "New chats decide checks this way, whatever their world sets." : "New chats decide checks as their world sets; these rules apply where a world sets none."}</span>
      </div>
      {/* The whole policy goes as one value: a named preset as its own values, Custom as edited. */}
      <AdjudicationForm value={props.settings.adjudication} disabled={props.busy} onChange={(next) => props.patch({ adjudication: next as unknown as JsonObject })} />
    </div>
  );
}

/** The running chat's policy, editable; a change is applied with one tap and takes effect from the next turn. */
export function AdjudicationThisChat(props: { chatId: string; controls: ControlsView | null }) {
  const app = useApp();
  const [draft, setDraft] = useState<AdjudicationDef | null>(null);
  const [busy, run] = useBusy();
  if (!props.controls) return <Empty icon="dice">Open a world chat to change how its checks are decided.</Empty>;
  const current = props.controls.adjudication;
  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(current);
  const apply = () =>
    run(async () => {
      if (!draft) return;
      const result = await app.request(adjudicateMarker(props.chatId, draft));
      if (result) {
        app.toast(result.pending ? "Saved — the change applies when the reply finishes." : "This chat decides checks this way from the next turn.", "info");
        setDraft(null);
      }
    });
  return (
    <div class="lre-stack" data-lre-adjudication="chat">
      <p class="lre-gm-note">The rules in force in this chat. A change applies from the next turn; earlier turns keep how theirs were decided.</p>
      <AdjudicationForm value={draft ?? current} disabled={busy} onChange={setDraft} />
      {changed ? (
        <div class="lre-inline">
          <Button variant="primary" busy={busy} onClick={apply}>
            Apply to this chat
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
