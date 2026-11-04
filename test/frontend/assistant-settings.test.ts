// Settings → Agents → Assistant (INC1-SPEC C8, R6b), on the agent page's template: each control's
// patch under `agents.assistant`; Default (and a budget limit's Every agent's) sends null and shows
// only while a value differs from its default; the budget shows only its own limits, with a picker
// that sets one more (never a limit only a turn role takes); what the page sends lands in the real
// settings store and reads back, and a reset reads back the default (every agent's limit for the
// budget); and Settings home's line for the page. The assistant works out of world, so the page offers
// no choice of whose knowledge it reads.

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import type { SettingsRoute } from "../../src/frontend/app";
import { Button, HostModelPicker, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import { AssistantPage, assistantBudgetPatch, assistantPatch, assistantSummary } from "../../src/frontend/settings/assistant";
import { type Connection, ConnectionSelect } from "../../src/frontend/settings/steps";
import type { AgentSettings, AssistantSettings } from "../../src/shared/agent-settings";
import { AGENT_EFFORTS, agentSettingsOf, assistantBudget, defaultAgentSettings } from "../../src/shared/agent-settings";
import { hasOwn, type JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";
import { rendered } from "../support/settings-tree";
import { labelled, press, propsOf, type Props } from "../support/tree";

const CONNECTIONS: Connection[] = [
  { id: "deepseek", name: "Deepseek", model: "deepseek-v4-flash" },
  { id: "harbor", name: "Harbor relay", model: null },
];

const DEFAULTS = defaultAgentSettings();
const PROMPTS = defaultSettings().prompts;

const APPLY_SEG = "How the assistant's changes land";
const EFFORT = "The assistant: reasoning effort";
const PICKER = "The assistant: set a limit of its own";

/** Agent settings with some of the assistant's own. */
function withAssistant(own: Partial<AssistantSettings>, agents: AgentSettings = DEFAULTS): AgentSettings {
  return { ...agents, assistant: { ...agents.assistant, ...own } };
}

let sent: JsonObject | null = null;
let went: SettingsRoute | null = null;

/** The page for `agents`, rendered down to its controls; what they send waits for `take`. */
function page(agents: AgentSettings): unknown {
  return rendered(AssistantPage({ agents, prompts: PROMPTS, connections: CONNECTIONS, busy: false, patch: (p) => void (sent = p), go: (r) => void (went = r) }));
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

/** The one select named `label`. */
const select = (tree: unknown, label: string): Props => only(propsOf(tree, "select").filter((s) => s["aria-label"] === label));

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
    const picker = labelled(page(withAssistant({ connectionId: "harbor" })), HostModelPicker, "The assistant: model");
    expect([picker.connectionId, picker.value]).toEqual(["harbor", ""]);
    press(picker, "deepseek-v4-flash");
    expect(take()).toEqual({ agents: { assistant: { model: "deepseek-v4-flash" } } });
    // Empty uses the connection's own model.
    press(picker, "");
    expect(take()).toEqual({ agents: { assistant: { model: null } } });
  });

  test("effort lists every level in the page's words and sends the one picked", () => {
    const tree = page(DEFAULTS);
    const effort = select(tree, EFFORT);
    expect(effort.value).toBe("inherit");
    expect(propsOf(effort.children, "option").map((p) => [p.value, p.children])).toEqual([
      ["off", "Off"],
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
      ["model", "Set by the model"],
      ["inherit", "Connection's own"],
    ]);
    for (const level of AGENT_EFFORTS) {
      press(effort, { currentTarget: { value: level } });
      expect(take()).toEqual({ agents: { assistant: { effort: level } } });
    }
    // A value that isn't a level sends nothing.
    press(effort, { currentTarget: { value: "max" } });
    expect(sent).toBeNull();
  });

  test("offers no choice of whose knowledge it reads: it works out of world, and an earlier build's stored choice reads as none", () => {
    expect(propsOf(page(DEFAULTS), Seg).map((p) => p.label)).toEqual([APPLY_SEG]);
    expect(hasOwn(DEFAULTS.assistant, "knowledge")).toBe(false);
    expect(agentSettingsOf({ assistant: { knowledge: "pov", apply: "at_once" } }).assistant).toEqual({ ...DEFAULTS.assistant, apply: "at_once" });
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
  });

  test("history tokens is a number of tokens, never No limit", () => {
    const tree = page(DEFAULTS);
    expect(propsOf(tree, HostSwitch).map((p) => p.label)).not.toContain("History tokens: no limit");
    const stepper = labelled(tree, NumberStepper, "History tokens (tokens)");
    expect(stepper.value).toBe(20_000);
    press(stepper, 8000);
    expect(take()).toEqual({ agents: { assistant: { historyTokens: 8000 } } });
  });

  test("the budget shows only its own limits; the picker sets one at every agent's, and offers none only a turn role takes", () => {
    const tree = page(DEFAULTS);
    expect(propsOf(tree, NumberStepper).map((p) => p.label)).toEqual(["History tokens (tokens)"]);
    const offered = propsOf(select(tree, PICKER).children, "option").map((o) => o.value);
    expect(offered).toContain("toolTurns");
    expect(offered).not.toContain("reruns");
    press(select(tree, PICKER), { currentTarget: { value: "toolTurns" } });
    expect(take()).toEqual({ agents: { assistant: { budget: { toolTurns: 10 } } } });
    const own = page(withAssistant({ budget: { toolTurns: 4, callTokensOut: 2048, wallMs: "none" } }));
    press(labelled(own, NumberStepper, "Tool rounds per agent"), 3);
    expect(take()).toEqual({ agents: { assistant: { budget: { toolTurns: 3 } } } });
    press(labelled(own, HostSwitch, "Tool rounds per agent: no limit"), true);
    expect(take()).toEqual(assistantBudgetPatch("toolTurns", "none"));
    // A limit that can't be lifted has no switch.
    expect(propsOf(own, HostSwitch).map((p) => p.label)).not.toContain("Answer per call: no limit");
    press(labelled(own, NumberStepper, "Answer per call (tokens)"), 1024);
    expect(take()).toEqual({ agents: { assistant: { budget: { callTokensOut: 1024 } } } });
    // Time is set in seconds and saved in milliseconds; turning No limit off starts from the least it takes.
    const lifted = labelled(own, HostSwitch, "Time per agent: no limit");
    expect(lifted.checked).toBe(true);
    press(lifted, false);
    expect(take()).toEqual({ agents: { assistant: { budget: { wallMs: 1000 } } } });
    press(labelled(page(withAssistant({ budget: { wallMs: 90_000 } })), NumberStepper, "Time per agent (seconds)"), 120);
    expect(take()).toEqual({ agents: { assistant: { budget: { wallMs: 120_000 } } } });
    click(only(propsOf(page(DEFAULTS), "button").filter((b) => b.class === "lre-set-link")));
    expect(went).toEqual({ page: "agents", sub: "budgets" });
  });

  test("Default shows only while a value differs from its default, and sends null", () => {
    expect(labels(page(DEFAULTS))).toEqual(["Bust the assistant's cache"]);
    expect(labels(page(withAssistant({ effort: "high" })))).toEqual(["Reset the assistant's effort to its default, Connection's own", "Bust the assistant's cache", "Reset the assistant to its defaults"]);
    const changed = page(withAssistant({ connectionId: "deepseek", model: "deepseek-v4-flash", effort: "off", apply: "at_once", historyTokens: 8000, budget: { toolTurns: 4 } }));
    const resets: [string, JsonObject][] = [
      ["Reset the assistant's connection and model to their default, Lumiverse's default connection", assistantPatch({ connectionId: null, model: null })],
      ["Reset the assistant's effort to its default, Connection's own", assistantPatch({ effort: null })],
      ["Reset how its changes land to its default, Each waits for your Apply", assistantPatch({ apply: null })],
      ["Reset History tokens to its default, 20,000 tokens", assistantPatch({ historyTokens: null })],
      ["Use every agent's tool rounds per agent, 10", assistantBudgetPatch("toolTurns", null)],
      ["Reset the assistant to its defaults", { agents: { assistant: null, caching: { roles: { assistant: null } } } }],
    ];
    for (const [label, body] of resets) {
      click(labelled(changed, Button, label));
      expect(take()).toEqual(body);
    }
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
    press(labelled(page(agents), HostModelPicker, "The assistant: model"), "deepseek-v4-flash");
    agents = await save(take());
    press(select(page(agents), EFFORT), { currentTarget: { value: "high" } });
    agents = await save(take());
    press(labelled(page(agents), Seg, APPLY_SEG), "at_once");
    agents = await save(take());
    press(labelled(page(agents), NumberStepper, "History tokens (tokens)"), 8000);
    agents = await save(take());
    press(select(page(agents), PICKER), { currentTarget: { value: "toolTurns" } });
    agents = await save(take());
    press(labelled(page(agents), HostSwitch, "Tool rounds per agent: no limit"), true);
    agents = await save(take());
    expect(agents.assistant).toEqual({ connectionId: "deepseek", model: "deepseek-v4-flash", effort: "high", apply: "at_once", historyTokens: 8000, budget: { toolTurns: "none" } });
    expect(assistantBudget(agents)).toEqual({ ...DEFAULTS.budget, toolTurns: "none" });
    expect(agents.budget).toEqual(DEFAULTS.budget);
    // Reset puts the whole page back.
    click(labelled(page(agents), Button, "Reset the assistant to its defaults"));
    agents = await save(take());
    expect(agents.assistant).toEqual(DEFAULTS.assistant);
    expect(labels(page(agents))).toEqual(["Bust the assistant's cache"]);
    // Following every agent's again, it takes up a change made there.
    agents = await save({ agents: { budget: { toolTurns: 7 } } });
    expect(assistantBudget(agents).toolTurns).toBe(7);
  });
});

describe("Settings home's line for the Assistant page", () => {
  test("says where it runs and how its changes land", () => {
    expect(assistantSummary(DEFAULTS.assistant, CONNECTIONS)).toBe("Lumiverse's default connection · changes: each waits for your Apply");
    expect(assistantSummary(withAssistant({ connectionId: "deepseek" }).assistant, CONNECTIONS)).toBe("Deepseek · deepseek-v4-flash · changes: each waits for your Apply");
    expect(assistantSummary(withAssistant({ connectionId: "harbor", model: "deepseek-v4-flash", apply: "at_once" }).assistant, CONNECTIONS)).toBe("Harbor relay · deepseek-v4-flash · changes: at once, with an Undo chip");
    // Before the connections come, or once Lumiverse no longer has it: its id.
    expect(assistantSummary(withAssistant({ connectionId: "harbor" }).assistant, [])).toBe("harbor · changes: each waits for your Apply");
  });
});
