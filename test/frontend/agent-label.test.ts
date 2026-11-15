// The review card names the agent that staged a change (PlanSwap-15 item 2): its own table of labels
// says what each role is called, as Settings → Agents named them. The test holds the table to the
// names as they were when it was moved, and loads nothing but the card.

import { expect, test } from "bun:test";
import { agentLabel } from "../../src/frontend/review-card";

/** Each role's name as the old Settings → Agents page showed it (the turn roles, the GM assistant, the main agent). */
const NAMED: Readonly<Record<string, string>> = {
  intent: "Intent",
  scene: "Scene and lore",
  minds: "Minds",
  knowledge: "Knowledge",
  director: "Director",
  read: "Read",
  curator: "Curator",
  memory: "Memory",
  skip: "Skip beats",
  world: "World steps",
  assistant: "GM assistant",
  main: "Main agent",
};

test("a role is named as Settings → Agents named it, and a name nobody knows is shown as it is", () => {
  for (const [id, label] of Object.entries(NAMED)) expect(agentLabel(id)).toBe(label);
  expect(agentLabel("somebody-new")).toBe("somebody-new");
  expect(agentLabel("constructor")).toBe("constructor");
});
