// The world's policies as Build's forms set them: the narrator's knowledge (DESIGN §6.11), player
// claims (DESIGN §9.4) and the ruleset's realism floors in words. Each control is the one place its
// policy is drawn, so every form that sets it reads the same.

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

/**
 * Player claims (DESIGN §9.4): what a typed action's thing the world doesn't have becomes, and
 * whether Make it real asks first above the world's claim cap. The cap switch keeps its value under
 * the other modes, where it does nothing, so switching back to Make it real finds it as it was.
 */
export function ClaimsControl(props: { value: ClaimsPolicy; disabled?: boolean; onChange(next: ClaimsPolicy): void }) {
  const { mode, capped } = props.value;
  const help = mode === "real" ? (capped ? "It's added where your action needs it, unless it costs more than the world's claim cap: then you're asked first." : "It's added where your action needs it, at any price.") : mode === "ask" ? "The turn waits for your answer: Add, or Not an action." : "The action plays as plain roleplay, and a receipt says why.";
  return (
    <div class="lre-stack" data-lre-claims>
      <div class="lre-field">
        <span class="label">When you say you have something the world doesn't</span>
        <Seg<ClaimsPolicy["mode"]> label="When you say you have something the world doesn't" value={mode} options={CLAIM_CHOICES} disabled={props.disabled} onChange={(next) => props.onChange({ mode: next, capped })} />
        <span class="lre-field-help">{help} Cash you carry is just handed over; money you say you have and don't is always asked about first, except under Hold me to the world.</span>
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
  scene: "What every person in the scene knows, with what your character doesn't know marked for the narrator.",
  pov: "Only what your character knows.",
};

const SECRETS_HELP: Record<NarratorSecrets, string> = {
  marked: "A line carrying a secret's words goes in marked as a secret, with whom it is known to or kept from.",
  omit: "A line carrying a secret's words is left out.",
};

/** The narrator's knowledge (DESIGN §6.11): whose knowledge it gets and what of a secret. */
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
