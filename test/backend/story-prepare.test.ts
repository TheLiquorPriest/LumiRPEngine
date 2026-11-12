// The prepared start (DEPTH2-PLAN §1.11): the plan is written before anything is spent, reckoned in
// all, the author's own work included, at what one of its model calls weighs; above the player's
// ceiling on that whole it waits for their word; their cap, counted from what LumiAH says the
// preparation spent, stops further reliving in plain words; a past beat carries its mark and a story
// time; and a preparation carries on from its file. What the player tells the author always acts:
// revised for at once, waiting for their word again, whatever their ceiling. The survey gives the
// story so far in the summaries' own text, within its size, switched-off entries too, and the plan
// waits for it on a chat with a history. Each tool is called as the bridge calls it
// (`runHarnessTool`), on a real chat, with the workspace and the story record kept in memory; each of
// the player's requests as the page sends it (`preparePage`), over LumiAH's core kept in memory.

import { describe, expect, test } from "bun:test";
import type { HarnessFiles } from "../../src/backend/agents/tools/harness-ports";
import type { JobSpent } from "../../src/backend/agents/tools/harness-turn";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import type { HarnessCore, RunSpent } from "../../src/backend/harness/extension";
import type { HostBookEntryInput } from "../../src/backend/host";
import { renderPrompt } from "../../src/backend/prompts";
import { estimateOf, preparationSpent, preparePage, readPrepare, updatePrepare } from "../../src/backend/story/prepare";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { PREPARE_NOTE, PREPARE_PATH, PREPARE_STORY } from "../../src/shared/harness-texts-prepare";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { STORY_DEFAULTS, storyPrepareOf, type UserSettings } from "../../src/shared/settings";
import type { PrepareAsk } from "../../src/shared/story-pages";
import type { Rig } from "../support/rig";
import { attachBook } from "../support/tools";
import { answer, call, castChat, castEnv, castTurn, memoryFiles, memoryStory, noModelCalls, refusal } from "./harness-cast-kit";
import { mount, playOn } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** A ceiling no plan here comes near. */
const HIGH = 100_000_000;

/** The plan the tests' author writes: Mara's story, two stretches of six messages each (`BARE`: without the depth it recommends). */
const BARE: JsonObject = { about: "Mara keeps the boarding house and is behind on the rent.", principals: [{ who: "Mara", why: "The story is hers." }], stretches: [{ from: 1, to: 6, why: "Where the rent trouble starts.", who: ["Mara"] }, { from: 7, to: 12, why: "Joss finds out.", who: ["Mara"] }], estimate: 1000 };
const PLAN: JsonObject = { ...BARE, depth: "all", depthWhy: "Both stretches made the rent trouble what it is." };

/** The twelve messages of the tests' chat, played before the engine came in: the player asks, the narrator answers. */
const TWELVE = { messages: 12, text: (i: number): string => (i % 2 === 1 ? `I ask Mara about the rent, time ${i}.` : `Mara tells Joss the rent is late, time ${i}.`) };

/**
 * A Port Alder chat with messages played before the engine came in (`said`: twelve short ones
 * unless it says), and the author's env in a preparation the player started, the story so far and
 * its lore surveyed and the story as the author understands it written (`askAboveTokens`: the
 * player's ceiling; `spent`: what LumiAH says the preparation has spent so far). `envOf` gives a run
 * of another job of the same preparation, under its own ceiling.
 */
async function preparing(askAboveTokens?: number, spent?: JobSpent, said: { messages: number; text: (i: number) => string } = TWELVE) {
  const { rig, chatId } = await castChat();
  const chat = rig.host.chat(chatId);
  for (let i = 1; i <= said.messages; i++) rig.host.append(chat, { id: `old-${i}`, isUser: i % 2 === 1, name: i % 2 === 1 ? "User" : "Narrator", swipes: [said.text(i)], swipeId: 0, bag: {} });
  const base: UserSettings = await rig.rt.settings.get(rig.host.userId);
  const settingsAt = (ceiling: number | undefined): UserSettings => (ceiling === undefined ? base : { ...base, story: { ...base.story, prepare: { ...base.story.prepare, askAboveTokens: ceiling } } });
  const settings = settingsAt(askAboveTokens);
  const story = memoryStory();
  const files = memoryFiles();
  const envOf = async (job: string, ceiling = askAboveTokens): Promise<ToolEnv> => ({ ...castEnv(rig, chatId, await castTurn(rig, chatId, { main: false, settings: settingsAt(ceiling), story, job: { id: job, byUser: true, ...(spent ? { spent: async () => spent } : {}) } }), HARNESS_AGENT.author), files });
  const env = await envOf("job-1");
  await answer(env, "prepare_survey", { part: "summaries" });
  await answer(env, "prepare_survey", { part: "lore" });
  await files.write(PREPARE_STORY, "Mara keeps the boarding house and is behind on the rent. Joss finds out.", null);
  const plan = async (on = env, extra: JsonObject = {}) => {
    const planned = await answer(on, "prepare_plan", { ...PLAN, ...extra });
    return { estimate: planned.estimate as number, call: planned.call, note: planned.note as string, stretches: planned.stretches as { stretch: string; messages: string; reckoned: number }[] };
  };
  return { rig, chatId, settings, story, files, env, envOf, plan };
}

