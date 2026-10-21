// The Upgrade preview behind its spoiler gate (DESIGN §4.3 `migrate`): a row or a change that would
// give a secret away is marked secret, for Settings to show as "A hidden change" until the owner
// opens the gate; the rest are plain, and every change keeps its pick.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { MarkerPreview } from "../../src/shared/protocol";
import { expectMatch } from "../support/match";
import { Rig } from "../support/rig";

describe("the Upgrade preview's spoilers", () => {
  test("someone secret, and someone new at a secret place, are marked; someone public elsewhere isn't", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const put = async (collection: string, id: string, value: JsonObject): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection, id, value }));
    await put("places", "smugglers_den", { id: "smugglers_den", name: "Smugglers' den", parent: "port_alder", fields: {}, visibility: "secret" });
    await put("entities", "the_stranger", { id: "the_stranger", kind: "character", name: "The Stranger", tier: "background", visibility: "secret", fields: { place: "harbor_street_114" }, relations: [] });
    await put("entities", "rosa_vance", { id: "rosa_vance", kind: "character", name: "Rosa Vance", tier: "background", fields: { place: "smugglers_den" }, relations: [] });
    await put("entities", "tom_reyes", { id: "tom_reyes", kind: "character", name: "Tom Reyes", tier: "background", fields: { place: "harbor_street_114" }, relations: [] });
    const revision = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base })).revision);
    const preview = rig.body(await rig.send({ type: "lre.marker", chatId, kind: "migrate", to: revision, preview: true })).preview as MarkerPreview;
    const row = (id: string) => preview.upgrade?.entities.find((r) => r.entity === id);
    expect(row("the_stranger")?.secret).toBe(true);
    expect(row("the_stranger")?.changes.every((c) => c.secret === true && c.pick === "take")).toBe(true);
    expect(row("rosa_vance")?.secret).toBeUndefined();
    expectMatch(row("rosa_vance")?.changes, [{ secret: true, pick: "take", to: expect.stringContaining("Smugglers' den") }]);
    expect(row("tom_reyes")?.secret).toBeUndefined();
    expect(row("tom_reyes")?.changes.some((c) => c.secret === true)).toBe(false);
  });
});
