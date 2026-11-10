// The words of Settings → Agents and its pages (the hub, its sections, Roles and each role's page,
// Context, Main agent, Assistant): every title, choice and line of help they show, apart from the
// limits' own words (shared/agent-settings.ts) and the stored values, which stay as they are. No
// label names the steps engine's old name, a raw id or a JSON pointer: a role is its label, a task
// what it does, a stored path the setting's name (`settingName`).

import type { RoleId, RoleOnFail, RoleTier } from "../../shared/agent-roles";
import { ROLE_LABEL } from "../../shared/agent-roles";
import type { AgentEffort, MemoryPlacement, PipelineMode, ReviewPlacement, FinalReviewOnFail, AssistantApply } from "../../shared/agent-settings";
import { BUDGET_DEFS, COMPACTION_DEFS, CURATOR_OPS_DEF, GM_OPS_DEF, HISTORY_TOKENS_DEF, KEPT_DEFS, LOOP_DEFS, MAIN_DEFS, OUTPUT_CHARS_DEF, SYSTEM_TOKENS_DEF, TURN_DEFS } from "../../shared/agent-settings";
import type { RolePerspective, SourceUse } from "../../shared/agent-context";
import { hasOwn } from "../../shared/json";
import type { MainRoleStage } from "../../shared/main-agent-prompts";
import type { RouteSource } from "../../shared/role-routes";
import { TIMEOUTS, type TimeoutKey } from "../../shared/timeouts";
import type { IconName } from "../icons";

/** Settings → Agents' sections, each a page of its own under its name. */
export type AgentsSub = "pipeline" | "review" | "system" | "budgets" | "compaction" | "recording" | "throttles" | "caching" | "acceptance";
export const AGENTS_SUBS: readonly AgentsSub[] = ["pipeline", "review", "system", "budgets", "compaction", "recording", "throttles", "caching", "acceptance"];

export const AGENTS_SUB: Readonly<Record<AgentsSub, { title: string; subtitle: string; icon: IconName }>> = {
  pipeline: { title: "Pipeline", subtitle: "How a turn is run, when memory runs, and the Curator", icon: "branch" },
  review: { title: "Review card", subtitle: "Where a turn's changes that ask first wait", icon: "checklist" },
  system: { title: "System instructions", subtitle: "How much of a prompt AGENTS.md and the role files may take", icon: "scroll" },
  budgets: { title: "Budgets", subtitle: "What each agent and each turn may spend", icon: "bolt" },
  compaction: { title: "Compaction", subtitle: "When the main agent's session is summarized", icon: "layers" },
  recording: { title: "Recording", subtitle: "How long each line for the narrator may be", icon: "edit" },
  throttles: { title: "Throttles", subtitle: "Requests and tokens per minute, per connection", icon: "hourglass" },
  caching: { title: "Caching", subtitle: "The provider's prompt cache, and Bust", icon: "box" },
  acceptance: { title: "Acceptance runs", subtitle: "Guarded connections, their ceilings, and the run", icon: "check" },
};

/** Each role's job, in a line: what its page and its row say under its name. */
export const ROLE_PLAIN: Readonly<Record<RoleId, string>> = {
  intent: "Reads your message into the action it plays, judges your approach and a puzzle's answer.",
  scene: "Picks the lore and notes the narrator needs for the scene.",
  minds: "Thinks as each character the scene calls on.",
  knowledge: "Works out who learned what from the reply.",
  director: "Weighs people's choices, writes the brief and the outline, and suggests your next moves.",
  read: "Reads the reply into the changes it makes.",
  curator: "Keeps the world's things and places true to the reply.",
  memory: "Remembers the reply for each character, and consolidates their memories.",
  skip: "Plans a time skip and finds its beats.",
  world: "Runs the world's own steps on the reply.",
};

/** Each task, by what it does: the role page's "Runs on" lists them so. */
export const TASK_LABEL: Readonly<Record<RoleId, Readonly<Record<string, string>>>> = {
  intent: { interpret: "Reading your message", judge: "Judging your approach", puzzle: "A puzzle's answer" },
  scene: { scene: "The scene's lore and notes" },
  minds: { mind: "Each character's mind" },
  knowledge: { knowledge: "Who learned what" },
  director: { decisions: "People's choices", prose: "The brief and the outline", choices: "Suggested choices" },
  read: { extract: "Reading the reply" },
  curator: { curate: "Things and places" },
  memory: { memory: "Each character's memory", consolidate: "Consolidating memories" },
  skip: { beats: "A skip's beats", plan: "A skip's plan" },
  world: { effects: "The world's own steps" },
};

