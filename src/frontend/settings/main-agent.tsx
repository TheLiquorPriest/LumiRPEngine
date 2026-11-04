// Settings → Agents → Main agent (AGENT-LOOP-PLAN §15; INC2-SPEC C14; DESIGN §4.6), on the agent
// page's template (role-page.tsx): where it runs, for each of its jobs (deciding each turn while the
// pipeline has a main agent decide, and the final review in either pipeline); its effort and tools
// (it only reads: what it changes goes through the roles it runs and the prompt it reviews); its turn
// task's parts (the digest, and the pins budget every role shares); whether it decides turns; its
// final review (on or off, what a review that fails does, its time, its own limits over the main
// agent's); its own limits over every agent's; its caching and its prompts. Every setting is
// `agents.main`, `agents.finalReview`, `timeouts.finalReviewMs` or `agents.caching.roles.main`; a
// Default sends null, so the store reads the default back. Hook-free (`MainAgentPage`), so tests
// press it without a DOM. Styles: styles/settings.ts.

import type { AgentSettings, FinalReviewOnFail } from "../../shared/agent-settings";
import { BUDGET_DEFS, defaultAgentSettings, FINAL_REVIEW_ON_FAIL, FINAL_REVIEW_ON_FAIL_LABELS, MAIN_AGENT_ROLE, MAIN_DEFS, mainBudget, PIPELINE_MODE_LABELS } from "../../shared/agent-settings";
import type { JsonObject } from "../../shared/json";
import { MAIN_AGENT_PAGE } from "../../shared/main-agent-prompts";
import type { PromptSettings } from "../../shared/prompts";
import { defaultTimeouts, type TimeoutSettings } from "../../shared/timeouts";
import type { SettingsRoute } from "../app";
import { HostSwitch, Seg } from "../components";
import { mainChanged, ownChanged } from "./changed";
import { LimitRow, NavRow, OwnBudget, SettingRow } from "./kit";
import { FINAL_REVIEW_FAIL_HELP } from "./labels";
import { AgentPage, BUDGET_KEYS, CachingSetting, ConnectionSetting, EffortSetting, FamiliesSetting, PromptsLink, routeText, type PageSection } from "./role-page";
import { type Connection, placeOf } from "./steps";
import { TimeoutRow } from "./timeouts";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings();
const FINAL_REVIEW_MS = defaultTimeouts().finalReviewMs;

/** The limits the main agent and its final review may set of their own: a turn role's alone (its fresh runs) aren't theirs. */
const MAIN_KEYS = BUDGET_KEYS.filter((key) => BUDGET_DEFS[key].roleOnly !== true);

/** The settings patch (`lre.settings.set`) for some of the main agent's settings; a field sent as null is deleted, so the store reads its default. */
export function mainPatch(fields: JsonObject): JsonObject {
  return { agents: { main: fields } };
}

/** The main agent's page put back: its settings, its final review, the review's time and its own caching. */
export function mainResetPatch(): JsonObject {
  return { agents: { main: null, finalReview: null, caching: { roles: { [MAIN_AGENT_ROLE]: null } } }, timeouts: { finalReviewMs: null } };
}

/**
 * Settings home's line for the main agent: where it runs and what it does now. It works each agent
 * turn's final review in either pipeline, so it is off only on a fixed pipeline with the review off.
 */
export function mainSummary(agents: AgentSettings, connections: readonly Connection[]): string {
  const place = placeOf(agents.main, connections);
  const review = agents.finalReview.on;
  if (agents.pipeline.mode === "main") return `${place} · decides each turn${review ? " and reviews the narrator's prompt" : ""}`;
  return review ? `${place} · reviews the narrator's prompt` : `${place} · not used: ${PIPELINE_MODE_LABELS.fixed.toLowerCase()}, no final review`;
}

