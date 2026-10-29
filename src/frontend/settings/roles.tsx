// Settings → Agents → Roles (AGENT-LOOP-PLAN §5, §8, §15; INC2-SPEC C9, C12): what each role of an
// agent turn runs with, every setting kept under `agents.roles[<role>]` (shared/agent-roles.ts): the
// connection and model it runs on (none: its classic step's), its effort, whose knowledge it reads,
// its tool families and what it may write (its tier), whether it runs prompt-only (its classic
// step's one call), what the fixed pipeline does when it fails, and its own limits over every
// agent's budget; and its caching, which the providers read from `agents.caching.roles[<role>]`, as
// Settings → Agents → Caching keeps it for the assistant and the main agent. Each role shows its
// shipped defaults; its Default sends null for the role and for its own caching, so the store reads
// §15's defaults back (`defaultRoleSettings`). What renders and what is pressed (`RolesBody`,
// `RoleCard`, `rolePatch`, `roleResetPatch`) is hook-free, so tests press it without a DOM.
// Styles: styles/settings.ts.

import type { RoleId, RoleKnowledge, RoleOnFail, RoleSettings, RoleTier } from "../../shared/agent-roles";
import { ROLE_IDS, ROLE_KNOWLEDGE, ROLE_LABEL, ROLE_ON_FAIL, ROLE_TIERS } from "../../shared/agent-roles";
import type { AgentBudget, AgentEffort, AgentSettings } from "../../shared/agent-settings";
import { AGENT_EFFORTS, ASSISTANT_KNOWLEDGE_LABELS, BUDGET_DEFS, defaultAgentSettings, roleCaching } from "../../shared/agent-settings";
import type { ToolFamily } from "../../shared/agent-tools";
import { TOOL_FAMILY_LABEL } from "../../shared/agent-tools";
import { hasOwn, type JsonObject } from "../../shared/json";
import { jsonEqual } from "../../shared/json-patch";
import { Badge, Button, HostModelPicker, HostSwitch, Section, Seg } from "../components";
import { defaultButton, freshNonce, OwnLimitRow } from "./agents";
import { EFFORT_LABEL } from "./assistant";
import { type Connection, ConnectionSelect, useConnections } from "./steps";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings();

/** Every tool family, in the order the page lists them. */
export const FAMILIES = Object.keys(TOOL_FAMILY_LABEL) as ToolFamily[];

/** Each effort, for any agent of a turn: what it is sent as. */
export const EFFORT_HELP: Record<AgentEffort, string> = {
  off: "It works without reasoning.",
  low: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  medium: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  high: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  model: "For a model that picks its own effort by its name: sent as Lumiverse's Auto.",
  inherit: "The connection's own reasoning setting, else yours in Lumiverse.",
};

const KNOWLEDGE_LABEL: Record<RoleKnowledge, string> = { ...ASSISTANT_KNOWLEDGE_LABELS, own: "Its character's own" };

const KNOWLEDGE_HELP: Record<RoleKnowledge, string> = {
  pov: "It reads only what your character knows.",
  everyone: "It reads what anyone in the world knows, each secret marked with whom it's kept from.",
  gm: "It reads everything, secrets and all.",
  own: "A mind reads as the character it thinks for: only what that character knows.",
};

const TIER_LABEL: Record<RoleTier, string> = { read: "Nothing", story: "The story's changes", gm: "The GM's edits too" };

const TIER_HELP: Record<RoleTier, string> = {
  read: "It only reads: it stages no change.",
  story: "It may stage the story's own changes and write the workspace; each lands as its change type's mode says (Settings → Changes from the reply).",
  gm: "It may stage the GM's own edits too: a spawn, a removal, any field, a stage, the clock; as many per turn as Settings → Agents → Budgets lets.",
};

const ON_FAIL_LABEL: Record<RoleOnFail, string> = { prompt_only: "Run its classic call", skip: "Go on without it", stop: "Stop the turn" };

const ON_FAIL_HELP: Record<RoleOnFail, string> = {
  prompt_only: "Its classic step's one call runs instead; if that fails too, the turn goes on without it.",
  skip: "The turn goes on without what it would have given.",
  stop: "The turn stops, with the engine-failed card and its Retry.",
};

/** The settings patch (`lre.settings.set`) for some of a role's settings; a field sent as null is deleted, so the store reads its default. */
export function rolePatch(id: RoleId, fields: JsonObject): JsonObject {
  return { agents: { roles: { [id]: fields } } };
}

