// Settings → Agents (AGENT-LOOP-PLAN §12, §15; INC1-SPEC R1; INC2-SPEC C12): the hub of what the
// agent runtime runs under. It opens with a turn at a glance (each stage of a turn, how it runs while a
// main agent decides the turn, the roles that work in it, where each runs and how), then every agent
// call's two switches (streaming, and thinking in tool loops), then a row for each of its sections,
// each a page of its own under its name, saying what it holds and how many of its settings are
// changed: Pipeline, Review card, System instructions,
// Budgets, Compaction, Recording, Throttles, Caching and Acceptance runs. A role's own settings are
// its page's (role-page.tsx), the main agent's Main agent's. Every number and word a limit shows comes
// from shared/agent-settings.ts. Settings save as a merge patch, so a Default sends null, the
// per-connection lists go whole and a role's own caching is dropped with null. What renders and what
// is pressed is hook-free but the acceptance run's panel and the drawer's banner, so tests press the
// rest without a DOM. Styles: styles/settings.ts.

import { useEffect, useId, useState } from "preact/hooks";
import { ROLE_IDS, ROLE_LABEL, type RoleId } from "../../shared/agent-roles";
import type { AcceptanceConnection, AcceptanceRunView, AcceptanceState, AgentBudget, AgentSettings, ConnectionThrottle, KeptSettings, MemoryPlacement, PipelineMode, ReviewPlacement, TurnBudget } from "../../shared/agent-settings";
import { AT_ONCE_DEF, BUDGET_DEFS, CEILING_MIN, COMPACTION_DEFS, DEFAULT_ACCEPTANCE, defaultAgentSettings, ESTIMATE_FACTOR_MIN, GM_OPS_DEF, KEPT_DEFS, LOOP_DEFS, MAIN_AGENT_ROLE, MEMORY_PLACEMENT_LABELS, MEMORY_PLACEMENTS, OUTPUT_CHARS_DEF, PERSIST_DEFS, PIPELINE_MODE_LABELS, PIPELINE_MODES, REVIEW_PLACEMENT_LABELS, REVIEW_PLACEMENTS, SYSTEM_TOKENS_DEF, THROTTLE_MIN, TURN_DEFS } from "../../shared/agent-settings";
import { NEVER_SKIPPED, PIPELINE_ROLES, STAGE_MODE_LABELS, stageOf, type StageMode } from "../../shared/agent-pipeline";
import { hasOwn, type JsonObject } from "../../shared/json";
import type { MainRoleStage } from "../../shared/main-agent-prompts";
import type { Limit } from "../../shared/minds";
import { ROLE_TASK_ROUTES, taskRoute, type RouteSettings } from "../../shared/role-routes";
import type { SettingsRoute } from "../app";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, Field, HostSwitch, List, NumberStepper, Row, Section, Seg, useBusy } from "../components";
import { agentsChanged, agentsSubChanged } from "./changed";
import { amountText, ChangedBadge, freshNonce, LimitGroup, LimitRow, NavRow, SettingRow, STEP } from "./kit";
import { AGENTS_SUB, AGENTS_SUBS, CURATOR_HELP, MEMORY_HELP, PIPELINE_HELP, REVIEW_HELP, STAGE_LABEL, STREAM_HELP, THINKING_HELP, type AgentsSub } from "./labels";
import { routeText } from "./role-page";
import type { Connection } from "./steps";
import type { UserSettings } from "../../shared/settings";
import { speedChanged } from "../../shared/speed-presets";
import { speedSummary } from "./speed";

/** The defaults each row's Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings();

/** The estimate factor's −/+ step. */
const FACTOR_STEP = 0.5;

/** The −/+ step of the ratio against the steps engine: a convenience, not a limit; typing takes any amount above 0. */
const RATIO_STEP = 0.5;

const n = (value: number): string => value.toLocaleString("en-US");

/** A connection's name, or its id while the names haven't come or when Lumiverse no longer has it. */
function nameOf(id: string, connections: readonly Connection[]): string {
  return connections.find((c) => c.id === id)?.name ?? id;
}

const onOff = (on: boolean): string => (on ? "on" : "off");

/** Settings home's line for the Agents page: how a turn is run, and how many of its settings are changed. */
export function agentsSummary(agents: AgentSettings): string {
  const changed = agentsChanged(agents);
  return `${PIPELINE_MODE_LABELS[agents.pipeline.mode]}${changed > 0 ? ` · ${changed} changed` : ""}`;
}

/** Each section's row on the hub: what it holds now, in a line. */
export function agentsSubSummary(sub: AgentsSub, agents: AgentSettings, connections: readonly Connection[]): string {
  switch (sub) {
    case "pipeline":
      return `${PIPELINE_MODE_LABELS[agents.pipeline.mode]} · memory ${MEMORY_PLACEMENT_LABELS[agents.pipeline.memory].toLowerCase()} · Curator ${onOff(agents.pipeline.curator)}`;
    case "review":
      return REVIEW_PLACEMENT_LABELS[agents.review.placement];
    case "system":
      return `Up to ${amountText(agents.systemTokens, SYSTEM_TOKENS_DEF.unit)}`;
    case "budgets": {
      const turn = (Object.keys(TURN_DEFS) as (keyof TurnBudget)[]).filter((k) => agents.turn[k] !== "none").length;
      return `Each agent: ${amountText(agents.budget.callTokensOut, "tokens")} an answer, ${agents.budget.toolTurns === "none" ? "any number of" : n(agents.budget.toolTurns)} tool rounds · ${turn === 0 ? "no limit for the turn" : `${turn} for the turn`}`;
    }
    case "compaction":
      return `Past ${amountText(agents.compaction.atTokens, "tokens")}, keeping ${n(agents.compaction.keepTurns)} ${agents.compaction.keepTurns === 1 ? "turn" : "turns"} whole`;
    case "recording":
      return `Each line up to ${amountText(agents.recording.outputChars, "chars")}`;
    case "throttles":
      return agents.throttles.length === 0 ? "None: no connection waits" : agents.throttles.map((t) => nameOf(t.id, connections)).join(", ");
    case "caching": {
      const own = Object.keys(agents.caching.roles).length;
      return `${agents.caching.on ? "On" : "Off"} for every role${own > 0 ? ` · ${own} with ${own === 1 ? "its" : "their"} own` : ""}`;
    }
    case "acceptance":
      return agents.acceptance.connections.length === 0 ? "No connection guarded" : `${agents.acceptance.connections.length} guarded: ${agents.acceptance.connections.map((c) => nameOf(c.id, connections)).join(", ")}`;
  }
}

