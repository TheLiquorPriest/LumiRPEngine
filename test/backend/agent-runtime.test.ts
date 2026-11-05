// The agent runtime and its provider adapter (INC1-SPEC R1), on a scripted model in the fake host:
// tool round trips, calls written as text, the loop detector, every budget and ceiling refusing, the
// acceptance guard, cancel mid-call, streaming, effort and thinking with tools, caching, usage, and the settings.

import { describe, expect, test } from "bun:test";
import type { QuietMessage, QuietRequest, QuietResult, QuietToolCall } from "../../src/backend/host";
import { ACCEPTANCE_PATH, type AccountsClock, AgentAccounts, effortChoice, ownBreakpoints, recoverToolCalls } from "../../src/backend/agents/provider";
import { type AgentSpec, type AgentTool, AgentTurn, SCRATCH_READ, startAgent } from "../../src/backend/agents/runtime";
import { parseUsage } from "../../src/backend/agents/usage";
import { cacheBreakpoints, createSpindleHost, reasoningOverride, rouletteTargets } from "../../src/backend/spindle-host";
import { type AgentSettings, agentSettingsOf, DEFAULT_ACCEPTANCE, defaultAgentSettings } from "../../src/shared/agent-settings";
import type { AcceptanceState } from "../../src/shared/agent-settings";
import { defaultRoleSettings } from "../../src/shared/agent-roles";
import type { ToolFamily } from "../../src/shared/agent-tools";
import type { JsonObject } from "../../src/shared/json";
import { SETTINGS_DEFAULTS_REV, type UserSettings } from "../../src/shared/settings";
import { STOP_TEXT } from "../../src/shared/agent-failures";
import { FakeHost, type QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";

const MAIN = "conn-main";
const CLAUDE = "conn-claude";
/** A made-up connection the tests keep for acceptance runs. */
const SONNET = "conn_acceptance_test";
const NO_CACHE_OF_ITS_OWN = { limit: 4, system: false, lastMessage: false, tools: false, automatic: false };

/** The default agent settings with `change` made to them. */
function settingsWith(change: (s: AgentSettings) => void = () => undefined): AgentSettings {
  const s = defaultAgentSettings();
  change(s);
  return s;
}

/** The defaults with Sonnet kept for acceptance runs, as a connection added in Settings → Agents starts. */
const guarded = (): AgentSettings => settingsWith((s) => (s.acceptance.connections = [{ id: SONNET, ...DEFAULT_ACCEPTANCE }]));

/** A tool that records each call's arguments and answers `answer` of them. */
function tool(name: string, answer: (args: JsonObject) => string | Promise<string> = () => `${name} done`): AgentTool & { runs: JsonObject[] } {
  const runs: JsonObject[] = [];
  return {
    name,
    description: `The ${name} tool.`,
    parameters: { type: "object", properties: { q: { type: "string" } } },
    runs,
    run: async (args) => {
      runs.push(args);
      return { text: await answer(args) };
    },
  };
}

function spec(over: Partial<AgentSpec> = {}): AgentSpec {
  return { role: "assistant", connectionId: MAIN, model: null, effort: "medium", system: "You answer questions about the story.", prefix: ["The world: a harbour town."], tools: [], budget: { ...defaultAgentSettings().budget }, ...over };
}

const call = (name: string, args: JsonObject = {}, callId = `call_${name}`): QuietToolCall => ({ name, args, callId });

/** A clock the tests move by hand; a throttle's wait moves it on, and says how long it waited. */
type TestClock = AccountsClock & { t: number; slept: number[] };

function clock(): TestClock {
  const c: TestClock = {
    t: 0,
    slept: [],
    now: () => c.t,
    sleep: async (ms) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

/** A result body read as what it is: the acceptance runs, or the settings. */
const stateOf = (body: Record<string, unknown>): AcceptanceState => body as unknown as AcceptanceState;
const settingsOf = (body: Record<string, unknown>): UserSettings => body.settings as UserSettings;

/**
 * A scripted model in the fake host: each call takes the next scripted answer (or `answers` of the
 * request and its number). The user's default connection is Main (a provider that takes no cache
 * breakpoints); Claude and the acceptance-guarded Sonnet are Anthropic.
 */
function rig(answers: QuietScript[] | ((req: QuietRequest, n: number) => QuietScript | Promise<QuietScript>), settings = settingsWith(), options: { clock?: TestClock; turn?: AgentTurn; texts?: Record<string, string> } = {}) {
  const host = new FakeHost();
  host.activeConnection = { id: MAIN, name: "Main" };
  host.connectionProfiles.push({ id: CLAUDE, name: "Claude", models: ["claude-sonnet"], provider: "anthropic", cache: NO_CACHE_OF_ITS_OWN }, { id: SONNET, name: "Sonnet", models: ["claude-sonnet-5-5"], provider: "anthropic", cache: NO_CACHE_OF_ITS_OWN });
  let n = 0;
  host.quietReply = (req) => {
    const at = n++;
    if (typeof answers === "function") return answers(req, at);
    const answer = answers[at];
    if (answer === undefined) throw new Error(`no answer scripted for call ${at + 1}`);
    return answer;
  };
  const accounts = new AgentAccounts(host, options.clock);
  const deps = { host, userId: host.userId, settings, texts: options.texts ?? {}, accounts, turn: options.turn ?? null, ...(options.clock ? { now: options.clock.now } : {}) };
  return { host, accounts, deps, start: (s: AgentSpec = spec()) => startAgent(s, deps) };
}

/** The last message of the call made `n`th (0-based). */
const lastOf = (host: FakeHost, n: number): QuietMessage | undefined => host.quietCalls[n]?.messages.at(-1);

describe("tool round trips", () => {
  test("a call goes back as the model's tool_use and its result as a tool_result, and the model answers from it", async () => {
    const lookup = tool("lookup", (a) => `found ${String(a.q)}`);
    const r = rig([{ content: "Let me look.", toolCalls: [call("lookup", { q: "Danny" }, "toolu_1")] }, "Danny is at the shop."]);
    const agent = r.start(spec({ tools: [lookup] }));
    expect(await agent.send("Where is Danny?")).toMatchObject({ status: "answered", text: "Danny is at the shop." });
    expect(lookup.runs).toEqual([{ q: "Danny" }]);
    expect(r.host.quietCalls[0]?.tools?.map((t) => t.name)).toEqual(["lookup", SCRATCH_READ]);
    const [assistant, results] = r.host.quietCalls[1]?.messages.slice(-2) ?? [];
    expect(assistant).toMatchObject({ role: "assistant", parts: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "Danny" } }] });
    expect(results).toMatchObject({ role: "user", parts: [{ type: "tool_result", toolUseId: "toolu_1", content: "found Danny" }] });
    expect(agent.usage()).toMatchObject({ calls: 2, toolTurns: 1 });
    expect(agent.transcript().entries.map((e) => e.kind)).toEqual(["message", "answer", "result", "answer"]);
  });

  test("Lumiverse gets the parts as its own, asked for usage, and passes back calls, reasoning carriers and usage", async () => {
    const sent: Record<string, unknown>[] = [];
    const raw = {
      content: "",
      finish_reason: "tool_calls",
      tool_calls: [{ name: "lookup", args: { q: "x" }, call_id: "toolu_9", thought_signature: "sig-1" }],
      reasoning: "I should look.",
      thinking_blocks: [{ type: "thinking", thinking: "look", signature: "s1" }],
      reasoning_details: [{ type: "reasoning.text", text: "look" }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, provider_raw: { prompt_tokens: 12, completion_tokens: 3 } },
    };
    Object.assign(globalThis, { spindle: { generate: { quiet: async (request: Record<string, unknown>) => (sent.push(request), raw) }, connections: { list: async () => [] } } });
    try {
      const host = createSpindleHost();
      const messages: QuietMessage[] = [
        { role: "system", content: "Rules.", parts: [{ type: "text", text: "Rules.", cache: true }] },
        { role: "assistant", content: "lookup {}", parts: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: {}, thoughtSignature: "sig-0" }], reasoning: "thought", thinkingBlocks: [{ type: "thinking", thinking: "t", signature: "s0" }] },
        { role: "user", content: "found", parts: [{ type: "tool_result", toolUseId: "toolu_1", content: "found", isError: true }] },
      ];
      const result = await host.models.quiet({ messages, maxTokens: 100, json: false, connectionId: "c", model: null, usage: true }, "u", new AbortController().signal);
      expect(sent[0]?.messages).toEqual([
        { role: "system", content: [{ type: "text", text: "Rules.", cache_control: { type: "ephemeral" } }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: {}, thought_signature: "sig-0" }], reasoning_content: "thought", thinking_blocks: [{ type: "thinking", thinking: "t", signature: "s0" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "found", is_error: true }] },
      ]);
      expect(sent[0]?.parameters).toMatchObject({ _include_usage: true });
      expect(result).toMatchObject({ toolCalls: [{ name: "lookup", args: { q: "x" }, callId: "toolu_9", thoughtSignature: "sig-1" }], reasoning: "I should look.", thinkingBlocks: [{ type: "thinking", thinking: "look", signature: "s1" }], reasoningDetails: [{ type: "reasoning.text", text: "look" }], usage: raw.usage });
      // A classic call is sent as before: plain messages, no usage request.
      await host.models.quiet({ messages: [{ role: "user", content: "x" }], maxTokens: 100, json: false, connectionId: "c", model: null }, "u", new AbortController().signal);
      expect(sent[1]?.messages).toEqual([{ role: "user", content: "x" }]);
      expect(sent[1]?.parameters).not.toHaveProperty("_include_usage");
      expect(sent[1]).not.toHaveProperty("reasoning");
      // An effort of the call's own asking for its thinking summarized goes as Lumiverse's reasoning override.
      await host.models.quiet({ messages: [{ role: "user", content: "x" }], maxTokens: 100, json: false, connectionId: "c", model: null, effort: "high", thinkingDisplay: "summarized" }, "u", new AbortController().signal);
      expect(sent[2]?.reasoning).toEqual({ source: "custom", apiReasoning: true, effort: "high", thinkingDisplay: "summarized" });
    } finally {
      Object.assign(globalThis, { spindle: undefined });
    }
  });

  test("a model's reasoning carriers go back with its tool turn", async () => {
    const r = rig([{ content: "", toolCalls: [call("lookup")], reasoning: "Check first.", thinkingBlocks: [{ type: "thinking", thinking: "check", signature: "sig" }], reasoningDetails: [{ type: "reasoning.encrypted", data: "x" }] }, "Done."]);
    await r.start(spec({ tools: [tool("lookup")] })).send("Go.");
    const assistant = r.host.quietCalls[1]?.messages.at(-2);
    expect(assistant).toMatchObject({ role: "assistant", reasoning: "Check first.", thinkingBlocks: [{ type: "thinking", thinking: "check", signature: "sig" }], reasoningDetails: [{ type: "reasoning.encrypted", data: "x" }] });
  });

  test("an answer's calls run as many at once as the concurrency setting lets, and their results keep the calls' order", async () => {
    let running = 0;
    let most = 0;
    const slow = (name: string) =>
      tool(name, async () => {
        running += 1;
        most = Math.max(most, running);
        // One turn of the event loop's microtasks: every call started in the same pass is running by now.
        await Promise.resolve();
        running -= 1;
        return `${name} ok`;
      });
    for (const concurrency of [1, 2, 3]) {
      most = 0;
      const r = rig([{ content: "", toolCalls: [call("c"), call("a"), call("b")] }, "Done."]);
      await r.start(spec({ tools: [slow("a"), slow("b"), slow("c")], budget: { ...spec().budget, concurrency } })).send("Go.");
      expect(most).toBe(concurrency);
      expect(lastOf(r.host, 1)?.parts?.map((p) => (p.type === "tool_result" ? p.content : ""))).toEqual(["c ok", "a ok", "b ok"]);
    }
  });

  test("a call to a tool the agent hasn't got, and a tool that fails, come back to the model as failures", async () => {
    const broken: AgentTool = { ...tool("broken"), run: async () => Promise.reject(new Error("the ledger is locked")) };
    const r = rig([{ content: "", toolCalls: [call("summon"), call("broken")] }, "I couldn't."]);
    expect(await r.start(spec({ tools: [broken] })).send("Go.")).toMatchObject({ status: "answered" });
    const [unknown, failed] = lastOf(r.host, 1)?.parts ?? [];
    expect(unknown).toMatchObject({ type: "tool_result", isError: true });
    expect(failed).toMatchObject({ type: "tool_result", isError: true });
    expect(unknown?.type === "tool_result" && unknown.content.includes("summon")).toBe(true);
    expect(failed?.type === "tool_result" && failed.content.includes("the ledger is locked")).toBe(true);
  });

  test("a long result reaches the model clipped, and scratch_read reads the rest from where it says", async () => {
    const long = `${"x".repeat(50)}TAIL`;
    const settings = settingsWith((s) => (s.clipChars = 20));
    const r = rig([{ content: "", toolCalls: [call("dump")] }, { content: "", toolCalls: [call(SCRATCH_READ, { handle: "s1", offset: 40 }, "c2")] }, "It ends in TAIL."], settings);
    const agent = r.start(spec({ tools: [tool("dump", () => long)] }));
    expect(await agent.send("Read it all.")).toMatchObject({ status: "answered" });
    const clipped = lastOf(r.host, 1)?.parts?.[0];
    expect(clipped?.type === "tool_result" && clipped.content.startsWith("x".repeat(20)) && !clipped.content.includes("TAIL") && clipped.content.includes("s1")).toBe(true);
    const rest = lastOf(r.host, 2)?.parts?.[0];
    expect(rest?.type === "tool_result" && rest.content.endsWith("TAIL") && !rest.content.includes("x".repeat(15))).toBe(true);
    expect(agent.transcript().entries.find((e) => e.kind === "result" && e.name === "dump")).toMatchObject({ scratch: "s1" });
    // A clipped cut never splits a character.
    const emoji = rig([{ content: "", toolCalls: [call("dump")] }, "ok"], settingsWith((s) => (s.clipChars = 20)));
    await emoji.start(spec({ tools: [tool("dump", () => `${"x".repeat(19)}😀${"y".repeat(10)}`)] })).send("Go.");
    const cut = lastOf(emoji.host, 1)?.parts?.[0];
    expect(cut?.type === "tool_result" && cut.content.startsWith(`${"x".repeat(19)}\n`)).toBe(true);
  });

  test("what the runtime says to a model is the user's own text where they have one", async () => {
    const texts = { "runtime.clipped": "<<cut at {{shown}} of {{total}}, rest in {{handle}}>>", "runtime.scratch_read": "Read the rest of a cut result." };
    const r = rig([{ content: "", toolCalls: [call("dump")] }, "ok"], settingsWith((s) => (s.clipChars = 5)), { texts });
    await r.start(spec({ tools: [tool("dump", () => "0123456789")] })).send("Go.");
    expect(r.host.quietCalls[0]?.tools?.find((t) => t.name === SCRATCH_READ)?.description).toBe("Read the rest of a cut result.");
    const clipped = lastOf(r.host, 1)?.parts?.[0];
    expect(clipped?.type === "tool_result" && clipped.content).toBe("01234\n<<cut at 5 of 10, rest in s1>>");
  });
});

