// A job's work as the turn lane hears of it (plan §10.9, §13.5): what a job records, with the turn that
// started it, takes effect just before the first turn to begin after the harness says the job ended, and
// no turn begun before that has its state changed; that turn is told how the job ended, finished or not,
// with its brief, its report and what of it took effect. Jobs the Author starts with `job_start` run on
// after the reply, and the next turn is told how each ended. And an engine handler that throws, on such
// a change or while `world_apply` works out a call, is an error for people, not for a model. Played
// through the stand-in Lumiverse on the scripted model, on a chat that plays an invented world. Every
// name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JobState, JobView } from "rp-harness/contract";
import { type Answer, gate } from "rp-harness/testing/rig";
import { RouteError } from "../../src/app";
import { callRoute } from "../app/call";
import type { LiveEvent } from "../../src/app/live";
import type { ChangeInput } from "../../src/store";
import { NO_SESSION } from "../../src/turn";
import { jobRoutes } from "../../src/turn/job-routes";
import { globalConfig } from "../../src/turn/settings";
import { jobsEndedBetween } from "../../src/turn/jobs";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function worldBed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  await playsWorld(b, world());
  return b;
}

/** The player says something, unless it is a swipe, and asks for a reply; gives the turn's id once it is settled. */
async function play(b: TurnBed, said: string | null): Promise<string> {
  if (said !== null) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, ...(said === null ? { type: "swipe" as const } : {}) });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

const JOB = "job-ledger";

/** What a job's agent records, as the engine's tools record it for a job: with the turn that started the job. */
const sourMood: ChangeInput = { lane: "engine", op: "set", value: { type: "set", entity: "bram", field: "mood", value: "sour" }, by: "steward", source: "gm", job: JOB };

/** The harness keeping the record of the job `turn` started and telling the host it ended (`TurnEvents.job`), as it does when a job ends. */
async function jobEnded(b: TurnBed, turn: string, session: string): Promise<void> {
  const now = Date.now();
  const scope = { user: USER, chat: CHAT, session, turn };
  const usage = { calls: 1, input: 10, cacheRead: 0, cacheWrite: 0, output: 5 };
  const view = { id: JOB, agent: "steward", brief: "Tally the bar's stock.", state: "done" as const, scope, startedBy: { id: "a0", definition: "author" }, started: now - 5, ended: now, usage, report: "The stock is short by a cask." };
  await b.turns.env.store.jobs.set(scope, view);
  await b.turns.env.events.job?.(scope, view);
}

test("a job's change takes effect at the first turn to begin after the harness says the job ended, and changes no turn begun before", async () => {
  const b = await worldBed({ answers: [replying("Bram wipes the bar."), replying("Bram pours."), replying("Bram scowls at the till.")] });
  const store = b.turns.store.user(USER);
  const mood = (turn: string): unknown => store.stateAt(turn).state.world.entities.bram?.fields.mood;
  const first = await play(b, "I sit at the bar.");
  await b.app.writes.run(() => store.addChanges(first, [sourMood]));

  const second = await play(b, "I order a drink.");
  expect(mood(second)).toBe("steady");

  await jobEnded(b, first, b.turns.runs.record(USER, first)!.session);
  const third = await play(b, "I wait for the change.");
  expect(mood(third)).toBe("sour");
  expect(mood(second)).toBe("steady");
});

test("the turn a job's changes take effect at is told the job finished, what it was, its report and what took effect, never its brief, once; a swipe of it is told again", async () => {
  const b = await worldBed({ answers: [replying("Bram wipes the bar."), replying("Bram scowls at the till."), replying("Bram sighs at the till."), replying("Bram counts coins.")] });
  const store = b.turns.store.user(USER);
  const first = await play(b, "I sit at the bar.");
  await b.app.writes.run(() => store.addChanges(first, [sourMood]));
  await jobEnded(b, first, b.turns.runs.record(USER, first)!.session);

  await play(b, "I order a drink.");
  await play(b, null);
  await play(b, "I count my coins.");
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  const told = `A job finished: ${JOB}, a steward job. Its report: The stock is short by a cask. Took effect now: Bram's mood is now sour (about Bram).`;
  expect(sent[0]).not.toContain(told);
  expect(sent[1]).toContain(told);
  expect(sent[2]).toContain(told);
  expect(sent[3]).not.toContain(`A job finished: ${JOB}`);
});

