// The jobs as a page meets them (plan §13.5): the jobs of the user and of one chat are listed, each with
// how it stands, what started it and what it has spent, and a page cancels one. And a turn dropped
// because its generation saved nothing is told to RPH as off the path, so the jobs it started are cut
// off rather than run on for nothing. Played through the stand-in Lumiverse on the scripted model. Every
// name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JobView } from "rp-harness/contract";
import { type Answer, gate } from "rp-harness/testing/rig";
import type { StopReply } from "../../src/shared/api";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const BRIEF = "Tally the keeper's log for the storm nights.";

/** The script, its calls answered from the Author's list or the job's, whatever order they come in: the Author holds `job_start`. */
function bySpeaker(author: Answer[], job: Answer[]): Answer[] {
  const route: Answer = (request) => {
    const next = (request.tools.some((t) => t.name === "job_start") ? author : job).shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  return Array.from({ length: author.length + job.length }, () => route);
}

const STARTS_JOB: Answer = { pieces: [{ text: "<intent>Have the log tallied.</intent>" }, { call: "job_start", args: { agent: "historian", brief: BRIEF } }] };

test("a page lists the jobs of the user and of a chat, each with how it stands, what started it and what it spent, and cancels one", async () => {
  const held = gate();
  const b = await openTurnBed({ answers: bySpeaker([STARTS_JOB, { pieces: [{ text: "<reply>Wren opens the log.</reply>" }] }], [{ pieces: [{ hold: held }, { text: "Three storm nights." }] }]) });
  beds.push(b);
  b.host.send(CHAT, "I open the keeper's log.");
  const turn = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);

  const mine = await b.page<{ jobs: JobView[] }>("GET", "/api/v1/jobs");
  expect(mine.status).toBe(200);
  expect(mine.body.jobs).toEqual([
    {
      id: expect.any(String),
      agent: "historian",
      brief: BRIEF,
      state: "running",
      scope: { user: USER, chat: CHAT, session: expect.any(String), turn: turn.id },
      startedBy: expect.objectContaining({ definition: "author" }),
      started: expect.any(Number),
      usage: expect.objectContaining({ calls: expect.any(Number), input: expect.any(Number), output: expect.any(Number) }),
    },
  ]);
  const [job] = mine.body.jobs;
  expect((await b.page<{ jobs: JobView[] }>("GET", `/api/v1/chats/${CHAT}/jobs`)).body.jobs).toEqual(mine.body.jobs);
  expect((await b.page<{ jobs: JobView[] }>("GET", "/api/v1/chats/chat-elsewhere/jobs")).body).toEqual({ jobs: [] });

  const cancelled = await b.page<{ job: JobView }>("POST", `/api/v1/jobs/${job!.id}/cancel`);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.job).toMatchObject({ id: job!.id, state: "cancelled", ended: expect.any(Number) });
  expect((await b.page<{ jobs: JobView[] }>("GET", "/api/v1/jobs")).body.jobs.map((j) => [j.id, j.state])).toEqual([[job!.id, "cancelled"]]);
  // Cancelled once, it is given again as it ended; a job nobody has is no job.
  expect((await b.page<{ job: JobView }>("POST", `/api/v1/jobs/${job!.id}/cancel`)).body.job.state).toBe("cancelled");
  expect((await b.page<{ error: string }>("POST", "/api/v1/jobs/job-nobody-has/cancel")).status).toBe(404);
});

test("a turn stopped before its reply's first word is dropped, RPH is told it left the path, and the job it started is cut off", async () => {
  const before = gate();
  const b = await openTurnBed({ answers: bySpeaker([STARTS_JOB, { pieces: [{ hold: before }, { text: "<reply>Wren opens the log.</reply>" }] }], [{ pieces: [{ hold: gate() }, { text: "Three storm nights." }] }]) });
  beds.push(b);
  b.host.send(CHAT, "I open the keeper's log.");
  const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  const running = await b.until("the job to run", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.state === "running"));
  const turn = running.scope.turn!;
  expect((await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${turn}/stop`)).body).toEqual({ stopped: true });
  expect((await generating).stopped).toBe(true);

  await b.until("the turn to be dropped", () => b.turns.store.user(USER).turn(turn)?.status === "dropped");
  await b.until("RPH to be told the turn left the path", () => b.left.some((s) => s.turn === turn));
  expect(await b.until("the job to be cut off", async () => (await b.turns.harness.jobs.get(USER, running.id))?.state === "off-path")).toBe(true);
});

test("a job started in a chat RPE has not played yet makes the chat's folder first, and its session file is written; a chat Lumiverse does not have starts none", async () => {
  const b = await openTurnBed({ answers: [{ pieces: [{ text: "Three storm nights." }] }] });
  beds.push(b);
  expect(b.turns.chats.folders(USER, CHAT)).toBeNull();

  const started = await b.page<{ job: JobView }>("POST", `/api/v1/chats/${CHAT}/jobs`, { definition: "historian", brief: BRIEF });
  expect(started.status).toBe(200);
  const ended = await b.until("the job to end", async () => {
    const job = await b.turns.harness.jobs.get(USER, started.body.job.id);
    return job?.ended !== undefined ? job : null;
  });
  expect(ended.state).toBe("done");
  expect(b.turns.chats.folders(USER, CHAT)).not.toBeNull();
  const { session } = ended.scope;
  expect((await b.turns.files.read({ user: USER, chat: CHAT, session }, `sessions/${session}/${session}.jsonl`)).status).toBe("read");
  expect(b.logged.filter((l) => /could not be (written|saved)/.test(l.message))).toEqual([]);

  const none = await b.page<{ error: string }>("POST", "/api/v1/chats/chat-nobody-has/jobs", { definition: "historian", brief: BRIEF });
  expect(none.status).toBe(404);
  expect(b.turns.chats.folders(USER, "chat-nobody-has")).toBeNull();
});
