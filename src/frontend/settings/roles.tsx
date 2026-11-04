// Settings → Agents → Roles (AGENT-LOOP-PLAN §5, §15; INC2-SPEC C9, C12): the roles of an agent turn,
// in the order a turn commits what they staged, one row each: where its tasks run, anything about how
// it runs that isn't its default, and how many of its settings are changed. A row opens the role's
// own page (role-page.tsx), where every setting is. The main agent and the GM assistant, which have
// pages of their own on the same template, follow. Hook-free, so tests press it without a DOM.

import { ROLE_IDS, ROLE_LABEL, type RoleId } from "../../shared/agent-roles";
import { defaultAgentSettings, type AgentSettings } from "../../shared/agent-settings";
import { roleRoutes, type RouteSettings, type TaskRoute } from "../../shared/role-routes";
import type { TimeoutSettings } from "../../shared/timeouts";
import type { SettingsRoute } from "../app";
import { List, Section } from "../components";
import { assistantSummary } from "./assistant";
import { assistantChanged, mainChanged, roleChanged, rolesChanged } from "./changed";
import { NavRow } from "./kit";
import { ON_FAIL_LABEL } from "./labels";
import { mainSummary } from "./main-agent";
import { routeText } from "./role-page";
import type { Connection } from "./steps";

const DEFAULTS = defaultAgentSettings();

/** Settings home's line for this page: how many roles have a setting of their own. */
export function rolesSummary(agents: AgentSettings): string {
  const own = rolesChanged(agents);
  return own === 0 ? `${ROLE_IDS.length} roles, each on its defaults` : `${ROLE_IDS.length} roles · ${own} changed`;
}

/** Where a role's tasks run, in a line: the one route they share, or how many they take. */
export function routesLine(routes: readonly TaskRoute[], connections: readonly Connection[]): string {
  const places = [...new Set(routes.map((r) => routeText(r, connections)))];
  return places.length === 1 ? (places[0] ?? "") : `${places.length} connections, by task`;
}

/** A role's row: where it runs, then how it runs where that isn't its default (one call, what it does on a failure), or Off for a Curator switched off. */
export function roleLine(agents: AgentSettings, routes: RouteSettings, id: RoleId, connections: readonly Connection[]): string {
  const r = agents.roles[id];
  if (id === "curator" && !agents.pipeline.curator) return "Off: the read does its work";
  const how = [r.promptOnly ? "one call, no tools" : null, r.onFail === DEFAULTS.roles[id].onFail ? null : `on a failure: ${ON_FAIL_LABEL[r.onFail].toLowerCase()}`];
  return [routesLine(roleRoutes(routes, id, r), connections), ...how.filter((x) => x !== null)].join(" · ");
}

/** Settings → Agents → Roles, without hooks: a row per role, then the main agent and the assistant. */
export function RolesPage(props: { agents: AgentSettings; timeouts: TimeoutSettings; routes: RouteSettings; connections: readonly Connection[]; go(route: SettingsRoute): void }) {
  const { agents, connections } = props;
  return (
    <div class="lre-stack" data-lre-settings-page="roles">
      <p class="lre-set-lead">Each role does one part of an agent turn. Open one for where it runs, what it may do and read, and its budget.</p>
      <Section flush>
        <List>
          {ROLE_IDS.map((id) => (
            <NavRow key={id} id={id} title={ROLE_LABEL[id]} subtitle={roleLine(agents, props.routes, id, connections)} changed={roleChanged(agents, id)} onOpen={() => props.go({ page: "roles", sub: id })} />
          ))}
        </List>
      </Section>
      <Section title="With pages of their own" flush>
        <List>
          <NavRow id="main" icon="sparkle" title="Main agent" subtitle={mainSummary(agents, connections)} changed={mainChanged(agents, props.timeouts)} onOpen={() => props.go({ page: "main" })} />
          <NavRow id="assistant" icon="message" title="Assistant" subtitle={assistantSummary(agents.assistant, connections)} changed={assistantChanged(agents)} onOpen={() => props.go({ page: "assistant" })} />
        </List>
      </Section>
    </div>
  );
}
