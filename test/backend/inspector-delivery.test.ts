// The context inspector's section rows: a section left out over the section budget wasn't in the
// prompt, so it never reads as delivered, whatever an earlier delivery check found for that slot.
// Opening the inspector answers at once: its delivery check waits on a dry run of the whole prompt,
// and lands with the next state push.

import { describe, expect, test } from "bun:test";
import type { ViewOpenRequest } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
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

describe("opening the inspector", () => {
  test("answers before its dry run ends, and the check lands with the next push", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I wait an hour on the porch.", "The street wakes up around you.");
    // The host takes its time over the dry run.
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const dryRun = rig.host.dryRun.bind(rig.host);
    rig.host.dryRun = async (id) => {
      started.resolve();
      await gate.promise;
      return dryRun(id);
    };
    const sent = rig.host.sent.length;
    const open: ViewOpenRequest = { lre: PROTOCOL_VERSION, reqId: "inspect", type: "lre.view.open", chatId, panel: "core.context", entity: null };
    const handled = rig.dispatch.handle(open, rig.host.userId);
    await started.promise;
    expect(rig.host.sent.slice(sent).some((m) => m.type === "lre.result" && m.reqId === "inspect")).toBe(true);
    const delivered = (): string[] => (rig.rt.inspectorRecords(chatId)?.at(-1)?.sections ?? []).filter((s) => s.delivery === "verified").map((s) => s.slot);
    expect(delivered()).toEqual([]);
    gate.resolve();
    await handled;
    await rig.host.settle();
    expect(delivered().length).toBeGreaterThan(1);
    expect(rig.latestView(chatId)).not.toBeNull();
  });
});