/** A task's words; a task the page doesn't know reads as its role's. */
export function taskLabel(role: RoleId, task: string): string {
  const own = TASK_LABEL[role];
  return hasOwn(own, task) ? (own[task] ?? ROLE_LABEL[role]) : ROLE_LABEL[role];
}

/** Where a task's route comes from, as "Runs on" says it after the connection. */
export const ROUTE_FROM: Readonly<Record<RouteSource, string>> = { role: "its own", step: "from Steps", helper: "from Helper model", default: "Lumiverse's default" };

/** The main agent's stages a turn's roles work in, as a turn at a glance names them, by number. */
export const STAGE_LABEL: Readonly<Record<MainRoleStage, { number: number; label: string }>> = {
  memory_before: { number: 8, label: "Memory, left to the next turn" },
  intent: { number: 1, label: "Intent" },
  prepare: { number: 3, label: "Scene, minds and decisions" },
  beats: { number: 5, label: "Beats" },
  read: { number: 7, label: "Read" },
  memory: { number: 8, label: "Memory" },
};

export const PIPELINE_HELP: Readonly<Record<PipelineMode, string>> = {
  fixed: "Each role runs in the steps' own order and gives their outputs, worked out by agents: the same steps, the same gates and cards.",
  main: "A main agent for each chat decides which roles to run and what to tell them, in the order the engine keeps; it keeps a session from turn to turn.",
};

export const MEMORY_HELP: Readonly<Record<MemoryPlacement, string>> = {
  after_reply: "The characters' memory and consolidation run after the reply, as part of reading it.",
  before_next: "They run first in the next turn, before its plan, so reading the reply ends sooner; what they remember belongs to that turn.",
};

export const CURATOR_HELP = {
  on: "After the reply, beside the read, the Curator makes the world agree with it: the things in it and who has them, the places it makes, the people who walk on and a purchase's goods. The read leaves those to it.",
  off: "The read reads the reply's things, places, walk-ons and purchases itself.",
} as const;

export const REVIEW_HELP: Readonly<Record<ReviewPlacement, string>> = {
  chips: "The turn goes on and the card waits under the reply; the narrator isn't told of a change until you apply it.",
  gate: "The turn waits after its plan, as at the outline gate, until you answer the card; then it goes on without asking any agent again.",
};

export const STREAM_HELP = {
  on: "Each agent call takes its answer as the model writes it, so a gateway or proxy can't cut a long call off while it waits.",
  off: "Each agent call waits for its answer whole.",
} as const;

export const THINKING_HELP = {
  on: "A call that offers tools keeps its agent's reasoning effort, and asks for the model's thinking summarized.",
  off: "Until Lumiverse passes a reasoning model's thinking back after a tool call, a call that offers tools goes with reasoning off; calls without tools keep their effort.",
} as const;

/** What a role may change. */
export const TIER_LABEL: Readonly<Record<RoleTier, string>> = { read: "Nothing", story: "The story's changes", gm: "The GM's edits too" };

export const TIER_HELP: Readonly<Record<RoleTier, string>> = {
  read: "It only reads: it stages no change.",
  story: "It may stage the story's own changes and write the workspace; each lands as its change type's mode says (Settings → Changes from the reply).",
  gm: "It may stage the GM's own edits too: a spawn, a removal, any field, a stage, the clock; as many per turn as Settings → Agents → Budgets lets.",
};

/** What a role does when it fails, on the fixed pipeline. */
export const ON_FAIL_LABEL: Readonly<Record<RoleOnFail, string>> = { prompt_only: "Run its step's one call", skip: "Go on without it", stop: "Stop the turn" };

export const ON_FAIL_HELP: Readonly<Record<RoleOnFail, string>> = {
  prompt_only: "Its step's one call runs instead; if that fails too, the turn goes on without it.",
  skip: "The turn goes on without what it would have given.",
  stop: "The turn stops, with the engine-failed card and its Retry.",
};

export const FINAL_REVIEW_FAIL_HELP: Readonly<Record<FinalReviewOnFail, string>> = {
  send: "The narrator gets the prompt as the engine made it, and Settings → Diagnostics records why the review failed.",
  stop: "The turn stops before its reply: the chat says why, with a Retry.",
};

export const APPLY_HELP: Readonly<Record<AssistantApply, string>> = {
  ask: "Each change it proposes waits for you: Apply all, pick the ones you want, or No.",
  at_once: "Its changes are applied as soon as it answers, with an Undo chip, except a type of change set to Confirm in Settings → Changes from the reply, which waits for your Apply.",
};

