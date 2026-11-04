// An Upgrade that changes an organization's kind (N3 lane A4): its Kind change names every link the
// new kind no longer reads, so a membership is never dropped unseen. A group's members are its
// `member_of` links; a trust reads none. Port Alder's Kowalczyk household.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { MarkerPreview } from "../../src/shared/protocol";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { STARTER_WORLDS } from "../../src/packs/index";
import { Rig } from "../support/rig";

describe("a kind change in the Upgrade preview", () => {
  test("a household made a trust names each member's link it no longer reads", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const starter = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Alder");
    const household = starter.entities.household_kowalczyk as EntityDef;
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id: household.id, value: { ...household, kind: "trust" } as unknown as JsonObject }));
    // The new revision drops the links too, as a trust takes none; the chat still holds them.
    for (const member of ["jess_kowalczyk", "maddie_kowalczyk", "helen_kowalczyk"]) {
      const e = starter.entities[member] as EntityDef;
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id: member, value: { ...e, relations: e.relations.filter((r) => r.to !== household.id) } as unknown as JsonObject }));
    }
    const revision = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base })).revision);
    const preview = rig.body(await rig.send({ type: "lre.marker", chatId, kind: "migrate", to: revision, preview: true })).preview as MarkerPreview;
    const kind = preview.upgrade?.entities.find((r) => r.entity === household.id)?.changes.find((c) => c.id === `${household.id}:kind`);
    expect(kind?.to).toContain("no longer reads these 3 links");
    for (const name of ["Jess Kowalczyk", "Helen Kowalczyk", "Maddie Kowalczyk"]) expect(kind?.to).toContain(name);
    expect(kind?.to).toContain("(head)");
  });
});
