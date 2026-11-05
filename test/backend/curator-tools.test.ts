// The Curator's tools (Build C, owner's decision 1): no tool is cut from it, or from any agent, and its
// prompt costs less instead. What its change tools share (what a change does, how a thing is named) is
// told once, in its system prompt, not in each description; a place or action argument lists the
// world's ids only up to ENUM_CAP; and the tool block is the same on every call, so the provider's
// cache keeps it, with a breakpoint of its own where the provider takes them. Port Alder only.

import { describe, expect, test } from "bun:test";
import { type ToolEnv, TOOL_DEFINITIONS, toolsFor, toolsGuide } from "../../src/backend/agents/tools/registry";
import { ENUM_CAP, placeEnum } from "../../src/backend/agents/tools/schema";
import { toolDTO } from "../../src/backend/spindle-host";
import { renderPrompt } from "../../src/backend/prompts";
import { curatorKinds, defaultRoleSettings, roleToolNames, roleToolScope } from "../../src/shared/agent-roles";
import { TOOL_GUIDE_TEXTS, TOOL_TEXTS, toolGuideId, toolText } from "../../src/shared/agent-tools";
import type { JsonObject } from "../../src/shared/json";
import { promptDef } from "../../src/shared/prompts";
import { CURATOR_FACTS } from "../../src/shared/things";
import type { WorldDoc } from "../../src/shared/world";
import { alderChat, callTool, HOME, toolEnv } from "../support/tools";

/** Every tool there was before Build C, by name: none is cut (owner's decision 1), from any agent. */
const EVERY_TOOL = [
  ...["people_find", "people_sheet", "people_where", "people_regard", "places_read", "places_contents", "places_route", "places_find"],
  ...["items_inventory", "items_holder", "items_condition", "items_find", "items_at", "items_of", "items_read", "items_access", "money_balances", "money_prices"],
  ...["orgs_list", "orgs_read", "orgs_who_may", "quests_tracks", "quests_stage", "quests_moves", "knowledge_who_knows", "knowledge_what_knows", "time_clock", "time_day", "checks_odds", "minds_read"],
  ...["gm_set_field", "gm_add_to_field", "gm_set_entity", "gm_classify", "gm_set_life", "gm_spawn", "gm_despawn", "gm_restore", "gm_link", "gm_unlink", "person_add", "gm_move", "place_make", "place_label"],
  ...["item_make", "item_move", "item_hand", "item_own", "item_grant", "item_revoke", "item_permit", "item_unpermit", "item_home", "item_use", "item_wear", "item_condition", "item_lose", "item_label", "item_merge", "item_remove"],
  ...["gm_adjust_money", "gm_effect", "purchase", "gm_revenue", "revenue_note", "gm_org", "gm_project", "project_note", "gm_set_stage", "gm_feed", "gm_mind_edit", "gm_routine_edit", "gm_fix"],
  ...["workspace_list", "workspace_read", "workspace_grep", "workspace_write", "workspace_edit", "workspace_move", "workspace_delete", "workspace_pin", "condense"],
  ...["lore_index", "lore_search", "lore_grep", "lore_read", "lore_load", "lore_save", "lore_draft"],
];

/** The Curator's tools as it gets them working a turn: its families' reads and story changes, the notes for the read among them. */
const CURATOR_TOOLS = [
  ...["people_find", "people_sheet", "people_where", "people_regard", "places_read", "places_contents", "places_route", "places_find"],
  ...["items_inventory", "items_holder", "items_condition", "items_find", "items_at", "items_of", "items_read", "items_access", "money_balances", "money_prices", "orgs_list", "orgs_read", "orgs_who_may"],
  ...["person_add", "place_make", "place_label", "item_make", "item_move", "item_hand", "item_own", "item_grant", "item_revoke", "item_permit", "item_unpermit", "item_home", "item_use", "item_wear", "item_condition", "item_lose", "item_label", "item_merge"],
  ...["purchase", "revenue_note", "project_note"],
];