describe("calls written as text", () => {
  const names = new Set(["lookup", "move"]);

  test("the forms models write calls in are read as calls to the agent's tools, and taken out of its text", () => {
    expect(recoverToolCalls('I will check.\n<tool_call>{"name": "lookup", "arguments": {"q": "Danny"}}</tool_call>', names)).toEqual({ calls: [{ name: "lookup", args: { q: "Danny" } }], rest: "I will check." });
    expect(recoverToolCalls('<function_calls><invoke name="move"><parameter name="to">bluebird_coffee</parameter><parameter name="minutes">5</parameter></invoke></function_calls>', names).calls).toEqual([{ name: "move", args: { to: "bluebird_coffee", minutes: 5 } }]);
    expect(recoverToolCalls('```json\n{"type": "function", "function": {"name": "lookup", "arguments": "{\\"q\\": \\"x\\"}"}}\n```', names)).toEqual({ calls: [{ name: "lookup", args: { q: "x" } }], rest: "" });
    expect(recoverToolCalls('[{"name": "lookup", "args": {"q": "a"}}, {"tool": "move", "input": {"to": "b"}}]', names).calls).toEqual([
      { name: "lookup", args: { q: "a" } },
      { name: "move", args: { to: "b" } },
    ]);
    expect(recoverToolCalls('[TOOL_CALLS] [{"name": "lookup", "arguments": {"q": "m"}}]', names).calls).toEqual([{ name: "lookup", args: { q: "m" } }]);
    expect(recoverToolCalls('<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>lookup\n```json\n{"q": "d"}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>', names)).toEqual({ calls: [{ name: "lookup", args: { q: "d" } }], rest: "" });
    expect(recoverToolCalls('<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>lookup<｜tool▁sep｜>{"q": "e"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>', names).calls).toEqual([{ name: "lookup", args: { q: "e" } }]);
    expect(recoverToolCalls('<function=lookup>{"q": "l"}</function>', names).calls).toEqual([{ name: "lookup", args: { q: "l" } }]);
  });

  test("text that only looks like a call stays an answer: another tool's name, plain JSON, a tool's description, broken JSON", () => {
    for (const text of ['<tool_call>{"name": "delete_world", "arguments": {}}</tool_call>', '{"answer": 42}', '{"name": "lookup", "description": "Looks things up.", "parameters": {}}', '<tool_call>{"name": "lookup", "arguments": {</tool_call>', "Danny is at the shop."]) {
      expect(recoverToolCalls(text, names)).toEqual({ calls: [], rest: text });
    }
  });

  test("a call written as text runs, and its result goes back as text, with the model's turn as it wrote it", async () => {
    const lookup = tool("lookup", () => "Danny is at the shop");
    const written = 'Checking.\n<tool_call>{"name": "lookup", "arguments": {"q": "Danny"}}</tool_call>';
    const r = rig([written, "He's at the shop."]);
    expect(await r.start(spec({ tools: [lookup] })).send("Where is Danny?")).toMatchObject({ status: "answered", text: "He's at the shop." });
    expect(lookup.runs).toEqual([{ q: "Danny" }]);
    const [assistant, results] = r.host.quietCalls[1]?.messages.slice(-2) ?? [];
    expect(assistant).toEqual({ role: "assistant", content: written });
    expect(results?.role).toBe("user");
    expect(results?.parts).toBeUndefined();
    expect(results?.content).toContain("Danny is at the shop");
  });

  test("a connection that refuses native tools is offered them as text, and its next agent starts that way", async () => {
    const r = rig((req, n) => {
      if (req.tools?.length) throw new Error("400: tools are not supported by this model");
      return n === 1 ? '<tool_call>{"name": "lookup", "arguments": {"q": "x"}}</tool_call>' : "Done.";
    });
    const lookup = tool("lookup");
    expect(await r.start(spec({ tools: [lookup] })).send("Go.")).toMatchObject({ status: "answered", text: "Done." });
    expect(lookup.runs).toEqual([{ q: "x" }]);
    expect(r.host.quietCalls[0]?.tools?.length).toBeGreaterThan(0);
    const asText = r.host.quietCalls[1];
    expect(asText?.tools).toBeUndefined();
    expect(asText?.messages[0]?.content).toContain("The lookup tool.");
    const before = r.host.quietCalls.length;
    await r.start(spec({ tools: [lookup] })).send("Again.");
    expect(r.host.quietCalls[before]?.tools).toBeUndefined();
  });

  test("only a provider's own refusal of tools turns them to text, on the agent's record; any other failure of a call with tools is that call's", async () => {
    // What providers say when a model or endpoint takes no tools.
    for (const said of ["400: deepseek-reasoner does not support Function Calling", "404: No endpoints found that support tool use.", 'Unsupported parameter: "tools"', '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', "Function calling is not enabled for models/gemma-3"]) {
      const r = rig((req) => {
        if (req.tools?.length) throw new Error(said);
        return "Done.";
      });
      const agent = r.start(spec({ tools: [tool("lookup")] }));
      expect(await agent.send("Go.")).toMatchObject({ status: "answered", text: "Done." });
      expect(r.host.quietCalls.map((c) => c.tools === undefined)).toEqual([false, true]);
      expect(agent.transcript().entries.map((e) => e.kind)).toEqual(["message", "tools_refused", "answer"]);
      expect(agent.transcript().entries[1]).toMatchObject({ kind: "tools_refused", reason: expect.stringContaining(said) });
      expect(await r.accounts.refusesTools(r.host.userId, MAIN)).toBe(true);
    }
    // A prompt too long, a bad request of another kind, a provider's own fault: the call fails, and the connection keeps its native tools.
    for (const said of ["400: This model's maximum context length is 8192 tokens", "400: Invalid value for 'temperature'", "500: internal error"]) {
      const r = rig((req) => {
        if (req.tools?.length) throw new Error(said);
        return "Done.";
      });
      const agent = r.start(spec({ tools: [tool("lookup")] }));
      expect(await agent.send("Go.")).toMatchObject({ status: "failed" });
      expect(r.host.quietCalls).toHaveLength(1);
      expect(agent.transcript().entries.map((e) => e.kind)).toEqual(["message", "stop"]);
      expect(await r.accounts.refusesTools(r.host.userId, MAIN)).toBe(false);
    }
  });
});

describe("the loop detector", () => {
  test("the same call with the same arguments, the setting's number of times in a row, stops the agent before it runs", async () => {
    for (const loopRepeats of [3, 5]) {
      const lookup = tool("lookup");
      const r = rig(() => ({ content: "", toolCalls: [call("lookup", { q: "same" })] }), settingsWith((s) => (s.loopRepeats = loopRepeats)));
      expect(await r.start(spec({ tools: [lookup] })).send("Go.")).toMatchObject({ status: "stopped", code: "loop" });
      expect(lookup.runs.length).toBe(loopRepeats - 1);
    }
  });

  test("a call with other arguments starts the count again", async () => {
    const lookup = tool("lookup");
    const answers: QuietScript[] = [...[..."aabba"].map((q): QuietScript => ({ content: "", toolCalls: [call("lookup", { q })] })), "Done."];
    const r = rig(answers);
    expect(await r.start(spec({ tools: [lookup] })).send("Go.")).toMatchObject({ status: "answered" });
    expect(lookup.runs.map((a) => a.q)).toEqual([..."aabba"]);
  });

  test("a call on a state its tool says changed since the one before is a new call: the same arguments go on while each changes something, and stop once they change nothing", async () => {
    // A take-out by position, as the final review's: line 1 again is the next line, until none is left.
    let lines = 4;
    const drop: AgentTool & { runs: JsonObject[] } = { ...tool("drop", () => (lines > 0 ? `Done: ${--lines} left.` : "No such line.")), state: () => lines };
    const r = rig(() => ({ content: "", toolCalls: [call("drop", { line: 1 })] }));
    expect(await r.start(spec({ tools: [drop] })).send("Take out every line.")).toMatchObject({ status: "stopped", code: "loop" });
    // Four that each took a line out, then the refusals on what no longer changes: the third in a row isn't run.
    expect([drop.runs.length, lines]).toEqual([6, 0]);
    // Without a state of its own, the same calls stop at the setting's count, as any tool's do.
    lines = 4;
    const plain = tool("drop", () => `Done: ${--lines} left.`);
    expect(await rig(() => ({ content: "", toolCalls: [call("drop", { line: 1 })] })).start(spec({ tools: [plain] })).send("Take out every line.")).toMatchObject({ status: "stopped", code: "loop" });
    expect(plain.runs.length).toBe(defaultAgentSettings().loopRepeats - 1);
  });
});

