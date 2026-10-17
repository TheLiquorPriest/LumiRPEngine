// What survives a server or extension restart (issue #15): jobs and their proposals, the decline
// notes for the next turn's Outcome slot, the inspector's history and delivery badges, and the
// call meter. Each test restarts the runtime, job runner and stores over the same fake-host
// storage, and checks the damaged-file path of each store.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { runDir } from "../../src/shared/ids";
import type { JobSummary } from "../../src/shared/protocol";
import { InspectorLog, INSPECTOR_RUNS, type InspectorRecord } from "../../src/backend/inspector-log";
import { JOBS_KEPT, JOBS_PATH } from "../../src/backend/jobs";
import type { QuietResult } from "../../src/backend/host";
import { CallMeter, METER_PATH } from "../../src/backend/steps";
import { CORRUPT_SUFFIX } from "../../src/backend/stored-json";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

const EXTRACT_MARK = "propose concrete state changes";

const lore = (comment: string, content: string) => ({ comment, content, keys: [comment.toLowerCase()], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} });

async function jobsOf(rig: Rig, worldId: string): Promise<JobSummary[]> {
  const body = rig.body(await rig.send({ type: "lre.job", op: "list", worldId }));
  return Array.isArray(body.jobs) ? (body.jobs as JobSummary[]) : [];
}

function outcomeText(rig: Rig): string {
  return rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
}

/** Lets the queued storage work run (the fake host's storage settles on microtasks) until `ready` holds. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100_000 && !ready(); i++) await Promise.resolve();
  if (!ready()) throw new Error("the condition never held");
}

/** A model call that never answers (the process stops before it would). */
function unanswered(): Promise<QuietResult> {
  return Promise.withResolvers<QuietResult>().promise;
}

