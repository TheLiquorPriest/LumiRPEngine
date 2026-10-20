// Settings → Model use and Settings → Steps and connections (DESIGN §5.3, §5.4, D25).
// Model use leads with the preset (Lean, Standard, Full, Custom) and what each one means for you,
// then the call meter; budgets per phase (calls, wall clock and lore lookups) and the engine token
// budget sit under Advanced. Steps and connections has a card per step: enabled, provider,
// connection, model and max tokens (≥1,500 for reasoning models, DESIGN §5.3), with signals and
// lore (the policy, its tokens and how lookups reach the model) under Advanced.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { ModelUsePresetId } from "../../shared/ids";
import { PROSE_STEPS } from "../../shared/lore";
import type { LorePolicy, LoreTransport, ModelUseSettings, StepConfig } from "../../shared/settings";
import { PRE_REPLY_MAX_MS, stepConfigOf, stepLoreOf } from "../../shared/settings";
import type { CallMeterView } from "../../shared/state-view";
import type { StepPurpose } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Disclosure, Empty, Field, HostModelPicker, HostSwitch, NumberStepper, Section, Seg } from "../components";
import { Icon } from "../icons";

const PRESETS: { value: ModelUsePresetId; label: string }[] = [
  { value: "lean", label: "Lean" },
  { value: "standard", label: "Standard" },
  { value: "full", label: "Full" },
  { value: "custom", label: "Custom" },
];

/** What a preset means for play, in plain words: the first thing each preset card says. */
const PRESET_PLAIN: Record<ModelUsePresetId, string> = {
  lean: "The fewest calls: quickest and cheapest. A model reads your typed actions and the reply; people's choices follow the engine's own rules.",
  standard: "The default. A model also judges your approach when the rules for checks need it, and decides close calls for the people around you.",
  full: "The most calls, so the slowest and costliest. A model reads every message you type, decides for everyone present, writes a brief and an outline for the narrator, and checks the reply against the facts.",
  custom: "Your own mix, set step by step in Steps and connections.",
};

/** Each preset's exact ceiling; the test in test/backend/presets.test.ts holds it to the preset's steps and budgets. */
export const PRESET_NOTE: Record<ModelUsePresetId, string> = {
  lean: "Narrator + up to 2 model steps a turn, and no lore lookups: helpers get the lore their inputs find. The floor: it doesn't meet “a model decides” on its own. The call meter shows each turn's real count.",
  standard: "Narrator + up to 4 model steps a turn, plus up to 3 lore lookups. The call meter shows each turn's real count.",
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
  mind: "Character minds",
  memory: "Character memory",
  skip: "Time-skip beats",
  consolidate: "Memory consolidation",
};

/** What each step does, in a line (docs/USER-GUIDE.md, The steps). */
const STEP_PLAIN: Record<StepPurpose, string> = {
  interpret: "Before the reply: reads what you type as the actions it takes.",
  "npc.choose": "Picks what someone does on a close call or an invitation: before the reply for people with you, after it for people elsewhere.",
  contradiction: "After the reply: checks it against the established facts.",
  "puzzle.answer": "Before the reply: judges a free-text puzzle answer, for puzzles that ask for it.",
  brief: "Before the reply: writes a short briefing for the narrator.",
  outline: "Before the reply: writes a prose outline for the narrator.",
  extract: "After the reply: reads it for changes to the world.",
  choices: "After the reply: offers next steps as suggested choices.",
  judge: "Before the reply: rates how well you describe your approach to a check.",
  mind: "Before the reply: one call per character, as that character: what they think, how they come across, what they mean to do.",
  memory: "After the reply: the notes, commitments and plans each character who heard your message takes from it, at the levels you pick.",
  skip: "Before a time skip, once you turn it on: further moments in it worth stopping at.",
  consolidate: "Folds a character's faded and surplus notes into their summary.",
};

