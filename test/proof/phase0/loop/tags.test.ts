// Row 0.2's tags gate on recorded turns (PlanGates-24 item 1 and item 4's notice): thirty simple turns
// counted by the counters over RPE's trace, the connection set to the tag form for the run, the plan's 28 of
// 30 as the rate the runner judges, the floor model's form told to the owner where the count falls below it,
// the count kept for G0, and pi's loop told with the findings asked of the installed sources again.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LINES_30 } from "../../../../scripts/testbed/floor-fixture";
import { LEADS, partOf, SERVED } from "../../floor/replay";
import { CONTRACT, playLoop, tagsTrace, TAGS_GATE, type LoopSpec } from "./replay";

const scratches: string[] = [];
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** Thirty turns, the ones named missing without the intent record's tag. */
const turns = (missing: readonly number[] = [], extra: Partial<LoopSpec> = {}): LoopSpec => ({ turns: LINES_30.map((_, i) => (missing.includes(i) ? tagsTrace("<reply>She nods.</reply>") : tagsTrace())), ...extra });

describe("the tags, thirty turns", () => {
  test("thirty kept turns: the part is met thirty times, the connection was set to the tag form first, the count is kept for G0, nothing is told of the form", async () => {
    const played = await playLoop(TAGS_GATE, turns());
    expect(partOf(played, "tags")).toHaveLength(30);
    expect(partOf(played, "tags").every((i) => i.outcome === "met")).toBe(true);
    expect(played.log.writes).toEqual([{ chat: "chat-floor", key: "reply.forms.rpe-floor", value: "tags" }]);
    expect(played.log.sent.map((s) => s.line)).toEqual([...LINES_30]);
    expect(played.log.sent.every((s) => s.connection === "rpe-floor")).toBe(true);
    const count = JSON.parse(played.internal["count.json"] ?? "null");
    expect(count).toMatchObject({ kind: "form-count", form: "tags", connection: "rpe-floor", model: "deepseek-v4-flash", count: { kept: 30, played: 30, unread: 0, verdict: "pass" } });
    expect(played.printed.join("")).not.toContain("the floor model cannot keep the reply's tags");
    expect(played.code).toBe(0);
  });

  test("28 of 30 passes and 27 of 30 fails: the runner's rate, with every miss listed beside it", async () => {
    const pass = await playLoop(TAGS_GATE, turns([4, 17]));
    expect(partOf(pass, "tags").filter((i) => i.outcome === "met")).toHaveLength(28);
    expect(partOf(pass, "tags").filter((i) => i.outcome === "unmet").map((i) => i.why)).toEqual(["turn 5: the first message did not open with the intent record's tag", "turn 18: the first message did not open with the intent record's tag"]);
    expect(JSON.parse(pass.internal["count.json"] ?? "null").count.verdict).toBe("pass");
    expect(pass.printed.join("")).not.toContain("the floor model cannot keep the reply's tags");
    const fail = await playLoop(TAGS_GATE, turns([1, 2, 3]));
    expect(JSON.parse(fail.internal["count.json"] ?? "null").count).toMatchObject({ kept: 27, verdict: "fail" });
    expect(fail.code).toBe(1);
  });

  test("below 28 of 30 on a play that gives a verdict, the owner is told at once that the floor model works in two steps, and the notice is kept", async () => {
    const played = await playLoop(TAGS_GATE, turns(Array.from({ length: 22 }, (_, i) => i)));
    const told = played.printed.join("");
    expect(told).toContain("NOTICE FOR THE OWNER: the floor model cannot keep the reply's tags, so it works in the two-step form");
    expect(told).toContain("kept in 8 of 30 turns (the plan asks 28 of 30); missed: 22 no-intent-tag");
    expect(played.internal["notice-floor-form.md"]).toBeDefined();
  });

  test("a turn whose RPE side could not be read is neither kept nor missed: the count is not judged, and nothing is told of the form", async () => {
    const played = await playLoop(TAGS_GATE, { turns: LINES_30.map((_, i) => (i === 6 ? null : tagsTrace())) });
    const count = JSON.parse(played.internal["count.json"] ?? "null").count;
    expect(count).toMatchObject({ kept: 29, played: 30, unread: 1, verdict: "pass" });
    expect(partOf(played, "tags").filter((i) => i.outcome === "not judged")).toEqual([{ outcome: "not judged", why: "turn 7: its RPE side could not be read: RPE's turn could not be read" }]);
    const lost = await playLoop(TAGS_GATE, { turns: LINES_30.map((_, i) => (i < 4 ? null : tagsTrace("<reply>x</reply>"))) });
    expect(JSON.parse(lost.internal["count.json"] ?? "null").count.verdict).toBe("fail");
    const unsure = await playLoop(TAGS_GATE, { turns: LINES_30.map((_, i) => (i < 3 ? null : i < 5 ? tagsTrace("<reply>x</reply>") : tagsTrace())) });
    expect(JSON.parse(unsure.internal["count.json"] ?? "null").count.verdict).toBe("not judged");
    expect(unsure.printed.join("")).not.toContain("the floor model cannot keep the reply's tags");
  });

  test("a connection that could not be set to the form, or a contract that names no tags, leaves nothing played and the part not judged, with why", async () => {
    const failed = await playLoop(TAGS_GATE, turns([], { writeFails: "RPE PUT /api/v1/settings: 400 not a setting" }));
    expect(failed.log.sent).toEqual([]);
    expect(partOf(failed, "tags")).toEqual([{ outcome: "not judged", why: "the connection was not set to the tags form for the run: reply.forms.rpe-floor could not be set to \"tags\": RPE PUT /api/v1/settings: 400 not a setting" }]);
    const other = await playLoop(TAGS_GATE, turns([], { reads: "two-step" }));
    expect(other.log.sent).toEqual([]);
    expect(partOf(other, "tags")[0]?.why).toContain("reads \"two-step\" after it was set to \"tags\"");
    const bare = await playLoop(TAGS_GATE, turns([], { contract: "no header" }));
    expect(bare.log.sent).toEqual([]);
    expect(partOf(bare, "tags")[0]?.why).toContain("the reply contract has no header that parses");
    expect(CONTRACT).toContain("intent_file");
  });

  test("the floor's own reason for a trial gives the figures and no verdict on any turn, and tells the owner nothing of the form", async () => {
    const played = await playLoop(TAGS_GATE, turns(Array.from({ length: 22 }, (_, i) => i)), { ground: { observed: { plain: null, shipped: [], layers: [], off: [], leads: LEADS } } });
    const tags = partOf(played, "tags");
    expect(tags).toHaveLength(1);
    expect(tags[0]?.outcome).toBe("not judged");
    expect(tags[0]?.why).toContain("trial: the shipped tree RPE serves the floor's chat");
    expect(tags[0]?.why).toContain("figures: kept in 8 of 30 turns");
    expect(played.printed.join("")).not.toContain("the floor model cannot keep the reply's tags");
    expect(SERVED.length).toBeGreaterThan(0);
  });

  test("a turn led by another definition than the Author makes the play a trial", async () => {
    const played = await playLoop(TAGS_GATE, { turns: LINES_30.map((_, i) => (i === 2 ? tagsTrace(undefined, "gm") : tagsTrace())) });
    expect(partOf(played, "tags")[0]?.why).toContain("a turn was led by another definition than the Author (author): turn 3 by gm");
  });

  test("a run still going after a reply stops the play: no line is sent over it, and the count is not judged", async () => {
    const played = await playLoop(TAGS_GATE, turns([], { runningFrom: 5 }));
    expect(played.log.sent).toHaveLength(5);
    expect(JSON.parse(played.internal["count.json"] ?? "null").count.verdict).toBe("not judged");
  });
});

