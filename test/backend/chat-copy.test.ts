// A chat's messages on a long chat (DESIGN §9.6). The host reads a chat only whole, reasoning and
// all, so the engine reads it once while the chat is open and keeps its copy current from the
// host's message events and its own writes.

import { describe, expect, test } from "bun:test";
import type { HostPort } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** Counts the runtime's reads of a whole chat from the host; `real` reads the host's chat uncounted. */
function countReads(rig: Rig): { count: () => number; real: HostPort["chats"]["messages"] } {
  let count = 0;
  const real = rig.host.chats.messages;
  rig.host.chats.messages = async (chatId, userId) => {
    count++;
    return real(chatId, userId);
  };
  return { count: () => count, real };
}

async function playedChat(rig: Rig, turns: number): Promise<string> {
  const chatId = await rig.worldChat();
  for (let i = 0; i < turns; i++) await rig.turn(chatId, `I look around (${i}).`, `The square is quiet (${i}).`);
  return chatId;
}

describe("a chat's messages", () => {
  test("are read from the host once while the chat is open, not per drawer request", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig, 2);
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const reads = countReads(rig);
    rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } }));
    rig.body(await rig.send({ type: "lre.gm", chatId }));
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" }));
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: POV, field: "mood", value: "tense" }] }));
    expect(reads.count()).toBe(0);
    expect(await rig.moodOf(chatId)).toBe("tense");
  });

  test("a turn reads them from the host once", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig, 2);
    const reads = countReads(rig);
    await rig.turn(chatId, "I wait.", "Time passes.");
    expect(reads.count()).toBeLessThanOrEqual(1);
  });

  test("the copy follows the host's edits, swipes, deletions and new messages without reading again", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig, 3);
    rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } }));
    const reads = countReads(rig);
    const same = async (): Promise<void> => {
      await rig.host.settle();
      const seen = toChain(await rig.rt.host.chats.messages(chatId, rig.host.userId));
      expect(seen).toEqual(toChain(await reads.real(chatId, rig.host.userId)));
    };
    const replies = (await reads.real(chatId, rig.host.userId)).filter((m) => !m.isUser);
    const [first, head] = [replies.at(-3), replies.at(-1)];
    if (!first || !head) throw new Error("no replies");
    rig.host.editMessage(chatId, head.id, "The square is loud.");
    await same();
    rig.host.addSwipe(chatId, head.id, "A bell rings.");
    await same();
    rig.host.navigate(chatId, head.id, 0);
    await same();
    rig.host.putSwipe(chatId, head.id, 1, "Two bells ring.");
    await same();
    rig.host.deleteSwipe(chatId, head.id, 1);
    await same();
    rig.host.sendUser(chatId, "I listen.");
    await same();
    // The host never renumbers (`index_in_chat`, which the fake host keeps the same way), so the copy
    // takes a deletion in place too.
    rig.host.deleteMessage(chatId, first.id);
    await same();
    expect(reads.count()).toBe(0);
  });
});
