// Build's job home and the kept worker (PlanChatUI-B2): a job he starts is kept, told, run on a worker thread by the pure engine and read back, cancelled,
// dismissed or found interrupted; no turn of a chat is involved.

import { afterEach, describe, expect, test } from "bun:test";
import { Workers } from "../../src/app/workers/pool";
import { writeCarriedJob } from "../../src/build/index";
import { JobError, JobHome } from "../../src/build/jobs/home";
import { labRunners } from "../../src/build/jobs/lab";
import { JOB_LIMIT_DEFAULTS, type JobLimits } from "../../src/build/jobs/limits";
import type { JobProposal, JobSummary } from "../../src/shared/jobs";
import { WorldService } from "../../src/worlds/service";
import { makeBed, OTHER, USER } from "./bed";

const pools: Workers[] = [];
afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.close();
});

async function rig(limits: Partial<JobLimits> = {}) {
  const bed = makeBed();
  const service = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log });
  const workers = new Workers({ threads: 1, name: "the jobs test's pool", log: bed.log });
  pools.push(workers);
  const told: JobSummary[] = [];
  const home = () => new JobHome({ db: bed.db, writes: bed.writes, log: bed.log, limits: async () => ({ ...JOB_LIMIT_DEFAULTS, ...limits }), runners: labRunners({ worlds: service, store: bed.store, workers }), told: (_user, job) => told.push(job) });
  const made = await service.create(USER, "Fernwick", "fantasy_town");
  return { bed, home, made, told };
}

describe("Build's job home and the kept worker", () => {
  test("a Check world of three days runs on a worker thread and reads back as the job page shows it; it is told as it goes, and dismissed once ended", async () => {
    const { home, made, told } = await rig();
    const jobs = home();
    const id = await jobs.start(USER, "check_world", made.world.id, { days: 3 });
    // Kept before it runs, and not dismissed while it runs.
    expect(jobs.list(USER, made.world.id).map((j) => [j.jobId, j.status, j.input])).toEqual([[id, "running", { days: 3 }]]);
    await expect(jobs.dismiss(USER, id)).rejects.toThrow("still running");
    await jobs.idle();
    const [job] = jobs.list(USER, made.world.id);
    expect(job).toMatchObject({ jobId: id, kind: "check_world", status: "done", progress: 1 });
    expect(job?.result && "turns" in job.result ? job.result.turns.map((t) => t.user) : []).toEqual(["Day 1", "Day 2", "Day 3"]);
    expect(job?.result && "lint" in job.result).toBe(true);
    // The issues it ends with are the world's own, each with its sentence: a worker thread says what the main thread says.
    const lint = job?.result && "lint" in job.result ? job.result.lint : [];
    expect(lint.length).toBeGreaterThan(0);
    expect(lint.filter((issue) => issue.message === "")).toEqual([]);
    // Told: running, one report per day, then done.
    expect(told.map((j) => j.status)).toEqual(["running", "running", "running", "running", "done"]);
    expect(told.slice(0, 4).map((j) => j.progress)).toEqual([0, 1 / 3, 2 / 3, 1]);
    await jobs.dismiss(USER, id);
    expect(jobs.list(USER, made.world.id)).toEqual([]);
  });

  test("a playtest gives each typed turn's reply and notes, from the revision's opening state", async () => {
    const { home, made } = await rig();
    const jobs = home();
    const id = await jobs.start(USER, "playtest", made.world.id, { turns: ["look around", "wait a while"] });
    await jobs.idle();
    const [job] = jobs.list(USER, made.world.id);
    expect(job).toMatchObject({ jobId: id, status: "done" });
    const turns = job?.result && "turns" in job.result ? job.result.turns : [];
    expect(turns.map((t) => t.user)).toEqual(["look around", "wait a while"]);
    for (const turn of turns) {
      expect(turn.reply.length).toBeGreaterThan(0);
      expect(turn.notes[0]).toMatch(/^\+\d+ min/);
    }
  });

  test("a cancel stops it; another user's job is not found; a request past the limit is refused naming its setting", async () => {
    const { home, made, told } = await rig({ running: 1 });
    const jobs = home();
    const id = await jobs.start(USER, "check_world", made.world.id, { days: 14 });
    await expect(jobs.start(USER, "check_world", made.world.id, { days: 1 })).rejects.toThrow("build.jobs.atOnce");
    await expect(jobs.cancel(OTHER, id)).rejects.toBeInstanceOf(JobError);
    await jobs.cancel(USER, id);
    await jobs.idle();
    expect(jobs.list(USER, made.world.id).map((j) => j.status)).toEqual(["cancelled"]);
    expect(told.at(-1)?.status).toBe("cancelled");
    expect(told.some((j) => j.status === "done")).toBe(false);
    // Over the days' most: run as many as it allows.
    const more = await rig({ daysMost: 2 });
    const again = more.home();
    await again.start(USER, "check_world", more.made.world.id, { days: 30 });
    expect(again.list(USER, more.made.world.id)[0]?.input).toEqual({ days: 2 });
    await again.idle();
  });

  test("a job stored as running that this process does not run reads as interrupted, with what it had; a carried job reads back ended, its proposals still to review", async () => {
    const { bed, home, made } = await rig();
    const proposals: JobProposal[] = [{ id: "p1", collection: "kinds", key: "lamplighter", value: { id: "lamplighter" }, source: "lore", confidence: 0.5 }];
    await bed.writes.run((db) => {
      // As the file of an earlier run left it: stored as running, with the proposals it had made.
      db.query("INSERT INTO build_job (user, id, kind, world, status, progress, input, result, at) VALUES (?, 'old1', 'import_lore', ?, 'running', 0.5, '{\"bookIds\":[\"b\"]}', ?, 1)").run(USER, made.world.id, JSON.stringify({ proposals }));
      writeCarriedJob(db, USER, { jobId: "old3", kind: "import_lore", worldId: made.world.id, status: "running", progress: 0.5, result: { proposals }, input: { bookIds: ["b"] }, at: 3 });
      writeCarriedJob(db, USER, { jobId: "old2", kind: "refine", worldId: made.world.id, status: "done", progress: 1, result: { proposals }, input: { instructions: "more" }, at: 2 });
    }, "carried jobs");
    await home().interruptStale();
    const listed = Object.fromEntries(home().list(USER, made.world.id).map((j) => [j.jobId, j]));
    expect(Object.entries(listed).map(([id, j]) => [id, j.status]).sort()).toEqual([
      ["old1", "interrupted"],
      ["old2", "done"],
      ["old3", "interrupted"],
    ]);
    expect(listed.old1?.message).toContain("1 proposal(s)");
    expect(listed.old3?.message).toContain("1 proposal(s)");
    expect(listed.old2?.result).toEqual({ proposals });
    expect(home().list(OTHER, made.world.id)).toEqual([]);
  });
});