// ---------------------------------------------------------------- a turn at a glance

/** Roles in one stage that run alike: the same route, worked the same way. */
export interface GlanceRow {
  roles: readonly (RoleId | typeof MAIN_AGENT_ROLE)[];
  route: string;
  how: string | null;
}

/** One stage of a turn: its number and name, how it runs while a main agent decides the turn (`mode`: null on the fixed pipeline, and for the final review, which is the main agent's own), and its roles' rows; `off` says why it runs nothing. */
export interface GlanceStage {
  id: MainRoleStage | "review";
  number: number;
  label: string;
  mode: StageMode | null;
  rows: GlanceRow[];
  off: string | null;
}

/** How a role works where that isn't as an agent with tools. */
function roleHow(agents: AgentSettings, id: RoleId): string | null {
  return agents.roles[id].promptOnly ? "one call, no tools" : id === "skip" ? "in a time skip" : null;
}

/**
 * A turn at a glance: each stage in the order a turn plays them, how it runs while a main agent
 * decides the turn (Main agent → Stages), with the roles whose tasks work in it, where each runs (its
 * tasks' routes in that stage) and how; roles alike share a row, and a role switched off (When it
 * runs) or the Curator off in Pipeline has none. The final review is the main agent's; the memory
 * moves to the next turn's start while it is left to it.
 */
export function turnGlance(agents: AgentSettings, routes: RouteSettings, connections: readonly Connection[]): GlanceStage[] {
  const memory: MainRoleStage = agents.pipeline.memory === "before_next" ? "memory_before" : "memory";
  const order: (MainRoleStage | "review")[] = ["intent", "prepare", "beats", "review", "read", memory];
  const main = agents.pipeline.mode === "main";
  return order.map((stage): GlanceStage => {
    if (stage === "review") {
      const route = routeText({ connectionId: agents.main.connectionId, model: agents.main.model, from: agents.main.connectionId === null ? "default" : "role" }, connections);
      return { id: stage, number: 6, label: "Final review", mode: null, rows: agents.finalReview.on ? [{ roles: [MAIN_AGENT_ROLE], route, how: null }] : [], off: agents.finalReview.on ? null : "Off: the narrator gets the prompt as the engine made it" };
    }
    const at = stageOf(stage);
    const rows: GlanceRow[] = [];
    for (const id of ROLE_IDS) {
      const tasks = ROLE_TASK_ROUTES[id].filter((t) => t.stage === at);
      if (tasks.length === 0 || agents.roles[id].run === "off" || (id === "curator" && !agents.pipeline.curator)) continue;
      const places = [...new Set(tasks.map((t) => routeText(taskRoute(routes, id, agents.roles[id], t), connections)))];
      const route = places.length === 1 ? (places[0] ?? "") : `${places.length} connections, by task`;
      const how = roleHow(agents, id);
      const same = rows.find((r) => r.route === route && r.how === how);
      if (same) same.roles = [...same.roles, id];
      else rows.push({ roles: [id], route, how });
    }
    const label = STAGE_LABEL[stage];
    return { id: stage, number: label.number, label: label.label, mode: main ? agents.main.stages[at] : null, rows, off: rows.length === 0 ? "Nothing runs" : null };
  });
}