const PHASES = ["pre", "post"] as const;
const PHASE_LABEL: Record<(typeof PHASES)[number], string> = { pre: "Before the reply", post: "After the reply" };
/** Lumiverse waits at most 120 s for a turn's plan, so the before-the-reply steps get what planning leaves of it. */
const WALL_CLOCK_MAX: Record<(typeof PHASES)[number], number> = { pre: PRE_REPLY_MAX_MS, post: 120_000 };

/** The preset cards: one choice from four, each saying what it means before its exact ceiling. */
function PresetCards(props: { value: ModelUsePresetId; busy: boolean; onChange(preset: ModelUsePresetId): void }) {
  return (
    <div class="lre-set-presets" role="radiogroup" aria-label="Model use preset">
      {PRESETS.map((preset) => {
        const checked = preset.value === props.value;
        return (
          <button key={preset.value} type="button" role="radio" aria-checked={checked} class="lre-set-preset" data-lre-preset={preset.value} disabled={props.busy} onClick={() => (checked ? undefined : props.onChange(preset.value))}>
            <span class="lre-set-preset-head">
              <span class="lre-set-preset-name">{preset.label}</span>
              {checked ? (
                <span class="lre-set-preset-mark">
                  <Icon name="check" size={16} />
                  In use
                </span>
              ) : null}
            </span>
            <span class="lre-set-preset-plain">{PRESET_PLAIN[preset.value]}</span>
            <span class="lre-set-preset-note">{PRESET_NOTE[preset.value]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ModelUseSection(props: { modelUse: ModelUseSettings; meter: CallMeterView | null; patch(patch: JsonObject): void; busy: boolean }) {
  const { modelUse } = props;
  return (
    <div class="lre-stack" data-lre-settings-page="model">
      <p class="lre-set-lead">The engine does most of its work without the AI. When it asks a model, it makes small calls, each with one job. A preset sets how many it may make.</p>
      <PresetCards value={modelUse.preset} busy={props.busy} onChange={(preset) => props.patch({ modelUse: { preset } })} />
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        Picking Lean, Standard or Full replaces every step's settings with the preset's, connections and models included. Changing a step or a budget makes it Custom.
      </p>
      <Section title="Call meter">{props.meter ? <CallMeter meter={props.meter} /> : <Empty icon="pulse">The call meter fills in once a world chat has run a turn.</Empty>}</Section>
      <Section>
        <Disclosure summary="Advanced: budgets and the engine budget">
          <p class="lre-small lre-muted" style={{ margin: 0 }}>
            Each phase of a turn has a number of calls and a time limit; lore lookups have their own. A step runs only while its phase has calls left.
          </p>
          {PHASES.map((phase) => (
            <div key={phase} class="lre-set-group" data-lre-budget={phase}>
              <div class="lre-h">{PHASE_LABEL[phase]}</div>
              <NumberStepper label="Calls" value={modelUse.budgets[phase].calls} min={0} max={20} integer disabled={props.busy} onChange={(calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { calls } } } })} />
              <NumberStepper label="Wall clock (ms)" value={modelUse.budgets[phase].ms} min={500} max={WALL_CLOCK_MAX[phase]} step={500} integer disabled={props.busy} onChange={(ms) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { ms } } } })} />
              {phase === "pre" ? <p class="lre-small lre-muted" style={{ margin: 0 }}>At most {PRE_REPLY_MAX_MS.toLocaleString("en-US")} ms: Lumiverse waits 120 s for a turn's plan, and planning needs the rest.</p> : null}
              <NumberStepper label="Lore lookups" value={modelUse.budgets[phase].lookup?.calls ?? 0} min={0} max={10} integer disabled={props.busy} onChange={(calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { lookup: { calls, ms: modelUse.budgets[phase].lookup?.ms ?? 0 } } } } })} />
              <NumberStepper label="Lookups may start within (ms)" value={modelUse.budgets[phase].lookup?.ms ?? 0} min={0} max={120000} step={500} integer disabled={props.busy} onChange={(ms) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { lookup: { calls: modelUse.budgets[phase].lookup?.calls ?? 0, ms } } } } })} />
            </div>
          ))}
          <div class="lre-set-group">
            <div class="lre-h">Engine budget (tokens)</div>
            <p class="lre-small lre-muted" style={{ margin: 0 }}>
              How much of the prompt the engine's own sections may take.
            </p>
            <NumberStepper label="Sections" value={modelUse.tokens.sections} min={100} max={8000} step={50} integer disabled={props.busy} onChange={(sections) => props.patch({ modelUse: { preset: "custom", tokens: { sections } } })} />
          </div>
        </Disclosure>
      </Section>
    </div>
  );
}

