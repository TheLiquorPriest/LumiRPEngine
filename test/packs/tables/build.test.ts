// The table build: it is deterministic, the committed output is what a fresh build produces,
// revisions follow content, the tables carry the §6 mapping rules, and each pack's shipped history
// ends at its committed tables and reads every earlier revision back, row for row.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildTables, outputPath, readSources, recordShipped, serializeTable, shippedPath } from "../../../scripts/tables/build";
import { DATA_PACK } from "../../../scripts/tables/mappings";
import { hashJson } from "../../../src/shared/hash";
import { isRecord } from "../../../src/shared/json";
import type { DataTable, ShippedRevision } from "../../../src/shared/tables";
import { columnPrints, rowPrints, shippedRowPrints, tableRevision } from "../../../src/shared/tables";
import { BASE_SOURCES, cloneMappings, cloneSources, mutate, read } from "./support";

/** ARCHITECTURE §6: every pinned table and the source file it comes from. */
const EXPECTED: Record<string, string> = {
  "economy.catalog": "us/prices.json",
  "economy.categories": "us/prices.json",
  "economy.occupations": "us/occupations.json",
  "economy.regions": "us/regions.json",
  "economy.finance": "us/finance.json",
  "economy.exempt": "us/exempt.json",
  "economy.projects": "us/projects.json",
  "economy.index_history": "us/index-history.json",
  "vehicles.classes": "us/vehicles.json",
  "vehicles.factors": "us/vehicles.json",
  "gear.items": "us/gear.json",
  "gear.containers": "us/gear.json",
  "gear.kits": "us/gear.json",
  "gear.slots": "us/gear.json",
  "calendar.holidays": "us/calendar.json",
  "calendar.observances": "us/calendar.json",
  "calendar.dst": "us/calendar.json",
  "calendar.school": "us/calendar.json",
  "calendar.work": "us/calendar.json",
  "calendar.shifts": "us/calendar.json",
};

const tables = buildTables(BASE_SOURCES);
const byId = Object.fromEntries(tables.map((table) => [table.id, table]));

function table(id: string): DataTable {
  const found = byId[id];
  if (!found) throw new Error(`table ${id} was not built`);
  return found;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value;
}

