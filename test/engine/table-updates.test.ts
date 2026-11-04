// Data updates (DESIGN §9.2): which of a world's data tables this build ships newer, told from the
// table build's shipped history and the template build's for the starters' own tables. A copy that
// is an earlier shipped revision is an update, the starter's own version for a starter's own table;
// a table the world lacks is missing; a copy changed from an earlier revision is edited; a copy
// changed from what ships now, or the world's own, has nothing newer.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { DataTable } from "../../src/shared/tables";
import type { WorldDoc } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { shippedVersion, tableUpdates } from "../../src/engine/table-updates";
import { ALL_PACKS, STARTER_TABLES, STARTER_WORLDS } from "../../src/packs/index";

const reg = createRegistry(ALL_PACKS);
/** The recorded golden's committed fixture: 58b2ac44's own table files, as every world made on that build copied them. */
const KEPT = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "../ledger/recorded-58b2ac44.tables.json.gz"))).toString("utf8")) as { tables: Record<string, DataTable> };
/** Those tables, from before sizes, holds, home furnishings, aliases and the index's history shipped. */
const OLD = KEPT.tables;
/** The starters' own tables (Brindlemere's and Harrowmere's prices, categories, items and vehicle classes) as 58b2ac44 shipped them. */
const STARTERS_58 = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "starter-tables-58b2ac44.json.gz"))).toString("utf8")) as { starters: Record<string, Record<string, DataTable>> };

function starter(id: "modern_slice_of_life" | "fantasy_town" | "mystery_manor"): WorldDoc {
  const make = STARTER_WORLDS[id];
  if (!make) throw new Error(`no starter ${id}`);
  return make("w", id);
}

/** Port Alder as a world made before those tables shipped: every table as it was then. */
function oldPortAlder(): WorldDoc {
  return { ...starter("modern_slice_of_life"), tables: structuredClone(OLD) };
}

/** A starter world as made on 58b2ac44: the packs' tables and its own as that build shipped them. */
function oldStarter(id: "fantasy_town" | "mystery_manor"): WorldDoc {
  return { ...starter(id), tables: { ...structuredClone(OLD), ...structuredClone(STARTERS_58.starters[id]) } };
}

/** The table a starter ships as its own now. */
function ownTable(starterId: string, id: string): DataTable {
  const table = STARTER_TABLES.find((s) => s.starter.id === starterId && s.table.id === id)?.table;
  if (!table) throw new Error(`${starterId} ships no ${id} of its own`);
  return table;
}

const statuses = (world: Pick<WorldDoc, "tables">): Record<string, string> => Object.fromEntries(tableUpdates(world, reg.tables, STARTER_TABLES).map((u) => [u.table, u.status]));

