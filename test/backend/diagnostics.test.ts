// Diagnostics (DESIGN §6.9): each turn's steps with their model calls and outcomes, failures with
// their reasons and fixes, the ring's bound and its storage, the log's levels and turn ids, the
// activity line, that none of it reaches a player surface uninvited, and agent calls with their
// texts as blobs (DESIGN §4.4), their retention and `lre.diag`'s `text`.

import { describe, expect, test } from "bun:test";
import { BlobStore } from "../../src/backend/agents/blobs";
import { Diagnostics } from "../../src/backend/diagnostics";
import type { DiagAgentCall, DiagRecord } from "../../src/shared/diagnostics";
import { isRecord } from "../../src/shared/json";
import type { Limit } from "../../src/shared/minds";
import type { ActivityPush } from "../../src/shared/protocol";
import { blobHash, DAY_MS } from "../../src/shared/stores";
import { FakeHost } from "../support/fake-host";
import { alderChat, fakeModels } from "../support/mind-chat";
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
  test("a turn records its phases, the engine run's fills and the turn, and keeps them in the chat's run folder", async () => {
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
    for (const phase of ["step:pre/pre", "step:plan/plan", "sections:sections/sections", "step:read/read", "step:memory/memory"]) expect(steps).toContain(phase);
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

  test("records reach no pushed state but the failed run's flag: snapshots, deltas and the activity line carry no other reason", async () => {
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
    // The failed run's flag says what failed and why (DESIGN §5.1); no other pushed text carries a reason.
    const text = JSON.stringify(pushed);
    const flagged = '"detail":"Reading your action: DIAG-SENTINEL failure"';
    expect(text).toContain(flagged);
    expect(text.split("DIAG-SENTINEL").length).toBe(text.split(flagged).length);
    // The line carries its step's label and whether Cancel can stop it, nothing else.
    for (const m of pushed) if (m.type === "lre.activity" && m.activity) expect(Object.keys(m.activity).filter((k) => k !== "cancellable").sort()).toEqual(["chatId", "label", "since", "state", "turn"]);
    for (const m of pushed) if (m.type === "lre.state.snapshot") expect(isRecord(m.view) && "diagnostics" in m.view).toBe(false);
  });
});

describe("the minds' memory beside the reply's read", () => {
  test("a memory cut off at its token limit is the minds' own failed step, never the read's: the line doesn't say reading the reply failed", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    const answer = rig.host.quietReply;
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("You keep the memory of") ? { content: "", finishReason: "length" } : answer ? answer(req) : "{}");
    const chatId = await alderChat(rig, async () => {});
    await rig.turn(chatId, "Hello, Danny.", "He looks up from the bench.");
    const records = (rig.body(await rig.send({ type: "lre.diag", chatId, op: "get" })).records ?? []) as DiagRecord[];
    const read = records.findLast((r) => r.kind === "step" && r.step === "read");
    const minds = records.findLast((r) => r.kind === "step" && r.step === "minds");
    expect(read?.status).toBe("ok");
    expect((read?.calls ?? []).map((c) => c.purpose)).not.toContain("memory");
    expect(minds).toMatchObject({ phase: "memory", status: "failed", reason: expect.stringContaining("memory answer cut off") });
    // The knowledge step's call answered after the memory's, and the memory's cut-off still fails the step.
    expect((minds?.calls ?? []).at(-1)).toMatchObject({ purpose: "knowledge", ok: true });
    expect(activities(rig.host).filter((m) => m.chatId === chatId).at(-1)?.activity).toMatchObject({ state: "failed", label: "Failed: Updating the characters' memories" });
  });
});

const gmCall = (over: Partial<Omit<DiagAgentCall, "text">> = {}): Omit<DiagAgentCall, "text"> => ({ role: "gm", connection: "c1", model: "deepseek-v4-flash", usage: { in: 1200, cachedIn: 800, out: 300, reasoningOut: 120, estimated: ["reasoningOut"] }, ms: 2500, outcome: "ok", tools: ["lore_search"], ...over });

