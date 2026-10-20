// Diagnostics (DESIGN §6.9): each turn's steps with their model calls and outcomes, failures with
// their reasons and fixes, the ring's bound and its storage, the log's levels and turn ids, the
// activity line, and that none of it reaches a player surface uninvited.

import { describe, expect, test } from "bun:test";
import { Diagnostics } from "../../src/backend/diagnostics";
import type { DiagRecord } from "../../src/shared/diagnostics";
import { isRecord } from "../../src/shared/json";
import type { ActivityPush } from "../../src/shared/protocol";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

const at = (turn: string | null = "gen-1") => ({ chatId: "chat-1", userId: "u1", turn });

function activities(host: FakeHost): ActivityPush[] {
  return host.sent.filter((m): m is ActivityPush => m.type === "lre.activity");
}

describe("diagnostics records", () => {
  test("a step records its time, its model calls and ok; one whose last call was cut off is failed with a fix", async () => {
    const host = new FakeHost();
    const diag = new Diagnostics(host);
    diag.begin(at());
    await diag.step(at(), "pre", "pre", async () => {
      diag.callStart("u1", "interpret");
      diag.call("u1", { purpose: "interpret", via: "helper", connection: "active", model: "m", tokensIn: 900, tokensOut: 40, finishReason: "stop", maxTokens: 2000, ms: 120, ok: true });
    });
    await diag.step(at(), "prose", "prose", async () => {
      diag.call("u1", { purpose: "outline", via: "helper", connection: "c1", model: "deepseek", tokensIn: 5000, tokensOut: 2000, finishReason: "length", maxTokens: 2000, ms: 9000, ok: true });
      return null;
    });
    diag.end(at());
    const records = await diag.records("chat-1", "u1");
    const pre = records.find((r) => r.step === "pre");
    expect(pre?.status).toBe("ok");
    expect(pre?.calls?.[0]).toMatchObject({ purpose: "interpret", tokensIn: 900, tokensOut: 40, finishReason: "stop", connection: "active", model: "m" });
    expect(pre?.end).toBeGreaterThanOrEqual(pre?.start ?? Infinity);
    const prose = records.find((r) => r.step === "prose");
    expect(prose?.status).toBe("failed");
    expect(prose?.reason).toContain("cut off at 2000 tokens");
    expect(prose?.fix).toContain("Max tokens");
    const turn = records.find((r) => r.kind === "turn");
    expect(turn?.status).toBe("failed");
    expect(turn?.turn).toBe("gen-1");
  });

  test("a step that throws is recorded failed with the error, and the error is rethrown", async () => {
    const diag = new Diagnostics(new FakeHost());
    await expect(diag.step(at(), "read", "read", async () => Promise.reject(new Error("request timed out")))).rejects.toThrow("request timed out");
    const [r] = await diag.records("chat-1", "u1");
    expect(r).toMatchObject({ kind: "step", phase: "read", status: "failed", reason: "request timed out" });
    expect(r?.fix).toContain("ran out of time");
  });

  test("the ring keeps the newest records, and a new instance reads them back from the chat's run folder", async () => {
    const host = new FakeHost();
    const diag = new Diagnostics(host, { ring: 5 });
    for (let i = 0; i < 8; i++) diag.skipped(at(`gen-${i}`), "read", "read", `skip ${i}`);
    expect((await diag.records("chat-1", "u1")).map((r) => r.reason)).toEqual(["skip 3", "skip 4", "skip 5", "skip 6", "skip 7"]);
    await diag.settle();
    const stored = host.files.get("u1/runs/chat-1/diagnostics.json");
    expect(stored).toBeDefined();
    const again = new Diagnostics(host, { ring: 5 });
    again.skipped(at("gen-8"), "read", "read", "skip 8");
    expect((await again.records("chat-1", "u1")).map((r) => r.reason)).toEqual(["skip 4", "skip 5", "skip 6", "skip 7", "skip 8"]);
  });

  test("each record goes to the user's diagnostics log at its level, tagged with its turn", () => {
    const host = new FakeHost();
    const diag = new Diagnostics(host);
    diag.failed(at("gen-9"), "pre", "interpret", "interpret answer was empty");
    diag.error(at(null), "lre.gm", new Error("boom"));
    const lines = host.userLogs.get("u1") ?? [];
    expect(lines[0]).toStartWith("warn: ");
    expect(lines[0]).toContain("pre/interpret failed");
    expect(host.logTurns.get("u1")?.[0]).toBe("gen-9");
    expect(lines[1]).toStartWith("error: ");
    expect(lines[1]).toContain("boom");
  });

  test("a request over a second is kept as slow; a quick one isn't", async () => {
    const diag = new Diagnostics(new FakeHost());
    diag.slow("u1", "chat-1", "lre.gm", 400);
    diag.slow("u1", "chat-1", "lre.gm", 4200);
    const records = await diag.records("chat-1", "u1");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: "slow", step: "lre.gm", level: "warn" });
  });

  test("writing the sections fails when no section had text for any outlet", async () => {
    const diag = new Diagnostics(new FakeHost());
    diag.sections(at(), "normal turn", [{ slot: "scene", outlet: "lre_scene", filled: false }, { slot: "people", outlet: null, filled: false }], Date.now());
    diag.sections(at("gen-2"), "normal turn", [{ slot: "scene", outlet: "lre_scene", filled: true }], Date.now());
    const [empty, filled] = await diag.records("chat-1", "u1");
    expect(empty).toMatchObject({ kind: "sections", status: "failed", path: "normal turn" });
    expect(empty?.fix).toContain("outlet");
    expect(filled?.status).toBe("ok");
    // The engine run halts on it, with the reason.
    expect(diag.failure(at())).toMatchObject({ step: "sections" });
    expect(diag.failure(at("gen-2"))).toBeNull();
  });
});

