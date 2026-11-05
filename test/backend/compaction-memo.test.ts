// The compaction made ahead (DESIGN §4.6, `compaction-memo.ts`): a fold's key holds every input of
// its call, so a key that hits is the very call that would be made now; two turns asking for one
// fold share one call, whoever asks while it runs joining it and whoever asks after adopting it; a
// miss starts it; a summary cut off at its limit stays, so the turns that find it go on whole without
// calling again, while any other failure goes and the next asker calls again; and the memo keeps the
// latest folds, the latest used first.

import { describe, expect, test } from "bun:test";
import { CompactionMemo, FOLDS_KEPT, type FoldInputs, foldKey, type FoldResult } from "../../src/backend/agents/compaction-memo";

const INPUTS: FoldInputs = { userId: "user-1", route: { connectionId: null, model: null, effort: "main", callTokensOut: 16_000 }, system: "Keep the session short.", message: "Reply 2: the harbor turn." };

describe("a fold's key", () => {
  test("is the same for the same call, and another for any one input changed: the user, the route, the cap, the instructions or the message", () => {
    const key = foldKey(INPUTS);
    expect(foldKey({ ...INPUTS, route: { ...INPUTS.route } })).toBe(key);
    const changed = [
      { ...INPUTS, userId: "user-2" },
      { ...INPUTS, route: { ...INPUTS.route, connectionId: "summaries" } },
      { ...INPUTS, route: { ...INPUTS.route, model: "small-model" } },
      { ...INPUTS, route: { ...INPUTS.route, effort: "low" } },
      { ...INPUTS, route: { ...INPUTS.route, callTokensOut: 8_000 } },
      { ...INPUTS, route: { ...INPUTS.route, callTokensOut: "none" as const } },
      // The main agent's system files ride in the instructions: a new AGENTS.md is another call.
      { ...INPUTS, system: `${INPUTS.system}\n\nAGENTS.md: be brief.` },
      { ...INPUTS, message: `${INPUTS.message}\nReply 3: the pier turn.` },
    ].map(foldKey);
    expect(new Set([key, ...changed]).size).toBe(changed.length + 1);
  });
});

describe("the memo", () => {
  test("two askers share one call: one asking while it runs joins it, one asking once it's made adopts it, and neither calls again", async () => {
    const memo = new CompactionMemo();
    const call = Promise.withResolvers<FoldResult>();
    let calls = 0;
    const make = (): Promise<FoldResult> => {
      calls++;
      return call.promise;
    };
    const first = memo.run("fold", make);
    const joined = memo.run("fold", make);
    expect([first.found, joined.found, memo.find("fold")?.found, calls]).toEqual([null, "running", "running", 1]);
    call.resolve({ summary: "The harbor, then the pier." });
    expect(await Promise.all([first.result, joined.result])).toEqual([{ summary: "The harbor, then the pier." }, { summary: "The harbor, then the pier." }]);
    const adopted = memo.run("fold", make);
    expect(adopted.found).toBe("made");
    expect(await adopted.result).toEqual({ summary: "The harbor, then the pier." });
    expect(calls).toBe(1);
  });

  test("a miss is none made: find gives nothing, and run starts the call, which a find then finds", async () => {
    const memo = new CompactionMemo();
    expect(memo.find("fold")).toBeUndefined();
    const made = memo.run("fold", async () => ({ summary: "Made on the miss." }));
    expect(made.found).toBeNull();
    expect(await made.result).toEqual({ summary: "Made on the miss." });
    expect(memo.find("fold")?.found).toBe("made");
  });

  test("a summary cut off stays, so a turn that finds it goes on whole without calling; any other failure goes, a call that throws among them, and the next asker calls again", async () => {
    const memo = new CompactionMemo();
    let calls = 0;
    const cut = memo.run("cut", async () => {
      calls++;
      return { failed: "its summary was cut off at its limit (Summary length)", cut: true };
    });
    expect(await cut.result).toEqual({ failed: "its summary was cut off at its limit (Summary length)", cut: true });
    const found = memo.run("cut", async () => {
      calls++;
      return { summary: "Never asked." };
    });
    expect([found.found, await found.result, calls]).toEqual(["made", { failed: "its summary was cut off at its limit (Summary length)", cut: true }, 1]);
    expect(await memo.run("failed", async () => ({ failed: "the connection dropped" })).result).toEqual({ failed: "the connection dropped" });
    expect(await memo.run("thrown", () => Promise.reject(new Error("the provider is down"))).result).toEqual({ failed: "the provider is down" });
    expect([memo.find("failed"), memo.find("thrown")]).toEqual([undefined, undefined]);
    const again = memo.run("failed", async () => ({ summary: "Made the second time." }));
    expect([again.found, await again.result]).toEqual([null, { summary: "Made the second time." }]);
  });

  test(`keeps the latest ${FOLDS_KEPT} folds, the latest used first: one found again outlasts those made after it`, async () => {
    const memo = new CompactionMemo();
    for (let i = 0; i < FOLDS_KEPT; i++) await memo.run(`fold${i}`, async () => ({ summary: `Summary ${i}.` })).result;
    expect(memo.size).toBe(FOLDS_KEPT);
    // The oldest, found again, is the latest used: the next fold made pushes out the one made after it.
    expect(memo.find("fold0")?.found).toBe("made");
    await memo.run("newest", async () => ({ summary: "The newest." })).result;
    expect(memo.size).toBe(FOLDS_KEPT);
    expect([memo.find("fold0")?.found, memo.find("fold1"), memo.find("newest")?.found]).toEqual(["made", undefined, "made"]);
  });
});
