// Settings → Replies: what the engine may change from a reply's text, per type
// (Auto, Confirm or Never, with where the mode comes from and Unpin, D4 learning), and what a swipe
// does by default.

import type { JsonObject } from "../../shared/json";
import type { BoundMode } from "../../shared/ids";
import type { ExtractionModeView, SettingsResult } from "../../shared/protocol";
import { EXTRACTION_TYPES } from "../../shared/settings";
import type { ExtractionType } from "../../shared/settings";
import { Button, Section, Seg } from "../components";

const EXTRACTION_LABEL: Record<ExtractionType, string> = {
  time_advance: "Time passing",
  location: "Moving somewhere",
  condition: "Conditions (hurt, tired…)",
  knows: "Learning a fact",
  give: "Giving things",
  purchase: "Purchases",
  transfer: "Money transfers",
  regard: "Feelings toward others",
  quantity: "Quantities",
  spawn: "New people",
  life: "Life and death (dying, dead, collapsed…)",
  routine: "Routines (a new job, a habit, a move…)",
};

const MODE_OPTIONS: { value: BoundMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "confirm", label: "Confirm" },
  { value: "never", label: "Never" },
];

/** Where an effective mode comes from, in words (D4 learning precedence). */
export function modeSource(view: ExtractionModeView): string {
  switch (view.source) {
    case "pinned":
      return "Pinned by you";
    case "learned":
      return `Learned on ${view.connection?.name ?? "this connection"} (${view.accepted} kept, ${view.rejected} rejected)`;
    case "default":
      return view.accepted + view.rejected > 0 ? `Default · learning (${view.accepted} kept, ${view.rejected} rejected)` : "Default";
    case "bound":
      return "From the field's bound";
  }
}

export function ExtractionPage(props: { data: SettingsResult; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <div class="lre-stack" data-lre-settings-page="extraction">
      <p class="lre-set-lead">What the engine may change from the reply's text. Auto applies it, Confirm asks you first under the reply, Never leaves it alone.</p>
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        Setting a mode pins it. A type you haven't pinned learns from your confirms and undos on each connection.
      </p>
      <Section flush>
        <div class="lre-set-rows">
          {EXTRACTION_TYPES.map((type) => {
            const view = props.data.extraction[type];
            if (!view) return null;
            return (
              <div key={type} class="lre-set-ext" data-lre-extraction={type}>
                <div class="lre-set-ext-head">
                  <span class="lre-set-ext-title">{EXTRACTION_LABEL[type]}</span>
                  {view.source === "pinned" ? (
                    <Button size="sm" variant="ghost" icon="undo" label={`Unpin ${EXTRACTION_LABEL[type]} and let it learn`} disabled={props.busy} onClick={() => props.patch({ extraction: { [type]: null } })}>
                      Unpin
                    </Button>
                  ) : null}
                </div>
                <Seg<BoundMode> label={EXTRACTION_LABEL[type]} value={view.mode} options={MODE_OPTIONS} disabled={props.busy} onChange={(mode) => props.patch({ extraction: { [type]: { mode } } })} />
                <span class={view.source === "learned" ? "lre-small lre-pos" : "lre-small lre-muted"}>{modeSource(view)}</span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

const SWIPE_HELP: Record<"rerun" | "renarrate", string> = {
  rerun: "A plain swipe plays the turn again with a fresh roll, so a failed check can succeed.",
  renarrate: "A plain swipe keeps everything the engine decided (the same dice, outcome and events) and only asks for new prose.",
};

export function SwipesPage(props: { value: "rerun" | "renarrate"; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <div class="lre-stack" data-lre-settings-page="swipes">
      <p class="lre-set-lead">What a plain swipe on a reply does. The Swipe as… chip under a reply still offers Re-run and Re-narrate for a single swipe.</p>
      <Section title="By default">
        <div class="lre-stack">
          <Seg<"rerun" | "renarrate">
            label="Swipe default"
            value={props.value}
            options={[
              { value: "rerun", label: "Re-run (new roll)" },
              { value: "renarrate", label: "Re-narrate (same outcome)" },
            ]}
            disabled={props.busy}
            onChange={(swipeDefault) => props.patch({ swipeDefault })}
          />
          <p class="lre-small lre-muted" style={{ margin: 0 }}>
            {SWIPE_HELP[props.value]}
          </p>
        </div>
      </Section>
    </div>
  );
}
