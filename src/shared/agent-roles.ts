// The turn's agent roles (AGENT-LOOP-PLAN §5; INC2-SPEC C9): their ids, in §5's order, which is also
// the order a turn commits what they staged; whose knowledge each reads, which tool families it is
// given and at which tier; and how the fixed pipeline treats one that fails. Each is a setting with
// its default (Settings → Agents → Roles, `UserSettings.agents.roles`), read by `agent-settings.ts`.
// Nothing here is read by a classic turn.

import type { AgentBudget, AgentEffort } from "./agent-settings";
import type { AgentKnowledge, ToolFamily } from "./agent-tools";

/** The roles of §5, by id. */
export type RoleId = "intent" | "scene" | "minds" | "knowledge" | "director" | "read" | "memory" | "skip" | "world";

/** Every role, in §5's order: a turn commits what its roles staged in this order, then by staging order (INC2-SPEC C10). */
export const ROLE_IDS: readonly RoleId[] = ["intent", "scene", "minds", "knowledge", "director", "read", "memory", "skip", "world"];

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

/** Whose knowledge a role reads with: an agent's, or `own`, a mind's own character's (§5). */
export type RoleKnowledge = AgentKnowledge | "own";
export const ROLE_KNOWLEDGE: readonly RoleKnowledge[] = ["pov", "everyone", "gm", "own"];

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
  knowledge: RoleKnowledge;
  families: ToolFamily[];
  tier: RoleTier;
  /** One call with the role's JSON contract and no tools, which is its classic step's own prompt and contract (§8). */
  promptOnly: boolean;
  onFail: RoleOnFail;
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
  memory: "Memory",
  skip: "Skip beats",
  world: "World steps",
};

/** §5's knowledge for each role: the intent the player character's, a mind and memory their own character's, the rest each present person's (everyone's, secrets marked). */
const KNOWLEDGE: Readonly<Record<RoleId, RoleKnowledge>> = { intent: "pov", scene: "everyone", minds: "own", knowledge: "everyone", director: "everyone", read: "everyone", memory: "own", skip: "everyone", world: "everyone" };

/** §6's tool families for each role: what its work reads. */
const FAMILIES: Readonly<Record<RoleId, readonly ToolFamily[]>> = {
  intent: ["people", "places", "items", "money", "checks", "time"],
  scene: ["people", "places", "lore", "workspace"],
  minds: ["people", "minds", "knowledge", "lore"],
  knowledge: ["people", "knowledge"],
  director: ["people", "places", "quests", "minds", "knowledge", "time"],
  read: ["people", "places", "items", "money", "time", "quests", "knowledge"],
  memory: ["people", "minds"],
  skip: ["people", "places", "time", "minds"],
  world: ["people", "places", "items", "money", "quests", "time"],
};

/**
 * Every role's settings as a new user has them (§15): its classic step's connection, the effort its
 * connection sets, §5's knowledge and families, the story's writes and none of the GM's, as an agent
 * with tools, and on a failure its classic step's own call, except the intent, without which the
 * turn can't be played as asked: it stops the turn.
 */
export function defaultRoleSettings(): Record<RoleId, RoleSettings> {
  const out = {} as Record<RoleId, RoleSettings>;
  for (const id of ROLE_IDS) out[id] = { connectionId: null, model: null, effort: "inherit", knowledge: KNOWLEDGE[id], families: [...FAMILIES[id]], tier: "story", promptOnly: false, onFail: id === "intent" ? "stop" : "prompt_only", budget: {} };
  return out;
}
