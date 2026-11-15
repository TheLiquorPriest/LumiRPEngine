// The jobs on the pages, against the turn lane's own job routes in RPE's own server (in this process, on
// a free loopback port), over a list of jobs kept in memory in place of RPH's: a chat's jobs on its Turns
// page and the user's of every chat on Chats, newest first, each as RPH keeps it; Cancel only where a job
// has not ended, and what it answered shown; RPE's refusals (no such job of the user's, an RPE that runs
// no jobs) shown in its words. Every name and number here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { h } from "preact";
import type { JobsApi, JobView } from "rp-harness/contract";
import { type App, dataPaths, lineLog, openApp } from "../../src/app";
import { configOf } from "../../src/app/config";
import { turnRoutes } from "../../src/turn/routes";
import { createClient, type RpeClient, webConnector } from "../../src/ui/client";
import { type JobsShown, JobsView, readJobs } from "../../src/ui/pages/jobs";
import { TurnsView } from "../../src/ui/pages/turns";
import { browserDeps } from "../../src/ui/roads";
import { CHAT, USER } from "./recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

const usage = { calls: 3, input: 9_000, output: 700, cacheRead: 0, cacheWrite: 0 };
const job = (id: string, state: JobView["state"], started: number, over: Partial<JobView> = {}): JobView => ({ id, agent: "historian", brief: "Summarize the chapter that closed.", state, scope: { user: USER, chat: CHAT, session: "s-1" }, startedBy: "user", started, usage, ...over });

/** The jobs RPH keeps, in memory, each found only under its own user: a cancel ends a queued or running one, and gives one that ended as it ended. */
function keptJobs(): JobsApi & { all: JobView[] } {
  const all: JobView[] = [
    job("job-old", "done", 1_000, { ended: 2_000, report: "Chapter one, summarized.", startedBy: { id: "a1", definition: "author" } }),
    job("job-run", "running", 3_000, { agent: "keeper", brief: "Index the lore that changed." }),
    job("job-other", "queued", 4_000, { scope: { user: USER, chat: "chat-harbour", session: "s-2" } }),
    job("job-theirs", "running", 5_000, { scope: { user: "user-2", chat: CHAT, session: "s-3" } }),
  ];
  return {
    all,
    list: async (filter) => all.filter((j) => j.scope.user === filter.user && (filter.chat === undefined || j.scope.chat === filter.chat)),
    get: async (user, id) => all.find((j) => j.id === id && j.scope.user === user),
    start: async () => {
      throw new Error("No job is started here.");
    },
    cancel: async (user, id) => {
      const at = all.findIndex((j) => j.id === id && j.scope.user === user);
      const found = all[at];
      if (found === undefined || (found.state !== "queued" && found.state !== "running")) return found;
      all[at] = { ...found, state: "cancelled", ended: 6_000 };
      return all[at];
    },
  };
}

let root = "";
let app: App;
let base = "";
let token = "";
let jobs: (JobsApi & { all: JobView[] }) | undefined;
const clients: RpeClient[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rpe-ui-jobs-"));
  // The job routes reach only the harness's jobs: where RPE runs none, they are undefined.
  const turns = {
    get harness() {
      return { jobs };
    },
  };
  app = await openApp({
    paths: dataPaths(join(root, "data")),
    config: configOf({ port: 0, lumiverse: { url: "http://127.0.0.1:7860", user: USER } }, {}, "the test's config"),
    version: "1.0.0",
    areas: [{ name: "turns", mount: (at) => at.routes.add("turns", turnRoutes({ turns: turns as never, chatName: async () => null })) }],
    log: lineLog(() => undefined),
  });
  base = (await app.start()).url;
  token = (await app.auth.mintPageToken(USER, "extension")).token;
});

afterAll(async () => {
  for (const client of clients) client.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
});

function client(): RpeClient {
  let held: string | null = token;
  const made = createClient(webConnector(base, { get: () => held, set: (next) => (held = next) }, browserDeps()));
  clients.push(made);
  return made;
}

