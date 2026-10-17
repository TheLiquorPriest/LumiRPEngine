// Upgrade with the definition merge on a running chat (issue #6, DESIGN §4.3 `migrate`): Build's
// entity changes reach the chat with the default picks, a value changed in play stays unless
// picked, and a swipe after the Upgrade folds it the same way.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { UpgradePicks } from "../../src/shared/ledger";
import type { MarkerPreview } from "../../src/shared/protocol";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import type { WorldState } from "../../src/engine/state";
import { STARTER_WORLDS } from "../../src/packs/index";
import { Rig } from "../support/rig";

const APPOINTMENTS = [{ at: 20_000, minutes: 60, place: "port_alder", label: "Dentist" }];

/**
 * A Port Alder chat with a turn played and Danny's cooking changed in play, then a commit in Build
 * that changes Danny's appointments, home, employer and cooking and adds a person and a vehicle.
 */
async function upgraded(): Promise<{ rig: Rig; chatId: string; revision: string; preview: MarkerPreview }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "The street is quiet.");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "set", entity: "danny_okafor", field: "cooking", value: 9 }] }));

  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const put = async (id: string, value: EntityDef): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id, value: value as unknown as JsonObject }));
  const starter = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Alder");
  const danny = starter.entities.danny_okafor;
  if (!danny) throw new Error("no Danny in Port Alder");
  await put("danny_okafor", { ...danny, fields: { ...danny.fields, appointments: APPOINTMENTS, home: "port_alder", employer: "alder_harbor_marina", cooking: 14 } });
  await put("rosa_vance", { id: "rosa_vance", kind: "character", name: "Rosa Vance", tier: "background", fields: { place: "harbor_street_114", home: "harbor_street_114" }, relations: [] });
  await put("danny_scooter", { id: "danny_scooter", kind: "vehicle", name: "Danny's scooter", tier: "background", fields: { place: "harbor_street_114", owner: "danny_okafor", class: "pickup_midsize", status: "ok", fuel_pct: 80 }, relations: [] });
  const revision = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base })).revision);
  const preview = rig.body(await rig.send({ type: "lre.marker", chatId, kind: "migrate", to: revision, preview: true })).preview as MarkerPreview;
  return { rig, chatId, revision, preview };
}

async function folded(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

async function upgrade(rig: Rig, chatId: string, revision: string, merge: UpgradePicks): Promise<WorldState> {
  rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: revision, merge }));
  return folded(rig, chatId);
}

describe("Upgrade with the definition merge (issue #6)", () => {
  test("the preview lists Build's changes with their default picks, and the default picks bring them into the chat", async () => {
    const { rig, chatId, revision, preview } = await upgraded();
    const rows = preview.upgrade?.entities ?? [];
    const danny = rows.find((r) => r.entity === "danny_okafor");
    const change = (id: string) => danny?.changes.find((c) => c.id === `danny_okafor:field:${id}`);
    for (const field of ["appointments", "home", "employer"]) expect(change(field)).toMatchObject({ pick: "take", why: "unchanged" });
    expect(change("cooking")).toMatchObject({ pick: "keep", why: "changed in play", from: "9", to: "14" });
    expect(rows.find((r) => r.entity === "rosa_vance")?.changes).toMatchObject([{ pick: "take", why: "new" }]);
    expect(rows.find((r) => r.entity === "danny_scooter")?.status).toBe("new");

    const state = await upgrade(rig, chatId, revision, {});
    expect(state.revision).toBe(revision);
    expect(state.entities.danny_okafor?.fields).toMatchObject({ appointments: APPOINTMENTS, home: "port_alder", employer: "alder_harbor_marina", cooking: 9 });
    expect(state.entities.rosa_vance).toMatchObject({ name: "Rosa Vance", fields: { home: "harbor_street_114" } });
    expect(state.entities.danny_scooter).toMatchObject({ kind: "vehicle", fields: { owner: "danny_okafor" } });
  });

  test("a value changed in play is taken when picked", async () => {
    const { rig, chatId, revision } = await upgraded();
    const state = await upgrade(rig, chatId, revision, { danny_okafor: { fields: { cooking: "take" } } });
    expect(state.entities.danny_okafor?.fields).toMatchObject({ cooking: 14, home: "port_alder" });
  });

  test("a swipe after the Upgrade folds it afresh, and switching back keeps it", async () => {
    const { rig, chatId, revision } = await upgraded();
    const before = await upgrade(rig, chatId, revision, {});
    const head = (await rig.host.chats.messages(chatId, rig.host.userId)).filter((m) => !m.isUser).at(-1);
    if (!head) throw new Error("no reply");
    const g = await rig.host.start(chatId, { type: "swipe", messageId: head.id });
    await rig.host.finish(g, "The street is busy now.");
    const swiped = await folded(rig, chatId);
    expect(swiped.entities.danny_okafor?.fields).toMatchObject({ home: "port_alder", employer: "alder_harbor_marina", cooking: 9 });
    expect(swiped.entities.rosa_vance?.name).toBe("Rosa Vance");
    rig.host.navigate(chatId, head.id, 0);
    await rig.host.settle();
    const back = await folded(rig, chatId);
    expect(back.entities.danny_okafor?.fields).toEqual(before.entities.danny_okafor?.fields);
    expect(back.entities.danny_scooter).toEqual(before.entities.danny_scooter);
  });
});
