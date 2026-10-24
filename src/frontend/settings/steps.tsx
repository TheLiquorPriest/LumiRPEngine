// Settings → Helper model, Settings → Model use and Settings → Steps and connections (DESIGN §5.3,
// §5.4, D25). Helper model sets the connection, model and reasoning effort every helper call runs
// on unless its step picks its own. Model use leads with the preset (Lean, Standard, Full, Custom)
// and what each one means for you, then the call meter; budgets per phase (calls and lore lookups),
// a link to Settings → Timeouts for how long each may take, and the engine token budget sit under
// Advanced. Steps and connections has a card per step: enabled, provider, connection, model,
// reasoning effort and max tokens (several thousand for reasoning models, DESIGN §5.3), with signals
// and lore (the policy, its tokens and how lookups reach the model) under Advanced. Each card's
// summary names the connection, model and effort it runs on.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { ModelUsePresetId } from "../../shared/ids";
import { PROSE_STEPS } from "../../shared/lore";
import { isMindPurpose } from "../../shared/minds";
import type { ComponentChildren } from "preact";
import type { HelperDefault, JobSettings, LorePolicy, LoreTransport, ModelUseSettings, ReasoningChoice, SamplingParams, StepConfig, StepRoute } from "../../shared/settings";
import { DEFAULT_RECENT, helperCallOf, JOB_SETTINGS_DEFAULTS, REASONING_CHOICES, recentOf, SAMPLING_PARAMS, stepConfigOf, stepLoreOf } from "../../shared/settings";
import { LimitField, MindPromptEditor } from "./minds";
import type { MindsSettings } from "../../shared/minds";
import { SKIP_PLAN_PROMPT } from "../../shared/skip-plan";
import { PROMPT_EFFECT, PROSE_PROMPTS, STEP_LABEL } from "../../shared/steps";
import { PromptEditor } from "./prompt-editor";
import type { CallMeterView } from "../../shared/state-view";
import type { StepPurpose } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Disclosure, Empty, Field, HostModelPicker, HostSwitch, List, ListRow, NumberStepper, Section, Seg } from "../components";
import { Icon } from "../icons";

const PRESETS: { value: ModelUsePresetId; label: string }[] = [
  { value: "lean", label: "Lean" },
  { value: "standard", label: "Standard" },
  { value: "full", label: "Full" },
  { value: "custom", label: "Custom" },
];

/** What a preset means for play, in plain words: the first thing each preset card says. */
const PRESET_PLAIN: Record<ModelUsePresetId, string> = {
  lean: "The fewest calls: quickest and cheapest. A model reads each message you type for its actions, and the reply; people's choices follow the engine's own rules.",
  standard: "The default. A model also judges your approach when the rules for checks need it, and decides close calls for the people around you.",
  full: "The most calls, so the slowest and costliest. A model decides for everyone present, writes a brief and an outline for the narrator, and checks the reply against the facts.",
  custom: "Your own mix, set step by step in Steps and connections.",
};