describe("a restart", () => {
  test("an import cut off by a restart shows as interrupted; the proposals it made can be reviewed, applied and committed, and it runs again", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const book = await rig.host.books.create("Town lore", "", rig.host.userId);
    // Seven entries: two chunks, so the import is cut off after the first.
    await rig.host.books.createEntry(book, lore("The diner", "Rosie's Diner sits on Main Street."), rig.host.userId);
    for (let i = 1; i < 7; i++) await rig.host.books.createEntry(book, lore(`Note ${i}`, `Note ${i}.`), rig.host.userId);
    const scripted = rig.host.models.quiet;
    let calls = 0;
    rig.host.models.quiet = (request) => {
      calls++;
      if (calls > 1) return unanswered();
      rig.host.quietCalls.push(request);
      return Promise.resolve({ content: JSON.stringify({ proposals: [{ collection: "places", key: "rosies_diner", value: { name: "Rosie's Diner" }, confidence: 0.9 }] }), finishReason: "stop", tokens: 0 });
    };
    // Straight to the runner: the host's settle would wait on the call that never answers.
    const jobId = await rig.jobs.start("import_lore", worldId, { bookIds: [book] }, rig.host.userId);
    // The first chunk's proposals are kept while the second call is still out.
    await until(() => calls === 2 && (rig.host.files.get(`${rig.host.userId}/${JOBS_PATH}`) ?? "").includes("rosies_diner"));

    const after = rig.restart();
    const [cut] = await jobsOf(after, worldId);
    expect(cut?.jobId).toBe(jobId);
    expect(cut?.status).toBe("interrupted");
    expect(cut?.message).toContain("Interrupted by a restart");
    expect(cut?.input).toEqual({ bookIds: [book] });
    const proposals = cut?.result && "proposals" in cut.result ? cut.result.proposals : [];
    expect(proposals.map((p) => p.key)).toEqual(["rosies_diner"]);
    // Reviewed and applied as the UI does (`proposalWrites`), then committed.
    for (const p of proposals) after.body(await after.send({ type: "lre.editor", op: "put", worldId, base: null, collection: p.collection, id: p.key, value: p.value }));
    after.body(await after.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const head = after.body(await after.send({ type: "lre.world", op: "get", worldId }));
    expect(isRecord(head.world) && isRecord(head.world.places) && "rosies_diner" in head.world.places).toBe(true);
    // A job the runner doesn't run can't be cancelled; it can be run again with its input.
    expect((await after.send({ type: "lre.job", op: "cancel", jobId })).type).toBe("lre.error");
    after.host.models.quiet = scripted;
    after.host.quietReply = () => JSON.stringify({ proposals: [{ collection: "places", key: "night_market", value: { name: "Night market" }, confidence: 0.8 }] });
    const again = String(after.body(await after.send({ type: "lre.job", op: "start", kind: "import_lore", worldId, input: cut?.input ?? {} })).jobId);
    await after.host.settle();
    const listed = await jobsOf(after, worldId);
    expect(listed.map((j) => [j.jobId, j.status])).toEqual([
      [jobId, "interrupted"],
      [again, "done"],
    ]);
    // The interrupted one is dismissed with its proposals; a second restart keeps the rest as they were.
    after.body(await after.send({ type: "lre.job", op: "dismiss", jobId }));
    const third = after.restart();
    expect((await jobsOf(third, worldId)).map((j) => [j.jobId, j.status])).toEqual([[again, "done"]]);
  });

  test("ended jobs are pruned to the newest few; a running job can't be dismissed and is never pruned", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.host.quietReply = () => JSON.stringify({ proposals: [{ collection: "places", key: "kiosk", value: { name: "Kiosk" }, confidence: 0.8 }] });
    const ids: string[] = [];
    for (let i = 0; i < JOBS_KEPT + 3; i++) {
      ids.push(String(rig.body(await rig.send({ type: "lre.job", op: "start", kind: "refine", worldId, input: { instructions: `Add kiosk ${i}.` } })).jobId));
      await rig.host.settle();
    }
    rig.host.models.quiet = unanswered;
    // Straight to the runner from here: the host's settle would wait on the running job.
    const running = await rig.jobs.start("refine", worldId, { instructions: "Add a stall." }, rig.host.userId);
    const kept = await rig.jobs.list(worldId, rig.host.userId);
    expect(kept.filter((j) => j.status === "done").map((j) => j.jobId)).toEqual(ids.slice(-JOBS_KEPT));
    expect(kept.at(-1)).toMatchObject({ jobId: running, status: "running" });
    await expect(rig.jobs.dismiss(running, rig.host.userId)).rejects.toThrow("cancel it first");
    // Another user sees none of them and can't dismiss them.
    expect(await rig.jobs.list(worldId, "user-2")).toEqual([]);
    await expect(rig.jobs.dismiss(ids.at(-1) ?? "", "user-2")).rejects.toThrow("no such job");
    // Cancelled, it ends and is kept with the rest.
    await rig.jobs.cancel(running, rig.host.userId);
    expect((await rig.jobs.list(worldId, rig.host.userId)).map((j) => j.jobId)).toEqual([...ids.slice(-JOBS_KEPT + 1), running]);
  });

  test("a decline note from the last reply still reaches the next turn's Outcome slot, and only that turn's", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 99999 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings up the lamp.");
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "decline")).toBe(true);

    const after = rig.restart();
    after.host.quietReply = () => "{}";
    after.host.sendUser(chatId, "I look around.");
    await after.host.settle();
    const g = await after.host.start(chatId, { type: "normal" });
    expect(outcomeText(after)).toContain("payment for lamp was declined (Sam doesn't have $99999)");
    await after.host.finish(g, "Nothing much.");
    // A swipe of that turn is told too.
    const swipe = await after.host.start(chatId, { type: "swipe" });
    expect(outcomeText(after)).toContain("payment for lamp was declined");
    await after.host.finish(swipe, "Still nothing much.");
    // Once a later message has committed and another follows, the note is gone, across a restart too.
    const later = after.restart();
    later.host.quietReply = () => "{}";
    later.host.sendUser(chatId, "I wait.");
    await later.host.settle();
    const g2 = await later.host.start(chatId, { type: "normal" });
    expect(outcomeText(later)).not.toContain("lamp");
    await later.host.finish(g2, "Time passes.");
    expect(later.rt.ledger.errors).toEqual([]);
  });

  test("the inspector's history and delivery badges are still there, and the next turn adds to them", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I wait an hour on the porch.", "The street wakes up around you.");
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    await rig.host.settle();
    const before = (await rig.rt.view(chatId, rig.host.userId)).panels["core.context"];
    if (!isRecord(before) || !Array.isArray(before.generations)) throw new Error("no inspector panel");
    const verified = (rig.rt.inspectorRecords(chatId)?.at(-1)?.sections ?? []).filter((s) => s.delivery === "verified").map((s) => s.slot);
    expect(verified.length).toBeGreaterThan(1);

    const after = rig.restart();
    expect(after.rt.inspectorRecords(chatId)).toBeUndefined();
    // Read when the chat is first viewed.
    const panel = (await after.rt.view(chatId, after.host.userId)).panels["core.context"];
    if (!isRecord(panel) || !Array.isArray(panel.generations)) throw new Error("no inspector panel");
    expect(panel.generations).toEqual(before.generations);
    // The next turn's sections carry the badges the last delivery check found.
    await after.turn(chatId, "I wait another hour.", "Nothing much happens.");
    await after.host.settle();
    expect(after.rt.inspectorRecords(chatId)?.length).toBe(before.generations.length + 1);
    const latest = after.rt.inspectorRecords(chatId)?.at(-1)?.sections ?? [];
    expect(latest.filter((s) => s.delivery === "verified" && verified.includes(s.slot)).length).toBe(latest.filter((s) => !s.clipped && verified.includes(s.slot)).length);
    expect(latest.some((s) => s.delivery === "verified")).toBe(true);
  });

  test(`the inspector keeps the last ${INSPECTOR_RUNS} runs per chat in storage`, async () => {
    const host = new FakeHost();
    const log = new InspectorLog(host);
    const record = (i: number): InspectorRecord => ({ id: `g${i}`, at: i, activation: "unconfirmed", sections: [{ slot: "scene", label: "Scene", tokens: 10, clipped: false, delivery: "unchecked" }], budget: { sections: 600, used: 10 }, forced: [] });
    for (let i = 0; i < INSPECTOR_RUNS + 3; i++) await log.add("chat-1", host.userId, record(i));
    await log.settle();
    const fresh = new InspectorLog(host);
    expect((await fresh.load("chat-1", host.userId)).records.map((r) => r.id)).toEqual(Array.from({ length: INSPECTOR_RUNS }, (_, i) => `g${i + 3}`));
  });

  test("the call meter keeps its numbers", async () => {
    const rig = new Rig();
    rig.host.quietReply = () => "{}";
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    await rig.turn(chatId, "I wait.", "Time passes.");
    const before = (await rig.rt.view(chatId, rig.host.userId)).meter;
    expect(before?.turn.calls).toBeGreaterThan(0);

    const after = rig.restart();
    expect((await after.rt.view(chatId, after.host.userId)).meter).toEqual(before);
    // It goes on counting from there.
    await after.turn(chatId, "I wait again.", "More time passes.");
    const next = (await after.rt.view(chatId, after.host.userId)).meter;
    expect(next?.turn.calls).toBeGreaterThan(0);
    expect(next?.average.calls).toBeGreaterThan(0);
  });

  test("a meter's turns and the current turn's calls come back for their user only", async () => {
    const host = new FakeHost();
    const meter = new CallMeter(host);
    meter.record({ purpose: "extract", via: "helper", ok: true, ms: 5, tokens: 40 }, "user-1");
    meter.close("user-1");
    meter.record({ purpose: "interpret", via: "helper", ok: true, ms: 3, tokens: 7 }, "user-1");
    await meter.settle();
    const fresh = new CallMeter(host);
    await fresh.ready("user-1");
    await fresh.ready("user-2");
    expect(fresh.view("user-1").turn).toEqual({ calls: 1, tokens: 40, ms: 5 });
    expect(fresh.view("user-2").turn).toEqual({ calls: 0, tokens: 0, ms: 0 });
    fresh.close("user-1");
    await fresh.ready("user-1");
    expect(fresh.view("user-1").turn).toEqual({ calls: 1, tokens: 7, ms: 3 });
  });
});

