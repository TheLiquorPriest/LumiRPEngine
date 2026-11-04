// A chat's folded head as one document (`lre.chat.export`, the sandbox's source): the world and state
// `renderState` folds, the revision in force, the engine, the run's seed and the clock; refused for a
// chat that plays no world. Nothing is written.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { ENGINE_VERSION } from "../../src/shared/world";
import { Rig } from "../support/rig";

describe("lre.chat.export", () => {
  test("is the chat's head as renderState folds it, with its revision, engine, run seed and clock", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
    const messages = (await rig.host.chats.messages(chatId, rig.host.userId)).length;
    const body = rig.body(await rig.send({ type: "lre.chat.export", chatId }));
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
    expect(head).toBeTruthy();
    expect(body.state).toEqual(JSON.parse(JSON.stringify(head?.state)));
    expect(body.world).toEqual(JSON.parse(JSON.stringify(head?.world)));
    expect(body).toMatchObject({ chatId, worldId, revision: head?.state.revision, engine: ENGINE_VERSION, runSeed: rig.rt.bridgeOf(chatId)?.runSeed, clock: head?.state.clock });
    // Read only: no message, and the head folds the same after.
    expect((await rig.host.chats.messages(chatId, rig.host.userId)).length).toBe(messages);
    expect(rig.body(await rig.send({ type: "lre.chat.export", chatId }))).toEqual(body);
  });

  test("a chat that plays no world is refused", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = rig.host.createChat("Hello.");
    const refused = await rig.send({ type: "lre.chat.export", chatId });
    expect(refused.type === "lre.error" ? refused.code : null).toBe("not_world_chat");
  });
});
