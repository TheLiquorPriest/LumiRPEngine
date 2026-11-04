// The turn's agent roles (AGENT-LOOP-PLAN §5; INC2-SPEC C9): their ids, in §5's order, which is also
// the order a turn commits what they staged; which tool families each is given and at which tier;
// and how the fixed pipeline treats one that fails. Each is a setting with its default (Settings →
// Agents → Roles, `UserSettings.agents.roles`), read by `agent-settings.ts`. What a role starts with
// and the perspective it works from are its context (`agent-context.ts`, Settings → Agents → Context).
// Nothing here is read by a classic turn.

import type { RoleRun } from "./agent-pipeline";
import type { AgentBudget, AgentEffort } from "./agent-settings";
import type { ToolFamily } from "./agent-tools";

/** The roles of §5, by id, with the Curator (ITEMS-SPEC §7): after the read, it keeps the world's fabric (things, places, walk-on people, a purchase's goods) true to the reply. */
export type RoleId = "intent" | "scene" | "minds" | "knowledge" | "director" | "read" | "curator" | "memory" | "skip" | "world";

/** Every role, in §5's order: a turn commits what its roles staged in this order, then by staging order (INC2-SPEC C10). The Curator commits after the read and before the memory. */
export const ROLE_IDS: readonly RoleId[] = ["intent", "scene", "minds", "knowledge", "director", "read", "curator", "memory", "skip", "world"];

/** Where in the turn a role's work runs: before the plan, between the plan and the reply, after the reply, or inside a time skip. */
export type RolePhase = "pre" | "plan" | "post" | "skip";

/**
 * What a role may write (AGENT-LOOP-PLAN §6): nothing (`read`), the story's own changes and the
 * workspace (`story`), or the GM's edits too (`gm`), which a role gets only when you grant them.
 */
export type RoleTier = "read" | "story" | "gm";
export const ROLE_TIERS: readonly RoleTier[] = ["read", "story", "gm"];

/**
 * What the fixed pipeline does when a role fails (AGENT-LOOP-PLAN §10): run it once more as one call
 * with its classic contract (`prompt_only`), and go on without it if that fails too; go on without
 * it (`skip`); or stop the turn with the engine-failed card and its Retry (`stop`). In main-agent
 * mode the main agent decides instead.
 */
export type RoleOnFail = "prompt_only" | "skip" | "stop";
export const ROLE_ON_FAIL: readonly RoleOnFail[] = ["prompt_only", "skip", "stop"];

/**
 * One role's settings (Settings → Agents → Roles), each with §15's default (`defaultRoleSettings`).
 * Its caching is every agent's caching setting under its id (`AgentSettings.caching.roles`), which
 * the provider reads for each call.
 */
export interface RoleSettings {
  /** The connection and model it runs on; null: its classic step's (Settings → Steps and connections), else the helper's. */
  connectionId: string | null;
  model: string | null;
  effort: AgentEffort;
  families: ToolFamily[];
  tier: RoleTier;
  /** One call with the role's JSON contract and no tools, which is its classic step's own prompt and contract (§8). */
  promptOnly: boolean;
  onFail: RoleOnFail;
  /** When it runs in an agent turn (`RoleRun`): whenever the turn asks, kept or not by Smart persistence, or never; what the pipeline map lets it take. */
  run: RoleRun;
  /** Its own limits over every agent's (`AgentSettings.budget`): each one set here stands in for that one. */
  budget: Partial<AgentBudget>;
}

/** What Settings → Agents → Roles calls each role. */
export const ROLE_LABEL: Readonly<Record<RoleId, string>> = {
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
};

/** §6's tool families for each role: what its work reads. Organizations come wherever money does (ORG-SPEC §7.1). */
const FAMILIES: Readonly<Record<RoleId, readonly ToolFamily[]>> = {
  intent: ["people", "places", "items", "money", "orgs", "checks", "time"],
  scene: ["people", "places", "lore", "workspace"],
  minds: ["people", "minds", "knowledge", "lore"],
  knowledge: ["people", "knowledge"],
  director: ["people", "places", "quests", "minds", "knowledge", "time"],
  read: ["people", "places", "items", "money", "orgs", "time", "quests", "knowledge"],
  // Things and places it reads and writes; people, money and organizations it reads (ITEMS-SPEC §7.2).
  curator: ["items", "places", "people", "money", "orgs"],
  memory: ["people", "minds"],
  skip: ["people", "places", "time", "minds"],
  world: ["people", "places", "items", "money", "orgs", "quests", "time"],
};

/**
 * The Curator's own rounds of tool calls (its budget's Tool rounds per agent, over every agent's):
 * its work is a round of lookups at most and a round of changes, with room for a refusal's retry,
 * and a round limit that stops it leaves what it staged standing (ITEMS-SPEC §7.2).
 */
export const CURATOR_TOOL_TURNS = 6;

/**
 * Every role's settings as a new user has them (§15): its classic step's connection, the effort its
 * connection sets, §6's families, the story's writes and none of the GM's, as an agent
 * with tools, and on a failure its classic step's own call, except the intent, without which the
 * turn can't be played as asked: it stops the turn. Each role's budget is every agent's, but the
 * Curator's rounds of tool calls (`CURATOR_TOOL_TURNS`).
 */
export function defaultRoleSettings(): Record<RoleId, RoleSettings> {
  const out = {} as Record<RoleId, RoleSettings>;
  for (const id of ROLE_IDS) out[id] = { connectionId: null, model: null, effort: "inherit", families: [...FAMILIES[id]], tier: "story", promptOnly: false, onFail: id === "intent" ? "stop" : "prompt_only", run: "smart", budget: id === "curator" ? { toolTurns: CURATOR_TOOL_TURNS } : {} };
  return out;
}
