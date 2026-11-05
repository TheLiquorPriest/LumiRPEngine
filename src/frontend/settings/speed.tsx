// Settings → Speed (`shared/speed-presets.ts`): every setting that decides how long a turn takes, in
// one place. Three presets at the top (Thorough, Balanced, Fast): picking one lists what it will
// change before Apply, and "Back to Thorough" puts back only the rows a preset sets. Then "Where the
// last turn's time went", the open chat's last turn part by part, its slowest part linking to the row
// that decides it. Then each group of rows, one row per setting in the A7 kit (Changed, Default,
// Reset), edited in place, each naming the page it lives on with a way there. Designed for 390 px.

import { useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { UserSettings } from "../../shared/settings";
import { currentSpeedPreset, patchAt, PRESET_ROWS, presetChanges, rowChanged, rowDefault, rowValue, SPEED_GROUP_LABEL, SPEED_GROUPS, SPEED_PRESET_WORDS, SPEED_PRESETS, SPEED_ROWS, speedRow, speedValueText, type SpeedChange, type SpeedPresetId, type SpeedRow } from "../../shared/speed-presets";
import { type SettingsRoute, useApp } from "../app";
import { Banner, Button, Empty, HostSwitch, NumberStepper, Section, Seg } from "../components";
import { LastTurnTime } from "../diagnostics";
import { useSelect } from "../store";
import { SettingRow } from "./kit";

/** The rows this build's settings have (a row whose setting another part of Settings hasn't added yet is left out), in their group. */
export function speedRowsOf(group: (typeof SPEED_GROUPS)[number]): SpeedRow[] {
  return SPEED_ROWS.filter((row) => row.group === group && rowDefault(row) !== undefined);
}

/** A row's control: a switch, a choice, a number, or a limit with its No limit switch. Hook-free. */
export function SpeedControlView(props: { row: SpeedRow; value: JsonValue | undefined; busy: boolean; set(value: JsonValue): void }) {
  const { row, value, busy } = props;
  const c = row.control;
  if (c.kind === "switch") return <HostSwitch label={row.label} checked={value === true} disabled={busy} onChange={(on) => props.set(on)} />;
  if (c.kind === "choice") return <Seg<string> label={row.label} value={typeof value === "string" ? value : null} options={c.options} disabled={busy} onChange={(next) => props.set(next)} />;
  if (c.kind === "number") return <NumberStepper label={`${row.label} (${c.unit})`} value={typeof value === "number" ? value : null} min={c.min} {...(c.max !== undefined ? { max: c.max } : {})} step={c.step} integer disabled={busy} onChange={(next) => props.set(next)} />;
  return (
    <>
      <HostSwitch label={`${row.label}: ${c.none.toLowerCase()}`} checked={value === "none"} disabled={busy} onChange={(none) => props.set(none ? "none" : c.onValue)} />
      {value === "none" ? null : <NumberStepper label={`${row.label} (${c.unit})`} value={typeof value === "number" ? value : c.onValue} min={c.min} step={c.step} integer disabled={busy} onChange={(next) => props.set(next)} />}
    </>
  );
}

/** One speed setting as a kit row, edited in place, with the page it lives on. Hook-free. */
export function SpeedRowView(props: { row: SpeedRow; settings: UserSettings; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { row, settings, busy } = props;
  const standard = rowDefault(row);
  const set = (value: JsonValue | null) => props.patch(patchAt(row.path, value));
  const elsewhere = row.page.route.page !== "speed";
  return (
    <div class="lre-set-agent-section" data-lre-agent-section={row.id} data-lre-speed-row={row.id} tabIndex={-1}>
      <SettingRow id={`speed-${row.id}`} label={row.label} bare={row.control.kind === "switch"} changed={rowChanged(settings, row)} help={row.help} reset={{ label: `Reset ${row.label} to its default, ${speedValueText(row, standard)}`, to: speedValueText(row, standard), onClick: () => set(null) }} busy={busy}>
        <SpeedControlView row={row} value={rowValue(settings, row)} busy={busy} set={set} />
      </SettingRow>
      {elsewhere ? (
        <Button size="sm" variant="ghost" iconAfter="chevron-right" label={`Open ${row.page.label}, where ${row.label} also lives`} onClick={() => props.go(row.page.route as SettingsRoute)}>
          {`Lives on ${row.page.label}`}
        </Button>
      ) : null}
    </div>
  );
}

/** What a preset will change, each row from what it is to what it becomes, with Apply and Cancel. Hook-free. */
export function PresetChanges(props: { preset: SpeedPresetId; changes: readonly SpeedChange[]; busy: boolean; apply(): void; cancel(): void }) {
  const words = SPEED_PRESET_WORDS[props.preset];
  if (props.changes.length === 0)
    return (
      <Banner tone="info" title={`Already ${words.label}`} actions={<Button size="sm" variant="ghost" onClick={props.cancel}>Close</Button>}>
        Every setting {words.label} sets is as it sets it.
      </Banner>
    );
  return (
    <Banner
      tone="info"
      title={`${words.label} changes ${props.changes.length} ${props.changes.length === 1 ? "setting" : "settings"}`}
      actions={
        <>
          <Button size="sm" variant="primary" busy={props.busy} onClick={props.apply}>
            Apply
          </Button>
          <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.cancel}>
            Cancel
          </Button>
        </>
      }
    >
      <ul class="lre-speed-changes" data-lre-speed-changes={props.preset}>
        {props.changes.map((c) => (
          <li key={c.row.id} data-lre-speed-change={c.row.id}>
            <span class="lre-set-row-label">{c.row.label}</span>: {speedValueText(c.row, c.from)} → {speedValueText(c.row, c.to)} <span class="lre-small lre-muted">({c.row.page.label})</span>
          </li>
        ))}
      </ul>
    </Banner>
  );
}

/** The presets: one at a glance, which one the settings are now (none: your own mix), and Back to Thorough while a preset's rows are changed. */
function Presets(props: { settings: UserSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const [picked, setPicked] = useState<SpeedPresetId | null>(null);
  const current = currentSpeedPreset(props.settings);
  const pending = picked === null ? null : presetChanges(props.settings, picked);
  const off = PRESET_ROWS.some((id) => {
    const row = speedRow(id);
    return row !== undefined && rowDefault(row) !== undefined && rowChanged(props.settings, row);
  });
  return (
    <Section title="Presets">
      <div class="lre-stack" data-lre-speed-presets>
        <Seg<SpeedPresetId> label="Speed preset" value={picked ?? current} options={SPEED_PRESETS.map((id) => ({ value: id, label: SPEED_PRESET_WORDS[id].label }))} disabled={props.busy} onChange={setPicked} />
        <p class="lre-small lre-muted" style={{ margin: 0 }}>
          {current === null && picked === null ? "Your own mix: the settings below differ from every preset." : SPEED_PRESET_WORDS[picked ?? current ?? "thorough"].summary}
        </p>
        {pending && picked ? (
          <PresetChanges
            preset={picked}
            changes={pending.changes}
            busy={props.busy}
            apply={() => {
              props.patch(pending.patch);
              setPicked(null);
            }}
            cancel={() => setPicked(null)}
          />
        ) : null}
        {off && picked === null ? (
          <div>
            <Button size="sm" variant="secondary" icon="undo" disabled={props.busy} onClick={() => props.patch(presetChanges(props.settings, "thorough").patch)}>
              Back to Thorough
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

export function SpeedPage(props: { settings: UserSettings; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const app = useApp();
  const chatId = useSelect(app.sync, (state) => state.chatId);
  return (
    <div class="lre-stack" data-lre-settings-page="speed">
      <p class="lre-set-lead">How long a turn takes: what runs before the reply, what the main agent remembers, what is kept from the last turn, how many calls go out at once, and the pages. Each setting also lives on its own page.</p>
      <Presets settings={props.settings} busy={props.busy} patch={props.patch} />
      <Section title="Where the last turn's time went">{chatId ? <LastTurnTime chatId={chatId} onControl={(row) => props.go({ page: "speed", at: row })} /> : <Empty icon="clock">Open a chat to see where its last turn's time went.</Empty>}</Section>
      {SPEED_GROUPS.map((group) => {
        const rows = speedRowsOf(group);
        return rows.length === 0 ? null : (
          <Section key={group} title={SPEED_GROUP_LABEL[group]} flush>
            <div class="lre-set-rows" data-lre-speed-group={group}>
              {rows.map((row) => (
                <SpeedRowView key={row.id} row={row} settings={props.settings} busy={props.busy} patch={props.patch} go={props.go} />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

/** Settings home's and the Agents hub's line for Speed: the preset the settings are now, or how many rows are your own. */
export function speedSummary(settings: UserSettings): string {
  const current = currentSpeedPreset(settings);
  return current === null ? "Your own mix" : `${SPEED_PRESET_WORDS[current].label} preset`;
}