test("jobs the Author starts run on after the reply, and the next turn is told how each ended: finished, failed or cancelled", async () => {
  const briefs = { done: "Note that Bram has soured.", failed: "Count the bar's stock.", cancelled: "List the inn's regulars." };
  const held = { done: gate(), failed: gate(), cancelled: gate() };
  const setMood = { op: "set", at: "bram", key: "mood", value: "sour", source: { from: "prose" } };
  const author: Answer[] = [
    { pieces: [{ text: "<intent>Set the bookkeeping going.</intent>" }, ...Object.values(briefs).map((brief) => ({ call: "job_start", args: { agent: "historian", brief } }))] },
    { pieces: [{ text: "<reply>Bram wipes the bar.</reply>" }] },
    replying("Bram pours."),
    replying("Bram counts coins."),
  ];
  const jobs: Record<string, Answer[]> = {
    [briefs.done]: [{ pieces: [{ hold: held.done }, { call: "world_apply", args: { operations: [setMood] } }] }, { pieces: [{ text: "Bram's mood is recorded as sour." }] }],
    [briefs.failed]: [{ pieces: [{ hold: held.failed }], end: { error: "400: The provider refused the call." } }],
    [briefs.cancelled]: [{ pieces: [{ hold: held.cancelled }, { text: "The regulars are Tam and Odile." }] }],
  };
  // Each call answered from its own agent's list, whatever order the Author's and the jobs' calls come in: the Author holds job_start.
  const route: Answer = (request) => {
    const brief = request.tools.some((t) => t.name === "job_start") ? null : Object.keys(jobs).find((b) => JSON.stringify(request.messages).includes(b));
    const next = (brief === null ? author : jobs[brief ?? ""])?.shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  const b = await worldBed({ answers: Array.from({ length: 8 }, () => route) });
  const first = await play(b, "I sit at the bar.");

  // Two jobs run at once by default, so the third to begin waits for a place. The player cancels one, wherever it stands; the other two
  // go on after the reply.
  const views = (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs;
  const id = (brief: string): string => views.find((v) => v.brief === brief)?.id ?? "";
  expect(views.map((v) => [v.brief, v.scope.turn, v.ended]).sort()).toEqual(Object.values(briefs).map((brief) => [brief, first, undefined]).sort());
  expect(views.map((v) => v.state).sort()).toEqual(["queued", "running", "running"]);
  expect((await b.turns.harness.jobs.cancel(USER, id(briefs.cancelled)))?.state).toBe("cancelled");
  held.done.open();
  held.failed.open();
  const states: JobState[] = ["done", "failed", "cancelled"];
  await b.until("each job's end to be kept", () => jobsEndedBetween(b.app.db, USER, CHAT, 0, Number.MAX_SAFE_INTEGER).filter((j) => states.includes(j.view.state)).length === 3);

  const second = await play(b, "I order a drink.");
  await play(b, "I count my coins.");
  const told = JSON.stringify(b.model.requests.at(-2)?.messages);
  // Each change in words, by the names it is about, never its operation and value as kept; what the job was, never its brief, which the Author wrote.
  expect(told).toContain(`A job finished: ${id(briefs.done)}, a historian job. Its report: Bram's mood is recorded as sour. Took effect now: Bram's mood is now sour (about Bram).`);
  expect(told).toContain(`A job failed before it finished: ${id(briefs.failed)}, a historian job.`);
  expect(told).toContain(`A job was cancelled before it finished: ${id(briefs.cancelled)}, a historian job.`);
  expect(told.match(/A job finished/g)).toHaveLength(1);
  // What the finished job recorded takes effect at the turn it is told to; the turn after is told nothing of any of them again.
  const store = b.turns.store.user(USER);
  expect([store.stateAt(first).state.world.entities.bram?.fields.mood, store.stateAt(second).state.world.entities.bram?.fields.mood]).toEqual(["steady", "sour"]);
  const after = JSON.stringify(b.model.requests.at(-1)?.messages);
  for (const line of [`A job finished: ${id(briefs.done)}`, `A job failed before it finished: ${id(briefs.failed)}`, `A job was cancelled before it finished: ${id(briefs.cancelled)}`]) expect(after).not.toContain(line);
});

/** A job the user starts for the bed's chat, its agent's first call held by the script; given once it runs. */
async function heldJob(b: TurnBed, brief: string): Promise<JobView> {
  const started = await b.turns.harness.jobs.start({ user: USER, chat: CHAT, session: NO_SESSION }, { agent: "historian", brief });
  if ("refused" in started) throw new Error(`The job was refused: ${JSON.stringify(started)}`);
  return await b.until("the job to run", async () => ((await b.turns.harness.jobs.get(USER, started.id))?.state === "running" ? started : null));
}

test("another user's job is not found, and is not cancelled", async () => {
  const b = await openTurnBed({ answers: [{ pieces: [{ hold: gate() }, { text: "The log holds three storm nights." }] }] });
  beds.push(b);
  const job = await heldJob(b, "Tally the keeper's log for the storm nights.");
  const other = "user-tamsin";
  const jobs = b.turns.harness.jobs!;
  expect([await jobs.get(other, job.id), await jobs.cancel(other, job.id)]).toEqual([undefined, undefined]);
  // The page's route, called in the other user's name, finds no such job and stops nothing.
  const cancel = jobRoutes({ turns: b.turns, shared: () => globalConfig(b.app.paths.files, b.app.log) }).find((r) => r.method === "POST" && r.path === "/api/v1/jobs/:job/cancel");
  if (cancel === undefined) throw new Error("the turn lane has no route to cancel a job");
  const refused = await callRoute(cancel, { params: { job: job.id }, user: other }).then(
    () => null,
    (error: unknown) => (error instanceof RouteError ? [error.status, error.message] : error),
  );
  expect(refused).toEqual([404, `There is no job ${job.id}.`]);
  expect((await jobs.get(USER, job.id))?.state).toBe("running");
  // In his own name, the page cancels it.
  expect((await b.page<{ job: JobView }>("POST", `/api/v1/jobs/${job.id}/cancel`)).body.job).toMatchObject({ id: job.id, state: "cancelled" });
});

test("a job cut off by a restart is listed as interrupted at RPE's start, before any call of its user", async () => {
  const b = await openTurnBed({ answers: [{ pieces: [{ hold: gate() }, { text: "The log holds three storm nights." }] }] });
  beds.push(b);
  const job = await heldJob(b, "Tally the keeper's log for the storm nights.");
  await b.restart();
  // Nothing calls the jobs in the user's name: what RPE keeps of the job, as RPH tells it, shows it interrupted all the same.
  const kept = await b.until("the job to be kept as interrupted", () => jobsEndedBetween(b.app.db, USER, CHAT, 0, Number.MAX_SAFE_INTEGER).find((j) => j.view.id === job.id && j.view.state === "interrupted"));
  expect(kept.view).toMatchObject({ id: job.id, state: "interrupted", brief: "Tally the keeper's log for the storm nights.", ended: expect.any(Number) });
});

/**
 * From here the engine's handler for a field set throws, as a fault in the engine would. The registry is frozen, so the store folds
 * with a copy of it that answers the set's type with a broken handler. Gives what is published to the live view from then on.
 */
function breakSetHandler(b: TurnBed): LiveEvent[] {
  const registry = b.turns.store.env.registry;
  const broken = (type: string) => {
    const def = registry.get(type);
    return type !== "set" || def === undefined
      ? def
      : {
          ...def,
          apply: () => {
            throw new Error("the set handler broke");
          },
        };
  };
  b.turns.store.env.registry = { ...registry, get: broken };
  // The fold of a user whose turns were read before keeps the registry it was first given.
  b.turns.store.envOf(USER).registry = b.turns.store.env.registry;
  const published: LiveEvent[] = [];
  const publish = b.app.live.publish.bind(b.app.live);
  b.app.live.publish = (chat, event) => {
    const out = publish(chat, event);
    published.push(out);
    return out;
  };
  return published;
}

test("an engine handler that throws is told to the log and to the live view of the chat at work, and to no model", async () => {
  const b = await worldBed({ answers: [replying("Bram wipes the bar."), replying("Bram stares at nothing.")] });
  const store = b.turns.store.user(USER);
  const first = await play(b, "I sit at the bar.");
  await b.app.writes.run(() => store.addChanges(first, [sourMood]));
  const published = breakSetHandler(b);
  await jobEnded(b, first, b.turns.runs.record(USER, first)!.session);
  const second = await play(b, "I wait.");

  expect(store.stateAt(second).state.world.entities.bram?.fields.mood).toBe("steady");
  expect(b.logged.some((l) => l.level === "error" && l.fields?.op === "set" && l.fields.error === "the set handler broke")).toBe(true);
  expect(published.filter((e) => e.kind === "handler_failed").map((e) => [e.chat, e.data])).toContainEqual([CHAT, expect.objectContaining({ op: "set", error: "the set handler broke", turn: first })]);
  expect(b.model.requests.map((r) => JSON.stringify(r.messages)).join("\n")).not.toContain("the set handler broke");
});

test("an engine handler that throws while world_apply works out a call is told to the log and the live view, and the model is answered from the answers file", async () => {
  const setMood = { op: "set", at: "bram", key: "mood", value: "sour", source: { from: "prose" } };
  const b = await worldBed({ answers: [{ pieces: [{ text: "<intent>Bram sours.</intent>" }, { call: "world_apply", args: { operations: [setMood] } }] }, replying("Bram stares at nothing.")] });
  const published = breakSetHandler(b);
  const turn = await play(b, "I sit at the bar.");

  // What a tool result carries as `details` is for the trace and the pages; the model is sent its content alone.
  const answered = JSON.stringify(b.model.requests[1]!.messages.map((m) => ("details" in m ? { ...m, details: undefined } : m)));
  expect(answered).toContain("world_apply failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded.");
  expect(answered).not.toContain("the set handler broke");
  expect(b.turns.store.user(USER).stateAt(turn).state.world.entities.bram?.fields.mood).toBe("steady");
  expect(b.logged.some((l) => l.level === "error" && l.fields?.op === "set" && l.fields.error === "the set handler broke")).toBe(true);
  expect(published.filter((e) => e.kind === "handler_failed").map((e) => [e.chat, e.data])).toContainEqual([CHAT, { op: "set", error: "the set handler broke", turn, change: null }]);
});
