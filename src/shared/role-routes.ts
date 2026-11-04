// Where each task of an agent turn's roles runs (AGENT-LOOP-PLAN §15): every role's tasks, in the
// order Prompts lists them (`ROLE_TASKS`), each with the steps whose work it does and the main
// agent's stage it works in, and the route that resolves from them. A role that names a connection
// runs every task there; one that names none runs each task on its step's connection and model
// (Settings → Steps and connections), else the helper model's, else Lumiverse's default connection.
// Settings → Agents shows these ("Runs on", a turn at a glance, Steps' "On agent chats"), and each
// role's run reads them (`runRoleAgent`), so a task runs where Settings says it does; the stages each
// role works in come from them too (`shared/agent-pipeline.ts`). Nothing here is read by a turn on the
// steps engine.

import { ROLE_IDS, type RoleId, type RoleSettings } from "./agent-roles";
import type { MainRoleStage } from "./main-agent-prompts";
import { helperCallOf, stepConfigOf, type HelperDefault, type ModelUseSettings } from "./settings";
import type { StepPurpose } from "./world";

/** One task of a role: its id (`ROLE_TASKS`), the steps whose route it takes, and the main agent's stage it works in. */
export interface RoleTask {
  task: string;
  /** The step whose connection and model it runs on while its role names none: the first of these that is on (the director's prose: the brief's, else the outline's). None: the helper model's. */
  steps: readonly StepPurpose[];
  stage: MainRoleStage;
}

/** Every role's tasks, in `ROLE_TASKS`' order. The director's decisions also run in the read, for the people elsewhere; the memory runs first in the next turn while it is left to it. */
export const ROLE_TASK_ROUTES: Readonly<Record<RoleId, readonly RoleTask[]>> = {
  intent: [
    { task: "interpret", steps: ["interpret"], stage: "intent" },
    { task: "judge", steps: ["judge"], stage: "prepare" },
    { task: "puzzle", steps: ["puzzle.answer"], stage: "prepare" },
  ],
  scene: [{ task: "scene", steps: [], stage: "prepare" }],
  minds: [{ task: "mind", steps: ["mind"], stage: "prepare" }],
  knowledge: [{ task: "knowledge", steps: ["knowledge"], stage: "read" }],
  director: [
    { task: "decisions", steps: ["npc.choose"], stage: "prepare" },
    { task: "prose", steps: ["brief", "outline"], stage: "beats" },
    { task: "choices", steps: ["choices"], stage: "read" },
  ],
  read: [{ task: "extract", steps: ["extract"], stage: "read" }],
  curator: [{ task: "curate", steps: ["extract"], stage: "read" }],
  memory: [
    { task: "memory", steps: ["memory"], stage: "memory" },
    { task: "consolidate", steps: ["consolidate"], stage: "memory" },
  ],
  skip: [
    { task: "beats", steps: ["skip"], stage: "prepare" },
    { task: "plan", steps: ["skip"], stage: "prepare" },
  ],
  world: [{ task: "effects", steps: ["extract"], stage: "read" }],
};

/** Where a route comes from: the role's own connection, its step's (Steps and connections), the helper model's, or Lumiverse's default connection. */
export type RouteSource = "role" | "step" | "helper" | "default";

/** The connection and model a task's calls go to: null connection is Lumiverse's default; null model, the connection's own. */
export interface TaskRoute {
  role: RoleId;
  task: string;
  /** The step it takes its route from while the role names none; null: none (the helper model's). */
  step: StepPurpose | null;
  connectionId: string | null;
  model: string | null;
  from: RouteSource;
}

/** What a route resolves from: the user's steps and helper model. */
export interface RouteSettings {
  modelUse: Pick<ModelUseSettings, "steps">;
  helper: Readonly<HelperDefault>;
}

/** The step a task takes its route from: the first of its steps that is on, else its first; null for a task with none. */
export function taskStep(settings: RouteSettings, task: RoleTask): StepPurpose | null {
  return task.steps.find((s) => stepConfigOf(settings.modelUse.steps, s).enabled) ?? task.steps[0] ?? null;
}

/**
 * The route `role`'s `task` runs on, as the role run resolves it: the role's own connection (and
 * its model, else the connection's); else its step's call (`helperCallOf`: the step's own
 * connection and model, else the helper model's), the role's own model standing in for the model.
 */
export function taskRoute(settings: RouteSettings, role: RoleId, own: Pick<RoleSettings, "connectionId" | "model">, task: RoleTask): TaskRoute {
  const step = taskStep(settings, task);
  if (own.connectionId !== null) return { role, task: task.task, step, connectionId: own.connectionId, model: own.model, from: "role" };
  const config = step ? stepConfigOf(settings.modelUse.steps, step) : null;
  const call = helperCallOf(config, settings.helper);
  const stepOwn = config?.route?.connectionId ?? null;
  return { role, task: task.task, step, connectionId: call.connectionId, model: own.model ?? call.model, from: stepOwn !== null ? "step" : call.connectionId !== null ? "helper" : "default" };
}

/** Every task of `role`, with its route. */
export function roleRoutes(settings: RouteSettings, role: RoleId, own: Pick<RoleSettings, "connectionId" | "model">): TaskRoute[] {
  return ROLE_TASK_ROUTES[role].map((task) => taskRoute(settings, role, own, task));
}

/** Every role's tasks whose route comes from `step` (or, with null, from the helper model), for the roles in `roles` that name no connection of their own. */
export function stepUsers(settings: RouteSettings, roles: Readonly<Record<RoleId, Pick<RoleSettings, "connectionId" | "model">>>, step: StepPurpose | null): TaskRoute[] {
  return ROLE_IDS.flatMap((role) => roleRoutes(settings, role, roles[role]).filter((r) => r.from !== "role" && (step === null ? r.from === "helper" || r.from === "default" : r.step === step)));
}
