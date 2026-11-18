// A model call that failed, as the Turn page and Live draw a run (RPH's `call_failed` record): what broke
// it, where in the call, whether it was made again, after what wait and as which try of how many; and a
// turn that failed when its tries ran out says how many were made and what broke the last.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { TraceEvent, TraceRecord } from "../../src/shared/api";
import { applyRecord, EMPTY_LIVE, runOf } from "../../src/ui/live-model";
import { AgentTree, callFailedWords, replyErrorWords } from "../../src/ui/trace-view";
import { expand, textOf } from "./vnodes";

const scope = { user: "u1", chat: "c1", session: "s1", turn: "t1" };
const record = (seq: number, event: TraceEvent): TraceRecord => ({ seq, run: "r1", at: seq * 10, agent: { id: "a1", definition: "author" }, scope, event });
const usage = { calls: 1, input: 100, cacheRead: 0, cacheWrite: 0, output: 20 };
const RESET = "The connection was closed or reset: The socket connection was closed unexpectedly.";

describe("a failed model call", () => {
  test("each try is said in plain words: what broke it, where, the wait and which try of how many, or why it was not made again", () => {
    expect(callFailedWords({ kind: "call_failed", call: 2, failure: "connection", words: RESET, at: "shown", tries: 1, retries: 2, retried: true, wait: 1_000 })).toBe(
      "Call 2 failed after some of the reply was shown: the connection broke. Tried again after 1.0 s: try 2 of 3.",
    );
    expect(callFailedWords({ kind: "call_failed", call: 1, failure: "overloaded", words: "429: Slow down", at: "before", tries: 1, retries: 2, retried: true, wait: 6_500, asked: 6_500 })).toBe(
      "Call 1 failed before any answer came: the provider was busy or asked to slow down. Tried again after 6.5 s (the provider asked for 6.5 s): try 2 of 3.",
    );
    expect(callFailedWords({ kind: "call_failed", call: 4, failure: "server", words: "500: Internal", at: "thinking", tries: 3, retries: 2, retried: false })).toBe(
      "Call 4 failed while it was thinking: the provider's server failed. Not tried again: all 3 tries were made.",
    );
    expect(callFailedWords({ kind: "call_failed", call: 1, failure: "key", words: "401: invalid x-api-key", at: "before", tries: 1, retries: 2, retried: false })).toBe(
      "Call 1 failed before any answer came: the provider refused the key. Not tried again: another try cannot help.",
    );
    expect(callFailedWords({ kind: "call_failed", call: 1, failure: "timeout", words: "504: Gateway Timeout", at: "tool-call", tries: 1, retries: 2, retried: false })).toBe(
      "Call 1 failed while it was writing a tool call: it timed out, or its answer went silent too long. Not tried again: trying again after this kind of failure is switched off in Settings.",
    );
  });

  test("a turn whose tries ran out says how many were made and what broke the last", () => {
    expect(replyErrorWords({ code: "provider", detail: "529: Overloaded (overloaded_error)", broke: { failure: "overloaded", tries: 3 } }, "failed")).toBe(
      "The model's provider failed after 3 tries; the last time, the provider was busy or asked to slow down. 529: Overloaded (overloaded_error)",
    );
    expect(replyErrorWords({ code: "provider", detail: "401: invalid x-api-key" }, "failed")).toBe("The model's provider failed. 401: invalid x-api-key");
  });

  test("the run's tree draws the failed try between the call that broke and the one made again, with the provider's words", () => {
    const events: TraceEvent[] = [
      { kind: "run_started", run: "turn", turn: "new", lead: "author" },
      { kind: "agent_started", definition: "author", connection: "Main", model: "m1", session: "s1", given: [] },
      { kind: "call_started", call: 1, connection: "Main", model: "m1", messages: 2, tools: 0 },
      { kind: "call_ended", call: 1, model: "m1", text: "The hall is dark.", toolCalls: [], stop: "error", usage, ms: 900, error: RESET },
      { kind: "call_failed", call: 1, failure: "connection", words: RESET, at: "shown", tries: 1, retries: 2, retried: true, wait: 1_000 },
      { kind: "call_started", call: 2, connection: "Main", model: "m1", messages: 3, tools: 0 },
      { kind: "call_ended", call: 2, model: "m1", text: "Something moves.", toolCalls: [], stop: "stop", usage, ms: 700 },
    ];
    const model = events.reduce((live, event, i) => applyRecord(live, record(i + 1, event)), EMPTY_LIVE);
    const run = runOf(model, "r1");
    if (run === undefined) throw new Error("no run");
    const shown = textOf(expand(h(AgentTree, { run, now: 1_000 })));
    expect(shown).toContain("Call 1 failed after some of the reply was shown: the connection broke. Tried again after 1.0 s: try 2 of 3.");
    expect(shown).toContain(`In the provider's words: ${RESET}`);
  });
});