describe("budgets and ceilings", () => {
  const used = (prompt: number, completion: number) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });
  let asked = 0;
  const round = (usage?: JsonObject): QuietScript => ({ content: "", toolCalls: [call("lookup", { q: String(++asked) })], ...(usage ? { usage } : {}) });

  test("Prompt per call: a call whose prompt is past it isn't sent", async () => {
    const r = rig(["never"]);
    expect(await r.start(spec({ budget: { ...spec().budget, callTokensIn: 1 } })).send("Go.")).toMatchObject({ status: "refused", code: "call_tokens_in" });
    expect(r.host.quietCalls.length).toBe(0);
  });

  test("Prompt tokens per agent: the call that would pass it isn't sent", async () => {
    const r = rig([round(used(1000, 5)), "never"]);
    expect(await r.start(spec({ tools: [tool("lookup")], budget: { ...spec().budget, tokensIn: 1001 } })).send("Go.")).toMatchObject({ status: "refused", code: "tokens_in" });
    expect(r.host.quietCalls.length).toBe(1);
  });

  test("Answer tokens per agent: a call asks for no more than is left, and none goes once they're spent", async () => {
    const r = rig([round(used(10, 30)), round(used(10, 70)), "never"]);
    const reply = await r.start(spec({ tools: [tool("lookup")], budget: { ...spec().budget, tokensOut: 100 } })).send("Go.");
    expect(r.host.quietCalls.map((c) => c.maxTokens)).toEqual([100, 70]);
    expect(reply).toMatchObject({ status: "refused", code: "tokens_out" });
  });

  test("Answer per call: every call asks for it as its max tokens", async () => {
    const r = rig(["Done."]);
    await r.start(spec({ budget: { ...spec().budget, callTokensOut: 777 } })).send("Go.");
    expect(r.host.quietCalls[0]?.maxTokens).toBe(777);
  });

  test("Tool rounds per agent: the round past it isn't run", async () => {
    const lookup = tool("lookup");
    const r = rig([round(), round(), "never"]);
    const reply = await r.start(spec({ tools: [lookup], budget: { ...spec().budget, toolTurns: 1 } })).send("Go.");
    // A count of one is worded as one: "1 round", never "1 rounds".
    expect(reply).toMatchObject({ status: "refused", code: "tool_turns", reason: "the agent has had its 1 round of tool calls (Tool rounds per agent)" });
    expect(lookup.runs.length).toBe(1);
  });

  test("Tool calls per answer: the calls past it aren't run, and the model is told", async () => {
    const lookup = tool("lookup");
    const r = rig([{ content: "", toolCalls: [call("lookup", { q: "1" }, "a"), call("lookup", { q: "2" }, "b")] }, "Done."]);
    await r.start(spec({ tools: [lookup], budget: { ...spec().budget, callTools: 1 } })).send("Go.");
    expect(lookup.runs).toEqual([{ q: "1" }]);
    expect(lastOf(r.host, 1)?.parts).toMatchObject([
      { type: "tool_result", toolUseId: "a", content: "lookup done" },
      { type: "tool_result", toolUseId: "b", isError: true, content: "Not run: one answer may call at most 1 tool. Call lookup again in your next answer if you still need it." },
    ]);
    // Past a limit of more than one, the tools are counted as many.
    const two = rig([{ content: "", toolCalls: [call("lookup", { q: "1" }, "a"), call("lookup", { q: "2" }, "b"), call("lookup", { q: "3" }, "c")] }, "Done."]);
    await two.start(spec({ tools: [tool("lookup")], budget: { ...spec().budget, callTools: 2 } })).send("Go.");
    expect(lastOf(two.host, 1)?.parts?.[2]).toMatchObject({ toolUseId: "c", isError: true, content: expect.stringContaining("at most 2 tools.") });
  });

  test("Time per call: a call that takes longer is stopped", async () => {
    // The runtime's own deadline is a real timer, so this waits out a short one (20 ms).
    const r = rig(() => Promise.withResolvers<QuietScript>().promise);
    expect(await r.start(spec({ budget: { ...spec().budget, callMs: 20 } })).send("Go.")).toMatchObject({ status: "refused", code: "call_time" });
    expect(r.host.quietStopped.length).toBe(1);
  });

  test("Time per agent: no call goes once the agent's time is up", async () => {
    const c = clock();
    const r = rig(
      (_req, n) => {
        c.t += 2000;
        return n === 0 ? round() : "never";
      },
      settingsWith(),
      { clock: c },
    );
    const lookup = tool("lookup");
    expect(await r.start(spec({ tools: [lookup], budget: { ...spec().budget, wallMs: 1000 } })).send("Go.")).toMatchObject({ status: "refused", code: "wall_time" });
    expect(lookup.runs.length).toBe(0);
    expect(r.host.quietCalls.length).toBe(1);
  });

  test("Revisions per agent: a message after the first answer counts, and the one past them isn't sent", async () => {
    const r = rig(["First.", "Second.", "never"]);
    const agent = r.start(spec({ budget: { ...spec().budget, revisions: 1 } }));
    expect(await agent.send("Draft it.")).toMatchObject({ status: "answered", text: "First." });
    expect(await agent.send("Shorter.")).toMatchObject({ status: "answered", text: "Second." });
    expect(await agent.send("Again.")).toMatchObject({ status: "refused", code: "revisions" });
    expect(r.host.quietCalls.length).toBe(2);
  });

  test("a stop's reason is its registry text on the Main agent page: the shipped words, or the user's own where edited (L4)", async () => {
    const stopped = async (texts?: Record<string, string>): Promise<unknown> => {
      const r = rig(["First.", "never"], settingsWith(), texts ? { texts } : {});
      const agent = r.start(spec({ budget: { ...spec().budget, revisions: 0 } }));
      await agent.send("Draft it.");
      return agent.send("Again.");
    };
    expect(await stopped()).toMatchObject({ status: "refused", code: "revisions", reason: "it has had the 0 revisions it may have after its first answer" });
    expect(await stopped({ [STOP_TEXT.revisions]: "EDITED-STOP: {{revisions}} spent" })).toMatchObject({ status: "refused", code: "revisions", reason: "EDITED-STOP: 0 revisions spent" });
  });

  test("a turn's budget is every agent's of the turn together: tokens in and out, rounds and time", async () => {
    const c = clock();
    const turn = (budget: Partial<AgentTurn["budget"]>) => new AgentTurn({ ...defaultAgentSettings().turn, ...budget }, c.now);
    const cases: { budget: Partial<AgentTurn["budget"]>; first: QuietScript; code: string }[] = [
      { budget: { tokensIn: 1001 }, first: { content: "A.", usage: used(1000, 5) }, code: "turn_tokens_in" },
      { budget: { tokensOut: 50 }, first: { content: "A.", usage: used(10, 50) }, code: "turn_tokens_out" },
      { budget: { toolTurns: 1 }, first: round(), code: "turn_tool_turns" },
    ];
    for (const { budget, first, code } of cases) {
      const r = rig([first, "A done.", round(), "never"], settingsWith(), { turn: turn(budget), clock: c });
      await r.start(spec({ tools: [tool("lookup")] })).send("Go.");
      expect(await r.start(spec({ tools: [tool("lookup")] })).send("Go.")).toMatchObject({ status: "refused", code });
    }
    const late = turn({ wallMs: 1000 });
    c.t += 1500;
    expect(await rig(["never"], settingsWith(), { turn: late, clock: c }).start().send("Go.")).toMatchObject({ status: "refused", code: "turn_time" });
  });

  test("a run's ceilings: a call that would pass one isn't sent, and parallel calls hold theirs side by side", async () => {
    const ceiling = (tokensIn: number | "none", tokensOut: number | "none") => settingsWith((s) => (s.acceptance.connections = [{ id: SONNET, only: true, tokensIn, tokensOut }]));
    for (const [settings, code] of [
      [ceiling(10, "none"), "ceiling_in"],
      [ceiling("none", 100), "ceiling_out"],
    ] as const) {
      const r = rig(["never"], settings);
      await r.accounts.open(r.host.userId, "Increment 1");
      expect(await r.start(spec({ connectionId: SONNET })).send("Go.")).toMatchObject({ status: "refused", code });
      expect(r.host.quietCalls.length).toBe(0);
      expect((await r.accounts.state(r.host.userId, settings)).run?.connections.find((x) => x.id === SONNET)?.spent.refused).toBe(1);
    }
    // Two agents at once: the first holds its max tokens while it works, so the second would pass the ceiling.
    const settings = ceiling("none", 10_000);
    const first = Promise.withResolvers<QuietScript>();
    const holding = Promise.withResolvers<void>();
    const r = rig((_req, n) => {
      if (n > 0) return "B.";
      holding.resolve();
      return first.promise;
    }, settings);
    await r.accounts.open(r.host.userId, "Increment 1");
    const budget = { ...spec().budget, callTokensOut: 6000 };
    const a = r.start(spec({ connectionId: SONNET, budget })).send("A.");
    await holding.promise;
    expect((await r.accounts.state(r.host.userId, settings)).run?.connections.find((x) => x.id === SONNET)?.reserved.tokensOut).toBe(6000);
    expect(await r.start(spec({ connectionId: SONNET, budget })).send("B.")).toMatchObject({ status: "refused", code: "ceiling_out" });
    first.resolve({ content: "A done.", usage: used(50, 100) });
    expect(await a).toMatchObject({ status: "answered" });
    expect(await r.start(spec({ connectionId: SONNET, budget })).send("B again.")).toMatchObject({ status: "answered" });
  });

  test("a run holds a model's prompt times the estimate factor until it has reported real usage, then its own ratio", async () => {
    const host = new FakeHost();
    const accounts = new AgentAccounts(host);
    const settings = settingsWith((s) => (s.acceptance = { connections: [{ id: SONNET, only: true, tokensIn: 250, tokensOut: "none" }], estimateFactor: 2 }));
    const signal = new AbortController().signal;
    const hold = (tokensIn: number) => accounts.reserve({ userId: host.userId, connection: SONNET, model: "sonnet", tokensIn, tokensOut: 0, settings, signal });
    await accounts.open(host.userId, "Increment 1");
    const first = await hold(100);
    expect(first.tokensIn).toBe(200);
    accounts.settle(first, { in: 100, cachedIn: 0, out: 0, reasoningOut: 0, estimated: [] });
    expect((await hold(100)).tokensIn).toBe(100);
    await expect(hold(100)).rejects.toMatchObject({ code: "ceiling_in" });
  });

  test("a throttle waits for its minute to have room, and refuses only a call bigger than its whole minute", async () => {
    const c = clock();
    const host = new FakeHost();
    const accounts = new AgentAccounts(host, c);
    const signal = new AbortController().signal;
    const settings = settingsWith((s) => (s.throttles = [{ id: MAIN, requestsPerMinute: 1, tokensPerMinute: 100, atOnce: "none" }]));
    const hold = (tokensIn: number) => accounts.reserve({ userId: host.userId, connection: MAIN, model: "m", tokensIn, tokensOut: 10, settings, signal });
    await hold(10);
    await hold(10);
    expect(c.slept).toEqual([60_000]);
    await expect(hold(95)).rejects.toMatchObject({ code: "throttle" });
  });

  /** Yields the event loop `turns` times: what a release wakes has run by then. */
  const flush = async (turns = 20): Promise<void> => {
    for (let i = 0; i < turns; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setImmediate(resolve);
      await promise;
    }
  };

  test("calls at once: at 2, a connection's third call waits for one under way to end, in the order they came; one whose signal aborts leaves the line; a prompt-only call's place is taken through the same gate; another connection never waits", async () => {
    const host = new FakeHost();
    const accounts = new AgentAccounts(host, clock());
    const signal = new AbortController().signal;
    const settings = settingsWith((s) => (s.throttles = [{ id: MAIN, requestsPerMinute: "none", tokensPerMinute: "none", atOnce: 2 }]));
    const hold = (connection = MAIN, stop = signal) => accounts.reserve({ userId: host.userId, connection, model: "m", tokensIn: 10, tokensOut: 10, settings, signal: stop });
    const placed: string[] = [];
    const first = await hold();
    const second = await hold();
    const third = hold().then((r) => (placed.push("third"), r));
    const quit = new AbortController();
    const quitter = hold(MAIN, quit.signal);
    const fourth = hold().then((r) => (placed.push("fourth"), r));
    await flush();
    // A prompt-only role's call (`Steps.gate`) waits in the same line, after them.
    const prompt = accounts.atOnce(host.userId, MAIN, settings.throttles, signal).then((release) => (placed.push("prompt-only"), release));
    await flush();
    expect(placed).toEqual([]);
    // Another connection, which has no such limit, never waits.
    accounts.settle(await hold(CLAUDE), null);
    quit.abort(new Error("cancelled while it waited"));
    await expect(quitter).rejects.toThrow("cancelled while it waited");
    accounts.settle(first, null);
    await flush();
    expect(placed).toEqual(["third"]);
    accounts.settle(second, null);
    await flush();
    expect(placed).toEqual(["third", "fourth"]);
    accounts.settle(await third, null);
    const release = await prompt;
    expect(placed).toEqual(["third", "fourth", "prompt-only"]);
    // A release frees its place once: the next waits until another one ends.
    release();
    release();
    const fifth = hold().then((r) => (placed.push("fifth"), r));
    const sixth = hold().then((r) => (placed.push("sixth"), r));
    await flush();
    expect(placed.slice(3)).toEqual(["fifth"]);
    accounts.settle(await fourth, null);
    accounts.settle(await sixth, null);
    accounts.settle(await fifth, null);
    // With no limit, as the default has none, nothing waits.
    const none = settingsWith();
    const free = await Promise.all([1, 2, 3, 4].map(() => accounts.reserve({ userId: host.userId, connection: MAIN, model: "m", tokensIn: 10, tokensOut: 10, settings: none, signal })));
    expect(free).toHaveLength(4);
  });

  test("calls at once: an agent's model call past the limit waits to be sent until one under way ends", async () => {
    const answered: (() => void)[] = [];
    const settings = settingsWith((s) => (s.throttles = [{ id: MAIN, requestsPerMinute: "none", tokensPerMinute: "none", atOnce: 1 }]));
    const r = rig(() => {
      const { promise, resolve } = Promise.withResolvers<QuietScript>();
      answered.push(() => resolve("Done."));
      return promise;
    }, settings);
    const one = r.start().send("First?");
    const two = r.start().send("Second?");
    await flush();
    expect(r.host.quietCalls).toHaveLength(1);
    answered[0]?.();
    expect(await one).toMatchObject({ status: "answered" });
    await flush();
    expect(r.host.quietCalls).toHaveLength(2);
    answered[1]?.();
    expect(await two).toMatchObject({ status: "answered" });
  });
});

