// A preparation's runs (DEPTH2-PLAN §1.11; `backend/story/prepare-run.ts`, `prepare-carry.ts`): each
// run's job is started with the allowance of Settings → Story → Preparing, never LumiAH's allowance
// for any job, and is told that the allowance bounds that run only and that the preparing tools keep
// the plan of the whole preparation. When a run ends with the preparation unfinished, the engine
// carries it on in a new run by itself, unless the plan waits for the player's word, the player held
// or cancelled it, their cap leaves no room for another run, the run failed on what it runs on or
// stopped at a day's limit, or the runs the engine started moved the preparation nothing forward as
// many times in a row as Runs without progress allows: then the page says why, with Carry on.
// LumiAH's jobs are a stand-in kept in memory: what each job was started with, and how each ended.

import { describe, expect, test } from "bun:test";
import type { HarnessCore } from "../../src/backend/harness/extension";
import type { AgentUsage } from "../../src/backend/harness/shapes";
import { renderPrompt } from "../../src/backend/prompts";
import { mindPath } from "../../src/backend/story/minds";
import { prepareFileText, preparePage, preparationSpent, type PrepareState, readPrepare, unplanned, updatePrepare } from "../../src/backend/story/prepare";
import { preparationRunEnded } from "../../src/backend/story/prepare-carry";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { PREPARE_NOTE, PREPARE_PATH, PREPARE_STORY } from "../../src/shared/harness-texts-prepare";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import { castChat, MARA, memoryFiles } from "./harness-cast-kit";
import { mount, playOn } from "./harness-driver";

const USAGE: AgentUsage = { calls: 0, toolTurns: 0, in: 0, cachedIn: 0, out: 0, reasoningOut: 0, estimated: false, ms: 0 };

/** One of the plan's stretches, by its id and its messages, not relived yet. */
const stretch = (id: string, from: number, to: number): PrepareState["stretches"][number] => ({ id, from, to, fromId: `old-${from}`, toId: `old-${to}`, why: "Where the rent trouble starts.", who: [MARA], state: "planned", through: null, beats: [], reckoned: 10_000 });

/** Mara's plan, two stretches to relive, within the player's ceiling so it needs no word of theirs; `word` changes their word on it. */
function plan(word: Partial<PrepareState["word"]> = {}): PrepareState {
  const blank = unplanned("history", [], false);
  return {
    ...blank,
    about: "Mara keeps the boarding house and is behind on the rent.",
    principals: [{ id: MARA, name: "Mara", why: "The story is hers." }],
    stretches: [stretch("s1", 1, 6), stretch("s2", 7, 12)],
    estimate: { ...blank.estimate, author: 100_000, reckoned: 100_000, call: 10_000 },
    word: { ...blank.word, asked: false, approved: true, for: 100_000, ceiling: 200_000, ...word },
    surveyed: true,
  };
}

/**
 * A chat on the harness engine whose preparation's file holds `state`, the player's Preparing
 * settings changed by `prepare`, and LumiAH's jobs kept in memory: `jobs` as it lists them (the oldest
 * first), each job the engine starts listed as running, with what it was started with in `started`;
 * `nextStart` resolves as the next job is started.
 */