describe("table inventory", () => {
  test("builds exactly the ARCHITECTURE §6 tables, in order, with the pinned contract fields", () => {
    expect(tables.map((t) => t.id)).toEqual(Object.keys(EXPECTED));
    for (const t of tables) {
      expect(t.schema).toBe(`lre-table/${t.id}/v1`);
      expect(t.id.startsWith(`${t.pack}.`)).toBe(true);
      expect(t.revision).toMatch(/^[0-9a-f]{32}$/);
      expect(t.label.length).toBeGreaterThan(0);
      expect(Object.keys(t.rows).length).toBeGreaterThan(0);
    }
  });

  test("every table keeps its source provenance: file, schema, period, approximate and the basis", () => {
    for (const t of tables) {
      const file = EXPECTED[t.id];
      const source = BASE_SOURCES[file];
      if (!isRecord(source)) throw new Error(`source ${file} missing`);
      expect<unknown>(t.source).toEqual({
        dataPack: DATA_PACK,
        file,
        sourceSchema: source.schema,
        reflectsPeriod: source.reflects_period,
        approximate: source.approximate,
        basis: source.basis,
      });
    }
    // Every table is hand-compiled and approximate but the stock index's history, copied exactly from its published source.
    expect(tables.filter((t) => t.source?.approximate === false).map((t) => t.id)).toEqual(["economy.index_history"]);
  });

  test("the stock index's history cites its source in its metadata and pins what was fetched", () => {
    const history = table("economy.index_history");
    // A copy: matching asymmetric matchers against the shared build would write them into it.
    expect(structuredClone(history.source?.basis)).toMatchObject({
      source: expect.stringContaining("Thrift Savings Plan"),
      url: expect.stringMatching(/^https:\/\/www\.tsp\.gov\/data\/fund-price-history\.csv\?/),
      retrieved: "2026-11-02",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      license: expect.stringContaining("Public domain"),
    });
    // Month by month from the fund's $10 base of May 2003 to October 2026, with the closes as published.
    const months = Object.keys(history.rows);
    expect([months.length, months[0], months.at(-1)]).toEqual([282, "2003-05", "2026-10"]);
    expect(history.rows["2003-05"]).toEqual({ date: "2003-05-31", level: 10 });
    expect(history.rows["2008-10"]).toEqual({ date: "2008-10-31", level: 11.1223 });
    expect(history.rows["2026-10"]).toEqual({ date: "2026-10-30", level: 122.3804 });
  });

  test("row counts follow the sources", () => {
    const prices = BASE_SOURCES["us/prices.json"];
    const regions = BASE_SOURCES["us/regions.json"];
    if (!isRecord(prices) || !isRecord(regions)) throw new Error("sources missing");
    const categories = array(prices.categories).filter(isRecord);
    expect(Object.keys(table("economy.categories").rows)).toHaveLength(categories.length);
    expect(Object.keys(table("economy.catalog").rows)).toHaveLength(categories.reduce((sum, c) => sum + array(c.items).length, 0));
    // The national baseline row `us` rides along with the 50 states and DC.
    expect(Object.keys(table("economy.regions").rows)).toHaveLength(array(regions.entries).length + 1);
    expect(Object.keys(table("calendar.shifts").rows)).toHaveLength(array(read(BASE_SOURCES, "us/calendar.json", ["work_shift_patterns"])).length);
    expect(Object.keys(table("gear.items").rows)).toHaveLength(array(read(BASE_SOURCES, "us/gear.json", ["items"])).length);
    expect(Object.keys(table("economy.finance").rows)).toHaveLength(8);
    expect(Object.keys(table("economy.exempt").rows)).toEqual(array(read(BASE_SOURCES, "us/exempt.json", ["entries"])).map((e) => (isRecord(e) && typeof e.id === "string" ? e.id : "")));
  });
});

describe("determinism and freshness", () => {
  test("two builds give byte-identical text and the same revisions", () => {
    const first = buildTables(readSources());
    const second = buildTables(cloneSources());
    expect(first.map(serializeTable)).toEqual(second.map(serializeTable));
    expect(first.map((t) => t.revision)).toEqual(second.map((t) => t.revision));
    expect(first.map((t) => t.revision)).toEqual(tables.map((t) => t.revision));
  });

  test("the committed files are exactly a fresh build (no stale, missing or extra file)", () => {
    for (const t of tables) {
      expect(readFileSync(outputPath(t), "utf8")).toBe(serializeTable(t));
    }
    const dirs = new Set(tables.map((t) => dirname(outputPath(t))));
    const expected = [...tables.map((t) => outputPath(t)), ...[...new Set(tables.map((t) => t.pack))].map(shippedPath)].sort();
    const found = [...dirs].flatMap((dir) => readdirSync(dir).map((name) => join(dir, name))).sort();
    expect(found).toEqual(expected);
  });

  test("a committed revision is hashJson({schema, columns, rows}) of the committed content", () => {
    for (const t of tables) {
      const committed: unknown = JSON.parse(readFileSync(outputPath(t), "utf8"));
      if (!isRecord(committed)) throw new Error("committed table is not an object");
      expect(committed.revision).toBe(hashJson({ schema: committed.schema, columns: committed.columns, rows: committed.rows }));
    }
  });
});