describe("the acceptance guard", () => {
  test("a connection kept for acceptance runs is refused until a run is open, and the run counts what it spends", async () => {
    const r = rig(["During the run.", "never"], guarded());
    const sonnet = () => r.start(spec({ connectionId: SONNET }));
    expect(await sonnet().send("Go.")).toMatchObject({ status: "refused", code: "acceptance" });
    expect(r.host.quietCalls.length).toBe(0);
    await r.accounts.open(r.host.userId, "Increment 1");
    r.host.quietReply = () => ({ content: "During the run.", usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128, provider_raw: { input_tokens: 20, cache_read_input_tokens: 100, output_tokens: 8 } } });
    expect(await sonnet().send("Go.")).toMatchObject({ status: "answered" });
    await r.accounts.close(r.host.userId);
    expect(await sonnet().send("Go.")).toMatchObject({ status: "refused", code: "acceptance" });
    const settings = r.deps.settings;
    const state = await r.accounts.state(r.host.userId, settings);
    expect(state.run).toBeNull();
    expect(state.last?.connections.find((x) => x.id === SONNET)).toMatchObject({ spent: { tokensIn: 120, cachedIn: 100, tokensOut: 8, calls: 1, estimated: false }, ceiling: { only: true, tokensIn: 300_000, tokensOut: 30_000 } });
    // A restart reads the last run back.
    await r.accounts.flushed(r.host.userId);
    expect((await new AgentAccounts(r.host).state(r.host.userId, settings)).last?.label).toBe("Increment 1");
    // Other connections aren't guarded.
    expect(await rig(["Fine."]).start().send("Go.")).toMatchObject({ status: "answered" });
  });

  test("a call on a default connection that can't be read goes ahead while connections are guarded, counted against none of them, and the log warns once; a guarded connection is still refused outside a run", async () => {
    const r = rig(["Fine.", "Fine again.", "During the run."], guarded());
    r.host.activeConnection = null;
    const warnings = (host: FakeHost) => host.logs.filter((l) => l.startsWith("warn:") && l.includes("the default connection, which couldn't be read"));
    expect(await r.start(spec({ connectionId: null })).send("Go.")).toMatchObject({ status: "answered", text: "Fine." });
    expect(await r.start(spec({ connectionId: null })).send("Go.")).toMatchObject({ status: "answered", text: "Fine again." });
    expect(warnings(r.host)).toHaveLength(1);
    expect((r.host.userLogs.get(r.host.userId) ?? []).filter((l) => l.includes("the default connection, which couldn't be read"))).toHaveLength(1);
    expect(await r.start(spec({ connectionId: SONNET })).send("Go.")).toMatchObject({ status: "refused", code: "acceptance" });
    expect(r.host.quietCalls).toHaveLength(2);
    // In a run, what it spends counts against no guarded connection.
    await r.accounts.open(r.host.userId, "Increment 2");
    expect(await r.start(spec({ connectionId: null })).send("Go.")).toMatchObject({ status: "answered", text: "During the run." });
    expect((await r.accounts.state(r.host.userId, r.deps.settings)).run?.connections.find((x) => x.id === SONNET)?.spent.calls).toBe(0);
    expect(warnings(r.host)).toHaveLength(1);
    // A new user's settings guard none, so there is nothing to warn of.
    const open = rig(["Fine."]);
    open.host.activeConnection = null;
    expect(await open.start(spec({ connectionId: null })).send("Go.")).toMatchObject({ status: "answered" });
    expect(warnings(open.host)).toEqual([]);
  });

  test("only the user opens and closes a run, and only the user changes what the runs guard", async () => {
    const rig = new Rig();
    const opened = stateOf(rig.body(await rig.send({ type: "lre.acceptance", op: "open", label: "Increment 1" })));
    expect(opened.run).toMatchObject({ label: "Increment 1", closedAt: null });
    expect(await rig.send({ type: "lre.acceptance", op: "open", label: "Again" })).toMatchObject({ type: "lre.error", code: "bad_request" });
    rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.1.0" } }, "agent-session"));
    expect(await rig.send({ type: "lre.acceptance", op: "close" }, "agent-session")).toMatchObject({ type: "lre.error", code: "forbidden" });
    expect(await rig.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: [{ id: SONNET, only: false, tokensIn: 1, tokensOut: 1 }] } } } }, "agent-session")).toMatchObject({ type: "lre.error", code: "forbidden" });
    // The client may read the run, and change other agent settings.
    expect(stateOf(rig.body(await rig.send({ type: "lre.acceptance", op: "get" }, "agent-session"))).run?.label).toBe("Increment 1");
    expect(settingsOf(rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { loopRepeats: 4 } } }, "agent-session"))).agents.loopRepeats).toBe(4);
    const closed = stateOf(rig.body(await rig.send({ type: "lre.acceptance", op: "close" })));
    expect(closed).toMatchObject({ run: null, last: { label: "Increment 1" } });
    const kept = [{ id: SONNET, only: true, tokensIn: 1000, tokensOut: 100 }];
    expect(settingsOf(rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: kept } } } }))).agents.acceptance.connections).toEqual(kept);
    // However its patch says it: a reset of the whole Agents section, or of acceptance alone, would drop the guard, so it is refused whole.
    for (const patch of [{ agents: null }, { agents: { acceptance: null } }, { agents: { loopRepeats: 5, acceptance: { estimateFactor: 3 } } }]) {
      expect(await rig.send({ type: "lre.settings.set", patch }, "agent-session")).toMatchObject({ type: "lre.error", code: "forbidden" });
    }
    const after = settingsOf(rig.body(await rig.send({ type: "lre.settings.get" }, "agent-session"))).agents;
    expect(after.acceptance.connections).toEqual(kept);
    expect(after.loopRepeats).toBe(4);
    // A patch that leaves them as they are goes through.
    expect(settingsOf(rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { loopRepeats: 5, acceptance: { connections: kept } } } }, "agent-session"))).agents.loopRepeats).toBe(5);
  });

  test("the guard is kept beside the runs, so a settings file a build from before the agents wrote without them still guards", async () => {
    const rig = new Rig();
    const { userId } = rig.host;
    const kept = [{ id: SONNET, only: true, tokensIn: 1000, tokensOut: 100 }];
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: kept } } } }));
    expect(JSON.parse(rig.host.files.get(`${userId}/${ACCEPTANCE_PATH}`) ?? "{}").connections).toEqual(kept);
    // Increment 0 writes its settings with only the keys it knows.
    const file = JSON.parse(rig.host.files.get(`${userId}/settings.json`) ?? "{}") as Record<string, unknown>;
    delete file.agents;
    rig.host.files.set(`${userId}/settings.json`, JSON.stringify(file));
    const back = rig.restart();
    const settings = settingsOf(back.body(await back.send({ type: "lre.settings.get" })));
    expect(settings.agents.acceptance.connections).toEqual(kept);
    await expect(back.rt.agentAccounts.reserve({ userId, connection: SONNET, model: "claude-sonnet-5-5", tokensIn: 10, tokensOut: 10, settings: settings.agents, signal: new AbortController().signal })).rejects.toMatchObject({ code: "acceptance" });
  });

  test("a guard only the settings file kept moves beside the runs, and still only the user changes it", async () => {
    const host = new FakeHost();
    const kept = [{ id: SONNET, only: true, tokensIn: 1000, tokensOut: 100 }];
    host.files.set(`${host.userId}/settings.json`, JSON.stringify({ v: 1, minds: { enabled: false }, agents: { acceptance: { connections: kept } } }));
    const rig = new Rig({ host });
    expect(settingsOf(rig.body(await rig.send({ type: "lre.settings.get" }))).agents.acceptance.connections).toEqual(kept);
    const stored = () => JSON.parse(host.files.get(`${host.userId}/${ACCEPTANCE_PATH}`) ?? "{}").connections;
    expect(stored()).toEqual(kept);
    rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.1.0" } }, "agent-session"));
    expect(await rig.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: [] } } } }, "agent-session")).toMatchObject({ type: "lre.error", code: "forbidden" });
    expect(stored()).toEqual(kept);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: [] } } } }));
    expect(stored()).toEqual([]);
  });

  test("a damaged guard file, with settings that keep no copy of the guard, lets agent calls go ahead under the settings file's own list, warned of once a start, until the user sets the list again; classic turns play", async () => {
    const host = new FakeHost();
    const { userId } = host;
    const kept = [{ id: SONNET, only: true, tokensIn: 1000, tokensOut: 100 }];
    // A build from before the agents wrote the settings; the runs' file is cut short.
    host.files.set(`${userId}/settings.json`, JSON.stringify({ v: 1, minds: { enabled: false } }));
    host.files.set(`${userId}/${ACCEPTANCE_PATH}`, JSON.stringify({ v: 1, run: null, last: null, connections: kept }).slice(0, 40));
    const reserve = async (r: Rig, connection: string) => r.rt.agentAccounts.reserve({ userId, connection, model: "m", tokensIn: 10, tokensOut: 10, settings: (await r.rt.settings.get(userId)).agents, signal: new AbortController().signal });
    const warnings = () => host.logs.filter((l) => l.startsWith("warn:") && l.includes("the acceptance runs' file was damaged and set aside"));
    const rig = new Rig({ host });
    // The settings serve, unkept, so each read tries the guard again; they keep no list, so every call goes, and the log says so once.
    expect((await rig.rt.settings.get(userId)).agents.acceptance.connections).toEqual([]);
    expect(rig.rt.settings.known(userId)).toBeUndefined();
    await expect(reserve(rig, MAIN)).resolves.toMatchObject({ connection: MAIN });
    await expect(reserve(rig, SONNET)).resolves.toMatchObject({ connection: SONNET });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("no guard");
    expect([...host.files.keys()].some((k) => k.startsWith(`${userId}/${ACCEPTANCE_PATH}.corrupt-`))).toBe(true);
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    expect((await rig.rt.diag.records(chatId, userId)).filter((r) => r.kind === "turn").at(-1)?.status).toBe("ok");
    // The fresh file says the guard was lost, so a restart reads it as lost, not as none, and warns again.
    await rig.rt.agentAccounts.flushed(userId);
    expect(JSON.parse(host.files.get(`${userId}/${ACCEPTANCE_PATH}`) ?? "{}")).toMatchObject({ lost: true });
    const back = rig.restart();
    await expect(reserve(back, MAIN)).resolves.toMatchObject({ connection: MAIN });
    expect(warnings()).toHaveLength(2);
    // A settings change that leaves the guard as it reads writes no copy that would stand for it.
    back.body(await back.send({ type: "lre.settings.set", patch: { agents: { loopRepeats: 4 } } }));
    expect(back.rt.settings.known(userId)).toBeUndefined();
    // A copy another writer left in the settings file guards meanwhile: a known guarded connection is refused outside a run.
    const file = JSON.parse(host.files.get(`${userId}/settings.json`) ?? "{}") as { agents: { acceptance: { connections: unknown } } };
    file.agents.acceptance.connections = kept;
    host.files.set(`${userId}/settings.json`, JSON.stringify(file));
    const again = back.restart();
    await expect(reserve(again, MAIN)).resolves.toMatchObject({ connection: MAIN });
    await expect(reserve(again, SONNET)).rejects.toMatchObject({ code: "acceptance" });
    expect(warnings()).toHaveLength(3);
    expect(warnings()[2]).toContain(SONNET);
    // The user sets it again: it is known, and kept, and nothing more is warned of.
    const both = [...kept, { id: CLAUDE, only: true, tokensIn: 1000, tokensOut: 100 }];
    again.body(await again.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: both } } } }));
    expect(again.rt.settings.known(userId)?.agents.acceptance.connections).toEqual(both);
    await expect(reserve(again, MAIN)).resolves.toMatchObject({ connection: MAIN });
    await expect(reserve(again, CLAUDE)).rejects.toMatchObject({ code: "acceptance" });
    await expect(reserve(again.restart(), SONNET)).rejects.toMatchObject({ code: "acceptance" });
    expect(warnings()).toHaveLength(3);
  });

  test("a guard file that can't be read lets agent calls go ahead under the settings file's own list, warned of once: it still guards a known connection, a classic turn plays, nothing is written over the file, and once it reads the guard holds", async () => {
    const rig = new Rig();
    const { userId } = rig.host;
    const chatId = await rig.worldChat();
    const kept = [{ id: SONNET, only: true, tokensIn: 1000, tokensOut: 100 }];
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { acceptance: { connections: kept } } } }));
    const stored = rig.host.files.get(`${userId}/${ACCEPTANCE_PATH}`);
    const back = rig.restart();
    const read = back.host.storage.read.bind(back.host.storage);
    let busy = true;
    back.host.storage.read = async (path, user) => {
      if (busy && path.startsWith(ACCEPTANCE_PATH)) throw new Error("storage busy");
      return read(path, user);
    };
    const reserve = async (connection: string) => back.rt.agentAccounts.reserve({ userId, connection, model: "m", tokensIn: 10, tokensOut: 10, settings: (await back.rt.settings.get(userId)).agents, signal: new AbortController().signal });
    const warnings = () => back.host.logs.filter((l) => l.startsWith("warn:") && l.includes("the acceptance runs' file couldn't be read"));
    await back.turn(chatId, "I look around.", "The street is quiet.");
    expect((await back.rt.diag.records(chatId, userId)).filter((r) => r.kind === "turn").at(-1)?.status).toBe("ok");
    // The settings serve with their own copy, unkept, so each read tries the guard again.
    expect((await back.rt.settings.get(userId)).agents.acceptance.connections).toEqual(kept);
    expect(back.rt.settings.known(userId)).toBeUndefined();
    const first = await reserve(MAIN);
    back.rt.agentAccounts.settle(first, null);
    await expect(reserve(MAIN)).resolves.toMatchObject({ connection: MAIN });
    await expect(reserve(SONNET)).rejects.toMatchObject({ code: "acceptance" });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("storage busy");
    expect(warnings()[0]).toContain(SONNET);
    expect((back.host.userLogs.get(userId) ?? []).filter((l) => l.includes("the acceptance runs' file couldn't be read"))).toHaveLength(1);
    await back.rt.agentAccounts.flushed(userId);
    expect(back.host.files.get(`${userId}/${ACCEPTANCE_PATH}`)).toBe(stored);
    busy = false;
    expect((await back.rt.settings.get(userId)).agents.acceptance.connections).toEqual(kept);
    expect(back.rt.settings.known(userId)).toBeDefined();
    await expect(reserve(MAIN)).resolves.toMatchObject({ connection: MAIN });
    await expect(reserve(SONNET)).rejects.toMatchObject({ code: "acceptance" });
    expect(warnings()).toHaveLength(1);
  });

  test("a Model Roulette is refused while any connection it may send the call on is guarded, and goes once none is", async () => {
    const ROULETTE = "conn-roulette";
    const r = rig(["Fine."], guarded());
    r.host.connectionProfiles.push({ id: ROULETTE, name: "Roulette", models: null, provider: "model_roulette", targets: [MAIN, SONNET] });
    const out = await r.start(spec({ connectionId: ROULETTE })).send("Go.");
    expect(out).toMatchObject({ status: "refused", code: "acceptance" });
    expect(out.status === "refused" ? out.reason : "").toContain(SONNET);
    expect(r.host.quietCalls).toHaveLength(0);
    // One whose connections are all unguarded goes as any connection does.
    const open = rig(["Fine."], guarded());
    open.host.connectionProfiles.push({ id: ROULETTE, name: "Roulette", models: null, provider: "model_roulette", targets: [MAIN, CLAUDE] });
    expect(await open.start(spec({ connectionId: ROULETTE })).send("Go.")).toMatchObject({ status: "answered", text: "Fine." });
    // A connection whose profile can't be read might be a roulette over a guarded one: its calls go ahead, and the log warns once.
    const unread = rig(["Fine.", "Fine again."], guarded());
    unread.host.connections.profile = async () => {
      throw new Error("the connections couldn't be listed");
    };
    const warnings = (host: FakeHost) => host.logs.filter((l) => l.startsWith("warn:") && l.includes(`connection ${CLAUDE} couldn't be read`));
    expect(await unread.start(spec({ connectionId: CLAUDE })).send("Go.")).toMatchObject({ status: "answered", text: "Fine." });
    expect(await unread.start(spec({ connectionId: CLAUDE })).send("Go.")).toMatchObject({ status: "answered", text: "Fine again." });
    expect(warnings(unread.host)).toHaveLength(1);
    // A guarded connection is known by its id, read or not: still refused outside a run.
    expect(await unread.start(spec({ connectionId: SONNET })).send("Go.")).toMatchObject({ status: "refused", code: "acceptance" });
    expect(unread.host.quietCalls).toHaveLength(2);
    // With nothing guarded, there is nothing to warn of.
    const free = rig(["Fine."]);
    free.host.connections.profile = unread.host.connections.profile;
    expect(await free.start(spec({ connectionId: CLAUDE })).send("Go.")).toMatchObject({ status: "answered", text: "Fine." });
    expect(warnings(free.host)).toEqual([]);
    // A roulette's connections are read from its own settings, each once, less itself, whether or not the host's list (100 at most) has them.
    expect(rouletteTargets({ id: ROULETTE, provider: "model_roulette", metadata: { connection_roulette: { connection_ids: [` ${SONNET} `, SONNET, ROULETTE, "conn-past-the-first-hundred", 7, ""] } } })).toEqual([SONNET, "conn-past-the-first-hundred"]);
    expect(rouletteTargets({ id: CLAUDE, provider: "anthropic", metadata: { connection_roulette: { connection_ids: [SONNET] } } })).toEqual([]);
  });
});

