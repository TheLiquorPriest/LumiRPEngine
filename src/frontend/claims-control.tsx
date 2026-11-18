// What the Add on a panel does with something the world doesn't have (player claims, DESIGN §9.4), as one control: Build's Realism
// part and a world's default set it, and the World page sets it for one chat. A light module on the shared atoms alone, so the
// extension's first file may hold it (`LIGHT_REFUSES` in scripts/build.ts).

import type { ClaimsPolicy } from "../shared/claims";
import { CLAIM_MODE_LABEL, CLAIM_MODES } from "../shared/claims";
import { HostSwitch, Seg } from "./components";

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
