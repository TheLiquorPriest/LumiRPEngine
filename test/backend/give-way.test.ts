// A busy worker (DESIGN §9.6): the backend runs one task at a time, so every ledger operation gives
// way before its folds, and a message already waiting (the host's call to a generation's guard) is
// answered before the operation, not after a burst of them.

import { describe, expect, test } from "bun:test";
import type { FixRequest } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

describe("a busy worker", () => {
  test("a message waiting is handled before a burst of edits is folded", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const order: string[] = [];
    // A message already in the worker's queue, as the host's call to a generation's guard would be.
    const { port1, port2 } = new MessageChannel();
    port2.onmessage = () => order.push("message");
    port1.postMessage("guard");
    const burst = [1, 2, 3].map(async (i) => {
      const fix: FixRequest = { lre: PROTOCOL_VERSION, reqId: `burst-${i}`, type: "lre.fix", chatId, entity: POV, field: "mood", value: `calm ${i}` };
      await rig.dispatch.handle(fix, rig.host.userId);
      order.push(`fix ${i}`);
    });
    await Promise.all(burst);
    port1.close();
    port2.close();
    expect(order[0]).toBe("message");
    expect(order).toHaveLength(4);
  });
});
