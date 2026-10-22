// The world's date and time under each reply (the chips row): the view carries, for each reply the
// engine ran, the clock its shown swipe folded to at the end of its turn, local to the POV, as the
// HUD reads it; another swipe of the same reply carries its own.

import { describe, expect, test } from "bun:test";
import type { StateView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

async function view(rig: Rig, chatId: string): Promise<StateView> {
  return (await rig.rt.view(chatId, rig.host.userId)) as StateView;
}

describe("the date and time under a reply", () => {
  test("a reply carries its turn's end clock; a swipe carries its own, and switching back shows the first again", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const greeting = rig.host.chat(chatId).messages[0]?.id ?? "";
    await rig.turn(chatId, "I stretch.", "You stretch.");
    const first = await view(rig, chatId);
    const reply = rig.host.chat(chatId).messages.at(-1)?.id ?? "";
    // The reply the engine ran reads as the HUD does once its turn ended; the greeting it didn't run has none.
    expect(first.replyClocks[reply]).toBe(first.hud?.clock.label ?? "");
    expect(first.replyClocks[greeting]).toBeUndefined();

    // A later turn ends later, and the earlier reply keeps its own time.
    await rig.turn(chatId, "I wait.", "You wait.");
    const second = await view(rig, chatId);
    const head = rig.host.chat(chatId).messages.at(-1)?.id ?? "";
    expect(second.replyClocks[head]).toBe(second.hud?.clock.label ?? "");
    expect(second.replyClocks[reply]).toBe(first.replyClocks[reply]);

    // A swipe of the head is a turn of its own; the clock's ✎ moves that swipe's turn on to noon.
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "You wait some more.");
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.fix", chatId, time: "2026-09-14 12:00" }));
    expect((await view(rig, chatId)).replyClocks[head]).toBe("Mon 14 Sep 2026, 12:00 PM");
    // The first swipe keeps its own time, and the second its own.
    rig.host.navigate(chatId, head, 0);
    await rig.host.settle();
    expect((await view(rig, chatId)).replyClocks[head]).toBe(second.replyClocks[head] ?? "");
    rig.host.navigate(chatId, head, 1);
    await rig.host.settle();
    expect((await view(rig, chatId)).replyClocks[head]).toBe("Mon 14 Sep 2026, 12:00 PM");
  });
});