describe("cancel", () => {
  test("cancel stops the call under way through its signal, and the agent takes no more messages", async () => {
    const started = Promise.withResolvers<void>();
    const r = rig(() => {
      started.resolve();
      return Promise.withResolvers<QuietScript>().promise;
    });
    const agent = r.start();
    const pending = agent.send("Go.");
    await started.promise;
    agent.cancel();
    expect(await pending).toMatchObject({ status: "cancelled", code: "cancelled" });
    expect(r.host.quietStopped.length).toBe(1);
    expect(await agent.send("Again.")).toMatchObject({ status: "cancelled" });
    expect(r.host.quietCalls.length).toBe(1);
  });

  test("a send's own signal cancels it, a running tool hears it, and the run lets go of the call's hold", async () => {
    const started = Promise.withResolvers<void>();
    let heard = false;
    const waiting: AgentTool = {
      ...tool("wait"),
      run: (_args, ctx) => {
        const stopped = Promise.withResolvers<{ text: string }>();
        started.resolve();
        ctx.signal.addEventListener("abort", () => {
          heard = true;
          stopped.resolve({ text: "stopped" });
        });
        return stopped.promise;
      },
    };
    const r = rig([{ content: "", toolCalls: [call("wait")], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }, "never"]);
    const controller = new AbortController();
    const pending = r.start(spec({ tools: [waiting] })).send("Go.", controller.signal);
    await started.promise;
    controller.abort();
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(heard).toBe(true);
    expect(r.host.quietCalls.length).toBe(1);
    // A call cancelled mid-flight in a run: its hold goes, and the run counts its prompt as held, flagged as an estimate.
    const settings = defaultAgentSettings();
    const midway = Promise.withResolvers<void>();
    const run = rig(() => {
      midway.resolve();
      return Promise.withResolvers<QuietScript>().promise;
    }, settings);
    await run.accounts.open(run.host.userId, "Increment 1");
    const sonnet = run.start(spec({ connectionId: SONNET }));
    const flight = sonnet.send("Go.");
    await midway.promise;
    sonnet.cancel();
    expect(await flight).toMatchObject({ status: "cancelled" });
    const spent = (await run.accounts.state(run.host.userId, settings)).run?.connections.find((x) => x.id === SONNET);
    expect(spent?.reserved).toEqual({ tokensIn: 0, tokensOut: 0 });
    expect(spent?.spent).toMatchObject({ calls: 1, tokensOut: 0, estimated: true });
    expect(spent?.spent.tokensIn).toBeGreaterThan(0);
  });
});

