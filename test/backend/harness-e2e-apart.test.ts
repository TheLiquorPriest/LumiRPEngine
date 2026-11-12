// What the harness leaves alone, end to end with LumiAH's real backend mounted and its runtime linked
// (`harness-e2e-kit.ts`, `support/runtime-bed.ts`): chats on the engine's own two engines beside a
// harness chat, and LumiAH itself installed beside the engine, with a runtime of its own. Each answers
// its own chats and has no part in the other's.

import { afterEach, describe, expect, test } from "bun:test";
import { createBackend } from "lumi-ah/extension/backend";
import { recHarnessOf, unplayedOf } from "../../src/backend/harness/record";
import { isRecord } from "../../src/shared/json";
import { agentChat, replyText, scripted, userText } from "../support/agent-chat";
import { cast, heard, offers, PageRefused, seatOf, told, toolCall } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { linkRuntime, runtimeBed } from "../support/runtime-bed";
import { playOn, recordOn } from "./harness-driver";
import { calls, chatOn, engineOf, guard, inRuntime, release, say, worldChat } from "./harness-e2e-kit";

/** The seats and runtimes a test opened, closed when it ends. */
const opened: { close(): void }[] = [];
afterEach(() => {
  for (const one of opened.splice(0)) one.close();
});

type ChatView = { chat: { on: boolean; other?: { identifier: string; name: string } } };
const refusalOf = (asked: Promise<unknown>): Promise<unknown> =>
  asked.then(
    () => null,
    (error: unknown) => error,
  );

