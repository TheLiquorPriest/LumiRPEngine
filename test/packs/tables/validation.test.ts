// Each build validation rule rejects a bad fixture: a corrupted copy of the real sources (or of
// the mappings) must fail with exactly the finding the rule exists to raise.

import { describe, expect, test } from "bun:test";
import { buildTables } from "../../../scripts/tables/build";
import { isRecord } from "../../../src/shared/json";
import type { Step } from "./support";
import { BASE_SOURCES, brief, cloneMappings, cloneSources, issuesOf, mutate, read } from "./support";

const PRICES = "us/prices.json";
const OCCUPATIONS = "us/occupations.json";
const VEHICLES = "us/vehicles.json";
const GEAR = "us/gear.json";
const CALENDAR = "us/calendar.json";
const FINANCE = "us/finance.json";

const MILK: Step[] = ["categories", { id: "groceries_staples" }, "items", { id: "milk_whole" }];
const TOOLBOX: Step[] = ["kits", { id: "mechanic_toolbox_45" }];

describe("the unmodified sources", () => {
  test("build with no findings, so every failure below comes from its own corruption", () => {
    expect(issuesOf(BASE_SOURCES)).toEqual([]);
    expect(() => buildTables(BASE_SOURCES)).not.toThrow();
  });
});

describe("type mismatches", () => {
  test("a fractional value in an integer column", () => {
    const sources = cloneSources();
    mutate(sources, OCCUPATIONS, ["entries", { id: "server" }, "median_hourly_cents"], 1650.5);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "type", table: "economy.occupations", row: "server", column: "median_cents_per_h" }]);
  });

  test("text where a number belongs", () => {
    const sources = cloneSources();
    mutate(sources, GEAR, ["items", { id: "wallet_bifold" }, "weight_g"], "70");
    expect(brief(issuesOf(sources))).toEqual([{ rule: "type", table: "gear.items", row: "wallet_bifold", column: "weight_g" }]);
  });

  test("a value outside an enum", () => {
    const sources = cloneSources();
    mutate(sources, VEHICLES, ["entries", { id: "compact_car" }, "domain"], "air");
    const issues = brief(issuesOf(sources));
    expect(issues).toContainEqual({ rule: "type", table: "vehicles.classes", row: "compact_car", column: "domain" });
  });

  test("a band with a missing member", () => {
    const sources = cloneSources();
    mutate(sources, PRICES, [...MILK, "price_cents", "typical"], undefined);
    // The category aggregate cannot be computed from a broken item either, so it reports too.
    expect(brief(issuesOf(sources))).toContainEqual({ rule: "type", table: "economy.catalog", row: "milk_whole", column: "price_cents" });
  });

  test("a required field that is absent", () => {
    const sources = cloneSources();
    mutate(sources, OCCUPATIONS, ["entries", { id: "server" }, "description"], undefined);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "column", table: "economy.occupations", row: "server", column: "description" }]);
  });

  test("a calendar rule that sets a field its type does not use", () => {
    const sources = cloneSources();
    mutate(sources, CALENDAR, ["federal_holidays", { id: "new_years_day" }, "rule", "n"], 2);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "column", table: "calendar.holidays", row: "new_years_day", column: "rule_type" }]);
  });

  test("a day that does not exist in its month", () => {
    const sources = cloneSources();
    mutate(sources, CALENDAR, ["federal_holidays", { id: "new_years_day" }, "rule", "day"], 32);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "type", table: "calendar.holidays", row: "new_years_day", column: "day" }]);
  });
});

