// A length the player states to an action whose activity outlasts its own time ("sleep for eight
// hours", DESIGN §8): the turn plays the action's own time and the user's Speed through policy carries
// the rest (§9.2); the Timelapse it offers holds the POV in the span it stated, as a typed span does.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { objOf } from "../../src/engine/pack-kit";
import { placeOfEntity } from "../../src/engine/scope";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";

/** A Port Alder chat after one ordinary turn, whose interpret reads "I sleep for eight hours" as going to bed for 480 minutes. */
async function alder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (!system.includes(INTERPRET_MARK)) return "{}";
    const text = req.messages[1]?.content ?? "";
    return JSON.stringify(text.startsWith("I sleep") ? { action: "sleep", params: { minutes: 480 }, confidence: 0.9 } : { action: null, params: {}, confidence: 0.9, reason: "no action" });
  };
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  return { rig, chatId };
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("not a world chat");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

describe("a length stated to an action", () => {
  test("“sleep for eight hours” plays going to bed, then offers a Speed through to its end that sleeps the POV through it", async () => {
    const { rig, chatId } = await alder();
    const start = await folded(rig, chatId);
    await rig.turn(chatId, "I sleep for eight hours.", "You turn in.");
    const bed = await folded(rig, chatId);
    const end = bed.state.entities[bed.world.pov]?.fields.activity_until;
    expect(typeof end === "number" && end - start.state.clock).toBeGreaterThanOrEqual(480);
    // Going to bed took its own few minutes; the eight hours are the Speed through's.
    expect(bed.state.clock - start.state.clock).toBeLessThan(30);
    const offer = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "timelapse_offer");
    if (!offer) throw new Error("no Speed through offered");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: offer.id, choice: "timelapse" }));
    // The span is the player's: the message records the hold, as a typed span's does (DESIGN §8).
    const sent = objOf(objOf((await rig.host.chats.messages(chatId, rig.host.userId)).at(-1)?.metadata[LEDGER_NAMESPACE]).params);
    expect(sent.povRoutine).toBe(false);
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "The hours go by.");
    const after = await folded(rig, chatId);
    expect(after.state.clock).toBe(end as number);
    // No routine took them to work in the morning: still asleep where they lay down.
    expect(placeOfEntity(after.state, after.world.pov)).toBe(placeOfEntity(bed.state, bed.world.pov));
    expect(after.state.entities[after.world.pov]?.fields.activity).toBe("sleep");
  });
});