describe("activity line", () => {
  test("says what runs, counts minds under way, and turns into a failure that names only the step", async () => {
    const host = new FakeHost();
    const diag = new Diagnostics(host);
    diag.begin(at());
    expect(activities(host).at(-1)?.activity).toMatchObject({ state: "running", label: "Planning…", turn: "gen-1" });
    let during = "";
    await diag.step(at(), "pre", "pre", async () => {
      for (let i = 0; i < 3; i++) diag.callStart("u1", "mind");
      during = activities(host).at(-1)?.activity?.label ?? "";
      for (let i = 0; i < 3; i++) diag.call("u1", { purpose: "mind", via: "helper", connection: "active", model: "m", tokensIn: 1, tokensOut: null, finishReason: "", maxTokens: 10, ms: 1, ok: false, error: "Mara's secret leaked 401" });
    });
    expect(during).toBe("Asking 3 minds…");
    diag.end(at());
    const last = activities(host).at(-1)?.activity;
    expect(last).toMatchObject({ state: "failed", label: "Failed: Planning" });
    // The line carries a label, never a step's reason or a model's error.
    expect(JSON.stringify(activities(host))).not.toContain("Mara");
    diag.dismiss("chat-1", "u1");
    expect(activities(host).at(-1)?.activity).toBeNull();
  });
});

describe("diagnostics on a running chat", () => {
  test("a turn records its phases, the interceptor's fills and the turn, and keeps them in the chat's run folder", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // A model that answers every step (with nothing to change).
    rig.host.quietReply = () => "{}";
    await rig.turn(chatId, "look around", "The kitchen is quiet.");
    const reply = rig.body(await rig.send({ type: "lre.diag", chatId, op: "get" }));
    const records = (reply.records ?? []) as DiagRecord[];
    const turn = records.find((r) => r.kind === "turn");
    expect(turn).toBeDefined();
    const steps = records.filter((r) => r.turn === turn?.turn).map((r) => `${r.kind}:${r.phase}/${r.step}`);
    for (const phase of ["step:pre/pre", "step:plan/plan", "interceptor:sections/interceptor", "step:read/read", "step:memory/memory"]) expect(steps).toContain(phase);
    expect(rig.host.files.has(`${rig.host.userId}/runs/${chatId}/diagnostics.json`)).toBe(true);
    // The turn is over: the activity line went idle.
    expect(reply.activity).toBeNull();
  });

  test("a failed model call fails its step with the call's error and the turn shows failed on the activity line", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.quietReply = () => {
      throw new Error("401 unauthorized: bad API key");
    };
    await rig.turn(chatId, "I pick the lock on the cellar door", "It gives.");
    const records = (rig.body(await rig.send({ type: "lre.diag", chatId, op: "get" })).records ?? []) as DiagRecord[];
    const failed = records.find((r) => r.kind === "step" && r.status === "failed" && (r.calls ?? []).some((c) => !c.ok));
    expect(failed?.reason).toContain("401 unauthorized");
    expect(failed?.fix).toContain("API key");
    expect(records.find((r) => r.kind === "turn")?.status).toBe("failed");
    const pushes = rig.host.sent.filter((m): m is ActivityPush => m.type === "lre.activity" && m.chatId === chatId);
    expect(pushes.at(-1)?.activity?.state).toBe("failed");
  });

  test("records reach no pushed state: snapshots, deltas and the activity line carry none of their reasons", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.quietReply = () => {
      throw new Error("DIAG-SENTINEL failure");
    };
    await rig.turn(chatId, "I pick the lock on the cellar door", "It gives.");
    const records = (rig.body(await rig.send({ type: "lre.diag", chatId, op: "get" })).records ?? []) as DiagRecord[];
    expect(JSON.stringify(records)).toContain("DIAG-SENTINEL");
    const pushed = rig.host.sent.filter((m) => m.type === "lre.state.snapshot" || m.type === "lre.state.delta" || m.type === "lre.activity");
    expect(pushed.length).toBeGreaterThan(0);
    expect(JSON.stringify(pushed)).not.toContain("DIAG-SENTINEL");
    for (const m of pushed) if (m.type === "lre.activity" && m.activity) expect(Object.keys(m.activity).sort()).toEqual(["chatId", "label", "since", "state", "turn"]);
    for (const m of pushed) if (m.type === "lre.state.snapshot") expect(isRecord(m.view) && "diagnostics" in m.view).toBe(false);
  });
});
