// Settings → Writes, "Hold writes during the engine run" (DESIGN §4.3 P2): a ✎ fix the player makes
// while the engine works on a turn before its reply. Off, the default, it lands at once and the
// turn's reply doesn't start, as it always has, with a Retry that runs the engine again; on, the
// turn's pre-reply window holds it, the reply starts as planned, and the fix lands once it is in.

import { describe, expect, test } from "bun:test";
import type { BackendToFrontend } from "../../src/shared/protocol";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** The player sends a message and fixes their mood while the engine reads it: the generation the reply streams in (or the stopped one), and the fix's answer. */
async function fixWhileTheEngineRuns(rig: Rig, chatId: string, mood: string) {
  const asked: Promise<BackendToFrontend>[] = [];
  rig.host.quietReply = () => {
    if (asked.length === 0) asked.push(rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: mood }));
    return "{}";
  };
  rig.host.sendUser(chatId, "I wave.");
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  rig.host.quietReply = () => "{}";
  const [fixed] = asked;
  if (!fixed) throw new Error("the engine asked no model while it ran");
  return { g, fix: rig.body(await fixed) };
}

/** The chat's flag for a turn that generated nothing. */
async function flagged(rig: Rig, chatId: string): Promise<boolean> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "engine_failed");
}

describe("a ✎ fix made while the engine runs a turn", () => {
  test("by default it lands at once and the turn's reply doesn't start; Retry runs the engine again with the fix", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    expect((await rig.rt.settings.get(rig.host.userId)).holdWrites).toBe(false);
    const { g, fix } = await fixWhileTheEngineRuns(rig, chatId, "tense");
    expect(fix.pending).toBe(false);
    expect(g.halted).toBe("cancelled");
    expect(await flagged(rig, chatId)).toBe(true);
    expect(await rig.moodOf(chatId)).toBe("tense");
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "Someone waves back.");
    expect(await flagged(rig, chatId)).toBe(false);
    expect(await rig.moodOf(chatId)).toBe("tense");
  });

  test("with Hold writes during the engine run on, it waits for the turn, whose reply starts as planned, and lands once the reply is in", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    expect(rig.body(await rig.send({ type: "lre.settings.set", patch: { holdWrites: true } })).settings).toMatchObject({ holdWrites: true });
    const { g, fix } = await fixWhileTheEngineRuns(rig, chatId, "tense");
    expect(fix.pending).toBe(true);
    expect(g.halted).toBeUndefined();
    expect(await flagged(rig, chatId)).toBe(false);
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
