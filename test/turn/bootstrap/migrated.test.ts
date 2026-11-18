// The bootstrap for chats a migration carried (plan §12, §15): the Migration page starts the same job for the
// chats it names, or for every chat the migration carried, one after another; RPH runs as many at once as
// the user's setting allows and the rest wait for a place; the answer says which started and which were
// refused, and why. Played through the stand-in Lumiverse on the scripted model, with the user's setting
// of one job at a time. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import { gate } from "rp-harness/testing/rig";
import { BOOTSTRAP_CHAT_PATH, BOOTSTRAP_PATH, type BootstrapBatch, type BootstrapChat } from "../../../src/turn/bootstrap";
import { CHARACTER, CHAT, USER } from "../bed";
import { type BootBed, openBootBed } from "./rig";

const beds: BootBed[] = [];
afterEach(async () => {
  for (const { b } of beds.splice(0)) await b.close();
});

const HERON = "chat-heron";
const GONE = "chat-gone";

// The answer lists what started and what was refused: a chat Lumiverse does not hold; a chat with a job under way is not refused (e578d7aa3).
test("every chat the migration carried is started one after another within the jobs at once; the answer says which started and which were refused, and why", async () => {
  const held = { first: gate(), second: gate() };
  const boot = await openBootBed({
    global: "jobs:\n  atOnce: 1\n",
    carried: [CHAT, HERON, GONE],
    answers: [{ pieces: [{ hold: held.first }, { text: "Filed the notebook of the lighthouse." }] }, { pieces: [{ hold: held.second }, { text: "Filed the notebook of the heron." }] }],
  });
  beds.push(boot);
  const { b, call } = boot;
  b.host.addChat({ id: HERON, user: USER, name: "The heron", character: CHARACTER, messages: [{ id: "m-heron", role: "assistant", content: "A heron stands in the shallows." }] });

  const all = await call<BootstrapBatch>("POST", BOOTSTRAP_PATH, {}, { chats: "migrated", relive: "outline" });
  expect(all.status).toBe(200);
  expect(all.body.started.map((s) => [s.chat, s.job.state, s.job.agent, s.job.scope.chat])).toEqual([
    [CHAT, "running", "author", CHAT],
    [HERON, "queued", "author", HERON],
  ]);
  expect(all.body.refused).toEqual([{ chat: GONE, why: `No bootstrap job was started: There is no chat ${GONE} for this RPE's Lumiverse user.` }]);

  // A chat whose job is under way is started again by a second start, which begins a second job (e578d7aa3); it is not made here, for the model's answers are scripted in order.
  const [lighthouse, heron] = all.body.started.map((s) => s.job.id);

  // One at a time, as the setting says: the heron's job runs once the lighthouse's has ended.
  held.first.open();
  await b.until("the heron's job to run", async () => (await b.turns.harness.jobs.get(USER, heron ?? ""))?.state === "running");
  held.second.open();
  const ended = await b.until("both jobs to end", async () => {
    const pages = await Promise.all([CHAT, HERON].map((chat) => boot.jobs.jobs(USER, chat, 50)));
    const jobs = pages.flatMap((p) => p.items);
    return jobs.every((j) => j.view?.state === "done") ? jobs : null;
  });
  expect(ended.map((j) => [j.id, j.relive, j.view?.report])).toEqual([
    [lighthouse, "outline", "Filed the notebook of the lighthouse."],
    [heron, "outline", "Filed the notebook of the heron."],
  ]);
  expect(b.model.requests.map((r) => r.index)).toEqual([0, 1]);
});

test("the batch's body is a list of chat ids or the word for every chat the migration carried", async () => {
  const boot = await openBootBed({ answers: [] });
  beds.push(boot);
  expect(await boot.call("POST", BOOTSTRAP_PATH, {}, { chats: "all" })).toEqual({ status: 400, body: { error: expect.stringContaining("does not take this body") } });
  expect(await boot.call("POST", BOOTSTRAP_PATH, {}, { chats: "migrated" })).toEqual({ status: 200, body: { started: [], refused: [] } });
});
