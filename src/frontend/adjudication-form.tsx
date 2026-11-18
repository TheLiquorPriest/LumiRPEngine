// How checks are decided (DESIGN §11), one set of controls for Build's Ruleset part and the World page's For this chat:
// when a check rolls (every one, only the risky ones, only where marked, never), the lines under which a sure thing passes and a
// hopeless try fails without a roll, and what a failed try needs before it may be tried again. Shares go in as whole percentages.
// These are the values RPE's action resolver reads. How a described approach counts and who settles a check (the roll, close calls,
// the story) were the previous build's judge's: nothing in RPE rates an approach or judges an outcome, so they are kept in the
// world's file and named once at the foot of Build's sheet (`KeptUnused`), never drawn.

import { ADJUDICATION_PRESET_LABEL, presetAdjudication } from "../shared/adjudication";
import type { AdjudicationDef, AdjudicationPresetId, CheckTiming, RetryRule } from "../shared/world";
import { HostSwitch, NumberStepper, Seg } from "./components";
import { KeptUnused } from "./build/form-kit";

const TIMING: Record<CheckTiming, string> = { every: "Every check", risky: "Only risky ones", marked: "Only where marked", never: "Never" };
const RETRY: Record<RetryRule, string> = { free: "Any time", changed: "After a change", once: "Once per scene" };

/** What each way of starting from a named policy is called; the narrative-first preset leaned on the judge, so it is offered only where a world already has it. */
const START_FROM: readonly Exclude<AdjudicationPresetId, "narrative">[] = ["balanced", "crunchy", "custom"];

const percent = (share: number): number => Math.round(share * 100);

/** The values of a policy that RPE reads: when checks roll, the sure and hopeless lines, and what a retry takes. */
export interface CheckRules {
  checks: CheckTiming;
  riskyAt: number;
  trivialAt: number | null;
  impossibleAt: number | null;
  retry: RetryRule;
  retryAfter: number;
}

/** A labelled select over a closed set of values, with a short help under it. */
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

/** The controls of the values RPE reads; each change comes up as the part it changed. */
export function CheckRulesForm(props: { value: CheckRules; disabled?: boolean; onChange(patch: Partial<CheckRules>): void }) {
  const p = props.value;
  return (
    <div class="lre-stack" data-lre-check-rules>
      <Choice label="When checks roll" help="Risky: only when the chance of success is below the line. Marked: only for actions, places and quests marked in Build. A check that isn't rolled succeeds." value={p.checks} labels={TIMING} disabled={props.disabled} onChange={(checks) => props.onChange({ checks })} />
      {p.checks === "risky" ? <NumberStepper label="Risky below (% to succeed)" value={percent(p.riskyAt)} min={0} max={100} step={1} integer disabled={props.disabled} onChange={(v) => props.onChange({ riskyAt: v / 100 })} /> : null}
      <Threshold label="Sure things pass without a roll" at="From (% to succeed)" help="A check this likely just succeeds." value={p.trivialAt} fallback={0.95} disabled={props.disabled} onChange={(trivialAt) => props.onChange({ trivialAt })} />
      <Threshold label="Hopeless tries fail without a roll" at="At or below (% to succeed)" help="A check this unlikely just fails: too hard to try." value={p.impossibleAt} fallback={0.05} disabled={props.disabled} onChange={(impossibleAt) => props.onChange({ impossibleAt })} />
      <Choice label="Retrying a failed check" help="After a change: the same try fails again until time passes, a fight moves to a new round or ends, the odds change, you try another way or you go somewhere else. Once per scene: until you leave and come back." value={p.retry} labels={RETRY} disabled={props.disabled} onChange={(retry) => props.onChange({ retry })} />
      {p.retry === "changed" ? <NumberStepper label="Time that counts as a change (minutes)" value={p.retryAfter} min={0} max={10080} step={5} integer disabled={props.disabled} onChange={(retryAfter) => props.onChange({ retryAfter })} /> : null}
    </div>
  );
}

/** What a world's policy holds that RPE does not read, by the key `KeptUnused` names: the judge's approach and the one who settles a check, unset where the policy plays plainly. */
function keptJudge(p: AdjudicationDef): Record<string, unknown> {
  return { description: p.description.weight !== "none" ? p.description : undefined, authority: p.authority !== "mechanics" ? p.authority : undefined };
}

const KEPT_JUDGE = [
  { key: "description", label: "How a described approach counts: it adds a bonus, grants advantage or lowers the DC" },
  { key: "authority", label: "Who settles a check: the roll with close calls, or the story" },
] as const;

/** Build's form: the controls, and a way to start from a named policy; a change to any value makes it Custom. */
export function AdjudicationForm(props: { value: AdjudicationDef; disabled?: boolean; onChange(next: AdjudicationDef): void }) {
  const p = props.value;
  return (
    <div class="lre-stack" data-lre-adjudication-form>
      <Seg<AdjudicationPresetId> label="Start from" value={p.preset} options={START_FROM.map((value) => ({ value, label: ADJUDICATION_PRESET_LABEL[value] }))} disabled={props.disabled} onChange={(preset) => props.onChange(preset === "custom" ? { ...p, preset } : presetAdjudication(preset))} />
      <p class="lre-gm-note">Any change makes it Custom. Chances are the exact odds the palette shows.</p>
      <CheckRulesForm value={p} disabled={props.disabled} onChange={(patch) => props.onChange({ ...p, ...patch, preset: "custom" })} />
      <KeptUnused fields={KEPT_JUDGE} held={keptJudge(p)} />
    </div>
  );
}
