// An Upgrade that changes an organization's kind (N3 lanes A4, B2):
// - its Kind change names every link the new kind no longer reads, so a membership is never dropped
//   unseen: a group's members are its `member_of` links (a trust is a group too, since N3 B);
// - a company made a trust, or a trust a company (Build's Change what it is, 6.16), is one change,
//   "Change what it is": its kind, its fields and the memberships that seat its trustees, taken or
//   kept together, so no part of it is left on its own (no orphan) and no holder's row shows a seat.
// Port Alder's Kowalczyk household and Alder Automotive; Harrowmere's Thorne Trust.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { orgConversion, type ConvertTo } from "../../src/frontend/build/org-convert";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { ownersIn } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { UpgradePicks } from "../../src/shared/ledger";
import type { MarkerPreview, UpgradeChange } from "../../src/shared/protocol";
import { playedKinds, type EntityDef, type WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);

describe("a kind change in the Upgrade preview", () => {
  test("a household made something that takes no members names each member's link it no longer reads", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const starter = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Alder");
    const household = starter.entities.household_kowalczyk as EntityDef;
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id: household.id, value: { ...household, kind: "property" } as unknown as JsonObject }));
    // The new revision drops the links too, as a property takes none; the chat still holds them.
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

/** Port Alder's holding company the tests convert: Marcus holds 60% and Jordan 40%; nothing else names it. */
const HOLDINGS: EntityDef = { id: "alder_holdings_co", kind: "business", name: "Alder Holdings", tier: "background", fields: { owners: [{ party: "marcus_delgado", role: "owner", share: 60 }, { party: "pov", role: "owner", share: 40 }], structure: "llc", industry: "holdings", positions: [{ id: "chair", title: "Chair", powers: ["org.govern"], seats: 1 }] }, relations: [] };

/**
 * A chat on `starter` one turn in, its world's organization `org` converted in Build to `to` and
 * committed, with the Upgrade's preview. With `first`, that entity joins the world and the chat by an
 * Upgrade of its own beforehand.
 */
async function converted(starter: "modern_slice_of_life" | "mystery_manor", org: string, to: ConvertTo, first?: EntityDef): Promise<{ rig: Rig; chatId: string; revision: string; preview: MarkerPreview; doc: WorldDoc }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("World", starter);
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "It is quiet.");
  const world = (STARTER_WORLDS[starter] as (id: string, name: string) => WorldDoc)("w", "World");
  if (first) {
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id: first.id, value: first as unknown as JsonObject }));
    const added = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base })).revision);
    await upgrade(rig, chatId, added, {});
    world.entities[first.id] = first;
  }
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const doc: WorldDoc = { ...world, kinds: playedKinds(Object.fromEntries(reg.kinds), world.kinds) };
  const conversion = orgConversion(doc, org, to);
  expect(conversion.why).toBeNull();
  rig.body(await rig.send({ type: "lre.editor", op: "patch", worldId, base: draft.base, ops: conversion.ops }));
  const revision = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base })).revision);
  const preview = rig.body(await rig.send({ type: "lre.marker", chatId, kind: "migrate", to: revision, preview: true })).preview as MarkerPreview;
  return { rig, chatId, revision, preview, doc };
}

async function upgrade(rig: Rig, chatId: string, revision: string, merge: UpgradePicks): Promise<WorldState> {
  rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: revision, merge }));
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

/** Every change of the preview, with whose row it is on. */
function changes(preview: MarkerPreview): (UpgradeChange & { row: string })[] {
  return (preview.upgrade?.entities ?? []).flatMap((r) => r.changes.map((c) => ({ ...c, row: r.entity })));
}