describe("agent calls", () => {
  test("a record keeps the call's role, model, usage and outcome, and its text as a stored blob", async () => {
    const host = new FakeHost();
    const blobs = new BlobStore(host);
    const diag = new Diagnostics(host, { blobs });
    await diag.agentCall(at(), null, gmCall(), "user: who keeps the lighthouse?");
    const [record] = await diag.records("chat-1", "u1");
    expect(record).toMatchObject({ kind: "agent", status: "ok", agent: { role: "gm", connection: "c1", model: "deepseek-v4-flash", usage: { in: 1200, cachedIn: 800, out: 300, reasoningOut: 120, estimated: ["reasoningOut"] }, ms: 2500, outcome: "ok", tools: ["lore_search"] } });
    const hash = record?.agent?.text ?? "";
    expect(await blobs.get("u1", hash)).toBe("user: who keeps the lighthouse?");
    expect(await diag.transcripts("chat-1", "u1")).toEqual([hash]);
  });

  test("a failed agent call shows failed, but never fails a classic turn or its activity line", async () => {
    const host = new FakeHost();
    const diag = new Diagnostics(host);
    diag.begin(at());
    await diag.agentCall(at(), "pre", gmCall({ outcome: "failed", error: "401 unauthorized", usage: null }));
    expect(diag.failure(at())).toBeNull();
    diag.end(at());
    const records = await diag.records("chat-1", "u1");
    expect(records.find((r) => r.kind === "agent")).toMatchObject({ status: "failed", agent: { outcome: "failed", usage: null, error: "401 unauthorized" } });
    expect(records.find((r) => r.kind === "turn")?.status).toBe("ok");
    expect(activities(host).at(-1)?.activity).toBeNull();
  });

  test("past transcript retention a record keeps no text and transcripts() no longer lists it; none keeps it while the record stays; 0 stores none", async () => {
    let now = 1_000_000;
    const host = new FakeHost();
    const blobs = new BlobStore(host);
    const days = new Map<string, Limit>([["u1", 2], ["u2", "none"], ["u3", 0]]);
    const options = { blobs, now: () => now, transcriptDays: (u: string) => days.get(u) ?? 2 };
    const diag = new Diagnostics(host, options);
    await diag.agentCall(at(), null, gmCall(), "text one");
    await diag.agentCall({ chatId: "chat-2", userId: "u2", turn: null }, null, gmCall(), "text two");
    await diag.agentCall({ chatId: "chat-3", userId: "u3", turn: null }, null, gmCall(), "text three");
    now += DAY_MS;
    expect(await diag.transcripts("chat-1", "u1")).toEqual([blobHash("text one")]);
    now += 2 * DAY_MS;
    expect(await diag.transcripts("chat-1", "u1")).toEqual([]);
    const [kept] = await diag.records("chat-1", "u1");
    expect(kept).toMatchObject({ kind: "agent", agent: { role: "gm", outcome: "ok" } });
    expect(kept?.agent?.text).toBeUndefined();
    expect(await diag.transcripts("chat-2", "u2")).toEqual([blobHash("text two")]);
    expect((await diag.records("chat-3", "u3"))[0]?.agent?.text).toBeUndefined();
    expect(await blobs.list("u3")).toEqual([]);
    // The stored file lets go of the text too, and a chat read from its file alone answers the same.
    await diag.settle();
    expect(host.files.get("u1/runs/chat-1/diagnostics.json")).not.toContain(blobHash("text one"));
    const again = new Diagnostics(host, options);
    expect(await again.transcripts("chat-1", "u1")).toEqual([]);
    expect(await again.transcripts("chat-2", "u2")).toEqual([blobHash("text two")]);
  });

  test("the ring follows each user's records per chat", async () => {
    const ring = new Map([["u1", 2], ["u2", 4]]);
    const diag = new Diagnostics(new FakeHost(), { ring: (u) => ring.get(u) ?? 400 });
    for (let i = 0; i < 5; i++) {
      diag.skipped(at(`gen-${i}`), "read", "read", `skip ${i}`);
      diag.skipped({ chatId: "chat-2", userId: "u2", turn: `gen-${i}` }, "read", "read", `skip ${i}`);
    }
    expect((await diag.records("chat-1", "u1")).map((r) => r.reason)).toEqual(["skip 3", "skip 4"]);
    expect(await diag.records("chat-2", "u2")).toHaveLength(4);
    ring.set("u2", 1);
    expect((await diag.records("chat-2", "u2")).map((r) => r.reason)).toEqual(["skip 4"]);
  });

  test("a file stored before agent calls reads as before, and a malformed agent call is dropped from its record only", async () => {
    const host = new FakeHost();
    const old = { seq: 1, kind: "step", level: "info", turn: "gen-1", phase: "pre", step: "pre", status: "ok", start: 1, end: 2, ms: 1, calls: [{ purpose: "interpret", via: "helper", connection: "active", model: "m", tokensIn: 9, tokensOut: 3, finishReason: "stop", maxTokens: 100, ms: 1, ok: true }] };
    const bad = { seq: 2, kind: "agent", level: "info", turn: null, phase: null, step: "gm", status: "ok", start: 3, end: 4, ms: 1, agent: { role: "gm", usage: "lots" } };
    host.files.set("u1/runs/chat-1/diagnostics.json", JSON.stringify({ v: 1, records: [old, bad] }));
    const records = await new Diagnostics(host).records("chat-1", "u1");
    expect(records[0]).toEqual(old as DiagRecord);
    expect(records[1]).toMatchObject({ kind: "agent", step: "gm", status: "ok" });
    expect(records[1]?.agent).toBeUndefined();
  });
});

describe("an agent call's text through lre.diag", () => {
  test("the text op answers a text one of the chat's records keeps, and refuses any other blob", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const userId = rig.host.userId;
    await rig.rt.diag.agentCall({ chatId, userId, turn: null }, null, gmCall(), "assistant: the keeper's log names Sam.");
    const records = (rig.body(await rig.send({ type: "lre.diag", chatId, op: "get" })).records ?? []) as DiagRecord[];
    const hash = records.find((r) => r.kind === "agent")?.agent?.text ?? "";
    expect(rig.body(await rig.send({ type: "lre.diag", chatId, op: "text", hash })).text).toBe("assistant: the keeper's log names Sam.");
    const other = await rig.rt.blobs.put(userId, "a workspace file");
    expect(await rig.send({ type: "lre.diag", chatId, op: "text", hash: other })).toMatchObject({ type: "lre.error", code: "not_found" });
  });
});
