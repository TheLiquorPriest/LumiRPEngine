// Settings → Model use (DESIGN §5.3, §5.4, D25): the preset (Lean, Standard, Full, Custom), budgets
// per phase (calls, wall clock and lore lookups), the engine token budget and the call meter; and
// per step: enabled, provider, connection, model, max tokens (≥1,500 for reasoning models, DESIGN
// §5.3), signals, and lore: the policy, its tokens and how lookups reach the model.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { ModelUsePresetId } from "../../shared/ids";
import { PROSE_STEPS } from "../../shared/lore";
import type { LorePolicy, LoreTransport, ModelUseSettings, StepConfig } from "../../shared/settings";
import { PRE_REPLY_MAX_MS, stepLoreOf } from "../../shared/settings";
import type { CallMeterView } from "../../shared/state-view";
import type { StepPurpose } from "../../shared/world";
import { useApp } from "../app";
import { HostModelPicker, HostSwitch, NumberStepper, Seg } from "../components";

const PRESETS: { value: ModelUsePresetId; label: string }[] = [
  { value: "lean", label: "Lean" },
  { value: "standard", label: "Standard" },
  { value: "full", label: "Full" },
  { value: "custom", label: "Custom" },
];

export const PRESET_NOTE: Record<ModelUsePresetId, string> = {
  lean: "Narrator + up to 2 model steps a turn, and no lore lookups: helpers get the lore their inputs find. The floor; doesn't meet “a model decides” on its own. The call meter shows each turn's real count.",
  standard: "Narrator + up to 4 model steps a turn, plus up to 3 lore lookups. The default. The call meter shows each turn's real count.",
  full: "Narrator + up to 9 model steps a turn, plus up to 5 lore lookups. The call meter shows each turn's real count.",
  custom: "Your own steps, signals, providers, lore and budgets. The count depends on the steps you enable; the call meter shows it live.",
};

const LORE_POLICY: { value: LorePolicy; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "prefetch", label: "Prefetch" },
  { value: "lookup", label: "Look up" },
  { value: "prefetch+lookup", label: "Both" },
];

const LORE_TRANSPORT: { value: LoreTransport; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "tools", label: "Tools" },
  { value: "need", label: "Ask form" },
];

export const STEP_LABEL: Record<StepPurpose, string> = {
  interpret: "Interpret typed input",
  "npc.choose": "NPC choices",
  contradiction: "Contradiction check",
  "puzzle.answer": "Puzzle answers",
  brief: "Scene brief",
  outline: "Prose outline",
  extract: "Extract changes",
  choices: "Suggested choices",
  judge: "Judge your approach",
};

const PHASES = ["pre", "post"] as const;
const PHASE_LABEL: Record<(typeof PHASES)[number], string> = { pre: "Before the reply", post: "After the reply" };
/** Lumiverse waits at most 120 s for a turn's plan, so the before-the-reply steps get what planning leaves of it. */
const WALL_CLOCK_MAX: Record<(typeof PHASES)[number], number> = { pre: PRE_REPLY_MAX_MS, post: 120_000 };

