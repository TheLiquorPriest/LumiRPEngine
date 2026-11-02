// Settings → Agents → Main agent (AGENT-LOOP-PLAN §15; INC2-SPEC C14): what the main agent runs with,
// every setting kept under `agents.main` (shared/agent-settings.ts): the connection and model it runs
// on, its effort, its tool families (it only reads, everything secrets marked: what it changes goes
// through the roles it runs, and the prompt it reviews), its own limits over every agent's budget for
// each stage it works, and its turn task's parts: the digest of what changed since its last turn, and
// its pinned files where `.pins.json` sets no budget, which is every role's pins budget too. Then its
// final review of the narrator's prompt before each reply, in either pipeline (`agents.finalReview`,
// DESIGN §4.6): on or off, what a review that fails does, its time (Settings → Timeouts → Final
// review, shown here too) and its own limits over the main agent's. Each shows its default; Default
// sends null, so the store reads the default back. Its caching is Settings → Agents → Caching. What
// renders and what is pressed (`MainAgentBody`, `FinalReviewSection`, `mainPatch`) is hook-free, so
// tests press it without a DOM. Styles: styles/settings.ts.

import type { AgentBudget, AgentSettings, FinalReviewOnFail, MainAgentSettings } from "../../shared/agent-settings";
import { AGENT_EFFORTS, BUDGET_DEFS, defaultAgentSettings, FINAL_REVIEW_ON_FAIL, FINAL_REVIEW_ON_FAIL_LABELS, MAIN_DEFS, mainBudget, PIPELINE_MODE_LABELS } from "../../shared/agent-settings";
import { TOOL_FAMILY_LABEL } from "../../shared/agent-tools";
import type { JsonObject } from "../../shared/json";
import type { TimeoutSettings } from "../../shared/timeouts";
import { HostModelPicker, HostSwitch, Section, Seg } from "../components";
import { defaultButton, LimitRow, OwnLimitRow } from "./agents";
import { EFFORT_LABEL } from "./assistant";
import { EFFORT_HELP, FAMILIES } from "./roles";
import { type Connection, ConnectionSelect, placeOf, useConnections } from "./steps";
import { TimeoutRow } from "./timeouts";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS: Readonly<MainAgentSettings> = defaultAgentSettings().main;
const REVIEW_DEFAULTS = defaultAgentSettings().finalReview;

const DEFAULT_PLACE = placeOf(DEFAULTS, []);

/** The settings patch (`lre.settings.set`) for some of the main agent's settings; a field sent as null is deleted, so the store reads its default. */
export function mainPatch(fields: JsonObject): JsonObject {
  return { agents: { main: fields } };
}

/** Settings home's line for this page: where the main agent runs, and whether the pipeline has one. */
export function mainSummary(agents: AgentSettings, connections: readonly Connection[]): string {
  return `${placeOf(agents.main, connections)} · ${agents.pipeline.mode === "main" ? "deciding each agent turn" : `off: ${PIPELINE_MODE_LABELS[agents.pipeline.mode].toLowerCase()}`}`;
}

