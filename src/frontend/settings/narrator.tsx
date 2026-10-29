// Settings → Narrator (DESIGN §6.11): the user's default for the narrator's knowledge (whose
// knowledge it gets, and what of a secret), which a world's default and a chat's own choice come
// before. How a secret is marked, and what the narrator is told a mark means, are texts of the prompt
// registry (Settings → Agents → Prompts → Final output, Secret marks, §6.12), which the page points to.
// The view's control is the one Build → World and GM → This chat → Knowledge use (`NarratorViewControl`).

import type { JsonObject } from "../../shared/json";
import type { NarratorKnowledge, NarratorSecrets, NarratorView } from "../../shared/settings";
import { NARRATOR_KNOWLEDGE, NARRATOR_KNOWLEDGE_LABEL, NARRATOR_SECRETS, NARRATOR_SECRETS_LABEL } from "../../shared/settings";
import { Section, Seg } from "../components";

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

export function NarratorPage(props: { narrator: NarratorView; patch(patch: JsonObject): void; busy: boolean }) {
  const { narrator, busy } = props;
  return (
    <div class="lre-stack lre-minds-set" data-lre-settings-page="narrator">
      <p class="lre-set-lead">What the narrator is told each turn: whose knowledge, and what of a secret.</p>
      <Section>
        <div class="lre-minds-body">
          <NarratorViewControl value={narrator} disabled={busy} onChange={(next) => props.patch({ narrator: { knowledge: next.knowledge, secrets: next.secrets } })} />
          <p class="lre-minds-note">This is your default. A world's own (Build → World) and a chat's own choice (GM → This chat → Knowledge) come before it. A change applies from each chat's next turn.</p>
          <p class="lre-minds-note" data-lre-mark-wording>
            How a secret is marked, and what the narrator is told a mark means, are yours to word in Settings → Agents → Prompts → Final output, under Secret marks.
          </p>
        </div>
      </Section>
    </div>
  );
}
