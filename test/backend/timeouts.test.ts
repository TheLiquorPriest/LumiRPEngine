// Timeouts (DESIGN §5.6): each wall clock is the user's setting with no ceiling, it reaches what it
// limits, an older settings file's budgets move into it, and one that runs out says so in the
// diagnostics, naming its setting.

import { afterEach, describe, expect, test, vi } from "bun:test";
import { defaultSettings, SettingsStore } from "../../src/backend/settings-store";
import { phaseBudget } from "../../src/backend/turn-steps";
import type { JsonObject } from "../../src/shared/json";
import { SETTINGS_DEFAULTS_REV } from "../../src/shared/settings";
import { defaultTimeouts, firedTimeout, HOST_LIMITS, hostBound, migrateTimeouts, timeoutSignal, timerMs, TIMER_MAX_MS, TimeoutFired } from "../../src/shared/timeouts";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

describe("timeouts", () => {
  afterEach(() => vi.useRealTimers());

  test("a phase's time is the user's setting: its budget aborts with that setting named, the lookup window too", async () => {
    vi.useFakeTimers();
    const settings = { modelUse: defaultSettings().modelUse, timeouts: { ...defaultTimeouts(), engineRunMs: 30, postReplyMs: 4_000_000_000, postLookupMs: 0 } };
    const pre = phaseBudget(settings, "pre");
    const post = phaseBudget(settings, "post");
    vi.advanceTimersByTime(31);
    expect(firedTimeout(pre.signal)).toMatchObject({ key: "engineRunMs", ms: 30 });
    expect(firedTimeout(pre.signal)?.message).toContain("Settings → Timeouts → Engine run");
    // Past what a timer can wait, a limit runs as none: it never fires at once.
    expect(post.signal.aborted).toBe(false);
    expect(post.take()).toBe(true);
    expect(post.lookup.hold()).toBe(false);
    expect(post.lookup.stopped).toContain("Lore lookups after the reply");
  });

  test("values far past the old caps are kept, and only what Lumiverse limits is bounded when asked of it", async () => {
    const host = new FakeHost();
    const store = new SettingsStore(host);
    const set = await store.set(host.userId, { timeouts: { engineRunMs: 3_600_000, postReplyMs: 7_200_000, preLookupMs: 900_000, requestMs: "none", jobCallMs: 86_400_000, laneStartupMs: 600_000, laneHeartbeatMs: "none" } });
    expect(set.timeouts).toMatchObject({ engineRunMs: 3_600_000, postReplyMs: 7_200_000, preLookupMs: 900_000, requestMs: "none", jobCallMs: 86_400_000, laneStartupMs: 600_000, laneHeartbeatMs: "none" });
    // A value below a setting's least can't be stored: it reads as the default, as any malformed setting does.
    const refused = await store.set(host.userId, { timeouts: { engineRunMs: 0, requestMs: 10 } });
    expect(refused.timeouts).toMatchObject({ engineRunMs: 300_000, requestMs: 300_000, postReplyMs: 7_200_000 });
    expect(hostBound(HOST_LIMITS.processStartup, set.timeouts.laneStartupMs)).toBe(120_000);
    expect(hostBound(HOST_LIMITS.processHeartbeat, set.timeouts.laneHeartbeatMs)).toBe(0);
    expect(timerMs(TIMER_MAX_MS)).toBeNull();
    expect(timeoutSignal("requestMs", 30 * 86_400_000)).toBeNull();
  });

  test("an older file's wall clocks and lookup windows move into Timeouts: old defaults rise, the user's own values stay", () => {
    const old = defaultSettings();
    const raw = JSON.parse(JSON.stringify({ ...old, timeouts: undefined, modelUse: { ...old.modelUse, preset: "custom", budgets: { pre: { calls: 8, ms: 60_000, lookup: { calls: 3, ms: 30_000 } }, post: { calls: 2, ms: 90_000, lookup: { calls: 1, ms: 7_000 } } } } }));
    const migrated = migrateTimeouts(raw);
    expect(migrated.timeouts).toEqual({ engineRunMs: 300_000, preLookupMs: 120_000, postReplyMs: 90_000, postLookupMs: 7_000 });
    expect(migrated.modelUse).toMatchObject({ budgets: { pre: { calls: 8, lookup: { calls: 3 } }, post: { calls: 2, lookup: { calls: 1 } } } });
    expect(JSON.stringify(migrated.modelUse)).not.toContain('"ms"');
    // A file that has timeouts already is left alone.
    expect(migrateTimeouts({ ...raw, timeouts: { engineRunMs: 5000 } })).toEqual({ ...raw, timeouts: { engineRunMs: 5000 } });
  });

  test("the final review's time is 5 min; one saved at its old 2 min, read against defaults before revision 7, is lifted once, and one the user chose stays", async () => {
    expect(defaultTimeouts().finalReviewMs).toBe(300_000);
    const read = async (file: JsonObject) => {
      const host = new FakeHost();
      host.files.set(`${host.userId}/settings.json`, JSON.stringify({ v: 1, ...file }));
      return (await new SettingsStore(host).get(host.userId)).timeouts.finalReviewMs;
    };
    // A main agent on a large model, reviewing from a long session, thought past 2 min before its first edit.
    expect(await read({ defaults: 6, timeouts: { finalReviewMs: 120_000 } })).toBe(300_000);
    expect(await read({ timeouts: { finalReviewMs: 120_000 } })).toBe(300_000);
    expect(await read({ defaults: 6, timeouts: { finalReviewMs: 600_000 } })).toBe(600_000);
    expect(await read({ defaults: 6, timeouts: { finalReviewMs: "none" } })).toBe("none");
    // Once: read against the defaults since revision 7, 2 min is the user's own.
    for (const defaults of [7, SETTINGS_DEFAULTS_REV]) expect([defaults, await read({ defaults, timeouts: { finalReviewMs: 120_000 } })]).toEqual([defaults, 120_000]);
  });

  test("a phase that ran out is recorded in the chat's diagnostics with its setting and how to raise it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    vi.useFakeTimers();
    const settings = { modelUse: defaultSettings().modelUse, timeouts: { ...defaultTimeouts(), postReplyMs: 20 } };
    const budget = phaseBudget(settings, "post");
    vi.advanceTimersByTime(21);
    vi.useRealTimers();
    rig.rt.timeLimits({ chatId, userId: rig.host.userId, turn: "g1" }, "read", budget);
    const record = (await rig.rt.diag.records(chatId, rig.host.userId)).find((r) => r.step === "time limit");
    expect(record).toMatchObject({ status: "failed", phase: "read", turn: "g1" });
    expect(record?.reason).toContain("Reading the reply ran out after 20 ms (Settings → Timeouts → Reading the reply)");
    expect(record?.fix).toContain("Raise Reading the reply in Settings → Timeouts");
  });

  test("a background lane Lumiverse stopped for time fails its job naming the setting", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const jobId = await rig.jobs.start("check_world", worldId, { days: 1 }, rig.host.userId);
    await rig.jobs.idle();
    const spawned = rig.host.spawned.at(-1);
    expect(spawned).toMatchObject({ startupMs: 60_000, heartbeatMs: 60_000 });
    const processId = [...rig.host.processMail.keys()].at(-1) ?? "";
    rig.host.lifecycle(processId, jobId, "timed_out", "Backend process heartbeat timed out");
    await rig.jobs.idle();
    const failed = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId);
    expect(failed).toMatchObject({ status: "failed" });
    expect(JSON.stringify(failed)).toContain("Background lane heartbeat ran out");
    expect(new TimeoutFired("laneHeartbeatMs", 60_000).fix).toContain("or set it to No limit");
  });
});
