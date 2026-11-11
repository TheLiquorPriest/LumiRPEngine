// What LumiAH is told and given at the boundary (HARNESS-SLICE3: "Boundary with LumiAH"). LumiAH's
// backend serves every user of a Lumiverse, so each member of the extension surface names the user
// it asks for, and the engine answers for that user alone. And the world's book, which holds a
// generation's sections only while its prompt is assembled, goes back as the run begins: LumiAH built
// into Lumiverse works before the reply's generation, for as long as Lumiverse lets it, and another
// chat of the same world must not wait for it.

import { describe, expect, test } from "bun:test";
import { markerNonce } from "../../src/backend/harness/markers";
import { recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_AGENT, HARNESS_TEXT } from "../../src/shared/harness-texts";
import { isRecord } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { AssembledEntry, Generation } from "../support/fake-host";
import type { Rig } from "../support/rig";
import { AUTHOR, harnessChat, noModelCalls, playOn, recordOn, Run, stateOf, toolsOf } from "./harness-driver";

const AUTHOR_NAME = HARNESS_TEXT.agent(HARNESS_AGENT.author, "name");

/** The world's engine entries that hold text or are on, as the host stores them. */
async function liveEntries(rig: Rig, chatId: string): Promise<string[]> {
  const run = await rig.rt.runOf(chatId, rig.host.userId);
  const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
  return (await rig.host.books.entries(bookId, rig.host.userId)).filter((e) => isRecord(e.extensions[LEDGER_NAMESPACE]) && (!e.disabled || e.content !== "")).map((e) => e.comment);
}

describe("what LumiAH is told and given", () => {
  test("the definitions are the asked user's own; a call that names no user, or another user, is given the shipped ones", async () => {
    const { rig, chatId } = await harnessChat();
    const mine = rig.host.userId;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [AUTHOR_NAME]: "Storyteller" } } } }));
    const nameFor = async (userId: string, about: string | null): Promise<string | undefined> => (await rig.rt.harness.extension.definitions?.({ userId, chatId: about }))?.agents?.find((a) => a.id === HARNESS_AGENT.author)?.name;
    const shipped = renderPrompt(AUTHOR_NAME, {}, {});
    expect(shipped).not.toBe("Storyteller");
    expect(await nameFor(mine, chatId)).toBe("Storyteller");
    expect(await nameFor(mine, null)).toBe("Storyteller");
    // No turn of this user's ran in between, and none is needed: the user is told, never the last one seen.
    expect(await nameFor("someone-else", null)).toBe(shipped);
    expect(await nameFor("", null)).toBe(shipped);
    // The tools are listed for the user the caller names, and for the chat's own where it names none.
    const told = (await rig.rt.harness.tools.list(chatId, mine)).map((t) => t.name);
    expect(told).toContain("commit");
    expect(told).toEqual((await toolsOf(rig, chatId)).map((t) => t.name));
    noModelCalls(rig);
  });

  test("the world's book goes back as a run begins: while its author works, before the reply's generation, another chat of the world is given its own prompt", async () => {
    const { rig, chatId } = await harnessChat();
    const userId = rig.host.userId;
    const worldId = (await rig.rt.runOf(chatId, userId))?.worldId;
    const other = rig.host.createChat("Evening.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: other }));
    await playOn(rig, other, "harness");
    rig.host.sendUser(chatId, "I ask whether Okoro is coming by.");
    rig.host.sendUser(other, "I look around.");
    await rig.host.settle();

    // LumiAH built into Lumiverse works inside the prompt interceptor: this chat's prompt is assembled, and its generation hasn't begun.
    let between: { assembled: AssembledEntry[]; held: string[]; second: Generation } | null = null;
    rig.host.promptInterceptor = async (generation) => {
      rig.host.promptInterceptor = null;
      const assembled = [...rig.host.assembled];
      await rig.rt.harness.extension.runBegan?.({ userId, chatId, turn: generation.id, kind: "new", story: { hidden: "leave_out", from: "everyone", newest: "directive" } });
      await rig.host.settle();
      const held = await liveEntries(rig, chatId);
      // The author is still at work, and the other chat's reply starts: its guard takes the book at once. Were the book still the first turn's, this guard would wait for a generation that can't begin until it answers, and the test would never get past here.
      const second = await rig.host.begin(other, { type: "normal" });
      between = { assembled, held, second };
    };
    const first = await rig.host.begin(chatId, { type: "normal" });
    const seen = between as { assembled: AssembledEntry[]; held: string[]; second: Generation } | null;
    if (!seen) throw new Error("the prompt interceptor never ran");
    expect(seen.held).toEqual([]);
    expect(seen.second.halted).toBeUndefined();
    // Each prompt held its own generation's marked sections, and nothing of the other's.
    const marked = (entries: readonly AssembledEntry[], generation: Generation): boolean => entries.some((e) => new RegExp(`// lre:[0-9a-f]{8}:${markerNonce(generation.id)}`).test(e.content));
    expect(marked(seen.assembled, first)).toBe(true);
    expect(marked(seen.assembled, seen.second)).toBe(false);
    expect(marked(rig.host.assembled, seen.second)).toBe(true);
    expect(marked(rig.host.assembled, first)).toBe(false);

    // Both turns play on to their own records.
    const second = new Run(rig, other, seen.second.id, "new", seen.second);
    await rig.rt.harness.extension.runBegan?.({ userId, chatId: other, turn: seen.second.id, kind: "new", story: { hidden: "leave_out", from: "everyone", newest: "directive" } });
    rig.host.assembled = seen.assembled;
    const run = new Run(rig, chatId, first.id, "new", first);
    const clock = (await stateOf(rig, chatId)).clock;
    await run.answer(AUTHOR, "time_pass", { minutes: 10 });
    await second.answer(AUTHOR, "time_pass", { minutes: 25 });
    await run.finish("Okoro is on the step.");
    await second.finish("The street is quiet.");
    expect((await stateOf(rig, chatId)).clock).toBe(clock + 10);
    const replies = [rig.host.head(chatId), rig.host.head(other)];
    expect(recHarnessOf(replies[0] ? await recordOn(rig, chatId, replies[0].id) : null)?.turns).toEqual([first.id]);
    expect(recHarnessOf(replies[1] ? await recordOn(rig, other, replies[1].id) : null)?.turns).toEqual([seen.second.id]);
    expect(await liveEntries(rig, chatId)).toEqual([]);
    noModelCalls(rig);
  });
});