describe("what the harness leaves alone", () => {
  test("a classic chat and an agents chat play as before beside a harness chat: LumiAH has no part in their turns, and the engine no model call in the harness's", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const bed = await runtimeBed(rig);
    opened.push(bed);
    // The engine's own models, scripted as the agents engine's tests script them: its main agent, its roles, its minds.
    rig.host.quietReply = scripted(() => 1);
    const agents = await agentChat(rig);
    const worldId = (await rig.rt.runOf(agents, rig.host.userId))?.worldId ?? "";
    const classic = await chatOn(rig, worldId);
    await playOn(rig, classic, "classic");
    const harness = await chatOn(rig, worldId);
    expect([await engineOf(rig, agents), await engineOf(rig, classic), await engineOf(rig, harness)]).toEqual(["agents", "classic", "harness"]);
    const on = async (chatId: string): Promise<boolean> => (await bed.page<ChatView>("lah.chat.get", { chatId })).chat.on;
    expect([await on(agents), await on(classic), await on(harness)]).toEqual([false, false, true]);

    await rig.turn(agents, userText(1), replyText(1, 0));
    await rig.turn(classic, "I wait for the kettle.", "The kettle ticks as it warms.");

    // Both were played by the engine itself: their replies are saved with the engine's record, which names no harness turn, and no agent of LumiAH's was called.
    expect(bed.calls).toEqual([]);
    for (const [chatId, text] of [
      [agents, replyText(1, 0)],
      [classic, "The kettle ticks as it warms."],
    ] as const) {
      const reply = rig.host.head(chatId);
      expect(reply?.swipes[reply.swipeId]).toBe(text);
      const rec = await recordOn(rig, chatId, reply?.id ?? "");
      expect(rec).not.toBeNull();
      expect([recHarnessOf(rec), unplayedOf(rec)]).toEqual([null, null]);
    }
    expect(rig.host.quietCalls.length).toBeGreaterThan(0);

    // The harness chat beside them is LumiAH's: its author plays the turn in the runtime, and the engine calls no model of its own for it.
    await bed.until(() => inRuntime(bed, harness), "the harness chat set to play in the runtime");
    const before = rig.host.quietCalls.length;
    const play = cast({ name: "author", is: offers("reply_write"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), release("Five quiet minutes pass."), "Released."] });
    bed.script = play.script;
    const replied = await say(bed, rig, harness, "I sit a while.");
    expect(replied.content).toBe("Five quiet minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, harness, replied.generation.messageId ?? ""))?.record !== undefined, "the harness turn's record");
    expect(play.left("author")).toBe(0);
    expect(rig.host.quietCalls.length).toBe(before);
    // What the other two recorded is as it was.
    for (const chatId of [agents, classic]) expect(recHarnessOf(await recordOn(rig, chatId, rig.host.head(chatId)?.id ?? ""))).toBeNull();
  });

  test("LumiAH installed beside the engine: each answers its own chats, says so of the other's, and neither works on a reply of the other", async () => {
    const { bed, rig, chatId, worldId } = await worldChat();
    opened.push(bed);
    // LumiAH itself, a second extension in the same Lumiverse: its own identifier, storage and entry on a message, and a runtime of its own, set up as a player sets one up.
    const solo = seatOf(rig, "lumi_ah");
    opened.push(solo);
    solo.follow(createBackend(solo.base, solo.env));
    const own = await linkRuntime(rig, solo, { port: 7872, extensionId: "ext-lumiah", name: "solo" });
    opened.push(own);

    // The world chat is the engine's: LumiAH shows who answers it, and can't be switched on over it.
    expect((await solo.page<ChatView>("lah.chat.get", { chatId })).chat).toMatchObject({ on: false, other: { identifier: "lumi_rp_engine", name: "LumiRPEngine" } });
    const taken = await refusalOf(solo.page("lah.chat.set", { chatId, on: true }));
    expect(taken).toBeInstanceOf(PageRefused);
    expect((taken as PageRefused).message).toContain("LumiRPEngine answers this chat");

    // A chat with no world is LumiAH's to answer: switched on there, the engine's side shows who answers it.
    const plain = rig.host.createChat("Hello.");
    expect((await solo.page<ChatView>("lah.chat.set", { chatId: plain, on: true })).chat.on).toBe(true);
    expect((await bed.page<ChatView>("lah.chat.get", { chatId: plain })).chat).toMatchObject({ on: false, other: { identifier: "lumi_ah" } });

    // A reply in the world chat: the engine's author plays it in the runtime, and LumiAH's own agents are never called.
    const author = cast({ name: "author", is: offers("reply_write"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), release("Five quiet minutes pass."), "Released."] });
    bed.script = author.script;
    const turn = await say(bed, rig, chatId, "I sit a while.");
    expect(turn.content).toBe("Five quiet minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, turn.generation.messageId ?? ""))?.record !== undefined, "the engine's record of its turn");
    expect(solo.calls).toEqual([]);
    expect(rig.host.message(chatId, turn.generation.messageId ?? "").bag.lumi_ah).toBeUndefined();

    // A reply in the plain chat: LumiAH's main agent briefs its writer in LumiAH's own runtime, the writer's answer is the reply, and LumiAH keeps its record in its own entry; the engine's LumiAH is never called, and the engine keeps no ledger for the chat.
    const engineCalls = bed.calls.length;
    const main = cast({ name: "writer", is: told("Say hello back."), lines: ["Hello yourself."] }, { name: "main", is: offers("write_reply"), lines: [{ toolCalls: [toolCall("write_reply", { brief: "Say hello back." })] }] });
    solo.script = main.script;
    rig.host.sendUser(plain, "Hello there.");
    await rig.host.settle();
    const hello = await own.reply(plain);
    expect([hello.error, hello.content]).toEqual([null, "Hello yourself."]);
    expect(heard(main.calls("writer")[0])).toContain("Say hello back.");
    await solo.until(() => isRecord(rig.host.message(plain, hello.generation.messageId ?? "").bag.lumi_ah), "LumiAH's own record on its reply");
    expect([main.left("main"), main.left("writer")]).toEqual([0, 0]);
    expect(bed.calls.length).toBe(engineCalls);
    expect(await rig.rt.ledger.core(plain, rig.host.userId)).toBeNull();

    // A world chat LumiAH itself answers (the player switched it on there while the chat played its classic steps): given to the harness, it waits until that is switched off. A reply meanwhile is stopped before anything is written, and says who answers the chat.
    guard(rig);
    const second = await chatOn(rig, worldId);
    await playOn(rig, second, "classic");
    expect((await solo.page<ChatView>("lah.chat.set", { chatId: second, on: true })).chat.on).toBe(true);
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: second, engine: "harness" })).engine).toBe("harness");
    rig.host.sendUser(second, "I wait.");
    await rig.host.settle();
    const waiting = await rig.host.begin(second, { type: "normal" });
    await rig.host.settle();
    expect(waiting.halted).toBe("cancelled");
    expect((await rig.rt.chips.list(second, rig.host.userId)).find((c) => c.kind === "engine_failed")?.detail).toContain("LumiAH answers this chat");
    expect(String(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: second, engines: true })).harnessBlocked)).toContain("LumiAH answers this chat");
    expect((await solo.page<ChatView>("lah.chat.get", { chatId: second })).chat.on).toBe(true);
  });
});
