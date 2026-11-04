// Each agent's page, on one template (Settings → Agents → Roles → a role; Main agent and Assistant
// lay theirs out the same): Runs on (each task, and the connection and model it actually runs on),
// What it may do (its tool families as chips, and what it may change), What it reads (the perspective
// it works from, each source, its pinned files), When it runs and fails, its Budget (only the limits
// of its own, and a picker that sets one more), Caching and its Prompts. Every setting shows Changed
// while it differs from its default, and Default only then; Reset at the foot puts the whole page
// back. A role's settings are `agents.roles[<role>]`, what it reads `agents.context.roles[<role>]`,
// its caching `agents.caching.roles[<role>]` and the Curator's ops per turn `agents.curatorOps`; a
// Default sends null, so the store reads the shipped defaults back. Hook-free, so tests press it
// without a DOM. Styles: styles/settings.ts.

import type { ComponentChildren } from "preact";
import { CONTEXT_SOURCES, defaultContextSettings, PERSPECTIVE_LABEL, ROLE_PERSPECTIVES, type RolePerspective, SOURCE_USE_LABEL, SOURCE_USES, type SourceUse, sourceLabel, sourceUse, withSourceUse } from "../../shared/agent-context";
import { ROLE_LABEL, ROLE_ON_FAIL, ROLE_TIERS, type RoleId, type RoleOnFail, type RoleTier } from "../../shared/agent-roles";
import { AGENT_EFFORTS, BUDGET_DEFS, CURATOR_OPS_DEF, defaultAgentSettings, roleCaching, type AgentBudget, type AgentEffort, type AgentSettings } from "../../shared/agent-settings";
import { TOOL_FAMILY_LABEL, type ToolFamily } from "../../shared/agent-tools";
import { hasOwn, type JsonObject } from "../../shared/json";
import type { PromptSettings } from "../../shared/prompts";
import { PROMPTS } from "../../shared/prompts";
import { rolePageId } from "../../shared/role-prompts";
import { roleRoutes, type RouteSettings, type TaskRoute } from "../../shared/role-routes";
import type { SettingsRoute } from "../app";
import { Button, Disclosure, HostModelPicker, HostSwitch, Section, Seg } from "../components";
import { contextChanged, ownChanged, roleChanged } from "./changed";
import { ChangedBadge, freshNonce, LimitRow, NavRow, OwnBudget, SettingRow, ToggleChips } from "./kit";
import { EFFORT_HELP, EFFORT_LABEL, ON_FAIL_HELP, ON_FAIL_LABEL, PERSPECTIVE_HELP, ROUTE_FROM, taskLabel, TIER_HELP, TIER_LABEL, USE_HELP } from "./labels";
import { type Connection, ConnectionSelect, placeOf } from "./steps";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings();
const CONTEXT = defaultContextSettings();

/** Every tool family, in the order the pages list them. */
export const FAMILIES = Object.keys(TOOL_FAMILY_LABEL) as ToolFamily[];

/** A name a label starts with: "the main agent" opens "The main agent: model". */
function cap(owner: string): string {
  return `${owner.charAt(0).toUpperCase()}${owner.slice(1)}`;
}

/** Every budget limit, in the order the pages list them. */
export const BUDGET_KEYS = Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[];

/** A page's sections, by id: what Context's rows open a role's page at (`at`). */
export type AgentSection = "runs" | "may" | "reads" | "when" | "review" | "budget" | "caching" | "prompts";

/** The settings patch (`lre.settings.set`) for some of a role's settings; a field sent as null is deleted, so the store reads its default. */
export function rolePatch(id: RoleId, fields: JsonObject): JsonObject {
  return { agents: { roles: { [id]: fields } } };
}

/** The settings patch for some of a role's context fields; a role sent as null is deleted, so the store reads its defaults. */
export function contextPatch(role: RoleId, fields: JsonObject | null): JsonObject {
  return { agents: { context: { roles: { [role]: fields } } } };
}

/** A role's page put back: its settings, what it reads and its own caching go, and the Curator's ops per turn, so the store reads the shipped defaults back. */
export function roleResetPatch(id: RoleId): JsonObject {
  return { agents: { roles: { [id]: null }, context: { roles: { [id]: null } }, caching: { roles: { [id]: null } }, ...(id === "curator" ? { curatorOps: null } : {}) } };
}

/** The pinned paths as typed, one a line: trimmed, blank lines left out, each once. */
export function pinsOf(text: string): string[] {
  return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line !== ""))];
}