/** Each preset's exact ceiling; the test in test/backend/presets.test.ts holds it to the preset's steps and budgets. */
export const PRESET_NOTE: Record<ModelUsePresetId, string> = {
  lean: "Narrator + up to 2 model steps a turn, and no lore lookups: helpers get the lore their inputs find. The floor: it doesn't meet “a model decides” on its own. The call meter shows each turn's real count.",
  standard: "Narrator + up to 4 model steps a turn, plus up to 7 lore lookups. The call meter shows each turn's real count.",
  full: "Narrator + up to 9 model steps a turn, plus up to 10 lore lookups. The call meter shows each turn's real count.",
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
/** Below this, a reasoning model can spend the whole reply thinking and answer nothing. */
const LOW_TOKENS = 4096;

export const EFFORT_LABEL: Record<ReasoningChoice, string> = { inherit: "Connection's own", off: "Off", auto: "Auto", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", max: "Max", xhigh: "Extra high" };

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

export function ModelUseSection(props: { modelUse: ModelUseSettings; meter: CallMeterView | null; patch(patch: JsonObject): void; openTimeouts(): void; busy: boolean }) {
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
            Each phase of a turn has a number of calls; lore lookups have their own. A step runs only while its phase has calls left. How long each phase and its lookups may take is set in Timeouts, apart from the presets.
          </p>
          <List>
            <ListRow icon="clock" title="Timeouts" subtitle="How long the engine run, reading the reply and their lookups may take" chevron onClick={props.openTimeouts} />
          </List>
          {PHASES.map((phase) => (
            <div key={phase} class="lre-set-group" data-lre-budget={phase}>
              <div class="lre-h">{PHASE_LABEL[phase]}</div>
              <NumberStepper label="Calls" value={modelUse.budgets[phase].calls} min={0} integer disabled={props.busy} onChange={(calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { calls } } } })} />
              <NumberStepper label="Lore lookups" value={modelUse.budgets[phase].lookup?.calls ?? 0} min={0} integer disabled={props.busy} onChange={(calls) => props.patch({ modelUse: { preset: "custom", budgets: { [phase]: { lookup: { calls } } } } })} />
            </div>
          ))}
          <div class="lre-set-group">
            <div class="lre-h">Engine budget (tokens)</div>
            <p class="lre-small lre-muted" style={{ margin: 0 }}>
              How much of the prompt the engine's own sections may take.
            </p>
            <NumberStepper label="Sections" value={modelUse.tokens.sections} min={100} step={100} integer disabled={props.busy} onChange={(sections) => props.patch({ modelUse: { preset: "custom", tokens: { sections } } })} />
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

/** A step card's change as a settings patch: the card's whole config under Custom. What the step leaves to the helper model (effort, max tokens, each parameter) is deleted. */
export function stepUpdatePatch(purpose: StepPurpose, config: StepConfig): JsonObject {
  const out: JsonObject = { enabled: config.enabled, signals: [...config.signals], maxTokens: config.maxTokens ?? null };
  if (config.route) {
    const params: JsonObject = {};
    for (const p of SAMPLING_PARAMS) params[p.key] = config.route.params?.[p.key] ?? null;
    out.route = { provider: config.route.provider, connectionId: config.route.connectionId, model: config.route.model, effort: config.route.effort ?? null, params };
  }
  if (config.template !== undefined) out.template = config.template;
  if (config.lore) out.lore = { policy: config.lore.policy, tokens: config.lore.tokens, ...(config.lore.transport ? { transport: config.lore.transport } : {}) };
  if (config.recent) out.recent = { on: config.recent.on, messages: config.recent.messages, tokens: config.recent.tokens };
  return { modelUse: { preset: "custom", steps: { [purpose]: out } } };
}

export type Connection = { id: string; name: string; model: string | null };

export function useConnections(): Connection[] {
  const app = useApp();
  const [connections, setConnections] = useState<Connection[]>([]);
  useEffect(() => {
    void app.host.connections().then(setConnections);
  }, []);
  return connections;
}

/** Where a helper call runs, in words: the connection's name (or Lumiverse's default), and the model when one is known. */
function placeOf(call: { connectionId: string | null; model: string | null }, connections: readonly Connection[]): string {
  if (!call.connectionId) return "Lumiverse's default connection";
  const c = connections.find((x) => x.id === call.connectionId);
  const model = call.model ?? c?.model ?? null;
  return `${c?.name ?? call.connectionId}${model ? ` · ${model}` : ""}`;
}

/** A call's parameters in a line: effort, max tokens and each sampling parameter it sets. */
function paramsSummary(call: { effort: ReasoningChoice; maxTokens: number; params: SamplingParams }): string {
  const set = SAMPLING_PARAMS.flatMap((p) => (call.params[p.key] !== undefined ? [`${p.label.toLowerCase()} ${String(call.params[p.key])}`] : []));
  return [`effort ${EFFORT_LABEL[call.effort].toLowerCase()}`, `${call.maxTokens.toLocaleString("en-US")} max tokens`, ...set].join(" · ");
}