/** Settings → Agents → Main agent, without hooks. */
export function MainAgentPage(props: { agents: AgentSettings; timeouts: TimeoutSettings; prompts: PromptSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { agents, busy } = props;
  const m = agents.main;
  const d = DEFAULTS.main;
  const r = agents.finalReview;
  const dr = DEFAULTS.finalReview;
  const set = (fields: JsonObject) => props.patch(mainPatch(fields));
  const setReview = (fields: JsonObject) => props.patch({ agents: { finalReview: fields } });
  const deciding = agents.pipeline.mode === "main";
  const route = routeText({ connectionId: m.connectionId, model: m.model, from: m.connectionId === null ? "default" : "role" }, props.connections);
  const familiesChanged = m.families.length !== d.families.length || m.families.some((f) => !d.families.includes(f));
  const sections: PageSection[] = [
    {
      id: "runs",
      title: "Runs on",
      changed: (m.connectionId !== d.connectionId || m.model !== d.model ? 1 : 0) + (m.effort !== d.effort ? 1 : 0),
      body: (
        <div class="lre-set-rows">
          <ul class="lre-set-routes">
            <li class="lre-set-route" data-lre-route="decide">
              <span class="lre-set-route-task">Deciding each turn</span>
              <span class="lre-set-route-to">{deciding ? route : "Not now: the pipeline is fixed"}</span>
            </li>
            <li class="lre-set-route" data-lre-route="review">
              <span class="lre-set-route-task">The final review</span>
              <span class="lre-set-route-to">{r.on ? route : "Off"}</span>
            </li>
          </ul>
          <ConnectionSetting id="connection" owner="the main agent" value={m} changed={m.connectionId !== d.connectionId || m.model !== d.model} noneLabel="None: Lumiverse's default connection" noneHelp="None runs it on the connection Lumiverse marks as your default, with that connection's model and settings." to={placeOf(d, [])} connections={props.connections} busy={busy} set={set} />
          <EffortSetting owner="the main agent" value={m.effort} standard={d.effort} note={`While Thinking in tool loops (Settings → Agents) is off, its calls with tools go with reasoning off; it's ${agents.thinkingInToolLoops ? "on" : "off"} now.`} busy={busy} set={(effort) => set({ effort })} />
        </div>
      ),
    },
    {
      id: "may",
      title: "What it may do",
      changed: familiesChanged ? 1 : 0,
      body: <FamiliesSetting owner="the main agent" value={m.families} standard={d.families} help="It only reads: what it changes, it changes through the roles it runs, and in the narrator's prompt through its final review." busy={busy} set={(families) => set({ families })} />,
    },
    {
      id: "reads",
      title: "What it reads",
      changed: (m.digestTokens !== d.digestTokens ? 1 : 0) + (m.pinsTokens !== d.pinsTokens ? 1 : 0),
      body: (
        <div class="lre-set-rows">
          <LimitRow id="digestTokens" def={MAIN_DEFS.digestTokens} value={m.digestTokens} standard={d.digestTokens} busy={busy} set={(digestTokens) => set({ digestTokens })} />
          <LimitRow id="pinsTokens" def={MAIN_DEFS.pinsTokens} value={m.pinsTokens} standard={d.pinsTokens} busy={busy} set={(pinsTokens) => set({ pinsTokens })} />
        </div>
      ),
    },
    {
      id: "when",
      title: "When it runs",
      changed: 0,
      body: <NavRow id="pipeline" icon="branch" title={deciding ? "Decides each turn" : "Decides no turn: the pipeline is fixed"} subtitle={`Pipeline: ${PIPELINE_MODE_LABELS[agents.pipeline.mode]}. It keeps a session from turn to turn, which GM → Workspace shows.`} changed={0} onOpen={() => props.go({ page: "agents", sub: "pipeline" })} />,
    },
    {
      id: "review",
      title: "Final review",
      changed: (r.on !== dr.on ? 1 : 0) + (r.onFail !== dr.onFail ? 1 : 0) + (props.timeouts.finalReviewMs !== FINAL_REVIEW_MS ? 1 : 0) + ownChanged(r.budget, dr.budget),
      body: (
        <div class="lre-set-rows" data-lre-main-setting="final-review">
          <SettingRow id="review-on" label="Review the narrator's prompt" bare changed={r.on !== dr.on} help="Before each reply of an agent chat, in either pipeline, it reviews the prompt the narrator gets against the world and the turn, and may fix it a line at a time. GM → Live shows each edit; a Re-narrate tells the same prompt again." reset={{ label: `Reset the final review to its default, ${dr.on ? "on" : "off"}`, to: dr.on ? "on" : "off", onClick: () => setReview({ on: null }) }} busy={busy}>
            <HostSwitch label="The main agent reviews the narrator's prompt before each reply" checked={r.on} disabled={busy} onChange={(on) => setReview({ on })} />
          </SettingRow>
          <SettingRow id="review-fail" label="When the review fails" changed={r.onFail !== dr.onFail} help={`${FINAL_REVIEW_FAIL_HELP[r.onFail]} It fails when it runs out of time or budget, or its call fails.`} reset={{ label: `Reset what a failed review does to its default, ${FINAL_REVIEW_ON_FAIL_LABELS[dr.onFail]}`, to: FINAL_REVIEW_ON_FAIL_LABELS[dr.onFail], onClick: () => setReview({ onFail: null }) }} busy={busy}>
            <Seg<FinalReviewOnFail> label="What a final review that fails does" value={r.onFail} options={FINAL_REVIEW_ON_FAIL.map((value) => ({ value, label: FINAL_REVIEW_ON_FAIL_LABELS[value] }))} disabled={busy} onChange={(onFail) => setReview({ onFail })} />
          </SettingRow>
          <TimeoutRow id="finalReviewMs" value={props.timeouts.finalReviewMs} busy={busy} set={(finalReviewMs) => props.patch({ timeouts: { finalReviewMs } })} />
          <OwnBudget owner="The final review's" fallback="the main agent's" keys={MAIN_KEYS} defs={BUDGET_DEFS} own={r.budget} shipped={dr.budget} every={mainBudget(agents)} busy={busy} set={(key, value) => setReview({ budget: { [key]: value } })} follows="Every other limit is the main agent's, below; what the review spends counts toward the turn's." />
        </div>
      ),
    },
    {
      id: "budget",
      title: "Budget",
      changed: ownChanged(m.budget, d.budget),
      body: (
        <OwnBudget
          owner="The main agent's"
          keys={MAIN_KEYS}
          defs={BUDGET_DEFS}
          own={m.budget}
          shipped={d.budget}
          every={agents.budget}
          busy={busy}
          set={(key, value) => set({ budget: { [key]: value } })}
          follows={
            <>
              For each stage it works. Every other limit is every agent's:{" "}
              <button type="button" class="lre-set-link" onClick={() => props.go({ page: "agents", sub: "budgets" })}>
                Settings → Agents → Budgets
              </button>
              .
            </>
          }
        />
      ),
    },
    { id: "caching", title: "Caching", changed: agents.caching.roles[MAIN_AGENT_ROLE] === undefined ? 0 : 1, body: <CachingSetting id={MAIN_AGENT_ROLE} owner="the main agent" agents={agents} busy={busy} patch={props.patch} /> },
    { id: "prompts", title: "Prompts", changed: 0, body: <PromptsLink page={MAIN_AGENT_PAGE.id} owner="The main agent" prompts={props.prompts} go={props.go} /> },
  ];
  return (
    <AgentPage
      id="main"
      lead="The agent that decides each turn while the pipeline has a main agent decide, and works each turn's final review in either pipeline."
      sections={sections}
      changed={mainChanged(agents, props.timeouts)}
      resetLabel="Reset the main agent to its defaults"
      busy={busy}
      reset={() => props.patch(mainResetPatch())}
    />
  );
}