describe("pi's loop, told before wave 1", () => {
  test("the notice holds the three findings re-checked against the installed pi and RPH, and both choices, and every finding is met", async () => {
    const played = await playLoop(TAGS_GATE, turns());
    const told = played.printed.join("");
    expect(told).toContain("NOTICE FOR THE OWNER: pi's loop falls short in three places, and the loop is built around it unless you rule otherwise");
    for (const title of ["A stop is not carried through by pi's own abort", "pi still reads follow-ups after a batch that ended the run", "pi-ai applies sampling per request only on OpenAI-compatible connections"]) expect(told).toContain(`${title}: still reads now as Phase 0 found it`);
    expect(told).toContain("pi 1.5.2 / pi-ai 1.5.2");
    expect(told).toContain("dist/agent-loop.js:");
    expect(told).toContain("RPH around it:");
    expect(told).toContain("1. Fix around pi, as RPH does now and the plan builds");
    expect(told).toContain("2. Keep LumiAH's loop for now");
    expect(played.internal["notice-loop.md"]).toBe(told.slice(0, told.indexOf("NOTICE FOR THE OWNER: the floor") === -1 ? undefined : told.indexOf("NOTICE FOR THE OWNER: the floor")));
    expect(partOf(played, "loop").map((i) => i.outcome)).toEqual(["met", "met", "met"]);
  });

  test("a finding that no longer reads as Phase 0 found it is unmet, naming what is not found, and the notice says so", async () => {
    const roots = fakePi({ followUps: false });
    const played = await playLoop(TAGS_GATE, turns(), { roots });
    const unmet = partOf(played, "loop").filter((i) => i.outcome === "unmet");
    expect(unmet).toHaveLength(1);
    expect(unmet[0]?.why).toContain("pi still reads follow-ups after a batch that ended the run: no longer reads as Phase 0 found it; not found now: and the loop still asks for follow-up messages once the batch is in");
    expect(played.printed.join("")).toContain("NO LONGER reads as Phase 0 found it");
  });

  test("with the installed pi unreadable the part is not judged, and the notice is still printed", async () => {
    const played = await playLoop(TAGS_GATE, turns(), { roots: { core: "/nowhere/core", ai: "/nowhere/ai", rph: "/nowhere/rph" } });
    expect(partOf(played, "loop")).toEqual([{ outcome: "not judged", why: expect.stringContaining("the installed pi could not be read") }]);
    expect(played.printed.join("")).toContain("NOTICE FOR THE OWNER: pi's loop falls short");
  });
});

