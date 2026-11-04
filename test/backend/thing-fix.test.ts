// ✎ on the player's own things (ITEMS-SPEC §10.3; `lre.fix` with `thing`, the engine's `fix_item`)
// on Port Alder through the backend: Where is it? moves a thing of theirs to a place they know, with
// a Corrected chip whose Undo puts it back, and Size sets how big it is; someone else's thing, a
// place they can't know of and another person as the holder are refused, and nothing is written.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { Rig } from "../support/rig";

/** A Port Alder chat after one turn, with a television of Jordan's standing at Alder Market. */
async function chat(): Promise<{ rig: Rig; chatId: string; tv: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "The kitchen is quiet.");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "item", change: { do: "make", name: "Television", size: "heavy", at: { place: "alder_market" }, owner: "pov", why: "Bought at the market" } }] }));
  const tv = Object.entries((await head(rig, chatId)).entities).find(([, e]) => e.name === "Television")?.[0];
  if (!tv) throw new Error("no television");
  return { rig, chatId, tv };
}

async function head(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const render = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
  if (!render) throw new Error("no state");
  return render.state;
}

async function refused(rig: Rig, chatId: string, thing: Record<string, unknown>): Promise<string> {
  const reply = await rig.send({ type: "lre.fix", chatId, thing });
  if (reply.type !== "lre.error") throw new Error(`${JSON.stringify(thing)} was accepted`);
  return reply.message;
}

describe("✎ on your own things", () => {
  test("Where is it? moves your own television home, with a Corrected chip whose Undo puts it back", async () => {
    const { rig, chatId, tv } = await chat();
    const body = rig.body(await rig.send({ type: "lre.fix", chatId, thing: { do: "move", item: tv, to: { place: "harbor_street_114" } } }));
    expect(body.pending).toBe(false);
    expect(typeof body.undo).toBe("string");
    expect(placeOfEntity(await head(rig, chatId), tv)).toBe("harbor_street_114");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.id === body.undo);
    expect(chip?.label).toBe("Corrected");
    expect(chip?.actions.map((a) => a.label)).toContain("Undo");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: String(body.undo), choice: "undo" }));
    expect(placeOfEntity(await head(rig, chatId), tv)).toBe("alder_market");
  });

  test("Size sets how big your own thing is", async () => {
    const { rig, chatId, tv } = await chat();
    rig.body(await rig.send({ type: "lre.fix", chatId, thing: { do: "size", item: tv, size: "furniture" } }));
    expect((await head(rig, chatId)).entities[tv]?.fields.size).toBe("furniture");
  });

  test("someone else's thing, a place you can't know of and another person as the holder are refused, and nothing is written", async () => {
    const { rig, chatId, tv } = await chat();
    const before = JSON.stringify(await head(rig, chatId));
    expect(await refused(rig, chatId, { do: "move", item: "spare_relay", to: { place: "harbor_street_114" } })).not.toBe("");
    expect(await refused(rig, chatId, { do: "move", item: tv, to: { place: "birch_lane_12" } })).not.toBe("");
    expect(await refused(rig, chatId, { do: "move", item: "pov_pocketknife", to: { in: "danny_okafor" } })).not.toBe("");
    expect(JSON.stringify(await head(rig, chatId))).toBe(before);
  });
});