/** LumiAH's core as the page reaches it, with the chat's `jobs` as it lists them and what its live view counts of each stream under way (`live`). */
const coreWith = (jobs: JsonObject[], live: Readonly<Record<string, RunSpent>> = {}): HarnessCore => ({ ask: async () => ({ jobs }), stop: () => false, running: () => [], spent: (_userId, stream) => live[stream] ?? null });

/** A job of the chat's as LumiAH lists it: the preparation's (the player's, keeping its file) unless `by` says another started it. */
const job = (id: string, state: string, usage: { in: number; out: number; calls: number }, by: JsonObject = { who: "user" }): JsonObject => ({ id, chatId: "chat", state, agent: HARNESS_AGENT.author, by, ...(by.who === "user" ? { plan: PREPARE_PATH } : {}), usage });

/**
 * The player's requests on the chat, as Play → Now sends them, the chat on the harness engine and
 * LumiAH's core kept in memory: `jobs` as it lists them (the oldest first), a job the page starts
 * listed as running with its task in `tasks`, and what a run under way is told in `said` (it hears it
 * where `hears`).
 */
async function pageOn(rig: Rig, chatId: string, files: HarnessFiles, jobs: JsonObject[] = [], hears = true) {
  mount(rig);
  await playOn(rig, chatId, "harness");
  const tasks: string[] = [];
  const said: string[] = [];
  rig.rt.harness.files = () => files;
  rig.rt.harness.core = {
    ask: async (_userId, op, args): Promise<JsonValue> => {
      if (op === "jobs.list") return { jobs: [...jobs].reverse() };
      if (op === "jobs.start") {
        tasks.push(String(args.task));
        jobs.push(job(`page-${jobs.length + 1}`, "running", { in: 0, out: 0, calls: 0 }));
      }
      if (op === "run.say") {
        said.push(String(args.text));
        return { said: hears };
      }
      return {};
    },
    stop: () => false,
    running: () => [],
    spent: () => null,
  };
  return { tasks, said, jobs, ask: (body: PrepareAsk) => preparePage(rig.rt, { chatId, userId: rig.host.userId }, body) };
}

/** Opens the plan's stretch `id` (#1 to #6), records a beat of it and closes it, as the author and the historian would. */
async function recordFirst(env: ToolEnv, id: string): Promise<void> {
  expect((await call(env, "prepare_relive", { stretch: id })).error).toBeUndefined();
  const now = (await answer(env, "stretch_read", { stretch: id })).now as string;
  expect((await call(env, "stretch_beats", { stretch: id, through: 6, beats: [{ when: now, by: "Mara", kind: "say", what: "Mara tells Joss the rent is late.", surface: "Mara tells Joss the rent is late.", exposure: [{ who: "Joss", reach: "whole" }] }] })).error).toBeUndefined();
  expect((await call(env, "stretch_done", { stretch: id })).error).toBeUndefined();
}

