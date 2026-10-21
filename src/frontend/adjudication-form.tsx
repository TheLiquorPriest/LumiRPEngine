// How checks are decided (DESIGN §11), one form for Build's Ruleset part, Settings → Checks and GM →
// This chat → Checks: a preset (Narrative-first, Balanced, Crunchy, Custom) told in plain lines, and
// under Custom every value with a plain label and a short help. Shares go in as whole percentages;
// a named preset is always its own values, so changing any value makes the policy Custom.

import { presetAdjudication } from "../shared/adjudication";
import type { AdjudicationDef, AdjudicationPresetId, CheckAuthority, CheckTiming, DescriptionWeight, RetryRule } from "../shared/world";
import { HostSwitch, NumberStepper, Seg } from "./components";

export const ADJUDICATION_PRESET_LABEL: Record<AdjudicationPresetId, string> = { narrative: "Narrative-first", balanced: "Balanced", crunchy: "Crunchy", custom: "Custom" };

const PRESETS = (["narrative", "balanced", "crunchy", "custom"] as const).map((value) => ({ value, label: ADJUDICATION_PRESET_LABEL[value] }));

const TIMING: Record<CheckTiming, string> = { every: "Every check", risky: "Only risky ones", marked: "Only where marked", never: "Never" };
const WEIGHT: Record<DescriptionWeight, string> = { none: "Doesn't count", bonus: "Adds a bonus", advantage: "Grants advantage", dc: "Lowers the DC" };
const AUTHORITY: Record<CheckAuthority, string> = { mechanics: "The roll", hybrid: "The roll, with close calls", narrative: "The story" };
const RETRY: Record<RetryRule, string> = { free: "Any time", changed: "After a change", once: "Once per scene" };

const percent = (share: number): number => Math.round(share * 100);

/** The policy in plain lines, as a player reads it: the sure and hopeless tries first, then when the rest roll. */
export function policyLines(p: AdjudicationDef): string[] {
  const thresholds = p.trivialAt !== null || p.impossibleAt !== null;
  const timing: Record<CheckTiming, string> = {
    every: thresholds ? "Every other check rolls." : "Every check rolls.",
    risky: `Only risky checks are decided: under ${percent(p.riskyAt)}% to succeed. Likelier ones just succeed.`,
    marked: "Only checks of marked actions, places and quests are decided; the rest just succeed.",
    never: "No check is decided; actions just succeed.",
  };
  const weight: Record<DescriptionWeight, string> = {
    none: p.authority === "narrative" ? "" : "How you describe your approach doesn't change a roll.",
    bonus: `A well-described approach adds up to +${p.description.max} to the roll.`,
    advantage: `An approach rated ${p.description.advantageAt} of ${p.description.max} or better rolls with advantage.`,
    dc: `A well-described approach lowers the DC by up to ${p.description.max}.`,
  };
  const authority: Record<CheckAuthority, string> = {
    mechanics: "The roll settles it.",
    hybrid: `The roll settles it; within ${p.closeBy} of another result, the narrator may add a cost or partial progress.`,
    narrative: "The story decides, with the odds as guidance: a helper judges your approach and picks the outcome.",
  };
  const retry: Record<RetryRule, string> = {
    free: "Retry a failed check whenever you like.",
    changed: `A failed try stands until something changes: another way, better odds, a new place, a new round of a fight (or its end), or ${p.retryAfter} minutes.`,
    once: "A failed try stands until the scene changes.",
  };
  return [
    p.trivialAt === null ? "" : `Sure things (${percent(p.trivialAt)}% or more) pass without a roll.`,
    p.impossibleAt === null ? "" : `Hopeless tries (${percent(p.impossibleAt)}% or less) fail without a roll.`,
    timing[p.checks],
    weight[p.description.weight],
    authority[p.authority],
    retry[p.retry],
  ].filter((line) => line !== "");
}

/** A labelled select over a closed set of values, with a short help under it; the inferred-checks control reuses it. */
export function Choice<T extends string>(props: { label: string; help: string; value: T; labels: Record<T, string>; disabled?: boolean; onChange(value: T): void }) {
  const values = Object.keys(props.labels) as T[];
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <select class="lre-input" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(values.find((v) => v === event.currentTarget.value) ?? props.value)}>
        {values.map((v) => (
          <option key={v} value={v}>
            {props.labels[v]}
          </option>
        ))}
      </select>
      <span class="lre-field-help">{props.help}</span>
    </label>
  );
}

