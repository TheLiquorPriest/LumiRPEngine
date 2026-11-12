// The prepared start as it runs (`backend/story/prepare-live.ts`): a preparation built call by call
// from the real tools, on a real chat, with its workspace and story record kept in memory and LumiAH's
// jobs a stand-in that lists them as LumiAH does. Each read of the view is checked to load nothing of
// the chat (its messages, its World Info): it is asked every few seconds for hours.

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import type { HarnessCore, RunSpent } from "../../src/backend/harness/extension";
import { preparePage, updatePrepare, withRelived } from "../../src/backend/story/prepare";
import { mindPath } from "../../src/backend/story/minds";
import { prepareLive } from "../../src/backend/story/prepare-live";
import { AUTHOR_FILE, HARNESS_AGENT } from "../../src/shared/harness-texts";
import { PREPARE_PATH, PREPARE_STORY } from "../../src/shared/harness-texts-prepare";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { PrepareLive, PrepareLiveView } from "../../src/shared/prepare-live";
import type { UserSettings } from "../../src/shared/settings";
import { attachBook, bookEntry } from "../support/tools";
import { answer, call, castChat, castEnv, castTurn, JOSS, MARA, memoryFiles, memoryStory } from "./harness-cast-kit";
import { mount, playOn } from "./harness-driver";

/** When the preparation starts, and a moment `minutes` later, as every clock of the test reads it. */
const T0 = Date.UTC(2026, 10, 11, 9, 0);
const at = (minutes: number): number => {
  setSystemTime(new Date(T0 + minutes * 60_000));
  return T0 + minutes * 60_000;
};

afterEach(() => {
  setSystemTime();
});

/** LumiAH's jobs as a stand-in keeps them, listed the latest first, with what its live view counts of each run under way; and the ops a player's press asks, answered as LumiAH answers them. */
function jobsStandIn(chatId: string) {
  const jobs: JsonObject[] = [];
  const live: Record<string, RunSpent> = {};
  let started = 0;
  const core: HarnessCore = {
    async ask(_userId, op, args): Promise<JsonValue> {
      if (op === "jobs.list") return { jobs: jobs.slice(0, Number(args.limit)), next: null };
      if (op === "run.say") return { said: true };
      if (op === "jobs.start") {
        const job: JsonObject = { id: `run-started-${++started}`, chatId, agent: String(args.agent), task: String(args.task), when: "now", state: "queued", by: { who: "user" }, basis: null, plan: String(args.plan), createdAt: Date.now(), usage: { in: 0, out: 0, calls: 0 } };
        jobs.unshift(job);
        return { job };
      }
      throw new Error(`the stand-in has no ${op}`);
    },
    stop: () => undefined,
    spent: (_userId, stream) => live[stream] ?? null,
  };
  return {
    core,
    jobs,
    live,
    /** The author's run the player started: it keeps the preparation's file. */
    author: (id: string, over: JsonObject = {}): void => void jobs.unshift({ id, chatId, agent: HARNESS_AGENT.author, task: "Prepare the story.", when: "now", state: "running", by: { who: "user" }, basis: null, area: "chat", plan: PREPARE_PATH, createdAt: Date.now(), startedAt: Date.now(), usage: { in: 0, out: 0, calls: 0 }, ...over }),
    /** A principal's reliving run, which the author's run `parent` started. */
    reliving: (id: string, who: string, parent: string, over: JsonObject = {}): void => void jobs.unshift({ id, chatId, agent: HARNESS_AGENT.character, as: who, task: "Relive what reached you.", when: "now", state: "running", by: { who: "agent", id: "agent_author", role: HARNESS_AGENT.author }, basis: null, parent, createdAt: Date.now(), startedAt: Date.now(), usage: { in: 0, out: 0, calls: 0 }, ...over }),
    /** A run as it stands now. */
    set: (id: string, change: JsonObject): void => {
      const i = jobs.findIndex((j) => j.id === id);
      jobs[i] = { ...jobs[i], ...change };
    },
  };
}

/**
 * A Port Alder chat with twelve messages played before the engine came in (and its opening one, #0),
 * on the harness; a LumiBooks summary of messages #5 to #10 in a World Info book; Mara and Joss cast as
 * principals; the preparation's workspace and story record in memory, and LumiAH's jobs a stand-in.
 * `envOf`: the env of a call of the author's run `job`, or of a character's run started as `as`.
 * `look`: the view as the page reads it, checked to have read nothing of the chat.
 */
