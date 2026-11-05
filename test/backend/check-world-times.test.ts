// Check world's time per process (BUILD-C C3): a day's timelapse says how long each simulated process
// took (`AdvanceResult.processMs`), and the day carries it beside its words (`PlaytestTurn.processMs`),
// never in its notes, reply or events, so a run reads the same each time; a Playtest turn and a plan
// that holds no timelapse carry none. Build says each day's slowest processes, and a Check world job
// kept across a restart keeps its days' times.

import { describe, expect, test } from "bun:test";
import { checkWorld, playtest, revisionOf } from "../../src/cli/local-engine";
import { checkWorldDay, playtestStart } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { planTurn, postTurn, timelapseIntent } from "../../src/engine/turn";
import { slowestProcessesText } from "../../src/frontend/build/jobs";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import type { JobUpdate } from "../../src/shared/protocol";
import type { TurnPlanInput } from "../../src/engine/steps";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
const portAlder = STARTER_WORLDS.modern_slice_of_life("w", "Port Alder");

describe("a Check world day's time per process", () => {
  test("each day says how long each process took, beside its words, which read the same on every run", () => {
    const first = checkWorld(portAlder, 2, "times");
    const processes = new Set(reg.processes.map((p) => p.id));
    for (const day of first.turns) {
      const ms = day.processMs ?? {};
      expect(Object.keys(ms).length).toBeGreaterThan(0);
      for (const [id, t] of Object.entries(ms)) expect([id, processes.has(id), Number.isFinite(t) && t >= 0]).toEqual([id, true, true]);
      expect(day.notes.join("\n")).not.toMatch(/\bms\b/);
    }
    // Run again: the same days, word for word; only the times are the clock's.
    const words = (run: typeof first) => run.turns.map(({ processMs: _wallClock, ...day }) => day);
    expect(words(checkWorld(portAlder, 2, "times"))).toEqual(words(first));
  });

  test("a Playtest turn, and a day whose plan holds no timelapse, carry none", () => {
    expect(playtest(portAlder, ["look around"], "times").turns[0]?.processMs).toBeUndefined();
    const bare = {
      plan: (input: TurnPlanInput) => {
        const plan = planTurn(input);
        return { events: plan.events, elapsedMinutes: plan.elapsedMinutes };
      },
      post: postTurn,
    };
    const day = checkWorldDay(reg, bare, portAlder, playtestStart(reg, portAlder, revisionOf(portAlder)), "times", 0, timelapseIntent({ type: "duration", minutes: 24 * 60 }, {}));
    expect(day.turn.notes.length).toBeGreaterThan(0);
    expect(day.turn.processMs).toBeUndefined();
  });

  test("Build names a day's five slowest processes, by id, slowest first; none under a millisecond", () => {
    expect(slowestProcessesText({ "economy.money": 1240, "castlife.routine": 340, "minds.drift": 0.4, "space.travel": 12, "weather.sky": 3, "orgs.agenda": 3, "gear.tidy": 2 })).toBe("Slowest processes: economy.money 1.2 s · castlife.routine 340 ms · space.travel 12 ms · orgs.agenda 3 ms · weather.sky 3 ms");
    expect(slowestProcessesText({ "minds.drift": 0.4 })).toBeNull();
    expect(slowestProcessesText({})).toBeNull();
  });
});

describe("a Check world job's days", () => {
  test("keep their times as the lane sent them, and across a restart those that are times", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const before = new Set(rig.host.processMail.keys());
    const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind: "check_world", worldId, input: { days: 1 } })).jobId;
    await rig.host.settle();
    const processId = [...rig.host.processMail.keys()].find((k) => !before.has(k));
    if (!processId || typeof jobId !== "string") throw new Error("no lane spawned");
    const day = { user: "Day 1", reply: "(nothing happened)", notes: ["+1440 min, 0 events"] };
    const sent: JsonObject = { "economy.money": 12.5, "castlife.routine": 0, broken: "slow", backwards: -3 };
    rig.host.reply(processId, { jobId, done: true, result: { turns: [{ ...day, processMs: sent }], lint: [] } });
    const done = rig.host.sent.filter((m): m is JobUpdate => m.type === "lre.job.update" && m.jobId === jobId).at(-1);
    expect(done?.status).toBe("done");
    const live: unknown = done?.result && "turns" in done.result ? done.result.turns[0]?.processMs : null;
    expect(live).toEqual(sent);
    await rig.jobs.idle();
    await rig.host.settle();
    // After a restart the kept job reads back from storage: a day's times keep only those that are times.
    const again = rig.restart();
    const jobs = again.body(await again.send({ type: "lre.job", op: "list", worldId })).jobs;
    const kept = Array.isArray(jobs) ? jobs.find((j) => typeof j === "object" && j !== null && "jobId" in j && j.jobId === jobId) : undefined;
    const turns = kept && typeof kept === "object" && "result" in kept && kept.result && typeof kept.result === "object" && "turns" in kept.result ? kept.result.turns : null;
    expect(turns).toEqual([{ ...day, processMs: { "economy.money": 12.5, "castlife.routine": 0 } }]);
  });
});
