// Settings → Agents → Main agent (AGENT-LOOP-PLAN §15; INC2-SPEC C14; DESIGN §4.6), on the agent
// page's template (role-page.tsx): where it runs, for each of its jobs (deciding each turn while the
// pipeline has a main agent decide, and the final review in either pipeline); its effort and tools
// (it only reads: what it changes goes through the roles it runs and the prompt it reviews); its turn
// task's parts (the digest, and the pins budget every role shares); its session (Build C item 2: when
// its earlier turns are summarized, on what route, how long a summary may be, what past turns keep,
// and a warning when the kept turns alone pass the limit, so it would compact every turn); whether
// it decides turns; its final review (on or off, what a review that fails does, its time, its own
// limits over the main agent's); its own limits over every agent's; its caching and its prompts.
// Every setting is `agents.main`, `agents.compaction`, `agents.finalReview`, `timeouts.finalReviewMs`
// or `agents.caching.roles.main`; a Default sends null, so the store reads the default back.
// Hook-free (`MainAgentPage`), so tests press it without a DOM; only the session's warning reads the
// open chat (`KeptTurnsWarning`). Styles: styles/settings.ts.

import { useEffect, useState } from "preact/hooks";
import type { AgentEffort, AgentSettings, CompactionEffort, CompactionSettings, CompactionWhen, FinalReviewOnFail, FinalReviewScope, SessionKeeps } from "../../shared/agent-settings";
import { BUDGET_DEFS, COMPACTION_DEFS, COMPACTION_EFFORTS, COMPACTION_WHEN, COMPACTION_WHEN_LABELS, defaultAgentSettings, FINAL_REVIEW_ON_FAIL, FINAL_REVIEW_ON_FAIL_LABELS, FINAL_REVIEW_SCOPE_LABELS, FINAL_REVIEW_SCOPES, MAIN_AGENT_ROLE, MAIN_DEFS, mainBudget, PIPELINE_MODE_LABELS, SESSION_KEEPS, SESSION_KEEPS_LABELS } from "../../shared/agent-settings";
import { MAIN_STAGES, type MainStage, STAGE_MODE_LABELS, STAGE_MODES, STAGE_WORDS, type StageMode, stageRoles } from "../../shared/agent-pipeline";
import { ROLE_LABEL } from "../../shared/agent-roles";
import type { JsonObject } from "../../shared/json";
import { MAIN_AGENT_PAGE } from "../../shared/main-agent-prompts";
import type { PromptSettings } from "../../shared/prompts";
import type { SessionView } from "../../shared/protocol";
import { defaultTimeouts, type TimeoutSettings } from "../../shared/timeouts";
import { type SettingsRoute, useApp } from "../app";
import { HostSwitch, Seg } from "../components";
import { useSelect } from "../store";
import { mainChanged, ownChanged, sessionChanged } from "./changed";
import { LimitRow, NavRow, OwnBudget, SettingRow } from "./kit";
import { EFFORT_HELP, EFFORT_LABEL, FINAL_REVIEW_FAIL_HELP } from "./labels";
import { AgentPage, BUDGET_KEYS, CachingSetting, ConnectionSetting, EffortSetting, FamiliesSetting, PromptsLink, routeText, type PageSection } from "./role-page";
import { type Connection, placeOf } from "./steps";
import { TimeoutRow } from "./timeouts";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings();
const FINAL_REVIEW_MS = defaultTimeouts().finalReviewMs;

/** The limits the main agent and its final review may set of their own: a turn role's alone (its fresh runs) aren't theirs. */
const MAIN_KEYS = BUDGET_KEYS.filter((key) => BUDGET_DEFS[key].roleOnly !== true);

/** The compaction's settings Session shows, which the page's Reset puts back; its summarize tool is Settings → Agents → Compaction's alone. */
const SESSION_COMPACTION_KEYS = ["when", "connectionId", "model", "effort", "summaryTokens", "atTokens", "keepTurns"] as const satisfies readonly (keyof CompactionSettings)[];

/** The settings patch (`lre.settings.set`) for some of the main agent's settings; a field sent as null is deleted, so the store reads its default. */
export function mainPatch(fields: JsonObject): JsonObject {
  return { agents: { main: fields } };
}

/** The settings patch for some of the main session's compaction settings (Session); a field sent as null is deleted, so the store reads its default. */
export function compactionPatch(fields: JsonObject): JsonObject {
  return { agents: { compaction: fields } };
}

/** The main agent's page put back: its settings, its session's compaction, its final review, the review's time and its own caching. */
export function mainResetPatch(): JsonObject {
  return { agents: { main: null, compaction: Object.fromEntries(SESSION_COMPACTION_KEYS.map((key) => [key, null])), finalReview: null, caching: { roles: { [MAIN_AGENT_ROLE]: null } } }, timeouts: { finalReviewMs: null } };
}

