// Validation of mappings and built rows: column types, units, ordered bands, references.
// Everything reports through `Report`; nothing throws, so one build surfaces every problem.

import { isRecord } from "../../src/shared/json";
import type { JsonValue } from "../../src/shared/json";
import type { ColumnDef, TableMapping, TableRow, TableUnit } from "../../src/shared/tables";
import type { Issue, Report, Where } from "./issues";

/** Units whose values are whole numbers (money is integer cents; electricity may be decimal cents). */
const INTEGER_UNITS: readonly TableUnit[] = ["cents", "cents_per_gal", "cents_per_month", "cents_per_h", "cents_per_year"];

/** The unit a numeric column's name implies by its suffix; the longest matching suffix wins. */
const NAME_UNITS: Record<string, TableUnit> = {
  _cents_per_month: "cents_per_month",
  _cents_per_year: "cents_per_year",
  _cents_per_gal: "cents_per_gal",
  _cents_per_kwh: "cents_per_kwh",
  _cents_per_h: "cents_per_h",
  _cents: "cents",
  _pct: "pct",
  _multiplier: "multiplier",
  _kwh: "kwh",
  _gal: "gal",
  _kg: "kg",
  _days: "day",
  _mi: "mi",
  _g: "g",
  _l: "l",
  _h: "h",
};
const SUFFIXES = Object.keys(NAME_UNITS).sort((a, b) => b.length - a.length);

/** One reference found in a row, resolved once every table exists. */
export interface RefUse {
  table: string;
  row: string;
  column: string;
  target: string;
  id: string;
}

function elementType(def: ColumnDef): ColumnDef["type"] | undefined {
  return def.type === "list" ? def.of : def.type;
}

function isNumeric(def: ColumnDef): boolean {
  const type = elementType(def);
  return type === "int" || type === "number" || type === "band";
}

/** The column as one list element sees it. */
function elementOf(def: ColumnDef): ColumnDef {
  return { type: def.of ?? "json", unit: def.unit, values: def.values, ref: def.ref };
}

export function validateMapping(mapping: TableMapping, tableIds: readonly string[], report: Report): void {
  if (!mapping.table.startsWith(`${mapping.pack}.`) || mapping.table.length === mapping.pack.length + 1) {
    report("column", `table id "${mapping.table}" must be "${mapping.pack}.<name>"`);
  }
  if (!new RegExp(`^lre-table/${mapping.table.replaceAll(".", "\\.")}/v[1-9]\\d*$`).test(mapping.schema)) {
    report("column", `schema "${mapping.schema}" must be lre-table/${mapping.table}/v<n>`);
  }
  for (const [name, def] of Object.entries(mapping.columns)) {
    const where = { column: name };
    const type = elementType(def);
    if (def.type === "list" && !def.of) report("column", "a list column needs `of`", where);
    if (def.unit && !isNumeric(def)) report("unit", `unit ${def.unit} on a non-numeric ${type} column`, where);
    if (def.unit && INTEGER_UNITS.includes(def.unit) && type === "number") report("unit", `${def.unit} is whole cents: use int or band, not number`, where);
    const suffix = isNumeric(def) ? SUFFIXES.find((s) => name.endsWith(s)) : undefined;
    if (suffix && NAME_UNITS[suffix] !== def.unit) report("unit", `a "${name}" column carries ${NAME_UNITS[suffix]}, declared ${def.unit ?? "no unit"}`, where);
    if (type === "enum" ? !def.values?.length : def.values) report("column", "`values` belong to enum columns (and only those)", where);
    if (type === "ref" ? !def.ref : def.ref) report("column", "`ref` belongs to ref columns (and only those)", where);
    if (def.ref && !tableIds.includes(def.ref)) report("ref", `references unknown table ${def.ref}`, where);
  }
}

interface Check {
  table: string;
  report: Report;
  refs: RefUse[];
}

/** Validates every row of a table against its columns and collects its references. */
export function validateRows(table: string, columns: Record<string, ColumnDef>, rows: Record<string, TableRow>, report: Report, refs: RefUse[]): void {
  const check: Check = { table, report, refs };
  for (const [id, row] of Object.entries(rows)) {
    for (const key of Object.keys(row)) {
      if (!Object.hasOwn(columns, key)) report("column", `row has no declared column "${key}"`, { row: id, column: key });
    }
    for (const [name, def] of Object.entries(columns)) {
      const value = row[name];
      if (value === undefined) {
        if (!def.optional) report("column", "required column is missing", { row: id, column: name });
      } else {
        checkValue(def, value, { row: id, column: name }, check);
      }
    }
  }
}