/** Reads the jobs through the real routes until `done` says the page shows what is waited for. */
async function reading(chat: string | null, done: (shown: JobsShown) => boolean) {
  let last: JobsShown | null = null;
  let heard = Promise.withResolvers<void>();
  const reader = readJobs(client(), chat, (shown) => {
    last = shown;
    if (done(shown)) heard.resolve();
  });
  await heard.promise;
  return {
    reader,
    shown: () => last as unknown as JobsShown,
    /** Waits until the page shows what `until` says. */
    async next(until: (shown: JobsShown) => boolean) {
      heard = Promise.withResolvers<void>();
      done = until;
      if (last !== null && until(last)) return;
      await heard.promise;
    },
  };
}

const view = (shown: JobsShown, everyChat = false) => {
  const pressed: string[] = [];
  const tree = expand(h(JobsView, { shown, everyChat, onCancel: (id) => pressed.push(id) }));
  return { tree, pressed, row: (id: string) => elements(tree).find((e) => e.props["data-job"] === id) };
};
const buttons = (node: unknown): string[] => elements(node).filter((e) => e.type === "button").map((e) => textOf(e.props.children));

describe("the jobs, on RPE's own job routes", () => {
  test("a chat's jobs on its Turns page, newest started first, each as RPH keeps it; Cancel only on one that has not ended", async () => {
    jobs = keptJobs();
    const read = await reading(CHAT, (s) => s.jobs !== null);
    read.reader.stop();
    expect(read.shown().jobs?.map((j) => j.id)).toEqual(["job-run", "job-old"]);
    const { tree, row } = view(read.shown());
    expect(textOf(row("job-run")?.props.children)).toContain("keeperrunningCancelIndex the lore that changed.");
    expect(buttons(row("job-run"))).toEqual(["Cancel"]);
    expect(buttons(row("job-old"))).toEqual([]);
    expect(textOf(row("job-old")?.props.children)).toContain("started by the author");
    expect(elements(row("job-old")).find((e) => e.type === "pre")?.props.children).toBe("Chapter one, summarized.");
    expect(textOf(tree)).toContain("This chat's jobs");
    // On the Turns page, below its turns.
    const page = expand(h(TurnsView, { turns: [], more: false, loading: false, problem: null, jobs: { shown: read.shown(), onCancel: () => undefined }, onOpen: () => undefined, onMore: () => undefined }));
    expect(elements(page).some((e) => e.props["data-section"] === "jobs")).toBe(true);
  });

  test("Cancel stops a running job and the page shows it cancelled; a job that is not the user's is refused in RPE's words, and the list stays as it was", async () => {
    jobs = keptJobs();
    const read = await reading(CHAT, (s) => s.jobs !== null);
    const { pressed, row } = view(read.shown());
    press(row("job-run"), "Cancel");
    expect(pressed).toEqual(["job-run"]);
    read.reader.cancel("job-run");
    await read.next((s) => s.cancelling === null && s.jobs?.find((j) => j.id === "job-run")?.state === "cancelled");
    expect(jobs.all.find((j) => j.id === "job-run")?.state).toBe("cancelled");
    expect(buttons(view(read.shown()).row("job-run"))).toEqual([]);

    read.reader.cancel("job-theirs");
    await read.next((s) => s.cancelled?.job === "job-theirs" && s.cancelled.refused !== null);
    expect(read.shown().cancelled).toEqual({ job: "job-theirs", refused: "There is no job job-theirs." });
    expect(jobs.all.find((j) => j.id === "job-theirs")?.state).toBe("running");
    read.reader.stop();
  });

  test("the user's jobs of every chat, each saying its chat; an RPE that runs no jobs says so, in its words", async () => {
    jobs = keptJobs();
    const all = await reading(null, (s) => s.jobs !== null);
    all.reader.stop();
    expect(all.shown().jobs?.map((j) => j.id)).toEqual(["job-other", "job-run", "job-old"]);
    const { tree, row } = view(all.shown(), true);
    expect(textOf(tree)).toContain("Your jobs");
    expect(textOf(row("job-other")?.props.children)).toContain("chat chat-harbour");

    jobs = undefined;
    const none = await reading(CHAT, (s) => !s.loading);
    none.reader.stop();
    expect(none.shown().problem).toBe("This RPE runs no jobs.");
    expect(banners(view(none.shown()).tree)).toEqual([{ title: "The jobs could not be read", text: "The jobs could not be readThis RPE runs no jobs." }]);
  });
});
