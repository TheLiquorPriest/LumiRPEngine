// The world's policies as Build's forms set them: what the narrator is given of secrets in your lore (the secrecy answer, DESIGN §6.11)
// and the ruleset's realism floors in words. The player-claims control (DESIGN §9.4), which the World page shares, is
// `../claims-control.tsx`. Each control is the one place its policy is drawn, so every form that sets it reads the same.

import { DOMAIN_LABEL, DOMAINS } from "../../shared/ids";
import type { DomainId, Level } from "../../shared/ids";
import type { NarratorKnowledge, NarratorSecrets, NarratorView } from "../../shared/narrator-view";
import { NARRATOR_KNOWLEDGE, NARRATOR_SECRETS } from "../../shared/narrator-view";
import { Seg } from "../components";

/** The world ruleset's floors in words ("This world's ruleset needs Sheets & checks 3."), or null when it sets none. */
export function floorNote(floors: Partial<Record<DomainId, Level>>): string | null {
  const parts = DOMAINS.flatMap((domain) => {
    const floor = floors[domain] ?? 0;
    return floor > 0 ? [`${DOMAIN_LABEL[domain]} ${floor}`] : [];
  });
  if (parts.length === 0) return null;
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `This world's ruleset needs ${joined}.`;
}

const KNOWLEDGE_LABEL: Readonly<Record<NarratorKnowledge, string>> = { scene: "Everyone in the scene", pov: "Your character's only" };
const SECRETS_LABEL: Readonly<Record<NarratorSecrets, string>> = { marked: "Marked", omit: "Left out" };

const KNOWLEDGE_CHOICES = NARRATOR_KNOWLEDGE.map((value) => ({ value, label: KNOWLEDGE_LABEL[value] }));
const SECRETS_CHOICES = NARRATOR_SECRETS.map((value) => ({ value, label: SECRETS_LABEL[value] }));

const KNOWLEDGE_HELP: Record<NarratorKnowledge, string> = {
  scene: "A secret your character doesn't know may go into the prompt, marked as a secret, so the narrator can play those who hold it.",
  pov: "Only what your character knows goes into the prompt: a secret kept from your character stays out.",
};

const SECRETS_HELP: Record<NarratorSecrets, string> = {
  marked: "A secret kept from your character goes in marked as one, with whom it is known to or kept from.",
  omit: "A secret kept from your character is left out.",
};

/** What the narrator is given of the secrets in your lore: whose knowledge counts and what of a secret goes into the prompt. A secret goes in only when both say so. */
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
      <span class="lre-field-help">A secret goes in only when both say so: everyone in the scene, and marked.</span>
    </div>
  );
}
