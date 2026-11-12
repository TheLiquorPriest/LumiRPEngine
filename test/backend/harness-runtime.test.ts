// The harness engine on LumiAH's runtime (DEPTH2 stage A, Mount6): a chat the harness plays runs in
// the runtime and is never played anywhere else; the reply is exactly what the engine released; Stop
// keeps a turn only once something of its reply went out; and with no runtime linked the chat plays
// nothing and its pages say why.

import { describe, expect, test } from "bun:test";
import { recHarnessOf } from "../../src/backend/harness/record";
import { AUTHOR, beginTurn, claimOf, harnessChat, noModelCalls, recordOn, stateOf } from "./harness-driver";
import type { Rig } from "../support/rig";

/** LumiAH's words for a runtime that isn't linked, as the mount passes them on. */
const DOWN = "LumiRPEngine's runtime isn't linked now. Start it again with its line on LumiRPEngine's Runtime page.";

/** What was written after the player's newest message: the chat's greeting is the chat's, not a reply. */
const written = (rig: Rig, chatId: string): string[] => {
  const messages = rig.host.chat(chatId).messages;
  return messages
    .slice(messages.findLastIndex((m) => m.isUser) + 1)
    .map((m) => m.swipes[m.swipeId] ?? "")
    .filter((text) => text !== "");
};

describe("the harness on LumiAH's runtime", () => {
  test("a claimed chat runs only in the runtime: its claim takes the newest message and gives the released reply, and a reply not on its way there is stopped before anything is written", async () => {
    const { rig, chatId } = await harnessChat();
    const claim = await claimOf(rig, chatId);
    expect([claim?.request, claim?.reply]).toEqual(["newest", "released"]);
    // The chat's replies don't reach the runtime yet: the engine sets the chat there, and this reply goes nowhere.
    const pinned: boolean[] = [];
    rig.rt.harness.seated = async () => false;
    rig.rt.harness.pin = async (_chatId, _userId, harness) => void pinned.push(harness);
    rig.host.sendUser(chatId, "I knock on the door.");
    await rig.host.settle();
    const generation = await rig.host.begin(chatId, { type: "normal" });
    await rig.host.settle();
    expect(generation.halted).toBe("cancelled");
    expect(pinned).toEqual([true]);
    expect(written(rig, chatId)).toEqual([]);
    const chip = (await rig.rt.chips.list(chatId, rig.host.userId)).find((c) => c.kind === "engine_failed");
    expect(chip?.detail).toContain("set to play in LumiRPEngine's runtime just now");
    noModelCalls(rig);
  });

  test("what was released, passage by passage, is the reply, and the turn's record is written when it ends", async () => {
    const { rig, chatId } = await harnessChat();
    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I ask whether Okoro is coming by.");
    await run.answer(AUTHOR, "time_pass", { minutes: 10 });
    await run.answer(AUTHOR, "commit");
    await run.finish("Okoro is on the step. ", "He knocks twice.");
    const reply = rig.host.chat(chatId).messages.at(-1);
    expect(reply?.swipes[reply.swipeId]).toBe("Okoro is on the step. He knocks twice.");
    const rec = reply ? await recordOn(rig, chatId, reply.id) : null;
    expect(recHarnessOf(rec)?.turns).toEqual([run.turn]);
    expect(rec?.status).not.toBe("stopped");
    expect((await stateOf(rig, chatId)).clock).toBe(clock + 10);
    noModelCalls(rig);
  });

  test("Stop with nothing released lets the turn go and records nothing", async () => {
    const { rig, chatId } = await harnessChat();
    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I wait by the window.");
    await run.answer(AUTHOR, "time_pass", { minutes: 10 });
    await run.answer(AUTHOR, "commit");
    await run.stop("", "runtime");
    expect((await stateOf(rig, chatId)).clock).toBe(clock);
    const reply = rig.host.chat(chatId).messages.at(-1);
    expect(reply && !reply.isUser ? recHarnessOf(await recordOn(rig, chatId, reply.id)) : null).toBeNull();
    noModelCalls(rig);
  });

  test("Stop once something was released keeps what the turn had committed, and its record says the reply was stopped", async () => {
    const { rig, chatId } = await harnessChat();
    const clock = (await stateOf(rig, chatId)).clock;
    const run = await beginTurn(rig, chatId, "I open the door.");
    await run.answer(AUTHOR, "time_pass", { minutes: 10 });
    await run.answer(AUTHOR, "commit");
    // Staged and never committed: never decided, so it goes.
    await run.answer(AUTHOR, "time_pass", { minutes: 5 });
    await run.stop("Okoro steps in out of the rain.");
    const reply = rig.host.chat(chatId).messages.at(-1);
    expect(reply?.swipes[reply.swipeId]).toBe("Okoro steps in out of the rain.");
    const rec = reply ? await recordOn(rig, chatId, reply.id) : null;
    expect(rec?.status).toBe("stopped");
    expect(recHarnessOf(rec)?.turns).toEqual([run.turn]);
    expect((await stateOf(rig, chatId)).clock).toBe(clock + 10);
    noModelCalls(rig);
  });

  test("no runtime linked: the pages say so, and a reply plays nothing", async () => {
    const { rig, chatId } = await harnessChat();
    rig.rt.harness.runtime = async () => DOWN;
    const asked = rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true }));
    expect(asked.harnessBlocked).toBe(DOWN);
    expect(asked.engine).toBe("harness");
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const generation = await rig.host.begin(chatId, { type: "normal" });
    await rig.host.settle();
    expect(generation.halted).toBe("cancelled");
    expect(written(rig, chatId)).toEqual([]);
    const chip = (await rig.rt.chips.list(chatId, rig.host.userId)).find((c) => c.kind === "engine_failed");
    expect(chip?.detail).toContain(DOWN);
    // A new world chat is set to the harness all the same: no quieter engine stands in.
    const other = rig.host.createChat("Evening.");
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId;
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: other }));
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: other })).engine).toBe("harness");
    noModelCalls(rig);
  });
});