async function preparing(state: PrepareState, prepare: JsonObject = {}) {
  const { rig, chatId } = await castChat();
  mount(rig);
  await playOn(rig, chatId, "harness");
  if (Object.keys(prepare).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch: { story: { prepare } } }));
  const userId = rig.host.userId;
  const { texts } = (await rig.rt.settings.get(userId)).prompts;
  const files = memoryFiles();
  await files.write(PREPARE_PATH, prepareFileText(state, texts), null);
  const jobs: JsonObject[] = [];
  const started: JsonObject[] = [];
  const waiting: (() => void)[] = [];
  rig.rt.harness.files = () => files;
  const core: HarnessCore = {
    ask: async (_userId, op, args): Promise<JsonValue> => {
      // LumiAH lists the latest jobs, as many as it is asked for.
      if (op === "jobs.list") return { jobs: [...jobs].reverse().slice(0, typeof args.limit === "number" ? args.limit : jobs.length) };
      if (op !== "jobs.start") return {};
      started.push(args);
      for (const told of waiting.splice(0)) told();
      const job: JsonObject = { id: `run-${jobs.length + 1}`, chatId, state: "running", agent: args.agent ?? "", by: { who: "user" }, plan: args.plan ?? null, usage: { in: 0, out: 0, calls: 0 } };
      jobs.push(job);
      return { job };
    },
    stop: () => false,
    running: () => [],
    spent: () => null,
  };
  rig.rt.harness.core = core;
  const at = { chatId, userId };
  return {
    rig,
    at,
    files,
    core,
    jobs,
    started,
    /** Resolves as LumiAH is next asked to start a job. */
    nextStart(): Promise<void> {
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.push(resolve);
      return promise;
    },
    /** The player presses a control of the card. */
    press: (op: "start" | "resume") => preparePage(rig.rt, at, { op }),
    /** The latest job's run ends as `how` says, and the engine hears it. */
    async ends(how: JsonObject): Promise<void> {
      const job = jobs.at(-1);
      if (!job) throw new Error("no job to end");
      Object.assign(job, how);
      await preparationRunEnded(rig.rt, { ...at, job: String(job.id) });
    },
    /** The card as Play → Now reads it. */
    view: () => preparePage(rig.rt, at, { op: "get" }),
    /** The preparation's log, oldest first. */
    log: async () => (await readPrepare(files)).state?.log ?? [],
    /** A tool's change of the file, as the author or the historian would make it. */
    change: (make: (s: PrepareState) => PrepareState) => updatePrepare<null>(files, texts, (now) => (now.state ? make(now.state) : { stop: null })),
  };
}

const ALLOWANCE = { state: "spent", stoppedAt: "allowance", reason: "the job's time ran out (Time per job)" };

