// Settings → Agents and its pages (INC2-SPEC C12; N3 lane A7): the hub (a turn at a glance, every
// call's switches, a row per section with its Changed count), each section's page (Pipeline, Review
// card, System instructions, Budgets, Compaction, Recording, Acceptance runs), a role's page (where
// each task runs, what it may do and read, how it runs and fails, its own limits and the picker that
// sets one, its caching), the Roles and Context lists, and the Main agent's page. Each control sends
// its merge patch; a Default shows only while its value differs, and sends null; and what the pages
// send lands in the real settings store and reads back, every Default and Reset reading back the
// shipped defaults. The pages are walked as rendered trees (no DOM).

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import { Button, HostModelPicker, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import { AcceptanceSection, AgentsHub, agentsSummary, BudgetsSection, CallSwitches, CompactionSection, PipelineSection, RecordingSection, ReviewSection, SystemSection, TurnGlance, turnGlance } from "../../src/frontend/settings/agents";
import { mainChanged, roleChanged } from "../../src/frontend/settings/changed";
import { ContextPage, contextSummary } from "../../src/frontend/settings/context";
import { amountText, NavRow, ToggleChips } from "../../src/frontend/settings/kit";
import { MainAgentPage, mainPatch, mainResetPatch, mainSummary } from "../../src/frontend/settings/main-agent";
import { FAMILIES, pinsOf, RolePage, roleResetPatch } from "../../src/frontend/settings/role-page";
import { RolesPage, rolesSummary } from "../../src/frontend/settings/roles";
import { type Connection, ConnectionSelect } from "../../src/frontend/settings/steps";
import { defaultContextSettings, sourceLabel } from "../../src/shared/agent-context";
import { CURATOR_TOOL_TURNS, defaultRoleSettings, ROLE_IDS, ROLE_LABEL, type RoleId } from "../../src/shared/agent-roles";
import type { AgentSettings } from "../../src/shared/agent-settings";
import { defaultAgentSettings } from "../../src/shared/agent-settings";
import type { JsonObject } from "../../src/shared/json";
import type { RouteSettings } from "../../src/shared/role-routes";
import type { SettingsRoute } from "../../src/frontend/app";
import { stepConfigOf } from "../../src/shared/settings";
import { Rig } from "../support/rig";
import { rendered, texts } from "../support/settings-tree";
import { labelled, press, propsOf, type Props } from "../support/tree";

const CONNECTIONS: Connection[] = [
  { id: "deepseek", name: "Deepseek", model: "deepseek-v4-flash" },
  { id: "harbor", name: "Harbor relay", model: null },
];

const DEFAULTS = defaultAgentSettings();
const SETTINGS = defaultSettings();
const ROUTES: RouteSettings = { modelUse: SETTINGS.modelUse, helper: SETTINGS.helper };
const PROMPTS = SETTINGS.prompts;
const TIMEOUTS = SETTINGS.timeouts;

let sent: JsonObject | null = null;
const patch = (p: JsonObject): void => void (sent = p);
let went: SettingsRoute | null = null;
const go = (route: SettingsRoute): void => void (went = route);

/** The patch the last control pressed sent. */
function take(): JsonObject {
  const p = sent;
  sent = null;
  if (!p) throw new Error("nothing sent");
  return p;
}

function only<T>(list: readonly T[]): T {
  const [one] = list;
  if (list.length !== 1 || one === undefined) throw new Error(`${list.length} found, not one`);
  return one;
}

function click(button: Props): void {
  const onClick = button.onClick;
  if (typeof onClick !== "function") throw new Error("not a button");
  onClick();
}

/** The labels of a tree's buttons: its Defaults, Resets and Busts. */
const labels = (tree: unknown): unknown[] => propsOf(tree, Button).map((p) => p.label);

/** Agent settings with `change` made to a copy of `from`. */
function agentsWith(change: (a: AgentSettings) => void, from: AgentSettings = DEFAULTS): AgentSettings {
  const a = structuredClone(from);
  change(a);
  return a;
}

const hub = (agents: AgentSettings) => rendered(AgentsHub({ agents, routes: ROUTES, connections: CONNECTIONS, busy: false, patch, go }));
const pipeline = (agents: AgentSettings) => rendered(PipelineSection({ agents, busy: false, patch }));
const review = (agents: AgentSettings) => rendered(ReviewSection({ agents, busy: false, patch }));
const compaction = (agents: AgentSettings) => rendered(CompactionSection({ agents, busy: false, patch }));
const recording = (agents: AgentSettings) => rendered(RecordingSection({ agents, busy: false, patch }));
const budgets = (agents: AgentSettings) => rendered(BudgetsSection({ agents, busy: false, patch }));
const system = (agents: AgentSettings) => rendered(SystemSection({ agents, busy: false, patch }));
const calls = (agents: AgentSettings) => rendered(CallSwitches({ agents, busy: false, patch }));
const acceptance = (agents: AgentSettings) => rendered(AcceptanceSection({ acceptance: agents.acceptance, vsClassic: agents.vsClassic, connections: CONNECTIONS, busy: false, patch }));
const rolePage = (agents: AgentSettings, id: RoleId, routes: RouteSettings = ROUTES) => rendered(RolePage({ id, agents, routes, prompts: PROMPTS, connections: CONNECTIONS, busy: false, patch, go }));
const mainPage = (agents: AgentSettings) => rendered(MainAgentPage({ agents, timeouts: TIMEOUTS, prompts: PROMPTS, connections: CONNECTIONS, busy: false, patch, go }));

/** The pages of the hub's sections, as each renders. */
const SECTIONS = [pipeline, review, compaction, recording, budgets, system, calls, acceptance] as const;

describe("Settings → Agents: the hub", () => {
  test("a turn at a glance names each stage in order, its roles, where they run and how, at the defaults", () => {
    const stages = turnGlance(DEFAULTS, ROUTES, CONNECTIONS);
    expect(stages.map((s) => [s.number, s.label])).toEqual([
      [1, "Intent"],
      [3, "Scene, minds and decisions"],
      [5, "Beats"],
      [6, "Final review"],
      [7, "Read"],
      [8, "Memory"],
    ]);
    const place = "Lumiverse's default connection";
    expect(stages.map((s) => s.rows.map((r) => [r.roles.join(","), r.route, r.how]))).toEqual([
      [["intent", place, null]],
      [
        ["intent,scene,minds,director", place, null],
        ["skip", place, "in a time skip"],
      ],
      [["director", place, null]],
      [["main", place, null]],
      [["knowledge,director,read,curator,world", place, null]],
      [["memory", place, null]],
    ]);
  });

  test("the glance follows the settings: a role's own connection, one call, the Curator off, memory left to the next turn, the review off", () => {
    const changed = agentsWith((a) => {
      a.roles.minds.connectionId = "deepseek";
      a.roles.read.promptOnly = true;
      a.pipeline.curator = false;
      a.pipeline.memory = "before_next";
      a.finalReview.on = false;
    });
    const stages = turnGlance(changed, ROUTES, CONNECTIONS);
    const prepare = only(stages.filter((s) => s.id === "prepare"));
    expect(prepare.rows.map((r) => [r.roles.join(","), r.route])).toEqual([
      ["intent,scene,director", "Lumiverse's default connection"],
      ["minds", "Deepseek · deepseek-v4-flash (its own)"],
      ["skip", "Lumiverse's default connection"],
    ]);
    const read = only(stages.filter((s) => s.id === "read"));
    expect(read.rows.map((r) => [r.roles.join(","), r.how])).toEqual([
      ["knowledge,director,world", null],
      ["read", "one call, no tools"],
    ]);
    expect(stages.map((s) => s.id)).toEqual(["intent", "prepare", "beats", "review", "read", "memory_before"]);
    expect(only(stages.filter((s) => s.id === "review")).off).toBe("Off: the narrator gets the prompt as the engine made it");
    // On the fixed pipeline no stage has a mode.
    expect(stages.map((s) => s.mode)).toEqual(stages.map(() => null));
  });

  test("with a main agent deciding, the glance says how each stage runs; a role switched off has no row", () => {
    const main = agentsWith((a) => {
      a.pipeline.mode = "main";
      a.main.stages.prepare = "auto";
      a.roles.director.run = "off";
    });
    const stages = turnGlance(main, ROUTES, CONNECTIONS);
    expect(stages.map((s) => [s.id, s.mode])).toEqual([
      ["intent", "main"],
      ["prepare", "auto"],
      ["beats", "main"],
      ["review", null],
      ["read", "main"],
      ["memory", "main"],
    ]);
    // The director, switched off, works in no stage: the beats' only role, so nothing runs there.
    expect(only(stages.filter((s) => s.id === "prepare")).rows.map((r) => r.roles.join(","))).toEqual(["intent,scene,minds", "skip"]);
    expect(only(stages.filter((s) => s.id === "beats")).off).toBe("Nothing runs");
    // The memory left to the next turn follows the memory's mode.
    const before = turnGlance(agentsWith((a) => ((a.pipeline.mode = "main"), (a.pipeline.memory = "before_next"), (a.main.stages.memory = "auto")), main), ROUTES, CONNECTIONS);
    expect(only(before.filter((s) => s.id === "memory_before")).mode).toBe("auto");
    // Shown: each stage's mode in words, and what a stage on its own does.
    const glance = rendered(TurnGlance({ agents: main, routes: ROUTES, connections: CONNECTIONS, go }));
    const shown = texts(glance);
    expect(shown.filter((t) => t === "Runs on its own")).toHaveLength(1);
    expect(shown.filter((t) => t === "The main agent decides")).toHaveLength(4);
    expect(shown.some((t) => t.includes("a stage on its own runs its roles as the fixed pipeline does"))).toBe(true);
    expect(texts(rendered(TurnGlance({ agents: DEFAULTS, routes: ROUTES, connections: CONNECTIONS, go }))).some((t) => t === "Runs on its own" || t === "The main agent decides")).toBe(false);
  });

  test("a row per section, under today's names, each opening its page; at the defaults nothing says Changed", () => {
    const tree = hub(DEFAULTS);
    const rows = propsOf(tree, NavRow);
    expect(rows.map((r) => r.title)).toEqual(["Pipeline", "Review card", "System instructions", "Budgets", "Compaction", "Recording", "Throttles", "Caching", "Acceptance runs"]);
    expect(rows.map((r) => r.changed)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(texts(tree).filter((t) => /changed/i.test(t))).toEqual([]);
    expect(labels(tree)).toEqual([]);
    const budgetsRow = only(rows.filter((r) => r.title === "Budgets"));
    (budgetsRow.onOpen as () => void)();
    expect(went).toEqual({ page: "agents", sub: "budgets" });
    expect(agentsSummary(DEFAULTS)).toBe("A fixed pipeline");
  });

  test("changed, each row counts its own changes, and the glance's role opens its page", () => {
    const changed = agentsWith((a) => {
      a.pipeline.mode = "main";
      a.pipeline.memory = "before_next";
      // Smart persistence is Pipeline's: its switch and each of its limits count there.
      a.persist.on = true;
      a.persist.minutes = 45;
      a.budget.toolTurns = 4;
      // A connection's throttle is one row however many of its limits it sets.
      a.throttles = [{ id: "harbor", requestsPerMinute: 30, tokensPerMinute: "none", atOnce: 2 }];
      a.caching.on = false;
      a.stream = false;
      a.roles.intent.connectionId = "deepseek";
      // A role's run and a stage's mode count on their own pages.
      a.roles.minds.run = "always";
      a.main.stages.read = "auto";
    });
    const tree = hub(changed);
    expect(propsOf(tree, NavRow).map((r) => [r.title, r.changed])).toEqual([
      ["Pipeline", 4],
      ["Review card", 0],
      ["System instructions", 0],
      ["Budgets", 1],
      ["Compaction", 0],
      ["Recording", 0],
      ["Throttles", 1],
      ["Caching", 1],
      ["Acceptance runs", 0],
    ]);
    expect(only(propsOf(tree, NavRow).filter((r) => r.title === "Throttles")).subtitle).toBe("Harbor relay");
    // A role's own settings count on its own page, not the hub's.
    expect(agentsSummary(changed)).toBe("A main agent decides · 8 changed");
    const intent = propsOf(tree, "button").filter((b) => b.children === "Intent")[0] ?? {};
    click(intent);
    expect(went).toEqual({ page: "roles", sub: "intent" });
    expect(labels(tree)).toEqual(["Reset streaming agent calls to its default, on"]);
  });
});

describe("Settings → Agents: each section's page", () => {
  test("Pipeline, Review card and the call switches read their defaults and send each choice", () => {
    press(labelled(pipeline(DEFAULTS), Seg, "How an agent turn is run"), "main");
    expect(take()).toEqual({ agents: { pipeline: { mode: "main" } } });
    expect(labelled(pipeline(DEFAULTS), Seg, "How an agent turn is run").options).toEqual([
      { value: "fixed", label: "A fixed pipeline" },
      { value: "main", label: "A main agent decides" },
    ]);
    press(labelled(pipeline(DEFAULTS), Seg, "When the characters' memory runs"), "before_next");
    expect(take()).toEqual({ agents: { pipeline: { memory: "before_next" } } });
    const curator = labelled(pipeline(DEFAULTS), HostSwitch, "The Curator keeps the world's things and places");
    expect(curator.checked).toBe(true);
    press(curator, false);
    expect(take()).toEqual({ agents: { pipeline: { curator: false } } });
    // Smart persistence: off, with no limits shown, until switched on.
    const persist = labelled(pipeline(DEFAULTS), HostSwitch, "Smart persistence: keep a quiet scene's minds and notes");
    expect(persist.checked).toBe(false);
    expect(propsOf(pipeline(DEFAULTS), NumberStepper).map((p) => p.label)).toEqual([]);
    press(persist, true);
    expect(take()).toEqual({ agents: { persist: { on: true } } });
    const on = pipeline(agentsWith((a) => (a.persist.on = true)));
    expect(propsOf(on, NumberStepper).map((p) => [p.label, p.value])).toEqual([
      ["Turns kept in a row", 3],
      ["World minutes kept", 30],
    ]);
    press(labelled(on, NumberStepper, "Turns kept in a row"), 5);
    expect(take()).toEqual({ agents: { persist: { turns: 5 } } });
    press(labelled(on, NumberStepper, "World minutes kept"), 45);
    expect(take()).toEqual({ agents: { persist: { minutes: 45 } } });
    // Its help names what is never kept.
    expect(texts(pipeline(DEFAULTS)).some((t) => t.includes("Never kept: Intent, Knowledge, Read, Curator, Memory, Skip beats, World steps."))).toBe(true);
    // Off, a limit still changed shows, with its Default, as the hub's count says it is.
    const kept = pipeline(agentsWith((a) => (a.persist.minutes = 45)));
    expect(propsOf(kept, NumberStepper).map((p) => [p.label, p.value])).toEqual([
      ["Turns kept in a row", 3],
      ["World minutes kept", 45],
    ]);
    expect(labels(kept)).toEqual(["Reset World minutes kept to its default, 30"]);
    const placement = labelled(review(DEFAULTS), Seg, "Where an agent turn's changes that ask first wait");
    expect(placement.value).toBe("chips");
    press(placement, "gate");
    expect(take()).toEqual({ agents: { review: { placement: "gate" } } });
    press(labelled(calls(DEFAULTS), HostSwitch, "Stream every agent call's answer"), false);
    expect(take()).toEqual({ agents: { stream: false } });
    press(labelled(calls(DEFAULTS), HostSwitch, "Thinking in agent tool loops"), true);
    expect(take()).toEqual({ agents: { thinkingInToolLoops: true } });
  });

  test("the limits: each shows its value folded, sends a change, and a count never lifted has no switch", () => {
    const gm = rendered(budgets(DEFAULTS));
    expect(propsOf(gm, HostSwitch).filter((p) => String(p.label).startsWith("GM edits"))).toEqual([]);
    press(labelled(gm, NumberStepper, "GM edits per turn"), 4);
    expect(take()).toEqual({ agents: { gmOpsPerTurn: 4 } });
    const kept: [string, string, number][] = [
      ["runs", "Agent turns under way", 64],
      ["gates", "Turns waiting at a gate", 256],
      ["watchers", "Chats whose review cards are watched", 256],
      ["live", "Chats in the live view", 16],
      ["folds", "Messages kept worked out", 65_536],
    ];
    for (const [key, label, value] of kept) {
      const stepper = labelled(gm, NumberStepper, label);
      expect([stepper.value, stepper.min]).toEqual([value, 1]);
      press(stepper, 8);
      expect(take()).toEqual({ agents: { kept: { [key]: 8 } } });
    }
    press(labelled(gm, NumberStepper, "Tool rounds per agent"), 4);
    expect(take()).toEqual({ agents: { budget: { toolTurns: 4 } } });
    press(labelled(compaction(DEFAULTS), NumberStepper, "Compact the session past (tokens)"), 48_000);
    expect(take()).toEqual({ agents: { compaction: { atTokens: 48_000 } } });
    press(labelled(compaction(DEFAULTS), NumberStepper, "Recent turns kept whole"), 5);
    expect(take()).toEqual({ agents: { compaction: { keepTurns: 5 } } });
    press(labelled(compaction(DEFAULTS), HostSwitch, "The main agent's summarize tool"), false);
    expect(take()).toEqual({ agents: { compaction: { summarizeTool: false } } });
    press(labelled(recording(DEFAULTS), NumberStepper, "Narrator-facing output, each (characters)"), 1500);
    expect(take()).toEqual({ agents: { recording: { outputChars: 1500 } } });
    press(labelled(system(DEFAULTS), NumberStepper, "System instructions (tokens)"), 2000);
    expect(take()).toEqual({ agents: { systemTokens: 2000 } });
    const ratio = labelled(acceptance(DEFAULTS), NumberStepper, "Tokens against the steps engine (times)");
    expect(ratio.value).toBe(2);
    press(ratio, 1.5);
    expect(take()).toEqual({ agents: { vsClassic: 1.5 } });
    press(ratio, 0);
    expect(sent).toBeNull();
    // A folded limit shows its value.
    expect(texts(budgets(DEFAULTS))).toContain("10");
    expect(amountText(4000, "chars")).toBe("4,000 characters");
  });

  test("Default shows only while a value differs from its default, and sends null", () => {
    for (const page of SECTIONS) expect(labels(page(DEFAULTS)).filter((l) => String(l).startsWith("Reset"))).toEqual([]);
    const changed = agentsWith((a) => {
      a.pipeline = { mode: "main", memory: "before_next", curator: false };
      a.persist = { on: true, turns: 5, minutes: 45 };
      a.review.placement = "gate";
      a.compaction = { atTokens: 48_000, keepTurns: 5, summarizeTool: false };
      a.recording.outputChars = 1500;
      a.gmOpsPerTurn = 4;
      a.kept.gates = 16;
      a.vsClassic = 1.5;
      a.systemTokens = 2000;
      a.stream = false;
    });
    const resets: [(agents: AgentSettings) => unknown, string, JsonObject][] = [
      [pipeline, "Reset how a turn is run to its default, A fixed pipeline", { pipeline: { mode: null } }],
      [pipeline, "Reset when memory runs to its default, After the reply", { pipeline: { memory: null } }],
      [pipeline, "Reset the Curator to its default, on", { pipeline: { curator: null } }],
      [pipeline, "Reset Smart persistence to its default, off", { persist: { on: null } }],
      [pipeline, "Reset Turns kept in a row to its default, 3", { persist: { turns: null } }],
      [pipeline, "Reset World minutes kept to its default, 30", { persist: { minutes: null } }],
      [review, "Reset where changes that ask first wait to its default, On the review card after the reply", { review: { placement: null } }],
      [compaction, "Reset Compact the session past to its default, 32,000 tokens", { compaction: { atTokens: null } }],
      [compaction, "Reset Recent turns kept whole to its default, 3", { compaction: { keepTurns: null } }],
      [compaction, "Reset the summarize tool to its default, on", { compaction: { summarizeTool: null } }],
      [recording, "Reset Narrator-facing output, each to its default, 2,000 characters", { recording: { outputChars: null } }],
      [budgets, "Reset GM edits per turn to its default, 10", { gmOpsPerTurn: null }],
      [budgets, "Reset Turns waiting at a gate to its default, 256", { kept: { gates: null } }],
      [system, "Reset System instructions to its default, 8,000 tokens", { systemTokens: null }],
      [calls, "Reset streaming agent calls to its default, on", { stream: null }],
      [acceptance, "Reset Against the steps engine to its default, 2×", { vsClassic: null }],
    ];
    expect(SECTIONS.flatMap((page) => labels(page(changed)).filter((l) => String(l).startsWith("Reset")))).toEqual(resets.sort((a, b) => SECTIONS.indexOf(a[0] as never) - SECTIONS.indexOf(b[0] as never)).map(([, label]) => label));
    for (const [page, label, fields] of resets) {
      click(labelled(page(changed), Button, label));
      expect(take()).toEqual({ agents: fields });
    }
  });
});

describe("a role's page", () => {
  test("Runs on names each task's route: the step's while the role names none, else its own", () => {
    const steps = structuredClone(SETTINGS.modelUse.steps);
    steps.interpret = { ...stepConfigOf(steps, "interpret"), route: { provider: "helper", connectionId: "harbor", model: "harbor-large" } };
    const routes: RouteSettings = { modelUse: { steps }, helper: SETTINGS.helper };
    const tree = rolePage(DEFAULTS, "intent", routes);
    const shown = (t: unknown) => propsOf(t, "li").map((li) => texts(li.children));
    expect(shown(tree)).toEqual([
      ["Reading your message", "Harbor relay · harbor-large (from Steps)"],
      ["Judging your approach", "Lumiverse's default connection"],
      ["A puzzle's answer", "Lumiverse's default connection"],
    ]);
    // A step's connection without a model runs on that connection's own.
    steps.interpret = { ...stepConfigOf(steps, "interpret"), route: { provider: "helper", connectionId: "deepseek", model: null } };
    expect(shown(rolePage(DEFAULTS, "intent", { modelUse: { steps }, helper: SETTINGS.helper }))[0]).toEqual(["Reading your message", "Deepseek · deepseek-v4-flash (from Steps)"]);
    // The helper model's connection, for a task whose step names none.
    expect(shown(rolePage(DEFAULTS, "scene", { modelUse: SETTINGS.modelUse, helper: { ...SETTINGS.helper, connectionId: "harbor", model: null } }))).toEqual([["The scene's lore and notes", "Harbor relay (from Helper model)"]]);
    // The role's own, for every task.
    expect(shown(rolePage(agentsWith((a) => (a.roles.intent = { ...a.roles.intent, connectionId: "deepseek", model: "deepseek-v4-pro" })), "intent", routes)).map((r) => r[1])).toEqual(Array(3).fill("Deepseek · deepseek-v4-pro (its own)"));
  });

  test("each control sends the role's own patch, and the budget picker sets one limit of its own", () => {
    const tree = rolePage(DEFAULTS, "intent");
    press(only(propsOf(tree, ConnectionSelect)), "deepseek");
    expect(take()).toEqual({ agents: { roles: { intent: { connectionId: "deepseek", model: null } } } });
    press(labelled(rolePage(agentsWith((a) => (a.roles.intent.connectionId = "harbor")), "intent"), HostModelPicker, "Intent: model"), "deepseek-v4-flash");
    expect(take()).toEqual({ agents: { roles: { intent: { model: "deepseek-v4-flash" } } } });
    press(only(propsOf(tree, "select").filter((s) => s["aria-label"] === "Intent: reasoning effort")), { currentTarget: { value: "high" } });
    expect(take()).toEqual({ agents: { roles: { intent: { effort: "high" } } } });
    const chips = labelled(tree, ToggleChips, "Intent: tools");
    (chips.toggle as (f: string, on: boolean) => void)("lore", true);
    expect(take()).toEqual({ agents: { roles: { intent: { families: FAMILIES.filter((f) => f === "lore" || defaultRoleSettings().intent.families.includes(f)) } } } });
    // Organizations are a family of their own: Money off leaves them on.
    (chips.toggle as (f: string, on: boolean) => void)("money", false);
    expect(take()).toEqual({ agents: { roles: { intent: { families: ["people", "places", "items", "orgs", "time", "checks"] } } } });
    press(labelled(tree, Seg, "Intent: what it may change"), "gm");
    expect(take()).toEqual({ agents: { roles: { intent: { tier: "gm" } } } });
    press(labelled(tree, HostSwitch, "Intent: one call, no tools"), true);
    expect(take()).toEqual({ agents: { roles: { intent: { promptOnly: true } } } });
    press(labelled(tree, Seg, "Intent: when it fails"), "skip");
    expect(take()).toEqual({ agents: { roles: { intent: { onFail: "skip" } } } });
    press(labelled(tree, HostSwitch, "Caching for Intent"), false);
    expect(take()).toEqual({ agents: { caching: { roles: { intent: { on: false, nonce: "" } } } } });
    click(labelled(tree, Button, "Bust Intent's cache"));
    const bust = take() as { agents: { caching: { roles: { intent: { on: boolean; nonce: string } } } } };
    expect(bust.agents.caching.roles.intent.nonce).toMatch(/^[0-9a-f]{32}$/);
    // The budget shows only its own limits: none yet, and the picker offers every one.
    expect(propsOf(tree, NumberStepper).map((p) => p.label)).toEqual([]);
    const picker = only(propsOf(tree, "select").filter((s) => s["aria-label"] === "Intent: set a limit of its own"));
    press(picker, { currentTarget: { value: "toolTurns" } });
    expect(take()).toEqual({ agents: { roles: { intent: { budget: { toolTurns: 10 } } } } });
    // A limit followed as none starts at a common number.
    press(picker, { currentTarget: { value: "tokensIn" } });
    expect(take()).toEqual({ agents: { roles: { intent: { budget: { tokensIn: 100_000 } } } } });
    const own = rolePage(agentsWith((a) => (a.roles.intent.budget = { toolTurns: 4 })), "intent");
    press(labelled(own, NumberStepper, "Tool rounds per agent"), 3);
    expect(take()).toEqual({ agents: { roles: { intent: { budget: { toolTurns: 3 } } } } });
    click(labelled(own, Button, "Use every agent's tool rounds per agent, 10"));
    expect(take()).toEqual({ agents: { roles: { intent: { budget: { toolTurns: null } } } } });
    expect(propsOf(propsOf(own, "select").filter((s) => s["aria-label"] === "Intent: set a limit of its own"), "option").map((o) => o.value)).not.toContain("toolTurns");
    click(propsOf(tree, "button").filter((b) => b.class === "lre-set-link").at(-1) ?? {});
    expect(went).toEqual({ page: "agents", sub: "budgets" });
  });

  test("at its defaults a page says nothing changed and has no Default; changed, each setting's Default sends null and Reset puts the page back", () => {
    for (const id of ROLE_IDS) {
      expect(roleChanged(DEFAULTS, id)).toBe(0);
      const name = id === "scene" ? "Scene and lore" : id === "skip" ? "Skip beats" : id === "world" ? "World steps" : id.charAt(0).toUpperCase() + id.slice(1);
      // The Curator ships with tool rounds of its own, which its page can give back to every agent's.
      expect(labels(rolePage(DEFAULTS, id))).toEqual([...(id === "curator" ? ["Use every agent's tool rounds per agent, 10"] : []), `Bust ${name}'s cache`]);
    }
    const changed = agentsWith((a) => {
      a.roles.minds = { ...a.roles.minds, connectionId: "deepseek", effort: "low", tier: "read", promptOnly: true, onFail: "stop", run: "always" };
      a.context.roles.minds = { ...a.context.roles.minds, perspective: "gm", pins: ["notes/harbor.md"] };
    });
    const tree = rolePage(changed, "minds");
    expect(roleChanged(changed, "minds")).toBe(8);
    const resets: [string, JsonObject][] = [
      ["Reset Minds's connection and model to their default, each task on its step's", { agents: { roles: { minds: { connectionId: null, model: null } } } }],
      ["Reset Minds's effort to its default, Connection's own", { agents: { roles: { minds: { effort: null } } } }],
      ["Reset what Minds may change to its default, The story's changes", { agents: { roles: { minds: { tier: null } } } }],
      ["Reset Minds's perspective to its default, Its character's own", { agents: { context: { roles: { minds: { perspective: null } } } } }],
      ["Reset Minds's pinned files to none", { agents: { context: { roles: { minds: { pins: null } } } } }],
      ["Reset Minds's one call to its default, off", { agents: { roles: { minds: { promptOnly: null } } } }],
      ["Reset what Minds does when it fails to its default, Run its step's one call", { agents: { roles: { minds: { onFail: null } } } }],
      ["Reset when Minds runs to its default, When the turn asks", { agents: { roles: { minds: { run: null } } } }],
    ];
    for (const [label, body] of resets) {
      click(labelled(tree, Button, label));
      expect(take()).toEqual(body);
    }
    click(labelled(tree, Button, "Reset Minds to its shipped defaults"));
    expect(take()).toEqual(roleResetPatch("minds"));
    expect(roleResetPatch("minds")).toEqual({ agents: { roles: { minds: null }, context: { roles: { minds: null } }, caching: { roles: { minds: null } } } });
  });

  test("When it runs offers what the pipeline map lets the role take: minds and the scene may be kept or off, the director only off, the rest never skipped", () => {
    const runs = (id: RoleId) => propsOf(rolePage(DEFAULTS, id), Seg).find((p) => p.label === `${ROLE_LABEL[id]}: when it runs`);
    expect(runs("minds")?.options).toEqual([
      { value: "smart", label: "When the turn asks" },
      { value: "always", label: "Every time, never kept" },
      { value: "off", label: "Off" },
    ]);
    expect((runs("scene")?.options as unknown[]).length).toBe(3);
    expect(runs("director")?.options).toEqual([
      { value: "smart", label: "When the turn asks" },
      { value: "off", label: "Off" },
    ]);
    for (const id of ["intent", "knowledge", "read", "curator", "memory", "skip", "world"] as const) {
      expect(runs(id)).toBeUndefined();
      expect(texts(rolePage(DEFAULTS, id)).some((t) => t.includes("The engine never skips it."))).toBe(true);
    }
    press(runs("minds") ?? {}, "off");
    expect(take()).toEqual({ agents: { roles: { minds: { run: "off" } } } });
    press(runs("director") ?? {}, "off");
    expect(take()).toEqual({ agents: { roles: { director: { run: "off" } } } });
    // While persistence is off, a role it may keep says nothing is kept now; with a main agent deciding, its stages and how each runs.
    expect(texts(rolePage(DEFAULTS, "minds")).some((t) => t.includes("Smart persistence is off, so nothing is kept now"))).toBe(true);
    const main = rolePage(agentsWith((a) => ((a.pipeline.mode = "main"), (a.main.stages.prepare = "auto"))), "director");
    expect(texts(main).some((t) => t.includes("it works in Stage 3: scene, minds and decisions (runs on its own), Stage 5: the beats (the main agent decides), Stage 7: the read (the main agent decides)"))).toBe(true);
    (only(propsOf(main, NavRow).filter((r) => r.id === "stages")).onOpen as () => void)();
    expect(went).toEqual({ page: "main", at: "stages" });
  });

  test("the Curator's page has its ops per turn and its own shipped tool rounds, which aren't a change; Reset resets them with the role", () => {
    const tree = rolePage(DEFAULTS, "curator");
    const ops = labelled(tree, NumberStepper, "Curator ops per turn");
    expect([ops.value, ops.min]).toEqual([24, 0]);
    press(ops, 12);
    expect(take()).toEqual({ agents: { curatorOps: 12 } });
    expect(labelled(tree, NumberStepper, "Tool rounds per agent").value).toBe(CURATOR_TOOL_TURNS);
    expect(texts(tree).filter((t) => /changed/i.test(t))).toEqual([]);
    const own = agentsWith((a) => (a.curatorOps = 12));
    expect(roleChanged(own, "curator")).toBe(1);
    click(labelled(rolePage(own, "curator"), Button, "Reset Curator to its shipped defaults"));
    expect(take()).toEqual({ agents: { roles: { curator: null }, context: { roles: { curator: null } }, caching: { roles: { curator: null } }, curatorOps: null } });
    // Switched off in Pipeline, its page says so and links there.
    const off = rolePage(agentsWith((a) => (a.pipeline.curator = false)), "curator");
    const link = only(propsOf(off, NavRow).filter((r) => r.id === "pipeline"));
    expect(link.title).toBe("Off: the read does its work");
  });

  test("What it reads sends each field alone; the sources list each, and pins are typed one a line", () => {
    const tree = rolePage(DEFAULTS, "read");
    press(labelled(tree, Seg, "Read: the perspective it works from"), "gm");
    expect(take()).toEqual({ agents: { context: { roles: { read: { perspective: "gm" } } } } });
    press(labelled(tree, Seg, `Read: ${sourceLabel("lore_index")}`), "start");
    expect(take()).toEqual({ agents: { context: { roles: { read: { start: ["lore_index"], never: [] } } } } });
    expect(pinsOf("notes/a.md\n\n  notes/b.md \nnotes/a.md")).toEqual(["notes/a.md", "notes/b.md"]);
    const typed = only(propsOf(tree, "textarea")).onChange;
    if (typeof typed !== "function") throw new Error("the pins aren't a control");
    typed({ target: { value: "notes/harbor.md\n" } });
    expect(take()).toEqual({ agents: { context: { roles: { read: { pins: ["notes/harbor.md"] } } } } });
    // The director starts with the Scene and the Minds; the Curator with the Place, Gear and People, never the Minds.
    const director = rolePage(DEFAULTS, "director");
    expect(labelled(director, Seg, `Director: ${sourceLabel("scene")}`).value).toBe("start");
    const curator = rolePage(DEFAULTS, "curator");
    expect(labelled(curator, Seg, `Curator: ${sourceLabel("minds")}`).value).toBe("never");
  });
});

describe("Settings → Agents → Roles and Context", () => {
  test("Roles lists every role in commit order, then the main agent and the assistant, each opening its page", () => {
    const tree = rendered(RolesPage({ agents: DEFAULTS, timeouts: TIMEOUTS, routes: ROUTES, connections: CONNECTIONS, go }));
    const rows = propsOf(tree, NavRow);
    expect(rows.map((r) => r.id)).toEqual([...ROLE_IDS, "main", "assistant"]);
    expect(rows.slice(0, ROLE_IDS.length).map((r) => [r.subtitle, r.changed])).toEqual(ROLE_IDS.map(() => ["Lumiverse's default connection", 0]));
    (only(rows.filter((r) => r.id === "director")).onOpen as () => void)();
    expect(went).toEqual({ page: "roles", sub: "director" });
    expect(rolesSummary(DEFAULTS)).toBe(`${ROLE_IDS.length} roles, each on its defaults`);
    const changed = agentsWith((a) => {
      a.roles.read.promptOnly = true;
      a.roles.knowledge.onFail = "skip";
      a.roles.minds.connectionId = "deepseek";
      a.pipeline.curator = false;
    });
    const lines = Object.fromEntries(propsOf(rendered(RolesPage({ agents: changed, timeouts: TIMEOUTS, routes: ROUTES, connections: CONNECTIONS, go })), NavRow).map((r) => [r.id, r.subtitle]));
    expect([lines.read, lines.knowledge, lines.minds, lines.curator]).toEqual(["Lumiverse's default connection · one call, no tools", "Lumiverse's default connection · on a failure: go on without it", "Deepseek · deepseek-v4-flash (its own)", "Off: the read does its work"]);
    expect(rolesSummary(changed)).toBe(`${ROLE_IDS.length} roles · 3 changed`);
  });

  test("Context is an overview: each role's perspective and what it starts with, each row opening its page at What it reads", () => {
    const rows = propsOf(rendered(ContextPage({ agents: DEFAULTS, go })), NavRow);
    expect(rows.map((r) => r.id)).toEqual([...ROLE_IDS]);
    expect(only(rows.filter((r) => r.id === "curator")).subtitle).toBe("The GM's · starts with People, Gear, Place · never Minds");
    expect(only(rows.filter((r) => r.id === "intent")).subtitle).toBe("Your character's · its task alone");
    (only(rows.filter((r) => r.id === "read")).onOpen as () => void)();
    expect(went).toEqual({ page: "context", sub: "read", at: "reads" });
    expect(contextSummary(DEFAULTS)).toBe(`2 of ${ROLE_IDS.length} roles start with sections`);
    const changed = agentsWith((a) => (a.context.roles.read = { perspective: "gm", start: ["lore_index"], never: [], pins: [] }));
    expect(only(propsOf(rendered(ContextPage({ agents: changed, go })), NavRow).filter((r) => r.id === "read")).changed).toBe(2);
    expect(contextSummary(changed)).toBe(`3 of ${ROLE_IDS.length} roles start with sections · 1 changed`);
  });
});

describe("Settings → Agents → Main agent", () => {
  test("its home line isn't off while the final review runs, on either pipeline", () => {
    expect(mainSummary(DEFAULTS, CONNECTIONS)).toBe("Lumiverse's default connection · reviews the narrator's prompt");
    expect(mainSummary(agentsWith((a) => (a.finalReview.on = false)), CONNECTIONS)).toBe("Lumiverse's default connection · not used: a fixed pipeline, no final review");
    expect(mainSummary(agentsWith((a) => ((a.pipeline.mode = "main"), (a.main.connectionId = "deepseek"))), CONNECTIONS)).toBe("Deepseek · deepseek-v4-flash · decides each turn and reviews the narrator's prompt");
  });

  test("reads the shipped defaults and sends each change under agents.main, the review's under agents.finalReview", () => {
    const tree = mainPage(DEFAULTS);
    press(only(propsOf(tree, ConnectionSelect)), "deepseek");
    expect(take()).toEqual(mainPatch({ connectionId: "deepseek", model: null }));
    press(only(propsOf(tree, "select").filter((s) => s["aria-label"] === "The main agent: reasoning effort")), { currentTarget: { value: "medium" } });
    expect(take()).toEqual(mainPatch({ effort: "medium" }));
    expect(labelled(tree, ToggleChips, "The main agent: tools").on).toEqual(["workspace"]);
    press(labelled(tree, NumberStepper, "Turn digest (tokens)"), 3000);
    expect(take()).toEqual(mainPatch({ digestTokens: 3000 }));
    press(labelled(tree, HostSwitch, "The main agent reviews the narrator's prompt before each reply"), false);
    expect(take()).toEqual({ agents: { finalReview: { on: false } } });
    press(labelled(tree, Seg, "What a final review that fails does"), "stop");
    expect(take()).toEqual({ agents: { finalReview: { onFail: "stop" } } });
    // What the review is sent: every part, or only what changed.
    const scope = labelled(tree, Seg, "What the final review is sent");
    expect([scope.value, scope.options]).toEqual(["all", [{ value: "all", label: "Every part" }, { value: "changed", label: "Only what changed" }]]);
    press(scope, "changed");
    expect(take()).toEqual({ agents: { finalReview: { scope: "changed" } } });
    // Each stage: the main agent decides it, or its roles run on their own.
    const prepare = labelled(tree, Seg, "Stage 3: scene, minds and decisions: how it runs");
    expect([prepare.value, prepare.options]).toEqual(["main", [{ value: "main", label: "The main agent decides" }, { value: "auto", label: "Runs on its own" }]]);
    press(prepare, "auto");
    expect(take()).toEqual(mainPatch({ stages: { prepare: "auto" } }));
    expect(propsOf(tree, Seg).filter((p) => String(p.label).endsWith(": how it runs")).map((p) => p.label)).toEqual(["Stage 1: the intent: how it runs", "Stage 3: scene, minds and decisions: how it runs", "Stage 5: the beats: how it runs", "Stage 7: the read: how it runs", "Stage 8: the memory: how it runs"]);
    // Its pickers offer no limit only a turn role takes.
    const pickers = propsOf(tree, "select").filter((s) => String(s["aria-label"]).endsWith("set a limit of its own"));
    expect(pickers.map((p) => p["aria-label"])).toEqual(["The final review: set a limit of its own", "The main agent: set a limit of its own"]);
    for (const p of pickers) expect(propsOf(p.children, "option").map((o) => o.value)).not.toContain("reruns");
    press(only(pickers.filter((p) => p["aria-label"] === "The main agent: set a limit of its own")), { currentTarget: { value: "revisions" } });
    expect(take()).toEqual(mainPatch({ budget: { revisions: 2 } }));
    expect(labels(tree)).toEqual(["Bust the main agent's cache"]);
    const changed = agentsWith((a) => (a.main = { ...a.main, connectionId: "deepseek", effort: "high", families: ["people"] }));
    expect(labels(mainPage(changed))).toEqual(["Reset the main agent's connection and model to their default, Lumiverse's default connection", "Reset the main agent's effort to its default, Connection's own", "Reset the main agent's tools to their default, Workspace", "Bust the main agent's cache", "Reset the main agent to its defaults"]);
    // A stage on its own and the review's scope count, each with its Default.
    const staged = agentsWith((a) => ((a.main.stages.prepare = "auto"), (a.main.stages.memory = "auto"), (a.finalReview.scope = "changed")));
    expect(mainChanged(staged, TIMEOUTS)).toBe(3);
    click(labelled(mainPage(staged), Button, "Reset stage 3: scene, minds and decisions to its default, The main agent decides"));
    expect(take()).toEqual(mainPatch({ stages: { prepare: null } }));
    click(labelled(mainPage(staged), Button, "Reset what the final review is sent to its default, Every part"));
    expect(take()).toEqual({ agents: { finalReview: { scope: null } } });
  });
});

describe("the agents' settings in the settings store", () => {
  test("what the pages send reads back, and every Default and Reset reads back the shipped defaults", async () => {
    const rig = new Rig();
    const read = async (): Promise<AgentSettings> => (await rig.rt.settings.get(rig.host.userId)).agents;
    const save = async (): Promise<AgentSettings> => {
      rig.body(await rig.send({ type: "lre.settings.set", patch: take() }));
      return read();
    };
    let agents = await read();
    expect(agents).toEqual(DEFAULTS);
    press(labelled(pipeline(agents), Seg, "How an agent turn is run"), "main");
    agents = await save();
    press(labelled(budgets(agents), NumberStepper, "Turns waiting at a gate"), 16);
    agents = await save();
    press(labelled(acceptance(agents), NumberStepper, "Tokens against the steps engine (times)"), 1.5);
    agents = await save();
    // Smart persistence, switched on and a limit raised.
    press(labelled(pipeline(agents), HostSwitch, "Smart persistence: keep a quiet scene's minds and notes"), true);
    agents = await save();
    press(labelled(pipeline(agents), NumberStepper, "World minutes kept"), 45);
    agents = await save();
    expect(agents.persist).toEqual({ on: true, turns: 3, minutes: 45 });
    // A role, across its page.
    press(only(propsOf(rolePage(agents, "director"), "select").filter((s) => s["aria-label"] === "Director: reasoning effort")), { currentTarget: { value: "high" } });
    agents = await save();
    press(labelled(rolePage(agents, "director"), Seg, "Director: what it may change"), "gm");
    agents = await save();
    press(only(propsOf(rolePage(agents, "director"), "select").filter((s) => s["aria-label"] === "Director: set a limit of its own")), { currentTarget: { value: "toolTurns" } });
    agents = await save();
    press(labelled(rolePage(agents, "director"), Seg, "Director: the perspective it works from"), "gm");
    agents = await save();
    press(labelled(rolePage(agents, "director"), HostSwitch, "Caching for Director"), false);
    agents = await save();
    press(labelled(rolePage(agents, "director"), Seg, "Director: when it runs"), "off");
    agents = await save();
    expect(agents.roles.director).toEqual({ ...defaultRoleSettings().director, effort: "high", tier: "gm", run: "off", budget: { toolTurns: 10 } });
    expect(agents.context.roles.director.perspective).toBe("gm");
    expect(agents.caching.roles.director).toEqual({ on: false, nonce: "" });
    for (const id of ROLE_IDS.filter((r) => r !== "director")) expect(agents.roles[id]).toEqual(defaultRoleSettings()[id]);
    // The main agent and its final review.
    press(labelled(mainPage(agents), NumberStepper, "Pinned files, per role (tokens)"), 1000);
    agents = await save();
    press(labelled(mainPage(agents), HostSwitch, "The main agent reviews the narrator's prompt before each reply"), false);
    agents = await save();
    press(labelled(mainPage(agents), Seg, "Stage 3: scene, minds and decisions: how it runs"), "auto");
    agents = await save();
    press(labelled(mainPage(agents), Seg, "What the final review is sent"), "changed");
    agents = await save();
    expect([agents.main.pinsTokens, agents.finalReview.on, agents.main.stages, agents.finalReview.scope]).toEqual([1000, false, { ...DEFAULTS.main.stages, prepare: "auto" }, "changed"]);
    // Every Default on the sections, then each page's Reset.
    for (const page of SECTIONS) {
      for (const label of labels(page(agents)).filter((l) => String(l).startsWith("Reset"))) {
        click(labelled(page(agents), Button, String(label)));
        agents = await save();
      }
    }
    click(labelled(rolePage(agents, "director"), Button, "Reset Director to its shipped defaults"));
    agents = await save();
    click(labelled(mainPage(agents), Button, "Reset the main agent to its defaults"));
    rig.body(await rig.send({ type: "lre.settings.set", patch: take() }));
    agents = await read();
    expect(agents).toEqual(DEFAULTS);
    expect((await rig.rt.settings.get(rig.host.userId)).timeouts.finalReviewMs).toBe(TIMEOUTS.finalReviewMs);
    expect(agents.context).toEqual(defaultContextSettings());
    expect(mainResetPatch()).toEqual({ agents: { main: null, finalReview: null, caching: { roles: { main: null } } }, timeouts: { finalReviewMs: null } });
  });
});