export function ModelUseSection(props: { modelUse: ModelUseSettings; meter: CallMeterView | null; patch(patch: JsonObject): void; busy: boolean }) {
  const { modelUse } = props;
  return (
    <div class="lre-stack">
      <Seg<ModelUsePresetId> label="Model use preset" value={modelUse.preset} options={PRESETS} disabled={props.busy} onChange={(preset) => props.patch({ modelUse: { preset } })} />
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        {PRESET_NOTE[modelUse.preset]}
      </p>
      <div class="lre-h">Budgets per phase</div>
      {PHASES.map((phase) => (
        <div key={phase}>
          <div class="lre-small lre-muted">{PHASE_LABEL[phase]}</div>
          <NumberStepper label="Calls" value={modelUse.budgets[phase].calls} min={0} max={20} integer disabled={props.busy} onChange={(calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { calls } } } })} />
          <NumberStepper label="Wall clock (ms)" value={modelUse.budgets[phase].ms} min={500} max={WALL_CLOCK_MAX[phase]} step={500} integer disabled={props.busy} onChange={(ms) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { ms } } } })} />
          {phase === "pre" ? <p class="lre-small lre-muted" style={{ margin: 0 }}>At most {PRE_REPLY_MAX_MS.toLocaleString("en-US")} ms: Lumiverse waits 120 s for a turn's plan, and planning needs the rest.</p> : null}
          <NumberStepper label="Lore lookups" value={modelUse.budgets[phase].lookup?.calls ?? 0} min={0} max={10} integer disabled={props.busy} onChange={(calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { lookup: { calls, ms: modelUse.budgets[phase].lookup?.ms ?? 0 } } } } })} />
          <NumberStepper label="Lookups may start within (ms)" value={modelUse.budgets[phase].lookup?.ms ?? 0} min={0} max={120000} step={500} integer disabled={props.busy} onChange={(ms) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { lookup: { calls: modelUse.budgets[phase].lookup?.calls ?? 0, ms } } } } })} />
        </div>
      ))}
      <div class="lre-h">Engine budget (tokens)</div>
      <NumberStepper label="Sections" value={modelUse.tokens.sections} min={100} max={8000} step={50} integer disabled={props.busy} onChange={(sections) => props.patch({ modelUse: { preset: "custom", tokens: { sections } } })} />
      {props.meter ? <Meter meter={props.meter} /> : null}
    </div>
  );
}

