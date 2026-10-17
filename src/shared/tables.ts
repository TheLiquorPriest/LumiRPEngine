// Pinned world data tables (DESIGN §4.1, §9.2, §9.7; ARCHITECTURE §6).
//
// A table is typed rows plus a revision. Packs ship default tables generated from the raw
// sources in `data-src/` by `scripts/tables/build.ts`. A world revision copies every table it
// uses into the document and pins its revision, so a running chat never sees a table change
// except through Upgrade (a `migrate` marker).

import type { JsonValue } from "./json";
import type { PackId, TableId } from "./ids";

/** Units used by numeric columns. Money is always integer cents. */
export type TableUnit =
  | "cents"
  | "cents_per_gal"
  | "cents_per_kwh"
  | "cents_per_month"
  | "cents_per_h"
  | "cents_per_year"
  | "pct"
  | "multiplier"
  | "g"
  | "kg"
  | "l"
  | "gal"
  | "kwh"
  | "mpg"
  | "mi_per_kwh"
  | "gal_per_h"
  | "mi"
  | "h"
  | "min"
  | "day"
  | "week";

/** An ordered band, `min ≤ typical ≤ max` (data-src convention). */
export interface Band {
  min: number;
  typical: number;
  max: number;
}

export type ColumnType = "int" | "number" | "text" | "bool" | "band" | "enum" | "ref" | "list" | "json";

export interface ColumnDef {
  type: ColumnType;
  /** For `list`, the unit of each element (e.g. maintenance intervals in `mi`). */
  unit?: TableUnit;
  /** Allowed values for `enum`. */
  values?: string[];
  /** Target table for `ref` (row id) and for `list` of refs. */
  ref?: TableId;
  /** Element type for `list`. */
  of?: Exclude<ColumnType, "list">;
  optional?: boolean;
  doc?: string;
}

export type TableRow = Record<string, JsonValue>;

/** Where a default table came from. Absent on author-made tables. */
export interface TableSource {
  /** The default data pack, e.g. `modern-us` (D26). */
  dataPack: string;
  /** Source file under `data-src/`, e.g. `us/prices.json`. */
  file: string;
  /** The source file's `schema` string, e.g. `lre-data-src/us/prices/v1`. */
  sourceSchema: string;
  reflectsPeriod: string;
  approximate: boolean;
  /** The source's `basis`: a sentence, or one per aspect (regions, occupations and vehicles use objects). */
  basis: string | Record<string, string>;
}

export interface DataTable {
  id: TableId;
  /** Owning pack. */
  pack: PackId;
  /** `lre-table/<tableId>/v<n>`: the row shape version the pack reads. */
  schema: string;
  /** `hashJson({schema, columns, rows})`. Computed, never authored. */
  revision: string;
  label: string;
  source?: TableSource;
  columns: Record<string, ColumnDef>;
  /** Rows keyed by stable row id. */
  rows: Record<string, TableRow>;
}

/** Build-time mapping from one raw source to one pinned table (scripts/tables). */
export interface TableMapping {
  table: TableId;
  pack: PackId;
  schema: string;
  file: string;
  /** JSON path of the source array or object inside the file, e.g. `categories[].items[]`. */
  from: string;
  columns: Record<string, ColumnDef>;
}

/** A table row as a choice: its id, and its `label` cell when it has one, else the id in words. */
export interface TableChoice {
  key: string;
  label: string;
}

/** The rows a param naming a row of `table` may name (DESIGN §11), in row order; none without the table. */
export function tableChoices(table: DataTable | undefined): TableChoice[] {
  if (!table || typeof table.rows !== "object" || table.rows === null) return [];
  return Object.entries(table.rows).map(([key, row]) => {
    // Rows come from authored JSON: anything but a row with a text label reads as its id.
    const label: unknown = typeof row === "object" && row !== null && !Array.isArray(row) ? row.label : undefined;
    return { key, label: typeof label === "string" && label.trim() !== "" ? label : key.replace(/_/g, " ") };
  });
}

/** The row a player's or a helper's words name: its id, or its label in any case; null when none does. */
export function tableRowKey(table: DataTable | undefined, text: string): string | null {
  const said = text.trim().toLowerCase();
  const hit = tableChoices(table).find((c) => c.key.toLowerCase() === said || c.label.toLowerCase() === said);
  return hit ? hit.key : null;
}
