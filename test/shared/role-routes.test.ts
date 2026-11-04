// Where each task of an agent turn's roles runs (shared/role-routes.ts): the map of every role's
// tasks to the steps whose route they take and the stages they work in, pinned whole and to the
// tasks Prompts lists for each role; and the route as a role run resolves it: the role's own
// connection, else its step's, else the helper model's, else Lumiverse's default connection.

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import { defaultRoleSettings, ROLE_IDS } from "../../src/shared/agent-roles";
import { ROLE_TASKS } from "../../src/shared/role-prompts";
import { ROLE_TASK_ROUTES, roleRoutes, stepUsers, taskRoute, taskStep, type RouteSettings } from "../../src/shared/role-routes";
import { stepConfigOf } from "../../src/shared/settings";
import type { StepPurpose } from "../../src/shared/world";

const SETTINGS = defaultSettings();
const ROUTES: RouteSettings = { modelUse: SETTINGS.modelUse, helper: SETTINGS.helper };
const ROLES = defaultRoleSettings();

/** Route settings with one step's own route, and whether it is on. */
function withStep(purpose: StepPurpose, connectionId: string | null, model: string | null, enabled = true): RouteSettings {
  const steps = structuredClone(SETTINGS.modelUse.steps);
  steps[purpose] = { ...stepConfigOf(steps, purpose), enabled, route: { provider: "helper", connectionId, model } };
  return { modelUse: { steps }, helper: SETTINGS.helper };
}

describe("the task → step map", () => {
  test("lists every role's tasks in the order Prompts does", () => {
    for (const role of ROLE_IDS) expect(ROLE_TASK_ROUTES[role].map((t) => t.task)).toEqual([...ROLE_TASKS[role]]);
  });

  test("is pinned: each task's steps and stage, as the role runs take them", () => {
    const pinned = Object.fromEntries(ROLE_IDS.map((role) => [role, ROLE_TASK_ROUTES[role].map((t) => `${t.task}: ${t.steps.join(" or ") || "the helper model"} · ${t.stage}`)]));
    expect(pinned).toEqual({
      intent: ["interpret: interpret · intent", "judge: judge · prepare", "puzzle: puzzle.answer · prepare"],
      scene: ["scene: the helper model · prepare"],
      minds: ["mind: mind · prepare"],
      knowledge: ["knowledge: knowledge · read"],
      director: ["decisions: npc.choose · prepare", "prose: brief or outline · beats", "choices: choices · read"],
      read: ["extract: extract · read"],
      curator: ["curate: extract · read"],
      memory: ["memory: memory · memory", "consolidate: consolidate · memory"],
      skip: ["beats: skip · prepare", "plan: skip · prepare"],
      world: ["effects: extract · read"],
    });
  });
});

describe("a task's route", () => {
  const interpret = ROLE_TASK_ROUTES.intent[0];
  if (!interpret) throw new Error("no interpret task");

  test("a role with no connection of its own runs each task where its step does", () => {
    expect(taskRoute(withStep("interpret", "harbor", "harbor-large"), "intent", ROLES.intent, interpret)).toEqual({ role: "intent", task: "interpret", step: "interpret", connectionId: "harbor", model: "harbor-large", from: "step" });
    // The step's connection without a model: the connection's own.
    expect(taskRoute(withStep("interpret", "harbor", null), "intent", ROLES.intent, interpret)).toMatchObject({ connectionId: "harbor", model: null, from: "step" });
    // The role's model stands in for the step's.
    expect(taskRoute(withStep("interpret", "harbor", "harbor-large"), "intent", { connectionId: null, model: "harbor-small" }, interpret)).toMatchObject({ connectionId: "harbor", model: "harbor-small", from: "step" });
  });

  test("its own connection wins for every task; a step naming none takes the helper model's, else Lumiverse's default", () => {
    expect(roleRoutes(withStep("interpret", "harbor", "harbor-large"), "intent", { connectionId: "deepseek", model: null }).map((r) => [r.connectionId, r.model, r.from])).toEqual(Array(3).fill(["deepseek", null, "role"]));
    const helper: RouteSettings = { modelUse: SETTINGS.modelUse, helper: { ...SETTINGS.helper, connectionId: "harbor", model: "harbor-large" } };
    expect(roleRoutes(helper, "scene", ROLES.scene)).toEqual([{ role: "scene", task: "scene", step: null, connectionId: "harbor", model: "harbor-large", from: "helper" }]);
    expect(roleRoutes(ROUTES, "scene", ROLES.scene)).toEqual([{ role: "scene", task: "scene", step: null, connectionId: null, model: SETTINGS.helper.model, from: "default" }]);
  });

  test("the director's prose runs where the brief does, and where the outline does on a turn without one", () => {
    const prose = ROLE_TASK_ROUTES.director[1];
    if (!prose) throw new Error("no prose task");
    expect(taskStep(ROUTES, prose)).toBe("brief");
    const briefOff = withStep("brief", null, null, false);
    const outline = (enabled: boolean) => (briefOff.modelUse.steps.outline = { ...stepConfigOf(briefOff.modelUse.steps, "outline"), enabled });
    outline(true);
    expect(taskStep(briefOff, prose)).toBe("outline");
    // With neither on, the brief's, as the run names it.
    outline(false);
    expect(taskStep(briefOff, prose)).toBe("brief");
  });

  test("a step's users are the tasks that take its route; with no step, the helper model's", () => {
    const users = stepUsers(withStep("extract", "harbor", null), ROLES, "extract");
    expect(users.map((u) => `${u.role}.${u.task}`)).toEqual(["read.extract", "curator.curate", "world.effects"]);
    // A role with its own connection is no step's user.
    expect(stepUsers(ROUTES, { ...ROLES, read: { ...ROLES.read, connectionId: "deepseek" } }, "extract").map((u) => u.role)).toEqual(["curator", "world"]);
    // On the helper model: every task whose step names no connection.
    expect(stepUsers(withStep("extract", "harbor", null), ROLES, null).map((u) => u.role)).not.toContain("read");
  });
});