/** Each effort in the pages' words. */
export const EFFORT_LABEL: Readonly<Record<AgentEffort, string>> = { off: "Off", low: "Low", medium: "Medium", high: "High", model: "Set by the model", inherit: "Connection's own" };

export const EFFORT_HELP: Readonly<Record<AgentEffort, string>> = {
  off: "It works without reasoning.",
  low: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  medium: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  high: "Sent as Lumiverse's reasoning setting, which it turns into the provider's own.",
  model: "For a model that picks its own effort by its name: sent as Lumiverse's Auto.",
  inherit: "The connection's own reasoning setting, else yours in Lumiverse.",
};

export const PERSPECTIVE_HELP: Readonly<Record<RolePerspective, string>> = {
  pov: "It works from what your character knows. A hint in its prompt only: its tools still read everything, secrets marked.",
  everyone: "It works from what everyone in the world knows, each secret marked with whom it is known to and kept from.",
  gm: "It works as the game master, who knows it all; a secret still reaches you only when the story reveals it.",
  own: "It works from what the character its task is about knows, as a mind does. A hint in its prompt only.",
};

export const USE_HELP: Readonly<Record<SourceUse, string>> = {
  start: "in its prompt from the start, as the narrator would get it then, in both pipelines",
  ask: "not in its prompt; the main agent may give it when the task needs it, and its tools can read it",
  never: "not in its prompt, and the main agent is told never to give it",
};

/** A stored value as a sentence says it. */
function valueWords(v: unknown): string {
  if (v === undefined || v === null) return "not set";
  if (v === "none") return "no limit";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "string") return `“${v}”`;
  return Array.isArray(v) ? `${v.length} ${v.length === 1 ? "entry" : "entries"}` : "a set of values";
}

/** A word of a stored path in plain words: "toolTurns" is "tool turns", "post_reply" is "post reply". */
function plain(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .toLowerCase()
    .trim();
}

const AGENT_DEFS: Readonly<Record<string, { label: string }>> = { ...LOOP_DEFS, gmOpsPerTurn: GM_OPS_DEF, curatorOps: CURATOR_OPS_DEF, systemTokens: SYSTEM_TOKENS_DEF };

/**
 * The name of the setting a stored path (a JSON pointer, `/agents/roles/intent/budget/toolTurns`)
 * holds, as its page names it ("Intent: Tool rounds per agent"); one the pages don't name reads as
 * its words in plain language, joined by arrows. Settings' "kept within" notice says these.
 */
export function settingName(pointer: string): string {
  const parts = pointer.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  const [top, a, b, c, d] = parts;
  const def = (defs: Readonly<Record<string, { label: string }>>, key: string | undefined): string | null => (key !== undefined && hasOwn(defs, key) ? (defs[key]?.label ?? null) : null);
  if (top === "agents") {
    const named =
      a === "budget" ? def(BUDGET_DEFS, b)
      : a === "turn" ? def(TURN_DEFS, b)
      : a === "kept" ? def(KEPT_DEFS, b)
      : a === "compaction" ? def(COMPACTION_DEFS, b)
      : a === "recording" ? OUTPUT_CHARS_DEF.label
      : a === "roles" && b !== undefined && hasOwn(ROLE_LABEL, b) ? `${ROLE_LABEL[b as RoleId]}: ${(c === "budget" ? def(BUDGET_DEFS, d) : null) ?? plain(c ?? "settings")}`
      : a === "main" ? `Main agent: ${(b === "budget" ? def(BUDGET_DEFS, c) : def(MAIN_DEFS, b)) ?? plain(b ?? "settings")}`
      : a === "finalReview" ? `Final review: ${(b === "budget" ? def(BUDGET_DEFS, c) : null) ?? plain(b ?? "settings")}`
      : a === "assistant" ? `Assistant: ${(b === "budget" ? def(BUDGET_DEFS, c) : b === "historyTokens" ? HISTORY_TOKENS_DEF.label : null) ?? plain(b ?? "settings")}`
      : def(AGENT_DEFS, a);
    if (named !== null) return named;
  }
  if (top === "timeouts" && a !== undefined && hasOwn(TIMEOUTS, a)) return TIMEOUTS[a as TimeoutKey].label;
  const words = parts.map(plain).filter((p) => p !== "");
  const text = words.join(" → ");
  return text === "" ? "A setting" : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Settings' notice for a value saved otherwise than sent: each by its name, as kept and as sent. */
export function adjustedText(adjusted: readonly { pointer: string; now: unknown; sent: unknown }[]): string {
  return `Saved, kept within what each setting takes: ${adjusted.map((a) => `${settingName(a.pointer)} is ${valueWords(a.now)}, not ${valueWords(a.sent)}`).join("; ")}.`;
}
