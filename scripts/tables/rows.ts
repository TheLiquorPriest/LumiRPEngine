// Row builders: how each source record becomes one row of its table. A builder reads source
// fields with `take` (so unread fields fail the build), renames them to the column contract in
// mappings.ts, and returns the row; `check` enforces cross-field invariants after all rows exist.
// Values are not typed here: validate.ts checks every row against its columns.

import { isRecord } from "../../src/shared/json";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { TableRow } from "../../src/shared/tables";
import type { Report } from "./issues";
import type { Fields, SourceNode } from "./source";

/** A row before validation; `undefined` marks an absent optional column. */
export type RawRow = Record<string, JsonValue | undefined>;

export interface RowContext {
  /** The whole source file, for the few tables that also read a header or a sibling section. */
  file: JsonObject;
}

export interface RowSpec {
  /** Overrides the default id (the `id` field of items, the key of entries); `undefined` keeps the default. */
  id?(node: SourceNode): string | undefined;
  row(f: Fields, node: SourceNode, ctx: RowContext): RawRow;
  /** Invariants across a table's finished rows. */
  check?(rows: Record<string, TableRow>, report: Report): void;
}

/** The `price_cents` band of a category: min of mins, median of typicals, max of maxes (ARCHITECTURE §6). */
function categoryBand(items: JsonValue | undefined, f: Fields): JsonValue | undefined {
  if (!Array.isArray(items) || items.length === 0) {
    f.fail("type", "a category needs a non-empty items array", "price_cents");
    return undefined;
  }
  const mins: number[] = [];
  const typicals: number[] = [];
  const maxes: number[] = [];
  for (const item of items) {
    const band = isRecord(item) ? item.price_cents : undefined;
    if (!isRecord(band) || typeof band.min !== "number" || typeof band.typical !== "number" || typeof band.max !== "number") {
      f.fail("type", "an item has no numeric price_cents band", "price_cents");
      return undefined;
    }
    mins.push(band.min);
    typicals.push(band.typical);
    maxes.push(band.max);
  }
  typicals.sort((a, b) => a - b);
  const mid = typicals.length >> 1;
  const typical = typicals.length % 2 === 1 ? typicals[mid] : Math.ceil((typicals[mid - 1] + typicals[mid]) / 2);
  return { min: Math.min(...mins), typical, max: Math.max(...maxes) };
}

const FINANCE_TITLES: Record<string, string> = {
  macro: "Macro rates",
  credit_card: "Credit cards",
  deposit_accounts: "Deposit accounts",
  loans: "Loans",
  investing: "Investing (index return model, GBM recipe, bonds, cash)",
  payroll_deductions_other_than_tax: "Payroll deductions other than tax",
  taxes_federal: "Federal tax",
};

const SCHOOL_TITLES: Record<string, string> = { k12: "K-12", college: "College" };

/** The unit each source consumption block declares, as the table's `consumption_unit`. */
const CONSUMPTION_UNITS: Record<string, string> = { mpg: "mpg", mi_per_kwh: "mi_per_kwh", gal_per_hour: "gal_per_h" };

/** Rate keys each domain's `consumption` must carry (a `note` is allowed on any). */
const CONSUMPTION_KEYS: Record<string, string[]> = {
  road: ["city", "highway", "combined"],
  marine: ["idle_no_wake", "cruise_planing", "wide_open"],
  offroad: ["idle", "normal_trail", "hard_use", "approx_mpg_trail"],
};

const GUIDE_PREFIX = "consumption_factor_guides.";