/** The page's controls, without hooks: each one patches `agents.main` through `patch`. */
export function MainAgentBody(props: { agents: AgentSettings; connections: readonly Connection[]; patch(patch: JsonObject): void; busy: boolean }) {
  const { agents, busy } = props;
  const m = agents.main;
  const set = (fields: JsonObject) => props.patch(mainPatch(fields));
  const budgetKeys = Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[];
  const familiesDefault = m.families.length === DEFAULTS.families.length && m.families.every((f) => DEFAULTS.families.includes(f));
  return (
    <>
      <Section title="Model" flush>
        <div class="lre-set-rows">
          <div class="lre-set-ext" data-lre-main-setting="connection">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Connection and model</span>
              {m.connectionId === DEFAULTS.connectionId && m.model === DEFAULTS.model ? null : defaultButton(`Reset the main agent's connection and model to their default, ${DEFAULT_PLACE}`, busy, () => set({ connectionId: null, model: null }))}
            </div>
            <ConnectionSelect value={m.connectionId} connections={props.connections} firstLabel="None: Lumiverse's default connection" help="None runs the main agent on the connection Lumiverse marks as your default, with that connection's model and settings." disabled={busy} onChange={(connectionId) => set({ connectionId, model: null })} />
            {m.connectionId ? (
              <>
                <HostModelPicker connectionId={m.connectionId} value={m.model ?? ""} label="Main agent: model" onChange={(model) => set({ model: model || null })} />
                <span class="lre-field-help">Pick from the connection's models, or type one. Empty uses the connection's own model.</span>
              </>
            ) : null}
            <span class="lre-small lre-muted">Default: {DEFAULT_PLACE}, with that connection's model.</span>
          </div>
          <div class="lre-set-ext" data-lre-main-setting="effort">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Reasoning</span>
              {m.effort === DEFAULTS.effort ? null : defaultButton(`Reset the main agent's effort to its default, ${EFFORT_LABEL[DEFAULTS.effort]}`, busy, () => set({ effort: null }))}
            </div>
            <label class="lre-field">
              <span class="label">Effort</span>
              <select
                class="lre-input"
                aria-label="Main agent: reasoning effort"
                value={m.effort}
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
              <span class="lre-field-help">{EFFORT_HELP[m.effort]}</span>
            </label>
            <span class="lre-small lre-muted">Default {EFFORT_LABEL[DEFAULTS.effort]}.</span>
          </div>
        </div>
      </Section>
      <Section title="Tools" flush>
        <div class="lre-set-rows">
          <div class="lre-set-ext" data-lre-main-setting="families">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Tools it reads with</span>
              {familiesDefault ? null : defaultButton(`Reset the main agent's tools to their default, ${DEFAULTS.families.map((f) => TOOL_FAMILY_LABEL[f]).join(", ")}`, busy, () => set({ families: null }))}
            </div>
            <span class="lre-field-help">Read-only: what it changes, it changes through the roles it runs, and in the narrator's prompt through its final review.</span>
            {FAMILIES.map((family) => (
              <HostSwitch key={family} label={`Main agent: ${TOOL_FAMILY_LABEL[family]}`} checked={m.families.includes(family)} disabled={busy} onChange={(on) => set({ families: FAMILIES.filter((f) => (f === family ? on : m.families.includes(f))) })} />
            ))}
            <span class="lre-small lre-muted">Default: {DEFAULTS.families.map((f) => TOOL_FAMILY_LABEL[f]).join(", ")}.</span>
          </div>
        </div>
      </Section>
      <Section title="Turn task" flush>
        <div class="lre-set-rows">
          <LimitRow id="digestTokens" def={MAIN_DEFS.digestTokens} value={m.digestTokens} standard={DEFAULTS.digestTokens} busy={busy} set={(digestTokens) => set({ digestTokens })} />
          <LimitRow id="pinsTokens" def={MAIN_DEFS.pinsTokens} value={m.pinsTokens} standard={DEFAULTS.pinsTokens} busy={busy} set={(pinsTokens) => set({ pinsTokens })} />
        </div>
      </Section>
      <Section title="Budget" flush>
        <div class="lre-set-rows lre-set-group" data-lre-agent-group="Main agent">
          <p class="lre-set-timeout-lead">What the main agent may spend on each stage of a turn it works. Each limit is every agent's (Settings → Agents → Budgets) until you change it here; Every agent's goes back to that one.</p>
          {budgetKeys.map((key) => (
            <OwnLimitRow key={key} id={key} owner="The main agent's" def={BUDGET_DEFS[key]} own={m.budget[key]} every={agents.budget[key]} busy={busy} set={(value) => set({ budget: { [key]: value } })} />
          ))}
        </div>
      </Section>
    </>
  );
}

const ON_FAIL_HELP: Record<FinalReviewOnFail, string> = {
  send: "The narrator gets the prompt as the engine made it, and Settings → Diagnostics records why the review failed.",
  stop: "The turn stops before its reply, as a role set to stop does: the chat says why, with a Retry.",
};

/**
 * The final review (DESIGN §4.6), without hooks: whether the main agent reviews the narrator's prompt
 * before each reply of an agent chat, in either pipeline; what a review that fails does; how long it
 * may take (Settings → Timeouts → Final review, the same setting); and its own limits over the main
 * agent's budget for a stage. Each patches `agents.finalReview`, the time `timeouts`.
 */
