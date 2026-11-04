// The agent pipeline's one map (Settings → Agents; GM → Live): how each main-agent stage runs
// (`main.stages`: the main agent decides it, or its roles run on their own), which roles Smart
// persistence may keep and which may be switched off (`roles[].run`), the roles the engine never
// skips, the scene basis persistence keeps a quiet scene by, and the plan GM → Live shows for each
// turn: each role runs, is kept, off, auto or none, with why. The stages each role works in come from
// `role-routes`' task map, the one the role runs read. Pure, and read by no classic turn.

import { ROLE_IDS, ROLE_LABEL, type RoleId } from "./agent-roles";
import type { MainRoleStage } from "./main-agent-prompts";
import { ROLE_TASK_ROUTES } from "./role-routes";

// ---------------------------------------------------------------- stages

/** How a main-agent stage runs: the main agent decides it in a send of its own (`main`), or its roles run as the fixed pipeline runs them, with no send, and the main agent's next send lists what ran (`auto`). */
export type StageMode = "main" | "auto";
export const STAGE_MODES: readonly StageMode[] = ["main", "auto"];

/** The stages a main agent's turn sets, in the turn's order: the memory the last turn left to this one goes as the memory's. */
export const MAIN_STAGES = ["intent", "prepare", "beats", "read", "memory"] as const;
export type MainStage = (typeof MAIN_STAGES)[number];
export type MainStages = Record<MainStage, StageMode>;

/** Every stage the main agent decides (fork 4's default). */
export function defaultStages(): MainStages {
  return { intent: "main", prepare: "main", beats: "main", read: "main", memory: "main" };
}

/** The stage whose mode a role stage follows: the memory left to this turn is the memory's. */
export function stageOf(stage: MainRoleStage): MainStage {
  return stage === "memory_before" ? "memory" : stage;
}

/** Each stage as Settings and GM → Live name it: its number in the turn's order, and what it holds. */
export const STAGE_WORDS: Readonly<Record<MainStage, { number: number; label: string; holds: string }>> = {
  intent: { number: 1, label: "Stage 1: the intent", holds: "What the player's message plays" },
  prepare: { number: 3, label: "Stage 3: scene, minds and decisions", holds: "The scene's lore and notes, the minds of the people present, the director's decisions, the judge, a timelapse's skip" },
  beats: { number: 5, label: "Stage 5: the beats", holds: "The director's brief and outline for the planned turn" },
  read: { number: 7, label: "Stage 7: the read", holds: "The read of the reply, the Curator, the knowledge, a world step, the suggested choices" },
  memory: { number: 8, label: "Stage 8: the memory", holds: "The minds' memory of the reply, and the memory the last turn left to this one" },
};

export const STAGE_MODE_LABELS: Readonly<Record<StageMode, string>> = { main: "The main agent decides", auto: "Runs on its own" };

/** The stages a role works in, in the turn's order, from `role-routes`' task map. */
export function roleStages(role: RoleId): MainStage[] {
  const own = new Set(ROLE_TASK_ROUTES[role].map((t) => stageOf(t.stage)));
  return MAIN_STAGES.filter((s) => own.has(s));
}

/** The roles whose work a stage holds, in `ROLE_IDS`' order. */
export function stageRoles(stage: MainStage): RoleId[] {
  return ROLE_IDS.filter((role) => roleStages(role).includes(stage));
}

// ---------------------------------------------------------------- when a role runs

/**
 * When a role runs in an agent turn (Settings → Agents → Roles → a role → When it runs): whenever
 * the turn asks, kept from the last turn while Smart persistence holds the scene where the map lets
 * it be kept (`smart`); whenever the turn asks, never kept (`always`); or never, the turn going on
 * without it where the map lets it be switched off (`off`).
 */
export type RoleRun = "smart" | "always" | "off";
export const ROLE_RUNS: readonly RoleRun[] = ["smart", "always", "off"];

/** What the pipeline lets each role be: kept by Smart persistence (`keep`), switched off (`off`). */
export const PIPELINE_ROLES: Readonly<Record<RoleId, { keep: boolean; off: boolean }>> = {
  intent: { keep: false, off: false },
  scene: { keep: true, off: true },
  minds: { keep: true, off: true },
  knowledge: { keep: false, off: false },
  director: { keep: false, off: true },
  read: { keep: false, off: false },
  curator: { keep: false, off: false },
  memory: { keep: false, off: false },
  skip: { keep: false, off: false },
  world: { keep: false, off: false },
};

/** The roles the engine never skips: never kept, never switched off. The read, the Curator, the knowledge, the memory, a timelapse's skip and the world's steps stand on every turn's reply, and the intent is the turn. */
export const NEVER_SKIPPED: readonly RoleId[] = ROLE_IDS.filter((r) => !PIPELINE_ROLES[r].keep && !PIPELINE_ROLES[r].off);

/** The run choices a role's page offers: `smart` always, `always` where it may be kept, `off` where it may be switched off. */
export function roleRuns(role: RoleId): RoleRun[] {
  const map = PIPELINE_ROLES[role];
  return ROLE_RUNS.filter((r) => r === "smart" || (r === "always" && map.keep) || (r === "off" && map.off));
}

/** A role's run as stored: one its choices hold, else `fallback` (a choice the map doesn't let it take reads as `smart`, the same run). */
export function roleRunOf(role: RoleId, v: unknown, fallback: RoleRun): RoleRun {
  const runs = roleRuns(role);
  if (typeof v === "string" && (runs as readonly string[]).includes(v)) return v as RoleRun;
  return runs.includes(fallback) ? fallback : "smart";
}

export const ROLE_RUN_LABELS: Readonly<Record<RoleRun, string>> = { smart: "When the turn asks", always: "Every time, never kept", off: "Off" };

