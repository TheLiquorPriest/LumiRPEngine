// Settings → Agents → Assistant (AGENT-LOOP-PLAN §9, §15; INC1-SPEC C8, R6b): what the GM assistant
// (GM → Assistant) runs with, every setting kept under `agents.assistant` (shared/agent-settings.ts):
// the connection and model it runs on, its reasoning effort, whose knowledge its tools read the world
// with, how its changes land, how much of its conversation goes with each message, and its own limits
// over every agent's budget. Each shows its default; Default sends null, so the store reads the default
// back. Connection sends {connectionId, model: null}; model, effort, knowledge, apply and historyTokens
// each send that field; a limit of its own sends {budget: {[key]: value}}, and Every agent's sends
// {budget: {[key]: null}}, so every agent's limit applies again. The page keeps the connections hook;
// what renders and what is pressed (`AssistantSettingsBody`, `assistantPatch`, `assistantBudgetPatch`,
// and Settings → Agents' `OwnLimitRow`) is hook-free, so tests press it without a DOM. Styles: styles/settings.ts.

import type { AgentBudget, AgentEffort, AgentSettings, AssistantApply, AssistantSettings } from "../../shared/agent-settings";
import { AGENT_EFFORTS, ASSISTANT_APPLY, ASSISTANT_APPLY_LABELS, ASSISTANT_KNOWLEDGE_LABELS, BUDGET_DEFS, defaultAgentSettings, HISTORY_TOKENS_DEF } from "../../shared/agent-settings";
import type { JsonObject } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import { HostModelPicker, Section, Seg } from "../components";
import { defaultButton, LimitRow, OwnLimitRow } from "./agents";
import { type Connection, ConnectionSelect, placeOf, useConnections } from "./steps";

type Knowledge = AssistantSettings["knowledge"];

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings().assistant;

/** Where the assistant runs when no connection is chosen, as Settings → Helper model words it. */
const DEFAULT_PLACE = placeOf(DEFAULTS, []);

/** Each effort in the page's words; Settings → Agents → Roles and Main agent say them so too. */
export const EFFORT_LABEL: Record<AgentEffort, string> = { off: "Off", low: "Low", medium: "Medium", high: "High", model: "Set by the model", inherit: "Connection's own" };
const EFFORT_HELP: Record<AgentEffort, string> = {
  off: "The assistant answers without reasoning.",
  low: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  medium: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  high: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  model: "For a model that picks its own effort by its name: sent as Lumiverse's Auto.",
  inherit: "The connection's own reasoning setting, else yours in Lumiverse.",
};

/** The knowledge choices, in the order the page lists them. */
const KNOWLEDGE: readonly Knowledge[] = ["pov", "everyone", "gm"];
const KNOWLEDGE_CHOICES = KNOWLEDGE.map((value) => ({ value, label: ASSISTANT_KNOWLEDGE_LABELS[value] }));

const KNOWLEDGE_HELP: Record<Knowledge, string> = {
  pov: "Its tools read only what your character knows.",
  everyone: "Its tools read what anyone in the world knows, each secret marked with whom it's kept from.",
  gm: "Its tools read everything, secrets and all.",
};

const APPLY_CHOICES = ASSISTANT_APPLY.map((value) => ({ value, label: ASSISTANT_APPLY_LABELS[value] }));

const APPLY_HELP: Record<AssistantApply, string> = {
  ask: "Each change it proposes waits for you: Apply all, pick the ones you want, or No.",
  at_once: "Its changes are applied as soon as it answers, with an Undo chip, except a type of change set to Confirm in Settings → Changes from the reply, which waits for your Apply.",
};

/** Settings home's line for this page: where the assistant runs, whose knowledge it reads, and how its changes land. */
export function assistantSummary(assistant: AssistantSettings, connections: readonly Connection[]): string {
  // The page's labels, mid-line: only their first letter goes small ("Apply" and "Undo" name buttons).
  const knowledge = ASSISTANT_KNOWLEDGE_LABELS[assistant.knowledge];
  const apply = ASSISTANT_APPLY_LABELS[assistant.apply];
  return `${placeOf(assistant, connections)} · knowledge: ${knowledge.charAt(0).toLowerCase()}${knowledge.slice(1)} · changes: ${apply.charAt(0).toLowerCase()}${apply.slice(1)}`;
}

/** The settings patch (`lre.settings.set`) for some of the assistant's settings; a field sent as null is deleted, so the store reads its default. */
export function assistantPatch(fields: JsonObject): JsonObject {
  return { agents: { assistant: fields } };
}

/** The patch for one of the assistant's own budget limits: `value` sets its own, null goes back to every agent's. */
export function assistantBudgetPatch(key: keyof AgentBudget, value: Limit | null): JsonObject {
  return assistantPatch({ budget: { [key]: value } });
}