describe("the prepared start", () => {
  test("the plan is written before anything is spent, and above the player's ceiling nothing is relived until their word", async () => {
    const { rig, settings, files, env, plan } = await preparing(0);
    expect(await refusal(env, "prepare_relive", { stretch: "s1" })).toBe(note(PREPARE_NOTE.noPlan));
    const { estimate, call: weighed, stretches } = await plan();
    expect(files.files.get(PREPARE_PATH)?.text).toContain("lre-prepare");
    expect(stretches.map((s) => s.messages)).toEqual(["#1 to #6", "#7 to #12"]);
    // LumiAH measured no call of it here: each is reckoned at the player's setting, and the plan says so.
    expect(weighed).toEqual({ tokens: settings.story.prepare.callTokens, measured: note(PREPARE_NOTE.callDefault) });
    const [first, second] = stretches.map((s) => s.stretch);
    expect(await refusal(env, "prepare_relive", { stretch: first ?? "" })).toBe(note(PREPARE_NOTE.waits, { estimate: estimate.toLocaleString("en-US"), ceiling: "0" }));
    expect((await answer(env, "prepare_status")).status).toBe("waits for the player's word");
    // The player's word, as the page writes it into the file: then stretches open, and only in the chat's order.
    await updatePrepare(files, settings.prompts.texts, (now) => (now.state ? { ...now.state, word: { ...now.state.word, approved: true, for: estimateOf(now.state) } } : { stop: null }));
    expect((await answer(env, "prepare_status")).status).toBe("under way");
    expect(await refusal(env, "prepare_relive", { stretch: second ?? "" })).toBe(note(PREPARE_NOTE.order, { before: first ?? "", span: "#1 to #6" }));
    expect((await call(env, "prepare_relive", { stretch: first ?? "" })).error).toBeUndefined();
    noModelCalls(rig);
  });

  test("the plan is reckoned in all, the author's own work included, at what one of its calls weighs, and the ceiling is held to that whole", async () => {
    const spent: JobSpent = { tokens: 50_000, calls: 5, call: { tokens: 12_000, from: "job" } };
    const { files, env, plan } = await preparing(300_000, spent);
    const { estimate, call: weighed, stretches } = await plan();
    // Each stretch of six short messages, one principal reliving it: 3 calls of the author's, a read and 3 more of the historian's, 4 of the principal's.
    expect(stretches.map((s) => s.reckoned)).toEqual([11 * 12_000, 11 * 12_000]);
    // With the principal's casting, core and outline (3) and the author's close (4), on the 50,000 spent so far.
    expect(estimate).toBe(50_000 + (11 + 11 + 3 + 4) * 12_000);
    expect(weighed).toEqual({ tokens: 12_000, measured: note(PREPARE_NOTE.callJob) });
    // Its reliving alone (264,000) is within the ceiling of 300,000; the whole is not, so it waits.
    expect((await answer(env, "prepare_status")).status).toBe("waits for the player's word");
    expect(files.files.get(PREPARE_PATH)?.text).toContain("Reckoned at 398,000 tokens in all, the author's own work included");
  });

  test("the player's cap counts what LumiAH says the whole preparation spent, and refuses further reliving in plain words", async () => {
    const spent: JobSpent = { tokens: 90_000, calls: 3, call: { tokens: 30_000, from: "job" } };
    const { settings, files, env, plan } = await preparing(HIGH, spent);
    const s = (await plan()).stretches[0];
    const id = s?.stretch ?? "";
    expect(s?.reckoned).toBe(330_000);
    const capAt = (cap: number) => updatePrepare(files, settings.prompts.texts, (now) => (now.state ? { ...now.state, word: { ...now.state.word, cap } } : { stop: null }));
    await capAt(419_999);
    expect(await refusal(env, "prepare_relive", { stretch: id })).toBe(note(PREPARE_NOTE.capped, { stretch: id, cost: "330,000", spent: "90,000", cap: "419,999" }));
    await capAt(420_000);
    expect((await call(env, "prepare_relive", { stretch: id })).error).toBeUndefined();
  });

  test("what preparing spent is LumiAH's count: live while a job of it runs, its record once stopped; a call is weighed from its own, else from the chat's last author run", async () => {
    const at = { chatId: "chat", userId: "user" };
    const first = job("j1", "done", { in: 1_500_000, out: 300_000, calls: 22 });
    // The job under way: its record says nothing yet, its live view what it has spent and what its latest call weighed.
    expect(await preparationSpent(coreWith([job("j2", "running", { in: 0, out: 0, calls: 0 }), first], { j2: { in: 40_000, out: 2_000, calls: 2, last: 23_000 } }), at, null)).toEqual({ tokens: 1_842_000, calls: 24, call: { tokens: 23_000, from: "job" } });
    // Once it stopped: its record, and a call is the mean of every call it made.
    expect(await preparationSpent(coreWith([job("j2", "done", { in: 100_000, out: 5_000, calls: 4 }), first]), at, null)).toEqual({ tokens: 1_905_000, calls: 26, call: { tokens: Math.round(1_905_000 / 26), from: "job" } });
    // Before a job of it made a call: the chat's last author run, a job of the author's, else the chat's latest reply turn.
    const fresh = job("j3", "running", { in: 0, out: 0, calls: 0 });
    expect(await preparationSpent(coreWith([fresh, job("j0", "done", { in: 90_000, out: 10_000, calls: 4 }, { who: "agent", id: "a1", role: HARNESS_AGENT.author })]), at, null)).toEqual({ tokens: 0, calls: 0, call: { tokens: 25_000, from: "chat" } });
    expect(await preparationSpent(coreWith([fresh], { chat: { in: 60_000, out: 4_000, calls: 2, last: 40_000 } }), at, null)).toEqual({ tokens: 0, calls: 0, call: { tokens: 32_000, from: "chat" } });
    expect(await preparationSpent(coreWith([fresh]), at, null)).toEqual({ tokens: 0, calls: 0, call: null });
  });

  test("a past beat carries its mark and a story time the world's calendar reads, and a preparation carries on from its file", async () => {
    const { story, env, envOf, plan } = await preparing(HIGH);
    const id = (await plan()).stretches[0]?.stretch ?? "";
    expect(await refusal(env, "stretch_read", { stretch: id })).toBe(note(PREPARE_NOTE.notOpen, { stretch: id }));
    expect((await call(env, "prepare_relive", { stretch: id })).error).toBeUndefined();
    const read = await answer(env, "stretch_read", { stretch: id });
    expect((read.read as { n: number }[]).map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6]);
    const now = read.now as string;
    const beat = { when: now, by: "Mara", kind: "say", what: "Mara tells Joss the rent is late.", surface: "Mara tells Joss the rent is late.", exposure: [{ who: "Joss", reach: "whole" }] };
    expect(await refusal(env, "stretch_beats", { stretch: id, through: 3, beats: [{ ...beat, when: "next Tuesday" }] })).toBe(note(PREPARE_NOTE.badBeat, { n: "1", why: note(PREPARE_NOTE.badWhen, { when: "next Tuesday", now }) }));
    const written = await call(env, "stretch_beats", { stretch: id, through: 3, beats: [beat] });
    expect(written.error).toBeUndefined();
    const past = ((await story.read())?.path.beats ?? []).map(({ beat: b }) => b);
    expect(past.map((b) => [b.past, typeof b.at, b.by])).toEqual([[{ from: "old-1", to: "old-6" }, "number", "mara"]]);
    // A run that carries the preparation on, in a job of its own, starts where the file says it stopped.
    const again = await envOf("job-2");
    const status = await answer(again, "prepare_status");
    expect((status.stretches as { stretch: string; state: string; through?: string }[])[0]).toMatchObject({ stretch: id, state: "open", through: "#3" });
    expect(((await answer(again, "stretch_read", { stretch: id })).read as { n: number }[]).map((m) => m.n)).toEqual([4, 5, 6]);
  });

  test("a stretch of forty messages of 7,000 characters is read whole in at most six reads at the shipped size, and no message is lost or cut", async () => {
    const line = 'Joss leans on the counter. "The rent is due on Friday," he says, and Mara counts the coins again.\n';
    const text = (i: number): string => `Message ${i}. ${line.repeat(80)}`.slice(0, 7000);
    const { rig, chatId, settings, story, files, env, plan } = await preparing(HIGH, undefined, { messages: 40, text });
    const id = (await plan(env, { stretches: [{ from: 1, to: 40, why: "The whole of the rent trouble.", who: ["Mara"] }] })).stretches[0]?.stretch ?? "";
    expect((await call(env, "prepare_relive", { stretch: id })).error).toBeUndefined();
    /** The stretch read to its end as the historian reads it, from where each read says to read on: how many reads it took, what each was, and the messages given. */
    const readOn = async (on: ToolEnv) => {
      const answers: string[] = [];
      const read: { n: number; text: string }[] = [];
      let from: number | null = null;
      while (answers.length < 50) {
        const out = await call(on, "stretch_read", { stretch: id, ...(from === null ? {} : { from }) });
        answers.push(out.text);
        const told = JSON.parse(out.text) as { read: { n: number; text: string }[]; note: string };
        read.push(...told.read);
        if (told.note === note(PREPARE_NOTE.readEnd)) break;
        from = (told.read.at(-1)?.n ?? 0) + 1;
        expect(told.note).toBe(note(PREPARE_NOTE.readMore, { next: String(from) }));
      }
      return { answers, read };
    };
    const shipped = await readOn(env);
    expect(shipped.answers.length).toBeLessThanOrEqual(6);
    // Each read is within the size LumiAH hands the historian whole, and every message comes once, in order, as written.
    for (const a of shipped.answers) expect(a.length).toBeLessThanOrEqual(settings.story.prepare.readChars);
    expect(shipped.read.map((m) => m.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(shipped.read.every((m) => m.text === text(m.n))).toBe(true);
    // Set smaller than one message, a read gives one message at a time, never cut: LumiAH keeps what is past the size for scratch_read.
    const small: UserSettings = { ...settings, story: { ...settings.story, prepare: { ...settings.story.prepare, readChars: 5000 } } };
    const tight = await readOn({ ...castEnv(rig, chatId, await castTurn(rig, chatId, { main: false, settings: small, story, job: { id: "job-1", byUser: true } }), HARNESS_AGENT.author), files });
    expect(tight.answers).toHaveLength(40);
    expect(tight.read.every((m) => m.text === text(m.n))).toBe(true);
  });
});

describe("what the player tells the author always acts", () => {
  const words = "You missed the point: the story is Joss's, and the rent is only the start.";
  const answerText = "Joss is the principal now, and both stretches are relived by them.";

  test("words sent while the plan waits start a run that revises it, and the revised plan waits for the player's word, whatever their ceiling", async () => {
    const { rig, chatId, files, envOf, plan } = await preparing(0);
    await plan();
    const page = await pageOn(rig, chatId, files, [job("j1", "done", { in: 1000, out: 100, calls: 2 })]);
    const sent = await page.ask({ op: "steer", text: words });
    // No run was under way: one starts whose task is to revise the plan with what they said, and it is never told the plan is approved.
    expect(page.tasks).toHaveLength(1);
    expect(page.tasks[0]).toContain(note(PREPARE_NOTE.taskRevise, { words: note(PREPARE_NOTE.taskWords, { text: words }) }));
    expect(page.tasks[0]).not.toContain("approved the plan");
    expect(sent.state).toBe("revising");
    expect(sent.steered).toEqual([{ text: words, status: "The author is revising the plan with this.", answer: null }]);
    // The revising run, under a ceiling the plan fits within: it must answer what they said, and the plan still waits for their word.
    const reviser = await envOf("job-2", HIGH);
    expect(await refusal(reviser, "prepare_plan", PLAN)).toBe(note(PREPARE_NOTE.needAnswer, { said: `“${words}”` }));
    const revised = await plan(reviser, { answer: answerText });
    expect(revised.note).toBe(note(PREPARE_NOTE.waitsRevised));
    expect(await refusal(reviser, "prepare_relive", { stretch: revised.stretches[0]?.stretch ?? "" })).toBe(note(PREPARE_NOTE.waitsRevised));
    page.jobs[1] = { ...page.jobs[1], state: "done" };
    const after = await page.ask({ op: "get" });
    expect(after.state).toBe("waiting");
    expect(after.note).toContain("It now waits for your word");
    expect(after.steered).toEqual([{ text: words, status: "The author revised the plan for this.", answer: answerText }]);
    noModelCalls(rig);
  });

  test("words sent while a run is under way are told to it at once, and no stretch opens until the player approves the plan as revised; what was recorded stays", async () => {
    const { rig, chatId, files, env, plan } = await preparing(HIGH);
    const [first, second] = (await plan()).stretches.map((s) => s.stretch);
    await recordFirst(env, first ?? "");
    const page = await pageOn(rig, chatId, files, [job("j1", "running", { in: 0, out: 0, calls: 0 })]);
    const sent = await page.ask({ op: "steer", text: words });
    expect(page.said).toEqual([note(PREPARE_NOTE.sayWords, { text: words })]);
    expect(page.tasks).toEqual([]);
    expect(sent.state).toBe("revising");
    expect(sent.steered[0]?.status).toBe("The author was told, and revises the plan before it goes on.");
    expect(await refusal(env, "prepare_relive", { stretch: second ?? "" })).toBe(note(PREPARE_NOTE.unanswered, { said: `“${words}”` }));
    // Written again, the plan keeps the stretch recorded; the one still to relive is planned anew.
    const later = (await plan(env, { answer: answerText })).stretches.find((s) => s.messages === "#7 to #12")?.stretch ?? "";
    expect(await refusal(env, "prepare_relive", { stretch: later })).toBe(note(PREPARE_NOTE.waitsRevised));
    expect((await readPrepare(files)).state?.stretches.find((s) => s.id === first)?.state).toBe("recorded");
    // Their word on the plan as it now stands, told to the run under way: then the next stretch opens.
    await page.ask({ op: "approve" });
    expect(page.said.at(-1)).toBe(note(PREPARE_NOTE.sayApproved, { cap: "" }));
    expect((await call(env, "prepare_relive", { stretch: later })).error).toBeUndefined();
  });

  test("words sent to a finished preparation open it again, revised and waiting for the player's word", async () => {
    const { rig, chatId, settings, files, plan } = await preparing(HIGH);
    await plan();
    await updatePrepare(files, settings.prompts.texts, (now) => (now.state ? { ...now.state, done: "Ready for the first turn." } : { stop: null }));
    const page = await pageOn(rig, chatId, files, [job("j1", "done", { in: 1000, out: 100, calls: 2 })]);
    expect((await page.ask({ op: "get" })).state).toBe("done");
    const sent = await page.ask({ op: "steer", text: words });
    const state = (await readPrepare(files)).state;
    expect(state?.done).toBeNull();
    expect(state?.word).toMatchObject({ asked: true, approved: false, revised: true });
    expect(state?.log?.map((e) => e.what)).toEqual(["planned", "said", "reopened"]);
    expect(page.tasks[0]).toContain(note(PREPARE_NOTE.taskWords, { text: words }));
    expect(sent.state).toBe("revising");
  });

  test("what the player writes in the first card goes to the author with the start, and the first plan answers it", async () => {
    const { rig, chatId, files, envOf, plan } = await preparing(HIGH);
    const page = await pageOn(rig, chatId, files);
    const first = "The story is about Mara holding on to the house. Joss matters most to her.";
    const started = await page.ask({ op: "start", about: first });
    expect(page.tasks).toHaveLength(1);
    expect(page.tasks[0]).toEndWith(note(PREPARE_NOTE.taskFirst, { text: first }));
    expect(started.state).toBe("planning");
    expect(started.steered).toEqual([{ text: first, status: "The author has this with the start, and answers it in its plan.", answer: null }]);
    const author = await envOf("job-3");
    await answer(author, "prepare_survey", { part: "summaries" });
    await answer(author, "prepare_survey", { part: "lore" });
    expect(await refusal(author, "prepare_plan", PLAN)).toBe(note(PREPARE_NOTE.needAnswer, { said: `“${first}”` }));
    // Words given with the start aren't a revision: the plan is held to the ceiling as any first plan.
    expect((await plan(author, { answer: "Mara is the principal, and Joss relives both stretches with her." })).note).toContain("The plan stands");
  });

  test("a cancelled preparation can be carried on, told what to change, or started over keeping what was recorded", async () => {
    const { rig, chatId, files, env, plan } = await preparing(HIGH);
    const [first] = (await plan()).stretches.map((s) => s.stretch);
    await recordFirst(env, first ?? "");
    const page = await pageOn(rig, chatId, files, [job("j1", "cancelled", { in: 1000, out: 100, calls: 2 })]);
    expect(await page.ask({ op: "get" })).toMatchObject({ state: "cancelled", offer: null });
    await page.ask({ op: "resume" });
    expect(page.tasks).toEqual([note(PREPARE_NOTE.taskCarry, { word: "" })]);
    page.jobs[1] = { ...page.jobs[1], state: "cancelled" };
    await page.ask({ op: "steer", text: words });
    expect(page.tasks[1]).toContain(note(PREPARE_NOTE.taskWords, { text: words }));
    page.jobs[2] = { ...page.jobs[2], state: "cancelled" };
    const over = await page.ask({ op: "restart" });
    const state = (await readPrepare(files)).state;
    // Planned afresh: no plan, the recorded stretch and what the player said kept, the survey asked again.
    expect(state?.principals).toEqual([]);
    expect(state?.stretches.map((s) => [s.id, s.state])).toEqual([[first, "recorded"]]);
    expect(state?.word.said.map((s) => s.text)).toEqual([words]);
    expect(state?.surveyed).toBe(false);
    expect(state?.read).toBeUndefined();
    expect(page.tasks[2]).toBe(note(PREPARE_NOTE.taskAfresh) + note(PREPARE_NOTE.taskWords, { text: words }));
    expect(over.state).toBe("planning");
  });
});

describe("the survey", () => {
  const chapter = (n: number): HostBookEntryInput => ({ comment: `Chapter ${n}`, content: `Chapter ${n}. ${"Mara counts what is left of the rent and Joss keeps the lamps lit. ".repeat(14)}`, keys: [], disabled: true, constant: false, extensions: { lumibooks_summary: { tier: 1, messageIndices: [n * 10, n * 10 + 9] } } });
  const arc = (n: number): HostBookEntryInput => ({ comment: `Arc ${n}`, content: `Arc ${n}. ${"The house and its debts. ".repeat(8)}`, keys: [], disabled: false, constant: false, extensions: { lumibooks_summary: { tier: 2, messageIndices: [(n - 1) * 110, n * 110 - 1] } } });
  const volume = (n: number, text: string, disabled: boolean): HostBookEntryInput => ({ comment: `Volume ${n}`, content: text, keys: [], disabled, constant: false, extensions: { lumibooks_summary: { tier: 3, messageIndices: [(n - 1) * 550, n * 550 - 1] } } });

  test("the story so far comes in the summaries' own text, the highest level first, the switched-off ones too, within its size, with what was left out and how to read it", async () => {
    const { rig, chatId, settings, envOf } = await preparing(HIGH);
    const war = "Volume 2. The harbour war ends, and Mara keeps the house against the bank.";
    await attachBook(rig, chatId, "The story so far", [volume(1, "Volume 1. Mara takes the house over from her aunt.", false), volume(2, war, true), ...Array.from({ length: 10 }, (_, i) => arc(i + 1)), ...Array.from({ length: 110 }, (_, i) => chapter(i + 1))]);
    const env = await envOf("job-4");
    const out = await call(env, "prepare_survey", { part: "summaries" });
    expect(out.text.length).toBeLessThanOrEqual(settings.story.prepare.surveyChars);
    const told = JSON.parse(out.text) as { summaries: { id: string; text: string }[]; leftOut: string };
    // Volume 2, switched off in its book, comes first and whole; then volume 1, then the arcs newest first.
    expect(told.summaries.slice(0, 4).map((s) => s.id)).toEqual(["v2", "v1", "a10", "a9"]);
    expect(told.summaries[0]?.text).toBe(war);
    // The chapters come newest first in what room is left; the older ones are named as left out, by id and messages.
    const given = told.summaries.filter((s) => s.id.startsWith("c")).map((s) => s.id);
    const older = 110 - given.length;
    expect(given[0]).toBe("c110");
    expect(told.leftOut).toBe(note(PREPARE_NOTE.surveyLeft, { left: `chapter c1 to c${older} (#10 to #${older * 10 + 9})` }));
    // Each left out is read by its id, whole, or a level in the story's order from a message on.
    expect(((await answer(env, "prepare_survey", { summary: "c1" })).summary as { text: string }).text).toBe(chapter(1).content);
    const chapters = await answer(env, "prepare_survey", { part: "summaries", level: "chapter", from: 100 });
    const read = chapters.summaries as { id: string }[];
    expect(read[0]?.id).toBe("c10");
    expect(chapters.note).toBe(note(PREPARE_NOTE.surveyMore, { next: String((read.length + 10) * 10) }));
    expect(await refusal(env, "prepare_survey", { summary: "c111" })).toBe(note(PREPARE_NOTE.surveyNoSummary, { id: "c111" }));
  });

  test("110 chapter summaries, 19 arcs and 7 volumes are read whole in at most eight answers at the shipped size, each naming what is left", async () => {
    const entry = (tier: number, title: string, n: number, span: number, size: number): HostBookEntryInput => ({ comment: `${title} ${n}`, content: `${title} ${n}. ${"Mara counts what is left of the rent and Joss keeps the lamps lit. ".repeat(size / 50)}`.slice(0, size), keys: [], disabled: tier === 1, constant: false, extensions: { lumibooks_summary: { tier, messageIndices: [(n - 1) * span, n * span - 1] } } });
    const book = [...Array.from({ length: 7 }, (_, i) => entry(3, "Volume", i + 1, 160, 4000)), ...Array.from({ length: 19 }, (_, i) => entry(2, "Arc", i + 1, 60, 3000)), ...Array.from({ length: 110 }, (_, i) => entry(1, "Chapter", i + 1, 10, 2000))];
    expect(book.reduce((sum, e) => sum + e.content.length, 0)).toBe(305_000);
    const { rig, chatId, settings, envOf } = await preparing(HIGH);
    await attachBook(rig, chatId, "The story so far", book);
    const env = await envOf("job-7");
    const answers: string[] = [];
    const given: string[] = [];
    const ask = async (args: JsonObject): Promise<{ leftOut?: string; note?: string }> => {
      const out = await call(env, "prepare_survey", args);
      answers.push(out.text);
      const told = JSON.parse(out.text) as { summaries: { id: string }[]; leftOut?: string; note?: string };
      given.push(...told.summaries.map((s) => s.id));
      return told;
    };
    // The author reads the story so far, then each level the answer names as left out, from where each answer says to read on.
    const first = await ask({ part: "summaries" });
    const left = [...(first.leftOut ?? "").matchAll(/(volume|arc|chapter) \w+(?: to \w+)? \(#(\d+) to #(\d+)\)/g)];
    expect(left.map((m) => m[1])).toEqual(["arc", "chapter"]);
    for (const [, level, from, to] of left) {
      let next: number | null = Number(from);
      while (next !== null && answers.length < 20) {
        const page = await ask({ part: "summaries", level: level ?? "", from: next, to: Number(to) });
        const more = /call again with from (\d+)/.exec(page.note ?? "");
        expect(page.note).toBe(more ? note(PREPARE_NOTE.surveyMore, { next: more[1] ?? "" }) : note(PREPARE_NOTE.surveyEnd));
        next = more ? Number(more[1]) : null;
      }
    }
    expect(answers.length).toBeLessThanOrEqual(8);
    // Each answer is within the size LumiAH hands the author whole, and every summary came, once.
    for (const a of answers) expect(a.length).toBeLessThanOrEqual(settings.story.prepare.surveyChars);
    expect(given).toHaveLength(136);
    expect(new Set(given).size).toBe(136);
  });

  test("on a chat with a history the plan waits for the summaries and the lore read in the preparation, and for the story as the author understands it in author/story.md; a later run needs neither again; a new chat needs none", async () => {
    const { envOf } = await preparing(HIGH);
    // A preparation of its own: nothing surveyed, no story written.
    const files = memoryFiles();
    const env: ToolEnv = { ...(await envOf("job-5")), files };
    expect(await refusal(env, "prepare_plan", PLAN)).toBe(note(PREPARE_NOTE.surveyFirst, { parts: "summaries, lore" }));
    // Where the books hold no summary, the survey says how to read the chat in outline instead.
    expect(await answer(env, "prepare_survey", { part: "summaries" })).toEqual({ none: true, note: note(PREPARE_NOTE.surveyNone) });
    expect(await refusal(env, "prepare_plan", PLAN)).toBe(note(PREPARE_NOTE.surveyFirst, { parts: "lore" }));
    await answer(env, "prepare_survey", { part: "lore" });
    expect(await refusal(env, "prepare_plan", PLAN)).toBe(note(PREPARE_NOTE.storyFirst));
    await files.write(PREPARE_STORY, "  \n", null);
    expect(await refusal(env, "prepare_plan", PLAN)).toBe(note(PREPARE_NOTE.storyFirst));
    await files.write(PREPARE_STORY, "Mara keeps the boarding house and is behind on the rent.", (await files.read(PREPARE_STORY))?.version ?? null);
    // A later run reads what was surveyed from the preparation's file, and the story from its own: it plans without reading the summaries again.
    expect((await call({ ...(await envOf("job-7")), files }, "prepare_plan", PLAN)).error).toBeUndefined();
    const fresh = await castChat();
    const newChat = { ...castEnv(fresh.rig, fresh.chatId, await castTurn(fresh.rig, fresh.chatId, { main: false, story: memoryStory(), job: { id: "job-6", byUser: true } }), HARNESS_AGENT.author), files: memoryFiles() };
    expect((await call(newChat, "prepare_plan", { about: "A new story at the boarding house.", principals: [{ who: "Mara", why: "The house is hers." }] })).error).toBeUndefined();
  });

  test("a settings file from before reads reached their agent whole takes the new size of a read; a size the player set since is kept", () => {
    // The older build's own 24,000, in a file with no survey size yet: it was never the player's choice.
    expect(storyPrepareOf({ readChars: 24_000, stretchMessages: 20 })).toMatchObject({ readChars: STORY_DEFAULTS.prepare.readChars, stretchMessages: 20 });
    expect(storyPrepareOf({ readChars: 30_000 }).readChars).toBe(30_000);
    // Saved on this build, 24,000 is theirs.
    expect(storyPrepareOf({ readChars: 24_000, surveyChars: 60_000 }).readChars).toBe(24_000);
  });
});

describe("how deep the player has the story prepared", () => {
  const keyed: JsonObject = { ...PLAN, stretches: [{ from: 1, to: 6, why: "Where the rent trouble starts.", who: ["Mara"] }, { from: 7, to: 12, why: "Joss finds out.", who: ["Mara"], key: true }], depth: "key", depthWhy: "Joss finding out is what the story turns on." };
  const done = () => job("j1", "done", { in: 1000, out: 100, calls: 2 });

  test("a plan with no key stretch offers two depths, not three", async () => {
    const { rig, chatId, files, env, plan } = await preparing(0);
    expect(await refusal(env, "prepare_plan", BARE)).toBe(note(PREPARE_NOTE.needDepth));
    await plan(env, { depth: "all", depthWhy: "Both stretches matter." });
    expect((await readPrepare(files)).state?.estimate.depths?.key).toBeNull();
    const page = await pageOn(rig, chatId, files, [done()]);
    expect((await page.ask({ op: "get" })).plan?.depths.map((d) => d.depth)).toEqual(["outline", "all"]);
  });

  test("one plan is reckoned at three depths; going ahead at each opens only its stretches, and going deeper later adds the rest", async () => {
    for (const depth of ["outline", "key", "all"] as const) {
      const { rig, chatId, files, env, plan } = await preparing(0);
      const [first, second] = (await plan(env, keyed)).stretches.map((s) => s.stretch);
      const page = await pageOn(rig, chatId, files, [done()]);
      const shown = await page.ask({ op: "get" });
      const costs = shown.plan?.depths.map((d) => d.tokens) ?? [];
      expect(shown.plan?.depths.map((d) => d.depth)).toEqual(["outline", "key", "all"]);
      expect((costs[0] ?? 0) < (costs[1] ?? 0) && (costs[1] ?? 0) < (costs[2] ?? 0)).toBe(true);
      expect(shown.plan?.recommended).toEqual({ depth: "key", why: "Joss finding out is what the story turns on." });
      await page.ask({ op: "approve", depth });
      const unchosen = (id: string, at: string) => note(PREPARE_NOTE.notChosen, { stretch: id, depth: note(at) });
      if (depth === "outline") {
        expect(await refusal(env, "prepare_relive", { stretch: first ?? "" })).toBe(unchosen(first ?? "", PREPARE_NOTE.depthOutline));
        expect(await refusal(env, "prepare_relive", { stretch: second ?? "" })).toBe(unchosen(second ?? "", PREPARE_NOTE.depthOutline));
      } else if (depth === "key") {
        expect(await refusal(env, "prepare_relive", { stretch: first ?? "" })).toBe(unchosen(first ?? "", PREPARE_NOTE.depthKey));
        expect((await call(env, "prepare_relive", { stretch: second ?? "" })).error).toBeUndefined();
        // Deeper later: the run under way is told, and the stretch the depth adds opens.
        await page.ask({ op: "depth", depth: "all" });
        expect(page.said.at(-1)).toBe(note(PREPARE_NOTE.sayDepth, { depth: note(PREPARE_NOTE.depthAll) }));
        expect((await call(env, "prepare_relive", { stretch: first ?? "" })).error).toBeUndefined();
      } else {
        expect((await call(env, "prepare_relive", { stretch: first ?? "" })).error).toBeUndefined();
      }
    }
  });
});