describe("a preparation's runs", () => {
  test("each run's job is started with its own allowance from Settings → Story → Preparing, and told the preparing tools keep the plan of the whole preparation, never to write it or fit it to the run", async () => {
    const r = await preparing(plan(), { runMinutes: 45, runRounds: 120 });
    await r.press("start");
    await r.ends(ALLOWANCE);
    // The player's start, and the run the engine started by itself after it.
    expect(r.started).toHaveLength(2);
    const words = renderPrompt(PREPARE_NOTE.runWords, {}, {});
    for (const asked of r.started) {
      // Time and rounds of its own, and no token limit of its own: the player's cap holds the whole.
      expect(asked).toMatchObject({ agent: HARNESS_AGENT.author, area: "chat", plan: PREPARE_PATH, allowance: { wallMs: 45 * 60_000, toolTurns: 120, tokensIn: null, tokensOut: null }, planWords: words });
      expect(`${String(asked.task)}\n${String(asked.planWords)}`).not.toMatch(/write (?:your|the) plan to|narrow/i);
    }
    expect(words).toContain("This allowance is for this run only.");
    expect(words).toContain("never write or edit it yourself");
    expect(words).toContain("it carries on in a new run from that file");
    expect((await r.log()).at(-1)).toMatchObject({ what: "carried" });
    expect((await r.view()).state).toBe("running");
  });

  test("a run that ends with work left and the plan approved is followed by a new run; one that ends while the plan waits for the player's word is not", async () => {
    const asked = await preparing(plan({ asked: true, approved: true, for: 300_000, ceiling: 50_000 }));
    await asked.press("start");
    await asked.ends({ state: "done" });
    expect(asked.started).toHaveLength(2);

    const waiting = await preparing(plan({ asked: true, approved: false, for: 300_000, ceiling: 50_000 }));
    await waiting.press("start");
    await waiting.ends(ALLOWANCE);
    expect(waiting.started).toHaveLength(1);
    expect((await waiting.log()).at(-1)).toMatchObject({ what: "stopped", text: "It waits for your word on the plan before it goes on." });
    expect((await waiting.view()).state).toBe("waiting");
  });

  test("a run that ends before the author's plan is written is followed by a new run too; what it read and wrote counts as progress, and runs that add nothing stop it", async () => {
    // No plan yet: the file keeps only what the player said with the start.
    const r = await preparing(unplanned("history", [{ text: "The story is Mara's.", how: "start", answer: null }], false));
    await r.press("start");
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(2);
    expect((await r.log()).at(-1)).toMatchObject({ what: "carried" });
    // The run the engine started wrote more of the story as the author understands it: the next follows, and the count starts again.
    await r.files.write(PREPARE_STORY, "Mara keeps the boarding house.", null);
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(3);
    // Two runs in a row that read and wrote nothing new: no third is started, and the log says why.
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(4);
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(4);
    expect((await r.log()).at(-1)).toMatchObject({ what: "stopped", text: "Its last 2 runs made no progress, so it stopped carrying on by itself. Tell the author what to change, or carry it on." });
  });

  test("a run the player held or cancelled is not followed by a new one, and the card says it as the job does", async () => {
    const ends: JsonObject[] = [{ state: "paused", paused: true }, { state: "cancelled", reason: "the user cancelled it" }];
    for (const how of ends) {
      const r = await preparing(plan());
      await r.press("start");
      await r.ends(how);
      expect(r.started).toHaveLength(1);
      expect((await r.log()).filter((e) => e.what === "carried" || e.what === "stopped")).toEqual([]);
      expect((await r.view()).state).toBe(how.state === "paused" ? "paused" : "cancelled");
    }
  });

  test("a run that would take the whole preparation past the player's cap is not followed by a new one, and the card says why; with room for another call it carries on", async () => {
    // 90,000 spent in three calls: another weighs 30,000.
    const used = { ...ALLOWANCE, usage: { in: 85_000, out: 5_000, calls: 3 } };
    const capped = await preparing(plan({ cap: 100_000 }));
    await capped.press("start");
    await capped.ends(used);
    expect(capped.started).toHaveLength(1);
    const why = "It has spent 90,000 tokens of the 100,000 your cap allows, too few for another run. Raise the cap, then carry it on.";
    expect((await capped.log()).at(-1)).toMatchObject({ what: "stopped", text: why });
    expect(await capped.view()).toMatchObject({ state: "failed", note: why });

    const room = await preparing(plan({ cap: 120_000 }));
    await room.press("start");
    await room.ends(used);
    expect(room.started).toHaveLength(2);
  });

  test("runs it started that move the preparation nothing forward stop it after Runs without progress, and the card says so; one that moves it forward starts the count again, and so does the player's Carry on", async () => {
    const r = await preparing(plan());
    await r.press("start");
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(2);
    // Its run writes Mara's core: one thing the file named as left is done.
    await r.files.write(mindPath(MARA, "core"), "# Mara\n", null);
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(3);
    // The historian records beats of a stretch it hasn't closed: forward too.
    await r.change((s) => ({ ...s, stretches: s.stretches.map((x) => (x.id === "s1" ? { ...x, state: "open" as const, through: 3, beats: ["b1", "b2"] } : x)) }));
    await r.ends({ state: "done" });
    expect(r.started).toHaveLength(4);
    // One run that moves nothing: carried on; a second in a row: stopped, with why.
    await r.ends({ state: "done" });
    expect(r.started).toHaveLength(5);
    await r.ends(ALLOWANCE);
    expect(r.started).toHaveLength(5);
    const why = "Its last 2 runs made no progress, so it stopped carrying on by itself. Tell the author what to change, or carry it on.";
    expect((await r.log()).at(-1)).toMatchObject({ what: "stopped", text: why });
    expect(await r.view()).toMatchObject({ state: "failed", note: why });
    // Carry on is the player's word: their run is followed by one of the engine's, whatever it did.
    await r.press("resume");
    expect(r.started).toHaveLength(6);
    await r.ends({ state: "done" });
    expect(r.started).toHaveLength(7);

    // At one, the first run of its own that moves nothing stops it.
    const once = await preparing(plan(), { idleRuns: 1 });
    await once.press("start");
    await once.ends(ALLOWANCE);
    await once.ends(ALLOWANCE);
    expect(once.started).toHaveLength(2);
    expect(await once.view()).toMatchObject({ state: "failed", note: "Its last run made no progress, so it stopped carrying on by itself. Tell the author what to change, or carry it on." });
  });

  test("a run that failed on what it runs on is not started again, nor one stopped at a day's limit or cut off; one that failed for a reason that may pass is", async () => {
    const refused = await preparing(plan());
    await refused.press("start");
    await refused.ends({ state: "failed", lasting: true, reason: "401: the key was refused" });
    expect(refused.started).toHaveLength(1);
    expect(await refused.view()).toMatchObject({ state: "failed", note: "It stopped: 401: the key was refused. A new run would only fail the same way, so none was started. Put that right, then carry it on." });

    const day = await preparing(plan());
    await day.press("start");
    await day.ends({ state: "spent", stoppedAt: "day", reason: "what jobs sent and wrote in the last 24 hours is counted as 3000100 tokens of the 3000000 Job tokens per day allows" });
    expect(day.started).toHaveLength(1);
    expect((await day.log()).at(-1)?.text).toStartWith("It stopped at a day's limit: what jobs sent and wrote in the last 24 hours");

    const cut = await preparing(plan());
    await cut.press("start");
    await cut.ends({ state: "interrupted", reason: "the runtime restarted while it ran" });
    expect(cut.started).toHaveLength(1);

    const passing = await preparing(plan());
    await passing.press("start");
    await passing.ends({ state: "failed", reason: "503: overloaded" });
    expect(passing.started).toHaveLength(2);
  });

  test("what the preparation spent counts every run it made, however many fall out of the jobs LumiAH lists, and the cap holds to that whole", async () => {
    // Each run spends 1,000 tokens in one call; the cap leaves room for 100 runs and not for a call more.
    const r = await preparing(plan({ cap: 100_500 }));
    await r.press("start");
    for (let n = 1; n <= 100; n++) {
      // Each run records a beat of its stretch, so each moves the preparation forward.
      await r.change((s) => ({ ...s, stretches: s.stretches.map((x) => (x.id === "s1" ? { ...x, state: "open" as const, through: 1, beats: [...x.beats, `b${n}`] } : x)) }));
      await r.ends({ ...ALLOWANCE, usage: { in: 900, out: 100, calls: 1 } });
    }
    // A hundred runs: the player's, and 99 the engine carried on by itself; LumiAH lists only the latest of them.
    expect(r.jobs).toHaveLength(100);
    const listed = await r.core.ask(r.at.userId, "jobs.list", { limit: 60 });
    expect(isRecord(listed) && Array.isArray(listed.jobs) ? listed.jobs.length : null).toBe(60);
    expect(await preparationSpent(r.core, r.at, r.files)).toMatchObject({ tokens: 100_000, calls: 100 });
    // The hundredth run stopped it: another call would pass the cap.
    expect(r.started).toHaveLength(100);
    expect(await r.view()).toMatchObject({ spent: 100_000, state: "failed", note: "It has spent 100,000 tokens of the 100,500 your cap allows, too few for another run. Raise the cap, then carry it on." });
  });

  test("the engine hears from LumiAH that a job's run ended, and carries on only the preparation's latest job: a run its agents started is left alone", async () => {
    const r = await preparing(plan());
    await r.press("start");
    // A principal's reliving run, started by the author, ends: nothing starts.
    r.jobs.push({ id: "relive-mara", chatId: r.at.chatId, state: "done", agent: "character", by: { who: "agent", id: "agent-1", role: HARNESS_AGENT.author }, usage: { in: 0, out: 0, calls: 0 } });
    await preparationRunEnded(r.rig.rt, { ...r.at, job: "relive-mara" });
    expect(r.started).toHaveLength(1);
    // The preparation's own run ends, as LumiAH tells it: the next run starts, and nothing waited for it to.
    Object.assign(r.jobs[0] ?? {}, ALLOWANCE);
    const next = r.nextStart();
    await r.rig.rt.harness.extension.runEnded?.({ userId: r.at.userId, chatId: r.at.chatId, turn: "run-1", kind: "job", status: "stopped", reason: ALLOWANCE.reason, reply: "", record: null, usage: USAGE });
    await next;
    expect(r.started).toHaveLength(2);
  });
});