/** Columns a rule may set besides its optional `rule_note`; each rule type sets exactly its required ones. */
const RULE_COLUMNS = ["month", "day", "weekday", "n", "base", "offset_days", "algorithm", "window", "start", "end", "rule_text"];
const REQUIRED_BY_RULE: Record<string, string[]> = {
  fixed: ["month", "day"],
  nth_weekday: ["month", "weekday", "n"],
  relative: ["base", "offset_days"],
  relative_to_easter: ["offset_days"],
  computed: ["algorithm"],
  weekday_in_window: ["weekday", "window"],
  window: ["start", "end"],
  irregular: ["window"],
  lunar: [],
  rule: ["rule_text", "month"],
};
/** Days per month, February at 29 so leap days are expressible. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Reads a holiday's or observance's `rule` object into the shared rule columns. */
function ruleColumns(rule: Fields): RawRow {
  return {
    rule_type: rule.take("type"),
    month: rule.take("month"),
    day: rule.take("day"),
    weekday: rule.take("weekday"),
    n: rule.take("n"),
    base: rule.take("base"),
    offset_days: rule.take("offset_days"),
    algorithm: rule.take("algorithm"),
    window: rule.take("window"),
    start: rule.take("start"),
    end: rule.take("end"),
    rule_text: rule.take("rule"),
    rule_note: rule.take("note"),
  };
}

/** Each rule type sets exactly its columns, and dates and counts are real. */
function checkRules(rows: Record<string, TableRow>, report: Report): void {
  for (const [id, row] of Object.entries(rows)) {
    const where = { row: id, column: "rule_type" };
    const required = typeof row.rule_type === "string" ? REQUIRED_BY_RULE[row.rule_type] : undefined;
    if (!required) continue; // an unknown type is a column-type finding already
    for (const column of RULE_COLUMNS) {
      const present = row[column] !== undefined;
      if (required.includes(column) && !present) report("column", `a ${String(row.rule_type)} rule needs ${column}`, where);
      else if (present && !required.includes(column)) report("column", `a ${String(row.rule_type)} rule does not use ${column}`, where);
    }
    const { month, day, n, start, end } = row;
    if (typeof month === "number" && !(Number.isInteger(month) && month >= 1 && month <= 12)) report("type", `month ${month} is not 1-12`, { row: id, column: "month" });
    if (typeof day === "number" && typeof month === "number" && !(Number.isInteger(day) && day >= 1 && day <= (MONTH_DAYS[month - 1] ?? 0))) {
      report("type", `day ${day} is not a day of month ${month}`, { row: id, column: "day" });
    }
    if (typeof n === "number" && ![-1, 1, 2, 3, 4].includes(n)) report("type", `n ${n} is not 1-4 or -1 (last)`, { row: id, column: "n" });
    for (const [column, value] of [["start", start], ["end", end]] as const) {
      if (typeof value === "string" && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) report("type", `${column} "${value}" is not MM-DD`, { row: id, column });
    }
  }
}

