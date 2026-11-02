// A ✎ fix the player makes while the engine works on a turn before its reply (DESIGN §4.3 P2): the
// turn's pre-reply window holds it, the reply starts as planned, and the fix lands once the reply is
// in, over what the turn did.

import { describe, expect, test } from "bun:test";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

describe("a ✎ fix made while the engine runs a turn", () => {
  test("waits for the turn, whose reply starts as planned, and lands once the reply is in", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    let asked: Promise<Record<string, unknown>> | undefined;
    rig.host.quietReply = () => {
      asked ??= rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "tense" }).then((reply) => rig.body(reply));
      return "{}";
    };
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    rig.host.quietReply = () => "{}";
    if (!asked) throw new Error("the engine asked no model while it ran");
    expect((await asked).pending).toBe(true);
    expect(g.halted).toBeUndefined();
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "engine_failed")).toBe(false);
    // Waiting, it shows as pending and changes nothing yet.
    expect((await rig.rt.view(chatId, rig.host.userId)).pending).toHaveLength(1);
    expect(await rig.moodOf(chatId)).toBe("fine");
    await rig.host.finish(g, "Someone waves back.");
    expect(await rig.moodOf(chatId)).toBe("tense");
    // It is the turn's own: on the reply's record, after its events.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = rig.host.head(chatId);
    const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
    expect(rec?.status).toBe("ok");
    expect(rec?.post.find((p) => p.kind === "fix")?.seq).toBeGreaterThan(rec?.seq ?? Number.POSITIVE_INFINITY);
    expect([core?.journal.held, core?.journal.prereply]).toEqual([[], undefined]);
  });
});