/** A threshold that can be off: a switch, and the percentage while it is on. */
function Threshold(props: { label: string; at: string; help: string; value: number | null; fallback: number; disabled?: boolean; onChange(value: number | null): void }) {
  return (
    <div class="lre-field">
      <HostSwitch label={props.label} checked={props.value !== null} disabled={props.disabled} onChange={(on) => props.onChange(on ? props.fallback : null)} />
      {props.value !== null ? <NumberStepper label={props.at} value={percent(props.value)} min={0} max={100} step={1} integer disabled={props.disabled} onChange={(v) => props.onChange(v / 100)} /> : null}
      <span class="lre-field-help">{props.help}</span>
    </div>
  );
}

export function AdjudicationForm(props: { value: AdjudicationDef; disabled?: boolean; onChange(next: AdjudicationDef): void }) {
  const p = props.value;
  const set = (patch: Partial<AdjudicationDef>) => props.onChange({ ...p, ...patch, preset: "custom" });
  const describe = (patch: Partial<AdjudicationDef["description"]>) => {
    const description = { ...p.description, ...patch };
    set({ description: { ...description, advantageAt: Math.min(description.advantageAt, description.max) } });
  };
  return (
    <div class="lre-stack" data-lre-adjudication-form>
      <Seg<AdjudicationPresetId> label="Adjudication preset" value={p.preset} options={PRESETS} disabled={props.disabled} onChange={(preset) => props.onChange(preset === "custom" ? { ...p, preset } : presetAdjudication(preset))} />
      {p.preset !== "custom" ? (
        <ul class="lre-gm-lines" data-lre-policy-lines>
          {policyLines(p).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <>
          <p class="lre-gm-note">Any change makes it Custom. Chances are the exact odds the palette shows.</p>
          <Choice label="When checks roll" help="Risky: only when the chance of success is below the line. Marked: only for actions, places and quests marked in Build. A check that isn't rolled succeeds." value={p.checks} labels={TIMING} disabled={props.disabled} onChange={(checks) => set({ checks })} />
          {p.checks === "risky" ? <NumberStepper label="Risky below (% to succeed)" value={percent(p.riskyAt)} min={0} max={100} step={1} integer disabled={props.disabled} onChange={(v) => set({ riskyAt: v / 100 })} /> : null}
          <Threshold label="Sure things pass without a roll" at="From (% to succeed)" help="A check this likely just succeeds." value={p.trivialAt} fallback={0.95} disabled={props.disabled} onChange={(trivialAt) => set({ trivialAt })} />
          <Threshold label="Hopeless tries fail without a roll" at="At or below (% to succeed)" help="A check this unlikely just fails: too hard to try." value={p.impossibleAt} fallback={0.05} disabled={props.disabled} onChange={(impossibleAt) => set({ impossibleAt })} />
          <Choice label="How the player's approach counts" help="A helper rates how well the player describes their approach, from 0 up to the most it counts. It shifts a check that rolls." value={p.description.weight} labels={WEIGHT} disabled={props.disabled} onChange={(weight) => describe({ weight })} />
          {p.description.weight !== "none" ? <NumberStepper label="The most it counts (the rating's top)" value={p.description.max} min={1} max={10} step={1} integer disabled={props.disabled} onChange={(max) => describe({ max })} /> : null}
          {p.description.weight === "advantage" ? <NumberStepper label="Advantage from a rating of" value={p.description.advantageAt} min={1} max={p.description.max} step={1} integer disabled={props.disabled} onChange={(advantageAt) => describe({ advantageAt })} /> : null}
          <Choice label="Who settles a check" help="With close calls, a roll near another result lets the narrator add a cost or partial progress. The story: a helper picks the outcome, the odds as guidance; without it, the check succeeds." value={p.authority} labels={AUTHORITY} disabled={props.disabled} onChange={(authority) => set({ authority })} />
          {p.authority === "hybrid" ? <NumberStepper label="A close call is within (points)" value={p.closeBy} min={0} max={20} step={1} integer disabled={props.disabled} onChange={(closeBy) => set({ closeBy })} /> : null}
          <Choice label="Retrying a failed check" help="After a change: the same try fails again until time passes, a fight moves to a new round or ends, the odds change, the player tries another way or goes somewhere else. Once per scene: until they leave and come back." value={p.retry} labels={RETRY} disabled={props.disabled} onChange={(retry) => set({ retry })} />
          {p.retry === "changed" ? <NumberStepper label="Time that counts as a change (minutes)" value={p.retryAfter} min={0} max={10080} step={5} integer disabled={props.disabled} onChange={(retryAfter) => set({ retryAfter })} /> : null}
        </>
      )}
    </div>
  );
}
