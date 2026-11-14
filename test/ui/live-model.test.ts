// The Live page's model: a recorded stream of a turn's live events (an invented lighthouse turn: the
// Author, two sub-agents started at once, tool calls, a rule firing, a reply that streams) becomes the
// tree the page draws, in order, with nothing dropped, however the page came to hear it.

import { describe, expect, test } from "bun:test";
import type { TraceRecord } from "rp-harness/contract";
import { type AgentNode, applyLive, applyRead, applyRecord, EMPTY_LIVE, holeIn, type LiveModel, type RunNode, runTotals } from "../../src/ui/live-model";
import { CHAT, INTENT, PROGRESS, RECORDED, RECORDS, REPLY, RUN, TOTAL, turnAt } from "./recorded";

function fold(events: readonly (typeof RECORDED)[number][], from: LiveModel = EMPTY_LIVE): LiveModel {
  return events.reduce((model, event) => applyLive(model, event), from);
}

function only(model: LiveModel): RunNode {
  expect(model.runs.map((r) => r.run)).toEqual([RUN]);
  return model.runs[0] as RunNode;
}

function agent(run: RunNode, id: string): AgentNode {
  const found = run.agents.get(id);
  if (found === undefined) throw new Error(`no agent ${id}`);
  return found;
}

/** What each agent did, as the page draws it: every step by its kind and the records in it, its tool calls by name with the agents each started. */
function shape(run: RunNode): unknown {
  return {
    roots: run.roots,
    agents: [...run.agents.values()].map((a) => ({
      id: a.ref.id,
      children: a.children,
      steps: a.steps.map((s) => (s.kind === "tool" ? { tool: s.started.tool, seqs: s.seqs, agents: s.agents, ended: s.ended !== null } : s.kind === "call" ? { call: s.call, seqs: s.seqs, answered: s.answer?.text ?? null } : { note: s.record.event.kind, seqs: s.seqs })),
    })),
    reply: run.reply.text,
    progress: run.reply.progress,
    intent: run.intent,
    outcome: run.outcome?.status ?? null,
  };
}

describe("a recorded stream becomes the tree the Live page draws", () => {
  const run = only(fold(RECORDED));

  test("each agent sits under the one that started it, beside the tool call that did, in the order they began", () => {
    expect(run.roots).toEqual(["a1"]);
    const author = agent(run, "a1");
    expect(author.children).toEqual(["a2", "a3"]);
    const tools = author.steps.flatMap((s) => (s.kind === "tool" ? [{ id: s.callId, agents: s.agents }] : []));
    expect(tools).toEqual([
      { id: "call-todo-1", agents: [] },
      { id: "call-gm-1", agents: ["a2"] },
      { id: "call-moira-1", agents: ["a3"] },
      { id: "call-todo-2", agents: [] },
      { id: "call-story-1", agents: [] },
    ]);
    expect(agent(run, "a3").ref.plays).toBe("char-moira");
    expect(agent(run, "a2").startedBy).toEqual({ agent: "a1", run: RUN, call: "call-gm-1" });
  });

  test("every record is in the tree once, and each agent's steps are in the order they happened", () => {
    const seqs = [...run.agents.values()].flatMap((a) => a.steps.flatMap((s) => s.seqs));
    expect([...seqs].sort((a, b) => a - b)).toEqual(RECORDS.map((r) => r.seq));
    expect(new Set(seqs).size).toBe(RECORDS.length);
    for (const a of run.agents.values()) {
      const starts = a.steps.map((s) => s.seqs[0] as number);
      expect(starts).toEqual([...starts].sort((x, y) => x - y));
    }
    expect(run.seq).toBe(RECORDS.length);
    expect(run.waiting).toEqual([]);
  });

  test("the GM's roll, the rule that fired on it, and its ruling are its steps in that order", () => {
    const gm = agent(run, "a2");
    const kinds = gm.steps.map((s) => (s.kind === "note" ? s.record.event.kind : s.kind === "tool" ? `tool ${s.started.tool}` : `call ${s.call}`));
    expect(kinds).toEqual(["agent_started", "call 1", "tool roll", "rule_fired", "call 2", "agent_ended"]);
    const rule = gm.steps[3];
    expect(rule?.kind === "note" && rule.record.event.kind === "rule_fired" ? rule.record.event.firing.rule : null).toBe("rolls-say-why");
    const roll = gm.steps[2];
    expect(roll?.kind === "tool" ? roll.ended?.result.content : null).toEqual([{ type: "text", text: "2d6 = 4 + 1 = 5 against 8: it does not hold." }]);
  });

  test("each model call's streamed text is its whole answer, and the reply that went to the chat is the reply", () => {
    for (const a of run.agents.values()) {
      for (const step of a.steps) {
        if (step.kind !== "call") continue;
        expect(step.answer).not.toBeNull();
        expect(step.streamed.text).toBe(step.answer?.text ?? "");
      }
    }
    expect(run.reply.text).toBe(REPLY);
    expect(run.reply.progress).toEqual(PROGRESS);
    expect(run.intent).toBe(INTENT);
    expect(run.released?.form).toBe("tags");
    expect(run.outcome?.status).toBe("released");
  });

  test("its totals count every agent, call, tool call and rule, and what the run spent", () => {
    expect(runTotals(run)).toEqual({ agents: 3, calls: 5, tools: 6, rules: 1, usage: TOTAL });
  });

  test("the todo list stands as the Author last left it", () => {
    expect(agent(run, "a1").todo?.map((i) => i.done)).toEqual([true, true, true]);
  });
});