export function FinalReviewSection(props: { agents: AgentSettings; timeouts: TimeoutSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { agents, busy } = props;
  const r = agents.finalReview;
  const set = (fields: JsonObject) => props.patch({ agents: { finalReview: fields } });
  const main = mainBudget(agents);
  const budgetKeys = Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[];
  return (
    <Section title="Final review" flush>
      <div class="lre-set-rows" data-lre-main-setting="final-review">
        <p class="lre-set-timeout-lead">Before each reply of an agent chat, the main agent reviews the prompt the narrator gets (every section, the outline with its brief, and the narrator rules) against the world and the turn, and may fix it a line at a time. It does so in either pipeline: on the fixed pipeline it runs for this alone, on the connection above. GM → Live shows each edit, the Prompt Breakdown shows the prompt as revised, and a Re-narrate tells the same prompt again.</p>
        <div class="lre-set-ext">
          <div class="lre-set-ext-head">
            <span class="lre-set-ext-title">Review the narrator's prompt</span>
            {r.on === REVIEW_DEFAULTS.on ? null : defaultButton(`Reset the final review to its default, ${REVIEW_DEFAULTS.on ? "on" : "off"}`, busy, () => set({ on: null }))}
          </div>
          <HostSwitch label="The main agent reviews the narrator's prompt before each reply" checked={r.on} disabled={busy} onChange={(on) => set({ on })} />
          <span class="lre-small lre-muted">Off, nothing runs and the narrator gets the prompt as the engine made it. Default {REVIEW_DEFAULTS.on ? "on" : "off"}.</span>
        </div>
        <div class="lre-set-ext">
          <div class="lre-set-ext-head">
            <span class="lre-set-ext-title">When the review fails</span>
            {r.onFail === REVIEW_DEFAULTS.onFail ? null : defaultButton(`Reset what a failed review does to its default, ${FINAL_REVIEW_ON_FAIL_LABELS[REVIEW_DEFAULTS.onFail]}`, busy, () => set({ onFail: null }))}
          </div>
          <div class="lre-field">
            <Seg<FinalReviewOnFail> label="What a final review that fails does" value={r.onFail} options={FINAL_REVIEW_ON_FAIL.map((value) => ({ value, label: FINAL_REVIEW_ON_FAIL_LABELS[value] }))} disabled={busy} onChange={(onFail) => set({ onFail })} />
            <span class="lre-field-help">{ON_FAIL_HELP[r.onFail]}</span>
          </div>
          <span class="lre-small lre-muted">A review fails when it runs out of time or budget, or its model call fails. Default {FINAL_REVIEW_ON_FAIL_LABELS[REVIEW_DEFAULTS.onFail]}.</span>
        </div>
        <TimeoutRow id="finalReviewMs" value={props.timeouts.finalReviewMs} busy={busy} set={(finalReviewMs) => props.patch({ timeouts: { finalReviewMs } })} />
      </div>
      <div class="lre-set-rows lre-set-group" data-lre-agent-group="Final review">
        <p class="lre-set-timeout-lead">What the review may spend. Each limit is the main agent's for a stage (its Budget, above) until you change it here; The main agent's goes back to that one. What it spends counts toward the turn's, as every agent's does.</p>
        {budgetKeys.map((key) => (
          <OwnLimitRow key={key} id={key} owner="The final review's" fallback="the main agent's" def={BUDGET_DEFS[key]} own={r.budget[key]} every={main[key]} busy={busy} set={(value) => set({ budget: { [key]: value } })} />
        ))}
      </div>
    </Section>
  );
}

/** Settings → Agents → Main agent: what the main agent runs with, and its final review. */
export function MainAgentPage(props: { agents: AgentSettings; timeouts: TimeoutSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const connections = useConnections();
  return (
    <div class="lre-stack" data-lre-settings-page="main">
      <p class="lre-set-lead">
        What the main agent runs with. It decides each agent turn while Settings → Agents → Pipeline has a main agent decide ({props.agents.pipeline.mode === "main" ? "it does now" : "it doesn't now"}); it keeps a session from turn to turn, which GM → Workspace shows. In either pipeline it works each turn's final review, below.
      </p>
      <MainAgentBody agents={props.agents} connections={connections} patch={props.patch} busy={props.busy} />
      <FinalReviewSection agents={props.agents} timeouts={props.timeouts} patch={props.patch} busy={props.busy} />
    </div>
  );
}
