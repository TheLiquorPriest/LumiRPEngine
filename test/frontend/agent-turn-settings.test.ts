// Settings → Agents for agent turns (INC2-SPEC C12, lane T4): the Agents page's Pipeline, Review card, System instructions,
// Budgets (GM edits per turn, and what the engine keeps in memory), Compaction, Recording and the classic comparison ratio under Acceptance
// runs; Settings → Agents → Roles, each role's settings with its Default; and Settings → Agents → Main
// agent. Each group reads the shipped defaults and sends its change as a merge patch; each Default
// shows only while a value differs and sends null; and what the pages send lands in the real settings
// store and reads back, every Default reading back the shipped defaults. The pages are walked as
// rendered trees (no DOM), as the Assistant page's tests do.

import { describe, expect, test } from "bun:test";
import { AcceptanceSection, AgentTurnSettings, amountText, BudgetGroup, BudgetsSection, LimitRow, OwnLimitRow, SystemInstructionsSection } from "../../src/frontend/settings/agents";
import { MainAgentBody, mainPatch, mainSummary } from "../../src/frontend/settings/main-agent";
import { FAMILIES, RoleCard, RolesBody, roleResetPatch, rolesSummary } from "../../src/frontend/settings/roles";
import { ContextBody, ContextCard, contextSummary, pinsOf } from "../../src/frontend/settings/context";
import { type Connection, ConnectionSelect } from "../../src/frontend/settings/steps";
import { Button, HostModelPicker, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import { defaultRoleSettings, ROLE_IDS, ROLE_LABEL, type RoleId } from "../../src/shared/agent-roles";
import { defaultContextSettings, sourceLabel } from "../../src/shared/agent-context";
import type { AgentSettings } from "../../src/shared/agent-settings";
import { defaultAgentSettings } from "../../src/shared/agent-settings";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";
import { expand, labelled, press, propsOf, type Props } from "../support/tree";

const CONNECTIONS: Connection[] = [
  { id: "deepseek", name: "Deepseek", model: "deepseek-v4-flash" },
  { id: "harbor", name: "Harbor relay", model: null },
];

const DEFAULTS = defaultAgentSettings();

let sent: JsonObject | null = null;
const patch = (p: JsonObject): void => void (sent = p);

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

const labels = (node: unknown): unknown[] => propsOf(node, Button).map((p) => p.label);

/** Agent settings with `change` made to a copy of `from`. */
function agentsWith(change: (a: AgentSettings) => void, from: AgentSettings = DEFAULTS): AgentSettings {
  const a = structuredClone(from);
  change(a);
  return a;
}

const turnPage = (agents: AgentSettings) => AgentTurnSettings({ agents, patch, busy: false });
const budgets = (agents: AgentSettings) => BudgetsSection({ agents, patch, busy: false });
const acceptance = (agents: AgentSettings) => AcceptanceSection({ acceptance: agents.acceptance, vsClassic: agents.vsClassic, connections: CONNECTIONS, patch, busy: false });

/** The one LimitRow for `id` in `tree`, laid out; inside a BudgetGroup, that group laid out first. */
function limitRow(tree: unknown, id: string): unknown {
  const direct = propsOf(tree, LimitRow).filter((p) => p.id === id);
  const grouped = propsOf(tree, BudgetGroup).flatMap((g) => propsOf(expand({ type: BudgetGroup, props: g }), LimitRow).filter((p) => p.id === id));
  return expand({ type: LimitRow, props: only([...direct, ...grouped]) });
}

/** The Budgets rows of what the engine keeps in memory, counted, by setting. */
const KEPT_IDS = ["runs", "gates", "watchers", "live", "folds"] as const;

/** Every Default on the agent-turn parts of the Agents page, rows included. */
function agentsPageDefaults(agents: AgentSettings): unknown[] {
  const turn = turnPage(agents);
  return [...labels(turn), ...labels(limitRow(turn, "atTokens")), ...labels(limitRow(turn, "keepTurns")), ...labels(limitRow(turn, "outputChars")), ...labels(limitRow(budgets(agents), "gmOpsPerTurn")), ...KEPT_IDS.flatMap((id) => labels(limitRow(budgets(agents), id))), ...labels(acceptance(agents)).filter((l) => typeof l === "string" && l.startsWith("Reset Against"))];
}

describe("Settings → Agents: how an agent turn runs", () => {
  test("Pipeline reads its defaults and sends the mode and memory placement picked", () => {
    const tree = turnPage(DEFAULTS);
    const mode = labelled(tree, Seg, "How an agent turn is run");
    expect(mode.value).toBe("fixed");
    expect(mode.options).toEqual([
      { value: "fixed", label: "A fixed pipeline, in classic's order" },
      { value: "main", label: "A main agent decides" },
    ]);
    press(mode, "main");
    expect(take()).toEqual({ agents: { pipeline: { mode: "main" } } });
    const memory = labelled(tree, Seg, "When the minds' memory runs");
    expect(memory.value).toBe("after_reply");
    press(memory, "before_next");
    expect(take()).toEqual({ agents: { pipeline: { memory: "before_next" } } });
  });

  test("Review placement reads chips and sends gate", () => {
    const seg = labelled(turnPage(DEFAULTS), Seg, "Where an agent turn's changes that ask first wait");
    expect(seg.value).toBe("chips");
    expect(seg.options).toEqual([
      { value: "chips", label: "On the review card after the reply" },
      { value: "gate", label: "On the review card before the reply" },
    ]);
    press(seg, "gate");
    expect(take()).toEqual({ agents: { review: { placement: "gate" } } });
  });

  test("Budgets has GM edits per turn, 10 by default, a count never lifted", () => {
    const row = limitRow(budgets(DEFAULTS), "gmOpsPerTurn");
    expect(propsOf(row, HostSwitch)).toEqual([]);
    const stepper = labelled(row, NumberStepper, "GM edits per turn");
    expect(stepper.value).toBe(10);
    press(stepper, 4);
    expect(take()).toEqual({ agents: { gmOpsPerTurn: 4 } });
  });

  test("Budgets keeps in memory 64 agent turns under way, 256 waiting at a gate, 256 watched chats, 16 chats in the live view and 65,536 messages worked out by default: counts of at least 1, never lifted", () => {
    const shown: Record<(typeof KEPT_IDS)[number], [string, number]> = { runs: ["Agent turns under way", 64], gates: ["Turns waiting at a gate", 256], watchers: ["Chats whose review cards are watched", 256], live: ["Chats in the live view", 16], folds: ["Messages kept worked out", 65_536] };
    for (const id of KEPT_IDS) {
      const row = limitRow(budgets(DEFAULTS), id);
      expect(propsOf(row, HostSwitch)).toEqual([]);
      const [label, value] = shown[id];
      const stepper = labelled(row, NumberStepper, label);
      expect([stepper.value, stepper.min]).toEqual([value, 1]);
      press(stepper, 8);
      expect(take()).toEqual({ agents: { kept: { [id]: 8 } } });
    }
  });

  test("Compaction reads 32,000 tokens, 3 turns and the summarize tool on, and sends each", () => {
    const tree = turnPage(DEFAULTS);
    const at = labelled(limitRow(tree, "atTokens"), NumberStepper, "Compact the session past (tokens)");
    expect(at.value).toBe(32_000);
    press(at, 48_000);
    expect(take()).toEqual({ agents: { compaction: { atTokens: 48_000 } } });
    const keep = labelled(limitRow(tree, "keepTurns"), NumberStepper, "Recent turns kept whole");
    expect(keep.value).toBe(3);
    press(keep, 5);
    expect(take()).toEqual({ agents: { compaction: { keepTurns: 5 } } });
    const tool = labelled(tree, HostSwitch, "The main agent's summarize tool");
    expect(tool.checked).toBe(true);
    press(tool, false);
    expect(take()).toEqual({ agents: { compaction: { summarizeTool: false } } });
  });

  test("Recording reads 2,000 characters and sends a change", () => {
    const stepper = labelled(limitRow(turnPage(DEFAULTS), "outputChars"), NumberStepper, "Narrator-facing output, each (characters)");
    expect(stepper.value).toBe(2000);
    press(stepper, 1500);
    expect(take()).toEqual({ agents: { recording: { outputChars: 1500 } } });
  });

  test("Acceptance runs has the classic comparison ratio, 2× by default; any amount above 0", () => {
    const stepper = labelled(acceptance(DEFAULTS), NumberStepper, "Tokens against classic (times)");
    expect(stepper.value).toBe(2);
    press(stepper, 1.5);
    expect(take()).toEqual({ agents: { vsClassic: 1.5 } });
    press(stepper, 0);
    expect(sent).toBeNull();
  });

  test("Default shows only while a value differs from its default, and sends null", () => {
    expect(agentsPageDefaults(DEFAULTS)).toEqual([]);
    const changed = agentsWith((a) => {
      a.pipeline = { mode: "main", memory: "before_next" };
      a.review.placement = "gate";
      a.compaction = { atTokens: 48_000, keepTurns: 5, summarizeTool: false };
      a.recording.outputChars = 1500;
      a.gmOpsPerTurn = 4;
      a.kept = { runs: 8, gates: 16, watchers: 32, live: 4, texts: 1_000_000, folds: 1000 };
      a.vsClassic = 1.5;
    });
    const resets: [unknown, string, JsonObject][] = [
      [turnPage(changed), "Reset how a turn is run to its default, A fixed pipeline, in classic's order", { pipeline: { mode: null } }],
      [turnPage(changed), "Reset when memory runs to its default, After the reply", { pipeline: { memory: null } }],
      [turnPage(changed), "Reset where changes that ask first wait to its default, On the review card after the reply", { review: { placement: null } }],
      [turnPage(changed), "Reset the summarize tool to its default, on", { compaction: { summarizeTool: null } }],
      [limitRow(turnPage(changed), "atTokens"), "Reset Compact the session past to its default, 32,000 tokens", { compaction: { atTokens: null } }],
      [limitRow(turnPage(changed), "keepTurns"), "Reset Recent turns kept whole to its default, 3", { compaction: { keepTurns: null } }],
      [limitRow(turnPage(changed), "outputChars"), "Reset Narrator-facing output, each to its default, 2,000 characters", { recording: { outputChars: null } }],
      [limitRow(budgets(changed), "gmOpsPerTurn"), "Reset GM edits per turn to its default, 10", { gmOpsPerTurn: null }],
      [limitRow(budgets(changed), "runs"), "Reset Agent turns under way to its default, 64", { kept: { runs: null } }],
      [limitRow(budgets(changed), "gates"), "Reset Turns waiting at a gate to its default, 256", { kept: { gates: null } }],
      [limitRow(budgets(changed), "watchers"), "Reset Chats whose review cards are watched to its default, 256", { kept: { watchers: null } }],
      [limitRow(budgets(changed), "live"), "Reset Chats in the live view to its default, 16", { kept: { live: null } }],
      [limitRow(budgets(changed), "folds"), "Reset Messages kept worked out to its default, 65,536", { kept: { folds: null } }],
      [acceptance(changed), "Reset Against classic to its default, 2×", { vsClassic: null }],
    ];
    expect(agentsPageDefaults(changed)).toEqual(resets.map(([, label]) => label));
    for (const [tree, label, fields] of resets) {
      click(labelled(tree, Button, label));
      expect(take()).toEqual({ agents: fields });
    }
  });
});

/** The Roles page's card for `id`, laid out. */
function roleCard(agents: AgentSettings, id: RoleId): unknown {
  const tree = RolesBody({ agents, connections: CONNECTIONS, patch, busy: false });
  return expand({ type: RoleCard, props: only(propsOf(tree, RoleCard).filter((p) => p.id === id)) });
}

/** One of a card's own budget limits, laid out. */
function ownRow(tree: unknown, key: string): unknown {
  return expand({ type: OwnLimitRow, props: only(propsOf(tree, OwnLimitRow).filter((p) => p.id === key)) });
}

describe("Settings → Agents → Roles", () => {
  test("lists every role in §5's order, each showing its shipped defaults", () => {
    const tree = RolesBody({ agents: DEFAULTS, connections: CONNECTIONS, patch, busy: false });
    expect(propsOf(tree, RoleCard).map((p) => p.id)).toEqual([...ROLE_IDS]);
    const shipped = defaultRoleSettings();
    for (const id of ROLE_IDS) {
      const card = roleCard(DEFAULTS, id);
      const label = String(propsOf(card, Seg)[0]?.label).split(":")[0];
      expect(labelled(card, Seg, `${label}: what it may change`).value).toBe(shipped[id].tier);
      expect(labelled(card, Seg, `${label}: when it fails`).value).toBe(shipped[id].onFail);
      expect(labelled(card, HostSwitch, `${label}: prompt-only`).checked).toBe(false);
      expect(propsOf(card, HostSwitch).filter((p) => String(p.label).startsWith(`${label}: `) && p.label !== `${label}: prompt-only` && p.checked === true).length).toBe(shipped[id].families.length);
      expect(only(propsOf(card, "select")).value).toBe("inherit");
      expect(only(propsOf(card, ConnectionSelect)).value).toBeNull();
      expect(labels(card)).toEqual([`Bust ${label}'s cache`]);
    }
    expect(rolesSummary(DEFAULTS)).toBe("9 roles, each on its shipped defaults");
  });

  test("each control sends the role's own patch", () => {
    const card = roleCard(DEFAULTS, "intent");
    press(only(propsOf(card, ConnectionSelect)), "deepseek");
    expect(take()).toEqual({ agents: { roles: { intent: { connectionId: "deepseek", model: null } } } });
    press(labelled(roleCard(agentsWith((a) => (a.roles.intent.connectionId = "harbor")), "intent"), HostModelPicker, "Intent: model"), "deepseek-v4-flash");
    expect(take()).toEqual({ agents: { roles: { intent: { model: "deepseek-v4-flash" } } } });
    press(only(propsOf(card, "select")), { currentTarget: { value: "high" } });
    expect(take()).toEqual({ agents: { roles: { intent: { effort: "high" } } } });
    press(labelled(card, HostSwitch, "Intent: Lore"), true);
    expect(take()).toEqual({ agents: { roles: { intent: { families: FAMILIES.filter((f) => f === "lore" || defaultRoleSettings().intent.families.includes(f)) } } } });
    press(labelled(card, HostSwitch, "Intent: Money"), false);
    expect(take()).toEqual({ agents: { roles: { intent: { families: ["people", "places", "items", "time", "checks"] } } } });
    press(labelled(card, Seg, "Intent: what it may change"), "gm");
    expect(take()).toEqual({ agents: { roles: { intent: { tier: "gm" } } } });
    press(labelled(card, HostSwitch, "Intent: prompt-only"), true);
    expect(take()).toEqual({ agents: { roles: { intent: { promptOnly: true } } } });
    press(labelled(card, Seg, "Intent: when it fails"), "skip");
    expect(take()).toEqual({ agents: { roles: { intent: { onFail: "skip" } } } });
    press(labelled(card, HostSwitch, "Caching for Intent"), false);
    expect(take()).toEqual({ agents: { caching: { roles: { intent: { on: false, nonce: "" } } } } });
    click(labelled(card, Button, "Bust Intent's cache"));
    const bust = take() as { agents: { caching: { roles: { intent: { on: boolean; nonce: string } } } } };
    expect(bust.agents.caching.roles.intent.on).toBe(true);
    expect(bust.agents.caching.roles.intent.nonce).toMatch(/^[0-9a-f]{32}$/);
    const rounds = ownRow(card, "toolTurns");
    press(labelled(rounds, NumberStepper, "Tool rounds per agent"), 4);
    expect(take()).toEqual({ agents: { roles: { intent: { budget: { toolTurns: 4 } } } } });
    // A limit of its own goes back to every agent's.
    click(labelled(ownRow(roleCard(agentsWith((a) => (a.roles.intent.budget = { toolTurns: 4 })), "intent"), "toolTurns"), Button, "Use every agent's tool rounds per agent, 10"));
    expect(take()).toEqual({ agents: { roles: { intent: { budget: { toolTurns: null } } } } });
  });

  test("Default shows once a role has settings of its own, and sends null for the role and its own caching", () => {
    expect(labels(roleCard(DEFAULTS, "minds"))).toEqual(["Bust Minds's cache"]);
    const own = agentsWith((a) => (a.roles.minds.effort = "low"));
    expect(labels(roleCard(own, "minds"))).toEqual(["Reset Minds to its shipped defaults", "Bust Minds's cache"]);
    // Only that role's card shows it.
    expect(labels(roleCard(own, "intent"))).toEqual(["Bust Intent's cache"]);
    expect(rolesSummary(own)).toBe("9 roles · 1 with settings of its own");
    // Caching of its own is settings of its own too.
    expect(labels(roleCard(agentsWith((a) => (a.caching.roles.minds = { on: false, nonce: "" })), "minds"))).toContain("Reset Minds to its shipped defaults");
    click(labelled(roleCard(own, "minds"), Button, "Reset Minds to its shipped defaults"));
    expect(take()).toEqual(roleResetPatch("minds"));
    expect(roleResetPatch("minds")).toEqual({ agents: { roles: { minds: null }, caching: { roles: { minds: null } } } });
  });
});

const mainPage = (agents: AgentSettings) => MainAgentBody({ agents, connections: CONNECTIONS, patch, busy: false });

describe("Settings → Agents → Main agent", () => {
  test("reads the shipped defaults and sends each change under agents.main", () => {
    const tree = mainPage(DEFAULTS);
    expect(only(propsOf(tree, ConnectionSelect)).value).toBeNull();
    press(only(propsOf(tree, ConnectionSelect)), "deepseek");
    expect(take()).toEqual(mainPatch({ connectionId: "deepseek", model: null }));
    expect(only(propsOf(tree, "select")).value).toBe("inherit");
    press(only(propsOf(tree, "select")), { currentTarget: { value: "medium" } });
    expect(take()).toEqual({ agents: { main: { effort: "medium" } } });
    expect(propsOf(tree, HostSwitch).filter((p) => p.checked === true).map((p) => p.label)).toEqual(["Main agent: Workspace"]);
    press(labelled(tree, HostSwitch, "Main agent: People"), true);
    expect(take()).toEqual({ agents: { main: { families: ["people", "workspace"] } } });
    const digest = labelled(limitRow(tree, "digestTokens"), NumberStepper, "Turn digest (tokens)");
    expect(digest.value).toBe(2000);
    press(digest, 3000);
    expect(take()).toEqual({ agents: { main: { digestTokens: 3000 } } });
    const pins = labelled(limitRow(tree, "pinsTokens"), NumberStepper, "Pinned files, per role (tokens)");
    expect(pins.value).toBe(2000);
    press(pins, 1000);
    expect(take()).toEqual({ agents: { main: { pinsTokens: 1000 } } });
    press(labelled(ownRow(tree, "revisions"), NumberStepper, "Revisions per agent"), 1);
    expect(take()).toEqual({ agents: { main: { budget: { revisions: 1 } } } });
    expect(mainSummary(DEFAULTS, CONNECTIONS)).toBe("Lumiverse's default connection · off: a fixed pipeline, in classic's order");
    expect(mainSummary(agentsWith((a) => ((a.pipeline.mode = "main"), (a.main.connectionId = "deepseek"))), CONNECTIONS)).toBe("Deepseek · deepseek-v4-flash · deciding each agent turn");
  });

  test("Default shows only while a value differs, and sends null", () => {
    expect(labels(mainPage(DEFAULTS))).toEqual([]);
    const changed = agentsWith((a) => (a.main = { ...a.main, connectionId: "deepseek", effort: "high", families: ["people"], digestTokens: 3000 }));
    const resets: [string, JsonObject][] = [
      ["Reset the main agent's connection and model to their default, Lumiverse's default connection", { connectionId: null, model: null }],
      ["Reset the main agent's effort to its default, Connection's own", { effort: null }],
      ["Reset the main agent's tools to their default, Workspace", { families: null }],
    ];
    expect(labels(mainPage(changed))).toEqual(resets.map(([label]) => label));
    for (const [label, fields] of resets) {
      click(labelled(mainPage(changed), Button, label));
      expect(take()).toEqual(mainPatch(fields));
    }
    click(labelled(limitRow(mainPage(changed), "digestTokens"), Button, "Reset Turn digest to its default, 2,000 tokens"));
    expect(take()).toEqual(mainPatch({ digestTokens: null }));
  });
});

describe("the agent-turn settings in the settings store", () => {
  test("what the pages send reads back, and every Default reads back the shipped defaults", async () => {
    const rig = new Rig();
    const read = async (): Promise<AgentSettings> => (await rig.rt.settings.get(rig.host.userId)).agents;
    const save = async (): Promise<AgentSettings> => {
      rig.body(await rig.send({ type: "lre.settings.set", patch: take() }));
      return read();
    };
    let agents = await read();
    expect(agents).toEqual(DEFAULTS);

    // The Agents page.
    press(labelled(turnPage(agents), Seg, "How an agent turn is run"), "main");
    agents = await save();
    press(labelled(turnPage(agents), Seg, "When the minds' memory runs"), "before_next");
    agents = await save();
    press(labelled(turnPage(agents), Seg, "Where an agent turn's changes that ask first wait"), "gate");
    agents = await save();
    press(labelled(limitRow(turnPage(agents), "atTokens"), NumberStepper, "Compact the session past (tokens)"), 48_000);
    agents = await save();
    press(labelled(limitRow(turnPage(agents), "keepTurns"), NumberStepper, "Recent turns kept whole"), 5);
    agents = await save();
    press(labelled(turnPage(agents), HostSwitch, "The main agent's summarize tool"), false);
    agents = await save();
    press(labelled(limitRow(turnPage(agents), "outputChars"), NumberStepper, "Narrator-facing output, each (characters)"), 1500);
    agents = await save();
    press(labelled(limitRow(budgets(agents), "gmOpsPerTurn"), NumberStepper, "GM edits per turn"), 4);
    agents = await save();
    press(labelled(limitRow(budgets(agents), "gates"), NumberStepper, "Turns waiting at a gate"), 16);
    agents = await save();
    press(labelled(acceptance(agents), NumberStepper, "Tokens against classic (times)"), 1.5);
    agents = await save();
    expect({ pipeline: agents.pipeline, review: agents.review, compaction: agents.compaction, recording: agents.recording, gmOpsPerTurn: agents.gmOpsPerTurn, kept: agents.kept, vsClassic: agents.vsClassic }).toEqual({
      pipeline: { mode: "main", memory: "before_next" },
      review: { placement: "gate" },
      compaction: { atTokens: 48_000, keepTurns: 5, summarizeTool: false },
      recording: { outputChars: 1500 },
      gmOpsPerTurn: 4,
      kept: { runs: 64, gates: 16, watchers: 256, live: 16, texts: 4_000_000, folds: 65_536 },
      vsClassic: 1.5,
    });

    // A role.
    press(only(propsOf(roleCard(agents, "director"), "select")), { currentTarget: { value: "high" } });
    agents = await save();
    press(labelled(roleCard(agents, "director"), HostSwitch, "Director: Lore"), true);
    agents = await save();
    press(labelled(roleCard(agents, "director"), Seg, "Director: what it may change"), "gm");
    agents = await save();
    press(labelled(roleCard(agents, "director"), HostSwitch, "Caching for Director"), false);
    agents = await save();
    press(labelled(ownRow(roleCard(agents, "director"), "toolTurns"), NumberStepper, "Tool rounds per agent"), 3);
    agents = await save();
    expect(agents.roles.director).toEqual({ ...defaultRoleSettings().director, effort: "high", families: FAMILIES.filter((f) => f === "lore" || defaultRoleSettings().director.families.includes(f)), tier: "gm", budget: { toolTurns: 3 } });
    expect(agents.caching.roles.director).toEqual({ on: false, nonce: "" });
    // Every other role kept its defaults.
    for (const id of ROLE_IDS.filter((r) => r !== "director")) expect(agents.roles[id]).toEqual(defaultRoleSettings()[id]);

    // The main agent.
    press(labelled(limitRow(mainPage(agents), "pinsTokens"), NumberStepper, "Pinned files, per role (tokens)"), 1000);
    agents = await save();
    expect(agents.main).toEqual({ ...DEFAULTS.main, pinsTokens: 1000 });

    // Every Default, pressed on the pages as they stand.
    for (const label of agentsPageDefaults(agents)) {
      const tree = [turnPage(agents), limitRow(turnPage(agents), "atTokens"), limitRow(turnPage(agents), "keepTurns"), limitRow(turnPage(agents), "outputChars"), limitRow(budgets(agents), "gmOpsPerTurn"), ...KEPT_IDS.map((id) => limitRow(budgets(agents), id)), acceptance(agents)].find((t) => labels(t).includes(label));
      click(labelled(tree, Button, String(label)));
      agents = await save();
    }
    click(labelled(roleCard(agents, "director"), Button, "Reset Director to its shipped defaults"));
    agents = await save();
    for (const label of labels(mainPage(agents))) {
      click(labelled(mainPage(agents), Button, String(label)));
      agents = await save();
    }
    click(labelled(limitRow(mainPage(agents), "pinsTokens"), Button, "Reset Pinned files, per role to its default, 2,000 tokens"));
    agents = await save();
    expect(agents).toEqual(DEFAULTS);
    expect(agentsPageDefaults(agents)).toEqual([]);
  });
});

describe("Settings → Agents → System instructions", () => {
  test("says what the system files are, reads 8,000 tokens, sends a change and its Default, and the store keeps it", async () => {
    const page = (agents: AgentSettings) => SystemInstructionsSection({ agents, patch, busy: false });
    const tree = page(DEFAULTS);
    const lead = propsOf(tree, "p").map((p) => p.children).join("");
    expect(lead).toContain("AGENTS.md");
    expect(lead).toContain("roles/<role>.md");
    expect(lead).toContain("global workspace's (~/) first, then this chat's");
    const row = limitRow(tree, "systemTokens");
    expect(propsOf(row, HostSwitch)).toEqual([]);
    const stepper = labelled(row, NumberStepper, "System instructions (tokens)");
    expect(stepper.value).toBe(8000);
    expect(labels(row)).toEqual([]);
    const rig = new Rig();
    press(stepper, 2000);
    rig.body(await rig.send({ type: "lre.settings.set", patch: take() }));
    const agents = (await rig.rt.settings.get(rig.host.userId)).agents;
    expect(agents.systemTokens).toBe(2000);
    click(labelled(limitRow(page(agents), "systemTokens"), Button, "Reset System instructions to its default, 8,000 tokens"));
    expect(sent).toEqual({ agents: { systemTokens: null } });
    rig.body(await rig.send({ type: "lre.settings.set", patch: take() }));
    expect((await rig.rt.settings.get(rig.host.userId)).agents.systemTokens).toBe(8000);
  });
});

describe("a limit as the page says it", () => {
  test("counts its unit as one or as many", () => {
    expect([amountText(1, "tokens"), amountText(100_000, "tokens"), amountText(1, "chars"), amountText(4000, "chars"), amountText(1, "count"), amountText("none", "tokens")]).toEqual(["1 token", "100,000 tokens", "1 character", "4,000 characters", "1", "No limit"]);
  });
});

/** One role's card on Settings → Agents → Context, laid out. */
function contextCard(agents: AgentSettings, id: RoleId): unknown {
  return expand({ type: ContextCard, props: only(propsOf(ContextBody({ agents, patch, busy: false }), ContextCard).filter((p) => p.id === id)) });
}

describe("Settings → Agents → Context", () => {
  test("lists every role in §5's order on its defaults: the director starts with the Scene and the Minds, every other role with its task alone", () => {
    expect(propsOf(ContextBody({ agents: DEFAULTS, patch, busy: false }), ContextCard).map((p) => p.id)).toEqual([...ROLE_IDS]);
    const shipped = defaultContextSettings().roles;
    for (const id of ROLE_IDS) {
      const card = contextCard(DEFAULTS, id);
      const label = ROLE_LABEL[id];
      expect(labelled(card, Seg, `${label}: the perspective it works from`).value).toBe(shipped[id].perspective);
      expect(labelled(card, Seg, `${label}: ${sourceLabel("scene")}`).value).toBe(id === "director" ? "start" : "ask");
      expect(labelled(card, Seg, `${label}: ${sourceLabel("minds")}`).value).toBe(id === "director" ? "start" : "ask");
      expect(labels(card)).toEqual([]);
    }
    expect(contextSummary(DEFAULTS)).toBe(`1 of ${ROLE_IDS.length} roles start with sections`);
  });

  test("each control sends that role's field alone, and Default sends null for the role; what it sends lands in the settings store", async () => {
    const rig = new Rig();
    const save = async (): Promise<AgentSettings> => {
      rig.body(await rig.send({ type: "lre.settings.set", patch: take() }));
      return (await rig.rt.settings.get(rig.host.userId)).agents;
    };
    let agents = DEFAULTS;
    press(labelled(contextCard(agents, "read"), Seg, "Read: the perspective it works from"), "gm");
    expect(sent).toEqual({ agents: { context: { roles: { read: { perspective: "gm" } } } } });
    agents = await save();
    press(labelled(contextCard(agents, "read"), Seg, `Read: ${sourceLabel("lore_index")}`), "start");
    expect(sent).toEqual({ agents: { context: { roles: { read: { start: ["lore_index"], never: [] } } } } });
    agents = await save();
    press(labelled(contextCard(agents, "read"), Seg, `Read: ${sourceLabel("money")}`), "never");
    agents = await save();
    expect(pinsOf("notes/a.md\n\n  notes/b.md \nnotes/a.md")).toEqual(["notes/a.md", "notes/b.md"]);
    const typed = only(propsOf(contextCard(agents, "read"), "textarea")).onChange;
    if (typeof typed !== "function") throw new Error("the pins aren't a control");
    typed({ target: { value: "notes/harbor.md\n" } });
    expect(sent).toEqual({ agents: { context: { roles: { read: { pins: ["notes/harbor.md"] } } } } });
    agents = await save();
    expect(agents.context.roles.read).toEqual({ perspective: "gm", start: ["lore_index"], never: ["money"], pins: ["notes/harbor.md"] });
    expect(agents.context.roles.director).toEqual(defaultContextSettings().roles.director);
    expect(contextSummary(agents)).toBe(`2 of ${ROLE_IDS.length} roles start with sections · 1 changed`);
    click(labelled(contextCard(agents, "read"), Button, "Reset the Read role's context to its defaults"));
    expect(sent).toEqual({ agents: { context: { roles: { read: null } } } });
    agents = await save();
    expect(agents.context).toEqual(defaultContextSettings());
  });
});