/** Each run choice in words, for its page's help. */
export function roleRunHelp(role: RoleId, run: RoleRun): string {
  if (run === "off") return `Never: the turn goes on without ${ROLE_LABEL[role]}, as when it fails and is skipped.`;
  if (run === "always") return "Whenever the turn asks, even while Smart persistence would keep its last answer.";
  return PIPELINE_ROLES[role].keep ? "Whenever the turn asks; while Smart persistence is on and the scene is unchanged, its last answer is kept instead of asked again." : "Whenever the turn asks.";
}

// ---------------------------------------------------------------- the scene basis

/**
 * What a scene is, for Smart persistence: where the player character is; who is with them, and
 * where; the day part; the world's revision and the live lore's fingerprint; the things where the
 * player character is and on everyone present; how the people present regard each other; and the
 * marks and GM fixes along the chat. A turn whose basis is the last turn's, with no mark or fix
 * since, is quiet.
 */
export const BASIS_SIGNALS = ["place", "present", "dayPart", "revision", "lore", "things", "regard", "marks"] as const;
export type BasisSignal = (typeof BASIS_SIGNALS)[number];
export type SceneBasis = Record<BasisSignal, string>;

export const BASIS_WORDS: Readonly<Record<BasisSignal, string>> = {
  place: "the place",
  present: "who is here",
  dayPart: "the time of day",
  revision: "the world's revision",
  lore: "the live lore",
  things: "the things here",
  regard: "how they regard each other",
  marks: "a GM fix or marker since",
};

/** The signals that differ between two bases, in `BASIS_SIGNALS`' order. */
export function basisChanged(was: Readonly<SceneBasis>, now: Readonly<SceneBasis>): BasisSignal[] {
  return BASIS_SIGNALS.filter((s) => was[s] !== now[s]);
}

/** Why Smart persistence kept nothing this turn, or that it held. */
export type PersistHold = { holds: true } | { holds: false; why: string };

// ---------------------------------------------------------------- the turn's plan

/** How a role stands in a turn's plan: it runs, its last answer is kept, it is switched off, its stage runs on its own, or the turn asks nothing of it. */
export type PlanStatus = "runs" | "kept" | "off" | "auto" | "none";
export const PLAN_STATUSES: readonly PlanStatus[] = ["runs", "kept", "off", "auto", "none"];
export const PLAN_STATUS_WORDS: Readonly<Record<PlanStatus, string>> = { runs: "Runs", kept: "Kept", off: "Off", auto: "Auto", none: "None" };

/** One role's line of the plan. */
export interface PlanRow {
  role: RoleId;
  status: PlanStatus;
  why: string;
}

/** What a turn's plan is made from: how the pipeline runs, each role's run, the Curator's switch, what persistence kept (of the minds due, `due`) and why, and what the turn asks of each role (null: something; else why nothing). */
export interface PlanInput {
  main: boolean;
  stages: Readonly<MainStages>;
  runs: Readonly<Record<RoleId, RoleRun>>;
  curator: boolean;
  persist: PersistHold | null;
  kept: { minds: number; due: number; scene: boolean };
  asked: Readonly<Partial<Record<RoleId, string | null>>>;
}

/** Each role's line of the turn's plan, in `ROLE_IDS`' order. */
export function turnPlan(input: PlanInput): PlanRow[] {
  return ROLE_IDS.map((role): PlanRow => {
    const row = (status: PlanStatus, why: string): PlanRow => ({ role, status, why });
    if (input.runs[role] === "off") return row("off", "Switched off on its page: Settings → Agents → Roles, When it runs.");
    if (role === "curator" && !input.curator) return row("off", "Off in Settings → Agents → Pipeline: the read does its work.");
    if (role === "scene" && input.kept.scene) return row("kept", "Its lore and notes are kept: the scene is unchanged since the last turn (Smart persistence).");
    const asked = input.asked[role];
    const minds = role === "minds" && input.kept.minds > 0 ? `${input.kept.minds === 1 ? "1 mind is" : `${input.kept.minds} minds are`} kept unchanged since the last turn (Smart persistence)` : "";
    if (asked !== undefined && asked !== null) return minds !== "" ? row("kept", `${minds}; ${lower(asked)}`) : row("none", asked);
    // Every mind due kept, none asks a model: the role's work this turn is the last turn's.
    if (minds !== "" && input.kept.minds >= input.kept.due) return row("kept", `${input.kept.minds === 1 ? "The one mind due is" : `All ${input.kept.minds} minds due are`} kept unchanged since the last turn (Smart persistence).`);
    const persisted = PIPELINE_ROLES[role].keep && input.runs[role] === "smart" && input.persist && !input.persist.holds ? ` It isn't kept: ${lower(input.persist.why)}` : "";
    const stages = roleStages(role);
    const auto = input.main ? stages.filter((s) => input.stages[s] === "auto") : [];
    if (input.main && auto.length > 0 && auto.length === stages.length) return row("auto", `${sentence(minds)}Its stage runs on its own, as the fixed pipeline runs it: Settings → Agents → Main agent → Stages.${persisted}`);
    const how = input.main ? `The main agent decides it in ${stages.map((s) => `stage ${STAGE_WORDS[s].number}`).join(", ")}${auto.length > 0 ? `; ${auto.map((s) => `stage ${STAGE_WORDS[s].number}`).join(", ")} ${auto.length === 1 ? "runs" : "run"} on its own` : ""}.` : "The fixed pipeline runs it when the turn asks.";
    return row("runs", `${sentence(minds)}${how}${persisted}`);
  });
}

const lower = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const sentence = (text: string): string => (text === "" ? "" : `${text.charAt(0).toUpperCase()}${text.slice(1)}. `);
