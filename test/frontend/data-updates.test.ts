// Build → World → Data updates (DESIGN §9.2): each table's line and an edited table's review say what
// the shipped version brings and what the owner changed, from what `lre.world updates` lists for a
// Port Alder made on 58b2ac44's tables.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { DataTable } from "../../src/shared/tables";
import { changeLines, EDITED, updateSummary } from "../../src/frontend/build/data-updates";
import { createRegistry } from "../../src/engine/registry-impl";
import { tableUpdates } from "../../src/engine/table-updates";
import { ALL_PACKS } from "../../src/packs/index";

/** The recorded golden's committed fixture: 58b2ac44's own table files, as every world made on that build copied them. */
const KEPT = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "../ledger/recorded-58b2ac44.tables.json.gz"))).toString("utf8")) as { tables: Record<string, DataTable> };

describe("Build → World → Data updates", () => {
  const tables = structuredClone(KEPT.tables);
  const wallet = tables["gear.items"]?.rows.wallet_bifold;
  if (!wallet || !tables["gear.items"]) throw new Error("no wallet in the old gear items");
  tables["gear.items"].rows.wallet_bifold = { ...wallet, price_cents: { min: 100, typical: 200, max: 300 } };
  const updates = new Map(tableUpdates({ tables }, createRegistry(ALL_PACKS).tables).map((u) => [u.table, u]));
  const of = (id: string) => {
    const update = updates.get(id);
    if (!update) throw new Error(`no update for ${id}`);
    return update;
  };

  test("a table's line says what the shipped version brings", () => {
    expect(updateSummary(of("economy.catalog"))).toBe("Newer shipped version · 18 rows added, 178 rows changed · new columns: Aliases, Size, Holds");
    expect(updateSummary(of("economy.categories"))).toBe("Newer shipped version · 1 row added, 2 rows changed");
    expect(updateSummary(of("economy.index_history"))).toMatch(/^New table · \d+ rows$/);
    expect(updateSummary(of("gear.items"))).toBe(EDITED);
  });

  test("an edited table's review says what each side changed, the rows by name", () => {
    const items = of("gear.items");
    expect(changeLines(items.shipped, items.shipped.columns)).toEqual([expect.stringMatching(/^90 rows changed: Wallet, bifold; .*; and 78 more$/), "Column added: Size"]);
    expect(changeLines(items.yours ?? { added: { count: 0, names: [] }, changed: { count: 0, names: [] }, dropped: { count: 0, names: [] } })).toEqual(["1 row changed: Wallet, bifold"]);
  });
});