/** The glance, without hooks: each stage numbered, how it runs while a main agent decides the turn, each row its roles (each opens its page), where they run and how. */
export function TurnGlance(props: { agents: AgentSettings; routes: RouteSettings; connections: readonly Connection[]; go(route: SettingsRoute): void }) {
  const { agents } = props;
  const stages = turnGlance(agents, props.routes, props.connections);
  const main = agents.pipeline.mode === "main";
  const auto = stages.some((s) => s.mode === "auto");
  return (
    <Section title="A turn at a glance" aside={<Badge tone={main ? "accent" : "neutral"}>{PIPELINE_MODE_LABELS[agents.pipeline.mode]}</Badge>} flush>
      <div class="lre-set-glance-wrap" data-lre-glance>
        <p class="lre-set-note">{main ? `The main agent decides which roles run in each stage, and what to tell them${auto ? "; a stage on its own runs its roles as the fixed pipeline does, and the main agent's next message says what ran" : ""}.` : "Each stage runs its roles in the steps' own order, every turn they have work."}</p>
        <ol class="lre-set-glance">
          {stages.map((s) => (
            <li key={s.id} class="lre-set-glance-stage" data-lre-glance-stage={s.id} data-mode={s.mode ?? undefined}>
              <span class="lre-set-glance-num" aria-hidden="true">
                {s.number}
              </span>
              <div class="lre-set-glance-body">
                <span class="lre-set-glance-title">
                  {s.label}
                  {s.mode ? (
                    <>
                      {" "}
                      <Badge tone={s.mode === "auto" ? "accent" : "neutral"}>{STAGE_MODE_LABELS[s.mode]}</Badge>
                    </>
                  ) : null}
                </span>
                {s.off !== null ? <span class="lre-set-glance-row lre-muted">{s.off}</span> : null}
                {s.rows.map((row) => (
                  <span key={row.roles.join(",")} class="lre-set-glance-row" data-lre-glance-row={row.roles.join(",")}>
                    {row.roles.map((role, i) => (
                      <span key={role}>
                        {i > 0 ? ", " : ""}
                        <button type="button" class="lre-set-link" onClick={() => props.go(role === MAIN_AGENT_ROLE ? { page: "main", at: "review" } : { page: "roles", sub: role })}>
                          {role === MAIN_AGENT_ROLE ? "Main agent" : ROLE_LABEL[role]}
                        </button>
                      </span>
                    ))}
                    <span class="lre-set-glance-route">{` · ${row.route}${row.how ? ` · ${row.how}` : ""}`}</span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- the hub

/** Every agent call's two switches: streaming, and thinking in tool loops. Hook-free. */
export function CallSwitches(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { agents, busy } = props;
  return (
    <Section title="Every agent call" flush>
      <div class="lre-set-rows">
        <SettingRow id="stream" label="Streaming" bare changed={agents.stream !== DEFAULTS.stream} help={agents.stream ? STREAM_HELP.on : STREAM_HELP.off} reset={{ label: `Reset streaming agent calls to its default, ${onOff(DEFAULTS.stream)}`, to: onOff(DEFAULTS.stream), onClick: () => props.patch({ agents: { stream: null } }) }} busy={busy}>
          <HostSwitch label="Stream every agent call's answer" checked={agents.stream} disabled={busy} onChange={(stream) => props.patch({ agents: { stream } })} />
        </SettingRow>
        <SettingRow id="thinking" label="Thinking in tool loops" bare changed={agents.thinkingInToolLoops !== DEFAULTS.thinkingInToolLoops} help={agents.thinkingInToolLoops ? THINKING_HELP.on : THINKING_HELP.off} reset={{ label: `Reset thinking in agent tool loops to its default, ${onOff(DEFAULTS.thinkingInToolLoops)}`, to: onOff(DEFAULTS.thinkingInToolLoops), onClick: () => props.patch({ agents: { thinkingInToolLoops: null } }) }} busy={busy}>
          <HostSwitch label="Thinking in agent tool loops" checked={agents.thinkingInToolLoops} disabled={busy} onChange={(thinkingInToolLoops) => props.patch({ agents: { thinkingInToolLoops } })} />
        </SettingRow>
      </div>
    </Section>
  );
}

/** Settings → Agents, without hooks: a turn at a glance, every call's switches, and a row per section. */
export function AgentsHub(props: { agents: AgentSettings; routes: RouteSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void; speed?: UserSettings }) {
  const { agents } = props;
  return (
    <div class="lre-stack" data-lre-settings-page="agents">
      <p class="lre-set-lead">How a chat's turns run once GM → This chat → Engine plays it on agents, and what every agent runs under.</p>
      {props.speed ? (
        <Section title="Speed" flush>
          <List>
            <NavRow id="speed" icon="fast-forward" title="Speed" subtitle={`${speedSummary(props.speed)} · where the last turn's time went, and every setting that decides it`} changed={speedChanged(props.speed)} onOpen={() => props.go({ page: "speed" })} />
          </List>
        </Section>
      ) : null}
      <TurnGlance agents={agents} routes={props.routes} connections={props.connections} go={props.go} />
      <CallSwitches agents={agents} busy={props.busy} patch={props.patch} />
      <Section title="Sections" flush>
        <List>
          {AGENTS_SUBS.map((sub) => (
            <NavRow key={sub} id={sub} icon={AGENTS_SUB[sub].icon} title={AGENTS_SUB[sub].title} subtitle={agentsSubSummary(sub, agents, props.connections)} changed={agentsSubChanged(agents, sub)} onOpen={() => props.go({ page: "agents", sub })} />
          ))}
        </List>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- the sections

/** Pipeline: how a turn is run, when memory runs, and the Curator. Hook-free. */
export function PipelineSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { agents, busy } = props;
  const p = agents.pipeline;
  const d = DEFAULTS.pipeline;
  const set = (fields: JsonObject) => props.patch({ agents: { pipeline: fields } });
  return (
    <div class="lre-set-rows" data-lre-agents-sub="pipeline">
      <SettingRow id="pipeline-mode" label="How a turn is run" changed={p.mode !== d.mode} help={PIPELINE_HELP[p.mode]} reset={{ label: `Reset how a turn is run to its default, ${PIPELINE_MODE_LABELS[d.mode]}`, to: PIPELINE_MODE_LABELS[d.mode], onClick: () => set({ mode: null }) }} busy={busy}>
        <Seg<PipelineMode> label="How an agent turn is run" value={p.mode} options={PIPELINE_MODES.map((value) => ({ value, label: PIPELINE_MODE_LABELS[value] }))} disabled={busy} onChange={(mode) => set({ mode })} />
      </SettingRow>
      <SettingRow id="pipeline-memory" label="When memory runs" changed={p.memory !== d.memory} help={MEMORY_HELP[p.memory]} reset={{ label: `Reset when memory runs to its default, ${MEMORY_PLACEMENT_LABELS[d.memory]}`, to: MEMORY_PLACEMENT_LABELS[d.memory], onClick: () => set({ memory: null }) }} busy={busy}>
        <Seg<MemoryPlacement> label="When the characters' memory runs" value={p.memory} options={MEMORY_PLACEMENTS.map((value) => ({ value, label: MEMORY_PLACEMENT_LABELS[value] }))} disabled={busy} onChange={(memory) => set({ memory })} />
      </SettingRow>
      <SettingRow id="pipeline-curator" label="The Curator" bare changed={p.curator !== d.curator} help={<>{p.curator ? CURATOR_HELP.on : CURATOR_HELP.off} Its tools, tier and budget are on its page in Roles.</>} reset={{ label: `Reset the Curator to its default, ${onOff(d.curator)}`, to: onOff(d.curator), onClick: () => set({ curator: null }) }} busy={busy}>
        <HostSwitch label="The Curator keeps the world's things and places" checked={p.curator} disabled={busy} onChange={(curator) => set({ curator })} />
      </SettingRow>
      <PersistRows agents={agents} busy={busy} patch={props.patch} />
    </div>
  );
}

/** The roles Smart persistence may keep, and those it never skips, in words. */
const KEEPS = ROLE_IDS.filter((r) => PIPELINE_ROLES[r].keep).map((r) => ROLE_LABEL[r]);
const NEVER = NEVER_SKIPPED.map((r) => ROLE_LABEL[r]);

/** Pipeline → Smart persistence: opt-in, for every agent chat; while on, how long a quiet scene is kept, and while off a limit still changed, so the page shows what its count does and its Default stays at hand. Hook-free. */
export function PersistRows(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { busy } = props;
  const s = props.agents.persist;
  const d = DEFAULTS.persist;
  const set = (fields: JsonObject) => props.patch({ agents: { persist: fields } });
  return (
    <div class="lre-set-rows" data-lre-agents-persist>
      <SettingRow
        id="persist-on"
        label="Smart persistence"
        bare
        changed={s.on !== d.on}
        help={
          <>
            {s.on ? `On: while a scene is unchanged since the last turn (the place, who is here and where, the time of day, the world's revision and live lore, the things here and on everyone present, how they regard each other, and no GM fix or marker since), its quiet Live minds and the scene's lore and notes (${KEEPS.join(", ")}) are kept from the last turn instead of asked again, and the narrator is told they are unchanged. A Re-run, a swipe, a Continue, a timelapse, a mind's first thoughts, one the GM asked to refresh and one the player names always ask afresh.` : "Off: every role runs every turn it is asked."} {`Never kept: ${NEVER.join(", ")}.`} Each role's page sets whether it may be kept (When it runs); Main agent → Final review can then send only what changed.
          </>
        }
        reset={{ label: `Reset Smart persistence to its default, ${onOff(d.on)}`, to: onOff(d.on), onClick: () => set({ on: null }) }}
        busy={busy}
      >
        <HostSwitch label="Smart persistence: keep a quiet scene's minds and notes" checked={s.on} disabled={busy} onChange={(on) => set({ on })} />
      </SettingRow>
      {s.on || s.turns !== d.turns || s.minutes !== d.minutes ? (
        <>
          <LimitRow id="persist-turns" def={PERSIST_DEFS.turns} value={s.turns} standard={d.turns} busy={busy} set={(turns) => set({ turns })} />
          <LimitRow id="persist-minutes" def={PERSIST_DEFS.minutes} value={s.minutes} standard={d.minutes} busy={busy} set={(minutes) => set({ minutes })} />
        </>
      ) : null}
    </div>
  );
}

/** Review card: where a turn's changes that ask first wait. Hook-free. */
export function ReviewSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { agents, busy } = props;
  const placement = agents.review.placement;
  const d = DEFAULTS.review.placement;
  return (
    <div class="lre-set-rows" data-lre-agents-sub="review">
      <p class="lre-set-note">An agent turn's changes whose type is set to Confirm (Settings → Changes from the reply) go on one card for the turn, in plain words: Apply all, pick some, or No.</p>
      <SettingRow id="review-placement" label="Where changes that ask first wait" changed={placement !== d} help={REVIEW_HELP[placement]} reset={{ label: `Reset where changes that ask first wait to its default, ${REVIEW_PLACEMENT_LABELS[d]}`, to: REVIEW_PLACEMENT_LABELS[d], onClick: () => props.patch({ agents: { review: { placement: null } } }) }} busy={busy}>
        <Seg<ReviewPlacement> label="Where an agent turn's changes that ask first wait" value={placement} options={REVIEW_PLACEMENTS.map((value) => ({ value, label: REVIEW_PLACEMENT_LABELS[value] }))} disabled={busy} onChange={(next) => props.patch({ agents: { review: { placement: next } } })} />
      </SettingRow>
    </div>
  );
}

/** System instructions: how much of every agent's prompt its system files may take, and what they are. Hook-free. */
export function SystemSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  return (
    <div class="lre-set-rows" data-lre-agents-sub="system">
      <p class="lre-set-note">Every agent is told AGENTS.md, and each role its own roles/&lt;role&gt;.md (main for the main agent, assistant for the GM assistant, a turn role by its name in lowercase), after its own system prompt: your global workspace's (~/) first, then this chat's, each whole in that order. Write them in GM → Workspace; a file that isn't there costs nothing.</p>
      <LimitRow id="systemTokens" def={SYSTEM_TOKENS_DEF} value={props.agents.systemTokens} standard={DEFAULTS.systemTokens} busy={props.busy} open set={(systemTokens) => props.patch({ agents: { systemTokens } })} />
    </div>
  );
}

/** Budgets: each agent's, each turn's, loops and large results, the GM's edits per turn, and what the engine keeps in memory. Hook-free. */
export function BudgetsSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { agents, busy } = props;
  return (
    <div class="lre-stack" data-lre-agents-sub="budgets">
      <p class="lre-set-note">A role, the main agent or the assistant may set any of the first group as its own, on its page; the rest are for every agent.</p>
      <LimitGroup<keyof AgentBudget> id="Each agent" title="Each agent" lead="Each agent's own budget, for the turn it runs in." defs={BUDGET_DEFS} values={agents.budget} standard={DEFAULTS.budget} busy={busy} set={(key, value) => props.patch({ agents: { budget: { [key]: value } } })} />
      <LimitGroup<keyof TurnBudget> id="Each turn" title="Each turn, every agent together" lead="None by default: each agent's own limits bound a turn; set one only where you want a limit for the whole turn." defs={TURN_DEFS} values={agents.turn} standard={DEFAULTS.turn} busy={busy} set={(key, value) => props.patch({ agents: { turn: { [key]: value } } })} />
      <LimitGroup<keyof typeof LOOP_DEFS> id="Loops" title="Loops and large results" defs={LOOP_DEFS} values={{ loopRepeats: agents.loopRepeats, clipChars: agents.clipChars }} standard={{ loopRepeats: DEFAULTS.loopRepeats, clipChars: DEFAULTS.clipChars }} busy={busy} set={(key, value) => props.patch({ agents: { [key]: value } })} />
      <LimitGroup<"gmOpsPerTurn"> id="GM edits" title="The GM's edits" lead="A role makes the GM's own edits only when its page lets it change them." defs={{ gmOpsPerTurn: GM_OPS_DEF }} values={{ gmOpsPerTurn: agents.gmOpsPerTurn }} standard={{ gmOpsPerTurn: DEFAULTS.gmOpsPerTurn }} busy={busy} set={(_, gmOpsPerTurn) => props.patch({ agents: { gmOpsPerTurn } })} />
      <LimitGroup<keyof KeptSettings> id="Kept in memory" title="Kept in memory" lead="What the engine holds at once, across your chats: past each, the oldest, or the one used longest ago, is let go." defs={KEPT_DEFS} values={agents.kept} standard={DEFAULTS.kept} busy={busy} set={(key, value) => props.patch({ agents: { kept: { [key]: value } } })} />
    </div>
  );
}

/** Compaction: when the main agent's session is summarized, and its summarize tool. Hook-free. */
export function CompactionSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { agents, busy } = props;
  const c = agents.compaction;
  const d = DEFAULTS.compaction;
  return (
    <div class="lre-set-rows" data-lre-agents-sub="compaction">
      <p class="lre-set-note">The main agent keeps a session from turn to turn. Past a size, its older turns become one summary; GM → Workspace rolls the latest one back.</p>
      <LimitRow id="atTokens" def={COMPACTION_DEFS.atTokens} value={c.atTokens} standard={d.atTokens} busy={busy} set={(atTokens) => props.patch({ agents: { compaction: { atTokens } } })} />
      <LimitRow id="keepTurns" def={COMPACTION_DEFS.keepTurns} value={c.keepTurns} standard={d.keepTurns} busy={busy} set={(keepTurns) => props.patch({ agents: { compaction: { keepTurns } } })} />
      <SettingRow id="summarize-tool" label="Summarize tool" bare changed={c.summarizeTool !== d.summarizeTool} help="Lets the main agent compact its own session when it judges it time, before the size above." reset={{ label: `Reset the summarize tool to its default, ${onOff(d.summarizeTool)}`, to: onOff(d.summarizeTool), onClick: () => props.patch({ agents: { compaction: { summarizeTool: null } } }) }} busy={busy}>
        <HostSwitch label="The main agent's summarize tool" checked={c.summarizeTool} disabled={busy} onChange={(summarizeTool) => props.patch({ agents: { compaction: { summarizeTool } } })} />
      </SettingRow>
    </div>
  );
}

/** Recording: how long each line an agent turn records for the narrator may be. Hook-free. */
export function RecordingSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  return (
    <div class="lre-set-rows" data-lre-agents-sub="recording">
      <p class="lre-set-note">What an agent turn records for the narrator, kept with the turn so a Re-narrate gives the narrator the same.</p>
      <LimitRow id="outputChars" def={OUTPUT_CHARS_DEF} value={props.agents.recording.outputChars} standard={DEFAULTS.recording.outputChars} busy={props.busy} open set={(outputChars) => props.patch({ agents: { recording: { outputChars } } })} />
    </div>
  );
}

/** A per-minute throttle or a run's ceiling: an Off or No limit switch, and the number while it's set. */
function OptionalLimit(props: { label: string; offLabel: string; value: Limit; min: number; onValue: number; step: number; busy: boolean; set(value: Limit): void }) {
  return (
    <div class="lre-set-optional">
      <HostSwitch label={`${props.label}: ${props.offLabel}`} checked={props.value === "none"} disabled={props.busy} onChange={(off) => props.set(off ? "none" : props.onValue)} />
      {props.value === "none" ? null : <NumberStepper label={props.label} value={props.value} min={props.min} step={props.step} integer disabled={props.busy} onChange={props.set} />}
    </div>
  );
}

/** Add one of the connections not yet listed. */
function AddConnection(props: { taken: readonly string[]; connections: readonly Connection[]; action: string; busy: boolean; add(id: string): void }) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const free = props.connections.filter((c) => !props.taken.includes(c.id));
  const first = free[0];
  if (!first) return <p class="lre-set-note">No other connection to add.</p>;
  const chosen = free.some((c) => c.id === choice) ? choice : first.id;
  return (
    <div class="lre-set-row">
      <Field label="Connection" for={id}>
        <select id={id} class="lre-input" value={chosen} disabled={props.busy} onChange={(event) => setChoice(event.currentTarget.value)}>
          {free.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.model ? ` — ${c.model}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <Button size="sm" icon="plus" disabled={props.busy} onClick={() => props.add(chosen)}>
          {props.action}
        </Button>
      </div>
    </div>
  );
}

/** Throttles: per connection, requests and tokens per minute, and calls at once. Hook-free but its picker. */
export function ThrottlesSection(props: { throttles: readonly ConnectionThrottle[]; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void }) {
  // The list goes whole: a merge patch replaces an array, it never merges one.
  const save = (next: readonly ConnectionThrottle[]) => props.patch({ agents: { throttles: next.map((t) => ({ id: t.id, requestsPerMinute: t.requestsPerMinute, tokensPerMinute: t.tokensPerMinute, atOnce: t.atOnce })) } });
  const change = (id: string, part: Partial<Omit<ConnectionThrottle, "id">>) => save(props.throttles.map((t) => (t.id === id ? { ...t, ...part } : t)));
  return (
    <div class="lre-set-rows" data-lre-agent-throttles>
      <p class="lre-set-note">How many requests and tokens (sent and written) the agents may use each minute on a connection, a call past either waiting for the minute to turn; and how many calls may be under way on it at once, every agent's and every prompt-only role's through one gate, a call past it waiting for one to end. A connection not listed has none.</p>
      {props.throttles.map((t) => {
        const name = nameOf(t.id, props.connections);
        return (
          <div key={t.id} class="lre-set-row" data-lre-agent-throttle={t.id}>
            <div class="lre-set-row-head">
              <span class="lre-set-row-label">{name}</span>
              <Button size="sm" variant="ghost" icon="trash" label={`Remove ${name}'s throttle`} disabled={props.busy} onClick={() => save(props.throttles.filter((x) => x.id !== t.id))}>
                Remove
              </Button>
            </div>
            <OptionalLimit label={`${name}: requests per minute`} offLabel="off" value={t.requestsPerMinute} min={THROTTLE_MIN} onValue={THROTTLE_MIN} step={STEP.count} busy={props.busy} set={(requestsPerMinute) => change(t.id, { requestsPerMinute })} />
            <OptionalLimit label={`${name}: tokens per minute`} offLabel="off" value={t.tokensPerMinute} min={THROTTLE_MIN} onValue={THROTTLE_MIN} step={STEP.tokens} busy={props.busy} set={(tokensPerMinute) => change(t.id, { tokensPerMinute })} />
            <OptionalLimit label={`${name}: ${AT_ONCE_DEF.label.toLowerCase()}`} offLabel="no limit" value={t.atOnce} min={AT_ONCE_DEF.min} onValue={2} step={STEP.count} busy={props.busy} set={(atOnce) => change(t.id, { atOnce })} />
          </div>
        );
      })}
      <AddConnection taken={props.throttles.map((t) => t.id)} connections={props.connections} action="Add a throttle" busy={props.busy} add={(id) => save([...props.throttles, { id, requestsPerMinute: "none", tokensPerMinute: "none", atOnce: "none" }])} />
    </div>
  );
}

