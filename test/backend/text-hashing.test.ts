// A long chat's texts (DESIGN §9.6): every sync and fold of the ledger hashes each message's text, so
// each text is hashed once while it is among the latest hashed, not again at every sync.

import { describe, expect, test } from "bun:test";
import { Rig } from "../support/rig";

/** Runs `read`, counting the characters of text read one at a time, as the hash reads them. */
async function charReads(read: () => Promise<unknown>): Promise<number> {
  const real = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = function (this: string, index: number): number {
    reads++;
    return real.call(this, index);
  };
  try {
    await read();
  } finally {
    String.prototype.charCodeAt = real;
  }
  return reads;
}

describe("a long chat's texts", () => {
  test("are hashed once, not at every sync", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const chatId = rig.host.createChat("Morning, Sam.");
    const chat = rig.host.chat(chatId);
    for (let i = 0; i < 60; i++) {
      const isUser = i % 2 === 0;
      chat.messages.push({ id: `long-${i}`, isUser, name: isUser ? "You" : "Narrator", swipes: [`${"The tide turns over the harbor stones. ".repeat(100)}(${i})`], swipeId: 0, bag: {} });
    }
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } }));
    const text = chat.messages.reduce((n, m) => n + (m.swipes[m.swipeId]?.length ?? 0), 0);
    const reads = await charReads(async () => rig.body(await rig.send({ type: "lre.hello", chatId, client: { version: "test" } })));
    expect(reads).toBeLessThan(text / 10);
  });
});