async function preparing(askAboveTokens: number) {
  at(0);
  const { rig, chatId } = await castChat();
  mount(rig);
  await playOn(rig, chatId, "harness");
  const chat = rig.host.chat(chatId);
  for (let i = 1; i <= 12; i++) rig.host.append(chat, { id: `old-${i}`, isUser: i % 2 === 1, name: i % 2 === 1 ? "User" : "Narrator", swipes: [i % 2 === 1 ? `I ask Mara about the rent, time ${i}.` : `Mara tells Joss the rent is late, time ${i}.`], swipeId: 0, bag: {} });
  await attachBook(rig, chatId, "Chronicle", [bookEntry("Chapter 2: Joss finds out", "Joss learns the rent is late, and keeps it to himself.", { extensions: { lumibooks_summary: { tier: 1, messageIndices: [5, 6, 7, 8, 9, 10] } } })]);
  const base: UserSettings = await rig.rt.settings.get(rig.host.userId);
  const settings: UserSettings = { ...base, story: { ...base.story, prepare: { ...base.story.prepare, askAboveTokens } } };
  const story = memoryStory({ cast: [{ entity: MARA, standing: "principal" }, { entity: JOSS, standing: "principal" }] }, false);
  const files = memoryFiles();
  // The story as the author understands it, which a plan on a chat with a history is written from.
  await files.write(PREPARE_STORY, "Mara keeps the boarding house and is behind on the rent. Joss is owed.", null);
  const jobs = jobsStandIn(chatId);
  rig.rt.harness.files = () => files;
  rig.rt.harness.core = jobs.core;
  const envOf = async (job: string, as?: string) => ({ ...castEnv(rig, chatId, await castTurn(rig, chatId, { main: false, settings, story, job: { id: job, byUser: true } }), as === undefined ? HARNESS_AGENT.author : HARNESS_AGENT.character, null, as), files });
  // What the page's read loads of the chat: its messages and its World Info, counted around each read.
  const reads = { chat: 0, books: 0 };
  const messages = rig.host.chats.messages;
  rig.host.chats.messages = (...args) => {
    reads.chat++;
    return messages(...args);
  };
  const entries = rig.host.books.entries;
  rig.host.books.entries = (...args) => {
    reads.books++;
    return entries(...args);
  };
  const userId = rig.host.userId;
  const look = async (): Promise<PrepareLiveView> => {
    const before = { ...reads };
    const view = await prepareLive(rig.rt, { chatId, userId });
    expect({ chat: reads.chat - before.chat, books: reads.books - before.books }).toEqual({ chat: 0, books: 0 });
    return view;
  };
  const prep = async (): Promise<PrepareLive> => {
    const view = await look();
    if (view.prep === null) throw new Error("no preparation in the view");
    return view.prep;
  };
  // Who has taken in each recorded stretch, worked out as a preparing tool does whenever it has the story's record at hand.
  const relive = async (): Promise<void> => {
    const read = await story.read();
    await updatePrepare(files, settings.prompts.texts, (now) => (now.state && read ? withRelived(now.state, read.path, Date.now()) : { stop: null }));
  };
  return { rig, chatId, userId, files, story, jobs, envOf, look, prep, relive };
}

/** The plan both tests write: Mara relives #1 to #6, Mara and Joss #7 to #12. */
const PLAN = { about: "Mara keeps the boarding house and is behind on the rent.", principals: [{ who: "Mara", why: "The story is hers." }, { who: "Joss", why: "He is owed." }], stretches: [{ from: 1, to: 6, why: "Where the rent trouble starts.", who: ["Mara"] }, { from: 7, to: 12, why: "Joss finds out.", who: ["Mara", "Joss"] }], estimate: 1000, depth: "all", depthWhy: "Both stretches made the story what it is." };

/** Each stage's state, in order. */
const stagesOf = (p: PrepareLive): string[] => p.stages.map((s) => `${s.id}:${s.state}`);