describe("streaming", () => {
  /** An agent's call as the port gets it: a tool, an effort of its own, and its usage asked for. */
  const request: QuietRequest = { messages: [{ role: "user", content: "Where is Danny?" }], maxTokens: 100, json: false, connectionId: "c", model: null, tools: [{ name: "lookup", description: "Looks things up.", parameters: { type: "object" } }], effort: "high", usage: true };

  type Sent = { method: "quiet" | "quietStream"; input: Record<string, unknown> };

  /** Lumiverse's generation in the fake `spindle` global, with `connections` as a call with JSON mode off never reads it. */
  const install = (generate: Record<string, unknown>): void => void Object.assign(globalThis, { spindle: { generate, connections: { list: async () => [] } } });
  const uninstall = (): void => void Object.assign(globalThis, { spindle: undefined });

  /**
   * Lumiverse's generation as an extension's worker has it, answering every call with `answer`:
   * `generate.quiet` returns it whole; `generate.quietStream` sends its reasoning and its text a few
   * characters at a time, then its end, filled as Lumiverse fills it (the pieces joined, why it
   * ended, the tool calls and the usage).
   */
  function lumiverse(answer: Record<string, unknown>): Sent[] {
    const sent: Sent[] = [];
    const pieces = (text: unknown): string[] => (typeof text === "string" ? (text.match(/[\s\S]{1,3}/g) ?? []) : []);
    install({
      quiet: async (input: Record<string, unknown>) => (sent.push({ method: "quiet", input }), answer),
      quietStream: (input: Record<string, unknown>) => {
        sent.push({ method: "quietStream", input });
        return (async function* () {
          let reasoning = "";
          let content = "";
          for (const token of pieces(answer.reasoning)) {
            reasoning += token;
            yield { type: "reasoning", token };
          }
          for (const token of pieces(answer.content)) {
            content += token;
            yield { type: "token", token };
          }
          yield { type: "done", content, reasoning: reasoning || undefined, finish_reason: answer.finish_reason, tool_calls: answer.tool_calls, usage: answer.usage };
        })();
      },
    });
    return sent;
  }

  test("a streamed call reads as the same call answered whole, sent as the same request: its text, tool calls, reasoning, why it ended and its usage", async () => {
    const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, provider_raw: { input_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 30 } };
    const answers = [
      { content: "Let me look.", reasoning: "He was at the shop at noon.", finish_reason: "tool_calls", tool_calls: [{ name: "lookup", args: { q: "Danny" }, call_id: "toolu_1", thought_signature: "sig-1" }, { name: "lookup", args: { q: "shop" }, call_id: "toolu_2" }], usage },
      { content: "Danny is at the shop.", finish_reason: "stop", usage: { prompt_tokens: 160, completion_tokens: 8, total_tokens: 168 } },
      { content: "", finish_reason: "length" },
    ];
    try {
      const read: QuietResult[] = [];
      for (const answer of answers) {
        const sent = lumiverse(answer);
        const host = createSpindleHost();
        const signal = new AbortController().signal;
        const whole = await host.models.quiet(request, "u", signal);
        const streamed = await host.models.quiet({ ...request, stream: true }, "u", signal);
        expect(streamed).toEqual(whole);
        expect(sent.map((s) => s.method)).toEqual(["quiet", "quietStream"]);
        expect(sent[1]?.input).toEqual(sent[0]?.input ?? {});
        read.push(streamed);
      }
      expect(read[0]).toEqual({ content: "Let me look.", finishReason: "tool_calls", tokens: 150, tokensIn: 120, tokensOut: 30, toolCalls: [{ name: "lookup", args: { q: "Danny" }, callId: "toolu_1", thoughtSignature: "sig-1" }, { name: "lookup", args: { q: "shop" }, callId: "toolu_2" }], reasoning: "He was at the shop at noon.", usage });
      expect(read[1]).toMatchObject({ content: "Danny is at the shop.", finishReason: "stop", tokensIn: 160, tokensOut: 8 });
      expect(read[2]).toEqual({ content: "", finishReason: "length", tokens: 0 });
    } finally {
      uninstall();
    }
  });

  test("on by default, every agent call goes to Lumiverse as a stream; off, each is answered whole; the agent reads the same either way", async () => {
    expect(defaultAgentSettings().stream).toBe(true);
    const answer = { content: "Danny is at the shop.", finish_reason: "stop", usage: { prompt_tokens: 160, completion_tokens: 8, total_tokens: 168, provider_raw: { prompt_tokens: 160, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 128 }, completion_tokens_details: { reasoning_tokens: 0 } } } };
    const run = async (settings: AgentSettings) => {
      const sent = lumiverse(answer);
      const r = rig([], settings);
      r.host.models = createSpindleHost().models;
      const reply = await r.start().send("Where is Danny?");
      return { methods: sent.map((s) => s.method), reply: { ...reply, usage: { ...reply.usage, ms: 0 } } };
    };
    try {
      const on = await run(settingsWith());
      const off = await run(settingsWith((s) => (s.stream = false)));
      expect(on.methods).toEqual(["quietStream"]);
      expect(off.methods).toEqual(["quiet"]);
      expect(on.reply).toMatchObject({ status: "answered", text: "Danny is at the shop.", usage: { calls: 1, in: 160, cachedIn: 128, out: 8, estimated: false } });
      expect(on.reply).toEqual(off.reply);
    } finally {
      uninstall();
    }
  });

  test("a cancel mid-stream ends the call at once, as Lumiverse's AbortError, before Lumiverse answers it; the stream hears it, and is let go once Lumiverse answers", async () => {
    const streaming = Promise.withResolvers<void>();
    const answered = Promise.withResolvers<never>();
    const released = Promise.withResolvers<void>();
    let heard: AbortSignal | undefined;
    let closed = false;
    install({
      quietStream: (input: { signal?: AbortSignal }) => {
        heard = input.signal;
        return (async function* () {
          try {
            yield { type: "token", token: "Danny is" };
            streaming.resolve();
            // Nothing more comes until Lumiverse answers the cancel.
            await answered.promise;
          } finally {
            closed = true;
            released.resolve();
          }
        })();
      },
    });
    try {
      const controller = new AbortController();
      const call = createSpindleHost().models.quiet({ ...request, stream: true }, "u", controller.signal);
      await streaming.promise;
      controller.abort();
      const error = await call.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error instanceof DOMException && error.name).toBe("AbortError");
      expect(heard?.aborted).toBe(true);
      expect(closed).toBe(false);
      answered.reject(new DOMException("Generation aborted", "AbortError"));
      await released.promise;
      expect(closed).toBe(true);
      // A call cancelled before it starts asks for nothing.
      let asked = false;
      install({ quietStream: () => (async function* () { asked = true; yield { type: "token", token: "x" }; })() });
      await expect(createSpindleHost().models.quiet({ ...request, stream: true }, "u", AbortSignal.abort())).rejects.toThrow("Generation aborted");
      expect(asked).toBe(false);
    } finally {
      uninstall();
    }
  });

  test("a stream that fails fails the call with Lumiverse's error, and one that ends without its answer fails it too", async () => {
    const streams = [
      async function* () {
        yield { type: "token", token: "Dan" };
        throw new Error("429: rate limited");
      },
      async function* () {
        yield { type: "token", token: "Dan" };
      },
    ];
    let next = 0;
    install({ quietStream: () => streams[next++]?.() });
    try {
      const host = createSpindleHost();
      const signal = new AbortController().signal;
      await expect(host.models.quiet({ ...request, stream: true }, "u", signal)).rejects.toThrow("429: rate limited");
      await expect(host.models.quiet({ ...request, stream: true }, "u", signal)).rejects.toThrow("The model's stream ended without its answer");
    } finally {
      uninstall();
    }
  });

  test("an agent cancelled mid-stream stops at once, and a call's time limit counts the whole call, however long it streams", async () => {
    const streams: { signal: AbortSignal; released: PromiseWithResolvers<void> }[] = [];
    const flowing = Promise.withResolvers<void>();
    // Lumiverse's stream as it answers a cancel: pieces keep coming until the call's signal fires, then it ends in an AbortError.
    install({
      quietStream: (input: { signal: AbortSignal }) => {
        const stream = { signal: input.signal, released: Promise.withResolvers<void>() };
        streams.push(stream);
        return (async function* () {
          try {
            for (let sent = 1; ; sent++) {
              if (input.signal.aborted) throw new DOMException("Generation aborted", "AbortError");
              yield { type: "token", token: "and then " };
              if (sent === 3) flowing.resolve();
              // A real pause between pieces: the time limit under test is the runtime's own timer, which only fires between them.
              await Bun.sleep(1);
            }
          } finally {
            stream.released.resolve();
          }
        })();
      },
    });
    try {
      const r = rig([]);
      r.host.models = createSpindleHost().models;
      const agent = r.start();
      const pending = agent.send("Go.");
      await flowing.promise;
      agent.cancel();
      expect(await pending).toMatchObject({ status: "cancelled", code: "cancelled" });
      const timed = rig([]);
      timed.host.models = createSpindleHost().models;
      expect(await timed.start(spec({ budget: { ...spec().budget, callMs: 20 } })).send("Go.")).toMatchObject({ status: "refused", code: "call_time" });
      // Each stream heard its call's end, and was let go of.
      await Promise.all(streams.map((s) => s.released.promise));
      expect(streams.map((s) => s.signal.aborted)).toEqual([true, true]);
    } finally {
      uninstall();
    }
  });
});

