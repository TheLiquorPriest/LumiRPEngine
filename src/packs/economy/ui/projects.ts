// The production projects' templates Build offers (DESIGN §26.5): the world's own `economy.projects`
// table, else the one the economy ships, so a world made before the table shipped still starts
// projects from it, as play does. The orgs UI's Build part is handed them by its host.

import { isRecord, type JsonObject } from "../../../shared/json";
import { PROJECTS_TABLE } from "../../../shared/projects";
import type { WorldDoc } from "../../../shared/world";
import shipped from "../core/tables/modern-us/projects.json";

/** The templates a world's Build offers, by id: its own table's rows, else the shipped ones. */
export function projectTemplatesOf(doc: WorldDoc): Record<string, JsonObject> {
  const own = doc.tables[PROJECTS_TABLE]?.rows;
  if (own) return own;
  const table: unknown = shipped;
  return isRecord(table) && isRecord(table.rows) ? (table.rows as Record<string, JsonObject>) : {};
}
