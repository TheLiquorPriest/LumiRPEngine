// Time controls (DESIGN §9.2): ticks per scene type, time scale, interrupt policy, Speed through per
// activity, Montage granularity and the timelapse unit cap. One editor, two sinks: Settings → Time
// writes the seed for new chats (`settingsTimePatch`), Play → Calendar writes `time` markers on the
// running chat.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn } from "../shared/json";
import { INTERRUPT_CLASSES } from "../shared/ids";
import type { InterruptClass, InterruptPolicy } from "../shared/ids";
import type { TimeControl, TimeScope } from "../shared/ledger";
import { SPEED_ACTIVITIES, SPEED_DEFAULT } from "../shared/settings";
import { HostSlider, NumberStepper, Seg } from "./components";
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

/** Speed through's rows: the activities it always lists, then the world's own, each with its policy, or null when it has none (that activity passes within the turn). */
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

export function TimeControlsEditor(props: { values: TimeValues; onChange(change: TimeChange): void; currentSceneType?: string; disabled?: boolean }) {
  const { values } = props;
  return (
    <div class="lre-stack" data-lre-time-controls>
      <section class="lre-card">
        <div class="lre-h">Default tick per scene type</div>
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
      </section>
      <section class="lre-card">
        <div class="lre-h">Timelapse interrupts</div>
        {INTERRUPT_CLASSES.map((cls) => (
          <div key={cls} class="lre-field" style={{ marginBottom: "6px" }}>
            <span class="label">{humanize(cls)}</span>
            <Seg<InterruptPolicy> label={humanize(cls)} value={values.interrupts[cls]} options={POLICY_OPTIONS} disabled={props.disabled} onChange={(to) => props.onChange({ control: "interrupt", scope: { interrupt: cls }, to })} />
          </div>
        ))}
      </section>
      <section class="lre-card">
        <div class="lre-h">Speed through</div>
        {speedRows(values.speedThrough).map(({ activity, policy }) => (
          <div key={activity} class="lre-stack" style={{ marginBottom: "8px" }}>
            <span class="lre-small lre-muted">
              {humanize(activity)}
              {policy ? "" : " · passes within the turn"}
            </span>
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
              min={0}
              max={1440}
              step={5}
              integer
              disabled={props.disabled}
              onChange={(thresholdMinutes) => props.onChange({ control: "speed_through", scope: { activity }, to: { mode: policy?.mode ?? SPEED_DEFAULT.mode, thresholdMinutes } })}
            />
          </div>
        ))}
      </section>
      <section class="lre-card">
        <div class="lre-h">Montage and limits</div>
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
      </section>
    </div>
  );
}
