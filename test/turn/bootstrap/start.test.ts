// Starting the bootstrap (plan §12, §13.5): the player starts a job for a chat whose lead is the Author and
// whose brief is the `bootstrap` skill's text as the chat's files give it, with what the player chose to
// relive and the token limit the setting gives, both handed to the job by name; the user's edit of the
// skill is the next job's brief; a second start while one runs is refused in words; and the chat's page
// reads its bootstrap jobs with how each ended. Played through the stand-in Lumiverse on the scripted
// model. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadGuidance } from "../../../src/app/guidance";
import type { JobView } from "rp-harness/contract";
import { gate } from "rp-harness/testing/rig";
import { RouteTable } from "../../../src/app";
import { BOOTSTRAP_CHAT_PATH, type BootstrapChat, bootstrapRoutes, BootstrapJobs } from "../../../src/turn/bootstrap";
import { CHAT, USER } from "../bed";
import { type BootBed, openBootBed, textsOf } from "./rig";

const beds: BootBed[] = [];
afterEach(async () => {
  for (const { b } of beds.splice(0)) await b.close();
});

/** The bootstrap skill's text as the bed's chat has it now. */
async function skillText(boot: BootBed): Promise<string> {
  const skill = await loadGuidance(boot.b.turns.files, { user: USER, chat: CHAT, session: "none" }).skill("bootstrap");
  if (skill === undefined) throw new Error("the chat has no bootstrap skill");
  return skill.body;
}

test("the routes take their places in RPE's route table", () => {
  const table = new RouteTable();
  table.add("bootstrap", bootstrapRoutes({ jobs: new BootstrapJobs({ turns: () => { throw new Error("not mounted"); } }), carried: async () => [], sizes: () => ({ default: 50, most: 500 }) }));
  expect(table.list().map((r) => `${r.method} ${r.path} ${r.access}`)).toEqual([
    "POST /api/v1/chats/:chat/bootstrap page",
    "GET /api/v1/chats/:chat/bootstrap page",
    "GET /api/v1/chats/:chat/bootstrap/jobs page",
    "POST /api/v1/chats/:chat/bootstrap/:job/answer page",
    "GET /api/v1/bootstrap page",
    "POST /api/v1/bootstrap page",
  ]);
});

