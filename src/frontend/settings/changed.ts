// How many settings on each of Settings → Agents' pages differ from their defaults: what the hub's
// rows, the Roles list, the Context overview and Settings home badge as "N changed". One setting is
// one row of its page (a connection with its model is one, a role's tool families are one, each
// source a role reads is one), so a count names what the page shows changed. A cache's Bust is no
// change: it only makes the next calls miss the provider's cache.

import { defaultContextSettings, sourceUse, CONTEXT_SOURCES } from "../../shared/agent-context";
import { ROLE_IDS, type RoleId } from "../../shared/agent-roles";
import { defaultAgentSettings, type AgentBudget, type AgentSettings } from "../../shared/agent-settings";
import { hasOwn } from "../../shared/json";
import { defaultTimeouts, type TimeoutSettings } from "../../shared/timeouts";
import { AGENTS_SUBS, type AgentsSub } from "./labels";

const DEFAULTS = defaultAgentSettings();
const CONTEXT = defaultContextSettings();
const TIMEOUTS = defaultTimeouts();

/** How many of `value`'s fields differ from `standard`'s. */
function fieldsChanged<T extends object>(value: T, standard: T): number {
  return (Object.keys(standard) as (keyof T)[]).filter((key) => value[key] !== standard[key]).length;
}

export function ownChanged(own: Readonly<Partial<AgentBudget>>, standard: Readonly<Partial<AgentBudget>>): number {
  const keys = new Set([...Object.keys(own), ...Object.keys(standard)] as (keyof AgentBudget)[]);
  return [...keys].filter((key) => own[key] !== standard[key]).length;
}

/** Whether two lists hold the same words, in any order. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** One of Settings → Agents' sections: its settings that differ. A role's own caching counts on its page, not here. */
export function agentsSubChanged(agents: Readonly<AgentSettings>, sub: AgentsSub): number {
  switch (sub) {
    case "pipeline":
      return fieldsChanged(agents.pipeline, DEFAULTS.pipeline);
    case "review":
      return fieldsChanged(agents.review, DEFAULTS.review);
    case "system":
      return agents.systemTokens === DEFAULTS.systemTokens ? 0 : 1;
    case "budgets":
      return fieldsChanged(agents.budget, DEFAULTS.budget) + fieldsChanged(agents.turn, DEFAULTS.turn) + fieldsChanged(agents.kept, DEFAULTS.kept) + [agents.loopRepeats !== DEFAULTS.loopRepeats, agents.clipChars !== DEFAULTS.clipChars, agents.gmOpsPerTurn !== DEFAULTS.gmOpsPerTurn].filter(Boolean).length;
    case "compaction":
      return fieldsChanged(agents.compaction, DEFAULTS.compaction);
    case "recording":
      return fieldsChanged(agents.recording, DEFAULTS.recording);
    case "throttles":
      return agents.throttles.length;
    case "caching":
      return agents.caching.on === DEFAULTS.caching.on ? 0 : 1;
    case "acceptance":
      return agents.acceptance.connections.length + [agents.acceptance.estimateFactor !== DEFAULTS.acceptance.estimateFactor, agents.vsClassic !== DEFAULTS.vsClassic].filter(Boolean).length;
  }
}

/** The Agents page in all: its sections, streaming and thinking in tool loops. */
export function agentsChanged(agents: Readonly<AgentSettings>): number {
  return AGENTS_SUBS.reduce((sum, sub) => sum + agentsSubChanged(agents, sub), 0) + [agents.stream !== DEFAULTS.stream, agents.thinkingInToolLoops !== DEFAULTS.thinkingInToolLoops].filter(Boolean).length;
}

/** What a role reads (its context): its perspective, each source used otherwise, its pinned files. */
export function contextChanged(agents: Readonly<AgentSettings>, id: RoleId): number {
  const c = agents.context.roles[id];
  const d = CONTEXT.roles[id];
  return (c.perspective === d.perspective ? 0 : 1) + CONTEXT_SOURCES.filter((s) => sourceUse(c, s) !== sourceUse(d, s)).length + (sameSet(c.pins, d.pins) ? 0 : 1);
}

/** Everything a role's page shows: where it runs, its effort, tools and tier, how it runs and fails, its own limits, its caching, what it reads, and the Curator's ops per turn. */
export function roleChanged(agents: Readonly<AgentSettings>, id: RoleId): number {
  const r = agents.roles[id];
  const d = DEFAULTS.roles[id];
  const settings = [r.connectionId !== d.connectionId || r.model !== d.model, r.effort !== d.effort, !sameSet(r.families, d.families), r.tier !== d.tier, r.promptOnly !== d.promptOnly, r.onFail !== d.onFail, hasOwn(agents.caching.roles, id), id === "curator" && agents.curatorOps !== DEFAULTS.curatorOps];
  return settings.filter(Boolean).length + ownChanged(r.budget, d.budget) + contextChanged(agents, id);
}

/** How many roles have a setting of their own. */
export function rolesChanged(agents: Readonly<AgentSettings>): number {
  return ROLE_IDS.filter((id) => roleChanged(agents, id) > 0).length;
}

/** The main agent's page: where it runs, its effort and tools, its turn task, its own limits, its caching, and its final review (its time among them). */
export function mainChanged(agents: Readonly<AgentSettings>, timeouts: Readonly<Pick<TimeoutSettings, "finalReviewMs">>): number {
  const m = agents.main;
  const d = DEFAULTS.main;
  const r = agents.finalReview;
  const dr = DEFAULTS.finalReview;
  const settings = [m.connectionId !== d.connectionId || m.model !== d.model, m.effort !== d.effort, !sameSet(m.families, d.families), m.digestTokens !== d.digestTokens, m.pinsTokens !== d.pinsTokens, hasOwn(agents.caching.roles, "main"), r.on !== dr.on, r.onFail !== dr.onFail, timeouts.finalReviewMs !== TIMEOUTS.finalReviewMs];
  return settings.filter(Boolean).length + ownChanged(m.budget, d.budget) + ownChanged(r.budget, dr.budget);
}

/** The GM assistant's page: where it runs, its effort, how its changes land, its history, its own limits and its caching. */
export function assistantChanged(agents: Readonly<AgentSettings>): number {
  const a = agents.assistant;
  const d = DEFAULTS.assistant;
  const settings = [a.connectionId !== d.connectionId || a.model !== d.model, a.effort !== d.effort, a.apply !== d.apply, a.historyTokens !== d.historyTokens, hasOwn(agents.caching.roles, "assistant")];
  return settings.filter(Boolean).length + ownChanged(a.budget, d.budget);
}
