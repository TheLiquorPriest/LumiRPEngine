// Pinned world data tables (DESIGN §4.1, §9.2, §9.7; ARCHITECTURE §6).
//
// A table is typed rows plus a revision. Packs ship default tables generated from the raw
// sources in `data-src/` by `scripts/tables/build.ts`. A world revision copies every table it
// uses into the document and pins its revision, so a running chat never sees a table change
// except through Upgrade (a `migrate` marker). The build also records every revision a table has
// shipped as (`ShippedRevision`), so Build can offer a world the newer ones (Data updates).

import { hashJson } from "./hash";
import type { JsonValue } from "./json";
import { isRecord } from "./json";
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

/**
 * One revision a pack's default table has shipped as, oldest first in `TableDef.shipped` (ARCHITECTURE
 * §6): the table build records each one, so a world's copy can be told apart as one it never changed
 * and one it did (`engine/table-updates.ts`). `columns` holds each column's print (`tablePrint`).
 * Every revision but the last also says how the next one differs from it: `changed`, the rows the
 * next revision changes or drops, each with its print at this revision, and `added`, the rows the
 * next one adds. The last revision's rows are the table as it ships.
 */
export interface ShippedRevision {
  revision: string;
  columns: Record<string, string>;
  changed?: Record<string, string>;
  added?: string[];
}

/**
 * A starter world's own version of a pack's table (`src/packs/starters/tables.ts`): one its template
 * swaps in for the pack's Modern US one (Brindlemere's and Harrowmere's prices, categories, items and
 * vehicle classes), with every revision it has shipped as, oldest first, the last being `table`
 * itself (the template build's record), so a world made from the starter is offered the newer
 * versions of its copies as a world made on the packs' own tables is (Data updates).
 */
export interface StarterTable {
  /** The starter's template id (`fantasy_town`), and its name as Build's template picker shows it. */
  starter: { id: string; name: string };
  table: DataTable;
  shipped: readonly ShippedRevision[];
}

/** A short fingerprint of a row or a column contract: the first 8 hex digits of its `hashJson`. */
export function tablePrint(value: unknown): string {
  return hashJson(value).slice(0, 8);
}

/** A table's revision worked out from its content, `hashJson({schema, columns, rows})`, whatever its own `revision` says. */
export function tableRevision(table: Pick<DataTable, "schema" | "columns" | "rows">): string {
  return hashJson({ schema: table.schema, columns: table.columns, rows: table.rows });
}

/** Whether a value read from a document has a table's shape: a schema, and columns and rows as objects. */
export function isDataTable(value: unknown): value is DataTable {
  return isRecord(value) && typeof value.schema === "string" && isRecord(value.columns) && isRecord(value.rows);
}

/** Each row's print, by row id. */
export function rowPrints(rows: Readonly<Record<string, TableRow>>): Map<string, string> {
  return new Map(Object.entries(rows).map(([id, row]) => [id, tablePrint(row)]));
}

/** Each column's print, by column id. */
export function columnPrints(columns: Readonly<Record<string, ColumnDef>>): Map<string, string> {
  return new Map(Object.entries(columns).map(([id, column]) => [id, tablePrint(column)]));
}

/** How the rows `next` has differ from the rows `prev` has, as `prev`'s history entry records it: the rows `next` changes or drops, with their prints in `prev`, and the rows `next` adds. */
export function shippedDelta(prev: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): Pick<ShippedRevision, "changed" | "added"> {
  const changed: Record<string, string> = {};
  for (const [id, print] of prev) if (next.get(id) !== print) changed[id] = print;
  const added = [...next.keys()].filter((id) => !prev.has(id));
  return { ...(Object.keys(changed).length > 0 ? { changed } : {}), ...(added.length > 0 ? { added } : {}) };
}

/** Every shipped revision's row prints, oldest first: the last revision's are `current` (the table as it ships), and each earlier one's comes back through its delta. */
export function shippedRowPrints(history: readonly ShippedRevision[], current: ReadonlyMap<string, string>): Map<string, string>[] {
  const out: Map<string, string>[] = [];
  let rows = new Map(current);
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry && i < history.length - 1) {
      const added = new Set(entry.added ?? []);
      rows = new Map([...rows].filter(([id]) => !added.has(id)));
      for (const [id, print] of Object.entries(entry.changed ?? {})) rows.set(id, print);
    }
    out[i] = rows;
  }
  return out;
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
