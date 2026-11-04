// Data updates in a world with a running chat (DESIGN §9.2): a Port Alder made on the old tables
// takes the newer shipped ones through Build (`lre.world updates`, then `lre.editor shipped` and a
// commit) while its chat keeps the revision it plays; the chat's Upgrade then brings the new rows in
// ("TV" is a television, not cable, a fridge and a couch are priced, the home furnishings category
// and the index's history are there). A table the owner changed is never touched unless they take
// the shipped version of it themselves. A Brindlemere made on the old tables takes its own starter's
// newer prices and items, never the Modern US ones.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { TableUpdate } from "../../src/shared/protocol";
import type { DataTable } from "../../src/shared/tables";
import { tableRevision } from "../../src/shared/tables";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import type { WorldState } from "../../src/engine/state";
import { matchCatalog } from "../../src/packs/economy/core/index";
import { STARTER_TABLES, STARTER_WORLDS } from "../../src/packs/index";
import { Rig } from "../support/rig";

/** The recorded golden's committed fixture: 58b2ac44's own table files, as every world made on that build copied them. */
const KEPT = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "../ledger/recorded-58b2ac44.tables.json.gz"))).toString("utf8")) as { tables: Record<string, DataTable> };
/** The starters' own tables (Brindlemere's and Harrowmere's) as 58b2ac44 shipped them. */
const STARTERS_58 = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "../engine/starter-tables-58b2ac44.json.gz"))).toString("utf8")) as { starters: Record<string, Record<string, DataTable>> };

/** The owner's own price for the bifold wallet, in their copy of the old gear items. */
const WALLET = { min: 100, typical: 200, max: 300 };

/** Port Alder as made on 58b2ac44, its owner having priced the bifold wallet themselves. */
function oldPortAlder(id: string, name: string): WorldDoc {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder");
  const world = make(id, name);
  const tables = structuredClone(KEPT.tables);
  const items = tables["gear.items"];
  if (!items?.rows.wallet_bifold) throw new Error("no wallet in the old gear items");
  items.rows.wallet_bifold = { ...items.rows.wallet_bifold, price_cents: WALLET };
  items.revision = tableRevision(items);
  return { ...world, tables, pins: { ...world.pins, tables: Object.fromEntries(Object.entries(tables).map(([tid, t]) => [tid, t.revision])) } };
}

/** Brindlemere as made on 58b2ac44: the packs' tables and its own as that build shipped them. */
function oldBrindlemere(id: string, name: string): WorldDoc {
  const make = STARTER_WORLDS.fantasy_town;
  if (!make) throw new Error("no Brindlemere");
  const world = make(id, name);
  const tables = { ...structuredClone(KEPT.tables), ...structuredClone(STARTERS_58.starters.fantasy_town) };
  return { ...world, tables, pins: { ...world.pins, tables: Object.fromEntries(Object.entries(tables).map(([tid, t]) => [tid, t.revision])) } };
}

/** The chat as it plays now: its folded state and the world revision it plays. */
async function played(rig: Rig, worldId: string, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return { state, world: (await rig.rt.worlds.get(worldId, rig.host.userId, state.revision)).world };
}

/** What `lre.world updates` lists: the draft's, or one revision's. */
async function updatesOf(rig: Rig, worldId: string, revision?: string): Promise<TableUpdate[]> {
  const listed = rig.body(await rig.send({ type: "lre.world", op: "updates", worldId, ...(revision !== undefined ? { revision } : {}) })).updates as TableUpdate[];
  return listed;
}

async function oldWorldChat(): Promise<{ rig: Rig; worldId: string; chatId: string }> {
  const rig = new Rig({ shipped: true, templates: { old_port_alder: oldPortAlder } });
  const worldId = await rig.newWorld("Alder", "old_port_alder");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "The street is quiet.");
  return { rig, worldId, chatId };
}

/** The table this build ships under `id`. */
function shippedTable(rig: Rig, id: string): DataTable {
  const table = rig.rt.registry.tables.get(id)?.defaults;
  if (!table) throw new Error(`no shipped ${id}`);
  return table;
}

