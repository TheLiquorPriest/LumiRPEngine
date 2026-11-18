// The world's policies as Build's forms set them: what the narrator is given of secrets in your lore (the secrecy answer, DESIGN §6.11),
// what the Add on a panel does with something the world doesn't have (player claims, DESIGN §9.4, also set for one chat on its World
// page) and the ruleset's realism floors in words. Each control is the one place its policy is drawn, so every form that sets it reads
// the same.

import type { ClaimsPolicy } from "../../shared/claims";
import { CLAIM_MODE_LABEL, CLAIM_MODES } from "../../shared/claims";
import { DOMAIN_LABEL, DOMAINS } from "../../shared/ids";
import type { DomainId, Level } from "../../shared/ids";
import type { NarratorKnowledge, NarratorSecrets, NarratorView } from "../../shared/narrator-view";
import { NARRATOR_KNOWLEDGE, NARRATOR_SECRETS } from "../../shared/narrator-view";
import { HostSwitch, Seg } from "../components";

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

const CLAIM_CHOICES = CLAIM_MODES.map((mode) => ({ value: mode, label: CLAIM_MODE_LABEL[mode] }));

/** What the Add on a panel does under each way of holding to the world: made at once (a key, a weapon or a document, and with the cap on a dear thing, ask first), asked about, or not offered. */
export function claimsWords(policy: ClaimsPolicy): string {
  if (policy.mode === "real") return policy.capped ? "Add makes it at once. A key, a weapon or a document, or anything that costs more than this world's claim cap, asks you first." : "Add makes it at once. A key, a weapon or a document asks you first.";
  if (policy.mode === "ask") return "Add asks you before it makes it real.";
  return "Add isn't offered, and a change of yours that would make something the world doesn't have is turned down.";
}

/**
 * Player claims (DESIGN §9.4): what the Add on a panel does when you say you have something the world doesn't, and whether Make it
 * real asks first above the world's claim cap. The cap switch keeps its value under the other modes, where it does nothing, so
 * switching back to Make it real finds it as it was.
 */
export function ClaimsControl(props: { value: ClaimsPolicy; disabled?: boolean; onChange(next: ClaimsPolicy): void }) {
  const { mode, capped } = props.value;
  return (
    <div class="lre-stack" data-lre-claims>
      <div class="lre-field">
        <span class="label">When you add something the world doesn't have</span>
        <Seg<ClaimsPolicy["mode"]> label="When you add something the world doesn't have" value={mode} options={CLAIM_CHOICES} disabled={props.disabled} onChange={(next) => props.onChange({ mode: next, capped })} />
        <span class="lre-field-help">{claimsWords(props.value)}</span>
      </div>
      <div class="lre-field">
        <HostSwitch label="Ask first above the world's claim cap" checked={capped} disabled={props.disabled || mode !== "real"} onChange={(next) => props.onChange({ mode, capped: next })} />
        {mode === "real" ? null : <span class="lre-field-help">Only for Make it real.</span>}
      </div>
    </div>
  );
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
