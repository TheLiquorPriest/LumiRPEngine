// An agent call's telemetry and its tool block (Build C, lane C2): each call records the tools it was
// offered and what they weigh (`DiagAgentCall.offered`), from the agent's runtime to its Diagnostics
// record; a send says how its last call ended (`AgentReply.finish`), so a caller can refuse an answer
// cut at its limit; and the tool block, the same on every call, gets a cache breakpoint of its own
// where the provider takes them and the agent has one to spend.

import { describe, expect, test } from "bun:test";
import { AgentAccounts } from "../../src/backend/agents/provider";
import { type AgentSpec, type AgentTool, cutShort, SCRATCH_READ, startAgent } from "../../src/backend/agents/runtime";
import { recordAgentCalls } from "../../src/backend/agents/transcripts";
import { toolTokens } from "../../src/backend/agents/usage";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { type AgentSettings, defaultAgentSettings } from "../../src/shared/agent-settings";
import type { DiagAgentCall, DiagRecord } from "../../src/shared/diagnostics";
import { FakeHost, type QuietScript } from "../support/fake-host";

const MAIN = "conn-main";
const CLAUDE = "conn-claude";

function lookup(name: string): AgentTool {
  return { name, description: `The ${name} tool.`, parameters: { type: "object", properties: { q: { type: "string" } } }, run: async () => ({ text: `${name} done` }) };
}

function spec(over: Partial<AgentSpec> = {}): AgentSpec {
  return { role: "curator", connectionId: MAIN, model: null, effort: "medium", system: "You keep the world's things.", prefix: ["The world: a harbour town."], tools: [], budget: { ...defaultAgentSettings().budget }, ...over };
}

/** A scripted model on the fake host: Main takes no breakpoints; Claude is Anthropic, with the cache `claude` says. */
function rig(answers: QuietScript[], claude: { limit: number; system: boolean; lastMessage: boolean; tools: boolean; automatic: boolean }, settings: AgentSettings = defaultAgentSettings()) {
  const host = new FakeHost();
  host.activeConnection = { id: MAIN, name: "Main" };
  host.connectionProfiles.push({ id: CLAUDE, name: "Claude", models: ["claude-sonnet"], provider: "anthropic", cache: claude });
  let n = 0;
  host.quietReply = () => {
    const answer = answers[n++];
    if (answer === undefined) throw new Error(`no answer scripted for call ${n}`);
    return answer;
  };
  const deps = { host, userId: host.userId, settings, texts: {}, accounts: new AgentAccounts(host), turn: null };
  return { host, start: (s: AgentSpec) => startAgent(s, deps) };
}

const call = (name: string): QuietToolCall => ({ name, args: { q: "keys" }, callId: `call_${name}` });
const OWN_SYSTEM = { limit: 4, system: true, lastMessage: false, tools: false, automatic: false };
const marks = (req: QuietRequest | undefined) => (req?.messages ?? []).flatMap((m) => (m.parts ?? []).filter((p) => p.cache === true)).length;
const toolMarks = (req: QuietRequest | undefined) => (req?.tools ?? []).map((t) => t.cache === true);

