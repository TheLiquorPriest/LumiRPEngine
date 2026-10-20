// The frontend half of diagnostics (DESIGN §6.9): the client keeps the open chat's activity line
// (and only that chat's), the page's filters and turn timeline, and the text it copies.

import { describe, expect, test } from "bun:test";
import { diagText, elapsedText, filterRecords, groupByTurn } from "../../src/frontend/diagnostics";
import { ProtocolClient } from "../../src/frontend/protocol-client";
import type { Transport } from "../../src/frontend/protocol-client";
import type { DiagRecord } from "../../src/shared/diagnostics";

function client(): { client: ProtocolClient; push(payload: unknown): void } {
  let handler: (payload: unknown) => void = () => {};
  const transport: Transport = {
    send: () => {},
    subscribe(next) {
      handler = next;
      return () => {};
    },
  };
  const c = new ProtocolClient(transport, { schedule: (fn) => fn(), timers: { set: () => 0, clear: () => {} } });
  return { client: c, push: (payload) => handler(payload) };
}

function rec(over: Partial<DiagRecord>): DiagRecord {
  return { seq: 1, kind: "step", level: "info", turn: "gen-a", phase: "pre", step: "pre", status: "ok", start: 1000, end: 1100, ms: 100, ...over };
}

describe("activity line in the client", () => {
  test("the open chat's line is kept, another chat's is ignored, and switching chats clears it", () => {
    const { client: c, push } = client();
    void c.open("chat-1");
    push({ lre: 1, type: "lre.activity", chatId: "chat-1", activity: { chatId: "chat-1", turn: "g", state: "running", label: "Planning…", since: 5 } });
    expect(c.getState().activity?.label).toBe("Planning…");
    push({ lre: 1, type: "lre.activity", chatId: "chat-2", activity: { chatId: "chat-2", turn: "g", state: "failed", label: "Failed: Planning", since: 5 } });
    expect(c.getState().activity?.state).toBe("running");
    push({ lre: 1, type: "lre.activity", chatId: "chat-1", activity: { chatId: "chat-1", state: "bogus" } });
    expect(c.getState().activity?.state).toBe("running");
    push({ lre: 1, type: "lre.activity", chatId: "chat-1", activity: null });
    expect(c.getState().activity).toBeNull();
    push({ lre: 1, type: "lre.activity", chatId: "chat-1", activity: { chatId: "chat-1", turn: "g", state: "failed", label: "Failed: Planning", since: 5 } });
    void c.open("chat-2");
    expect(c.getState().activity).toBeNull();
  });
});

describe("Diagnostics page", () => {
  const records = [
    rec({ seq: 1, turn: "gen-a", start: 1000 }),
    rec({ seq: 2, turn: "gen-a", step: "read", phase: "read", status: "failed", level: "warn", start: 3000, reason: "read answer was empty", fix: "check the model" }),
    rec({ seq: 3, turn: null, kind: "slow", phase: "request", step: "lre.gm", start: 4000, ms: 4200 }),
    rec({ seq: 4, turn: "gen-b", start: 5000, calls: [{ purpose: "mind", via: "helper", connection: "active", model: "m", tokensIn: 10, tokensOut: 2000, finishReason: "length", maxTokens: 2000, ms: 9, ok: true }] }),
  ];

  test("filters pick problems, records with model calls, and slow requests", () => {
    expect(filterRecords(records, "problems").map((r) => r.seq)).toEqual([2]);
    expect(filterRecords(records, "calls").map((r) => r.seq)).toEqual([4]);
    expect(filterRecords(records, "slow").map((r) => r.seq)).toEqual([3]);
    expect(filterRecords(records, "all")).toHaveLength(4);
  });

  test("the timeline groups by turn, newest turn first, each in time order", () => {
    const groups = groupByTurn(records);
    expect(groups.map((g) => g.turn)).toEqual(["gen-b", null, "gen-a"]);
    expect(groups[2]?.records.map((r) => r.seq)).toEqual([1, 2]);
  });

  test("the copied text has each record's turn, outcome, reason, fix and calls", () => {
    const text = diagText(records);
    expect(text).toContain("[turn gen-a] step read/read failed 100 ms: read answer was empty");
    expect(text).toContain("fix: check the model");
    expect(text).toContain("call mind via helper on active / m: ok, 10 in, 2000 out of 2000, finish length");
  });

  test("elapsed time reads in seconds, then minutes", () => {
    expect(elapsedText(8400)).toBe("8 s");
    expect(elapsedText(65_000)).toBe("1 m 05 s");
  });
});