/** An installed pi and RPH made up as the probes read them, with one thing a finding stands on left out where asked. */
function fakePi(options: { followUps?: boolean } = {}): { core: string; ai: string; rph: string } {
  const root = mkdtempSync(join(tmpdir(), "fake-pi-"));
  scratches.push(root);
  const put = (path: string, text: string) => {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  };
  put("core/package.json", '{"version":"9.9.9"}');
  put("ai/package.json", '{"version":"9.9.9"}');
  put("core/dist/agent-loop.js", ["await prepared.tool.execute(id);", 'createErrorToolResult("Operation aborted");', "hasMoreToolCalls = !executedToolBatch.terminate;", ...(options.followUps === false ? [] : ["await config.getFollowUpMessages?.();"])].join("\n"));
  put("ai/dist/api/transform-messages.js", 'text: "No result provided"');
  put("ai/dist/types.d.ts", "OpenAI-compatible adapters (completions, responses, Azure responses); other APIs ignore it.");
  put("rph/src/loop/runner.ts", ["this.#pi.abort();", "// pi waits on a tool until it settles; a stop does not.", '(last.stopReason === "aborted" || last.stopReason === "error")', "return { terminate: true };", "this.#pi.followUp(message);"].join("\n"));
  put("rph/src/model/call.ts", ['setAll(payload, sampling, { top_p: "top_p", top_k: "top_k" });', 'setAll(payload, sampling, { top_p: "topP", seed: "seed" });', "samplingParams: rest"].join("\n"));
  return { core: join(root, "core"), ai: join(root, "ai"), rph: join(root, "rph") };
}