export const ROW_SPECS: Record<string, RowSpec> = {
  "economy.catalog": {
    row(f, node) {
      const parent = node.parents[0]?.value;
      const category = isRecord(parent) ? parent.id : undefined;
      if (typeof category !== "string") f.fail("source", "item has no enclosing category id", "category");
      return { name: f.take("name"), category, unit: f.take("unit"), price_cents: f.take("price_cents"), notes: f.take("notes") };
    },
  },

  "economy.categories": {
    row(f) {
      const items = f.take("items");
      return {
        name: f.take("name"),
        basis: f.take("basis"),
        notes: f.take("notes"),
        price_unit_note: f.take("price_unit_note"),
        item_count: Array.isArray(items) ? items.length : undefined,
        price_cents: categoryBand(items, f),
      };
    },
  },

  "economy.occupations": {
    row(f, _node, ctx) {
      const schedule = f.sub("schedule");
      const tipped = f.take("tipped");
      return {
        title: f.take("title"),
        category: f.take("category"),
        median_cents_per_h: f.take("median_hourly_cents"),
        median_cents_per_year: f.take("median_annual_cents"),
        typical_earnings_cents_per_year: f.take("typical_annual_earnings_cents"),
        schedule_pattern: schedule.take("pattern"),
        typical_hours_per_week: schedule.take("typical_hours_per_week"),
        weeks_per_year: schedule.take("weeks_per_year"),
        weekend_work: schedule.take("weekend_work"),
        shifts: schedule.take("shifts"),
        pay_frequency: f.take("pay_frequency"),
        benefits: f.take("benefits"),
        benefits_note: f.take("benefits_note"),
        withholding_rate_pct: f.take("withholding_rate_pct"),
        description: f.take("description"),
        wage_basis: f.take("wage_basis"),
        tipped,
        tipped_cash_wage_cents_per_h: tipped === true ? ctx.file.federal_tipped_cash_wage_cents_per_hour : undefined,
        self_employed: f.take("self_employed"),
        fica_exempt: f.take("fica_exempt"),
        estimated_tax_set_aside_pct: f.take("estimated_tax_set_aside_pct"),
        withholding_note: f.take("withholding_note"),
      };
    },
  },

  "economy.regions": {
    id: (node) => (node.kind === "value" ? "us" : undefined),
    row(f, node) {
      const shared = {
        sales_tax_combined_avg_pct: f.take("sales_tax_combined_avg_pct"),
        cost_of_living_multiplier: f.take("cost_of_living_multiplier"),
        median_rent_1br_cents_per_month: f.take("median_rent_1br_cents_per_month"),
        median_rent_2br_cents_per_month: f.take("median_rent_2br_cents_per_month"),
        residential_electricity_cents_per_kwh: f.take("residential_electricity_cents_per_kwh"),
      };
      if (node.kind === "value") {
        return { name: "United States", abbr: "US", scope: "national", ...shared, minimum_wage_cents_per_h: f.take("federal_minimum_wage_cents_per_hour") };
      }
      const abbr = f.take("abbr");
      return {
        name: f.take("name"),
        abbr,
        scope: abbr === "DC" ? "district" : "state",
        census_region: f.take("census_region"),
        census_division: f.take("census_division"),
        time_zones: f.take("time_zones"),
        observes_dst: f.take("observes_dst"),
        state_income_tax_effective_pct: f.take("state_income_tax_effective_pct"),
        local_income_tax_pct_typical: f.take("local_income_tax_pct_typical"),
        ...shared,
        minimum_wage_cents_per_h: f.take("minimum_wage_cents_per_hour"),
        notes: f.take("notes"),
      };
    },
  },

  "economy.finance": {
    row(f, node) {
      const title = FINANCE_TITLES[node.key];
      if (!title) f.fail("source", `finance section "${node.key}" has no title`, "title");
      return { title, values: f.rest() };
    },
  },

  "vehicles.classes": {
    row(f) {
      const consumption = f.sub("consumption");
      const sourceUnit = consumption.take("unit");
      const consumptionUnit = typeof sourceUnit === "string" ? CONSUMPTION_UNITS[sourceUnit] : undefined;
      if (consumptionUnit === undefined) f.fail("unit", `unknown consumption unit ${JSON.stringify(sourceUnit)}`, "consumption_unit");
      const maintenance = f.sub("maintenance");
      const annual = maintenance.take("annual_maintenance_cents_typical");
      const upkeep = Object.fromEntries(Object.entries(maintenance.rest()).filter(([, value]) => value !== null));
      const insurance = f.sub("insurance_cents_per_month");
      const guideRef = f.take("consumption_factors_ref");
      if (typeof guideRef !== "string" || !guideRef.startsWith(GUIDE_PREFIX)) f.fail("ref", `consumption_factors_ref ${JSON.stringify(guideRef)} is not ${GUIDE_PREFIX}<guide>`, "factor_guide");
      return {
        name: f.take("name"),
        domain: f.take("domain"),
        fuel_type: f.take("fuel_type"),
        factor_guide: typeof guideRef === "string" ? guideRef.slice(GUIDE_PREFIX.length) : undefined,
        tank_capacity_gal: f.take("tank_capacity_gal"),
        tank_capacity_l: f.take("tank_capacity_l"),
        usable_battery_kwh: f.take("battery_capacity_kwh_usable"),
        consumption_unit: consumptionUnit,
        consumption: consumption.rest(),
        range_mi: f.take("range_miles_typical"),
        range_h: f.take("range_hours_typical"),
        price_new_cents: f.take("price_new_cents"),
        price_used_cents: f.take("price_used_cents"),
        insurance_liability_cents_per_month: insurance.take("liability_only"),
        insurance_full_cents_per_month: insurance.take("full_coverage"),
        registration_cents_per_year: f.take("registration_cents_per_year"),
        annual_maintenance_cents_per_year: annual,
        maintenance: upkeep,
        passengers: f.take("passengers"),
        cargo_l: f.take("cargo_l"),
        payload_kg: f.take("payload_kg"),
        towing_kg: f.take("towing_kg"),
        charging: f.take("charging"),
        notes: f.take("notes"),
      };
    },
    check(rows, report) {
      for (const [id, row] of Object.entries(rows)) {
        const domain = typeof row.domain === "string" ? row.domain : "";
        const expected = domain === "road" ? (row.fuel_type === "electricity" ? "mi_per_kwh" : "mpg") : "gal_per_h";
        if (row.consumption_unit !== expected) {
          report("unit", `a ${String(row.fuel_type)} ${domain} class consumes in ${expected}, not ${String(row.consumption_unit)}`, { row: id, column: "consumption_unit" });
        }
        const rates = row.consumption;
        const keys = CONSUMPTION_KEYS[domain];
        if (!isRecord(rates) || !keys) continue;
        for (const key of keys) {
          const rate = rates[key];
          if (typeof rate !== "number" || !(rate > 0)) report("type", `consumption.${key} must be a positive number`, { row: id, column: "consumption" });
        }
        for (const key of Object.keys(rates)) {
          if (!keys.includes(key) && key !== "note") report("column", `consumption.${key} is not a ${domain} rate`, { row: id, column: "consumption" });
        }
      }
    },
  },

  "vehicles.factors": {
    row(f) {
      return { basis: f.take("basis"), note: f.take("ev_note") ?? f.take("note"), factors: f.rest() };
    },
    check(rows, report) {
      for (const [id, row] of Object.entries(rows)) {
        const factors = row.factors;
        if (!isRecord(factors)) continue;
        for (const [key, value] of Object.entries(factors)) {
          if (typeof value !== "number" || !(value >= 0)) report("unit", `factor ${key} must be a multiplier >= 0, got ${JSON.stringify(value)}`, { row: id, column: "factors" });
        }
      }
    },
  },

  "gear.items": {
    row(f) {
      return {
        name: f.take("name"),
        category: f.take("category"),
        equip_slot: f.take("equip_slot"),
        weight_g: f.take("weight_g"),
        volume_l: f.take("volume_l"),
        price_cents: f.take("price_cents"),
        notes: f.take("notes"),
      };
    },
  },

  "gear.containers": {
    row(f) {
      return {
        name: f.take("name"),
        capacity_l: f.take("capacity_l"),
        max_load_kg: f.take("max_load_kg"),
        empty_weight_g: f.take("empty_weight_g"),
        location: f.take("location"),
        equip_slot: f.take("equip_slot"),
        price_cents: f.take("price_cents"),
        notes: f.take("notes"),
      };
    },
  },

  "gear.kits": {
    row(f) {
      return {
        name: f.take("name"),
        recommended_container: f.take("recommended_container_id"),
        description: f.take("description"),
        piece_count: f.take("piece_count"),
        pieces_total_weight_g: f.take("pieces_total_weight_g"),
        packed_volume_l: f.take("packed_volume_l"),
        price_cents: f.take("price_cents"),
        pieces: f.take("pieces"),
        notes: f.take("notes"),
      };
    },
    check(rows, report) {
      if (!Object.hasOwn(rows, "mechanic_toolbox_45")) report("sum", "kit mechanic_toolbox_45 is missing");
      for (const [id, row] of Object.entries(rows)) {
        const where = { row: id, column: "pieces" };
        if (!Array.isArray(row.pieces)) continue;
        let count = 0;
        let grams = 0;
        for (const piece of row.pieces) {
          const qty = isRecord(piece) ? piece.qty : undefined;
          const each = isRecord(piece) ? piece.weight_g_each : undefined;
          if (!isRecord(piece) || typeof piece.name !== "string" || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || typeof each !== "number" || !(each >= 0)) {
            report("type", `a piece must be {name, qty >= 1 (integer), weight_g_each >= 0}, got ${JSON.stringify(piece)}`, where);
            continue;
          }
          count += qty;
          grams += qty * each;
        }
        if (count !== row.piece_count) report("sum", `pieces sum to ${count}, piece_count says ${JSON.stringify(row.piece_count)}`, where);
        if (typeof row.pieces_total_weight_g === "number" && Math.abs(grams - row.pieces_total_weight_g) > 0.01) {
          report("sum", `pieces weigh ${grams} g, pieces_total_weight_g says ${row.pieces_total_weight_g}`, where);
        }
        if (id === "mechanic_toolbox_45" && count !== 45) report("sum", `mechanic_toolbox_45 must have exactly 45 pieces, has ${count}`, where);
      }
    },
  },

  "gear.slots": {
    row(f) {
      return { description: f.take("description") };
    },
  },

  "calendar.holidays": {
    row(f) {
      return {
        name: f.take("name"),
        ...ruleColumns(f.sub("rule")),
        federal_paid_day_off: f.take("federal_paid_day_off"),
        private_sector_paid_day_off: f.take("private_sector_paid_day_off"),
        observed_if_weekend: f.take("observed_if_weekend"),
      };
    },
    check: checkRules,
  },

  "calendar.observances": {
    row(f) {
      return { name: f.take("name"), ...ruleColumns(f.sub("rule")) };
    },
    check: checkRules,
  },

  "calendar.dst": {
    id: () => "us",
    row(f, _node, ctx) {
      return {
        start: f.take("start"),
        end: f.take("end"),
        duration_weeks_approx: f.take("duration_weeks_approx"),
        exceptions: f.take("exceptions"),
        standard_offsets_h: f.take("time_zone_offsets_standard_hours"),
        note: f.take("note"),
        daylight_hours: ctx.file.daylight_hours_geometric,
      };
    },
  },

  "calendar.school": {
    row(f, node) {
      const title = SCHOOL_TITLES[node.key];
      if (!title) f.fail("source", `school-year section "${node.key}" has no title`, "title");
      return { title, values: f.rest() };
    },
  },

  "calendar.work": {
    id: () => "us",
    row(f) {
      const leave = f.sub("paid_time_off_typical");
      return {
        full_time_hours_per_week: f.take("full_time_hours_per_week"),
        standard_work_year_h: f.take("standard_work_year_hours"),
        overtime: f.take("overtime"),
        vacation_days_after_1_year: leave.take("vacation_days_after_1_year"),
        vacation_days_after_5_years: leave.take("vacation_days_after_5_years"),
        vacation_days_after_10_years: leave.take("vacation_days_after_10_years"),
        sick_days_per_year: leave.take("sick_days_per_year"),
        paid_time_off_note: leave.take("note"),
        paid_holidays_per_year: f.take("paid_holidays_private_industry_typical_per_year"),
        meal_break: f.take("meal_break"),
      };
    },
  },

  "calendar.shifts": {
    row(f) {
      return {
        name: f.take("name"),
        description: f.take("description"),
        days_per_week: f.take("days_per_week"),
        typical_start: f.take("typical_start"),
        typical_shift_h: f.take("typical_shift_hours"),
        typical_hours_per_week: f.take("typical_hours_per_week"),
        weekend_work: f.take("weekend_work"),
        notes: f.take("notes"),
      };
    },
  },
};