/** A role's Default: its settings and its own caching go, so the store reads §15's defaults back. */
export function roleResetPatch(id: RoleId): JsonObject {
  return { agents: { roles: { [id]: null }, caching: { roles: { [id]: null } } } };
}

/** Whether a role runs on its shipped defaults: its settings as `defaultRoleSettings` has them (its tool families in any order), and no caching of its own. */
export function roleAtDefaults(agents: AgentSettings, id: RoleId): boolean {
  const sorted = (r: RoleSettings) => ({ ...r, families: [...r.families].sort() });
  return jsonEqual(sorted(agents.roles[id]), sorted(DEFAULTS.roles[id])) && !hasOwn(agents.caching.roles, id);
}

/** Settings home's line for this page: how many roles have settings of their own. */
export function rolesSummary(agents: AgentSettings): string {
  const own = ROLE_IDS.filter((id) => !roleAtDefaults(agents, id)).length;
  return own === 0 ? `${ROLE_IDS.length} roles, each on its shipped defaults` : `${ROLE_IDS.length} roles · ${own} with settings of ${own === 1 ? "its" : "their"} own`;
}

/** What a role runs on, in words: its classic step's connection, or the one chosen and its model. */
function placeWords(r: RoleSettings, connections: readonly Connection[]): string {
  if (!r.connectionId) return "Its classic step's connection";
  const c = connections.find((x) => x.id === r.connectionId);
  const model = r.model ?? c?.model ?? null;
  return `${c?.name ?? r.connectionId}${model ? ` · ${model}` : ""}`;
}

