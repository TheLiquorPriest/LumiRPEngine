// The prepared start (DEPTH2-PLAN §1.11): the plan is written before anything is spent, reckoned in
// all, the author's own work included, at what one of its model calls weighs; above the player's
// ceiling on that whole it waits for their word; their cap, counted from what LumiAH says the
// preparation spent, stops further reliving in plain words; a past beat carries its mark and a story
// time; and a preparation carries on from its file. Each tool is called as the bridge calls it
// (`runHarnessTool`), on a real chat, with the workspace and the story record kept in memory.

import { describe, expect, test } from "bun:test";
import type { JobSpent } from "../../src/backend/agents/tools/harness-turn";
import type { HarnessCore, RunSpent } from "../../src/backend/harness/extension";
import { renderPrompt } from "../../src/backend/prompts";
import { estimateOf, preparationSpent, updatePrepare } from "../../src/backend/story/prepare";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { PREPARE_NOTE, PREPARE_PATH } from "../../src/shared/harness-texts-prepare";
import type { JsonObject } from "../../src/shared/json";
import type { UserSettings } from "../../src/shared/settings";
import { answer, call, castChat, castEnv, castTurn, memoryFiles, memoryStory, noModelCalls, refusal } from "./harness-cast-kit";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** A ceiling no plan here comes near. */
const HIGH = 100_000_000;

/** A Port Alder chat with twelve messages played before the engine came in, and the author's env in a preparation the player started; `spent`: what LumiAH says the preparation has spent so far. */
async function preparing(askAboveTokens?: number, spent?: JobSpent) {
  const { rig, chatId } = await castChat();
  const chat = rig.host.chat(chatId);
  for (let i = 1; i <= 12; i++) rig.host.append(chat, { id: `old-${i}`, isUser: i % 2 === 1, name: i % 2 === 1 ? "User" : "Narrator", swipes: [i % 2 === 1 ? `I ask Mara about the rent, time ${i}.` : `Mara tells Joss the rent is late, time ${i}.`], swipeId: 0, bag: {} });
  const base: UserSettings = await rig.rt.settings.get(rig.host.userId);
  const settings = askAboveTokens === undefined ? base : { ...base, story: { ...base.story, prepare: { ...base.story.prepare, askAboveTokens } } };
  const story = memoryStory();
  const files = memoryFiles();
  const envOf = async (job: string) => ({ ...castEnv(rig, chatId, await castTurn(rig, chatId, { main: false, settings, story, job: { id: job, byUser: true, ...(spent ? { spent: async () => spent } : {}) } }), HARNESS_AGENT.author), files });
  const env = await envOf("job-1");
  const plan = async () => {
    const planned = await answer(env, "prepare_plan", { about: "Mara keeps the boarding house and is behind on the rent.", principals: [{ who: "Mara", why: "The story is hers." }], stretches: [{ from: 1, to: 6, why: "Where the rent trouble starts.", who: ["Mara"] }, { from: 7, to: 12, why: "Joss finds out.", who: ["Mara"] }], estimate: 1000 });
    return { estimate: planned.estimate as number, call: planned.call, stretches: planned.stretches as { stretch: string; messages: string; reckoned: number }[] };
  };
  return { rig, settings, story, files, env, envOf, plan };
}

/** LumiAH's core as the page reaches it, with the chat's `jobs` as it lists them and what its live view counts of each stream under way (`live`). */
const coreWith = (jobs: JsonObject[], live: Readonly<Record<string, RunSpent>> = {}): HarnessCore => ({ ask: async () => ({ jobs }), stop: () => false, running: () => [], spent: (_userId, stream) => live[stream] ?? null });

/** A job of the chat's as LumiAH lists it: the preparation's (the player's, keeping its file) unless `by` says another started it. */
const job = (id: string, state: string, usage: { in: number; out: number; calls: number }, by: JsonObject = { who: "user" }): JsonObject => ({ id, chatId: "chat", state, agent: HARNESS_AGENT.author, by, ...(by.who === "user" ? { plan: PREPARE_PATH } : {}), usage });

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
    expect(await preparationSpent(coreWith([job("j2", "running", { in: 0, out: 0, calls: 0 }), first], { j2: { in: 40_000, out: 2_000, calls: 2, last: 23_000 } }), at)).toEqual({ tokens: 1_842_000, calls: 24, call: { tokens: 23_000, from: "job" } });
    // Once it stopped: its record, and a call is the mean of every call it made.
    expect(await preparationSpent(coreWith([job("j2", "done", { in: 100_000, out: 5_000, calls: 4 }), first]), at)).toEqual({ tokens: 1_905_000, calls: 26, call: { tokens: Math.round(1_905_000 / 26), from: "job" } });
    // Before a job of it made a call: the chat's last author run, a job of the author's, else the chat's latest reply turn.
    const fresh = job("j3", "running", { in: 0, out: 0, calls: 0 });
    expect(await preparationSpent(coreWith([fresh, job("j0", "done", { in: 90_000, out: 10_000, calls: 4 }, { who: "agent", id: "a1", role: HARNESS_AGENT.author })]), at)).toEqual({ tokens: 0, calls: 0, call: { tokens: 25_000, from: "chat" } });
    expect(await preparationSpent(coreWith([fresh], { chat: { in: 60_000, out: 4_000, calls: 2, last: 40_000 } }), at)).toEqual({ tokens: 0, calls: 0, call: { tokens: 32_000, from: "chat" } });
    expect(await preparationSpent(coreWith([fresh]), at)).toEqual({ tokens: 0, calls: 0, call: null });
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
});