describe("revisions follow content", () => {
  const revisions = Object.fromEntries(tables.map((t) => [t.id, t.revision]));

  test("changing one row changes that table's revision and no other source's tables", () => {
    const sources = cloneSources();
    const typical = ["categories", { id: "groceries_staples" }, "items", { id: "milk_whole" }, "price_cents", "typical"] as const;
    const before = read(sources, "us/prices.json", [...typical]);
    if (typeof before !== "number") throw new Error("milk_whole typical is not a number");
    mutate(sources, "us/prices.json", [...typical], before + 1);
    const changed = Object.fromEntries(buildTables(sources).map((t) => [t.id, t.revision]));
    expect(changed["economy.catalog"]).not.toBe(revisions["economy.catalog"]);
    for (const id of Object.keys(EXPECTED).filter((name) => EXPECTED[name] !== "us/prices.json")) {
      expect(changed[id]).toBe(revisions[id]);
    }
  });

  test("changing a column contract changes the revision even when the rows are the same", () => {
    const mappings = cloneMappings();
    const catalog = mappings.find((m) => m.table === "economy.catalog");
    if (!catalog) throw new Error("no catalog mapping");
    catalog.columns.notes = { type: "text", optional: true, doc: "A new description." };
    const rebuilt = buildTables(cloneSources(), mappings).find((t) => t.id === "economy.catalog");
    expect(rebuilt?.rows).toEqual(table("economy.catalog").rows);
    expect(rebuilt?.revision).not.toBe(revisions["economy.catalog"]);
  });

  test("the revision ignores key order", () => {
    const { schema, columns, rows } = table("gear.slots");
    const reversed = Object.fromEntries(Object.entries(rows).reverse());
    expect(hashJson({ rows: reversed, columns, schema })).toBe(table("gear.slots").revision);
  });
});

describe("the §6 mapping rules", () => {
  test("a category band is the min of mins, the median of typicals and the max of maxes", () => {
    const prices = BASE_SOURCES["us/prices.json"];
    if (!isRecord(prices)) throw new Error("prices missing");
    const categories = table("economy.categories");
    let evenCategories = 0;
    for (const category of array(prices.categories).filter(isRecord)) {
      const bands = array(category.items)
        .filter(isRecord)
        .map((item) => item.price_cents)
        .filter(isRecord);
      const typicals = bands.map((band) => Number(band.typical)).sort((a, b) => a - b);
      const mid = typicals.length >> 1;
      const median = typicals.length % 2 === 1 ? typicals[mid] : Math.ceil((typicals[mid - 1] + typicals[mid]) / 2);
      if (typicals.length % 2 === 0) evenCategories++;
      expect(categories.rows[String(category.id)]?.price_cents).toEqual({
        min: Math.min(...bands.map((band) => Number(band.min))),
        typical: median,
        max: Math.max(...bands.map((band) => Number(band.max))),
      });
      expect(categories.rows[String(category.id)]?.item_count).toBe(bands.length);
    }
    // Both the odd and the even median branch are exercised by the real data.
    expect(evenCategories).toBeGreaterThan(0);
    expect(evenCategories).toBeLessThan(array(prices.categories).length);
  });

  test("prices are national: catalog bands equal the source and the multiplier lives only in regions", () => {
    const prices = BASE_SOURCES["us/prices.json"];
    if (!isRecord(prices)) throw new Error("prices missing");
    const catalog = table("economy.catalog");
    for (const category of array(prices.categories).filter(isRecord)) {
      for (const item of array(category.items).filter(isRecord)) {
        expect<unknown>(catalog.rows[String(item.id)]?.price_cents).toEqual(item.price_cents);
        expect<unknown>(catalog.rows[String(item.id)]?.category).toBe(category.id);
      }
    }
    expect(Object.keys(catalog.columns)).not.toContain("cost_of_living_multiplier");
    expect(table("economy.regions").rows.us?.cost_of_living_multiplier).toBe(1);
    expect(table("economy.regions").rows.ca?.cost_of_living_multiplier).toBeGreaterThan(1);
  });

  test("the mechanic toolbox has exactly 45 pieces", () => {
    const toolbox = table("gear.kits").rows.mechanic_toolbox_45;
    const pieces = array(toolbox?.pieces).filter(isRecord);
    expect(pieces.reduce((sum, piece) => sum + Number(piece.qty), 0)).toBe(45);
    expect(toolbox?.piece_count).toBe(45);
  });

  test("references in the committed output all resolve", () => {
    const rowsOf = (id: string) => table(id).rows;
    for (const t of tables) {
      for (const [name, def] of Object.entries(t.columns)) {
        const target = def.ref;
        if (!target) continue;
        for (const [id, row] of Object.entries(t.rows)) {
          const value = row[name];
          if (value === undefined) continue;
          const ids = def.type === "list" ? array(value) : [value];
          for (const ref of ids) expect({ at: `${t.id}/${id}.${name}`, found: typeof ref === "string" && ref in rowsOf(target) }).toEqual({ at: `${t.id}/${id}.${name}`, found: true });
        }
      }
    }
  });
});

