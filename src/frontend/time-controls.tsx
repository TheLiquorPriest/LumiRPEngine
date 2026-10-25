// Time controls (DESIGN §9.2): ticks per scene type, time scale, interrupt policy, Speed through per
// activity, Montage granularity and the timelapse unit cap. One editor, two sinks: Settings → Time
// writes the seed for new chats (`settingsTimePatch`), GM → This chat → Time writes `time` markers
// on the running chat.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn } from "../shared/json";
import { INTERRUPT_CLASSES } from "../shared/ids";
import type { InterruptClass, InterruptPolicy } from "../shared/ids";
import type { TimeControl, TimeScope } from "../shared/ledger";
import { SPEED_ACTIVITIES, SPEED_DEFAULT, SPEED_THRESHOLD_MINUTES } from "../shared/settings";
import { HostSlider, NumberStepper, Section, Seg } from "./components";
import { formatMinutes, humanize } from "./format";

export interface TimeValues {
  sceneTicks: Record<string, number>;
  scale: number;
  interrupts: Record<InterruptClass, InterruptPolicy>;
  speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
  montage: "key" | "day" | "week";
  unitCap: { agentDays: number; events: number };
}

export interface TimeChange {
  control: TimeControl;
  scope: TimeScope;
  to: JsonValue;
}

/** Speed through's rows: the activities it always lists, then the world's own, each with its policy, or null when it has none (that activity is never sped through: its time passes in the player's turns). */
export function speedRows(speedThrough: TimeValues["speedThrough"]): { activity: string; policy: TimeValues["speedThrough"][string] | null }[] {
  return [...new Set<string>([...SPEED_ACTIVITIES, ...Object.keys(speedThrough)])].map((activity) => ({ activity, policy: hasOwn(speedThrough, activity) ? (speedThrough[activity] ?? null) : null }));
}

/** A time change as a Settings merge patch (the seed for new chats). */
export function settingsTimePatch(change: TimeChange): JsonObject {
  const scope = change.scope;
  switch (change.control) {
    case "tick":
      return "sceneType" in scope ? { time: { sceneTicks: { [scope.sceneType]: change.to } } } : {};
    case "scale":
      return { time: { scale: change.to } };
    case "interrupt":
      return "interrupt" in scope ? { time: { interrupts: { [scope.interrupt]: change.to } } } : {};
    case "speed_through":
      return "activity" in scope ? { time: { speedThrough: { [scope.activity]: change.to } } } : {};
    case "montage":
      return { time: { montage: change.to } };
    case "unit_cap":
      return { time: { unitCap: change.to } };
    case "pause":
      return {};
  }
}

const POLICY_OPTIONS = [
  { value: "stop", label: "Stop" },
  { value: "note", label: "Note" },
  { value: "ignore", label: "Ignore" },
] as const;

// The steppers stay in this one tree rather than in sub-components, so the tree reads as laid out
// (test/backend/speed-threshold.test.ts reads the threshold stepper's range from it).
export function TimeControlsEditor(props: { values: TimeValues; onChange(change: TimeChange): void; currentSceneType?: string; disabled?: boolean }) {
  const { values } = props;
  return (
    <div class="lre-stack lre-gm-time" data-lre-time-controls>
      <Section title="Default tick per scene type">
        <p class="lre-gm-note">How long a turn takes when nothing in it says otherwise.</p>
        {Object.entries(values.sceneTicks).map(([sceneType, minutes]) => (
          <NumberStepper
            key={sceneType}
            label={`${humanize(sceneType)}${sceneType === props.currentSceneType ? " (now)" : ""} · ${formatMinutes(minutes)}`}
            value={minutes}
            min={0}
            max={1440}
            integer
            disabled={props.disabled}
            onChange={(to) => props.onChange({ control: "tick", scope: { sceneType }, to })}
          />
        ))}
        <HostSlider
          label="Time scale"
          hint="Multiplies default ticks only; actions, travel and timelapses stay exact."
          min={0.25}
          max={10}
          step={0.25}
          suffix="×"
          value={values.scale}
          disabled={props.disabled}
          onCommit={(to) => props.onChange({ control: "scale", scope: { all: true }, to })}
        />
      </Section>
      <Section title="Timelapse interrupts">
        <p class="lre-gm-note">What a timelapse does when something of each kind comes up: stop there, note it and go on, or ignore it.</p>
        {INTERRUPT_CLASSES.map((cls) => (
          <div key={cls} class="lre-field">
            <span class="label">{humanize(cls)}</span>
            <Seg<InterruptPolicy> label={humanize(cls)} value={values.interrupts[cls]} options={POLICY_OPTIONS} disabled={props.disabled} onChange={(to) => props.onChange({ control: "interrupt", scope: { interrupt: cls }, to })} />
          </div>
        ))}
      </Section>
      <Section title="Speed through">
        <p class="lre-gm-note">Long activities: offer a timelapse, or run it, once they take longer than the threshold.</p>
        {speedRows(values.speedThrough).map(({ activity, policy }) => (
          <div key={activity} class="lre-gm-speed" role="group" aria-label={humanize(activity)}>
            <div class="lre-gm-subtitle">
              {humanize(activity)}
              {policy ? null : <span class="lre-gm-subtitle-note"> · never sped through: its time passes in your turns</span>}
            </div>
            <Seg<"offer" | "auto">
              label={`${humanize(activity)} mode`}
              value={policy?.mode ?? null}
              options={[
                { value: "offer", label: "Offer a timelapse" },
                { value: "auto", label: "Run it" },
              ]}
              disabled={props.disabled}
              onChange={(mode) => props.onChange({ control: "speed_through", scope: { activity }, to: { mode, thresholdMinutes: policy?.thresholdMinutes ?? SPEED_DEFAULT.thresholdMinutes } })}
            />
            <NumberStepper
              label="When longer than (min)"
              value={policy?.thresholdMinutes ?? null}
              min={SPEED_THRESHOLD_MINUTES[0]}
              max={SPEED_THRESHOLD_MINUTES[1]}
              step={5}
              integer
              disabled={props.disabled}
              onChange={(thresholdMinutes) => props.onChange({ control: "speed_through", scope: { activity }, to: { mode: policy?.mode ?? SPEED_DEFAULT.mode, thresholdMinutes } })}
            />
          </div>
        ))}
      </Section>
      <Section title="Montage and limits">
        <div class="lre-field">
          <span class="label">Montage granularity</span>
          <Seg<"key" | "day" | "week">
            label="Montage granularity"
            value={values.montage}
            options={[
              { value: "key", label: "Key events" },
              { value: "day", label: "Per day" },
              { value: "week", label: "Per week" },
            ]}
            disabled={props.disabled}
            onChange={(to) => props.onChange({ control: "montage", scope: { all: true }, to })}
          />
        </div>
        <NumberStepper label="Unit cap: agent-days per segment" value={values.unitCap.agentDays} min={1} max={100000} step={50} integer disabled={props.disabled} onChange={(agentDays) => props.onChange({ control: "unit_cap", scope: { all: true }, to: { agentDays, events: values.unitCap.events } })} />
        <NumberStepper label="Unit cap: events per segment" value={values.unitCap.events} min={1} max={1000000} step={500} integer disabled={props.disabled} onChange={(events) => props.onChange({ control: "unit_cap", scope: { all: true }, to: { agentDays: values.unitCap.agentDays, events } })} />
      </Section>
    </div>
  );
}