describe("damaged files", () => {
  test("a damaged jobs, Outcome notes, inspector or call meter file is set aside as .corrupt-<time> with a warning, and a fresh one is used", async () => {
    const rig = new Rig();
    const user = rig.host.userId;
    const chatId = "chat-1";
    const damaged: [string, string][] = [
      [JOBS_PATH, "{\"v\":1,\"jobs\":"],
      [`${runDir(chatId)}outcome-notes.json`, "{\"notes\":[]}"],
      [`${runDir(chatId)}inspector.json`, "{not json"],
      [METER_PATH, "{\"v\":1,\"turns\":[],\"current\":{\"calls\":-1}}"],
    ];
    for (const [path, text] of damaged) await rig.host.storage.write(path, text, user);
    expect(await rig.jobs.list("w_any", user)).toEqual([]);
    expect(await rig.rt.outcomeNotes.list(chatId, user)).toEqual([]);
    expect((await rig.rt.inspector.load(chatId, user)).records).toEqual([]);
    await rig.rt.meter.ready(user);
    expect(rig.rt.meter.view(user).turn).toEqual({ calls: 0, tokens: 0, ms: 0 });
    const logs = rig.host.userLogs.get(user) ?? [];
    for (const [path, text] of damaged) {
      const kept = (await rig.host.storage.list(path, user)).filter((p) => p.startsWith(`${path}${CORRUPT_SUFFIX}`));
      expect(kept.length, path).toBe(1);
      expect(await rig.host.storage.read(kept[0] ?? "", user), path).toBe(text);
      expect(await rig.host.storage.read(path, user), path).toBeNull();
      expect(logs.some((l) => l.startsWith("warn: [LumiRPEngine]") && l.includes(kept[0] ?? "")), path).toBe(true);
    }
    // The fresh files work: a new job is kept in a new jobs file.
    const worldId = await rig.newWorld();
    rig.host.quietReply = () => JSON.stringify({ proposals: [] });
    rig.body(await rig.send({ type: "lre.job", op: "start", kind: "refine", worldId, input: { instructions: "Add a diner." } }));
    await rig.host.settle();
    expect((await jobsOf(rig, worldId)).map((j) => j.status)).toEqual(["done"]);
    expect(await rig.host.storage.read(JOBS_PATH, user)).not.toBeNull();
  });
});