function CallMeter(props: { meter: CallMeterView }) {
  const rows = [
    ["This turn", props.meter.turn],
    ["Average", props.meter.average],
    ["95th pct", props.meter.p95],
  ] as const;
  return (
    <div class="lre-stack">
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        Every engine model call, not the narrator's. If a preset costs more than you want, this is where you see it.
      </p>
      <div class="lre-set-meter" role="table" aria-label="Call meter">
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
            <span role="rowheader" class="rh">
              {label}
            </span>
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

/** A step card's change as a settings patch: the card's whole config, dropping absent optional fields, under Custom. */
export function stepUpdatePatch(purpose: StepPurpose, config: StepConfig): JsonObject {
  const out: JsonObject = { enabled: config.enabled, signals: [...config.signals] };
  if (config.route) out.route = { provider: config.route.provider, connectionId: config.route.connectionId, model: config.route.model };
  if (config.template !== undefined) out.template = config.template;
  if (config.maxTokens !== undefined) out.maxTokens = config.maxTokens;
  if (config.lore) out.lore = { policy: config.lore.policy, tokens: config.lore.tokens, ...(config.lore.transport ? { transport: config.lore.transport } : {}) };
  return { modelUse: { preset: "custom", steps: { [purpose]: out } } };
}

type Connection = { id: string; name: string; model: string | null };

export function StepsSection(props: { modelUse: ModelUseSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const app = useApp();
  const [connections, setConnections] = useState<Connection[]>([]);
  useEffect(() => {
    void app.host.connections().then(setConnections);
  }, []);
  const update = (purpose: StepPurpose, next: StepConfig) => props.patch(stepUpdatePatch(purpose, next));
  return (
    <div class="lre-stack" data-lre-settings-page="steps">
      <p class="lre-set-lead">Each step is one small job a model can do, on the connection and model you choose. Changing a step makes your model use Custom.</p>
      {(Object.keys(STEP_LABEL) as StepPurpose[]).map((purpose) => (
        <StepCard key={purpose} purpose={purpose} config={stepConfigOf(props.modelUse.steps, purpose)} connections={connections} busy={props.busy} update={(next) => update(purpose, next)} />
      ))}
    </div>
  );
}

function StepCard(props: { purpose: StepPurpose; config: StepConfig; connections: readonly Connection[]; busy: boolean; update(next: StepConfig): void }) {
  const { purpose, config, busy, update } = props;
  const route = config.route ?? { provider: purpose === "npc.choose" ? "decision" : "helper", connectionId: null, model: null };
  const lowTokens = config.maxTokens !== undefined && config.maxTokens < 1500;
  const lore = stepLoreOf(config);
  const connection = route.connectionId ? (props.connections.find((c) => c.id === route.connectionId)?.name ?? route.connectionId) : "default connection";
  const summary = config.enabled ? `${route.provider === "decision" ? "Decision" : "Helper"} · ${connection}${route.model ? ` · ${route.model}` : ""}` : "Off";
  return (
    <div class="lre-card lre-set-step" data-lre-step={purpose}>
      <Disclosure
        summary={
          <span class="lre-set-step-head">
            <span class="lre-set-step-text">
              <span class="lre-set-step-title">{STEP_LABEL[purpose]}</span>
              <span class="lre-set-step-sub">{summary}</span>
            </span>
            {!config.enabled ? <Badge>Off</Badge> : null}
            {lowTokens ? (
              <Badge tone="warn">
                <Icon name="alert" size={16} />
                Max tokens
              </Badge>
            ) : null}
          </span>
        }
      >
        <p class="lre-small lre-muted" style={{ margin: 0 }}>
          {STEP_PLAIN[purpose]}
        </p>
        <HostSwitch label="Enabled" checked={config.enabled} disabled={busy} onChange={(enabled) => update({ ...config, enabled })} />
        <Field label="Provider" help={route.provider === "decision" ? "Lumiverse's Decisions API; falls back to the helper if a call fails." : "A small JSON call on the connection below."}>
          <Seg<"decision" | "helper">
            label="Provider"
            value={route.provider}
            options={[
              { value: "decision", label: "Decision" },
              { value: "helper", label: "Helper" },
            ]}
            disabled={busy}
            onChange={(provider) => update({ ...config, route: { ...route, provider } })}
          />
        </Field>
        <label class="lre-field">
          <span class="label">Connection</span>
          <select class="lre-input" value={route.connectionId ?? ""} disabled={busy} onChange={(event) => update({ ...config, route: { ...route, connectionId: event.currentTarget.value || null, model: null } })}>
            <option value="">Default (the chat's helper)</option>
            {props.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.model ? ` — ${c.model}` : ""}
              </option>
            ))}
          </select>
        </label>
        {route.connectionId ? <HostModelPicker connectionId={route.connectionId} value={route.model ?? ""} label="Model" onChange={(model) => update({ ...config, route: { ...route, model: model || null } })} /> : null}
        <NumberStepper label="Max tokens" value={config.maxTokens ?? null} min={64} max={32000} step={100} integer disabled={busy} onChange={(maxTokens) => update({ ...config, maxTokens })} />
        {lowTokens ? (
          <div class="lre-set-warn" role="note">
            <Icon name="alert" size={16} />
            <span>Reasoning models need about 1,500 or more; below that, calls can come back empty.</span>
          </div>
        ) : null}
        <Disclosure summary="Advanced: signals and lore">
          <label class="lre-field">
            <span class="label">Signals (comma separated)</span>
            <input
              class="lre-input"
              value={config.signals.join(", ")}
              disabled={busy}
              onChange={(event) =>
                update({
                  ...config,
                  signals: event.currentTarget.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                })
              }
            />
            <span class="lre-field-help">The step runs when one of these fires. “always” fires every turn; “never” turns the step off and wins over the rest.</span>
          </label>
          <Field label="Lore">
            <Seg<LorePolicy> label="Lore" value={lore.policy} options={LORE_POLICY} disabled={busy} onChange={(policy) => update({ ...config, lore: { ...lore, policy } })} />
          </Field>
          {lore.policy !== "none" ? <NumberStepper label="Lore tokens" value={lore.tokens} min={0} max={8000} step={50} integer disabled={busy} onChange={(tokens) => update({ ...config, lore: { ...lore, tokens } })} /> : null}
          {lore.policy === "lookup" || lore.policy === "prefetch+lookup" ? (
            <Field label="Lookups by">
              <Seg<LoreTransport> label="Lookups by" value={lore.transport ?? "auto"} options={LORE_TRANSPORT} disabled={busy} onChange={(transport) => update({ ...config, lore: { ...lore, transport } })} />
            </Field>
          ) : null}
          {lore.policy !== "none" && PROSE_STEPS.includes(purpose) ? <div class="lre-small lre-muted">Reads no secret lore: what it writes reaches the narrator or the player.</div> : null}
        </Disclosure>
      </Disclosure>
    </div>
  );
}