describe("the prepared start as it runs", () => {
  test("each stage is told from the file and the jobs, a stretch being relived names who and how many are through, a failed run says why, and the counts add up to the chat", async () => {
    const { files, story, jobs, envOf, look, prep, relive } = await preparing(100_000_000);
    // Nothing started: nothing to show, and nothing asked again.
    expect(await look()).toMatchObject({ live: false, prep: null });

    // The player started it: the author reads the story, its run counted as LumiAH's live view counts it.
    jobs.author("run-1");
    jobs.live["run-1"] = { in: 30_000, out: 2_000, calls: 3, last: 11_000 };
    const reading = await look();
    expect(reading.live).toBe(true);
    expect(reading.every).toBe(5);
    expect(reading.prep?.stage).toBe("reading");
    expect(reading.prep?.going).toBe("running");
    expect(reading.prep?.runs).toEqual([expect.objectContaining({ role: "author", state: "running", used: { tokens: 32_000, calls: 3 }, since: T0 })]);

    // The plan, within the player's ceiling: no word is needed, and reliving is what it does now.
    at(5);
    const author = await envOf("run-1");
    await answer(author, "prepare_survey", { part: "summaries" });
    await answer(author, "prepare_survey", { part: "lore" });
    await answer(author, "prepare_plan", PLAN);
    const plannedOut = await prep();
    expect(stagesOf(plannedOut)).toEqual(["reading:done", "planning:done", "waiting:skipped", "reliving:now", "filling:ahead", "scene:ahead", "ready:ahead"]);
    expect(plannedOut.stretches.map((s) => [s.id, s.state, s.relivers])).toEqual([
      ["s1", "waiting", [MARA]],
      ["s2", "waiting", [MARA, JOSS]],
    ]);
    expect(plannedOut.left).toBeNull();
    expect(plannedOut.depth).toEqual({ chosen: "all", recommended: "all", picked: false });

    // A stretch opened: the historian records it inside the author's run, since it was opened.
    at(10);
    expect((await call(author, "prepare_relive", { stretch: "s1" })).error).toBeUndefined();
    const opened = await prep();
    expect(opened.runs.map((r) => [r.role, r.stretch, r.inside, r.since])).toEqual([
      ["author", null, null, T0],
      ["historian", "s1", "run-1", T0 + 10 * 60_000],
    ]);
    expect(opened.stretches[0]?.state).toBe("reading");

    // The historian records a beat of Mara's that Joss heard whole, and closes the stretch: it reached them both.
    at(20);
    const now = (await answer(author, "stretch_read", { stretch: "s1" })).now as string;
    expect((await call(author, "stretch_beats", { stretch: "s1", through: 6, beats: [{ when: now, by: "Mara", kind: "say", what: "Mara tells Joss the rent is late.", surface: "Mara tells Joss the rent is late.", exposure: [{ who: "Joss", reach: "whole" }] }] })).error).toBeUndefined();
    at(30);
    expect((await call(author, "stretch_done", { stretch: "s1" })).error).toBeUndefined();
    const beat = story.written.beats?.[0]?.id ?? "";
    jobs.reliving("run-mara", MARA, "run-1");
    jobs.reliving("run-joss", JOSS, "run-1");
    const recorded = await prep();
    expect(recorded.stretches[0]).toMatchObject({ id: "s1", state: "reliving", beats: 1, relivers: [MARA, JOSS], relived: [] });
    expect(recorded.runs.filter((r) => r.role === "principal").map((r) => [r.who, r.stretch])).toEqual([
      [MARA, "s1"],
      [JOSS, "s1"],
    ]);

    // Mara takes it in (her own run marks her feed); the author's status works out who is through.
    at(40);
    expect((await call(await envOf("run-mara", MARA), "mind_digested", { to: beat })).error).toBeUndefined();
    await relive();
    const half = await prep();
    expect(half.stretches[0]).toMatchObject({ state: "reliving", relivers: [MARA, JOSS], relived: [MARA] });
    expect(half.relivedAt).toBe(T0 + 40 * 60_000);
    // Nothing is done yet, so there is no pace to reckon a time left at.
    expect(half.left).toBeNull();

    // Joss's run failed: the view says why, in LumiAH's words.
    at(45);
    jobs.set("run-joss", { state: "failed", endedAt: Date.now(), reason: "The connection refused the call: the model is overloaded." });
    const failed = await prep();
    expect(failed.runs.find((r) => r.who === JOSS)).toMatchObject({ role: "principal", state: "failed", reason: "The connection refused the call: the model is overloaded.", endedAt: T0 + 45 * 60_000 });

    // A new run of his relives it: the failure is behind it, the stretch is done, and a time left is reckoned at its pace.
    at(50);
    jobs.reliving("run-joss-2", JOSS, "run-1", { again: "run-joss" });
    at(60);
    expect((await call(await envOf("run-joss-2", JOSS), "mind_digested", { to: beat })).error).toBeUndefined();
    await relive();
    const done = await prep();
    expect(done.stretches[0]).toMatchObject({ state: "done", relived: [MARA, JOSS] });
    expect(done.runs.filter((r) => r.state === "failed")).toEqual([]);
    // s1 took from its opening (10) to its last reliving (60): fifty minutes for the one stretch left.
    expect(done.left).toEqual({ ms: 50 * 60_000, stretches: 1 });
    // Of the chat's thirteen messages: #1 to #6 relived; #7 to #10 of the summary's #5 to #10 filled from it; #0, #11 and #12 neither.
    expect(done.messages).toEqual({ total: 13, relived: 6, filled: 4, neither: 3 });
    expect(done.principals.map((p) => [p.id, p.planned, p.relived, p.outline, p.profile])).toEqual([
      [MARA, 2, 1, false, false],
      [JOSS, 2, 1, false, false],
    ]);

    // The second stretch dropped: the author fills in what each principal knows.
    at(70);
    jobs.set("run-mara", { state: "done", endedAt: Date.now() });
    jobs.set("run-joss-2", { state: "done", endedAt: Date.now() });
    expect((await call(author, "prepare_relive", { stretch: "s2", drop: true })).error).toBeUndefined();
    expect((await prep()).stage).toBe("filling");
    at(80);
    for (const who of ["Mara", "Joss"]) expect((await call(author, "prepare_outline", { who, text: `What ${who} knows of the rest, in outline.` })).error).toBeUndefined();
    for (const id of [MARA, JOSS]) await files.write(mindPath(id, "core"), `Who ${id} is at heart.`, null);
    expect((await prep()).stage).toBe("scene");
    at(90);
    await files.write(AUTHOR_FILE.scene, "Where everyone stands.", (await files.read(AUTHOR_FILE.scene))?.version ?? null);
    await files.write(AUTHOR_FILE.notebook, "The author's notebook.", (await files.read(AUTHOR_FILE.notebook))?.version ?? null);
    const closing = await prep();
    expect([closing.stage, closing.scene, closing.notebook]).toEqual(["scene", true, true]);

    // Finished: ready, done, and no longer asked for.
    at(100);
    expect((await call(author, "prepare_finish", { note: "Prepared." })).error).toBeUndefined();
    // The author's closing run is still at work: the view is asked again until it ends, so it never goes on saying someone is at work.
    expect((await look()).live).toBe(true);
    at(101);
    jobs.set("run-1", { state: "done", endedAt: Date.now(), workedMs: 95 * 60_000 });
    const ready = await look();
    expect(ready.live).toBe(false);
    expect(ready.prep).toMatchObject({ stage: "ready", going: "done", runs: [], startedAt: T0, endedAt: T0 + 100 * 60_000, workedMs: 95 * 60_000, left: null });
  });

  test("the trail holds what happened, newest first: the plan, the player's words and the author's answer, a recorded stretch and the finish, with its runs", async () => {
    const { rig, chatId, userId, files, story, jobs, envOf, look, prep, relive } = await preparing(0);
    jobs.author("run-1");
    at(5);
    const author = await envOf("run-1");
    await answer(author, "prepare_survey", { part: "summaries" });
    await answer(author, "prepare_survey", { part: "lore" });
    await answer(author, "prepare_plan", PLAN);
    // Above the ceiling: the run ends to wait for the player's word, and nothing is asked again meanwhile.
    at(6);
    jobs.set("run-1", { state: "done", endedAt: Date.now() });
    const waiting = await look();
    expect([waiting.live, waiting.prep?.stage, waiting.prep?.going]).toEqual([false, "waiting", "waiting"]);

    // The player's words: a run starts to revise the plan with them, and the view asks again.
    at(10);
    await preparePage(rig.rt, { chatId, userId }, { op: "steer", text: "Leave out the boat races." });
    const revising = await look();
    expect([revising.live, revising.prep?.stage, revising.prep?.going]).toEqual([true, "planning", "queued"]);
    const second = String(jobs.jobs[0]?.id);
    jobs.set(second, { state: "running", startedAt: Date.now() });
    at(15);
    await answer(await envOf(second), "prepare_plan", { ...PLAN, answer: "The boat races are left out." });
    expect((await prep()).stage).toBe("waiting");
    at(20);
    await preparePage(rig.rt, { chatId, userId }, { op: "approve" });
    const approved = await prep();
    expect(approved.stage).toBe("reliving");
    // The plan written again keeps no stretch it hadn't opened: its stretches are new ones.
    const [first, last] = approved.stretches.map((s) => s.id);
    if (first === undefined || last === undefined) throw new Error("the revised plan lost its stretches");

    // A stretch recorded and relived, the other dropped, and the rest written, to the finish.
    const next = await envOf(second);
    at(30);
    expect((await call(next, "prepare_relive", { stretch: first })).error).toBeUndefined();
    const now = (await answer(next, "stretch_read", { stretch: first })).now as string;
    expect((await call(next, "stretch_beats", { stretch: first, through: 6, beats: [{ when: now, by: "Mara", kind: "say", what: "Mara counts the rent money.", surface: "Mara counts coins.", exposure: [] }] })).error).toBeUndefined();
    at(40);
    expect((await call(next, "stretch_done", { stretch: first })).error).toBeUndefined();
    at(45);
    expect((await call(await envOf("run-mara", MARA), "mind_digested", { to: story.written.beats?.[0]?.id ?? "" })).error).toBeUndefined();
    await relive();
    at(50);
    expect((await call(next, "prepare_relive", { stretch: last, drop: true })).error).toBeUndefined();
    for (const who of ["Mara", "Joss"]) expect((await call(next, "prepare_outline", { who, text: `What ${who} knows, in outline.` })).error).toBeUndefined();
    for (const id of [MARA, JOSS]) await files.write(mindPath(id, "core"), `Who ${id} is.`, null);
    await files.write(AUTHOR_FILE.scene, "Where everyone stands.", (await files.read(AUTHOR_FILE.scene))?.version ?? null);
    await files.write(AUTHOR_FILE.notebook, "The notebook.", (await files.read(AUTHOR_FILE.notebook))?.version ?? null);
    at(60);
    expect((await call(next, "prepare_finish", {})).error).toBeUndefined();
    at(61);
    jobs.set(second, { state: "done", endedAt: Date.now() });
    const trail = (await prep()).trail;
    // Newest first, each at the time it happened.
    expect(trail.map((e) => e.at)).toEqual([...trail.map((e) => e.at)].sort((a, b) => b - a));
    expect(trail.filter((e) => !e.what.startsWith("run_")).map((e) => [e.what, e.stretch ?? null, e.who ?? null])).toEqual([
      ["finished", null, null],
      ["outlined", null, JOSS],
      ["outlined", null, MARA],
      ["dropped", last, null],
      ["relived", first, MARA],
      ["recorded", first, null],
      ["opened", first, null],
      ["approved", null, null],
      ["revised", null, null],
      ["answered", null, null],
      ["said", null, null],
      ["planned", null, null],
    ]);
    expect(trail.find((e) => e.what === "said")).toMatchObject({ text: "Leave out the boat races.", at: T0 + 10 * 60_000 });
    expect(trail.find((e) => e.what === "answered")?.text).toBe("The boat races are left out.");
    expect(trail.find((e) => e.what === "recorded")).toMatchObject({ count: 1, at: T0 + 40 * 60_000 });
    // The author's runs: each begun and ended, in its place among the rest.
    expect(trail.filter((e) => e.what.startsWith("run_")).map((e) => [e.what, e.at])).toEqual([
      ["run_ended", T0 + 61 * 60_000],
      ["run_started", T0 + 10 * 60_000],
      ["run_ended", T0 + 6 * 60_000],
      ["run_started", T0],
    ]);
  });
});