describe("Data updates", () => {
  test("a world made now has none", () => {
    expect(tableUpdates(starter("modern_slice_of_life"), reg.tables)).toEqual([]);
  });

  test("a Port Alder made on the old tables gets each changed table as an update and the index's history as missing", () => {
    const updates = tableUpdates(oldPortAlder(), reg.tables);
    expect(Object.fromEntries(updates.map((u) => [u.table, u.status]))).toEqual({ "economy.catalog": "update", "economy.categories": "update", "economy.index_history": "missing", "gear.items": "update", "gear.containers": "update" });
    const catalog = updates.find((u) => u.table === "economy.catalog");
    expect(catalog?.label).toBe("Price catalog");
    expect(catalog?.shipped.columns.added).toEqual(["aliases", "size", "holds"]);
    expect(catalog?.shipped.added.count).toBe(18);
    expect(catalog?.shipped.added.names).toContain("Refrigerator, full-size");
    expect(catalog?.yours).toBeUndefined();
    const categories = updates.find((u) => u.table === "economy.categories");
    expect(categories?.shipped.added.names).toEqual(["Home furnishings and appliances"]);
    expect(updates.find((u) => u.table === "economy.index_history")?.shipped.added.count).toBe(Object.keys(reg.tables.get("economy.index_history")?.defaults?.rows ?? {}).length);
  });

  test("a copy the world changed from an earlier revision is edited, with what each side changed", () => {
    const world = oldPortAlder();
    const items = world.tables["gear.items"];
    if (!items?.rows.wallet_bifold) throw new Error("no wallet in the old gear items");
    items.rows.wallet_bifold = { ...items.rows.wallet_bifold, price_cents: { min: 100, typical: 200, max: 300 } };
    const edited = tableUpdates(world, reg.tables).find((u) => u.table === "gear.items");
    expect(edited?.status).toBe("edited");
    expect(edited?.yours).toEqual({ added: { count: 0, names: [] }, changed: { count: 1, names: ["Wallet, bifold"] }, dropped: { count: 0, names: [] } });
    expect(edited?.shipped.columns.added).toEqual(["size"]);
    expect(edited?.shipped.changed.count).toBe(Object.keys(items.rows).length);
  });

  test("a copy changed from what ships now has nothing newer", () => {
    const world = starter("modern_slice_of_life");
    const catalog = world.tables["economy.catalog"];
    if (!catalog?.rows.milk_whole) throw new Error("no milk in the catalog");
    catalog.rows.milk_whole = { ...catalog.rows.milk_whole, notes: "From the farm stand" };
    delete catalog.rows.butter;
    expect(tableUpdates(world, reg.tables)).toEqual([]);
  });

  test("a template's own tables made now are current: Brindlemere and Harrowmere have none", () => {
    expect(tableUpdates(starter("fantasy_town"), reg.tables, STARTER_TABLES)).toEqual([]);
    expect(tableUpdates(starter("mystery_manor"), reg.tables, STARTER_TABLES)).toEqual([]);
    // Made on the old packs' tables, only the tables they keep as the packs ship them come up, and the index's history.
    const old = starter("fantasy_town");
    for (const id of ["gear.containers", "economy.finance", "economy.regions"]) old.tables[id] = structuredClone(OLD[id] as DataTable);
    delete old.tables["economy.index_history"];
    expect(statuses(old)).toEqual({ "economy.index_history": "missing", "gear.containers": "update" });
  });

  test("a Brindlemere or Harrowmere made on 58b2ac44 gets its starter's newer prices and items as updates, beside the packs' own, and takes the starter's versions", () => {
    for (const [id, name] of [["fantasy_town", "Fantasy town"], ["mystery_manor", "Mystery manor"]] as const) {
      const world = oldStarter(id);
      const updates = tableUpdates(world, reg.tables, STARTER_TABLES);
      expect(Object.fromEntries(updates.map((u) => [u.table, [u.status, u.starter?.name ?? "packs"]]))).toEqual({
        "economy.catalog": ["update", name],
        "economy.index_history": ["missing", "packs"],
        "gear.items": ["update", name],
        "gear.containers": ["update", "packs"],
      });
      const catalog = updates.find((u) => u.table === "economy.catalog");
      expect(catalog?.starter).toEqual({ id, name });
      expect(catalog?.shipped.columns.added).toEqual(["aliases", "size", "holds"]);
      expect(updates.find((u) => u.table === "gear.items")?.shipped.columns.added).toEqual(["size"]);
      // Data updates puts the starter's own version in, never the Modern US one; the packs' own for the rest.
      for (const table of ["economy.catalog", "gear.items"]) {
        expect(shippedVersion(world, reg.tables, STARTER_TABLES, table)).toBe(ownTable(id, table));
        expect(ownTable(id, table).revision).not.toBe(reg.tables.get(table)?.defaults?.revision);
      }
      expect(shippedVersion(world, reg.tables, STARTER_TABLES, "gear.containers")).toBe(reg.tables.get("gear.containers")?.defaults ?? null);
      expect(statuses({ tables: { ...world.tables, "economy.catalog": ownTable(id, "economy.catalog"), "gear.items": ownTable(id, "gear.items") } })).toEqual({ "economy.index_history": "missing", "gear.containers": "update" });
      // Without the starters' histories, their copies are the world's own, as before they shipped.
      expect(Object.fromEntries(tableUpdates(world, reg.tables).map((u) => [u.table, u.status]))).toEqual({ "economy.index_history": "missing", "gear.containers": "update" });
    }
  });

  test("a starter's own table changed from an earlier version is edited, with what each side changed; one changed from what it ships now has nothing newer", () => {
    const world = oldStarter("fantasy_town");
    const items = world.tables["gear.items"];
    const [first] = Object.keys(items?.rows ?? {});
    const row = first === undefined ? undefined : items?.rows[first];
    if (!items || first === undefined || !row) throw new Error("no rows in Brindlemere's old items");
    items.rows[first] = { ...row, price_cents: { min: 1, typical: 2, max: 3 } };
    const edited = tableUpdates(world, reg.tables, STARTER_TABLES).find((u) => u.table === "gear.items");
    expect([edited?.status, edited?.starter?.id, edited?.yours?.changed.count, edited?.shipped.columns.added]).toEqual(["edited", "fantasy_town", 1, ["size"]]);
    expect(shippedVersion(world, reg.tables, STARTER_TABLES, "gear.items")).toBe(ownTable("fantasy_town", "gear.items"));
    const now = starter("fantasy_town");
    const catalog = now.tables["economy.catalog"];
    const [id] = Object.keys(catalog?.rows ?? {});
    if (!catalog || id === undefined) throw new Error("no rows in Brindlemere's catalog");
    delete catalog.rows[id];
    expect(tableUpdates(now, reg.tables, STARTER_TABLES)).toEqual([]);
  });

  test("a world that keeps none of the shipped tables is offered none", () => {
    expect(tableUpdates({ tables: {} }, reg.tables)).toEqual([]);
    const own: DataTable = { id: "custom.prices", pack: "custom", schema: "lre-table/custom.prices/v1", revision: "x", label: "Prices", columns: { name: { type: "text" } }, rows: { bread: { name: "Bread" } } };
    expect(tableUpdates({ tables: { "custom.prices": own } }, reg.tables)).toEqual([]);
  });
});