describe("a conversion in the Upgrade preview is one change", () => {
  const CO = HOLDINGS.id;
  const TRUST = "thorne_trust";

  test("a company made a trust: kind, owners and the fields only a company reads in one change, no part on its own; taken, the chat holds the trust", async () => {
    const { rig, chatId, revision, preview } = await converted("modern_slice_of_life", CO, "trust", HOLDINGS);
    const parts = changes(preview).filter((c) => c.targets.some((t) => t.entity === CO));
    expect(parts.map((c) => c.id)).toEqual([`${CO}:convert`]);
    const change = parts[0];
    expect(change).toMatchObject({ row: CO, label: "Change what it is", pick: "take", why: "unchanged" });
    expect(change?.from).toBe("Business; Owners: Marcus Delgado (60%), Jordan Ellis (40%)");
    expect(change?.to).toBe("Trust; Trustees: Marcus Delgado, Jordan Ellis; Beneficiaries: Marcus Delgado (60%), Jordan Ellis (40%); drops Industry, Structure");
    const targets = change?.targets ?? [];
    expect(targets[0]).toEqual({ entity: CO, part: "kind" });
    for (const field of ["owners", "structure", "industry"]) expect(targets).toContainEqual({ entity: CO, part: "field", field });
    const state = await upgrade(rig, chatId, revision, {});
    const after = state.entities[CO];
    expect(after?.kind).toBe("trust");
    expect(ownersIn(after?.fields ?? {})).toEqual([
      { party: "marcus_delgado", role: "trustee" },
      { party: "pov", role: "trustee" },
      { party: "marcus_delgado", role: "beneficiary", share: 60 },
      { party: "pov", role: "beneficiary", share: 40 },
    ]);
    expect(after?.fields.structure).toBeUndefined();
    expect(after?.fields.industry).toBeUndefined();
    // Its positions stay, as both kinds read them.
    expect(after?.fields.positions).toEqual(HOLDINGS.fields.positions);
  });

  test("kept, nothing of it lands: the chat's company stays whole", async () => {
    const { rig, chatId, revision, preview } = await converted("modern_slice_of_life", CO, "trust", HOLDINGS);
    const change = changes(preview).find((c) => c.id === `${CO}:convert`);
    if (!change) throw new Error("no conversion change");
    // Settings picks every target of a change alike.
    const merge: UpgradePicks = { [CO]: { kind: "keep", fields: Object.fromEntries(change.targets.flatMap((t) => (t.part === "field" && t.field ? [[t.field, "keep"]] : []))) } };
    const state = await upgrade(rig, chatId, revision, merge);
    expect(state.entities[CO]?.kind).toBe("business");
    expect(state.entities[CO]?.fields.structure).toBe("llc");
    expect(ownersIn(state.entities[CO]?.fields ?? {})).toEqual(ownersIn(HOLDINGS.fields));
  });

  test("a trust made a company: its trustees' Director seats go with the change, on no holder's row; taken, the trustee sits as Director", async () => {
    const { rig, chatId, revision, preview, doc } = await converted("mystery_manor", TRUST, "company");
    const trustees = ownersIn(doc.entities[TRUST]?.fields ?? {}).filter((o) => o.role === "trustee").map((o) => o.party);
    expect(trustees.length).toBeGreaterThan(0);
    const change = changes(preview).find((c) => c.id === `${TRUST}:convert`);
    expect(change?.row).toBe(TRUST);
    for (const who of trustees) {
      expect(change?.targets).toContainEqual({ entity: who, part: "relation", rel: "member_of", to: TRUST });
      // No orphan: the seat isn't offered again on the trustee's own row.
      expect(changes(preview).filter((c) => c.row === who && c.targets.some((t) => t.part === "relation" && t.to === TRUST))).toEqual([]);
    }
    expect(change?.to).toContain("seats");
    const state = await upgrade(rig, chatId, revision, {});
    expect(state.entities[TRUST]?.kind).toBe("business");
    for (const who of trustees) expect(state.entities[who]?.relations.find((r) => r.type === "member_of" && r.to === TRUST)?.fields?.position).toBe("director");
  });
});
