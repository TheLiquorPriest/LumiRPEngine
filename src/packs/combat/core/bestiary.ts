// The bestiary the combat pack registers (plan §6.5, "Enemies"): a data table of the world's rules, shipped
// with no rows, so every world has it and Build's table editor lists it beside the others. Ordinary foes and
// strangers the world's rules know, for the GM to read and to draw someone from who comes into view with no sheet.

import { hashJson } from "../../../shared/hash";
import type { ColumnDef, DataTable } from "../../../shared/tables";

/** The table's id in a world's `tables`. */
export const BESTIARY_TABLE = "combat.bestiary";

/** The row shape version the bestiary is read at. */
export const BESTIARY_SCHEMA = "lre-table/combat.bestiary/v1";

/** Its columns: what each row of the bestiary holds. */
export const BESTIARY_COLUMNS: Record<string, ColumnDef> = {
  name: { type: "text" },
  kind: { type: "text" },
  tier: { type: "text", optional: true },
  fields: { type: "json" },
  carries: { type: "list", of: "text", optional: true },
  description: { type: "text", optional: true },
};

/** The table as the pack ships it: no rows. */
export function emptyBestiary(): DataTable {
  const rows = {};
  return { id: BESTIARY_TABLE, pack: "combat", schema: BESTIARY_SCHEMA, revision: hashJson({ schema: BESTIARY_SCHEMA, columns: BESTIARY_COLUMNS, rows }), label: "Bestiary", columns: BESTIARY_COLUMNS, rows };
}