function Meter(props: { meter: CallMeterView }) {
  const rows = [
    ["This turn", props.meter.turn],
    ["Average", props.meter.average],
    ["95th pct", props.meter.p95],
  ] as const;
  return (
    <div>
      <div class="lre-h">Call meter</div>
      <div class="lre-meter" role="table" aria-label="Call meter">
        <div role="row" style={{ display: "contents" }}>
          <span class="hd" role="columnheader">
            <span class="lre-sr">Measure</span>
          </span>
          <span class="hd" role="columnheader">
            Calls
          </span>
          <span class="hd" role="columnheader">
            Tokens
          </span>
          <span class="hd" role="columnheader">
            Lookups
          </span>
          <span class="hd" role="columnheader">
            Time
          </span>
        </div>
        {rows.map(([label, m]) => (
          <div key={label} role="row" style={{ display: "contents" }}>
            <span role="rowheader">{label}</span>
            <span role="cell">{m.calls.toFixed(m.calls % 1 === 0 ? 0 : 1)}</span>
            <span role="cell">{Math.round(m.tokens)}</span>
            <span role="cell">{m.lookups.toFixed(m.lookups % 1 === 0 ? 0 : 1)}</span>
            <span role="cell">{(m.ms / 1000).toFixed(1)} s</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A step's config as a JSON patch value, dropping absent optional fields. */
function stepPatch(config: StepConfig): JsonObject {
  const out: JsonObject = { enabled: config.enabled, signals: [...config.signals] };
  if (config.route) out.route = { provider: config.route.provider, connectionId: config.route.connectionId, model: config.route.model };
  if (config.template !== undefined) out.template = config.template;
  if (config.maxTokens !== undefined) out.maxTokens = config.maxTokens;
  if (config.lore) out.lore = { policy: config.lore.policy, tokens: config.lore.tokens, ...(config.lore.transport ? { transport: config.lore.transport } : {}) };
  return out;
}

export function StepsSection(props: { modelUse: ModelUseSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const app = useApp();
  const [connections, setConnections] = useState<{ id: string; name: string; model: string | null }[]>([]);
  const [open, setOpen] = useState<StepPurpose | null>(null);
  useEffect(() => {
    void app.host.connections().then(setConnections);
  }, []);
  const update = (purpose: StepPurpose, next: StepConfig) => props.patch({ modelUse: { preset: "custom", steps: { [purpose]: stepPatch(next) } } });
  return (
    <div class="lre-list">
      {(Object.keys(STEP_LABEL) as StepPurpose[]).map((purpose) => {
        const config: StepConfig = props.modelUse.steps[purpose] ?? { enabled: false, signals: [] };
        const route = config.route ?? { provider: purpose === "npc.choose" ? "decision" : "helper", connectionId: null, model: null };
        const lowTokens = config.maxTokens !== undefined && config.maxTokens < 1500;
        const lore = stepLoreOf(config);
        return (
          <div key={purpose} class="lre-card" data-lre-step={purpose}>
            <button type="button" class="lre-item" style={{ border: 0, background: "transparent", padding: "0" }} aria-expanded={open === purpose} onClick={() => setOpen(open === purpose ? null : purpose)}>
              <span class="grow">
                <span class="title">{STEP_LABEL[purpose]}</span>
                <span class="sub">
                  {config.enabled ? `${route.provider === "decision" ? "Decision" : "Helper"}${route.connectionId ? ` · ${connections.find((c) => c.id === route.connectionId)?.name ?? route.connectionId}` : " · default connection"}` : "Off"}
                </span>
              </span>
              {lowTokens ? <span class="lre-badge warn">max tokens</span> : null}
              <span class="lre-dim" aria-hidden="true">
                {open === purpose ? "▴" : "▾"}
              </span>
            </button>
            {open === purpose ? (
              <div class="lre-stack" style={{ marginTop: "8px" }}>
                <HostSwitch label="Enabled" checked={config.enabled} disabled={props.busy} onChange={(enabled) => update(purpose, { ...config, enabled })} />
                <Seg<"decision" | "helper">
                  label="Provider"
                  value={route.provider}
                  options={[
                    { value: "decision", label: "Decision" },
                    { value: "helper", label: "Helper" },
                  ]}
                  disabled={props.busy}
                  onChange={(provider) => update(purpose, { ...config, route: { ...route, provider } })}
                />
                <label class="lre-field">
                  <span class="label">Connection</span>
                  <select class="lre-input" value={route.connectionId ?? ""} disabled={props.busy} onChange={(event) => update(purpose, { ...config, route: { ...route, connectionId: event.currentTarget.value || null, model: null } })}>
                    <option value="">Default (the chat's helper)</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.model ? ` — ${c.model}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {route.connectionId ? <HostModelPicker connectionId={route.connectionId} value={route.model ?? ""} label="Model" onChange={(model) => update(purpose, { ...config, route: { ...route, model: model || null } })} /> : null}
                <NumberStepper label="Max tokens" value={config.maxTokens ?? null} min={64} max={32000} step={100} integer disabled={props.busy} onChange={(maxTokens) => update(purpose, { ...config, maxTokens })} />
                <Seg<LorePolicy> label="Lore" value={lore.policy} options={LORE_POLICY} disabled={props.busy} onChange={(policy) => update(purpose, { ...config, lore: { ...lore, policy } })} />
                {lore.policy !== "none" ? <NumberStepper label="Lore tokens" value={lore.tokens} min={0} max={8000} step={50} integer disabled={props.busy} onChange={(tokens) => update(purpose, { ...config, lore: { ...lore, tokens } })} /> : null}
                {lore.policy === "lookup" || lore.policy === "prefetch+lookup" ? <Seg<LoreTransport> label="Lookups by" value={lore.transport ?? "auto"} options={LORE_TRANSPORT} disabled={props.busy} onChange={(transport) => update(purpose, { ...config, lore: { ...lore, transport } })} /> : null}
                {lore.policy !== "none" && PROSE_STEPS.includes(purpose) ? <div class="lre-small lre-muted">Reads no secret lore: what it writes reaches the narrator or the player.</div> : null}
                {lowTokens ? <div class="lre-small lre-warn">Reasoning models need about 1,500 or more; below that, calls can come back empty.</div> : null}
                <label class="lre-field">
                  <span class="label">Signals (comma separated)</span>
                  <input
                    class="lre-input"
                    value={config.signals.join(", ")}
                    disabled={props.busy}
                    onChange={(event) =>
                      update(purpose, {
                        ...config,
                        signals: event.currentTarget.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter((s) => s.length > 0),
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