describe("Data updates in a world with a running chat", () => {
  test("Apply puts the newer shipped tables in the draft, the chat keeps its revision, and its Upgrade brings the new rows in; the owner's table is untouched", async () => {
    const { rig, worldId, chatId } = await oldWorldChat();
    const ctx = (at: { state: WorldState; world: WorldDoc }) => rig.rt.registry.context(at.world, at.state);
    const before = await played(rig, worldId, chatId);
    expect(["TV", "fridge", "couch"].map((text) => matchCatalog(ctx(before), text, null))).toEqual(["cable_tv", null, null]);

    const listed = await updatesOf(rig, worldId);
    expect(Object.fromEntries(listed.map((u) => [u.table, u.status]))).toEqual({ "economy.catalog": "update", "economy.categories": "update", "economy.exempt": "missing", "economy.finance": "update", "economy.regions": "update", "economy.index_history": "missing", "economy.projects": "missing", "gear.items": "edited", "gear.containers": "update" });

    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const take = listed.filter((u) => u.status !== "edited").map((u) => u.table);
    const applied = rig.body(await rig.send({ type: "lre.editor", op: "shipped", worldId, base: draft.base, version: draft.version, tables: take }));
    const doc = applied.draft as WorldDoc;
    for (const id of take) {
      const shipped = shippedTable(rig, id);
      expect({ id, table: doc.tables[id], pin: doc.pins.tables[id] }).toEqual({ id, table: shipped, pin: shipped.revision });
    }
    expect(doc.tables["gear.items"]?.rows.wallet_bifold?.price_cents).toEqual(WALLET);
    // Apply again from the version it read is refused: the draft has moved on.
    const stale = await rig.send({ type: "lre.editor", op: "shipped", worldId, base: draft.base, version: draft.version, tables: take });
    expect(stale.type === "lre.error" ? stale.code : stale.type).toBe("conflict");
    // Only the owner's own table is left, as edited.
    expect((await updatesOf(rig, worldId)).map((u) => [u.table, u.status])).toEqual([["gear.items", "edited"]]);

    const revision = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: applied.base })).revision);
    // The chat plays the revision it was on until it is upgraded.
    const kept = await played(rig, worldId, chatId);
    expect(kept.state.revision).toBe(before.state.revision);
    expect(matchCatalog(ctx(kept), "TV", null)).toBe("cable_tv");
    expect((await updatesOf(rig, worldId, kept.state.revision)).map((u) => u.table)).toEqual(listed.map((u) => u.table));

    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: revision, merge: {} }));
    const upgraded = await played(rig, worldId, chatId);
    expect(upgraded.state.revision).toBe(revision);
    expect(["TV", "fridge", "couch"].map((text) => matchCatalog(ctx(upgraded), text, null))).toEqual(["tv_55_4k", "refrigerator", "sofa"]);
    expect(upgraded.world.tables["economy.categories"]?.rows.home_furnishings?.name).toBe("Home furnishings and appliances");
    expect(upgraded.world.tables["economy.index_history"]?.revision).toBe(shippedTable(rig, "economy.index_history").revision);
    expect(upgraded.world.tables["gear.items"]).toEqual(before.world.tables["gear.items"]);
  });

  test("the owner may take the shipped version of a table they changed; a table this build doesn't ship is refused", async () => {
    const { rig, worldId } = await oldWorldChat();
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const unknown = await rig.send({ type: "lre.editor", op: "shipped", worldId, base: draft.base, version: draft.version, tables: ["gear.items", "custom.prices"] });
    expect(unknown.type === "lre.error" ? unknown.code : unknown.type).toBe("bad_request");
    const taken = rig.body(await rig.send({ type: "lre.editor", op: "shipped", worldId, base: draft.base, version: draft.version, tables: ["gear.items"] }));
    const doc = taken.draft as WorldDoc;
    expect(doc.tables["gear.items"]).toEqual(shippedTable(rig, "gear.items"));
    expect((await updatesOf(rig, worldId)).map((u) => u.table)).not.toContain("gear.items");
  });

  test("a Brindlemere made on the old tables takes its own starter's newer prices and items, never the Modern US ones, and the packs' newer tables beside them", async () => {
    const rig = new Rig({ shipped: true, templates: { old_brindlemere: oldBrindlemere } });
    const worldId = await rig.newWorld("Brindlemere", "old_brindlemere");
    const listed = await updatesOf(rig, worldId);
    expect(Object.fromEntries(listed.map((u) => [u.table, [u.status, u.starter?.name ?? null]]))).toEqual({ "economy.catalog": ["update", "Fantasy town"], "economy.exempt": ["missing", null], "economy.finance": ["update", null], "economy.regions": ["update", null], "economy.index_history": ["missing", null], "economy.projects": ["missing", null], "gear.items": ["update", "Fantasy town"], "gear.containers": ["update", null] });
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const doc = rig.body(await rig.send({ type: "lre.editor", op: "shipped", worldId, base: draft.base, version: draft.version, tables: listed.map((u) => u.table) })).draft as WorldDoc;
    for (const id of ["economy.catalog", "gear.items"]) {
      const own = STARTER_TABLES.find((s) => s.starter.id === "fantasy_town" && s.table.id === id)?.table;
      if (!own) throw new Error(`Brindlemere ships no ${id} of its own`);
      expect({ id, table: doc.tables[id], pin: doc.pins.tables[id] }).toEqual({ id, table: own, pin: own.revision });
      expect(doc.tables[id]?.rows).not.toEqual(shippedTable(rig, id).rows);
    }
    for (const id of ["gear.containers", "economy.index_history"]) expect(doc.tables[id]).toEqual(shippedTable(rig, id));
    expect(await updatesOf(rig, worldId)).toEqual([]);
    // A Brindlemere made now has none.
    expect(await updatesOf(rig, await rig.newWorld("Brindlemere", "fantasy_town"))).toEqual([]);
  });
});
