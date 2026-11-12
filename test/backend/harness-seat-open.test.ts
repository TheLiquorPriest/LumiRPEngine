// A chat the harness plays that isn't set to its runtime yet (one from before an update, a Branch)
// is set as a page opens it, not at its first reply, so no reply is lost to setting it. Where it
// can't be set yet nothing changes: the chat stays on the harness, and the Engine page says why.

import { describe, expect, test } from "bun:test";
import { harnessChat, mount } from "./harness-driver";

describe("a harness chat a page opens", () => {
  test("is set to its runtime as it opens; one that can't be set yet stays on the harness and the page says why; one already set is left alone", async () => {
    const { rig, chatId } = await harnessChat();
    const pins = mount(rig);
    rig.rt.harness.seated = async () => false;
    await rig.send({ type: "lre.hello", chatId });
    expect(pins).toEqual([{ chatId, harness: true }]);

    const why = "No runtime was ever set up.";
    rig.rt.harness.pin = async () => {
      throw new Error(why);
    };
    await rig.send({ type: "lre.hello", chatId });
    expect(await rig.rt.chatKnowledge.engine(chatId, rig.host.userId)).toBe("harness");
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engines: true })).harnessBlocked).toBe(why);

    const again = mount(rig);
    await rig.send({ type: "lre.hello", chatId });
    expect(again).toEqual([]);
  });
});