/** The agents' names, for those with caching of their own: a turn role's label, the main agent and the assistant. */
function agentName(id: string): string {
  return hasOwn(ROLE_LABEL, id) ? ROLE_LABEL[id as RoleId] : id === MAIN_AGENT_ROLE ? "Main agent" : id === "assistant" ? "Assistant" : id;
}

/** Caching: every role's switch and Bust, and the agents with caching of their own, each opening its page. Hook-free. */
export function CachingSection(props: { agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { caching } = props.agents;
  const own = Object.keys(caching.roles);
  return (
    <div class="lre-set-rows" data-lre-agent-caching>
      <p class="lre-set-note">Marks where the provider may keep the start of a prompt, so the next call that starts the same reads it for less. Bust makes the next calls miss the provider's cached prompt once; they're sent whole and cached again.</p>
      <SettingRow id="caching-every" label="Every role" bare changed={caching.on !== DEFAULTS.caching.on} help="An agent with caching of its own, below, keeps its own." reset={{ label: `Reset caching for every role to its default, ${onOff(DEFAULTS.caching.on)}`, to: onOff(DEFAULTS.caching.on), onClick: () => props.patch({ agents: { caching: { on: null } } }) }} busy={props.busy}>
        <HostSwitch label="Caching for every role" checked={caching.on} disabled={props.busy} onChange={(on) => props.patch({ agents: { caching: { on } } })} />
        <div class="lre-row-actions">
          <Button size="sm" variant="secondary" icon="refresh" label="Bust every role's cache" disabled={props.busy} onClick={() => props.patch({ agents: { caching: { nonce: freshNonce() } } })}>
            Bust
          </Button>
        </div>
      </SettingRow>
      {own.length === 0 ? <p class="lre-set-note">No agent has caching of its own: each one's page can give it some.</p> : null}
      {own.length > 0 ? (
        <List>
          {own.map((id) => (
            <NavRow key={id} id={`caching-${id}`} title={agentName(id)} subtitle={`Its own: ${caching.roles[id]?.on ? "on" : "off"}`} changed={1} onOpen={() => props.go(id === MAIN_AGENT_ROLE ? { page: "main", at: "caching" } : id === "assistant" ? { page: "assistant", at: "caching" } : { page: "roles", sub: id, at: "caching" })} />
          ))}
        </List>
      ) : null}
    </div>
  );
}

/** The open run and the last one closed: asked for on mount, then followed by its push. */
function useAcceptance(): [AcceptanceState | null, (state: AcceptanceState) => void] {
  const app = useApp();
  const [state, setState] = useState<AcceptanceState | null>(null);
  useEffect(() => {
    let live = true;
    // A push that came while `get` was out is newer than its answer.
    let pushed = false;
    const off = app.client.onAcceptance((next) => {
      pushed = true;
      setState(next);
    });
    void app.request({ type: "lre.acceptance", op: "get" }).then((result) => {
      if (live && !pushed && result) setState(result);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return [state, setState];
}

function ceilingText(ceiling: Limit | undefined): string {
  return ceiling === undefined ? "no ceiling" : ceiling === "none" ? "no limit" : n(ceiling);
}

/** One connection's spend in a run, against its ceilings; what calls in flight hold while the run is open. */
function SpendCard(props: { spend: AcceptanceRunView["connections"][number]; name: string; open: boolean }) {
  const { spent, reserved, ceiling } = props.spend;
  return (
    <div class="lre-set-row" data-lre-acceptance-connection={props.spend.id}>
      <div class="lre-set-row-head">
        <span class="lre-set-row-label">{props.name}</span>
        {spent.estimated ? <Badge tone="warn">Estimated</Badge> : null}
      </div>
      <Row k="In" sub={`${n(spent.cachedIn)} cached`} v={`${n(spent.tokensIn)} / ${ceilingText(ceiling?.tokensIn)}`} tone={ceiling && ceiling.tokensIn !== "none" && spent.tokensIn >= ceiling.tokensIn ? "warn" : undefined} />
      <Row k="Out" v={`${n(spent.tokensOut)} / ${ceilingText(ceiling?.tokensOut)}`} tone={ceiling && ceiling.tokensOut !== "none" && spent.tokensOut >= ceiling.tokensOut ? "warn" : undefined} />
      <Row k="Calls" v={n(spent.calls)} />
      <Row k="Refused" v={n(spent.refused)} tone={spent.refused > 0 ? "warn" : undefined} />
      {props.open ? <Row k="Reserved now" v={`in ${n(reserved.tokensIn)} · out ${n(reserved.tokensOut)}`} /> : null}
      {ceiling === null ? <span class="lre-small lre-muted">Not under Acceptance runs now, so no ceiling holds it.</span> : null}
      {spent.estimated ? <span class="lre-small lre-muted">Some of this is the runtime's own estimate: the provider didn't report it.</span> : null}
    </div>
  );
}

function RunPanel(props: { connections: readonly Connection[] }) {
  const app = useApp();
  const [state, setState] = useAcceptance();
  const [label, setLabel] = useState("");
  const [busy, run] = useBusy();
  const id = useId();
  if (state === null) return <Empty>Loading the acceptance run…</Empty>;
  const open = state.run;
  return (
    <>
      {open === null ? (
        <div class="lre-set-row" data-lre-acceptance-run="closed">
          <Field label="Label" for={id} help="Names the run in its report.">
            <input id={id} class="lre-input" value={label} disabled={busy} onInput={(event) => setLabel(event.currentTarget.value)} />
          </Field>
          <div>
            <Button
              variant="primary"
              icon="play"
              disabled={busy || label.trim() === ""}
              onClick={() =>
                run(async () => {
                  const result = await app.request({ type: "lre.acceptance", op: "open", label: label.trim() });
                  if (!result) return;
                  setState(result);
                  setLabel("");
                })
              }
            >
              Open an acceptance run
            </Button>
          </div>
        </div>
      ) : (
        <div data-lre-acceptance-run="open">
          <div class="lre-set-row">
            <div class="lre-set-row-head">
              <span class="lre-set-row-label">{open.label}</span>
              <Badge tone="accent">Open</Badge>
            </div>
            <span class="lre-small lre-muted">Opened {new Date(open.openedAt).toLocaleString()}</span>
          </div>
          {open.connections.length === 0 ? <p class="lre-set-note">No guarded connection has made a call in this run yet.</p> : null}
          {open.connections.map((spend) => (
            <SpendCard key={spend.id} spend={spend} name={nameOf(spend.id, props.connections)} open />
          ))}
          <div class="lre-row-actions">
            <Button
              variant="secondary"
              icon="pause"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await app.request({ type: "lre.acceptance", op: "close" });
                  if (result) setState(result);
                })
              }
            >
              Close the run
            </Button>
          </div>
        </div>
      )}
      {state.last ? (
        <div data-lre-acceptance-last>
          <p class="lre-set-note">
            <strong>Last run: {state.last.label}.</strong> {new Date(state.last.openedAt).toLocaleString()}
            {state.last.closedAt === null ? "" : ` to ${new Date(state.last.closedAt).toLocaleString()}`}
          </p>
          {state.last.connections.length === 0 ? <p class="lre-set-note">No guarded connection made a call in it.</p> : null}
          {state.last.connections.map((spend) => (
            <SpendCard key={spend.id} spend={spend} name={nameOf(spend.id, props.connections)} open={false} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Acceptance runs, without hooks of its own: the connections they guard, the estimate factor, the target against the steps engine, and the run (`RunPanel`). */
export function AcceptanceSection(props: { acceptance: AgentSettings["acceptance"]; vsClassic: number; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void }) {
  const { connections: guarded, estimateFactor } = props.acceptance;
  // The list goes whole: a merge patch replaces an array, it never merges one.
  const save = (next: readonly AcceptanceConnection[]) => props.patch({ agents: { acceptance: { connections: next.map((c) => ({ id: c.id, only: c.only, tokensIn: c.tokensIn, tokensOut: c.tokensOut })) } } });
  const change = (id: string, part: Partial<Omit<AcceptanceConnection, "id">>) => save(guarded.map((c) => (c.id === id ? { ...c, ...part } : c)));
  const factorDefault = DEFAULTS.acceptance.estimateFactor;
  return (
    <div class="lre-stack" data-lre-agents-sub="acceptance">
      <Section title="Guarded connections" aside={guarded.length > 0 ? <ChangedBadge count={guarded.length} /> : undefined} flush>
        <div class="lre-set-rows" data-lre-acceptance-connections>
          <p class="lre-set-note">One that's only in acceptance runs is refused unless a run is open. While a run is open, every call reserves its estimated prompt plus its max tokens before it goes, and a call that would pass a ceiling isn't sent.</p>
          {guarded.map((c) => {
            const name = nameOf(c.id, props.connections);
            return (
              <div key={c.id} class="lre-set-row" data-lre-acceptance-guard={c.id}>
                <div class="lre-set-row-head">
                  <span class="lre-set-row-label">{name}</span>
                  <Button size="sm" variant="ghost" icon="trash" label={`Stop guarding ${name}`} disabled={props.busy} onClick={() => save(guarded.filter((x) => x.id !== c.id))}>
                    Remove
                  </Button>
                </div>
                <HostSwitch label={`${name}: only in acceptance runs`} checked={c.only} disabled={props.busy} onChange={(only) => change(c.id, { only })} />
                <OptionalLimit label={`${name}: input tokens per run`} offLabel="no limit" value={c.tokensIn} min={CEILING_MIN} onValue={DEFAULT_ACCEPTANCE.tokensIn === "none" ? CEILING_MIN : DEFAULT_ACCEPTANCE.tokensIn} step={STEP.tokens} busy={props.busy} set={(tokensIn) => change(c.id, { tokensIn })} />
                <OptionalLimit label={`${name}: output tokens per run`} offLabel="no limit" value={c.tokensOut} min={CEILING_MIN} onValue={DEFAULT_ACCEPTANCE.tokensOut === "none" ? CEILING_MIN : DEFAULT_ACCEPTANCE.tokensOut} step={STEP.tokens} busy={props.busy} set={(tokensOut) => change(c.id, { tokensOut })} />
              </div>
            );
          })}
          <AddConnection taken={guarded.map((c) => c.id)} connections={props.connections} action="Add a connection" busy={props.busy} add={(id) => save([...guarded, { ...DEFAULT_ACCEPTANCE, id }])} />
        </div>
      </Section>
      <Section title="Estimates and targets" flush>
        <div class="lre-set-rows">
          <SettingRow id="estimateFactor" label="Estimate factor" bare changed={estimateFactor !== factorDefault} help="A model the runtime hasn't seen answer yet reserves its estimated prompt times this, until its first call reports real usage." reset={{ label: `Reset Estimate factor to its default, ${factorDefault}`, to: String(factorDefault), onClick: () => props.patch({ agents: { acceptance: { estimateFactor: null } } }) }} busy={props.busy}>
            <NumberStepper label="Estimate factor" value={estimateFactor} min={ESTIMATE_FACTOR_MIN} step={FACTOR_STEP} disabled={props.busy} onChange={(next) => props.patch({ agents: { acceptance: { estimateFactor: next } } })} />
          </SettingRow>
          <SettingRow id="vsClassic" label="Against the steps engine" bare changed={props.vsClassic !== DEFAULTS.vsClassic} help="The target an acceptance comparison holds agent turns to: per role, an agent turn's tokens against the same scenario's turn on the steps engine, at most this many times. Nothing stops a turn past it: compare each turn's tokens, per role, in Settings → Diagnostics. Any amount above 0; under 1, an agent turn should spend less." reset={{ label: `Reset Against the steps engine to its default, ${DEFAULTS.vsClassic}×`, to: `${DEFAULTS.vsClassic}×`, onClick: () => props.patch({ agents: { vsClassic: null } }) }} busy={props.busy}>
            <NumberStepper label="Tokens against the steps engine (times)" value={props.vsClassic} min={0} step={RATIO_STEP} disabled={props.busy} onChange={(next) => (next > 0 ? props.patch({ agents: { vsClassic: next } }) : undefined)} />
          </SettingRow>
        </div>
      </Section>
      <Section title="The acceptance run" flush>
        <div class="lre-set-rows" data-lre-acceptance-counter>
          <p class="lre-set-note">Open a run before calls on a guarded connection, and close it when you're done; its report stays here until the next one closes.</p>
          <RunPanel connections={props.connections} />
        </div>
      </Section>
    </div>
  );
}

/** One of Settings → Agents' sections, as its own page. Hook-free but Throttles' and Acceptance runs' pickers and the run's panel. */
export function AgentsSubPage(props: { sub: AgentsSub; agents: AgentSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { agents, busy, patch } = props;
  switch (props.sub) {
    case "pipeline":
      return <PipelineSection agents={agents} busy={busy} patch={patch} />;
    case "review":
      return <ReviewSection agents={agents} busy={busy} patch={patch} />;
    case "system":
      return <SystemSection agents={agents} busy={busy} patch={patch} />;
    case "budgets":
      return <BudgetsSection agents={agents} busy={busy} patch={patch} />;
    case "compaction":
      return <CompactionSection agents={agents} busy={busy} patch={patch} />;
    case "recording":
      return <RecordingSection agents={agents} busy={busy} patch={patch} />;
    case "throttles":
      return <ThrottlesSection throttles={agents.throttles} connections={props.connections} busy={busy} patch={patch} />;
    case "caching":
      return <CachingSection agents={agents} busy={busy} patch={patch} go={props.go} />;
    case "acceptance":
      return <AcceptanceSection acceptance={agents.acceptance} vsClassic={agents.vsClassic} connections={props.connections} busy={busy} patch={patch} />;
  }
}

/** Spend and ceilings summed over a run's connections; a ceiling is "none" when any connection's is, or none has one. */
function runTotals(run: AcceptanceRunView): { tokensIn: number; tokensOut: number; ceilingIn: Limit; ceilingOut: Limit; estimated: boolean } {
  let tokensIn = 0;
  let tokensOut = 0;
  let ceilingIn: Limit = 0;
  let ceilingOut: Limit = 0;
  let ceilings = 0;
  let estimated = false;
  for (const c of run.connections) {
    tokensIn += c.spent.tokensIn;
    tokensOut += c.spent.tokensOut;
    estimated ||= c.spent.estimated;
    if (c.ceiling === null) continue;
    ceilings += 1;
    ceilingIn = ceilingIn === "none" || c.ceiling.tokensIn === "none" ? "none" : ceilingIn + c.ceiling.tokensIn;
    ceilingOut = ceilingOut === "none" || c.ceiling.tokensOut === "none" ? "none" : ceilingOut + c.ceiling.tokensOut;
  }
  return ceilings === 0 ? { tokensIn, tokensOut, ceilingIn: "none", ceilingOut: "none", estimated } : { tokensIn, tokensOut, ceilingIn, ceilingOut, estimated };
}

/** The drawer's counter while an acceptance run is open: its label and what its guarded connections spent, summed, against their ceilings. */
export function AcceptanceBanner() {
  const app = useApp();
  const [state] = useAcceptance();
  const open = state?.run ?? null;
  if (open === null) return null;
  const t = runTotals(open);
  return (
    <div class="lre-acceptance-banner" data-lre-acceptance-banner>
      <Banner
        tone="info"
        actions={
          <Button size="sm" variant="ghost" icon="sliders" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "settings", settings: { page: "agents", sub: "acceptance" } }))}>
            Acceptance runs
          </Button>
        }
      >
        <span class="lre-num">
          {`Acceptance run open · ${open.label} · in ${n(t.tokensIn)}/${ceilingText(t.ceilingIn)} · out ${n(t.tokensOut)}/${ceilingText(t.ceilingOut)}`}
          {t.estimated ? " · estimated" : ""}
        </span>
      </Banner>
    </div>
  );
}