describe("effort", () => {
  test("each effort maps to the host's reasoning choice: set by the model as auto, inherit as none; asked to, an effort of the call's own shows the model's thinking summarized", () => {
    expect((["off", "low", "medium", "high", "model", "inherit"] as const).map(effortChoice)).toEqual(["off", "low", "medium", "high", "auto", "inherit"]);
    expect(reasoningOverride(effortChoice("model"))).toMatchObject({ source: "custom", effort: "auto" });
    expect(reasoningOverride(effortChoice("inherit"))).toBeUndefined();
    expect(reasoningOverride(effortChoice("off"))).toEqual({ source: "off" });
    expect(reasoningOverride("medium")).toEqual({ source: "custom", apiReasoning: true, effort: "medium" });
    expect(reasoningOverride("medium", "summarized")).toEqual({ source: "custom", apiReasoning: true, effort: "medium", thinkingDisplay: "summarized" });
    expect(reasoningOverride("off", "summarized")).toEqual({ source: "off" });
    expect(reasoningOverride("inherit", "summarized")).toBeUndefined();
  });

  test("while Thinking in agent tool loops is off, a call that offers tools goes with reasoning off; without tools, or with it on, the agent's effort, and with it on its thinking comes back summarized", async () => {
    const ask = async (effort: AgentSpec["effort"], tools: AgentTool[], thinking: boolean) => {
      const r = rig(["Done."], settingsWith((s) => (s.thinkingInToolLoops = thinking)));
      await r.start(spec({ effort, tools })).send("Go.");
      return r.host.quietCalls[0]?.effort;
    };
    expect(await ask("high", [tool("lookup")], false)).toBe("off");
    expect(await ask("model", [tool("lookup")], false)).toBe("off");
    expect(await ask("high", [], false)).toBe("high");
    expect(await ask("model", [], false)).toBe("auto");
    expect(await ask("inherit", [], false)).toBe("inherit");
    expect(await ask("high", [tool("lookup")], true)).toBe("high");
    const display = async (thinking: boolean) => {
      const r = rig(["Done."], settingsWith((s) => (s.thinkingInToolLoops = thinking)));
      await r.start(spec({ effort: "high", tools: [tool("lookup")] })).send("Go.");
      return r.host.quietCalls[0]?.thinkingDisplay;
    };
    expect(await display(true)).toBe("summarized");
    expect(await display(false)).toBeUndefined();
    // Tools offered as text are tools offered.
    const r = rig((req) => {
      if (req.tools?.length) throw new Error("400: tools unsupported");
      return "Done.";
    });
    await r.start(spec({ effort: "high", tools: [tool("lookup")] })).send("Go.");
    expect(r.host.quietCalls.map((c) => c.effort)).toEqual(["off", "off"]);
  });
});

describe("caching", () => {
  const marks = (req: QuietRequest | undefined) => (req?.messages ?? []).flatMap((m) => (m.parts ?? []).filter((p) => p.cache === true));

  test("the stable prefix goes first, in order, with breakpoints where the provider takes them, within its limit less the connection's own", async () => {
    const r = rig([{ content: "", toolCalls: [call("lookup")] }, "Done."]);
    await r.start(spec({ connectionId: CLAUDE, prefix: ["Digest.", "Pinned notes."], tools: [tool("lookup")] })).send("Go.");
    const second = r.host.quietCalls[1];
    expect(second?.messages[0]?.parts?.map((p) => (p.type === "text" ? p.text : ""))).toEqual(["Digest.", "Pinned notes.", "You answer questions about the story."]);
    expect(marks(second).length).toBe(3);
    expect(second?.messages.at(-1)?.parts?.at(-1)?.cache).toBe(true);
    // The connection's own prompt caching marks the system messages and runs its automatic mode: two of the four are its.
    const own = rig(["Done."]);
    for (const profile of own.host.connectionProfiles) if (profile.id === CLAUDE) profile.cache = cacheBreakpoints("anthropic", { prompt_caching: true });
    await own.start(spec({ connectionId: CLAUDE })).send("Go.");
    expect(marks(own.host.quietCalls[0]).length).toBe(2);
    // A provider that takes none gets the opening as one plain text.
    const plain = rig(["Done."]);
    await plain.start(spec({ prefix: ["Digest."] })).send("Go.");
    expect(plain.host.quietCalls[0]?.messages[0]).toEqual({ role: "system", content: "Digest.\n\nYou answer questions about the story." });
  });

  test("the connection's tools caching marks the last tool alone: one of the four, however many tools, so the agent keeps its own", async () => {
    const tools = { ...NO_CACHE_OF_ITS_OWN, system: true, automatic: true, tools: true };
    expect([ownBreakpoints(tools, 0), ownBreakpoints(tools, 1), ownBreakpoints(tools, 54)]).toEqual([2, 3, 3]);
    const r = rig([{ content: "", toolCalls: [call("lookup")] }, "Done."]);
    for (const profile of r.host.connectionProfiles) if (profile.id === CLAUDE) profile.cache = cacheBreakpoints("anthropic", { prompt_caching: { breakpoints: { tools: true } } });
    await r.start(spec({ connectionId: CLAUDE, tools: [tool("lookup"), tool("other")] })).send("Go.");
    // System, automatic and the last tool are the connection's; the fourth marks the end of the agent's opening.
    expect(r.host.quietCalls.map((c) => marks(c).length)).toEqual([1, 1]);
    expect(r.host.quietCalls[0]?.messages[0]?.parts?.at(-1)?.cache).toBe(true);
  });

  test("Bust heads the role's prompt with a new key; caching off sends a fresh key every call and no breakpoints", async () => {
    const busted = rig(["Done."], settingsWith((s) => (s.caching.roles.assistant = { on: true, nonce: "k-123" })));
    await busted.start(spec({ connectionId: CLAUDE })).send("Go.");
    expect(busted.host.quietCalls[0]?.messages[0]?.content.split("\n\n")[0]).toContain("k-123");
    const off = rig([{ content: "", toolCalls: [call("lookup")] }, "Done."], settingsWith((s) => (s.caching.roles.assistant = { on: false, nonce: "" })));
    await off.start(spec({ connectionId: CLAUDE, tools: [tool("lookup")] })).send("Go.");
    const heads = off.host.quietCalls.map((c) => c.messages[0]?.content.split("\n\n")[0]);
    expect(heads[0]).not.toBe(heads[1]);
    expect(off.host.quietCalls.every((c) => marks(c).length === 0)).toBe(true);
    // Unbusted and on, no key is sent at all.
    const fresh = rig(["Done."]);
    await fresh.start(spec({ connectionId: CLAUDE, prefix: ["Digest."] })).send("Go.");
    expect(fresh.host.quietCalls[0]?.messages[0]?.parts?.[0]).toMatchObject({ text: "Digest." });
  });
});

describe("usage", () => {
  const estimate = { in: 500, out: 40, reasoningOut: 30 };

  test("each provider's raw usage is read into tokens in, cached, out and reasoning; what it never reports is a flagged estimate", () => {
    expect(parseUsage({ prompt_tokens: 1100, completion_tokens: 60, total_tokens: 1160, provider_raw: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 100, output_tokens: 60 } }, "anthropic", estimate)).toEqual({ in: 1100, cachedIn: 900, cacheWrite: 100, out: 60, reasoningOut: 30, estimated: ["reasoningOut"] });
    expect(parseUsage({ prompt_tokens: 800, completion_tokens: 90, total_tokens: 890, provider_raw: { prompt_tokens: 800, completion_tokens: 90, prompt_cache_hit_tokens: 640, prompt_cache_miss_tokens: 160, completion_tokens_details: { reasoning_tokens: 50 } } }, "deepseek", estimate)).toEqual({ in: 800, cachedIn: 640, out: 90, reasoningOut: 50, estimated: [] });
    expect(parseUsage({ prompt_tokens: 700, completion_tokens: 20, total_tokens: 720, provider_raw: { prompt_tokens: 700, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 512 }, completion_tokens_details: { reasoning_tokens: 0 } } }, "openrouter", estimate)).toEqual({ in: 700, cachedIn: 512, out: 20, reasoningOut: 0, estimated: [] });
    expect(parseUsage({ prompt_tokens: 300, completion_tokens: 40, total_tokens: 400 }, "google", estimate)).toEqual({ in: 300, cachedIn: 0, out: 100, reasoningOut: 60, estimated: ["cachedIn"] });
    expect(parseUsage({ prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 }, "openai", estimate)).toEqual({ in: 300, cachedIn: 0, out: 40, reasoningOut: 30, estimated: ["cachedIn", "reasoningOut"] });
    expect(parseUsage(undefined, "deepseek", estimate)).toEqual({ in: 500, cachedIn: 0, out: 70, reasoningOut: 30, estimated: ["in", "cachedIn", "out", "reasoningOut"] });
  });

  test("what a call wrote to the cache is the provider's count where it says, so a prefix never written tells apart from one written but not read; where it doesn't say, there is none, and no estimate", () => {
    // Anthropic says on every call: a first call writes, a second reads.
    const written = parseUsage({ prompt_tokens: 11_606, completion_tokens: 52, total_tokens: 11_658, provider_raw: { input_tokens: 14, cache_read_input_tokens: 0, cache_creation_input_tokens: 11_592, output_tokens: 52 } }, "anthropic", estimate);
    const read = parseUsage({ prompt_tokens: 11_700, completion_tokens: 56, total_tokens: 11_756, provider_raw: { input_tokens: 108, cache_read_input_tokens: 11_592, cache_creation_input_tokens: 0, output_tokens: 56 } }, "anthropic", estimate);
    expect([written.cachedIn, written.cacheWrite, read.cachedIn, read.cacheWrite]).toEqual([0, 11_592, 11_592, 0]);
    // Anthropic's own counts, with the host's prompt tokens absent, add back to what was sent.
    expect(parseUsage({ provider_raw: { input_tokens: 14, cache_read_input_tokens: 0, cache_creation_input_tokens: 11_592, output_tokens: 52 } }, "anthropic", estimate)).toMatchObject({ in: 11_606, cacheWrite: 11_592 });
    // OpenRouter's under the prompt's details; a router passing Anthropic's own, or its own name for it.
    expect(parseUsage({ prompt_tokens: 10_339, completion_tokens: 20, total_tokens: 10_359, provider_raw: { prompt_tokens: 10_339, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 10_318 } } }, "openrouter", estimate)).toMatchObject({ cachedIn: 0, cacheWrite: 10_318, estimated: ["reasoningOut"] });
    expect(parseUsage({ prompt_tokens: 900, completion_tokens: 20, total_tokens: 920, provider_raw: { prompt_tokens: 900, completion_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 880 } }, "openai", estimate).cacheWrite).toBe(880);
    expect(parseUsage({ prompt_tokens: 900, completion_tokens: 20, total_tokens: 920, provider_raw: { prompt_tokens: 900, completion_tokens: 20, cache_creation_tokens: 640 } }, "custom", estimate).cacheWrite).toBe(640);
    // DeepSeek, OpenAI's own and Gemini say nothing of it: none, and nothing estimated for it.
    for (const usage of [parseUsage({ prompt_tokens: 800, completion_tokens: 90, total_tokens: 890, provider_raw: { prompt_tokens: 800, completion_tokens: 90, prompt_cache_hit_tokens: 640, prompt_cache_miss_tokens: 160 } }, "deepseek", estimate), parseUsage({ prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 }, "openai", estimate), parseUsage({ prompt_tokens: 300, completion_tokens: 40, total_tokens: 400 }, "google", estimate)]) {
      expect(usage.cacheWrite).toBeUndefined();
      expect(usage.estimated as string[]).not.toContain("cacheWrite");
    }
  });

  test("every agent call asks for usage, and the agent's usage adds up what each call reported", async () => {
    const r = rig([
      { content: "", toolCalls: [call("lookup")], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, provider_raw: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 64 }, completion_tokens_details: { reasoning_tokens: 4 } } } },
      { content: "Done.", usage: { prompt_tokens: 150, completion_tokens: 5, total_tokens: 155, provider_raw: { prompt_tokens: 150, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 128 }, completion_tokens_details: { reasoning_tokens: 0 } } } },
    ]);
    const agent = r.start(spec({ tools: [tool("lookup")] }));
    const reply = await agent.send("Go.");
    expect(r.host.quietCalls.every((c) => c.usage === true)).toBe(true);
    expect(agent.usage()).toMatchObject({ calls: 2, in: 250, cachedIn: 192, out: 15, reasoningOut: 4, estimated: false });
    // Neither call's provider said what it wrote to the cache: the agent's usage says none either.
    expect(agent.usage().cacheWrite).toBeUndefined();
    const anthropic = rig([
      { content: "", toolCalls: [call("lookup")], usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, provider_raw: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 990, output_tokens: 10 } } },
      { content: "Done.", usage: { prompt_tokens: 1050, completion_tokens: 5, total_tokens: 1055, provider_raw: { input_tokens: 60, cache_read_input_tokens: 990, cache_creation_input_tokens: 0, output_tokens: 5 } } },
    ]);
    const claude = anthropic.start(spec({ connectionId: CLAUDE, tools: [tool("lookup")] }));
    await claude.send("Go.");
    expect(claude.usage()).toMatchObject({ calls: 2, in: 2050, cachedIn: 990, cacheWrite: 990 });
    expect(claude.transcript().entries.flatMap((e) => (e.kind === "answer" ? [e.usage.cacheWrite] : []))).toEqual([990, 0]);
    expect(reply.usage).toMatchObject({ calls: 2, in: 250 });
    expect(agent.transcript().entries.flatMap((e) => (e.kind === "answer" ? [e.usage.in] : []))).toEqual([100, 150]);
    // A provider that reports nothing leaves the runtime's estimate, flagged.
    const silent = rig(["Done."]);
    const quiet = silent.start();
    await quiet.send("Go.");
    expect(quiet.usage()).toMatchObject({ calls: 1, estimated: true });
    expect(quiet.usage().in).toBeGreaterThan(0);
  });
});