describe("however the page came to hear it", () => {
  const whole = shape(only(fold(RECORDED)));

  test("joining mid-turn and reading what came before gives the same tree", () => {
    // The page follows after the hub's 30th event, hears the next ten, then its read (taken after the 35th) comes back.
    let model = fold(RECORDED.slice(30, 40));
    const waiting = only(model);
    expect(holeIn(waiting)).toBe(1);
    model = applyRead(model, turnAt(35));
    model = fold(RECORDED.slice(40), model);
    expect(shape(only(model))).toEqual(whole);
  });

  test("an event heard twice, or a read that overlaps what came live, changes nothing", () => {
    const model = fold(RECORDED);
    const again = fold(RECORDED.slice(10, 50), model);
    expect(shape(only(again))).toEqual(whole);
    const record = RECORDS[5] as TraceRecord;
    expect(applyRecord(model, record)).toBe(model);
    expect(shape(only(applyRead(model, turnAt())))).toEqual(whole);
  });

  test("records that come past a hole wait for it, and fill in once it is read", () => {
    const traceOnly = RECORDED.filter((e) => e.kind !== "delta");
    const missing = new Set([12, 13, 14]);
    let model = fold(traceOnly.filter((e) => !(e.kind === "trace" && missing.has((e.data as unknown as TraceRecord).seq))));
    const held = only(model);
    expect(held.seq).toBe(11);
    expect(holeIn(held)).toBe(12);
    expect(held.waiting.length).toBe(RECORDS.length - 14);
    model = applyRead(model, { ...turnAt(), trace: turnAt().trace.filter((r) => r.seq >= 12) });
    const filled = only(model);
    expect(filled.seq).toBe(RECORDS.length);
    expect(holeIn(filled)).toBeNull();
    expect(shape(filled)).toEqual(whole);
  });

  test("a piece of the reply that comes past a hole waits, and the read's text fills it", () => {
    const replies = RECORDED.filter((e) => e.kind === "reply" && "text" in (e.data as object));
    const [, second, ...rest] = replies;
    let model = fold([...(second === undefined ? [] : [second]), ...rest]);
    expect(only(model).reply.text).toBe("");
    expect(holeIn(only(model))).not.toBeNull();
    model = applyRead(model, turnAt());
    expect(only(model).reply.text).toBe(REPLY);
    expect(holeIn(only(model))).toBeNull();
  });

  test("events of another kind, or of another chat's page, are not a run's", () => {
    const model = fold([{ chat: CHAT, seq: 1, kind: "state", key: "scene", at: 0, data: { scene: "harbour" } }, { chat: CHAT, seq: 2, kind: "trace", at: 0, data: { not: "a record" } }]);
    expect(model.runs).toEqual([]);
  });
});
