// Row 0.2's counters over recorded turns (PlanGates-24 items 1, 2, 3 and 5): every outcome of the tag form,
// the two-step form's kept turn and its misses, the sampling arms, and the crossing check over eight agents
// (one event filed under the wrong agent fails). All turns are made up.

import { describe, expect, test } from "bun:test";
import type { ToolCallView, TraceDelta, TraceEvent, TraceRecord } from "rp-harness/contract";
import { crossing, formCount, samplingArm, samplingTurn, samplingVerdict, tagsOf, tagsTurn, twoStepTurn, type AtOnce, type ReplyTags } from "../../../../scripts/proof/lib/phase0";

const TAGS: ReplyTags = { reply: "reply", intent: "intent", intentFile: "scratch/intent.md" };
const SCOPE = { user: "u", chat: "c", session: "s", turn: "t-1" };

/** A turn's records for one agent in one run, in order. */
function records(agent: string, run: string, events: [number, TraceEvent][]): TraceRecord[] {
  return events.map(([at, event], i) => ({ seq: i + 1, run, scope: SCOPE, at, agent: { id: agent, definition: "author" }, event }));
}

const call = (n: number, at: number): [number, TraceEvent] => [at, { kind: "call_started", call: n, connection: "c", model: "m", messages: 3, tools: 4 }];
const ended = (n: number, at: number, text: string, toolCalls: ToolCallView[] = []): [number, TraceEvent] => [at, { kind: "call_ended", call: n, model: "m", text, toolCalls, stop: "stop", usage: { calls: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, ms: 1 }];
const released = (at: number, form: "tags" | "message"): [number, TraceEvent] => [at, { kind: "released", release: { by: { id: "lead", definition: "author" }, form, length: 10 } }];
const head: [number, TraceEvent][] = [[1, { kind: "run_started", run: "turn", turn: "new", lead: "author" }]];
const tool = (callId: string, name: string, args: Record<string, string>, at: number): [number, TraceEvent] => [at, { kind: "tool_started", callId, tool: name, args, closing: false }];
const toolEnded = (callId: string, name: string, at: number, error = false): [number, TraceEvent] => [at, { kind: "tool_ended", callId, tool: name, result: { content: [{ type: "text", text: "x" }], ...(error ? { error: true as const } : {}) }, clean: !error, endedRun: false, ms: 1 }];

const IN = "<intent>wants: shelter</intent>";
const REPLY = "<reply>Marta nods and sets down the cup.</reply>";
const tagTurn = (text: string, toolCalls: ToolCallView[] = [], second = false): TraceRecord[] => records("lead", "run-1", [...head, call(1, 2), ended(1, 20, text, toolCalls), ...(second ? [call(2, 30)] : []), released(second ? 40 : 10, "tags")]);

describe("the tag form's outcomes", () => {
  test("a kept turn, and each way a turn is not kept: tool calls first, no intent tag, unclosed tags, a leak, a reminder", () => {
    const read = (text: string, toolCalls: ToolCallView[] = [], second = false) => tagsTurn(tagTurn(text, toolCalls, second), TAGS);
    expect(read(`${IN}\n${REPLY}`)).toBe("kept");
    expect(read("", [{ id: "a", name: "lore_search", args: {} }])).toBe("tool-calls-first");
    expect(read(REPLY)).toBe("no-intent-tag");
    expect(read("<intent>wants: shelter")).toBe("intent-unclosed");
    expect(read(IN)).toBe("no-reply-tag");
    expect(read(`${IN}<reply>She nods`)).toBe("reply-unclosed");
    expect(read(`${IN}${REPLY} <tool_call>x</tool_call>`)).toBe("leaked");
    expect(read(`${IN}${REPLY}`, [], true)).toBe("reminded");
    expect(tagsTurn([], TAGS)).toBe("no-first-message");
  });

  test("28 of 30 passes; 27 fails; fewer than thirty are not judged unless 28 is out of reach", () => {
    const turns = (kept: number, of: number) => Array.from({ length: of }, (_, i) => (i < kept ? "kept" : "no-intent-tag"));
    expect(formCount(turns(28, 30)).verdict).toBe("pass");
    expect(formCount(turns(27, 30)).verdict).toBe("fail");
    expect(formCount(turns(10, 12)).verdict).toBe("not judged");
    expect(formCount(turns(5, 10)).verdict).toBe("fail");
    // The scripted model that drops the intent tag in 3 turns of 30 reads as a fail.
    expect(formCount(Array.from({ length: 30 }, (_, i) => (i < 3 ? "no-intent-tag" : "kept"))).verdict).toBe("fail");
  });

  test("the tags are the reply contract's header, never defaulted", () => {
    expect(tagsOf("---\ntags:\n  reply: reply\n  intent: intent\nintent_file: scratch/intent.md\n---\nbody")).toEqual(TAGS);
    expect(tagsOf("no header")).toEqual({ none: "the reply contract has no header that parses" });
    expect(tagsOf("---\ntags:\n  reply: reply\n---\n")).toEqual({ none: "the reply contract's header names no tags.reply and tags.intent" });
  });
});

describe("the two-step form", () => {
  const write: ToolCallView = { id: "w", name: "file_write", args: { path: "scratch/intent.md" } };
  const kept = (): TraceRecord[] =>
    records("lead", "run-1", [...head, call(1, 2), tool("w", "file_write", { path: "scratch/intent.md" }, 5), ended(1, 8, "", [write]), call(2, 12), ended(2, 30, "Marta nods and sets down the cup."), released(30, "message")]);

  test("intent first, the reply a message of its own, no working text: kept, with exactly 2 calls", () => {
    expect(twoStepTurn(kept(), TAGS)).toEqual({ outcome: "kept", calls: 2 });
  });

  test("a reply before any intent record, a reply that is not a message, working text shown, and no reply are each named", () => {
    const lookup = records("lead", "run-1", [...head, call(1, 2), tool("l", "lore_search", { query: "reef" }, 5), ended(1, 8, ""), call(2, 12), ended(2, 30, "A reply."), released(30, "message")]);
    expect(twoStepTurn(lookup, TAGS).outcome).toBe("intent-not-first");
    expect(twoStepTurn(kept().map((r) => (r.event.kind === "released" ? { ...r, event: { ...r.event, release: { ...r.event.release, form: "file" as const } } } : r)), TAGS).outcome).toBe("reply-not-a-message");
    expect(twoStepTurn(kept().map((r) => (r.event.kind === "call_ended" && r.event.call === 1 ? { ...r, event: { ...r.event, text: "Let me think about the scene first." } } : r)), TAGS).outcome).toBe("working-text-shown");
    expect(twoStepTurn(records("lead", "run-1", [...head, call(1, 2)]), TAGS)).toEqual({ outcome: "no-reply", calls: null });
  });
});

describe("the Author's calls under a preset's sampling", () => {
  const withCall = (text: string, error = false) => records("lead", "run-1", [...head, call(1, 2), tool("a", "lore_search", { query: "reef" }, 4), toolEnded("a", "lore_search", 6, error), ended(1, 8, text), released(9, "tags")]);

  test("a clean turn, a call that ended in an error, a call that never ran, and tool-call text in the reply", () => {
    expect(samplingTurn(withCall("A reply."))).toMatchObject({ made: 1, failed: [], leaked: false, clean: true });
    expect(samplingTurn(withCall("A reply.", true))).toMatchObject({ failed: ["lore_search: it ended in an error"], clean: false });
    expect(samplingTurn(records("lead", "run-1", [...head, call(1, 2), tool("a", "lore_search", {}, 4), ended(1, 8, "x"), released(9, "tags")])).failed).toEqual(["lore_search: it never ran"]);
    expect(samplingTurn(withCall("Here <tool_call>{}</tool_call>")).leaked).toBe(true);
    expect(samplingTurn(records("lead", "run-1", [...head, call(1, 2), ended(1, 8, "x"), released(9, "tags")])).clean).toBe(false);
  });

  test("the preset arm survives when it is as clean as the own arm; a malformed call in the preset arm fails", () => {
    const clean = Array.from({ length: 10 }, () => samplingTurn(withCall("A reply.")));
    const own = samplingArm("own", clean);
    expect(samplingVerdict(own, samplingArm("preset", clean)).verdict).toBe("survive");
    const broken = [...clean.slice(0, 9), samplingTurn(withCall("A reply.", true))];
    expect(samplingVerdict(own, samplingArm("preset", broken)).verdict).toBe("do not survive");
    expect(samplingVerdict(samplingArm("own", []), own).verdict).toBe("not judged");
  });
});

describe("eight agents at once", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `agent-${i + 1}`);
  /** Eight runs, each its own run, agent, calls and pieces. */
  function eight(): AtOnce {
    const trace = ids.flatMap((agent, i) => records(agent, `run-${i + 1}`, [[1, { kind: "run_started", run: "job", lead: "author" }], [2, { kind: "agent_started", definition: "author", connection: "c", model: "m", session: `s-${i}`, given: [] }], call(1, 3), tool(`t-${i}`, "recall", {}, 4), toolEnded(`t-${i}`, "recall", 5), ended(1, 9, `piece of ${agent}`), [10, { kind: "agent_ended", status: "done", usage: { calls: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } }]]));
    const deltas: TraceDelta[] = ids.flatMap((agent, i) => [{ run: `run-${i + 1}`, agent, call: 1, text: `piece of ${agent}`, at: 6 + i }]);
    return { agents: ids, trace, deltas, transcripts: ids.map((agent, i) => ({ agent, run: `run-${i + 1}`, roles: ["user", "assistant", "user", "assistant"] })), marker: Object.fromEntries(ids.map((a) => [a, `piece of ${a}`])) };
  }

  test("no event crossed, all eight finish, their transcripts whole", () => {
    expect(crossing(eight())).toMatchObject({ crossed: [], unfinished: [], checked: { pieces: 8 } });
  });

  test("one piece filed under the wrong agent, one tool's end under another run, an unfinished agent and a transcript with a placeholder each fail", () => {
    const run = eight();
    const [first] = run.deltas;
    if (first === undefined) throw new Error("no piece");
    const wrong = { ...run, deltas: [{ ...first, agent: "agent-2" }, ...run.deltas.slice(1)] };
    expect(crossing(wrong).crossed.join("\n")).toContain("filed under agent-2 in run-1 call 1: no model call of that run, agent and call began");
    expect(crossing(wrong).crossed.join("\n")).toContain("holds agent-1's marker");
    const tools = { ...run, trace: run.trace.map((r) => (r.event.kind === "tool_ended" && r.agent.id === "agent-3" ? { ...r, run: "run-4" } : r)) };
    expect(crossing(tools).crossed.join("\n")).toContain("tool call t-2 began in run-3 by agent-3");
    const lost = { ...run, trace: run.trace.filter((r) => !(r.agent.id === "agent-5" && r.event.kind === "agent_ended")), transcripts: run.transcripts.map((t) => (t.agent === "agent-6" ? { ...t, roles: ["user"] } : t.agent === "agent-7" ? { ...t, texts: ["No result provided"] } : t)) };
    expect(crossing(lost).unfinished).toEqual(["agent-5: it never ended", "agent-6: its transcript is not whole (1 message(s), ending on user)", "agent-7: its transcript holds a placeholder for work that was cut off"]);
  });
});
