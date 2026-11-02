// Settings → Agents → Context (DESIGN §4.6, "A role's context"): what each role of an agent turn
// starts with, and the guide the main agent briefs it by, every setting kept under
// `agents.context.roles[<role>]` (shared/agent-context.ts). Per role: the perspective it works from
// (a hint in its prompt), how it gets each source (Starts with: in its prompt from the start, in the
// fixed pipeline and under the main agent alike; When needed: the main agent may give it; Never: the
// main agent is told not to), and the workspace files pinned for it. Nothing here screens a role: its
// tools read everything, secrets marked, as its tool families on the Roles page give them. A change
// sends that field alone; Default sends null for the role, so the store reads the defaults back.
// What renders and what is pressed (`ContextBody`, `ContextCard`, `contextPatch`) is hook-free, so
// tests press it without a DOM. Styles: styles/settings.ts.

import { CONTEXT_SOURCES, defaultContextSettings, PERSPECTIVE_LABEL, ROLE_PERSPECTIVES, type RoleContext, type RolePerspective, SOURCE_USE_LABEL, SOURCE_USES, type SourceUse, sourceLabel, sourceUse, withSourceUse } from "../../shared/agent-context";
import { ROLE_IDS, ROLE_LABEL, type RoleId } from "../../shared/agent-roles";
import type { AgentSettings } from "../../shared/agent-settings";
import { TOOL_FAMILY_LABEL } from "../../shared/agent-tools";
import type { JsonObject } from "../../shared/json";
import { jsonEqual } from "../../shared/json-patch";
import { Section, Seg } from "../components";
import { defaultButton } from "./agents";

/** What each Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultContextSettings();

const PERSPECTIVE_HELP: Record<RolePerspective, string> = {
  pov: "It works from what your character knows. A hint in its prompt only: its tools still read everything, secrets marked.",
  everyone: "It works from what everyone in the world knows, each secret marked with whom it is known to and kept from.",
  gm: "It works as the game master, who knows it all; a secret still reaches you only when the story reveals it.",
  own: "It works from what the character its task is about knows, as a mind does. A hint in its prompt only.",
};

const USE_HELP: Record<SourceUse, string> = {
  start: "In its prompt from the start, as the narrator would get it then, in both pipelines.",
  ask: "Not in its prompt; the main agent may give it when the task needs it, and its tools can read it.",
  never: "Not in its prompt, and the main agent is told never to give it.",
};

/** The settings patch for some of a role's context fields; a role sent as null is deleted, so the store reads its defaults. */
export function contextPatch(role: RoleId, fields: JsonObject | null): JsonObject {
  return { agents: { context: { roles: { [role]: fields } } } };
}

/** The pinned paths as typed, one a line: trimmed, blank lines left out, each once. */
export function pinsOf(text: string): string[] {
  return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line !== ""))];
}

/** Settings home's line for this page: how many roles start with something, and how many differ from the defaults. */
export function contextSummary(agents: AgentSettings): string {
  const starting = ROLE_IDS.filter((id) => agents.context.roles[id].start.length > 0).length;
  const own = ROLE_IDS.filter((id) => !jsonEqual(agents.context.roles[id], DEFAULTS.roles[id])).length;
  return `${starting} of ${ROLE_IDS.length} roles start with sections${own > 0 ? ` · ${own} changed` : ""}`;
}

/** One role: its perspective, how it gets each source, and its pinned files, each beside its default, and Default for the whole role. */
export function ContextCard(props: { id: RoleId; agents: AgentSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { id, agents, busy } = props;
  const c: RoleContext = agents.context.roles[id];
  const d = DEFAULTS.roles[id];
  const label = ROLE_LABEL[id];
  const set = (fields: JsonObject) => props.patch(contextPatch(id, fields));
  const families = agents.roles[id].families;
  return (
    <div class="lre-set-rows lre-set-group" data-lre-context-role={id}>
      <div class="lre-set-ext-head">
        <span class="lre-set-ext-title">{label}</span>
        {jsonEqual(c, d) ? null : defaultButton(`Reset the ${label} role's context to its defaults`, busy, () => props.patch(contextPatch(id, null)))}
      </div>
      <div class="lre-set-ext" data-lre-context-setting="perspective">
        <div class="lre-field">
          <Seg<RolePerspective> label={`${label}: the perspective it works from`} value={c.perspective} options={ROLE_PERSPECTIVES.map((value) => ({ value, label: PERSPECTIVE_LABEL[value] }))} disabled={busy} onChange={(perspective) => set({ perspective })} />
          <span class="lre-field-help">{PERSPECTIVE_HELP[c.perspective]}</span>
        </div>
        <span class="lre-small lre-muted">Default {PERSPECTIVE_LABEL[d.perspective]}.</span>
      </div>
      <div class="lre-set-ext" data-lre-context-setting="sources">
        <span class="lre-set-ext-title">What it gets</span>
        <span class="lre-field-help">Each source as the narrator would get it: the lore index, or one of the engine's sections, secrets marked.</span>
        {CONTEXT_SOURCES.map((source) => {
          const use = sourceUse(c, source);
          return (
            <div key={source} class="lre-field" data-lre-context-source={source}>
              <Seg<SourceUse> label={`${label}: ${sourceLabel(source)}`} value={use} options={SOURCE_USES.map((value) => ({ value, label: SOURCE_USE_LABEL[value] }))} disabled={busy} onChange={(next) => set(withSourceUse(c, source, next))} />
              <span class="lre-field-help">{`${sourceLabel(source)}: ${USE_HELP[use]}`}</span>
            </div>
          );
        })}
        <span class="lre-small lre-muted">Default: starts with {d.start.length > 0 ? d.start.map(sourceLabel).join(", ") : "nothing but its task"}.</span>
      </div>
      <div class="lre-set-ext" data-lre-context-setting="pins">
        <label class="lre-field">
          <span class="label">{`${label}: pinned files`}</span>
          <textarea class="lre-input" rows={2} value={c.pins.join("\n")} disabled={busy} placeholder="notes/marcus.md" onChange={(e) => set({ pins: pinsOf((e.target as HTMLTextAreaElement).value) })} />
          <span class="lre-field-help">Workspace paths, one a line, read whole within the pins budget before .pins.json's and those pinned in GM → Workspace. A path the chat has no file at is passed over.</span>
        </label>
      </div>
      <span class="lre-small lre-muted" data-lre-context-setting="tools">{`Its tools (Roles page): ${families.length > 0 ? families.map((f) => TOOL_FAMILY_LABEL[f]).join(", ") : "none"}. They read everything, secrets marked, whatever its perspective.`}</span>
    </div>
  );
}

/** Every role, in §5's order, without hooks. */
export function ContextBody(props: { agents: AgentSettings; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <Section title="Context" flush>
      {ROLE_IDS.map((id) => (
        <ContextCard key={id} id={id} agents={props.agents} busy={props.busy} patch={props.patch} />
      ))}
    </Section>
  );
}

/** Settings → Agents → Context: what each role starts with, and the guide the main agent briefs it by. */
export function ContextPage(props: { agents: AgentSettings; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <div class="lre-stack" data-lre-settings-page="context">
      <p class="lre-set-lead">What each role of an agent turn starts with, and how the main agent is to brief it. This steers; it never hides: every role's tools read everything, each secret marked with whom it is known to and kept from, and secrets are guidance, in the texts on Prompts → Every role.</p>
      <ContextBody agents={props.agents} patch={props.patch} busy={props.busy} />
    </div>
  );
}
