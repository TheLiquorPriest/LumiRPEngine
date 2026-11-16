// The bestiary (plan §6.5, the ruleset-and-sheets skill): ordinary foes and strangers the world's
// rules know, for the GM to read and to draw someone from who comes into view with no sheet. It is
// a data table of the world's rules, as its other tables are (`DataTable`, in the world document's
// `tables`), which the combat pack registers (`packs/combat/core/bestiary.ts`), empty. Code reads it and
// copies a row's values onto someone made from it; which row fits a stranger is the GM's to say.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { BESTIARY_TABLE } from "../packs/combat/core/bestiary";
import type { TableRow } from "../shared/tables";
import type { RulesetDef, WorldDoc } from "../shared/world";

export { BESTIARY_COLUMNS, BESTIARY_SCHEMA, BESTIARY_TABLE } from "../packs/combat/core/bestiary";

/** One row of the bestiary: someone ordinary of a kind, with the sheet values the world's rules give them. */
export interface BestiaryRow {
  id: string;
  name: string;
  kind: string;
  tier?: string;
  fields: JsonObject;
  carries: string[];
  description?: string;
}

function rowOf(id: string, row: TableRow): BestiaryRow | null {
  const name = typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : null;
  const kind = typeof row.kind === "string" && row.kind.trim() !== "" ? row.kind.trim() : null;
  if (name === null || kind === null) return null;
  const fields = typeof row.fields === "object" && row.fields !== null && !Array.isArray(row.fields) ? (row.fields as JsonObject) : {};
  const carries = Array.isArray(row.carries) ? row.carries.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  return { id, name, kind, fields, carries, ...(typeof row.tier === "string" && row.tier !== "" ? { tier: row.tier } : {}), ...(typeof row.description === "string" && row.description !== "" ? { description: row.description } : {}) };
}

/** The world's bestiary, in its table's order; empty when the world has none. A row with no name or kind is passed over. */
export function bestiaryOf(world: Pick<WorldDoc, "tables">): BestiaryRow[] {
  const table = world.tables[BESTIARY_TABLE];
  if (table === undefined) return [];
  return Object.entries(table.rows).flatMap(([id, row]) => rowOf(id, row) ?? []);
}

/** A row by its id, or by its name in any case. */
export function bestiaryRow(world: Pick<WorldDoc, "tables">, said: string): BestiaryRow | undefined {
  const rows = bestiaryOf(world);
  const lower = said.trim().toLowerCase();
  return rows.find((r) => r.id === said.trim()) ?? rows.find((r) => r.id.toLowerCase() === lower || r.name.toLowerCase() === lower);
}

/** The world's ruleset part as data, its bestiary with it: what the GM reads to rule by. */
export function rulesetData(world: Pick<WorldDoc, "ruleset" | "tables" | "checks" | "actions">): JsonObject {
  const ruleset: RulesetDef = world.ruleset ?? {};
  return {
    ...(JSON.parse(JSON.stringify(ruleset)) as JsonObject),
    checks: Object.keys(world.checks) as JsonValue,
    actions: Object.keys(world.actions) as JsonValue,
    bestiary: bestiaryOf(world).map((r) => ({ ...r }) as unknown as JsonValue),
  };
}
