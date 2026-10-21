// Inferred checks (DESIGN §11) beside how checks are decided. For new chats (Settings → Checks):
// the user's own policy, or none, so each new chat plays by its realism preset and Sheets level; it
// fills in for a world that sets none, or replaces a world's under the same "Use my check rules"
// switch. For this chat (GM → This chat → Checks): the policy in force, changed through an `infer`
// marker after its preview.

import { useState } from "preact/hooks";
import { inferredDefaults, INFER_MODE_LABEL, type InferredChecks, type SheetSkill } from "../../shared/inferred";
import type { JsonObject } from "../../shared/json";
import type { MarkerPreview } from "../../shared/protocol";
import type { UserSettings } from "../../shared/settings";
import type { ControlsView } from "../../shared/state-view";
import { useApp } from "../app";
import { Banner, Button, Seg, useBusy } from "../components";
import { InferredForm } from "../inferred-form";
import { inferMarker, type Req } from "../requests";

type Source = "realism" | "mine";

const SOURCES: readonly { value: Source; label: string }[] = [
  { value: "realism", label: "By the chat's realism" },
  { value: "mine", label: "My own" },
];

/** The user's setting for new chats; `skills` is the open world chat's sheet's, the only sheet Settings knows. */
export function InferredSeed(props: { settings: UserSettings; skills: readonly SheetSkill[]; busy: boolean; patch(patch: JsonObject): void }) {
  const { inferred, realism, overrideWorldAdjudication } = props.settings;
  // "My own" starts from what your realism defaults would play, so the first pick changes one thing.
  const start = inferredDefaults(realism.preset, realism.levels.sheets);
  const where = overrideWorldAdjudication ? "New chats read typed attempts this way, whatever their world sets." : "New chats read them as their world sets; this applies where a world sets none.";
  return (
    <div class="lre-stack" data-lre-inferred="seed">
      <div class="lre-field">
        <span class="label">Inferred checks for new chats</span>
        {/* Null is the setting's own value, not a policy: each new chat works it out from its own realism. */}
        <Seg<Source> label="Inferred checks for new chats" value={inferred === null ? "realism" : "mine"} options={SOURCES} disabled={props.busy} onChange={(source) => props.patch({ inferred: source === "realism" ? null : (start as unknown as JsonObject) })} />
        <span class="lre-field-help">{inferred === null ? "Each new chat plays by its realism preset and Sheets level: Story offers a roll, Grounded rolls risky attempts, Simulation rolls every uncertain one." : where}</span>
      </div>
      {inferred !== null ? (
        <InferredForm
          value={inferred}
          skills={props.skills}
          skillsHelp={props.skills.length > 0 ? "Skills are picked from the open chat's world's sheet; a world whose sheet has none of them reads no attempt as a check." : "Open a world chat to pick from its sheet's skills."}
          disabled={props.busy}
          // The whole policy goes as one value, so a skills list replaces the one before.
          onChange={(next) => props.patch({ inferred: next as unknown as JsonObject })}
        />
      ) : null}
    </div>
  );
}

/** The `infer` marker a change in GM → This chat → Checks sends (its preview first, with `preview`), or null when it is the policy already in force. */
export function chatInferChange(chatId: string, current: InferredChecks, next: InferredChecks, preview = false): Req<"lre.marker"> | null {
  if (JSON.stringify(current) === JSON.stringify(next)) return null;
  const marker = inferMarker(chatId, next);
  return preview ? { ...marker, preview: true } : marker;
}

/** The running chat's policy, editable; a change shows what it does, then applies with one tap from the next turn. GM → This chat shows it only for a world chat, under how its checks are decided. */
export function InferredThisChat(props: { chatId: string; controls: ControlsView }) {
  const app = useApp();
  const [draft, setDraft] = useState<InferredChecks | null>(null);
  const [preview, setPreview] = useState<MarkerPreview | null>(null);
  const [busy, run] = useBusy();
  const current = props.controls.inferred;
  const next = draft ?? current;
  const change = chatInferChange(props.chatId, current, next);
  const cancel = () => {
    setDraft(null);
    setPreview(null);
  };
  const review = () =>
    run(async () => {
      const ask = chatInferChange(props.chatId, current, next, true);
      const result = ask ? await app.request(ask) : null;
      if (result) setPreview(result.preview ?? { lines: [] });
    });
  const apply = () =>
    run(async () => {
      const result = change ? await app.request(change) : null;
      if (result) {
        app.toast(result.pending ? "Saved — the change applies when the reply finishes." : `This chat reads typed attempts as checks this way (${INFER_MODE_LABEL[next.mode].toLowerCase()}) from the next turn.`, "info");
        cancel();
      }
    });
  return (
    <div class="lre-stack" data-lre-inferred="chat">
      <div class="lre-gm-subtitle">Inferred checks</div>
      <p class="lre-gm-note">How a typed attempt no action covers is read as a check of this world's sheet. A change applies from the next turn; earlier turns keep how theirs were read.</p>
      {preview && change ? (
        <Banner
          tone="info"
          title="Inferred checks for this chat"
          actions={
            <>
              <Button variant="primary" busy={busy} onClick={apply}>
                Apply to this chat
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>
                Keep editing
              </Button>
            </>
          }
        >
          <ul class="lre-gm-preview-lines" data-lre-inferred-preview>
            {preview.lines.map((line, i) => (
              <li key={i}>{line.text}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      <InferredForm
        value={next}
        skills={props.controls.skills}
        skillsHelp="The skills this chat's world's sheet has."
        disabled={busy || preview !== null}
        onChange={(edited) => {
          setDraft(edited);
          setPreview(null);
        }}
      />
      {change && !preview ? (
        <div class="lre-inline">
          <Button variant="primary" busy={busy} onClick={review}>
            Review the change
          </Button>
          <Button variant="ghost" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
