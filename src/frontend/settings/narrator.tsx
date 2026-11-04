// Settings → Narrator (DESIGN §6.11): the user's default for the narrator's knowledge (whose
// knowledge it gets, and what of a secret), which a world's default and a chat's own choice come
// before. How a secret is marked, and what the narrator is told a mark means, are texts of the prompt
// registry (Settings → Agents → Prompts → Final output, Secret marks, §6.12), which the page points to.
// The view's control is the one Build → World and GM → This chat → Knowledge use (`NarratorViewControl`).
// Out-of-play actions (DESIGN §11): which money, organization and Gear → Manage actions done at once
// the next reply is told of, by group, and from what amount a payment to someone else is; with a
// reset to the shipped defaults (`OffstageControl`, hook-free).

import type { JsonObject } from "../../shared/json";
import type { NarratorKnowledge, NarratorSecrets, NarratorView } from "../../shared/settings";
import { NARRATOR_KNOWLEDGE, NARRATOR_KNOWLEDGE_LABEL, NARRATOR_SECRETS, NARRATOR_SECRETS_LABEL } from "../../shared/settings";
import { OFFSTAGE_DEFAULTS, OFFSTAGE_GROUP_HELP, OFFSTAGE_GROUP_LABEL, OFFSTAGE_GROUPS, type OffstageGroup, type OffstageSettings } from "../../shared/offstage";
import { Button, HostSwitch, Section, Seg } from "../components";

const KNOWLEDGE_CHOICES = NARRATOR_KNOWLEDGE.map((value) => ({ value, label: NARRATOR_KNOWLEDGE_LABEL[value] }));
const SECRETS_CHOICES = NARRATOR_SECRETS.map((value) => ({ value, label: NARRATOR_SECRETS_LABEL[value] }));

const KNOWLEDGE_HELP: Record<NarratorKnowledge, string> = {
  scene: "What every person in the scene knows, with what your character doesn't know marked for the narrator.",
  pov: "Only what your character knows.",
};

const SECRETS_HELP: Record<NarratorSecrets, string> = {
  marked: "A line carrying a secret's words goes in marked as a secret, with whom it is known to or kept from.",
  omit: "A line carrying a secret's words is left out.",
};

/** A view in a few words, for a summary row: "Everyone in the scene · secrets marked". */
export function narratorViewSummary(view: NarratorView): string {
  return `${NARRATOR_KNOWLEDGE_LABEL[view.knowledge]} · secrets ${NARRATOR_SECRETS_LABEL[view.secrets].toLowerCase()}`;
}

/**
 * The narrator's knowledge (DESIGN §6.11): whose knowledge it gets and what of a secret. The one
 * control for a view in all three places it is set (Settings → Narrator, Build → World, GM → This
 * chat → Knowledge), so each reads the same.
 */
export function NarratorViewControl(props: { value: NarratorView; disabled?: boolean; onChange(next: NarratorView): void }) {
  const { knowledge, secrets } = props.value;
  return (
    <div class="lre-stack" data-lre-narrator-view>
      <div class="lre-field">
        <span class="label">Whose knowledge the narrator gets</span>
        <Seg<NarratorKnowledge> label="Whose knowledge the narrator gets" value={knowledge} options={KNOWLEDGE_CHOICES} disabled={props.disabled} onChange={(next) => props.onChange({ knowledge: next, secrets })} />
        <span class="lre-field-help">{KNOWLEDGE_HELP[knowledge]}</span>
      </div>
      <div class="lre-field">
        <span class="label">Secrets</span>
        <Seg<NarratorSecrets> label="Secrets" value={secrets} options={SECRETS_CHOICES} disabled={props.disabled} onChange={(next) => props.onChange({ knowledge, secrets: next })} />
        <span class="lre-field-help">{SECRETS_HELP[secrets]}</span>
      </div>
    </div>
  );
}

/** Whether the out-of-play settings are the shipped defaults. */
export function offstageIsDefault(offstage: Readonly<OffstageSettings>): boolean {
  return offstage.paymentsFrom === OFFSTAGE_DEFAULTS.paymentsFrom && OFFSTAGE_GROUPS.every((g) => offstage.tell[g] === OFFSTAGE_DEFAULTS.tell[g]);
}

/** The settings patch for one group's switch, the payments amount, or the reset of them all. */
export function offstagePatch(change: { group: OffstageGroup; tell: boolean } | { paymentsFrom: number } | "reset"): JsonObject {
  if (change === "reset") return { offstage: { tell: { ...OFFSTAGE_DEFAULTS.tell }, paymentsFrom: OFFSTAGE_DEFAULTS.paymentsFrom } };
  if ("group" in change) return { offstage: { tell: { [change.group]: change.tell } } };
  return { offstage: { paymentsFrom: Math.max(0, Math.round(change.paymentsFrom)) } };
}

