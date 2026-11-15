// What today's agent settings read of the turn's agent roles (AGENT-LOOP-PLAN §5; INC2-SPEC C9): their
// ids, in §5's order; the tool families each is given and at which tier; and how the fixed pipeline
// treats one that fails. Today's code, carried for the migration's settings store (PlanSwap-15 item
// 3) with no text a model is shown: the roles' labels and the tools' names and descriptions stay with
// the agents engine, which PlanSwap-10 removes. A role's tools are named by family only, as the
// stored settings name them.

import type { RoleRun } from "./agent-pipeline";
import type { AgentBudget, AgentEffort } from "./agent-settings";

/** The families of AGENT-LOOP-PLAN §6's table, and organizations (ORG-SPEC §7.1); a role is given tools by family. */
export type ToolFamily = "people" | "places" | "items" | "money" | "orgs" | "quests" | "knowledge" | "time" | "checks" | "minds" | "lore" | "workspace";

/** Every tool family, by id. */
export const TOOL_FAMILIES: readonly ToolFamily[] = ["people", "places", "items", "money", "orgs", "quests", "knowledge", "time", "checks", "minds", "lore", "workspace"];

/** The roles of §5, by id, with the Curator (ITEMS-SPEC §7): after the read, it keeps the world's fabric (things, places, walk-on people, a purchase's goods) true to the reply. */
export type RoleId = "intent" | "scene" | "minds" | "knowledge" | "director" | "read" | "curator" | "memory" | "skip" | "world";

/** Every role, in §5's order: a turn commits what its roles staged in this order, then by staging order (INC2-SPEC C10). The Curator commits after the read and before the memory. */
export const ROLE_IDS: readonly RoleId[] = ["intent", "scene", "minds", "knowledge", "director", "read", "curator", "memory", "skip", "world"];

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
