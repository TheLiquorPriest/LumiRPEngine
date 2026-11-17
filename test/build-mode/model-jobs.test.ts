// Build's model jobs as RPH jobs (PlanChatUI-B5): a Refine runs as a job of no chat under a scope naming only the user, its agent is given
// its input by name and proposes through `world_propose`, each call checked against the draft and kept with the job. RPH's jobs are a fake
// whose "agent" makes the calls a model would.

import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { JobsApi, JobStart, JobView, Scope, UserScope } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { JobHome } from "../../src/build/jobs/home";
import { JOB_LIMIT_DEFAULTS } from "../../src/build/jobs/limits";
import { BUILD_GIVEN, ModelJobs, WORLD_PROPOSE } from "../../src/build/jobs/model";
import { WorldService } from "../../src/worlds/service";
import { makeBed, USER } from "./bed";

const GUIDANCE = resolve(import.meta.dir, "../../guidance");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a Refine runs as an RPH job of no chat: its agent is given the request by name, an unknown kind is dropped with why, and what stands is the job's result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rpe-model-jobs-"));
  dirs.push(dir);
  for (const [kind, name] of [["prompts", "build-jobs"], ["prompts", "engine-answers"], ["tools", WORLD_PROPOSE]] as const) {
    mkdirSync(join(dir, "files", "defaults", `.${kind}`), { recursive: true });
    copyFileSync(join(GUIDANCE, `.${kind}`, `${name}.md`), join(dir, "files", "defaults", `.${kind}`, `${name}.md`));
  }
  const files = (await createFolderHost({ dir, user: USER })).files;
  const bed = makeBed();
  const worlds = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log });
  const made = await worlds.create(USER, "Fernwick", "fantasy_town");
  let state: JobView["state"] = "running";
  const started: { scope: Scope | UserScope; start: JobStart }[] = [];
  const answers: unknown[] = [];
  let models: ModelJobs | null = null;
  const jobs = {
    async start(scope: Scope | UserScope, start: JobStart) {
      started.push({ scope, start });
      const agent = { id: "a1", definition: start.agent, job: "rph-1" };
      // The agent's run: what a model would do with the given input and the tool.
      void (async () => {
        const given = JSON.parse((await models?.views({ user: USER, session: "s1" }, agent, BUILD_GIVEN)) ?? "{}") as { request?: string };
        const tool = (await models?.tools({ user: USER, session: "s1" }))?.find((t) => t.name === WORLD_PROPOSE);
        const ctx = { scope: { user: USER, session: "s1" }, agent, run: "r1", callId: "c1", signal: new AbortController().signal, onUpdate: () => undefined };
        answers.push(given.request);
        answers.push(await tool?.run({ proposals: [{ collection: "places", key: "old_mill", value: { name: "Old mill" }, confidence: 0.8 }, { collection: "entities", key: "ghost", value: { kind: "no_such_kind", name: "Ghost" }, confidence: 0.5 }] }, ctx));
        state = "done";
      })();
      return { id: "rph-1", agent: start.agent, brief: start.brief, state: "running", scope: { user: USER, session: "s1" }, startedBy: "user", started: 0, usage: { calls: 0, input: 0, output: 0 } } as unknown as JobView;
    },
    get: async () => ({ id: "rph-1", state }) as unknown as JobView,
    cancel: async () => undefined,
  } as unknown as JobsApi;
  models = new ModelJobs({ rph: { jobs, files }, worlds, books: { entries: async () => [], entry: async () => null }, log: bed.log, limits: async () => JOB_LIMIT_DEFAULTS, pollMs: 5 });
  const home = new JobHome({ db: bed.db, writes: bed.writes, log: bed.log, limits: async () => JOB_LIMIT_DEFAULTS, runners: models.runners(), told: () => undefined });
  await home.start(USER, "refine", made.world.id, { instructions: "Add the old mill by the river." });
  await home.idle();
  // A scope naming the user and no chat or turn; the agent is the kind's definition, given its input by name.
  expect(started.map((s) => [s.scope, s.start.agent, s.start.attach])).toEqual([[{ user: USER }, "build-refine", [BUILD_GIVEN]]]);
  expect(answers[0]).toBe("Add the old mill by the river.");
  expect(JSON.stringify(answers[1])).toContain("used a kind this world doesn't have (no_such_kind)");
  const [job] = home.list(USER, made.world.id);
  expect(job).toMatchObject({ kind: "refine", status: "done" });
  expect(job?.result && "proposals" in job.result ? job.result.proposals.map((p) => [p.collection, p.key]) : []).toEqual([["places", "old_mill"]]);
});