/**
 * Out-of-play actions (DESIGN §11): a switch per group for whether the next reply is told of an
 * action done at once, the amount from which a payment to someone else is told, and Reset. Each
 * action's chip starts from these; what was chosen is kept on the action.
 */
export function OffstageControl(props: { offstage: OffstageSettings; disabled?: boolean; patch(patch: JsonObject): void }) {
  const { offstage } = props;
  return (
    <div class="lre-stack" data-lre-offstage-settings>
      <p class="lre-minds-note">A money or organization action you tap with no words (and Gear → Manage's) is done at once, off screen: no message, no turn, no time, with its Undo. Told, the next reply mentions it as done; not told, it's bookkeeping the story doesn't hear of. Words, or Send now, still play it as a turn.</p>
      {OFFSTAGE_GROUPS.map((g) => (
        <div key={g} class="lre-field" data-lre-offstage-group={g}>
          <HostSwitch label={`Tell: ${OFFSTAGE_GROUP_LABEL[g]}`} checked={offstage.tell[g]} disabled={props.disabled} onChange={(tell) => props.patch(offstagePatch({ group: g, tell }))} />
          <span class="lre-field-help">{OFFSTAGE_GROUP_HELP[g]}</span>
        </div>
      ))}
      {offstage.tell.payments ? (
        <label class="lre-field" data-lre-offstage-payments>
          <span class="label">Tell payments to others from</span>
          <input type="number" class="lre-input" min={0} step={1} value={offstage.paymentsFrom} disabled={props.disabled} onChange={(e) => props.patch(offstagePatch({ paymentsFrom: Number((e.currentTarget as HTMLInputElement).value) || 0 }))} />
          <span class="lre-field-help">{offstage.paymentsFrom > 0 ? `In whole units of the chat's money: a payment below ${offstage.paymentsFrom} is bookkeeping.` : "0 tells every payment to someone else, at any amount."}</span>
        </label>
      ) : null}
      <p class="lre-minds-note">Each action's chip offers Tell or Don't tell until the next turn while nothing was done after it, starting from these; what you chose is kept on the action, so a later change here leaves it alone.</p>
      {offstageIsDefault(offstage) ? null : (
        <div class="lre-row">
          <Button variant="ghost" disabled={props.disabled} onClick={() => props.patch(offstagePatch("reset"))}>
            Reset to defaults
          </Button>
        </div>
      )}
    </div>
  );
}

export function NarratorPage(props: { narrator: NarratorView; statePrices: boolean; offstage: OffstageSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { narrator, busy } = props;
  return (
    <div class="lre-stack lre-minds-set" data-lre-settings-page="narrator">
      <p class="lre-set-lead">What the narrator is told each turn: whose knowledge, what of a secret, and the prices the engine charges.</p>
      <Section>
        <div class="lre-minds-body">
          <NarratorViewControl value={narrator} disabled={busy} onChange={(next) => props.patch({ narrator: { knowledge: next.knowledge, secrets: next.secrets } })} />
          <p class="lre-minds-note">This is your default. A world's own (Build → World) and a chat's own choice (GM → This chat → Knowledge) come before it. A change applies from each chat's next turn.</p>
          <p class="lre-minds-note" data-lre-mark-wording>
            How a secret is marked, and what the narrator is told a mark means, are yours to word in Settings → Agents → Prompts → Final output, under Secret marks.
          </p>
        </div>
      </Section>
      <Section title="Prices">
        <div class="lre-field" data-lre-state-prices>
          <HostSwitch label="The narrator states prices" checked={props.statePrices} disabled={busy} onChange={(statePrices) => props.patch({ statePrices })} />
          <span class="lre-field-help">
            {props.statePrices
              ? "The Money section lists what is sold where your character is, at the price the engine charges there today, and the narrator is told to state the engine's price whenever a purchase or a price comes up: that price, or what a purchase this turn cost. Its words are yours in Settings → Agents → Prompts → Final output, under Narrator rules."
              : "The narrator gets no prices and isn't told to state them. Purchases are still priced and charged as ever."}
          </span>
        </div>
      </Section>
      <Section title="Out-of-play actions">
        <OffstageControl offstage={props.offstage} disabled={busy} patch={props.patch} />
      </Section>
    </div>
  );
}
