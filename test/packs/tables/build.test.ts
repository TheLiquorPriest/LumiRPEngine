// The table build: it is deterministic, the committed output is what a fresh build produces,
// revisions follow content, and the tables carry the §6 mapping rules.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildTables, outputPath, readSources, serializeTable } from "../../../scripts/tables/build";
import { DATA_PACK } from "../../../scripts/tables/mappings";
import { hashJson } from "../../../src/shared/hash";
import { isRecord } from "../../../src/shared/json";
import type { DataTable } from "../../../src/shared/tables";
import { BASE_SOURCES, cloneMappings, cloneSources, mutate, read } from "./support";

/** ARCHITECTURE §6: every pinned table and the source file it comes from. */
const EXPECTED: Record<string, string> = {
  "economy.catalog": "us/prices.json",
  "economy.categories": "us/prices.json",
  "economy.occupations": "us/occupations.json",
  "economy.regions": "us/regions.json",
  "economy.finance": "us/finance.json",
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
        approximate: true,
        basis: source.basis,
      });
    }
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
    expect(Object.keys(table("economy.finance").rows)).toHaveLength(7);
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
    const expected = tables.map((t) => outputPath(t)).sort();
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