/** The helper model in a line: where it runs and its parameters (Settings home, the Steps page). */
export function helperSummary(helper: Readonly<HelperDefault>, connections: readonly Connection[] = []): string {
  return `${placeOf(helper, connections)} · ${paramsSummary(helper)}`;
}

function EffortSelect(props: { label: string; value: ReasoningChoice | ""; inheritLabel?: string; disabled: boolean; onChange(effort: ReasoningChoice | ""): void }) {
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <select class="lre-input" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(REASONING_CHOICES.find((c) => c === event.currentTarget.value) ?? "")}>
        {props.inheritLabel !== undefined ? <option value="">{props.inheritLabel}</option> : null}
        {REASONING_CHOICES.map((c) => (
          <option key={c} value={c}>
            {EFFORT_LABEL[c]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A number that may be left to someone else (the connection, or the helper model): a switch, and the number while it's set here. */
function OptionalNumber(props: { label: string; otherLabel: string; value: number | undefined; min: number; max?: number; step: number; integer: boolean; fallback: number; disabled: boolean; onChange(next: number | undefined): void }) {
  return (
    <div class="lre-minds-limit">
      <HostSwitch label={`${props.label}: ${props.otherLabel}`} checked={props.value === undefined} disabled={props.disabled} onChange={(other) => props.onChange(other ? undefined : props.fallback)} />
      {props.value === undefined ? null : <NumberStepper label={props.label} value={props.value} min={props.min} max={props.max} step={props.step} integer={props.integer} disabled={props.disabled} onChange={props.onChange} />}
    </div>
  );
}

function ConnectionSelect(props: { value: string | null; connections: readonly Connection[]; firstLabel: string; help?: string; disabled: boolean; onChange(id: string | null): void }) {
  return (
    <label class="lre-field">
      <span class="label">Connection</span>
      <select class="lre-input" value={props.value ?? ""} disabled={props.disabled} onChange={(event) => props.onChange(event.currentTarget.value || null)}>
        <option value="">{props.firstLabel}</option>
        {props.connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.model ? ` — ${c.model}` : ""}
          </option>
        ))}
      </select>
      {props.help ? <span class="lre-field-help">{props.help}</span> : null}
    </label>
  );
}

/** Settings → Helper model: the connection, model and parameters every helper call runs with unless its step sets its own. */
export function HelperSection(props: { helper: HelperDefault; patch(patch: JsonObject): void; busy: boolean }) {
  const { helper, busy } = props;
  const connections = useConnections();
  const set = (next: JsonObject) => props.patch({ helper: next });
  return (
    <div class="lre-stack" data-lre-settings-page="helper">
      <p class="lre-set-lead">Every call the engine makes to a model for itself (reading your actions and the reply, deciding for people, judging, minds and their memory, time skips, lore lookups) runs on the helper model, unless its card in Steps and connections sets its own. Picking a preset never changes it.</p>
      <Section title="Connection and model">
        <ConnectionSelect value={helper.connectionId} connections={connections} firstLabel="None: Lumiverse's default connection" help="None runs each call on the connection Lumiverse marks as your default, with that connection's model and settings." disabled={busy} onChange={(connectionId) => set({ connectionId, model: null })} />
        {helper.connectionId ? (
          <>
            <HostModelPicker connectionId={helper.connectionId} value={helper.model ?? ""} label="Model" onChange={(model) => set({ model: model || null })} />
            <span class="lre-field-help">Pick from the connection's models, or type one. Empty uses the connection's own model.</span>
          </>
        ) : null}
      </Section>
      <Section title="Parameters">
        <EffortSelect label="Reasoning effort" value={helper.effort} disabled={busy} onChange={(effort) => set({ effort: effort === "" ? "inherit" : effort })} />
        <span class="lre-field-help">Sent as Lumiverse's reasoning setting, which it turns into the provider's own (DeepSeek reads Low to High as High, Max and Extra high as Max). Connection's own leaves the connection's reasoning setting as it is.</span>
        <NumberStepper label="Max tokens" value={helper.maxTokens} min={64} step={512} integer disabled={busy} onChange={(maxTokens) => set({ maxTokens })} />
        {helper.maxTokens < LOW_TOKENS ? (
          <div class="lre-set-warn" role="note">
            <Icon name="alert" size={16} />
            <span>Reasoning models think before they answer; below {LOW_TOKENS.toLocaleString("en-US")}, calls can come back empty.</span>
          </div>
        ) : null}
        {SAMPLING_PARAMS.map((p) => (
          <OptionalNumber key={p.key} label={p.label} otherLabel="the connection's own" value={helper.params[p.key]} min={p.min} max={p.max} step={p.step} integer={p.integer} fallback={p.fallback} disabled={busy} onChange={(value) => set({ params: { [p.key]: value ?? null } })} />
        ))}
        <span class="lre-field-help">A parameter left to the connection takes its preset's value. Lumiverse passes each one set here to the provider, which uses those it supports (Anthropic, for one, has no penalties). The Decisions API takes none of these: steps on it run with their connection's own settings.</span>
      </Section>
    </div>
  );
}

export function StepsSection(props: { modelUse: ModelUseSettings; helper: HelperDefault; jobs: JobSettings; prompts: MindsSettings["prompts"]; patch(patch: JsonObject): void; openHelper(): void; busy: boolean }) {
  const connections = useConnections();
  const update = (purpose: StepPurpose, next: StepConfig) => props.patch(stepUpdatePatch(purpose, next));
  return (
    <div class="lre-stack" data-lre-settings-page="steps">
      <p class="lre-set-lead">Each step is one small job a model can do. A helper step runs on the helper model, unless you set its own connection, model or parameters here. Changing a step makes your model use Custom; your own prompts stay whatever preset you pick.</p>
      <List>
        <ListRow icon="sliders" title="Helper model" subtitle={helperSummary(props.helper, connections)} chevron onClick={props.openHelper} />
      </List>
      {(Object.keys(STEP_LABEL) as StepPurpose[]).map((purpose) => (
        <StepCard key={purpose} purpose={purpose} config={stepConfigOf(props.modelUse.steps, purpose)} helper={props.helper} connections={connections} busy={props.busy} update={(next) => update(purpose, next)}>
          <StepPrompts purpose={purpose} config={stepConfigOf(props.modelUse.steps, purpose)} prompts={props.prompts} busy={props.busy} patch={props.patch} />
        </StepCard>
      ))}
      {/* Build's jobs take the brief step's connection and max tokens above; what they read is set here, apart from the presets. */}
      <Section title="Build jobs">
        <LimitField
          label="Lore each person or group reads (tokens)"
          noneLabel="all of it"
          value={props.jobs.routineLoreTokens}
          min={1}
          step={500}
          fallback={JOB_SETTINGS_DEFAULTS.routineLoreTokens}
          disabled={props.busy}
          onChange={(routineLoreTokens) => props.patch({ jobs: { routineLoreTokens } })}
        />
        <p class="lre-small lre-muted" style={{ margin: 0 }}>
          Propose routines from lore gives the AI each person's and group's lore in whole entries, the most about them first, up to this many tokens. What doesn't fit is left out, and the job says whose. People whose lore fills it get a call of their own.
        </p>
      </Section>
    </div>
  );
}

/** The longest own prompt a step keeps (`settings-store` cuts there), as a minds prompt's. */
const STEP_PROMPT_MAX = 20_000;

/** A step's own prompt (`template`) as a settings patch: null, blank or the built-in clears it, so the world's template or the built-in runs; null when it's too long. */
export function stepPromptPatch(purpose: StepPurpose, text: string | null, builtIn: string | undefined): JsonObject | null {
  if (text !== null && text.length > STEP_PROMPT_MAX) return null;
  const own = text === null || text.trim() === "" || (builtIn !== undefined && text.trim() === builtIn.trim()) ? null : text;
  return { modelUse: { steps: { [purpose]: { template: own } } } };
}

/**
 * A step card's prompts (DESIGN §5.2): the user's own, which wins over the world's template and that
 * over the built-in. A mind's, a memory's and consolidation's are Settings → Minds' (the same
 * prompt); the time-skip step has its beats' (Settings → Minds' too) and the skip plan's.
 */
function StepPrompts(props: { purpose: StepPurpose; config: StepConfig; prompts: MindsSettings["prompts"]; busy: boolean; patch(patch: JsonObject): void }) {
  const { purpose, busy } = props;
  if (purpose === "mind" || purpose === "memory" || purpose === "consolidate") return <MindPromptEditor purpose={purpose} value={props.prompts[purpose]} busy={busy} patch={props.patch} />;
  const builtIn = purpose === "skip" ? SKIP_PLAN_PROMPT : purpose === "brief" || purpose === "outline" || purpose === "choices" ? PROSE_PROMPTS[purpose] : undefined;
  const own = (
    <PromptEditor
      id={purpose === "skip" ? "skip_plan" : purpose}
      label={purpose === "skip" ? "The skip plan" : "Your prompt"}
      note={purpose === "skip" ? "As a time skip starts, how the people the model plans spend it. Replaces the built-in instructions; the answer format stays." : `${PROMPT_EFFECT[purpose]} It wins over the world's step template.`}
      builtIn={builtIn}
      value={props.config.template}
      max={STEP_PROMPT_MAX}
      vars={purpose === "skip" ? "skip_plan" : purpose}
      busy={busy}
      save={(text) => stepPromptPatch(purpose, text, builtIn)}
      patch={props.patch}
    />
  );
  return purpose === "skip" ? (
    <>
      <MindPromptEditor purpose="skip" value={props.prompts.skip} busy={busy} patch={props.patch} />
      {own}
    </>
  ) : (
    own
  );
}

function StepCard(props: { purpose: StepPurpose; config: StepConfig; helper: HelperDefault; connections: readonly Connection[]; busy: boolean; update(next: StepConfig): void; children?: ComponentChildren }) {
  const { purpose, config, busy, update } = props;
  const route: StepRoute = config.route ?? { provider: purpose === "npc.choose" ? "decision" : "helper", connectionId: null, model: null };
  const call = helperCallOf({ ...config, route }, props.helper);
  const lowTokens = route.provider === "helper" && call.maxTokens < LOW_TOKENS;
  const lore = stepLoreOf(config);
  const recent = recentOf(purpose, config);
  const where = route.provider === "decision" ? `Decision · ${route.connectionId ? placeOf(route, props.connections) : "the Decisions API's default"}` : `Helper · ${placeOf(call, props.connections)} · ${paramsSummary(call)}`;
  const summary = config.enabled ? where : "Off";
  const setParam = (key: keyof SamplingParams, value: number | undefined) => {
    const params: SamplingParams = { ...route.params };
    if (value === undefined) delete params[key];
    else params[key] = value;
    update({ ...config, route: { ...route, params } });
  };
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
        <Field label="Provider" help={route.provider === "decision" ? "Lumiverse's Decisions API, which takes no reasoning effort, max tokens or sampling parameters; if a call fails, the helper model answers instead." : "A small JSON call, on the helper model unless you set this step's own below."}>
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
        <ConnectionSelect value={route.connectionId} connections={props.connections} firstLabel={route.provider === "decision" ? "The Decisions API's default" : `Use helper default (${placeOf(props.helper, props.connections)})`} disabled={busy} onChange={(connectionId) => update({ ...config, route: { ...route, connectionId, model: null } })} />
        {route.connectionId ? <HostModelPicker connectionId={route.connectionId} value={route.model ?? ""} label="Model" onChange={(model) => update({ ...config, route: { ...route, model: model || null } })} /> : null}
        {route.provider === "helper" ? (
          <>
            <EffortSelect label="Reasoning effort" value={route.effort ?? ""} inheritLabel={`Use helper default (${EFFORT_LABEL[props.helper.effort]})`} disabled={busy} onChange={(effort) => update({ ...config, route: { ...route, effort: effort === "" ? undefined : effort } })} />
            <OptionalNumber label="Max tokens" otherLabel={`use helper default (${props.helper.maxTokens.toLocaleString("en-US")})`} value={config.maxTokens} min={64} step={512} integer fallback={props.helper.maxTokens} disabled={busy} onChange={(maxTokens) => update({ ...config, maxTokens })} />
            {lowTokens ? (
              <div class="lre-set-warn" role="note">
                <Icon name="alert" size={16} />
                <span>Reasoning models think before they answer and need several thousand; below {LOW_TOKENS.toLocaleString("en-US")}, calls can come back empty.</span>
              </div>
            ) : null}
            <Disclosure summary="Sampling parameters">
              {SAMPLING_PARAMS.map((p) => (
                <OptionalNumber key={p.key} label={p.label} otherLabel={`use helper default (${String(props.helper.params[p.key] ?? "the connection's own")})`} value={route.params?.[p.key]} min={p.min} max={p.max} step={p.step} integer={p.integer} fallback={props.helper.params[p.key] ?? p.fallback} disabled={busy} onChange={(value) => setParam(p.key, value)} />
              ))}
            </Disclosure>
          </>
        ) : null}
        {isMindPurpose(purpose) ? null : (
          <Field label="Recent chat" help={purpose === "interpret" ? "The messages before yours it reads to work out what you mean (what she offered, there, him), newest first, stopping at whichever limit comes first." : "The messages before this turn's it reads with its own input, newest first, stopping at whichever limit comes first."}>
            <HostSwitch label="Reads recent chat" checked={recent.on} disabled={busy} onChange={(on) => update({ ...config, recent: { ...recent, on } })} />
            {recent.on ? (
              <>
                <LimitField label="Messages" noneLabel="no limit" value={recent.messages} min={0} step={1} fallback={DEFAULT_RECENT.messages} disabled={busy} onChange={(messages) => update({ ...config, recent: { ...recent, messages } })} />
                <LimitField label="Tokens" noneLabel="no limit" value={recent.tokens} min={0} step={500} fallback={DEFAULT_RECENT.tokens} disabled={busy} onChange={(tokens) => update({ ...config, recent: { ...recent, tokens } })} />
              </>
            ) : null}
          </Field>
        )}
        <Field label="Prompt">{props.children}</Field>
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
          {isMindPurpose(purpose) ? (
            // A minds step has no lore of its own: what a mind reads, its lore included, is Settings → Minds' (DESIGN §24.6).
            <div class="lre-small lre-muted">{purpose === "mind" ? "What a mind reads, its lore included, is set in Settings → Minds → What a mind reads." : "Reads only the lore pinned to it in Build → Pinned lore."}</div>
          ) : (
            <>
              <Field label="Lore">
                <Seg<LorePolicy> label="Lore" value={lore.policy} options={LORE_POLICY} disabled={busy} onChange={(policy) => update({ ...config, lore: { ...lore, policy } })} />
              </Field>
              {/* Lore pinned to the step (Build → Pinned lore) is read within these tokens whatever the policy, so they stay settable with lore off. */}
              <NumberStepper label="Lore tokens" value={lore.tokens} min={0} step={100} integer disabled={busy} onChange={(tokens) => update({ ...config, lore: { ...lore, tokens } })} />
              {lore.policy === "none" ? <div class="lre-small lre-muted">With lore off it reads only what is pinned to it in Build → Pinned lore, within these tokens.</div> : null}
              {lore.policy === "lookup" || lore.policy === "prefetch+lookup" ? (
                <Field label="Lookups by">
                  <Seg<LoreTransport> label="Lookups by" value={lore.transport ?? "auto"} options={LORE_TRANSPORT} disabled={busy} onChange={(transport) => update({ ...config, lore: { ...lore, transport } })} />
                </Field>
              ) : null}
              {lore.policy !== "none" && PROSE_STEPS.includes(purpose) ? <div class="lre-small lre-muted">Reads no secret lore: what it writes reaches the narrator or the player.</div> : null}
            </>
          )}
        </Disclosure>
      </Disclosure>
    </div>
  );
}