describe("sizes and home furnishings (ITEMS-SPEC §3.5)", () => {
  const SERVICES = ["meals_out", "coffee", "transport", "vehicle_services", "lodging", "utilities", "subscriptions"];

  test("every gear item has a size, and every container a holds and, unless it is part of a vehicle, a size", () => {
    for (const [id, row] of Object.entries(table("gear.items").rows)) expect({ id, size: typeof row.size }).toEqual({ id, size: "string" });
    for (const [id, row] of Object.entries(table("gear.containers").rows)) {
      expect({ id, holds: typeof row.holds, size: typeof row.size }).toEqual({ id, holds: "string", size: row.location === "vehicle_fixed" ? "undefined" : "string" });
    }
  });

  test("the rows the Phase 1 inference reads carry the sizes it expects", () => {
    const containers = table("gear.containers").rows;
    expect([containers.toolbox_20in?.size, containers.toolbox_20in?.holds]).toEqual(["armful", "hand"]);
    expect([containers.tool_chest_rolling?.location, containers.tool_chest_rolling?.size]).toEqual(["furniture", "furniture"]);
    expect(containers.truck_bed_fullsize?.holds).toBe("furniture");
    expect(containers.wallet?.holds).toBe("pocket");
    expect(table("gear.items").rows.keys_set?.size).toBe("pocket");
  });

  test("home_furnishings is a category of furniture, appliances and the big pieces that came from elsewhere", () => {
    const catalog = table("economy.catalog");
    expect(table("economy.categories").rows.home_furnishings?.name).toBe("Home furnishings and appliances");
    const furnishings = Object.entries(catalog.rows).filter(([, row]) => row.category === "home_furnishings");
    for (const id of ["refrigerator", "washer", "sofa", "mattress_queen", "bed_frame_queen", "tv_55_4k", "office_desk", "office_chair", "floor_lamp"]) {
      expect(furnishings.map(([rowId]) => rowId)).toContain(id);
    }
    for (const [id, row] of furnishings) expect({ id, size: typeof row.size }).toEqual({ id, size: "string" });
    expect(catalog.rows.refrigerator?.size).toBe("furniture");
    expect(catalog.rows.sofa?.size).toBe("furniture");
    expect(catalog.rows.tv_65_4k?.size).toBe("heavy");
  });

  test("service rows carry no size; goods in a physical category each carry one", () => {
    for (const [id, row] of Object.entries(table("economy.catalog").rows)) {
      if (SERVICES.includes(String(row.category))) expect({ id, sized: "size" in row }).toEqual({ id, sized: false });
    }
    for (const category of ["groceries_staples", "clothing", "electronics", "tools_hardware", "household_goods", "home_furnishings"]) {
      for (const [id, row] of Object.entries(table("economy.catalog").rows)) {
        if (row.category === category && !/^dry_cleaning/.test(id)) expect({ id, size: typeof row.size }).toEqual({ id, size: "string" });
      }
    }
  });
});