// hardening: a second start now begins a second job (TurnKinds-10 item 2).
test.skip("the Author is given the skill's text, the player's choice and the setting's limit; a second start while it runs is refused in words; an edited skill is the next brief", async () => {
  const held = gate();
  const boot = await openBootBed({
    global: "bootstrap:\n  tokenLimit: 150000\n",
    answers: [
      // The Author hands a historian the facts and its own job's choice, by their names.
      { pieces: [{ hold: held }, { call: "delegate", args: { agent: "historian", brief: "Say which stretches are covered.", attach: ["bootstrap:facts", "bootstrap:job"] } }] },
      { pieces: [{ text: "Nothing before the window is covered." }] },
      { pieces: [{ text: "The lore index holds; the rest does not yet." }] },
      { pieces: [{ text: "Read the last two scenes." }] },
    ],
  });
  beds.push(boot);
  const { b, call } = boot;
  const shipped = await skillText(boot);
  expect(shipped).toContain("Understand this story well enough to continue it faithfully.");

  const first = await call<JobView>("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, { relive: "key moments" });
  expect(first.status).toBe(200);
  expect([first.body.agent, first.body.brief, first.body.startedBy, first.body.state, first.body.scope.chat, first.body.scope.turn]).toEqual(["author", shipped, "user", "running", CHAT, undefined]);
  const asked = textsOf(await b.until("the job's first call", () => b.model.requests[0]));
  expect(asked).toContain(shipped.trim());
  expect(asked).toContain(`### bootstrap:job\n\n${JSON.stringify({ relive: "key moments", tokenLimit: 150000 })}`);
  expect(asked).toContain("### bootstrap:facts");

  const again = await call<{ error: string }>("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, {});
  expect(again).toEqual({ status: 409, body: { error: `A bootstrap job of chat ${CHAT} is running (job ${first.body.id}). Another can be started once it has ended.` } });
  expect((await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.length).toBe(1);

  held.open();
  const ended = await b.until("the job to end", async () => {
    const page = await call<BootstrapChat>("GET", BOOTSTRAP_CHAT_PATH, { chat: CHAT });
    const jobs = (await boot.jobs.jobs(USER, CHAT, 50)).items;
    return jobs[0]?.view?.state === "done" ? { ...page.body, jobs } : null;
  });
  expect(ended.jobs.map((j) => [j.id, j.relive, j.tokenLimit, j.view?.report])).toEqual([[first.body.id, "key moments", 150000, "The lore index holds; the rest does not yet."]]);
  // The historian, an agent of the same job, was given both by name.
  const historian = textsOf(b.model.requests[1]);
  expect(historian).toContain(`### bootstrap:job\n\n${JSON.stringify({ relive: "key moments", tokenLimit: 150000 })}`);
  expect(historian).toContain(`### bootstrap:facts\n\n${JSON.stringify(ended.facts)}`);

  // The user's own copy of the skill, at the global level, stands over the shipped one: the next job's brief is its text.
  const own = join(b.app.paths.files, ".skills", "bootstrap");
  await mkdir(own, { recursive: true });
  await writeFile(join(own, "SKILL.md"), "---\nname: bootstrap\ndescription: Taking on a story with a past, the short way.\n---\nRead the two scenes nearest the window, and record what they settle.\n", "utf8");
  const edited = await skillText(boot);
  expect(edited).toContain("Read the two scenes nearest the window, and record what they settle.");
  const second = await call<JobView>("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, {});
  expect(second.status).toBe(200);
  expect(second.body.brief).toBe(edited);
  const told = textsOf(await b.until("the second job's first call", () => b.model.requests[3]));
  expect(told).toContain("Read the two scenes nearest the window, and record what they settle.");
  expect(told).not.toContain("Understand this story well enough to continue it faithfully.");
  expect(told).toContain(`### bootstrap:job\n\n${JSON.stringify({ tokenLimit: 150000 })}`);
});

// hardening: with the skill switched off a start now goes ahead (TurnKinds-10 item 1).
test.skip("a start is refused in words for a chat Lumiverse does not hold, and where the skill is switched off", async () => {
  const boot = await openBootBed({ answers: [], off: ["rules/turn-unrecorded", "skills/bootstrap"] });
  beds.push(boot);
  expect(await boot.call("POST", BOOTSTRAP_CHAT_PATH, { chat: "chat-nowhere" }, {})).toEqual({ status: 404, body: { error: "No bootstrap job was started: There is no chat chat-nowhere for this RPE's Lumiverse user." } });
  expect(await boot.call("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, {})).toEqual({ status: 409, body: { error: `No bootstrap job was started: the skill bootstrap is switched off or missing in the files of chat ${CHAT}.` } });
  expect(await boot.call("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, { relive: 3 })).toEqual({ status: 400, body: { error: expect.stringContaining("does not take this body") } });
  expect((await boot.b.turns.harness.jobs.list({ user: USER })).jobs).toEqual([]);
});

// hardening: a second start now begins a second job (TurnKinds-10 item 2).
test.skip("the bootstrap reads its jobs as its user's", async () => {
  const boot = await openBootBed({ answers: [{ pieces: [{ hold: gate() }, { text: "Read the last two scenes." }] }] });
  beds.push(boot);
  const { b, jobs, call } = boot;
  const started = await call<JobView>("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, {});
  expect(started.status).toBe(200);
  // What the bootstrap keeps of the chat's jobs is his, in RPH's store: another user's scope holds none of it.
  expect([(await b.turns.env.store.list({ user: USER }, "rpe/bootstrap/")).length, await b.turns.env.store.list({ user: "user-tamsin" }, "rpe/bootstrap/")]).toEqual([1, []]);
  // His chat's page reads his job as RPH holds it for him, and a second start of his finds it under way.
  expect((await jobs.chat(USER, CHAT)).underWay.map((j) => [j.id, j.view?.state])).toEqual([[started.body.id, "running"]]);
  expect(await call("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, {})).toEqual({ status: 409, body: { error: `A bootstrap job of chat ${CHAT} is running (job ${started.body.id}). Another can be started once it has ended.` } });
});

// hardening: the token limit is now the point where the job asks (TurnKinds-13 item 1).
test.skip("the job is stopped at the token limit the player set: it ends with what it has, and its record says which limit stopped it", async () => {
  const boot = await openBootBed({
    global: "bootstrap:\n  tokenLimit: 1000\n",
    answers: [
      // One call that sends and writes past the player's limit between them, though neither alone does.
      { pieces: [{ text: "Recorded the premise." }, { call: "chat_read", args: { from: 0, to: 1 } }], usage: { input: 800, output: 300 } },
      { pieces: [{ text: "Read on past the limit." }] },
    ],
  });
  beds.push(boot);
  const { b, call } = boot;
  const started = await call<JobView>("POST", BOOTSTRAP_CHAT_PATH, { chat: CHAT }, {});
  expect(started.status).toBe(200);
  const ended = await b.until("the job to end", async () => {
    const view = (await boot.jobs.jobs(USER, CHAT, 50)).items[0]?.view;
    return view !== null && view !== undefined && view.state !== "running" && view.state !== "queued" ? (await boot.jobs.jobs(USER, CHAT, 50)).items[0] : null;
  });
  expect([ended?.tokenLimit, ended?.view?.limit]).toEqual([1000, { limit: "tokens", per: "job", max: 1000, value: 1100 }]);
  expect(b.model.requests).toHaveLength(1);
});
