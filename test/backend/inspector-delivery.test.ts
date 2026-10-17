// The context inspector's section rows: a section left out over the section budget wasn't in the
// prompt, so it never reads as delivered, whatever an earlier delivery check found for that slot.

import { describe, expect, test } from "bun:test";
import { Rig } from "../support/rig";

describe("inspector delivery of clipped sections", () => {
  test("a section clipped after an earlier delivery check verified it reads unchecked, before and after the next check", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I wait an hour on the porch.", "The street wakes up around you.");
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const verified = (rig.rt.inspectorRecords(chatId)?.at(-1)?.sections ?? []).filter((s) => s.delivery === "verified").map((s) => s.slot);
    expect(verified.length).toBeGreaterThan(1);
    // A small section budget leaves the lower-ranked sections out of the next turn.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 60 } } } }));
    await rig.turn(chatId, "I wait another hour.", "Nothing much happens.");
    const clipped = (): { slot: string; delivery: string }[] => (rig.rt.inspectorRecords(chatId)?.at(-1)?.sections ?? []).filter((s) => s.clipped);
    expect(clipped().some((s) => verified.includes(s.slot))).toBe(true);
    expect(clipped().map((s) => s.delivery)).toEqual(clipped().map(() => "unchecked"));
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    expect(clipped().length).toBeGreaterThan(0);
    expect(clipped().map((s) => s.delivery)).toEqual(clipped().map(() => "unchecked"));
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
