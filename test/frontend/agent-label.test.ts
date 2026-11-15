// The review card names the agent that staged a change (PlanSwap-15 item 2): its own table of labels
// says what today's roles are called. While the agents engine's files are in the tree they say the
// same; PlanSwap-10 removes this check with them.

import { expect, test } from "bun:test";
import { agentLabel } from "../../src/frontend/review-card";
import { ROLE_IDS, ROLE_LABEL } from "../../src/shared/agent-roles";
import { AGENT_ROLES } from "../../src/shared/agent-settings";

test("a role is named as Settings → Agents names it, and a name nobody knows is shown as it is", () => {
  for (const id of ROLE_IDS) expect(agentLabel(id)).toBe(ROLE_LABEL[id]);
  for (const role of AGENT_ROLES) expect(agentLabel(role.id)).toBe(role.label);
  expect(agentLabel("somebody-new")).toBe("somebody-new");
  expect(agentLabel("constructor")).toBe("constructor");
});
