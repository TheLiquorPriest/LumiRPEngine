// What the harness leaves alone, end to end with LumiAH's real backend and core
// (`harness-e2e-kit.ts`, `support/lumiah-bed.ts`): chats on the engine's own two engines beside a
// harness chat, and LumiAH itself installed beside the engine. Each answers its own chats and has no
// part in the other's.

import { afterEach, describe, expect, test } from "bun:test";
import { createBackend } from "lumi-ah/extension/backend";
import { recHarnessOf, unplayedOf } from "../../src/backend/harness/record";
import { isRecord } from "../../src/shared/json";
import { agentChat, replyText, scripted, userText } from "../support/agent-chat";
import { type Bed, cast, lumiahBed, offers, PageRefused, type Seat, seatOf } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { playOn, recordOn } from "./harness-driver";
import { brief, calls, chatOn, engineOf, guard, say, worldChat } from "./harness-e2e-kit";

const seats: Seat[] = [];
afterEach(() => {
  for (const seat of seats.splice(0)) seat.close();
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
    const bed: Bed = lumiahBed(rig);
    seats.push(bed);
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

    // The harness chat beside them is LumiAH's: its author plays the turn, and the engine calls no model of its own for it.
    const before = rig.host.quietCalls.length;
    const play = cast({ name: "author", is: offers("write_reply"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), brief("Five quiet minutes pass.")] });
    bed.script = play.script;
    const generation = await say(rig, harness, "I sit a while.");
    await rig.host.finish(generation, "Five quiet minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, harness, generation.messageId ?? ""))?.record !== undefined, "the harness turn's record");
    expect(play.left("author")).toBe(0);
    expect(rig.host.quietCalls.length).toBe(before);
    // What the other two recorded is as it was.
    for (const chatId of [agents, classic]) expect(recHarnessOf(await recordOn(rig, chatId, rig.host.head(chatId)?.id ?? ""))).toBeNull();
  });

  test("LumiAH installed beside the engine: each answers its own chats, says so of the other's, and neither works on a reply of the other", async () => {
    const { bed, rig, chatId, worldId } = await worldChat();
    seats.push(bed);
    // LumiAH itself, a second extension in the same Lumiverse: its own identifier, storage and entry on a message.
    const solo = seatOf(rig, "lumi_ah");
    seats.push(solo);
    solo.follow(createBackend(solo.base, solo.env));

    // The world chat is the engine's: LumiAH shows who answers it, and can't be switched on over it.
    expect((await solo.page<ChatView>("lah.chat.get", { chatId })).chat).toMatchObject({ on: false, other: { identifier: "lumi_rp_engine", name: "LumiRPEngine" } });
    const taken = await refusalOf(solo.page("lah.chat.set", { chatId, on: true }));
    expect(taken).toBeInstanceOf(PageRefused);
    expect((taken as PageRefused).message).toContain("LumiRPEngine answers this chat");

    // A chat with no world is LumiAH's to answer: switched on there, the engine's side shows who answers it.
    const plain = rig.host.createChat("Hello.");
    expect((await solo.page<ChatView>("lah.chat.set", { chatId: plain, on: true })).chat.on).toBe(true);
    expect((await bed.page<ChatView>("lah.chat.get", { chatId: plain })).chat).toMatchObject({ on: false, other: { identifier: "lumi_ah" } });

    // A reply in the world chat: the engine's author works on it, and LumiAH's own agents are never called.
    const author = cast({ name: "author", is: offers("write_reply"), lines: [calls("time_pass", { minutes: 5 }), calls("commit"), brief("Five quiet minutes pass.")] });
    bed.script = author.script;
    const turn = await say(rig, chatId, "I sit a while.");
    await rig.host.finish(turn, "Five quiet minutes pass.");
    await bed.until(async () => recHarnessOf(await recordOn(rig, chatId, turn.messageId ?? ""))?.record !== undefined, "the engine's record of its turn");
    expect(solo.calls).toEqual([]);
    expect(rig.host.message(chatId, turn.messageId ?? "").bag.lumi_ah).toBeUndefined();

    // A reply in the plain chat: LumiAH's main agent briefs it and keeps its record in its own entry; the engine's LumiAH is never called, and the engine keeps no ledger for the chat.
    const engineCalls = bed.calls.length;
    const main = cast({ name: "main", is: offers("write_reply"), lines: [brief("Say hello back.")] });
    solo.script = main.script;
    const hello = await say(rig, plain, "Hello there.");
    expect(solo.prompt(hello.id).filter((m) => m.text.includes("Say hello back."))).toHaveLength(1);
    await rig.host.finish(hello, "Hello yourself.");
    await solo.until(() => isRecord(rig.host.message(plain, hello.messageId ?? "").bag.lumi_ah), "LumiAH's own record on its reply");
    expect(main.left("main")).toBe(0);
    expect(bed.calls.length).toBe(engineCalls);
    expect(await rig.rt.ledger.core(plain, rig.host.userId)).toBeNull();

    // A world chat LumiAH itself answers (the player switched it on there while the chat played its classic steps) can't be given to the harness until that is switched off: the Engine page says who answers it.
    guard(rig);
    const second = await chatOn(rig, worldId);
    await playOn(rig, second, "classic");
    expect((await solo.page<ChatView>("lah.chat.set", { chatId: second, on: true })).chat.on).toBe(true);
    const refused = await rig.send({ type: "lre.chat.knowledge", chatId: second, engine: "harness" });
    expect(refused.type).toBe("lre.error");
    expect(refused.type === "lre.error" ? refused.message : "").toContain("LumiAH answers this chat");
    expect(await engineOf(rig, second)).toBe("classic");
  });
});
