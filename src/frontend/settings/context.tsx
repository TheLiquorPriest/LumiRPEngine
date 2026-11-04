// Settings → Agents → Context (DESIGN §4.6, "A role's context"): what each role of an agent turn
// starts with, and the guide the main agent briefs it by, as an overview: one row per role with the
// perspective it works from and what its prompt starts with, and how many of those settings are
// changed. A row opens the role's page at What it reads (role-page.tsx), where they are set. Nothing
// here screens a role: its tools read everything, secrets marked. Hook-free, so tests press it
// without a DOM.

import { PERSPECTIVE_LABEL, sourceLabel } from "../../shared/agent-context";
import { ROLE_IDS, ROLE_LABEL } from "../../shared/agent-roles";
import type { AgentSettings } from "../../shared/agent-settings";
import type { SettingsRoute } from "../app";
import { List, Section } from "../components";
import { contextChanged } from "./changed";
import { NavRow } from "./kit";

/** Settings home's line for this page: how many roles start with something, and how many differ from the defaults. */
export function contextSummary(agents: AgentSettings): string {
  const starting = ROLE_IDS.filter((id) => agents.context.roles[id].start.length > 0).length;
  const own = ROLE_IDS.filter((id) => contextChanged(agents, id) > 0).length;
  return `${starting} of ${ROLE_IDS.length} roles start with sections${own > 0 ? ` · ${own} changed` : ""}`;
}

/** Settings → Agents → Context, without hooks: a row per role, opening its page at What it reads. */
export function ContextPage(props: { agents: AgentSettings; go(route: SettingsRoute): void }) {
  const { agents } = props;
  return (
    <div class="lre-stack" data-lre-settings-page="context">
      <p class="lre-set-lead">What each role starts with, and how the main agent is to brief it. This steers; it never hides: every role's tools read everything, each secret marked with whom it is known to and kept from.</p>
      <Section flush>
        <List>
          {ROLE_IDS.map((id) => {
            const c = agents.context.roles[id];
            const starts = c.start.length > 0 ? `starts with ${c.start.map(sourceLabel).join(", ")}` : "its task alone";
            const never = c.never.length > 0 ? ` · never ${c.never.map(sourceLabel).join(", ")}` : "";
            const pins = c.pins.length > 0 ? ` · ${c.pins.length} pinned ${c.pins.length === 1 ? "file" : "files"}` : "";
            return <NavRow key={id} id={id} title={ROLE_LABEL[id]} subtitle={`${PERSPECTIVE_LABEL[c.perspective]} · ${starts}${never}${pins}`} changed={contextChanged(agents, id)} onOpen={() => props.go({ page: "context", sub: id, at: "reads" })} />;
          })}
        </List>
      </Section>
    </div>
  );
}