/** The page's controls, without hooks: each one patches `agents.assistant` through `patch`. */
export function AssistantSettingsBody(props: { agents: AgentSettings; connections: readonly Connection[]; patch(patch: JsonObject): void; busy: boolean }) {
  const { agents, busy } = props;
  const a = agents.assistant;
  const set = (fields: JsonObject) => props.patch(assistantPatch(fields));
  const budgetKeys = Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[];
  return (
    <>
      <Section title="Model" flush>
        <div class="lre-set-rows">
          <div class="lre-set-ext" data-lre-assistant-setting="connection">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Connection and model</span>
              {a.connectionId === DEFAULTS.connectionId && a.model === DEFAULTS.model ? null : defaultButton(`Reset the connection and model to their default, ${DEFAULT_PLACE}`, busy, () => set({ connectionId: null, model: null }))}
            </div>
            <ConnectionSelect value={a.connectionId} connections={props.connections} firstLabel="None: Lumiverse's default connection" help="None runs the assistant on the connection Lumiverse marks as your default, with that connection's model and settings." disabled={busy} onChange={(connectionId) => set({ connectionId, model: null })} />
            {a.connectionId ? (
              <>
                <HostModelPicker connectionId={a.connectionId} value={a.model ?? ""} label="Model" onChange={(model) => set({ model: model || null })} />
                <span class="lre-field-help">Pick from the connection's models, or type one. Empty uses the connection's own model.</span>
              </>
            ) : null}
            <span class="lre-small lre-muted">Default: {DEFAULT_PLACE}, with that connection's model.</span>
          </div>
          <div class="lre-set-ext" data-lre-assistant-setting="effort">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Reasoning</span>
              {a.effort === DEFAULTS.effort ? null : defaultButton(`Reset reasoning effort to its default, ${EFFORT_LABEL[DEFAULTS.effort]}`, busy, () => set({ effort: null }))}
            </div>
            <label class="lre-field">
              <span class="label">Effort</span>
              <select
                class="lre-input"
                value={a.effort}
                disabled={busy}
                onChange={(event) => {
                  const effort = AGENT_EFFORTS.find((e) => e === event.currentTarget.value);
                  if (effort) set({ effort });
                }}
              >
                {AGENT_EFFORTS.map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABEL[e]}
                  </option>
                ))}
              </select>
              <span class="lre-field-help">{EFFORT_HELP[a.effort]}</span>
            </label>
            <span class="lre-small lre-muted">
              While Thinking in agent tool loops (Settings → Agents) is off, a call that offers tools goes with reasoning off, whatever this says; it's {agents.thinkingInToolLoops ? "on" : "off"} now. Default {EFFORT_LABEL[DEFAULTS.effort]}.
            </span>
          </div>
        </div>
      </Section>
      <Section title="Knowledge and changes" flush>
        <div class="lre-set-rows">
          <div class="lre-set-ext" data-lre-assistant-setting="knowledge">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Knowledge</span>
              {a.knowledge === DEFAULTS.knowledge ? null : defaultButton(`Reset whose knowledge it reads to its default, ${ASSISTANT_KNOWLEDGE_LABELS[DEFAULTS.knowledge]}`, busy, () => set({ knowledge: null }))}
            </div>
            <div class="lre-field">
              <Seg<Knowledge> label="Whose knowledge the assistant reads" value={a.knowledge} options={KNOWLEDGE_CHOICES} disabled={busy} onChange={(knowledge) => set({ knowledge })} />
              <span class="lre-field-help">{KNOWLEDGE_HELP[a.knowledge]}</span>
            </div>
            <span class="lre-small lre-muted">Default {ASSISTANT_KNOWLEDGE_LABELS[DEFAULTS.knowledge]}.</span>
          </div>
          <div class="lre-set-ext" data-lre-assistant-setting="apply">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">How its changes land</span>
              {a.apply === DEFAULTS.apply ? null : defaultButton(`Reset how its changes land to its default, ${ASSISTANT_APPLY_LABELS[DEFAULTS.apply]}`, busy, () => set({ apply: null }))}
            </div>
            <div class="lre-field">
              <Seg<AssistantApply> label="How the assistant's changes land" value={a.apply} options={APPLY_CHOICES} disabled={busy} onChange={(apply) => set({ apply })} />
              <span class="lre-field-help">{APPLY_HELP[a.apply]}</span>
            </div>
            <span class="lre-small lre-muted">Default {ASSISTANT_APPLY_LABELS[DEFAULTS.apply]}.</span>
          </div>
        </div>
      </Section>
      <Section title="Conversation" flush>
        <div class="lre-set-rows">
          <LimitRow id="historyTokens" def={HISTORY_TOKENS_DEF} value={a.historyTokens} standard={DEFAULTS.historyTokens} busy={busy} set={(historyTokens) => set({ historyTokens })} />
        </div>
      </Section>
      <Section title="Budget" flush>
        <div class="lre-set-rows lre-set-group" data-lre-agent-group="Assistant">
          <p class="lre-set-timeout-lead">What the assistant may spend answering each message you send it. Each limit is every agent's (Settings → Agents) until you change it here; Every agent's goes back to that one.</p>
          {budgetKeys.map((key) => (
            <OwnLimitRow key={key} id={key} owner="The assistant's" def={BUDGET_DEFS[key]} own={a.budget[key]} every={agents.budget[key]} busy={busy} outsideTurn set={(value) => props.patch(assistantBudgetPatch(key, value))} />
          ))}
        </div>
      </Section>
    </>
  );
}

/** Settings → Agents → Assistant: what the GM assistant runs with. */
export function AssistantPage(props: { agents: AgentSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const connections = useConnections();
  return (
    <div class="lre-stack" data-lre-settings-page="assistant">
      <p class="lre-set-lead">What the GM assistant (GM → Assistant) runs with: its model, whose knowledge it reads, how its changes land, and its budget. No turn of play reads any of these.</p>
      <AssistantSettingsBody agents={props.agents} connections={connections} patch={props.patch} busy={props.busy} />
    </div>
  );
}
