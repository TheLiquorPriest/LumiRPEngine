// Live's controls: whether a running turn is paused is read from its own records, and each agent's session is named once from its start record.

import { describe, expect, test } from "bun:test";
import type { TraceEvent, TraceRecord } from "../../src/shared/api";
import { applyRecord, EMPTY_LIVE, pausedIn, runOf } from "../../src/ui/live-model";
import { sessionsOf } from "../../src/ui/pages/live/controls";

const scope = { user: "u1", chat: "c1", session: "s1", turn: "t1" };
const record = (seq: number, event: TraceEvent): TraceRecord => ({ seq, run: "r1", at: seq * 10, agent: { id: "a1", definition: "author" }, scope, event });

describe("Live's controls", () => {
  test("a run is paused after a paused record and goes on after the resumed one that follows it", () => {
    const paused = applyRecord(EMPTY_LIVE, record(1, { kind: "paused", call: 2 }));
    expect(pausedIn(runOf(paused, "r1") as never)).toBe(true);
    const resumed = applyRecord(paused, record(2, { kind: "resumed", call: 2, ms: 400 }));
    expect(pausedIn(runOf(resumed, "r1") as never)).toBe(false);
    const none = applyRecord(EMPTY_LIVE, record(1, { kind: "said", call: 1, text: "Mind the tide." }));
    expect(pausedIn(runOf(none, "r1") as never)).toBeNull();
  });

  test("an agent's session is named once, from the record that started the agent", () => {
    const started = applyRecord(EMPTY_LIVE, record(1, { kind: "agent_started", session: "sess-9" } as TraceEvent));
    expect(sessionsOf(runOf(started, "r1") as never)).toEqual([{ session: "sess-9", agent: "author" }]);
  });
});