/** A route in words: the connection and model, and where it comes from; Lumiverse's default connection alone says so. */
export function routeText(route: Pick<TaskRoute, "connectionId" | "model" | "from">, connections: readonly Connection[]): string {
  const place = placeOf(route, connections);
  return route.from === "default" ? place : `${place} (${ROUTE_FROM[route.from]})`;
}

/** How many of your own texts a Prompts page holds. */
export function ownTexts(prompts: PromptSettings, page: string): number {
  return PROMPTS.filter((def) => def.page === page && prompts.texts[def.id] !== undefined).length;
}

/** An agent's reasoning effort, in the pages' words. */
export function EffortSelect(props: { label: string; value: AgentEffort; busy: boolean; set(effort: AgentEffort): void }) {
  return (
    <label class="lre-field">
      <span class="label">Reasoning effort</span>
      <select
        class="lre-input"
        aria-label={props.label}
        value={props.value}
        disabled={props.busy}
        onChange={(event) => {
          const effort = AGENT_EFFORTS.find((e) => e === event.currentTarget.value);
          if (effort) props.set(effort);
        }}
      >
        {AGENT_EFFORTS.map((e) => (
          <option key={e} value={e}>
            {EFFORT_LABEL[e]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One section of an agent's page, under its title, with how many of its settings are changed. */
export interface PageSection {
  id: AgentSection;
  title: string;
  changed: number;
  body: ComponentChildren;
}

/** The template: a lead, each section under its title, and while anything differs, Reset to put the whole page back. */
export function AgentPage(props: { id: string; lead: ComponentChildren; sections: readonly PageSection[]; changed: number; resetLabel: string; busy: boolean; reset(): void }) {
  return (
    <div class="lre-stack lre-set-agent" data-lre-settings-page={props.id}>
      {props.lead !== null ? <p class="lre-set-lead">{props.lead}</p> : null}
      {props.sections.map((s) => (
        <div key={s.id} class="lre-set-agent-section" data-lre-agent-section={s.id} tabIndex={-1}>
          <Section title={s.title} aside={s.changed > 0 ? <ChangedBadge count={s.changed} /> : undefined} flush>
            {s.body}
          </Section>
        </div>
      ))}
      {props.changed > 0 ? (
        <div class="lre-set-agent-reset">
          <Button variant="secondary" icon="undo" label={props.resetLabel} disabled={props.busy} onClick={props.reset}>
            Reset this page
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Each task and the connection and model it runs on. */
export function RoutesList(props: { routes: readonly TaskRoute[]; connections: readonly Connection[] }) {
  return (
    <ul class="lre-set-routes">
      {props.routes.map((r) => (
        <li key={r.task} class="lre-set-route" data-lre-route={r.task}>
          <span class="lre-set-route-task">{taskLabel(r.role, r.task)}</span>
          <span class="lre-set-route-to">{routeText(r, props.connections)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A connection and its model as one setting: the picker for a connection, the model once one is picked. */
export function ConnectionSetting(props: { id: string; owner: string; value: { connectionId: string | null; model: string | null }; changed: boolean; noneLabel: string; noneHelp: string; to: string; connections: readonly Connection[]; busy: boolean; set(fields: JsonObject): void }) {
  const { value } = props;
  return (
    <SettingRow id={props.id} label="Connection and model" bare changed={props.changed} help={value.connectionId ? "Pick from the connection's models, or type one. Empty uses the connection's own model." : props.noneHelp} reset={{ label: `Reset ${props.owner}'s connection and model to their default, ${props.to}`, to: props.to, onClick: () => props.set({ connectionId: null, model: null }) }} busy={props.busy}>
      <ConnectionSelect value={value.connectionId} connections={props.connections} firstLabel={props.noneLabel} disabled={props.busy} onChange={(connectionId) => props.set({ connectionId, model: null })} />
      {value.connectionId ? <HostModelPicker connectionId={value.connectionId} value={value.model ?? ""} label={`${cap(props.owner)}: model`} onChange={(model) => props.set({ model: model || null })} /> : null}
    </SettingRow>
  );
}

/** An agent's effort as one setting. */
export function EffortSetting(props: { owner: string; value: AgentEffort; standard: AgentEffort; note?: ComponentChildren; busy: boolean; set(effort: AgentEffort | null): void }) {
  return (
    <SettingRow id="effort" label="Reasoning" bare changed={props.value !== props.standard} help={<>{EFFORT_HELP[props.value]}{props.note ? <> {props.note}</> : null}</>} reset={{ label: `Reset ${props.owner}'s effort to its default, ${EFFORT_LABEL[props.standard]}`, to: EFFORT_LABEL[props.standard], onClick: () => props.set(null) }} busy={props.busy}>
      <EffortSelect label={`${cap(props.owner)}: reasoning effort`} value={props.value} busy={props.busy} set={props.set} />
    </SettingRow>
  );
}

/** An agent's tool families as chips, as one setting. */
export function FamiliesSetting(props: { owner: string; value: readonly ToolFamily[]; standard: readonly ToolFamily[]; help: ComponentChildren; busy: boolean; set(families: ToolFamily[] | null): void }) {
  const changed = props.value.length !== props.standard.length || props.value.some((f) => !props.standard.includes(f));
  const to = props.standard.length > 0 ? props.standard.map((f) => TOOL_FAMILY_LABEL[f]).join(", ") : "none";
  return (
    <SettingRow id="families" label="Tools" changed={changed} help={props.help} reset={{ label: `Reset ${props.owner}'s tools to their default, ${to}`, to, onClick: () => props.set(null) }} busy={props.busy}>
      <ToggleChips<ToolFamily> label={`${cap(props.owner)}: tools`} options={FAMILIES.map((value) => ({ value, label: TOOL_FAMILY_LABEL[value] }))} on={props.value} busy={props.busy} toggle={(family, on) => props.set(FAMILIES.filter((f) => (f === family ? on : props.value.includes(f))))} />
    </SettingRow>
  );
}

/** An agent's own caching: on or off, Bust, and while it has its own, Default to follow every role's again. */
export function CachingSetting(props: { id: string; owner: string; agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const own = hasOwn(props.agents.caching.roles, props.id);
  const now = roleCaching(props.agents, props.id);
  const set = (value: { on: boolean; nonce: string } | null) => props.patch({ agents: { caching: { roles: { [props.id]: value } } } });
  return (
    <SettingRow id="caching" label="Prompt caching" bare changed={own} help="Marks where the provider may keep the start of its prompts, so its next call that starts the same reads it for less. Bust makes its next calls miss the cache once." reset={{ label: `Reset ${props.owner}'s caching to every role's`, to: `every role's (${props.agents.caching.on ? "on" : "off"})`, onClick: () => set(null) }} busy={props.busy}>
      <HostSwitch label={`Caching for ${props.owner}`} checked={now.on} disabled={props.busy} onChange={(on) => set({ on, nonce: now.nonce })} />
      <div class="lre-row-actions">
        <Button size="sm" variant="secondary" icon="refresh" label={`Bust ${props.owner}'s cache`} disabled={props.busy} onClick={() => set({ on: now.on, nonce: freshNonce() })}>
          Bust
        </Button>
      </div>
    </SettingRow>
  );
}

/** An agent's prompts: a row to its page on Prompts, with how many texts there are your own. */
export function PromptsLink(props: { page: string; owner: string; prompts: PromptSettings; go(route: SettingsRoute): void }) {
  const own = ownTexts(props.prompts, props.page);
  return (
    <NavRow id={`prompts-${props.page}`} icon="edit" title={`${props.owner}'s prompts`} subtitle={own === 0 ? "Every text as shipped" : `${own} ${own === 1 ? "text" : "texts"} of your own`} changed={0} onOpen={() => props.go({ page: "prompts", open: { page: props.page } })} />
  );
}

/** What a role reads: the perspective it works from, how it gets each source, and its pinned files. */
export function ReadsSection(props: { id: RoleId; agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { id, agents, busy } = props;
  const c = agents.context.roles[id];
  const d = CONTEXT.roles[id];
  const label = ROLE_LABEL[id];
  const set = (fields: JsonObject) => props.patch(contextPatch(id, fields));
  const named = (list: readonly string[]) => (list.length > 0 ? list.map(sourceLabel).join(", ") : "nothing");
  const sourcesChanged = CONTEXT_SOURCES.filter((s) => sourceUse(c, s) !== sourceUse(d, s)).length;
  const pinsChanged = c.pins.length !== d.pins.length || c.pins.some((p) => !d.pins.includes(p));
  return (
    <div class="lre-set-rows" data-lre-context-role={id}>
      <SettingRow id="perspective" label="Perspective" changed={c.perspective !== d.perspective} help={PERSPECTIVE_HELP[c.perspective]} reset={{ label: `Reset ${label}'s perspective to its default, ${PERSPECTIVE_LABEL[d.perspective]}`, to: PERSPECTIVE_LABEL[d.perspective], onClick: () => set({ perspective: null }) }} busy={busy}>
        <Seg<RolePerspective> label={`${label}: the perspective it works from`} value={c.perspective} options={ROLE_PERSPECTIVES.map((value) => ({ value, label: PERSPECTIVE_LABEL[value] }))} disabled={busy} onChange={(perspective) => set({ perspective })} />
      </SettingRow>
      <SettingRow id="sources" label="Sources" changed={sourcesChanged > 0} help={`Starts with ${c.start.length > 0 ? named(c.start) : "its task alone"}${c.never.length > 0 ? `; never ${named(c.never)}` : ""}; the rest when needed. Each as the narrator would get it, secrets marked.`} reset={{ label: `Reset the sources ${label} reads to their defaults`, to: `starts with ${d.start.length > 0 ? named(d.start) : "its task alone"}`, onClick: () => set({ start: null, never: null }) }} busy={busy}>
        <Disclosure summary="Each source">
          {CONTEXT_SOURCES.map((source) => {
            const use = sourceUse(c, source);
            return (
              <div key={source} class="lre-field" data-lre-context-source={source}>
                <Seg<SourceUse> label={`${label}: ${sourceLabel(source)}`} value={use} options={SOURCE_USES.map((value) => ({ value, label: SOURCE_USE_LABEL[value] }))} disabled={busy} onChange={(next) => set(withSourceUse(c, source, next))} />
                <span class="lre-field-help">{`${sourceLabel(source)}: ${USE_HELP[use]}.`}</span>
              </div>
            );
          })}
        </Disclosure>
      </SettingRow>
      <SettingRow id="pins" label="Pinned files" changed={pinsChanged} help="Workspace paths, one a line, read whole within the pins budget before .pins.json's and those pinned in GM → Workspace. A path the chat has no file at is passed over." reset={{ label: `Reset ${label}'s pinned files to none`, to: "none", onClick: () => set({ pins: null }) }} busy={busy}>
        <textarea class="lre-input" aria-label={`${label}: pinned files`} rows={2} value={c.pins.join("\n")} disabled={busy} placeholder="notes/harbor.md" onChange={(e) => set({ pins: pinsOf((e.target as HTMLTextAreaElement).value) })} />
      </SettingRow>
    </div>
  );
}

/** One turn role's page: everything it runs with, by section. */
export function RolePage(props: { id: RoleId; agents: AgentSettings; routes: RouteSettings; prompts: PromptSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { id, agents, busy } = props;
  const r = agents.roles[id];
  const d = DEFAULTS.roles[id];
  const label = ROLE_LABEL[id];
  const set = (fields: JsonObject) => props.patch(rolePatch(id, fields));
  const routes = roleRoutes(props.routes, id, r);
  const curator = id === "curator";
  const budgetChanged = ownChanged(r.budget, d.budget) + (curator && agents.curatorOps !== DEFAULTS.curatorOps ? 1 : 0);
  const sections: PageSection[] = [
    {
      id: "runs",
      title: "Runs on",
      changed: (r.connectionId !== d.connectionId || r.model !== d.model ? 1 : 0) + (r.effort !== d.effort ? 1 : 0),
      body: (
        <div class="lre-set-rows">
          <RoutesList routes={routes} connections={props.connections} />
          <ConnectionSetting id="connection" owner={label} value={r} changed={r.connectionId !== d.connectionId || r.model !== d.model} noneLabel="None: each task on its step's" noneHelp="None runs each task on the connection its step uses (Settings → Steps and connections), else the helper model's, as listed above." to="each task on its step's" connections={props.connections} busy={busy} set={set} />
          <EffortSetting owner={label} value={r.effort} standard={d.effort} busy={busy} set={(effort) => set({ effort })} />
        </div>
      ),
    },
    {
      id: "may",
      title: "What it may do",
      changed: (r.families.length !== d.families.length || r.families.some((f) => !d.families.includes(f)) ? 1 : 0) + (r.tier !== d.tier ? 1 : 0),
      body: (
        <div class="lre-set-rows">
          <FamiliesSetting owner={label} value={r.families} standard={d.families} help="The families of tools it is given. They read everything, secrets marked, whatever perspective it works from." busy={busy} set={(families) => set({ families })} />
          <SettingRow id="tier" label="What it may change" changed={r.tier !== d.tier} help={TIER_HELP[r.tier]} reset={{ label: `Reset what ${label} may change to its default, ${TIER_LABEL[d.tier]}`, to: TIER_LABEL[d.tier], onClick: () => set({ tier: null }) }} busy={busy}>
            <Seg<RoleTier> label={`${label}: what it may change`} value={r.tier} options={ROLE_TIERS.map((value) => ({ value, label: TIER_LABEL[value] }))} disabled={busy} onChange={(tier) => set({ tier })} />
          </SettingRow>
        </div>
      ),
    },
    { id: "reads", title: "What it reads", changed: contextChanged(agents, id), body: <ReadsSection id={id} agents={agents} busy={busy} patch={props.patch} /> },
    {
      id: "when",
      title: "When it runs and fails",
      changed: (r.promptOnly !== d.promptOnly ? 1 : 0) + (r.onFail !== d.onFail ? 1 : 0),
      body: (
        <div class="lre-set-rows">
          {curator ? (
            <NavRow id="pipeline" icon="branch" title={agents.pipeline.curator ? "Runs after each reply, beside the read" : "Off: the read does its work"} subtitle="Switched in Settings → Agents → Pipeline" changed={0} onOpen={() => props.go({ page: "agents", sub: "pipeline" })} />
          ) : null}
          <SettingRow id="promptOnly" label="One call, no tools" bare changed={r.promptOnly !== d.promptOnly} help="On, it makes its step's own call, with that step's prompt and answer format: one call, and no tools." reset={{ label: `Reset ${label}'s one call to its default, ${d.promptOnly ? "on" : "off"}`, to: d.promptOnly ? "on" : "off", onClick: () => set({ promptOnly: null }) }} busy={busy}>
            <HostSwitch label={`${label}: one call, no tools`} checked={r.promptOnly} disabled={busy} onChange={(promptOnly) => set({ promptOnly })} />
          </SettingRow>
          <SettingRow id="onFail" label="When it fails" changed={r.onFail !== d.onFail} help={`${ON_FAIL_HELP[r.onFail]} When a main agent decides the turn, it chooses instead.`} reset={{ label: `Reset what ${label} does when it fails to its default, ${ON_FAIL_LABEL[d.onFail]}`, to: ON_FAIL_LABEL[d.onFail], onClick: () => set({ onFail: null }) }} busy={busy}>
            <Seg<RoleOnFail> label={`${label}: when it fails`} value={r.onFail} options={ROLE_ON_FAIL.map((value) => ({ value, label: ON_FAIL_LABEL[value] }))} disabled={busy} onChange={(onFail) => set({ onFail })} />
          </SettingRow>
        </div>
      ),
    },
    {
      id: "budget",
      title: "Budget",
      changed: budgetChanged,
      body: (
        <div class="lre-set-rows">
          {curator ? <LimitRow id="curatorOps" def={CURATOR_OPS_DEF} value={agents.curatorOps} standard={DEFAULTS.curatorOps} busy={busy} set={(curatorOps) => props.patch({ agents: { curatorOps } })} /> : null}
          <OwnBudget
            owner={`${label}'s`}
            keys={BUDGET_KEYS}
            defs={BUDGET_DEFS}
            own={r.budget}
            shipped={d.budget}
            every={agents.budget}
            busy={busy}
            set={(key, value) => set({ budget: { [key]: value } })}
            follows={
              <>
                Every other limit is every agent's:{" "}
                <button type="button" class="lre-set-link" onClick={() => props.go({ page: "agents", sub: "budgets" })}>
                  Settings → Agents → Budgets
                </button>
                .
              </>
            }
          />
        </div>
      ),
    },
    { id: "caching", title: "Caching", changed: hasOwn(agents.caching.roles, id) ? 1 : 0, body: <CachingSetting id={id} owner={label} agents={agents} busy={busy} patch={props.patch} /> },
    { id: "prompts", title: "Prompts", changed: 0, body: <PromptsLink page={rolePageId(id)} owner={label} prompts={props.prompts} go={props.go} /> },
  ];
  // Its job is its page's subtitle (Settings' header), so the page needs no lead of its own.
  return <AgentPage id={`role-${id}`} lead={null} sections={sections} changed={roleChanged(agents, id)} resetLabel={`Reset ${label} to its shipped defaults`} busy={busy} reset={() => props.patch(roleResetPatch(id))} />;
}