/** The env a Curator's tools run with: the GM's view, every secret marked, noting for the read, loading lore and condensing. */
function curatorEnv(base: ToolEnv): ToolEnv {
  return { ...base, marks: true, notes: { add: () => true }, loads: { add: () => true }, summarize: async () => ({ text: "" }) };
}

/** The tools a role is given, as `roles/agent.ts` gives them: each tier of its scope, in order. */
function roleTools(role: Parameters<typeof roleToolScope>[0], world: WorldDoc, env: ToolEnv, texts: Record<string, string> = {}) {
  const scope = roleToolScope(role, defaultRoleSettings()[role]);
  return (["read", "story", "gm"] as const).flatMap((tier) => (scope[tier].length > 0 ? toolsFor({ world, tiers: [tier], families: scope[tier], texts, env }) : []));
}

/** The tool block as the provider is sent it. */
const block = (tools: readonly { name: string; description: string; parameters: JsonObject }[]): string => JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })));

describe("no tool is cut", () => {
  test("every read tool is still there, and the Curator keeps its default families and every tool of them, walk-ons, money and organizations included", async () => {
    const names = TOOL_DEFINITIONS.map((d) => d.name);
    for (const name of [...EVERY_TOOL, ...CURATOR_TOOLS]) expect({ name, present: names.includes(name) }).toEqual({ name, present: true });
    expect(defaultRoleSettings().curator.families).toEqual(["items", "places", "people", "money", "orgs"]);
    const { rig, chatId } = await alderChat();
    const env = curatorEnv(toolEnv(rig, chatId, "gm"));
    const { world } = await env.reader.view();
    const given = roleTools("curator", world, env).map((t) => t.name);
    for (const name of CURATOR_TOOLS) expect({ name, given: given.includes(name) }).toEqual({ name, given: true });
    // What the Settings page counts is what the backend gives.
    expect([...roleToolNames("curator", defaultRoleSettings().curator)].sort()).toEqual([...given].sort());
    // So every fact of the Curator's stays its own: none goes back to the read.
    expect(curatorKinds(defaultRoleSettings().curator)).toEqual([...CURATOR_FACTS]);
  });

  test("a Curator without People tools leaves walk-ons to the read; read-only, it leaves the read everything; prompt-only, it reads them all", () => {
    const curator = defaultRoleSettings().curator;
    expect(curatorKinds({ ...curator, families: ["items", "places", "money", "orgs"] })).toEqual(CURATOR_FACTS.filter((t) => t !== "spawn"));
    expect(curatorKinds({ ...curator, families: ["people"] })).toEqual(["spawn"]);
    expect(curatorKinds({ ...curator, tier: "read" })).toEqual([]);
    expect(curatorKinds({ ...curator, tier: "read", promptOnly: true })).toEqual([...CURATOR_FACTS]);
  });
});