/** Tokens in the session warning's words: "61k", "2.5k", "800". */
function tokensText(tokens: number): string {
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`;
  if (tokens >= 1000) return `${Math.round(tokens / 100) / 10}k`;
  return String(tokens);
}

/**
 * Session's warning, from the open chat's session: the turns a compaction keeps whole already pass
 * the size it runs past, so every turn would compact again. Null while they don't, or none is kept.
 */
export function keptTurnsWarning(session: Pick<SessionView, "segments"> | null, compaction: Pick<CompactionSettings, "atTokens" | "keepTurns">): string | null {
  if (!session || compaction.keepTurns <= 0) return null;
  const kept = session.segments.slice(-compaction.keepTurns);
  const tokens = kept.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
  if (kept.length === 0 || tokens <= compaction.atTokens) return null;
  return `Compaction will run every turn: the last ${kept.length === 1 ? "turn takes" : `${kept.length} turns take`} ${tokensText(tokens)} of ${tokensText(compaction.atTokens)} tokens.`;
}

/** The warning, read from the open chat's session (`lre.workspace session`) as the page opens or the chat changes; nothing while no world chat is open. */
function KeptTurnsWarning(props: Pick<CompactionSettings, "atTokens" | "keepTurns">) {
  const app = useApp();
  const chatId = useSelect(app.sync, (state) => (state.view !== null ? state.chatId : null));
  const [session, setSession] = useState<SessionView | null>(null);
  useEffect(() => {
    setSession(null);
    if (chatId === null) return;
    let live = true;
    // A plain send: a chat whose session can't be read shows no warning, and no error toast.
    void app.send({ type: "lre.workspace", op: "session", chatId }).then((m) => {
      if (live && m.type === "lre.result" && m.request === "lre.workspace") setSession(m.body.session ?? null);
    });
    return () => {
      live = false;
    };
  }, [chatId]);
  const warning = keptTurnsWarning(session, props);
  return warning ? (
    <p class="lre-set-note lre-warn" role="status" data-lre-session-warning>
      {warning} Raise the size, keep fewer turns whole, or keep receipts of past turns.
    </p>
  ) : null;
}

/** The summary's effort as one setting: the main agent's own, or one of its own. */
function CompactionEffortSetting(props: { value: CompactionEffort; standard: CompactionEffort; main: AgentEffort; busy: boolean; set(effort: CompactionEffort | null): void }) {
  const label = (effort: CompactionEffort): string => (effort === "main" ? `The main agent's (${EFFORT_LABEL[props.main]})` : EFFORT_LABEL[effort]);
  return (
    <SettingRow id="compaction-effort" label="Summary reasoning" bare changed={props.value !== props.standard} help={props.value === "main" ? "The summary is written with the main agent's own effort (Runs on, above). Its call may write the summary and that effort's reasoning, no more." : `${EFFORT_HELP[props.value]} Its call may write the summary and this effort's reasoning, no more.`} reset={{ label: `Reset the summary's reasoning to its default, ${label(props.standard)}`, to: label(props.standard), onClick: () => props.set(null) }} busy={props.busy}>
      <label class="lre-field">
        <span class="label">Reasoning effort</span>
        <select
          class="lre-input"
          aria-label="The summary of earlier turns: reasoning effort"
          value={props.value}
          disabled={props.busy}
          onChange={(event) => {
            const effort = COMPACTION_EFFORTS.find((e) => e === event.currentTarget.value);
            if (effort) props.set(effort);
          }}
        >
          {COMPACTION_EFFORTS.map((e) => (
            <option key={e} value={e}>
              {label(e)}
            </option>
          ))}
        </select>
      </label>
    </SettingRow>
  );
}

const WHEN_HELP: Readonly<Record<CompactionWhen, string>> = {
  ahead: "Once a turn's session is settled and the next turn will compact, the summary it needs is written in the background, so the next turn starts with it ready, or waits only for what is left. A swipe of that turn uses the same summary.",
  before_turn: "The turn waits while the summary is written, before its first stage, as earlier builds did.",
};

const KEEPS_HELP: Readonly<Record<SessionKeeps, string>> = {
  receipts: "A past turn keeps the final review's message as its parts, sizes and hash with its edits, each role's answer as its first characters, length and hash, and each review as counts. The main agent reads a past turn's full messages with past_turn when it needs them, so its calls read far less and compaction runs less often.",
  whole: "A past turn keeps every message as it was sent, so the session grows faster and compaction runs more often.",
};

