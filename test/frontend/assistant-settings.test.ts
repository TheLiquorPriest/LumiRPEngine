// Settings → Agents → Assistant (INC1-SPEC C8, R6b): each control's patch under `agents.assistant`;
// Default (and a budget limit's Every agent's) sends null and shows only while a value differs from
// its default; what the page sends lands in the real settings store and reads back, and a reset reads
// back the default (every agent's limit for the budget); and Settings home's line for the page.

import { describe, expect, test } from "bun:test";
import { LimitRow } from "../../src/frontend/settings/agents";
import { AssistantLimitRow, AssistantSettingsBody, assistantBudgetPatch, assistantPatch, assistantSummary } from "../../src/frontend/settings/assistant";
import { type Connection, ConnectionSelect } from "../../src/frontend/settings/steps";
import { Button, HostModelPicker, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import type { AgentBudget, AgentSettings, AssistantSettings } from "../../src/shared/agent-settings";
import { AGENT_EFFORTS, assistantBudget, BUDGET_DEFS, defaultAgentSettings } from "../../src/shared/agent-settings";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";
import { expand, labelled, press, propsOf, type Props } from "../support/tree";

const CONNECTIONS: Connection[] = [
  { id: "deepseek", name: "Deepseek", model: "deepseek-v4-flash" },
  { id: "harbor", name: "Harbor relay", model: null },
];

const DEFAULTS = defaultAgentSettings();
const BUDGET_KEYS = Object.keys(BUDGET_DEFS) as (keyof AgentBudget)[];

const KNOWLEDGE_SEG = "Whose knowledge the assistant reads";
const APPLY_SEG = "How the assistant's changes land";

/** Agent settings with some of the assistant's own. */
function withAssistant(own: Partial<AssistantSettings>, agents: AgentSettings = DEFAULTS): AgentSettings {
  return { ...agents, assistant: { ...agents.assistant, ...own } };
}

let sent: JsonObject | null = null;

/** The page for `agents`; what its controls send waits for `take`. */
function page(agents: AgentSettings): unknown {
  return AssistantSettingsBody({ agents, connections: CONNECTIONS, busy: false, patch: (p) => void (sent = p) });
}

/** The patch the last control pressed sent. */
function take(): JsonObject {
  const patch = sent;
  sent = null;
  if (!patch) throw new Error("nothing sent");
  return patch;
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

/** The History tokens row, laid out. */
function historyRow(tree: unknown): unknown {
  return expand({ type: LimitRow, props: only(propsOf(tree, LimitRow)) });
}

/** One budget limit's row, laid out. */
function budgetRow(tree: unknown, key: keyof AgentBudget): unknown {
  return expand({ type: AssistantLimitRow, props: only(propsOf(tree, AssistantLimitRow).filter((p) => p.id === key)) });
}

const labels = (node: unknown): unknown[] => propsOf(node, Button).map((p) => p.label);

describe("Settings → Agents → Assistant patches", () => {
  test("the connection sends itself with the model cleared, and the model picker shows only once a connection is chosen", () => {
    const plain = page(DEFAULTS);
    const connection = only(propsOf(plain, ConnectionSelect));
    expect([connection.value, connection.firstLabel]).toEqual([null, "None: Lumiverse's default connection"]);
    expect(propsOf(plain, HostModelPicker)).toEqual([]);
    press(connection, "deepseek");
    expect(take()).toEqual({ agents: { assistant: { connectionId: "deepseek", model: null } } });
    press(connection, null);
    expect(take()).toEqual({ agents: { assistant: { connectionId: null, model: null } } });

    const picker = labelled(page(withAssistant({ connectionId: "harbor" })), HostModelPicker, "Model");
    expect([picker.connectionId, picker.value]).toEqual(["harbor", ""]);
    press(picker, "deepseek-v4-flash");
    expect(take()).toEqual({ agents: { assistant: { model: "deepseek-v4-flash" } } });
    // Empty uses the connection's own model.
    press(picker, "");
    expect(take()).toEqual({ agents: { assistant: { model: null } } });
  });

  test("effort lists every level in the page's words and sends the one picked", () => {
    const tree = page(DEFAULTS);
    const select = only(propsOf(tree, "select"));
    expect(select.value).toBe("inherit");
    expect(propsOf(tree, "option").map((p) => [p.value, p.children])).toEqual([
      ["off", "Off"],
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
      ["model", "Set by the model"],
      ["inherit", "Connection's own"],
    ]);
    for (const effort of AGENT_EFFORTS) {
      press(select, { currentTarget: { value: effort } });
      expect(take()).toEqual({ agents: { assistant: { effort } } });
    }
    // A value that isn't a level sends nothing.
    press(select, { currentTarget: { value: "max" } });
    expect(sent).toBeNull();
  });

  test("knowledge offers each choice with its label and sends it", () => {
    const seg = labelled(page(DEFAULTS), Seg, KNOWLEDGE_SEG);
    expect(seg.value).toBe("everyone");
    expect(seg.options).toEqual([
      { value: "pov", label: "Your character's" },
      { value: "everyone", label: "Everyone's, secrets marked" },
      { value: "gm", label: "The GM's" },
    ]);
    for (const knowledge of ["pov", "everyone", "gm"]) {
      press(seg, knowledge);
      expect(take()).toEqual({ agents: { assistant: { knowledge } } });
    }
  });

  test("how changes land offers ask and at once and sends the one picked", () => {
    const seg = labelled(page(DEFAULTS), Seg, APPLY_SEG);
    expect(seg.value).toBe("ask");
    expect(seg.options).toEqual([
      { value: "ask", label: "Each waits for your Apply" },
      { value: "at_once", label: "At once, with an Undo chip" },
    ]);
    press(seg, "at_once");
    expect(take()).toEqual({ agents: { assistant: { apply: "at_once" } } });
    press(seg, "ask");
    expect(take()).toEqual({ agents: { assistant: { apply: "ask" } } });
  });

  test("history tokens is a number of tokens, never No limit", () => {
    const row = historyRow(page(DEFAULTS));
    expect(propsOf(row, HostSwitch)).toEqual([]);
    const stepper = labelled(row, NumberStepper, "History tokens (tokens)");
    expect(stepper.value).toBe(20_000);
    press(stepper, 8000);
    expect(take()).toEqual({ agents: { assistant: { historyTokens: 8000 } } });
  });

  test("each budget limit follows every agent's until set as the assistant's own, No limit only where it may be lifted", () => {
    const tree = page(DEFAULTS);
    expect(propsOf(tree, AssistantLimitRow).map((p) => [p.id, p.own, p.every])).toEqual(BUDGET_KEYS.map((key) => [key, undefined, DEFAULTS.budget[key]]));

    const rounds = budgetRow(tree, "toolTurns");
    const stepper = labelled(rounds, NumberStepper, "Tool rounds per agent");
    expect(stepper.value).toBe(10);
    press(stepper, 4);
    expect(take()).toEqual({ agents: { assistant: { budget: { toolTurns: 4 } } } });
    press(labelled(rounds, HostSwitch, "Tool rounds per agent: no limit"), true);
    expect(take()).toEqual(assistantBudgetPatch("toolTurns", "none"));

    // A limit that can't be lifted has no switch.
    const answer = budgetRow(tree, "callTokensOut");
    expect(propsOf(answer, HostSwitch)).toEqual([]);
    press(labelled(answer, NumberStepper, "Answer per call (tokens)"), 2048);
    expect(take()).toEqual({ agents: { assistant: { budget: { callTokensOut: 2048 } } } });

    // Time is set in seconds and saved in milliseconds; turning No limit off starts from the least it takes.
    const time = budgetRow(tree, "wallMs");
    const lifted = labelled(time, HostSwitch, "Time per agent: no limit");
    expect(lifted.checked).toBe(true);
    expect(propsOf(time, NumberStepper)).toEqual([]);
    press(lifted, false);
    expect(take()).toEqual({ agents: { assistant: { budget: { wallMs: 1000 } } } });
    press(labelled(budgetRow(page(withAssistant({ budget: { wallMs: 90_000 } })), "wallMs"), NumberStepper, "Time per agent (seconds)"), 120);
    expect(take()).toEqual({ agents: { assistant: { budget: { wallMs: 120_000 } } } });
  });

  test("Default shows only while a value differs from its default, and sends null", () => {
    const plain = page(DEFAULTS);
    expect(labels(plain)).toEqual([]);
    expect(labels(historyRow(plain))).toEqual([]);
    for (const key of BUDGET_KEYS) expect(labels(budgetRow(plain, key))).toEqual([]);

    // One setting changed shows its Default alone.
    expect(labels(page(withAssistant({ effort: "high" })))).toEqual(["Reset reasoning effort to its default, Connection's own"]);
    expect(labels(page(withAssistant({ model: "deepseek-v4-flash" })))).toEqual(["Reset the connection and model to their default, Lumiverse's default connection"]);

    const changed = page(withAssistant({ connectionId: "deepseek", model: "deepseek-v4-flash", effort: "off", knowledge: "gm", apply: "at_once", historyTokens: 8000, budget: { toolTurns: 4 } }));
    expect(labels(changed)).toEqual([
      "Reset the connection and model to their default, Lumiverse's default connection",
      "Reset reasoning effort to its default, Connection's own",
      "Reset whose knowledge it reads to its default, Everyone's, secrets marked",
      "Reset how its changes land to its default, Each waits for your Apply",
    ]);
    const resets: [string, JsonObject][] = [
      ["Reset the connection and model to their default, Lumiverse's default connection", { connectionId: null, model: null }],
      ["Reset reasoning effort to its default, Connection's own", { effort: null }],
      ["Reset whose knowledge it reads to its default, Everyone's, secrets marked", { knowledge: null }],
      ["Reset how its changes land to its default, Each waits for your Apply", { apply: null }],
    ];
    for (const [label, fields] of resets) {
      click(labelled(changed, Button, label));
      expect(take()).toEqual(assistantPatch(fields));
    }
    click(labelled(historyRow(changed), Button, "Reset History tokens to its default, 20,000 tokens"));
    expect(take()).toEqual({ agents: { assistant: { historyTokens: null } } });
    // A limit of its own goes back to every agent's, even set to the same number.
    click(labelled(budgetRow(changed, "toolTurns"), Button, "Use every agent's tool rounds per agent, 10"));
    expect(take()).toEqual({ agents: { assistant: { budget: { toolTurns: null } } } });
    expect(labels(budgetRow(page(withAssistant({ budget: { toolTurns: 10 } })), "toolTurns"))).toEqual(["Use every agent's tool rounds per agent, 10"]);
    for (const key of BUDGET_KEYS.filter((k) => k !== "toolTurns")) expect(labels(budgetRow(changed, key))).toEqual([]);
  });
});

describe("Settings → Agents → Assistant in the settings store", () => {
  test("what the page sends reads back, and each reset reads back the default, every agent's limit for the budget", async () => {
    const rig = new Rig();
    const read = async (): Promise<AgentSettings> => (await rig.rt.settings.get(rig.host.userId)).agents;
    const save = async (patch: JsonObject): Promise<AgentSettings> => {
      rig.body(await rig.send({ type: "lre.settings.set", patch }));
      return read();
    };
    let agents = await read();
    expect(agents.assistant).toEqual(DEFAULTS.assistant);

    press(only(propsOf(page(agents), ConnectionSelect)), "deepseek");
    agents = await save(take());
    press(labelled(page(agents), HostModelPicker, "Model"), "deepseek-v4-flash");
    agents = await save(take());
    press(only(propsOf(page(agents), "select")), { currentTarget: { value: "high" } });
    agents = await save(take());
    press(labelled(page(agents), Seg, KNOWLEDGE_SEG), "pov");
    agents = await save(take());
    press(labelled(page(agents), Seg, APPLY_SEG), "at_once");
    agents = await save(take());
    press(labelled(historyRow(page(agents)), NumberStepper, "History tokens (tokens)"), 8000);
    agents = await save(take());
    press(labelled(budgetRow(page(agents), "toolTurns"), NumberStepper, "Tool rounds per agent"), 4);
    agents = await save(take());
    expect(agents.assistant.budget).toEqual({ toolTurns: 4 });
    press(labelled(budgetRow(page(agents), "toolTurns"), HostSwitch, "Tool rounds per agent: no limit"), true);
    agents = await save(take());
    press(labelled(budgetRow(page(agents), "callTokensOut"), NumberStepper, "Answer per call (tokens)"), 2048);
    agents = await save(take());

    expect(agents.assistant).toEqual({ connectionId: "deepseek", model: "deepseek-v4-flash", effort: "high", knowledge: "pov", apply: "at_once", historyTokens: 8000, budget: { toolTurns: "none", callTokensOut: 2048 } });
    expect(assistantBudget(agents)).toEqual({ ...DEFAULTS.budget, toolTurns: "none", callTokensOut: 2048 });
    expect(agents.budget).toEqual(DEFAULTS.budget);
    // The page shows what was saved.
    const shown = page(agents);
    expect(only(propsOf(shown, ConnectionSelect)).value).toBe("deepseek");
    expect(labelled(shown, HostModelPicker, "Model").value).toBe("deepseek-v4-flash");
    expect([only(propsOf(shown, "select")).value, labelled(shown, Seg, KNOWLEDGE_SEG).value, labelled(shown, Seg, APPLY_SEG).value]).toEqual(["high", "pov", "at_once"]);
    expect(propsOf(shown, AssistantLimitRow).filter((p) => p.own !== undefined).map((p) => [p.id, p.own])).toEqual([
      ["callTokensOut", 2048],
      ["toolTurns", "none"],
    ]);

    // Every Default and Every agent's, pressed on the page as it stands.
    for (const label of labels(page(agents))) {
      click(labelled(page(agents), Button, String(label)));
      agents = await save(take());
    }
    click(labelled(historyRow(page(agents)), Button, "Reset History tokens to its default, 20,000 tokens"));
    agents = await save(take());
    for (const key of ["toolTurns", "callTokensOut"] as const) {
      click(only(propsOf(budgetRow(page(agents), key), Button)));
      agents = await save(take());
    }
    expect(agents.assistant).toEqual(DEFAULTS.assistant);
    expect(assistantBudget(agents)).toEqual(agents.budget);
    expect(labels(page(agents))).toEqual([]);

    // Following every agent's again, it takes up a change made there.
    agents = await save({ agents: { budget: { toolTurns: 7 } } });
    expect(assistantBudget(agents).toolTurns).toBe(7);
    expect(labelled(budgetRow(page(agents), "toolTurns"), NumberStepper, "Tool rounds per agent").value).toBe(7);
  });
});

describe("Settings home's line for the Assistant page", () => {
  test("says where it runs, whose knowledge it reads and how its changes land", () => {
    expect(assistantSummary(DEFAULTS.assistant, CONNECTIONS)).toBe("Lumiverse's default connection · knowledge: everyone's, secrets marked · changes: each waits for your Apply");
    expect(assistantSummary(withAssistant({ connectionId: "deepseek" }).assistant, CONNECTIONS)).toBe("Deepseek · deepseek-v4-flash · knowledge: everyone's, secrets marked · changes: each waits for your Apply");
    expect(assistantSummary(withAssistant({ connectionId: "harbor", model: "deepseek-v4-flash", knowledge: "gm", apply: "at_once" }).assistant, CONNECTIONS)).toBe("Harbor relay · deepseek-v4-flash · knowledge: the GM's · changes: at once, with an Undo chip");
    // Before the connections come, or once Lumiverse no longer has it: its id.
    expect(assistantSummary(withAssistant({ connectionId: "harbor", knowledge: "pov" }).assistant, [])).toBe("harbor · knowledge: your character's · changes: each waits for your Apply");
  });
});