describe("the shipped history (Data updates)", () => {
  const histories = (pack: string): Record<string, ShippedRevision[]> => JSON.parse(readFileSync(shippedPath(pack), "utf8")) as Record<string, ShippedRevision[]>;
  const historyOf = (t: DataTable): ShippedRevision[] => histories(t.pack)[t.id] ?? [];

  test("each pack's history holds its tables, each ending at its committed revision with its columns", () => {
    for (const pack of new Set(tables.map((t) => t.pack))) expect(Object.keys(histories(pack))).toEqual(tables.filter((t) => t.pack === pack).map((t) => t.id));
    for (const t of tables) expect({ id: t.id, last: historyOf(t).at(-1) }).toEqual({ id: t.id, last: { revision: t.revision, columns: Object.fromEntries(columnPrints(t.columns)) } });
  });

  test("a build that changes a table records the change against the committed one, and reads the earlier rows back", () => {
    const catalog = table("economy.catalog");
    const history = historyOf(catalog);
    const { milk_whole: milk, butter: _dropped, ...kept } = catalog.rows;
    const rows = { ...kept, milk_whole: { ...milk, notes: "Organic" }, oat_milk: { name: "Oat milk", category: "groceries_staples", unit: "half gallon", price_cents: { min: 300, typical: 450, max: 600 } } };
    const next: DataTable = { ...catalog, rows, revision: tableRevision({ ...catalog, rows }) };
    const recorded = recordShipped(history, catalog, next);
    expect(recorded.slice(0, -2)).toEqual(history.slice(0, -1));
    const last = history.at(-1);
    const prints = rowPrints(catalog.rows);
    if (!last) throw new Error("no shipped history for the catalog");
    expect(recorded.at(-2)).toEqual({ ...last, changed: { milk_whole: prints.get("milk_whole") ?? "", butter: prints.get("butter") ?? "" }, added: ["oat_milk"] });
    expect(recorded.at(-1)?.revision).toBe(next.revision);
    const back = shippedRowPrints(recorded, rowPrints(next.rows));
    expect(Object.fromEntries(back.at(-2) ?? [])).toEqual(Object.fromEntries(rowPrints(catalog.rows)));
    expect(back.slice(0, -1).map((r) => Object.fromEntries(r))).toEqual(shippedRowPrints(history, rowPrints(catalog.rows)).map((r) => Object.fromEntries(r)));
    // Built again with nothing changed, it stays as it was.
    expect(recordShipped(recorded, next, next)).toEqual(recorded);
  });

  test("a history that doesn't end at the committed table stops the build", () => {
    const items = table("gear.items");
    const rows = { ...items.rows, rope_50ft: { name: "Rope, 50 ft", category: "outdoor", equip_slot: "none", weight_g: 1500, volume_l: 3, price_cents: { min: 1500, typical: 2500, max: 4000 } } };
    expect(() => recordShipped(historyOf(items), table("gear.kits"), { ...items, rows, revision: tableRevision({ ...items, rows }) })).toThrow(/restore both from one commit/);
  });

  test("the tables a chat recorded on 58b2ac44 pinned are shipped revisions, read back row for row", () => {
    const kept = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "../../ledger/recorded-58b2ac44.tables.json.gz"))).toString("utf8")) as { tables: Record<string, DataTable> };
    for (const old of Object.values(kept.tables)) {
      const current = table(old.id);
      const history = historyOf(current);
      const at = history.findIndex((r) => r.revision === tableRevision(old));
      expect({ id: old.id, shipped: at >= 0 }).toEqual({ id: old.id, shipped: true });
      expect(Object.fromEntries(shippedRowPrints(history, rowPrints(current.rows))[at] ?? [])).toEqual(Object.fromEntries(rowPrints(old.rows)));
      expect(history[at]?.columns).toEqual(Object.fromEntries(columnPrints(old.columns)));
    }
  });
});