/**
 * Main agent → Session: when its earlier turns are summarized, on what connection and model and with
 * what effort, how long a summary may be, past what size it runs and how many turns stay whole, and
 * what past turns keep, each with its Default; the warning reads the open chat. Hook-free.
 */
export function SessionRows(props: { agents: AgentSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void }) {
  const { agents, busy } = props;
  const c = agents.compaction;
  const dc = DEFAULTS.compaction;
  const m = agents.main;
  const d = DEFAULTS.main;
  const setCompaction = (fields: JsonObject) => props.patch(compactionPatch(fields));
  const setMain = (fields: JsonObject) => props.patch(mainPatch(fields));
  return (
    <div class="lre-set-rows" data-lre-main-setting="session">
      <p class="lre-set-note">It keeps a session from turn to turn, which GM → Workspace shows. Past a size, all but its latest turns become one summary; a summary cut off at its length, or one that stops mid-sentence, never lands.</p>
      <KeptTurnsWarning atTokens={c.atTokens} keepTurns={c.keepTurns} />
      <SettingRow id="compaction-when" label="When earlier turns are summarized" changed={c.when !== dc.when} help={WHEN_HELP[c.when]} reset={{ label: `Reset when earlier turns are summarized to its default, ${COMPACTION_WHEN_LABELS[dc.when]}`, to: COMPACTION_WHEN_LABELS[dc.when], onClick: () => setCompaction({ when: null }) }} busy={busy}>
        <Seg<CompactionWhen> label="When earlier turns are summarized" value={c.when} options={COMPACTION_WHEN.map((value) => ({ value, label: COMPACTION_WHEN_LABELS[value] }))} disabled={busy} onChange={(when) => setCompaction({ when })} />
      </SettingRow>
      <ConnectionSetting id="compaction-connection" owner="the summary" value={c} changed={c.connectionId !== dc.connectionId || c.model !== dc.model} noneLabel="None: the main agent's" noneHelp="None writes the summary on the main agent's connection and model (Runs on, above)." to="the main agent's" connections={props.connections} busy={busy} set={setCompaction} />
      <CompactionEffortSetting value={c.effort} standard={dc.effort} main={m.effort} busy={busy} set={(effort) => setCompaction({ effort })} />
      <LimitRow id="summaryTokens" def={COMPACTION_DEFS.summaryTokens} value={c.summaryTokens} standard={dc.summaryTokens} busy={busy} set={(summaryTokens) => setCompaction({ summaryTokens })} />
      <LimitRow id="atTokens" def={COMPACTION_DEFS.atTokens} value={c.atTokens} standard={dc.atTokens} busy={busy} set={(atTokens) => setCompaction({ atTokens })} />
      <LimitRow id="keepTurns" def={COMPACTION_DEFS.keepTurns} value={c.keepTurns} standard={dc.keepTurns} busy={busy} set={(keepTurns) => setCompaction({ keepTurns })} />
      <SettingRow id="session-keeps" label="What past turns keep" changed={m.sessionKeeps !== d.sessionKeeps} help={KEEPS_HELP[m.sessionKeeps]} reset={{ label: `Reset what past turns keep to its default, ${SESSION_KEEPS_LABELS[d.sessionKeeps]}`, to: SESSION_KEEPS_LABELS[d.sessionKeeps], onClick: () => setMain({ sessionKeeps: null }) }} busy={busy}>
        <Seg<SessionKeeps> label="What past turns keep" value={m.sessionKeeps} options={SESSION_KEEPS.map((value) => ({ value, label: SESSION_KEEPS_LABELS[value] }))} disabled={busy} onChange={(sessionKeeps) => setMain({ sessionKeeps })} />
      </SettingRow>
      <LimitRow id="receiptChars" def={MAIN_DEFS.receiptChars} value={m.receiptChars} standard={d.receiptChars} busy={busy} set={(receiptChars) => setMain({ receiptChars })} />
    </div>
  );
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
    { id: "session", title: "Session", changed: sessionChanged(agents), body: <SessionRows agents={agents} connections={props.connections} busy={busy} patch={props.patch} /> },
    {
      id: "when",
      title: "When it runs",
      changed: 0,
      body: <NavRow id="pipeline" icon="branch" title={deciding ? "Decides each turn" : "Decides no turn: the pipeline is fixed"} subtitle={`Pipeline: ${PIPELINE_MODE_LABELS[agents.pipeline.mode]}. It keeps a session from turn to turn, which GM → Workspace shows.`} changed={0} onOpen={() => props.go({ page: "agents", sub: "pipeline" })} />,
    },
    {
      id: "stages",
      title: "Stages",
      changed: MAIN_STAGES.filter((s) => m.stages[s] !== d.stages[s]).length,
      body: <StagesRows agents={agents} busy={busy} set={set} />,
    },
    {
      id: "review",
      title: "Final review",
      changed: (r.on !== dr.on ? 1 : 0) + (r.onFail !== dr.onFail ? 1 : 0) + (r.scope !== dr.scope ? 1 : 0) + (props.timeouts.finalReviewMs !== FINAL_REVIEW_MS ? 1 : 0) + ownChanged(r.budget, dr.budget),
      body: (
        <div class="lre-set-rows" data-lre-main-setting="final-review">
          <SettingRow id="review-on" label="Review the narrator's prompt" bare changed={r.on !== dr.on} help="Before each reply of an agent chat, in either pipeline, it reviews the prompt the narrator gets against the world and the turn, and may fix it a line at a time. GM → Live shows each edit; a Re-narrate tells the same prompt again." reset={{ label: `Reset the final review to its default, ${dr.on ? "on" : "off"}`, to: dr.on ? "on" : "off", onClick: () => setReview({ on: null }) }} busy={busy}>
            <HostSwitch label="The main agent reviews the narrator's prompt before each reply" checked={r.on} disabled={busy} onChange={(on) => setReview({ on })} />
          </SettingRow>
          <SettingRow id="review-scope" label="What it is sent" changed={r.scope !== dr.scope} help={r.scope === "changed" ? `Only the parts of the narrator's prompt that changed since the last turn's review; on the rest, that review's edits are made again, and when nothing changed no review is sent.${agents.persist.on ? "" : " It takes effect while Smart persistence is on (Settings → Agents → Pipeline); until then every part is sent."}` : "Every part of the narrator's prompt, every turn."} reset={{ label: `Reset what the final review is sent to its default, ${FINAL_REVIEW_SCOPE_LABELS[dr.scope]}`, to: FINAL_REVIEW_SCOPE_LABELS[dr.scope], onClick: () => setReview({ scope: null }) }} busy={busy}>
            <Seg<FinalReviewScope> label="What the final review is sent" value={r.scope} options={FINAL_REVIEW_SCOPES.map((value) => ({ value, label: FINAL_REVIEW_SCOPE_LABELS[value] }))} disabled={busy} onChange={(scope) => setReview({ scope })} />
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

/**
 * Main agent → Stages: how each stage of a turn the main agent decides runs. The main agent decides
 * it in a message of its own, or its roles run on their own, as the fixed pipeline runs them: no
 * message, so the turn is faster, and the main agent's next message lists what ran. With stage 3 on
 * its own, the minds start as the turn does. Hook-free.
 */
export function StagesRows(props: { agents: AgentSettings; busy: boolean; set(fields: JsonObject): void }) {
  const { agents, busy } = props;
  const stages = agents.main.stages;
  const standard = DEFAULTS.main.stages;
  const deciding = agents.pipeline.mode === "main";
  const auto = MAIN_STAGES.filter((s) => stages[s] === "auto").length;
  return (
    <div class="lre-set-rows" data-lre-main-setting="stages">
      <p class="lre-set-note">
        {deciding ? `The main agent decides ${MAIN_STAGES.length - auto === MAIN_STAGES.length ? "every stage" : `${MAIN_STAGES.length - auto} of ${MAIN_STAGES.length} stages`}.` : "These take effect while a main agent decides the turn (Settings → Agents → Pipeline)."} A stage on its own makes no message to the main agent: its roles run as the fixed pipeline runs them, each by its own When it fails, and the main agent's next message lists what ran and what each answered. With stage 3 on its own, the minds start as the turn starts.
      </p>
      {MAIN_STAGES.map((stage: MainStage) => {
        const words = STAGE_WORDS[stage];
        const roles = stageRoles(stage).map((r) => ROLE_LABEL[r]).join(", ");
        return (
          <SettingRow key={stage} id={`stage-${stage}`} label={words.label} changed={stages[stage] !== standard[stage]} help={`${words.holds}. Roles: ${roles}.`} reset={{ label: `Reset ${words.label.toLowerCase()} to its default, ${STAGE_MODE_LABELS[standard[stage]]}`, to: STAGE_MODE_LABELS[standard[stage]], onClick: () => props.set({ stages: { [stage]: null } }) }} busy={busy}>
            <Seg<StageMode> label={`${words.label}: how it runs`} value={stages[stage]} options={STAGE_MODES.map((value) => ({ value, label: STAGE_MODE_LABELS[value] }))} disabled={busy} onChange={(mode) => props.set({ stages: { [stage]: mode } })} />
          </SettingRow>
        );
      })}
    </div>
  );
}
