// Build's jobs on RPE's job routes through the kept App (PlanChatUI-B2 item 5): `lre.job` start, list, cancel and dismiss reach typed routes, a job
// ends with the result the Tools list and the job page read, no word of "unavailable" is said, and a job told on RPE's live feed is today's
// `lre.job.update`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { keptApp, type ToastSettings } from "../../../src/ui/kept/app";
import { calls as jobsFile } from "../../../src/ui/kept/calls/jobs";
import { webHost } from "../../../src/ui/kept/host";
import { createStore } from "../../../src/ui/store";
import { handTimers, routeClient } from "./bed";
import { openPage, type Page } from "./dom";

let page: Page;
beforeAll(() => {
  page = openPage();
});
afterAll(() => page.close());

const SETTINGS: ToastSettings = { toastsShown: 3, errorToastMs: 6000, toastMs: 3500 };
const quiet = { follow: () => () => undefined };

describe("Build's jobs through the kept App", () => {
  test("a job is started, read back as the Tools list shows it, cancelled where it has ended and dismissed; none of it is said as unavailable", async () => {
    const rpe = routeClient();
    const kept = keptApp({ client: { ...rpe.client, ...quiet }, chat: createStore<string | null>(null), mode: "build", host: webHost({ revokeMs: () => 1000 }), timers: handTimers(), settings: () => SETTINGS });
    const created = await kept.app.request({ type: "lre.world", op: "create", name: "Fernwick", template: "fantasy_town" });
    const worldId = created?.world?.id ?? "";
    const started = await kept.app.request({ type: "lre.job", op: "start", kind: "playtest", worldId, input: { turns: ["look around"] } });
    expect(started?.jobId).toMatch(/^job/);
    let job = (await kept.app.request({ type: "lre.job", op: "list", worldId }))?.jobs?.[0];
    for (let i = 0; i < 200 && job?.status === "running"; i++) {
      await new Promise((done) => setTimeout(done, 5));
      job = (await kept.app.request({ type: "lre.job", op: "list", worldId }))?.jobs?.[0];
    }
    expect(job).toMatchObject({ jobId: started?.jobId, kind: "playtest", status: "done", progress: 1 });
    expect(job?.result && "turns" in job.result ? job.result.turns.map((t) => t.user) : []).toEqual(["look around"]);
    // An ended job cannot be cancelled: said on the page, in RPE's route's words.
    expect(await kept.app.request({ type: "lre.job", op: "cancel", jobId: started?.jobId ?? "" })).toBeNull();
    expect(await kept.app.request({ type: "lre.job", op: "dismiss", jobId: started?.jobId ?? "" })).toEqual({});
    expect((await kept.app.request({ type: "lre.job", op: "list", worldId }))?.jobs).toEqual([]);
    expect(kept.said.get().filter((word) => /unavailable|does not have yet/i.test(word))).toEqual([]);
    kept.stop();
  });

  test("a job told on RPE's live feed is today's lre.job.update; one read back as interrupted is told as a failure", () => {
    const data = { jobId: "job1", kind: "check_world", worldId: "w", progress: 0.5 };
    const event = (rest: Record<string, unknown>) => ({ chat: "", seq: 1, kind: "build_job", at: 0, data: { ...data, ...rest } }) as never;
    const ctx = {} as never;
    expect(jobsFile.live?.(event({ status: "running" }), ctx)).toEqual([{ lre: expect.any(Number), type: "lre.job.update", jobId: "job1", kind: "check_world", status: "running", progress: 0.5 }]);
    expect(jobsFile.live?.(event({ status: "interrupted", message: "Interrupted by a restart. Run it again." }), ctx)).toMatchObject([{ status: "failed", message: "Interrupted by a restart. Run it again." }]);
    expect(jobsFile.live?.({ chat: "", seq: 1, kind: "world", at: 0, data: {} } as never, ctx)).toEqual([]);
  });
});
