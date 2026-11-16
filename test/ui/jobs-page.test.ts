// The Jobs page: which jobs it lists, what he may do with a job where it stands, and the limits he types for one.

import { describe, expect, test } from "bun:test";
import type { JobView } from "../../src/shared/api";
import { controlsOf } from "../../src/ui/pages/jobs/open";
import { listedJobs } from "../../src/ui/pages/jobs/page";
import { limitsOf } from "../../src/ui/pages/jobs/start";

const job = (id: string, state: JobView["state"], chat: string | null = "c1", over: Partial<JobView> = {}): JobView =>
  ({ id, agent: "historian", brief: "Read the past.", state, scope: chat === null ? { user: "u" } : { user: "u", chat, session: "s" }, startedBy: "user", started: 1, usage: { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, ...over }) as JobView;

describe("the jobs listed", () => {
  test("a chat's, in a state, or all of them; a job of no chat is every chat's only", () => {
    const all = [job("a", "done"), job("b", "running", "c2"), job("c", "done", null)];
    expect(listedJobs(all, null, null).map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(listedJobs(all, "c1", null).map((j) => j.id)).toEqual(["a"]);
    expect(listedJobs(all, null, "done").map((j) => j.id)).toEqual(["a", "c"]);
  });
});

describe("what he may do with a job where it stands", () => {
  test("a waiting job is held or cancelled, a running one paused, spoken to or cancelled, one that asks answered, a failed one started again, one stopped at a limit carried on", () => {
    expect(controlsOf(job("a", "queued"))).toMatchObject({ cancel: true, hold: true, pause: false });
    expect(controlsOf(job("a", "running"))).toMatchObject({ cancel: true, pause: true, word: true, hold: false });
    expect(controlsOf(job("a", "asking"))).toMatchObject({ answer: true, word: true });
    expect(controlsOf(job("a", "held"))).toMatchObject({ release: true });
    expect(controlsOf(job("a", "failed"))).toMatchObject({ restart: true, cancel: false, carryOn: false });
    expect(controlsOf(job("a", "failed", "c1", { limit: { limit: "calls", per: "job", value: 3, max: 3 } as never }))).toMatchObject({ carryOn: true, restart: true });
    expect(controlsOf(job("a", "interrupted"))).toMatchObject({ resume: true, restart: true });
  });
});

describe("the limits he types", () => {
  test("an empty field sets none, a whole number of at least one is kept, anything else is named", () => {
    expect(limitsOf({ calls: "3", tokens: "", time: "90" })).toEqual({ limits: { calls: 3, time: 90 }, bad: [] });
    expect(limitsOf({ calls: "0", tokensIn: "2.5", tokensOut: "x" }).bad).toEqual(["calls", "tokensIn", "tokensOut"]);
  });
});