describe("unit mismatches", () => {
  test("fractional cents in a money band", () => {
    const sources = cloneSources();
    mutate(sources, PRICES, [...MILK, "price_cents", "typical"], 410.5);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "unit", table: "economy.catalog", row: "milk_whole", column: "price_cents" }]);
  });

  test("fractional cents inside a free-form finance section", () => {
    const sources = cloneSources();
    mutate(sources, FINANCE, ["credit_card", "late_fee_cents", "typical"], 3250.5);
    const issues = issuesOf(sources).filter((issue) => issue.rule === "unit");
    expect(brief(issues)).toEqual([{ rule: "unit", table: "economy.finance", row: "credit_card", column: "values" }]);
  });

  test("an EV that declares miles per gallon", () => {
    const sources = cloneSources();
    mutate(sources, VEHICLES, ["entries", { id: "ev_sedan" }, "consumption", "unit"], "mpg");
    expect(brief(issuesOf(sources))).toEqual([{ rule: "unit", table: "vehicles.classes", row: "ev_sedan", column: "consumption_unit" }]);
  });

  test("a consumption unit the table does not know", () => {
    const sources = cloneSources();
    mutate(sources, VEHICLES, ["entries", { id: "compact_car" }, "consumption", "unit"], "furlongs_per_firkin");
    expect(issuesOf(sources).map((issue) => issue.rule)).toContain("unit");
  });

  test("a column whose name carries one unit but declares another", () => {
    const mappings = cloneMappings();
    const catalog = mappings.find((mapping) => mapping.table === "economy.catalog");
    if (!catalog) throw new Error("no catalog mapping");
    catalog.columns.price_cents = { type: "band", unit: "pct" };
    expect(brief(issuesOf(BASE_SOURCES, mappings))).toEqual([{ rule: "unit", table: "economy.catalog", row: null, column: "price_cents" }]);
  });

  test("whole-cent money declared as a floating number", () => {
    const mappings = cloneMappings();
    const occupations = mappings.find((mapping) => mapping.table === "economy.occupations");
    if (!occupations) throw new Error("no occupations mapping");
    occupations.columns.median_cents_per_year = { type: "number", unit: "cents_per_year" };
    expect(brief(issuesOf(BASE_SOURCES, mappings))).toEqual([{ rule: "unit", table: "economy.occupations", row: null, column: "median_cents_per_year" }]);
  });

  test("a unit on a column that is not numeric", () => {
    const mappings = cloneMappings();
    const slots = mappings.find((mapping) => mapping.table === "gear.slots");
    if (!slots) throw new Error("no slots mapping");
    slots.columns.description = { type: "text", unit: "g" };
    expect(brief(issuesOf(BASE_SOURCES, mappings))).toEqual([{ rule: "unit", table: "gear.slots", row: null, column: "description" }]);
  });
});

describe("band ordering", () => {
  test("an item whose minimum exceeds its typical price", () => {
    const sources = cloneSources();
    mutate(sources, PRICES, [...MILK, "price_cents", "min"], 99999);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "band", table: "economy.catalog", row: "milk_whole", column: "price_cents" }]);
  });

  test("a vehicle whose maximum registration is below its typical", () => {
    const sources = cloneSources();
    mutate(sources, VEHICLES, ["entries", { id: "compact_car" }, "registration_cents_per_year", "max"], 1);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "band", table: "vehicles.classes", row: "compact_car", column: "registration_cents_per_year" }]);
  });

  test("a range inside a free-form finance section", () => {
    const sources = cloneSources();
    mutate(sources, FINANCE, ["credit_card", "apr_pct", "min"], 99);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "band", table: "economy.finance", row: "credit_card", column: "values" }]);
  });
});

describe("references", () => {
  test("an occupation whose shift pattern does not exist", () => {
    const sources = cloneSources();
    mutate(sources, OCCUPATIONS, ["entries", { id: "server" }, "schedule", "pattern"], "no_such_pattern");
    expect(brief(issuesOf(sources))).toEqual([{ rule: "ref", table: "economy.occupations", row: "server", column: "schedule_pattern" }]);
  });

  test("a kit whose recommended container does not exist", () => {
    const sources = cloneSources();
    mutate(sources, GEAR, [...TOOLBOX, "recommended_container_id"], "no_such_box");
    expect(brief(issuesOf(sources))).toEqual([{ rule: "ref", table: "gear.kits", row: "mechanic_toolbox_45", column: "recommended_container" }]);
  });

  test("an item or container in a slot that does not exist", () => {
    const sources = cloneSources();
    mutate(sources, GEAR, ["items", { id: "wallet_bifold" }, "equip_slot"], "elbow");
    mutate(sources, GEAR, ["containers", { id: "wallet" }, "equip_slot"], "elbow");
    expect(brief(issuesOf(sources))).toEqual([
      { rule: "ref", table: "gear.items", row: "wallet_bifold", column: "equip_slot" },
      { rule: "ref", table: "gear.containers", row: "wallet", column: "equip_slot" },
    ]);
  });

  test("a vehicle whose consumption guide does not exist", () => {
    const sources = cloneSources();
    mutate(sources, VEHICLES, ["entries", { id: "compact_car" }, "consumption_factors_ref"], "consumption_factor_guides.air");
    expect(brief(issuesOf(sources))).toEqual([{ rule: "ref", table: "vehicles.classes", row: "compact_car", column: "factor_guide" }]);
  });

  test("an observance relative to a holiday that does not exist", () => {
    const sources = cloneSources();
    mutate(sources, CALENDAR, ["common_observances", { id: "black_friday" }, "rule", "base"], "no_such_holiday");
    expect(brief(issuesOf(sources))).toEqual([{ rule: "ref", table: "calendar.observances", row: "black_friday", column: "base" }]);
  });

  test("a reference to a table that is not part of the build", () => {
    const mappings = cloneMappings().filter((mapping) => mapping.table !== "calendar.shifts");
    const issues = issuesOf(BASE_SOURCES, mappings);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.rule === "ref" && issue.table === "economy.occupations" && issue.column === "schedule_pattern")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("calendar.shifts is not part of the build"))).toBe(true);
  });
});