/** One role: everything it runs with, each beside its shipped default, and Default for the whole role. */
export function RoleCard(props: { id: RoleId; agents: AgentSettings; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void }) {
  const { id, agents, busy } = props;
  const r = agents.roles[id];
  const d = DEFAULTS.roles[id];
  const label = ROLE_LABEL[id];
  const set = (fields: JsonObject) => props.patch(rolePatch(id, fields));
  const caching = roleCaching(agents, id);
  const setCaching = (own: { on: boolean; nonce: string }) => props.patch({ agents: { caching: { roles: { [id]: own } } } });
  const atDefaults = roleAtDefaults(agents, id);
  const budgetKeys = Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[];
  return (
    <div class="lre-set-rows lre-set-group" data-lre-role={id}>
      <div class="lre-set-ext-head">
        <span class="lre-set-ext-title">{label}</span>
        <Badge tone={atDefaults ? "neutral" : "accent"}>{atDefaults ? "Shipped defaults" : "Its own settings"}</Badge>
        {atDefaults ? null : defaultButton(`Reset ${label} to its shipped defaults`, busy, () => props.patch(roleResetPatch(id)))}
      </div>
      <div class="lre-set-ext" data-lre-role-setting="connection">
        <span class="lre-set-ext-title">Connection and model</span>
        <ConnectionSelect value={r.connectionId} connections={props.connections} firstLabel="None: its classic step's connection" help="None runs it on the connection its classic step uses (Settings → Steps and connections), else the helper's." disabled={busy} onChange={(connectionId) => set({ connectionId, model: null })} />
        {r.connectionId ? (
          <>
            <HostModelPicker connectionId={r.connectionId} value={r.model ?? ""} label={`${label}: model`} onChange={(model) => set({ model: model || null })} />
            <span class="lre-field-help">Pick from the connection's models, or type one. Empty uses the connection's own model.</span>
          </>
        ) : null}
        <span class="lre-small lre-muted">Now: {placeWords(r, props.connections)}. Default: its classic step's connection.</span>
      </div>
      <div class="lre-set-ext" data-lre-role-setting="effort">
        <label class="lre-field">
          <span class="label">Reasoning effort</span>
          <select
            class="lre-input"
            aria-label={`${label}: reasoning effort`}
            value={r.effort}
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
          <span class="lre-field-help">{EFFORT_HELP[r.effort]}</span>
        </label>
        <span class="lre-small lre-muted">Default {EFFORT_LABEL[d.effort]}.</span>
      </div>
      <div class="lre-set-ext" data-lre-role-setting="knowledge">
        <div class="lre-field">
          <Seg<RoleKnowledge> label={`${label}: whose knowledge it reads`} value={r.knowledge} options={ROLE_KNOWLEDGE.map((value) => ({ value, label: KNOWLEDGE_LABEL[value] }))} disabled={busy} onChange={(knowledge) => set({ knowledge })} />
          <span class="lre-field-help">{KNOWLEDGE_HELP[r.knowledge]}</span>
        </div>
        <span class="lre-small lre-muted">Default {KNOWLEDGE_LABEL[d.knowledge]}.</span>
      </div>
      <div class="lre-set-ext" data-lre-role-setting="families">
        <span class="lre-set-ext-title">Tools</span>
        <span class="lre-field-help">The families of tools it is given, at the tier below; its knowledge bounds what they read.</span>
        {FAMILIES.map((family) => (
          <HostSwitch key={family} label={`${label}: ${TOOL_FAMILY_LABEL[family]}`} checked={r.families.includes(family)} disabled={busy} onChange={(on) => set({ families: FAMILIES.filter((f) => (f === family ? on : r.families.includes(f))) })} />
        ))}
        <span class="lre-small lre-muted">Default: {d.families.map((f) => TOOL_FAMILY_LABEL[f]).join(", ")}.</span>
      </div>
      <div class="lre-set-ext" data-lre-role-setting="tier">
        <div class="lre-field">
          <Seg<RoleTier> label={`${label}: what it may change`} value={r.tier} options={ROLE_TIERS.map((value) => ({ value, label: TIER_LABEL[value] }))} disabled={busy} onChange={(tier) => set({ tier })} />
          <span class="lre-field-help">{TIER_HELP[r.tier]}</span>
        </div>
        <span class="lre-small lre-muted">Default {TIER_LABEL[d.tier]}.</span>
      </div>
      <div class="lre-set-ext" data-lre-role-setting="promptOnly">
        <HostSwitch label={`${label}: prompt-only`} checked={r.promptOnly} disabled={busy} onChange={(promptOnly) => set({ promptOnly })} />
        <span class="lre-field-help">One call with its classic step's own prompt and answer format, and no tools: it behaves exactly as classic.</span>
        <span class="lre-small lre-muted">Default {d.promptOnly ? "on" : "off"}.</span>
      </div>
      <div class="lre-set-ext" data-lre-role-setting="onFail">
        <div class="lre-field">
          <Seg<RoleOnFail> label={`${label}: when it fails`} value={r.onFail} options={ROLE_ON_FAIL.map((value) => ({ value, label: ON_FAIL_LABEL[value] }))} disabled={busy} onChange={(onFail) => set({ onFail })} />
          <span class="lre-field-help">{ON_FAIL_HELP[r.onFail]} In a pipeline the main agent decides, it chooses instead.</span>
        </div>
        <span class="lre-small lre-muted">Default {ON_FAIL_LABEL[d.onFail]}.</span>
      </div>
      <div class="lre-set-ext lre-set-timeout" data-lre-role-setting="caching">
        <HostSwitch label={`Caching for ${label}`} checked={caching.on} disabled={busy} onChange={(on) => setCaching({ on, nonce: caching.nonce })} />
        <div class="lre-row-actions">
          <Button size="sm" variant="secondary" icon="refresh" label={`Bust ${label}'s cache`} disabled={busy} onClick={() => setCaching({ on: caching.on, nonce: freshNonce() })}>
            Bust
          </Button>
        </div>
        <span class="lre-small lre-muted">{hasOwn(agents.caching.roles, id) ? "Its own caching." : "Every role's caching (Settings → Agents → Caching)."} Default: every role's.</span>
      </div>
      <p class="lre-set-timeout-lead">
        <strong>Its budget.</strong> Each limit is every agent's (Settings → Agents → Budgets) until you change it here; Every agent's goes back to that one.
      </p>
      {budgetKeys.map((key) => (
        <OwnLimitRow key={key} id={key} owner={`${label}'s`} def={BUDGET_DEFS[key]} own={r.budget[key]} every={agents.budget[key]} busy={busy} set={(value) => set({ budget: { [key]: value } })} />
      ))}
    </div>
  );
}

/** Every role, in §5's order, without hooks. */
export function RolesBody(props: { agents: AgentSettings; connections: readonly Connection[]; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <Section title="Roles" flush>
      {ROLE_IDS.map((id) => (
        <RoleCard key={id} id={id} agents={props.agents} connections={props.connections} busy={props.busy} patch={props.patch} />
      ))}
    </Section>
  );
}

/** Settings → Agents → Roles: what each role of an agent turn runs with. */
export function RolesPage(props: { agents: AgentSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const connections = useConnections();
  return (
    <div class="lre-stack" data-lre-settings-page="roles">
      <p class="lre-set-lead">What each role of an agent turn runs with: its model, whose knowledge it reads, its tools, what it may change and its budget. A chat plays agent turns once GM → This chat switches its engine to agents; no classic turn reads any of these.</p>
      <RolesBody agents={props.agents} connections={connections} patch={props.patch} busy={props.busy} />
    </div>
  );
}
