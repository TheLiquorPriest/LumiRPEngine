// What each role's tools weigh (Build C, lane C2): every role keeps every tool it had (none is cut),
// its tool block stays under a ceiling, and the weight its Settings page shows (`roleToolNames`,
// `toolsWeight`, from the tools' texts alone) is what the backend gives it, near what it sends.
// Port Alder only.

import { describe, expect, test } from "bun:test";
import { type ToolEnv, toolsFor, toolsGuide } from "../../src/backend/agents/tools/registry";
import { toolTokens } from "../../src/backend/agents/usage";
import { tokensOf } from "../../src/backend/book";
import { defaultRoleSettings, FABRIC_ROLE, ROLE_IDS, type RoleId, roleToolNames, roleToolScope } from "../../src/shared/agent-roles";
import { toolsWeight } from "../../src/shared/agent-tools";
import { promptDef } from "../../src/shared/prompts";
import { alderChat, toolEnv } from "../support/tools";

/** How many tools each role had before Build C, at its defaults, working a turn: it keeps at least these. */
const COUNTS: Readonly<Record<RoleId, number>> = { intent: 24, scene: 24, minds: 14, knowledge: 6, director: 16, read: 28, curator: 42, memory: 5, skip: 11, world: 26 };

/** The most characters each role's tool block may take at its defaults: under Build B's for the Curator (44.9k), with room for what later builds add. */
const CEILINGS: Readonly<Record<RoleId, number>> = { intent: 20_500, scene: 19_500, minds: 9_600, knowledge: 4_000, director: 11_000, read: 22_000, curator: 40_000, memory: 3_100, skip: 8_300, world: 21_000 };

/** The tools `role` is given working a turn, as `roles/agent.ts` gives them. */
async function given(role: RoleId) {
  const { rig, chatId } = await alderChat();
  const base = toolEnv(rig, chatId, "gm");
  const env: ToolEnv = { ...base, marks: true, loads: { add: () => true }, summarize: async () => ({ text: "" }), ...(role === FABRIC_ROLE ? { notes: { add: () => true } } : {}) };
  const { world } = await env.reader.view();
  const scope = roleToolScope(role, defaultRoleSettings()[role]);
  return (["read", "story", "gm"] as const).flatMap((tier) => (scope[tier].length > 0 ? toolsFor({ world, tiers: [tier], families: scope[tier], texts: {}, env }) : []));
}

const shipped = (id: string): string => promptDef(id)?.text ?? "";

describe("each role's tools", () => {
  test("it keeps every tool it had, its block stays under its ceiling, and its Settings page counts exactly what it is given", async () => {
    for (const role of ROLE_IDS) {
      const tools = await given(role);
      const names = tools.map((t) => t.name);
      expect({ role, kept: names.length >= COUNTS[role] }).toEqual({ role, kept: true });
      expect({ role, names: [...roleToolNames(role, defaultRoleSettings()[role])].sort() }).toEqual({ role, names: [...names].sort() });
      const chars = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))).length;
      expect({ role, under: chars <= CEILINGS[role] }).toEqual({ role, under: true });
    }
  });

  test("the weight its page shows is the tools' texts and what they share, near what the backend sends, short of the world's ids some arguments list", async () => {
    for (const role of ROLE_IDS) {
      const tools = await given(role);
      const sent = toolTokens(tools) + tokensOf(toolsGuide(tools, {}));
      const shown = toolsWeight(roleToolNames(role, defaultRoleSettings()[role]), shipped);
      expect({ role, near: shown >= sent * 0.7 && shown <= sent * 1.1 }).toEqual({ role, near: true });
    }
    // The user's own words weigh what they weigh.
    const names = roleToolNames("curator", defaultRoleSettings().curator);
    const longer = toolsWeight(names, (id) => (id === "tool.item_make" ? `${shipped(id)}${"x".repeat(320)}` : shipped(id)));
    expect(Math.abs(longer - toolsWeight(names, shipped) - 100)).toBeLessThanOrEqual(1);
  });
});
