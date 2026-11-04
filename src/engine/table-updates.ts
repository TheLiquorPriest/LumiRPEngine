// Data updates (DESIGN §9.2, ARCHITECTURE §6): how a world's copies of the packs' default tables
// stand against the versions this build ships: the packs' own (`TableDef.shipped`), and a starter
// world's own version of a table (`StarterTable`: Brindlemere's and Harrowmere's prices, items and
// vehicle classes), each a line of revisions. A copy whose content is an earlier revision of a line
// was never changed, so that line's current version may replace it with nothing lost; a table the
// world lacks shipped after the world was made. Any other copy was changed: from the revision of any
// line it shares most rows with, row for row, when that is at least half of its rows, and then only a
// newer revision of that line is worth telling, and only the owner may take it. A copy that shares
// less with every revision (a table rewritten, a template's own prices it no longer ships) is the
// world's own, and nothing is newer than it.

import type { TableId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import type { TableNames, TableRowChanges, TableUpdate } from "../shared/protocol";
import type { DataTable, ShippedRevision, StarterTable, TableRow } from "../shared/tables";
import { columnPrints, isDataTable, rowPrints, shippedRowPrints, tableRevision } from "../shared/tables";
import type { WorldDoc } from "../shared/world";
import type { TableDef } from "./registry";

/** How many rows of each kind a change names; the rest are only counted. */
export const TABLE_NAMES_CAP = 12;

/** A shipped table's history as this build can read it: each revision with its row prints, oldest first. */
interface Shipped {
  history: readonly ShippedRevision[];
  rows: readonly ReadonlyMap<string, string>[];
  columns: ReadonlyMap<string, string>;
}

/** One line of a table's shipped versions: the version it ships as now, its history, and the starter whose own it is (none for the packs'). */
interface Line {
  table: DataTable;
  shipped: Shipped;
  starter?: StarterTable["starter"];
}

/** The registry's tables and the starters' are frozen, so each one's history is read once. */
const READ = new WeakMap<object, Shipped>();

/** A history that doesn't end at the table it ships with can't be read back, so it counts as none. */
function shippedOf(key: TableDef | StarterTable, recorded: readonly ShippedRevision[] | undefined, table: DataTable): Shipped {
  const known = READ.get(key);
  if (known) return known;
  const all = recorded ?? [];
  const history = all[all.length - 1]?.revision === table.revision ? all : [];
  const read: Shipped = { history, rows: shippedRowPrints(history, rowPrints(table.rows)), columns: columnPrints(table.columns) };
  READ.set(key, read);
  return read;
}

/** A row's name, as Build's table editor shows it: its `label` or `name` cell, else its id in words. */
function rowName(rows: readonly Readonly<Record<string, TableRow>>[], id: string): string {
  for (const table of rows) {
    const row = hasOwn(table, id) ? table[id] : undefined;
    for (const key of ["label", "name"]) {
      const cell = isRecord(row) ? row[key] : undefined;
      if (typeof cell === "string" && cell.trim() !== "") return cell;
    }
  }
  return id.replace(/_/g, " ");
}

/** How the rows `to` has differ from those `from` has, each named from `names` (the first table holding it). */
function rowChanges(from: ReadonlyMap<string, string>, to: ReadonlyMap<string, string>, names: readonly Readonly<Record<string, TableRow>>[]): TableRowChanges {
  const named = (ids: readonly string[]): TableNames => ({ count: ids.length, names: ids.slice(0, TABLE_NAMES_CAP).map((id) => rowName(names, id)) });
  return {
    added: named([...to.keys()].filter((id) => !from.has(id))),
    changed: named([...to.keys()].filter((id) => from.has(id) && from.get(id) !== to.get(id))),
    dropped: named([...from.keys()].filter((id) => !to.has(id))),
  };
}

/** How the columns `to` has differ from those a revision had, by id. */
function columnChanges(from: Readonly<Record<string, string>>, to: ReadonlyMap<string, string>): TableUpdate["shipped"]["columns"] {
  const was = new Map(Object.entries(from));
  return { added: [...to.keys()].filter((id) => !was.has(id)), changed: [...to.keys()].filter((id) => was.has(id) && was.get(id) !== to.get(id)), dropped: [...was.keys()].filter((id) => !to.has(id)) };
}

/**
 * The shipped revision of a line a changed copy most likely started from: its index, the one sharing
 * most of the copy's rows as they shipped, then the one with its columns, then the older, and how many
 * rows it shares. None unless it shares at least half of the copy's rows.
 */
function likelyBase(shipped: Shipped, rows: ReadonlyMap<string, string>, columns: ReadonlyMap<string, string>): { index: number; shared: number } | null {
  let best = -1;
  let bestShared = 0;
  let bestColumns = false;
  for (let index = 0; index < shipped.rows.length; index++) {
    const revision = shipped.rows[index];
    if (!revision) continue;
    let shared = 0;
    for (const [id, print] of rows) if (revision.get(id) === print) shared++;
    const own = Object.entries(shipped.history[index]?.columns ?? {});
    const sameColumns = own.length === columns.size && own.every(([id, print]) => columns.get(id) === print);
    if (best < 0 || shared > bestShared || (shared === bestShared && sameColumns && !bestColumns)) {
      best = index;
      bestShared = shared;
      bestColumns = sameColumns;
    }
  }
  return best >= 0 && bestShared > 0 && bestShared * 2 >= rows.size ? { index: best, shared: bestShared } : null;
}

/**
 * A copy's update from the line and revision it is at (an update) or likely came from (edited, with
 * the copy's own `rows`): what that line's current version changes since then, and for an edited
 * copy what the world changed, each row named from the table first holding it.
 */
function updateOf(head: Pick<TableUpdate, "table" | "label" | "pack">, line: Line, index: number, copy: DataTable, rows?: ReadonlyMap<string, string>): TableUpdate {
  const base = line.shipped.rows[index] ?? new Map<string, string>();
  const current = line.shipped.rows[line.shipped.rows.length - 1] ?? rowPrints(line.table.rows);
  return {
    ...head,
    status: rows ? "edited" : "update",
    ...(line.starter ? { starter: line.starter } : {}),
    shipped: { ...rowChanges(base, current, [line.table.rows, copy.rows]), columns: columnChanges(line.shipped.history[index]?.columns ?? {}, line.shipped.columns) },
    ...(rows ? { yours: rowChanges(base, rows, [copy.rows, line.table.rows]) } : {}),
  };
}

/**
 * Every data table this build ships newer than the world's copy, in the registry's order (see the
 * header), each from the line it came from: the packs' own, or a starter's (`starter`). A missing one,
 * the packs' version, only when the world keeps some of the shipped tables, since a world that keeps
 * none of them plays without the shipped data.
 */
export function tableUpdates(world: Pick<WorldDoc, "tables">, tables: ReadonlyMap<TableId, TableDef>, starters: readonly StarterTable[] = []): TableUpdate[] {
  const kept: Readonly<Record<string, unknown>> = isRecord(world.tables) ? world.tables : {};
  const keepsShipped = [...tables.values()].some((def) => def.defaults !== null && hasOwn(kept, def.id));
  const out: TableUpdate[] = [];
  for (const def of tables.values()) {
    const table = def.defaults;
    if (!table) continue;
    const head = { table: def.id, label: table.label, pack: table.pack };
    if (!hasOwn(kept, def.id)) {
      if (keepsShipped) out.push({ ...head, status: "missing", shipped: { ...rowChanges(new Map(), rowPrints(table.rows), [table.rows]), columns: { added: [], changed: [], dropped: [] } } });
      continue;
    }
    const copy = kept[def.id];
    // A copy that isn't a table is lint's to report; one at a version that ships now has nothing newer.
    if (!isDataTable(copy)) continue;
    const at = tableRevision(copy);
    const lines: Line[] = [{ table, shipped: shippedOf(def, def.shipped, table) }, ...starters.filter((s) => s.table.id === def.id).map((s) => ({ table: s.table, shipped: shippedOf(s, s.shipped, s.table), starter: s.starter }))];
    if (lines.some((line) => line.table.revision === at)) continue;
    const exact = lines.flatMap((line) => {
      const index = line.shipped.history.findIndex((r) => r.revision === at);
      return index >= 0 ? [{ line, index }] : [];
    })[0];
    if (exact) {
      out.push(updateOf(head, exact.line, exact.index, copy));
      continue;
    }
    const rows = rowPrints(copy.rows);
    const columns = columnPrints(copy.columns);
    // Of every line's likely base, the one sharing most rows; the packs' own first on a tie.
    let best: { line: Line; index: number; shared: number } | null = null;
    for (const line of lines) {
      const base = likelyBase(line.shipped, rows, columns);
      if (base && (!best || base.shared > best.shared)) best = { line, ...base };
    }
    if (best && best.index < best.line.shipped.history.length - 1) out.push(updateOf(head, best.line, best.index, copy, rows));
  }
  return out;
}

/**
 * The version Data updates puts in place of a world's copy of a table (`lre.editor shipped`): the
 * current version of the line its update comes from (a starter's own, else the packs'), and for a
 * table with none, the packs' as it ships; null for a table no pack ships.
 */
export function shippedVersion(world: Pick<WorldDoc, "tables">, tables: ReadonlyMap<TableId, TableDef>, starters: readonly StarterTable[], id: TableId): DataTable | null {
  const update = tableUpdates(world, tables, starters).find((u) => u.table === id);
  const starter = update?.starter;
  return (starter ? starters.find((s) => s.table.id === id && s.starter.id === starter.id)?.table : undefined) ?? tables.get(id)?.defaults ?? null;
}