describe("the settings", () => {
  test("a new user's agent settings are §15's defaults, each one the reader keeps or falls back from", () => {
    const d = defaultAgentSettings();
    expect(d).toMatchObject({ thinkingInToolLoops: false, stream: true, turn: { tokensIn: "none", tokensOut: "none", toolTurns: "none", wallMs: "none" }, budget: { toolTurns: 10, revisions: 2, tokensIn: "none", tokensOut: "none", wallMs: "none" }, loopRepeats: 3, clipChars: 4000, throttles: [], caching: { on: true } });
    expect(d.acceptance).toEqual({ connections: [], estimateFactor: 2 });
    expect(agentSettingsOf(undefined)).toEqual(d);
    const read = agentSettingsOf({ stream: "no", loopRepeats: 1, clipChars: 0, budget: { revisions: -1, toolTurns: "none", concurrency: 0 }, turn: { tokensIn: "none" }, acceptance: { estimateFactor: 0, connections: [{ id: "__proto__" }, { id: "c1", only: false, tokensIn: 5, tokensOut: "none" }] }, throttles: [{ id: "c1", requestsPerMinute: 0, tokensPerMinute: 9000 }] });
    expect(read).toMatchObject({ stream: true, loopRepeats: 3, clipChars: 4000, budget: { revisions: 2, toolTurns: "none", concurrency: 4 }, turn: { tokensIn: "none" }, acceptance: { estimateFactor: 2, connections: [{ id: "c1", only: false, tokensIn: 5, tokensOut: "none" }] }, throttles: [{ id: "c1", requestsPerMinute: "none", tokensPerMinute: 9000 }] });
    expect(agentSettingsOf({ stream: false }).stream).toBe(false);
  });

  /** A settings file as stored, `{v: 1}` and `file`. */
  const stored = (rig: Rig, file: JsonObject): void => void rig.host.files.set(`${rig.host.userId}/settings.json`, JSON.stringify({ v: 1, ...file }));
  /** The settings a stored `file` reads as. */
  const readStored = async (file: JsonObject): Promise<UserSettings> => {
    const rig = new Rig({ shipped: true });
    stored(rig, file);
    return rig.rt.settings.get(rig.host.userId);
  };

  test("a turn budget saved at the old default, 100,000 prompt or 10,000 answer tokens, is read as No limit once; one the user chose stays", async () => {
    for (const defaults of [undefined, 2, 4]) {
      const old = await readStored({ ...(defaults !== undefined ? { defaults } : {}), agents: { turn: { tokensIn: 100_000, tokensOut: 10_000, toolTurns: 6 } } });
      expect([defaults, old.agents.turn]).toEqual([defaults, { tokensIn: "none", tokensOut: "none", toolTurns: 6, wallMs: "none" }]);
    }
    const chosen = await readStored({ defaults: 4, agents: { turn: { tokensIn: 250_000, tokensOut: 10_001 } } });
    expect([chosen.agents.turn.tokensIn, chosen.agents.turn.tokensOut]).toEqual([250_000, 10_001]);
    // Once: a file read against the defaults since revision 5 keeps the old numbers as the user's own.
    for (const defaults of [5, SETTINGS_DEFAULTS_REV]) {
      const now = await readStored({ defaults, agents: { turn: { tokensIn: 100_000, tokensOut: 10_000 } } });
      expect([defaults, now.defaults, now.agents.turn.tokensIn, now.agents.turn.tokensOut]).toEqual([defaults, SETTINGS_DEFAULTS_REV, 100_000, 10_000]);
    }
    // A lifted file saved back is at the new defaults, and reads the same again.
    const rig = new Rig({ shipped: true });
    stored(rig, { defaults: 4, agents: { turn: { tokensIn: 100_000, tokensOut: 10_000 } } });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { turn: { toolTurns: 7 } } } }));
    const saved = JSON.parse(rig.host.files.get(`${rig.host.userId}/settings.json`) ?? "{}") as JsonObject;
    expect([saved.defaults, (saved.agents as JsonObject).turn]).toEqual([SETTINGS_DEFAULTS_REV, { tokensIn: "none", tokensOut: "none", toolTurns: 7, wallMs: "none" }]);
    const again = new Rig({ shipped: true });
    stored(again, saved);
    expect((await again.rt.settings.get(again.host.userId)).agents.turn).toEqual({ tokensIn: "none", tokensOut: "none", toolTurns: 7, wallMs: "none" });
  });

  test("a role saved reading money before organizations had tools reads them too, once; a file from before revision 5 has its turn budget lifted as well", async () => {
    const roles = { intent: { families: ["people", "money", "checks"] }, scene: { families: ["people", "lore"] } };
    for (const defaults of [undefined, 4, 5]) {
      const old = await readStored({ ...(defaults !== undefined ? { defaults } : {}), agents: { turn: { tokensIn: 100_000 }, roles } });
      // Only a role that reads money gains them, after the families it had.
      expect([defaults, old.defaults, old.agents.roles.intent.families, old.agents.roles.scene.families]).toEqual([defaults, SETTINGS_DEFAULTS_REV, ["people", "money", "checks", "orgs"], ["people", "lore"]]);
      // Both lifts apply to a file older than each: the turn's old default only before revision 5.
      expect([defaults, old.agents.turn.tokensIn]).toEqual([defaults, defaults === 5 ? 100_000 : "none"]);
    }
    // Once: a role read against the new defaults without them keeps that as the user's own.
    const now = await readStored({ defaults: SETTINGS_DEFAULTS_REV, agents: { roles } });
    expect(now.agents.roles.intent.families).toEqual(["people", "money", "checks"]);
  });

  test("a swipe default saved as Re-run before revision 8 is read as Re-narrate, once; Re-narrate, and either saved at revision 8, stay; the Curator's tool list is never lifted", async () => {
    const curator = { families: [...defaultRoleSettings().curator.families] };
    const custom: { families: ToolFamily[] } = { families: ["items", "places", "people", "money", "orgs", "lore"] };
    for (const defaults of [undefined, 5, 7]) {
      const old = await readStored({ ...(defaults !== undefined ? { defaults } : {}), swipeDefault: "rerun", agents: { roles: { curator } } });
      expect([defaults, old.defaults, old.swipeDefault, old.agents.roles.curator.families]).toEqual([defaults, SETTINGS_DEFAULTS_REV, "renarrate", curator.families]);
      const own = await readStored({ ...(defaults !== undefined ? { defaults } : {}), swipeDefault: "renarrate", agents: { roles: { curator: custom } } });
      expect([defaults, own.swipeDefault, own.agents.roles.curator.families]).toEqual([defaults, "renarrate", custom.families]);
    }
    for (const swipeDefault of ["rerun", "renarrate"] as const) expect((await readStored({ defaults: SETTINGS_DEFAULTS_REV, swipeDefault })).swipeDefault).toBe(swipeDefault);
    // A new user's: a swipe re-narrates, asking nothing first; the GM page holds during a turn and built views are reused.
    const fresh = await readStored({});
    expect([fresh.swipeDefault, fresh.swipeAsk, fresh.gm, fresh.perf]).toEqual(["renarrate", false, { duringTurn: "hold" }, { reuseViews: true }]);
    const set = await readStored({ defaults: SETTINGS_DEFAULTS_REV, swipeAsk: true, gm: { duringTurn: "live" }, perf: { reuseViews: false } });
    expect([set.swipeAsk, set.gm, set.perf]).toEqual([true, { duringTurn: "live" }, { reuseViews: false }]);
    const bad = await readStored({ defaults: SETTINGS_DEFAULTS_REV, swipeAsk: "yes", gm: { duringTurn: "sometimes" }, perf: { reuseViews: 1 } });
    expect([bad.swipeAsk, bad.gm, bad.perf]).toEqual([false, { duringTurn: "hold" }, { reuseViews: true }]);
    // Once: the lifted file saved back reads as the user's choice from then on.
    const rig = new Rig({ shipped: true });
    stored(rig, { defaults: 7, swipeDefault: "rerun" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "rerun" } }));
    const saved = JSON.parse(rig.host.files.get(`${rig.host.userId}/settings.json`) ?? "{}") as JsonObject;
    expect([saved.defaults, saved.swipeDefault]).toEqual([SETTINGS_DEFAULTS_REV, "rerun"]);
    const again = new Rig({ shipped: true });
    stored(again, saved);
    expect((await again.rt.settings.get(again.host.userId)).swipeDefault).toBe("rerun");
  });

  test("what the engine keeps in memory is 64 turns, 256 gates, 256 watched chats, 16 chats in the live view, 4,000,000 characters of texts read and 65,536 messages worked out; a count under its least or not whole falls back", () => {
    expect(defaultAgentSettings().kept).toEqual({ runs: 64, gates: 256, watchers: 256, live: 16, texts: 4_000_000, folds: 65_536 });
    expect(agentSettingsOf({ kept: { runs: 0, gates: -3, watchers: 2.5, live: 0, texts: -1, folds: 0 } }).kept).toEqual({ runs: 64, gates: 256, watchers: 256, live: 16, texts: 4_000_000, folds: 65_536 });
    expect(agentSettingsOf({ kept: { runs: 1, gates: 8, watchers: 12, live: 3, texts: 0, folds: 1 } }).kept).toEqual({ runs: 1, gates: 8, watchers: 12, live: 3, texts: 0, folds: 1 });
  });

  test("Settings saves them as the other pages' settings: a list replaces whole, and a reset goes back to the default", async () => {
    const rig = new Rig();
    const set = async (patch: JsonObject) => settingsOf(rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: patch } }))).agents;
    expect((await set({ throttles: [{ id: MAIN, requestsPerMinute: 30, tokensPerMinute: "none" }] })).throttles).toEqual([{ id: MAIN, requestsPerMinute: 30, tokensPerMinute: "none", atOnce: "none" }]);
    expect((await set({ throttles: [] })).throttles).toEqual([]);
    expect((await set({ turn: { tokensOut: 20_000 } })).turn.tokensOut).toBe(20_000);
    expect((await set({ turn: { tokensOut: null } })).turn.tokensOut).toBe("none");
    expect((await set({ stream: false })).stream).toBe(false);
    expect((await set({ stream: null })).stream).toBe(true);
    // A new user's file holds none of it until they change one, and reads as the defaults.
    const fresh = new Rig();
    expect(settingsOf(fresh.body(await fresh.send({ type: "lre.settings.get" }))).agents).toEqual(defaultAgentSettings());
  });
});
