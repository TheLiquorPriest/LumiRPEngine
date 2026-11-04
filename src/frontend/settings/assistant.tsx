// Settings → Agents → Assistant (AGENT-LOOP-PLAN §9, §15; INC1-SPEC C8, R6b), on the agent page's
// template (role-page.tsx): where the GM assistant (GM → Assistant) runs, its effort, how its changes
// land, how much of its conversation goes with each message, its own limits over every agent's, its
// caching and its prompts. It works outside the story and reads everything, so there is no knowledge
// to choose. Every setting is `agents.assistant` (its caching `agents.caching.roles.assistant`):
// connection sends {connectionId, model: null}; model, effort, apply and historyTokens each send that
// field; a limit of its own sends {budget: {[key]: value}}, and Every agent's {budget: {[key]: null}},
// so every agent's limit applies again; a Default sends null, so the store reads the default back.
// Hook-free (`AssistantPage`), so tests press it without a DOM. Styles: styles/settings.ts.

import type { AgentBudget, AgentSettings, AssistantApply, AssistantSettings } from "../../shared/agent-settings";
import { ASSISTANT_APPLY, ASSISTANT_APPLY_LABELS, BUDGET_DEFS, defaultAgentSettings, HISTORY_TOKENS_DEF } from "../../shared/agent-settings";
import type { JsonObject } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import type { PromptSettings } from "../../shared/prompts";
import { GM_AGENT_PAGE } from "../../shared/prompts";
import type { SettingsRoute } from "../app";
import { Seg } from "../components";
import { assistantChanged, ownChanged } from "./changed";
import { LimitRow, OwnBudget, SettingRow } from "./kit";
import { APPLY_HELP } from "./labels";
import { AgentPage, BUDGET_KEYS, CachingSetting, ConnectionSetting, EffortSetting, PromptsLink, type PageSection } from "./role-page";
import { type Connection, placeOf } from "./steps";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings().assistant;

/** The assistant's id among the agents' caching. */
const ASSISTANT = "assistant";

/** The limits the assistant may set of its own: a turn role's alone (its fresh runs) aren't its. */
const ASSISTANT_KEYS = BUDGET_KEYS.filter((key) => BUDGET_DEFS[key].roleOnly !== true);

/** Settings home's line for this page: where the assistant runs, and how its changes land. */
export function assistantSummary(assistant: AssistantSettings, connections: readonly Connection[]): string {
  // The page's labels, mid-line: only their first letter goes small ("Apply" and "Undo" name buttons).
  const apply = ASSISTANT_APPLY_LABELS[assistant.apply];
  return `${placeOf(assistant, connections)} · changes: ${apply.charAt(0).toLowerCase()}${apply.slice(1)}`;
}

/** The settings patch (`lre.settings.set`) for some of the assistant's settings; a field sent as null is deleted, so the store reads its default. */
export function assistantPatch(fields: JsonObject): JsonObject {
  return { agents: { assistant: fields } };
}

/** The patch for one of the assistant's own budget limits: `value` sets its own, null goes back to every agent's. */
export function assistantBudgetPatch(key: keyof AgentBudget, value: Limit | null): JsonObject {
  return assistantPatch({ budget: { [key]: value } });
}

/** Settings → Agents → Assistant, without hooks: what the GM assistant runs with. */
export function AssistantPage(props: { agents: AgentSettings; prompts: PromptSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { agents, busy } = props;
  const a = agents.assistant;
  const set = (fields: JsonObject) => props.patch(assistantPatch(fields));
  const sections: PageSection[] = [
    {
      id: "runs",
      title: "Runs on",
      changed: (a.connectionId !== DEFAULTS.connectionId || a.model !== DEFAULTS.model ? 1 : 0) + (a.effort !== DEFAULTS.effort ? 1 : 0),
      body: (
        <div class="lre-set-rows">
          <ConnectionSetting id="connection" owner="the assistant" value={a} changed={a.connectionId !== DEFAULTS.connectionId || a.model !== DEFAULTS.model} noneLabel="None: Lumiverse's default connection" noneHelp="None runs the assistant on the connection Lumiverse marks as your default, with that connection's model and settings." to={placeOf(DEFAULTS, [])} connections={props.connections} busy={busy} set={set} />
          <EffortSetting owner="the assistant" value={a.effort} standard={DEFAULTS.effort} note={`While Thinking in tool loops (Settings → Agents) is off, a call that offers tools goes with reasoning off; it's ${agents.thinkingInToolLoops ? "on" : "off"} now.`} busy={busy} set={(effort) => set({ effort })} />
        </div>
      ),
    },
    {
      id: "may",
      title: "What it may do",
      changed: a.apply === DEFAULTS.apply ? 0 : 1,
      body: (
        <SettingRow id="apply" label="How its changes land" changed={a.apply !== DEFAULTS.apply} help={APPLY_HELP[a.apply]} reset={{ label: `Reset how its changes land to its default, ${ASSISTANT_APPLY_LABELS[DEFAULTS.apply]}`, to: ASSISTANT_APPLY_LABELS[DEFAULTS.apply], onClick: () => set({ apply: null }) }} busy={busy}>
          <Seg<AssistantApply> label="How the assistant's changes land" value={a.apply} options={ASSISTANT_APPLY.map((value) => ({ value, label: ASSISTANT_APPLY_LABELS[value] }))} disabled={busy} onChange={(apply) => set({ apply })} />
        </SettingRow>
      ),
    },
    {
      id: "reads",
      title: "What it reads",
      changed: a.historyTokens === DEFAULTS.historyTokens ? 0 : 1,
      body: (
        <div class="lre-set-rows">
          <p class="lre-set-note">Everything, outside the story: it works for you, the GM, not for a character.</p>
          <LimitRow id="historyTokens" def={HISTORY_TOKENS_DEF} value={a.historyTokens} standard={DEFAULTS.historyTokens} busy={busy} set={(historyTokens) => set({ historyTokens })} />
        </div>
      ),
    },
    {
      id: "budget",
      title: "Budget",
      changed: ownChanged(a.budget, DEFAULTS.budget),
      body: (
        <OwnBudget
          owner="The assistant's"
          keys={ASSISTANT_KEYS}
          defs={BUDGET_DEFS}
          own={a.budget}
          shipped={DEFAULTS.budget}
          every={agents.budget}
          busy={busy}
          outsideTurn
          set={(key, value) => props.patch(assistantBudgetPatch(key, value))}
          follows={
            <>
              For each message you send it. Every other limit is every agent's:{" "}
              <button type="button" class="lre-set-link" onClick={() => props.go({ page: "agents", sub: "budgets" })}>
                Settings → Agents → Budgets
              </button>
              .
            </>
          }
        />
      ),
    },
    { id: "caching", title: "Caching", changed: agents.caching.roles[ASSISTANT] === undefined ? 0 : 1, body: <CachingSetting id={ASSISTANT} owner="the assistant" agents={agents} busy={busy} patch={props.patch} /> },
    { id: "prompts", title: "Prompts", changed: 0, body: <PromptsLink page={GM_AGENT_PAGE.id} owner="The assistant" prompts={props.prompts} go={props.go} /> },
  ];
  return (
    <AgentPage
      id="assistant"
      lead="The GM assistant (GM → Assistant). No turn of play reads any of these."
      sections={sections}
      changed={assistantChanged(agents)}
      resetLabel="Reset the assistant to its defaults"
      busy={busy}
      reset={() => props.patch({ agents: { assistant: null, caching: { roles: { [ASSISTANT]: null } } } })}
    />
  );
}