describe("what the change tools share is told once", () => {
  test("no description carries it; each change tool names its guides, and the Curator is told both, once", async () => {
    const { rig, chatId } = await alderChat();
    const env = curatorEnv(toolEnv(rig, chatId, "gm"));
    const { world } = await env.reader.view();
    const tools = roleTools("curator", world, env);
    for (const t of tools) {
      expect({ tool: t.name, shared: t.description.includes("checked by the engine against the world") || t.description.includes("With dry set") }).toEqual({ tool: t.name, shared: false });
      const dry = (t.parameters.properties as Record<string, JsonObject> | undefined)?.dry;
      if (dry) expect({ tool: t.name, dry: dry.description }).toEqual({ tool: t.name, dry: "true: check only; nothing is staged." });
    }
    for (const t of TOOL_TEXTS.filter((x) => x.tier === "story" && x.family !== "people" && x.notes !== true)) expect({ tool: t.name, guides: t.guides?.includes("changes") }).toEqual({ tool: t.name, guides: true });
    const guide = toolsGuide(tools, {});
    expect(guide).toBe(TOOL_GUIDE_TEXTS.map((g) => g.text).join("\n\n"));
    expect(guide.match(/checked by the engine against the world/g)?.length).toBe(1);
    // Reads alone share nothing.
    expect(toolsGuide(toolsFor({ world, tiers: ["read"], texts: {}, env }), {})).toBe("");
  });

  test("each guide is a text of the Every agent page with a reset: the user's words reach the agent, and Reset brings the shipped ones back", async () => {
    for (const g of TOOL_GUIDE_TEXTS) expect(promptDef(toolGuideId(g.guide))).toMatchObject({ page: "runtime", group: "What tools share", text: g.text });
    const { rig, chatId } = await alderChat();
    const env = curatorEnv(toolEnv(rig, chatId, "gm"));
    const { world } = await env.reader.view();
    const mine = { [toolGuideId("changes")]: "Each change is checked first; dry only checks." };
    const tools = roleTools("curator", world, env, mine);
    expect(toolsGuide(tools, mine).split("\n\n")[0]).toBe("Each change is checked first; dry only checks.");
    expect(toolsGuide(tools, {}).split("\n\n")[0]).toBe(renderPrompt(toolGuideId("changes"), {}, {}));
  });
});

describe("the Curator's tool block", () => {
  test("weighs under its ceiling, and is the same on every call and every turn the world's names stand", async () => {
    const { rig, chatId } = await alderChat();
    const env = curatorEnv(toolEnv(rig, chatId, "gm"));
    const { world } = await env.reader.view();
    const first = block(roleTools("curator", world, env));
    // 33.7k characters (about 8.4k tokens at 4 a token) before Build C's new tools, down from 44.9k with the shared texts in each description; its new tools fit under the ceiling.
    expect(first.length).toBeLessThan(40_000);
    const later = await env.reader.view();
    expect(block(roleTools("curator", later.world, env))).toBe(first);
  });

  test("a place or action argument lists the world's ids up to ENUM_CAP, and past it is plain text, which the tool resolves itself", async () => {
    const { rig, chatId } = await alderChat();
    const env = toolEnv(rig, chatId, "gm");
    const { world } = await env.reader.view();
    const placeOf = (w: WorldDoc) => (toolsFor({ world: w, tiers: ["read"], families: ["places"], texts: {}, env }).find((t) => t.name === "places_read")?.parameters.properties as Record<string, JsonObject>).place;
    expect(Object.keys(world.places).length).toBeLessThanOrEqual(ENUM_CAP);
    expect(placeOf(world)?.enum).toContain(HOME);
    const many = Object.fromEntries(Array.from({ length: ENUM_CAP + 1 - Object.keys(world.places).length }, (_, i) => [`lot_${i}`, { name: `Lot ${i}` }]));
    const grown = { ...world, places: { ...world.places, ...many } } as WorldDoc;
    expect(placeEnum(grown)).toEqual([]);
    expect(placeOf(grown)).toEqual({ type: "string", description: toolText("places_read")?.args[0]?.text ?? "" });
    // The argument still takes an id or a name.
    expect((await callTool(rig, chatId, "gm", "places_read", { place: HOME })).error).toBeUndefined();
  });

  test("goes to the host with a breakpoint after its last tool when one is asked for, as an ephemeral cache_control", () => {
    expect(toolDTO({ name: "items_find", description: "Find a thing.", parameters: { type: "object", properties: {} }, cache: true })).toEqual({ name: "items_find", description: "Find a thing.", parameters: { type: "object", properties: {} }, cache_control: { type: "ephemeral" } } as never);
    expect(toolDTO({ name: "items_find", description: "Find a thing.", parameters: { type: "object", properties: {} } })).toEqual({ name: "items_find", description: "Find a thing.", parameters: { type: "object", properties: {} } });
  });
});