describe("duplicate ids", () => {
  test("the same item id in two categories", () => {
    const sources = cloneSources();
    const milk = read(sources, PRICES, MILK);
    const target = read(sources, PRICES, ["categories", { id: "coffee" }, "items"]);
    if (!Array.isArray(target)) throw new Error("coffee items missing");
    target.push(structuredClone(milk));
    expect(brief(issuesOf(sources))).toEqual([{ rule: "duplicate", table: "economy.catalog", row: "milk_whole", column: null }]);
  });

  test("the same holiday twice", () => {
    const sources = cloneSources();
    const holidays = read(sources, CALENDAR, ["federal_holidays"]);
    if (!Array.isArray(holidays)) throw new Error("holidays missing");
    holidays.push(structuredClone(holidays[0]));
    expect(brief(issuesOf(sources))).toEqual([{ rule: "duplicate", table: "calendar.holidays", row: "new_years_day", column: null }]);
  });

  test("the same table mapped twice", () => {
    const mappings = [...cloneMappings(), ...cloneMappings().slice(0, 1)];
    expect(brief(issuesOf(BASE_SOURCES, mappings))).toEqual([{ rule: "duplicate", table: "economy.catalog", row: null, column: null }]);
  });
});

describe("sums", () => {
  test("a toolbox that has lost a piece no longer sums to 45", () => {
    const sources = cloneSources();
    mutate(sources, GEAR, [...TOOLBOX, "pieces", 1, "qty"], 7);
    const issues = issuesOf(sources);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.rule === "sum" && issue.table === "gear.kits" && issue.row === "mechanic_toolbox_45")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("exactly 45 pieces, has 44"))).toBe(true);
  });

  test("a toolbox whose count and pieces both say 44 still fails the 45 invariant", () => {
    const sources = cloneSources();
    mutate(sources, GEAR, [...TOOLBOX, "pieces", 1, "qty"], 7);
    mutate(sources, GEAR, [...TOOLBOX, "piece_count"], 44);
    mutate(sources, GEAR, [...TOOLBOX, "pieces_total_weight_g"], 5440 - 55);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "sum", table: "gear.kits", row: "mechanic_toolbox_45", column: "pieces" }]);
  });

  test("a kit whose declared piece count disagrees with its pieces", () => {
    const sources = cloneSources();
    mutate(sources, GEAR, ["kits", { id: "first_aid_kit" }, "piece_count"], 85);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "sum", table: "gear.kits", row: "first_aid_kit", column: "pieces" }]);
  });

  test("a build without the toolbox kit", () => {
    const sources = cloneSources();
    const kits = read(sources, GEAR, ["kits"]);
    if (!Array.isArray(kits)) throw new Error("kits missing");
    mutate(sources, GEAR, ["kits"], kits.filter((kit) => !(isRecord(kit) && kit.id === "mechanic_toolbox_45")));
    expect(issuesOf(sources).some((issue) => issue.rule === "sum" && issue.message.includes("mechanic_toolbox_45 is missing"))).toBe(true);
  });
});

describe("source integrity", () => {
  test("a source field no column consumes fails instead of being dropped", () => {
    const sources = cloneSources();
    mutate(sources, PRICES, [...MILK, "surprise"], 1);
    expect(brief(issuesOf(sources))).toEqual([{ rule: "source", table: "economy.catalog", row: "milk_whole", column: null }]);
  });

  test("a source that stops being approximate", () => {
    const sources = cloneSources();
    mutate(sources, PRICES, ["approximate"], false);
    const issues = issuesOf(sources);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.rule === "source" && issue.message.includes("approximate"))).toBe(true);
  });

  test("a missing source file", () => {
    const sources = cloneSources();
    delete sources[PRICES];
    expect(issuesOf(sources).every((issue) => issue.rule === "source" && issue.message.includes(PRICES))).toBe(true);
  });

  test("a mapping path that matches nothing", () => {
    const mappings = cloneMappings();
    const shifts = mappings.find((mapping) => mapping.table === "calendar.shifts");
    if (!shifts) throw new Error("no shifts mapping");
    shifts.from = "work_shift_patterns_typo[]";
    expect(issuesOf(BASE_SOURCES, mappings).some((issue) => issue.rule === "source" && issue.table === "calendar.shifts")).toBe(true);
  });

  test("the unmodified sources still pass after all of the above (no shared state leaks between fixtures)", () => {
    expect(issuesOf(BASE_SOURCES)).toEqual([]);
  });
});