describe("what a call was offered", () => {
  test("each answer records its tools and their weight, the same on every call, and its Diagnostics record carries them", async () => {
    const r = rig([{ content: "", toolCalls: [call("items_find")] }, "Done."], OWN_SYSTEM);
    const agent = r.start(spec({ tools: [lookup("items_find"), lookup("item_move")] }));
    expect(await agent.send("Curate.")).toMatchObject({ status: "answered", finish: "stop" });
    const sent = r.host.quietCalls[0]?.tools ?? [];
    expect(sent.map((t) => t.name)).toEqual(["items_find", "item_move", SCRATCH_READ]);
    const weight = toolTokens(sent.map(({ name, description, parameters }) => ({ name, description, parameters })));
    const answers = agent.transcript().entries.filter((e) => e.kind === "answer");
    expect(answers.map((e) => (e.kind === "answer" ? e.offered : null))).toEqual([
      { tools: 3, tokens: weight },
      { tools: 3, tokens: weight },
    ]);
    const records: Omit<DiagAgentCall, "text">[] = [];
    await recordAgentCalls({ agentCall: async (_at, _phase, record) => (records.push(record), {} as DiagRecord) }, { at: { chatId: "c", userId: r.host.userId, turn: "t" }, phase: "read", role: "curator", connection: MAIN, model: null, transcript: agent.transcript() });
    expect(records.map((x) => x.offered)).toEqual([
      { tools: 3, tokens: weight },
      { tools: 3, tokens: weight },
    ]);
    // An agent with no tools is offered none, and its record says nothing of it.
    const bare = rig(["Hello."], OWN_SYSTEM);
    const plain = bare.start(spec());
    await plain.send("Hi.");
    expect(plain.transcript().entries.find((e) => e.kind === "answer")).not.toHaveProperty("offered");
  });

  test("a send says how its last call ended, so an answer cut at its limit can be told apart, as every provider words it", async () => {
    const r = rig([{ content: "A summary that stops mid", finishReason: "length" }], OWN_SYSTEM);
    const reply = await r.start(spec()).send("Summarize.");
    expect(reply).toMatchObject({ status: "answered", finish: "length" });
    // OpenAI's chat `length` and Responses `max_output_tokens`, Anthropic's `max_tokens`, Google's and Vertex's `MAX_TOKENS`.
    expect([cutShort(reply.finish), cutShort("max_output_tokens"), cutShort("max_tokens"), cutShort("MAX_TOKENS")]).toEqual([true, true, true, true]);
    expect([cutShort("stop"), cutShort("STOP"), cutShort("tool_calls"), cutShort("content_filter"), cutShort(undefined)]).toEqual([false, false, false, false, false]);
  });
});

describe("the tool block's breakpoint", () => {
  test("with a third breakpoint to spend, it goes after the last tool instead of the shared prefix, every call", async () => {
    const r = rig([{ content: "", toolCalls: [call("items_find")] }, "Done."], OWN_SYSTEM);
    await r.start(spec({ connectionId: CLAUDE, tools: [lookup("items_find"), lookup("item_move")] })).send("Curate.");
    // Four, less the connection's own system mark: the opening, the conversation, and the tool block.
    expect(r.host.quietCalls.map(toolMarks)).toEqual([
      [false, false, true],
      [false, false, true],
    ]);
    expect(r.host.quietCalls.map(marks)).toEqual([2, 2]);
  });

  test("none where the connection marks its tools itself, where only two are left, with caching off, or on a provider that takes none", async () => {
    const own = rig(["Done."], { ...OWN_SYSTEM, tools: true });
    await own.start(spec({ connectionId: CLAUDE, tools: [lookup("items_find")] })).send("Curate.");
    expect(toolMarks(own.host.quietCalls[0])).toEqual([false, false]);
    const two = rig(["Done."], { ...OWN_SYSTEM, automatic: true });
    await two.start(spec({ connectionId: CLAUDE, tools: [lookup("items_find")] })).send("Curate.");
    expect(toolMarks(two.host.quietCalls[0])).toEqual([false, false]);
    expect(marks(two.host.quietCalls[0])).toBe(2);
    const off = defaultAgentSettings();
    off.caching.roles.curator = { on: false, nonce: "" };
    const uncached = rig(["Done."], OWN_SYSTEM, off);
    await uncached.start(spec({ connectionId: CLAUDE, tools: [lookup("items_find")] })).send("Curate.");
    expect(toolMarks(uncached.host.quietCalls[0])).toEqual([false, false]);
    const plain = rig(["Done."], OWN_SYSTEM);
    await plain.start(spec({ tools: [lookup("items_find")] })).send("Curate.");
    expect(toolMarks(plain.host.quietCalls[0])).toEqual([false, false]);
  });
});