function checkNumber(value: JsonValue, def: ColumnDef, at: Where, check: Check): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    check.report("type", `expected a finite number, got ${JSON.stringify(value)}`, at);
    return false;
  }
  if (def.unit && INTEGER_UNITS.includes(def.unit) && !Number.isInteger(value)) {
    check.report("unit", `${value} is not whole ${def.unit}`, at);
  }
  return true;
}

function checkValue(def: ColumnDef, value: JsonValue, at: Where, check: Check): void {
  const { report } = check;
  switch (def.type) {
    case "int":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) report("type", `expected an integer, got ${JSON.stringify(value)}`, at);
      else checkNumber(value, def, at, check);
      return;
    case "number":
      checkNumber(value, def, at, check);
      return;
    case "text":
      if (typeof value !== "string") report("type", `expected text, got ${JSON.stringify(value)}`, at);
      return;
    case "bool":
      if (typeof value !== "boolean") report("type", `expected true or false, got ${JSON.stringify(value)}`, at);
      return;
    case "enum":
      if (typeof value !== "string" || !def.values?.includes(value)) report("type", `${JSON.stringify(value)} is not one of ${(def.values ?? []).join(", ")}`, at);
      return;
    case "ref":
      if (typeof value !== "string" || !def.ref) report("type", `expected a row id, got ${JSON.stringify(value)}`, at);
      else check.refs.push({ table: check.table, row: at.row ?? "", column: at.column ?? "", target: def.ref, id: value });
      return;
    case "band": {
      if (!isRecord(value) || Object.keys(value).sort().join() !== "max,min,typical") {
        report("type", `expected {min, typical, max}, got ${JSON.stringify(value)}`, at);
        return;
      }
      const { min, typical, max } = value;
      const ok = [min, typical, max].map((member) => checkNumber(member, def, at, check));
      if (ok.every(Boolean) && !(Number(min) <= Number(typical) && Number(typical) <= Number(max))) {
        report("band", `band must satisfy min <= typical <= max, got ${min}, ${typical}, ${max}`, at);
      }
      return;
    }
    case "list":
      if (!Array.isArray(value)) report("type", `expected a list, got ${JSON.stringify(value)}`, at);
      else value.forEach((element) => checkValue(elementOf(def), element, at, check));
      return;
    case "json":
      checkJson(value, "", null, at, report);
  }
}

/** Number context a key sets for everything under it. */
function contextOf(key: string): "cents" | "pct" | null {
  const tokens = key.split("_");
  if (tokens.includes("pct")) return "pct";
  return tokens.includes("cents") && !tokens.includes("kwh") ? "cents" : null;
}

const ORDER = ["min", "typical", "max"] as const;

/**
 * Walks a free-form JSON column. Under a key with a `cents` token every number is a whole
 * number; any object with `min`, `typical` or `max` numbers is ordered; numbers are finite.
 */
function checkJson(value: JsonValue, path: string, unit: "cents" | "pct" | null, at: Where, report: Report): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) report("type", `${path || "value"} is not finite`, at);
    else if (unit === "cents" && !Number.isInteger(value)) report("unit", `${path} is ${value}; cents are whole numbers`, at);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => checkJson(item, `${path}[${index}]`, unit, at, report));
  } else if (isRecord(value)) {
    const present = ORDER.filter((key) => typeof value[key] === "number").map((key) => Number(value[key]));
    if (present.some((n, index) => index > 0 && n < present[index - 1])) report("band", `${path || "value"}: min <= typical <= max is violated (${present.join(", ")})`, at);
    for (const [key, child] of Object.entries(value)) {
      checkJson(child, path ? `${path}.${key}` : key, contextOf(key) ?? unit, at, report);
    }
  }
}

/** Resolves every collected reference against the built tables. */
export function validateRefs(tables: Record<string, Record<string, TableRow>>, uses: readonly RefUse[], issues: Issue[]): void {
  for (const use of uses) {
    const target = tables[use.target];
    if (target === undefined || !Object.hasOwn(target, use.id)) {
      const why = target === undefined ? `table ${use.target} is not part of the build` : `no row "${use.id}" in ${use.target}`;
      issues.push({ table: use.table, row: use.row, column: use.column, rule: "ref", message: why });
    }
  }
}
