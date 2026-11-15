// What today's agent settings read of the agents engine's pipeline map (AGENT-LOOP-PLAN §5, §10): how
// each main-agent stage runs, which roles Smart persistence may keep or switch off, and the Curator's
// quiet-turn gate. Today's code, carried for the migration's settings store (PlanSwap-15 item 3) with
// none of the page's words: the stages' and roles' labels, the plan GM → Live drew and the help lines
// stay with the agents engine, which PlanSwap-10 removes.

import type { RoleId } from "./agent-roles";

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

/** The run choices a role's page offers: `smart` always, `always` where it may be kept, `off` where it may be switched off. */
function roleRuns(role: RoleId): RoleRun[] {
  const map = PIPELINE_ROLES[role];
  return ROLE_RUNS.filter((r) => r === "smart" || (r === "always" && map.keep) || (r === "off" && map.off));
}

/** A role's run as stored: one its choices hold, else `fallback` (a choice the map doesn't let it take reads as `smart`, the same run). */
export function roleRunOf(role: RoleId, v: unknown, fallback: RoleRun): RoleRun {
  const runs = roleRuns(role);
  if (typeof v === "string" && (runs as readonly string[]).includes(v)) return v as RoleRun;
  return runs.includes(fallback) ? fallback : "smart";
}

// ---------------------------------------------------------------- the Curator's quiet-turn gate

/**
 * Whether a quiet turn skips the Curator (`pipeline.curatorGate`; Settings → Agents → Roles →
 * Curator → When it runs): `off`, it runs after every reply; `shadow`, it still does, and
 * Diagnostics records each turn what the gate would have decided; `on`, a reply that names nothing
 * the Curator keeps skips it, and the read's own changes of its kinds land in its place.
 */
export type CuratorGate = "off" | "shadow" | "on";
export const CURATOR_GATES: readonly CuratorGate[] = ["off", "shadow", "on"];
