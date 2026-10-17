// Builds the pinned Modern US data tables from `data-src/us/*.json` (ARCHITECTURE §6, D26).
//
//   bun scripts/tables/build.ts          (package script: `bun run tables`)
//
// Each mapping in mappings.ts selects records from one source file; each row builder in rows.ts
// shapes them into the declared columns; validate.ts checks types, units, bands and references;
// the table's revision is `hashJson({schema, columns, rows})`. Output goes to
// `src/packs/<pack>/core/tables/modern-us/<table>.json`, generated and committed. Nothing in
// `src/` imports `data-src/`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hashJson } from "../../src/shared/hash";
import { isRecord } from "../../src/shared/json";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { DataTable, TableMapping, TableRow, TableSource } from "../../src/shared/tables";
import { TableBuildError, reporter } from "./issues";
import type { Issue, Report } from "./issues";
import { DATA_PACK, LABELS, MAPPINGS } from "./mappings";
import { ROW_SPECS } from "./rows";
import type { RowSpec } from "./rows";
import { Fields, select } from "./source";
import { validateMapping, validateRefs, validateRows } from "./validate";
import type { RefUse } from "./validate";

export const ROOT = resolve(import.meta.dir, "../..");
export const DATA_DIR = join(ROOT, "data-src");

/** Parsed source files keyed by a mapping's `file` (for example `us/prices.json`). */
export type Sources = Record<string, JsonValue>;

export function readSources(mappings: readonly TableMapping[] = MAPPINGS): Sources {
  const out: Sources = {};
  for (const { file } of mappings) {
    if (!Object.hasOwn(out, file)) out[file] = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
  }
  return out;
}

function basisOf(basis: JsonValue | undefined): string | Record<string, string> | undefined {
  if (typeof basis === "string") return basis;
  if (!isRecord(basis)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(basis)) {
    if (typeof value !== "string") return undefined;
    out[key] = value;
  }
  return out;
}

/** The provenance every table keeps: the source's schema, period, `approximate: true` and basis. */
function sourceOf(file: JsonObject, mapping: TableMapping, report: Report): TableSource | undefined {
  const { schema, reflects_period: period, approximate } = file;
  const basis = basisOf(file.basis);
  if (typeof schema !== "string" || typeof period !== "string" || basis === undefined) {
    report("source", `${mapping.file} needs string \`schema\` and \`reflects_period\` and a \`basis\` (text, or an object of text)`);
    return undefined;
  }
  if (approximate !== true) {
    report("source", `${mapping.file} must keep \`approximate: true\``);
    return undefined;
  }
  return { dataPack: DATA_PACK, file: mapping.file, sourceSchema: schema, reflectsPeriod: period, approximate: true, basis };
}

function buildRows(mapping: TableMapping, spec: RowSpec, file: JsonObject, report: Report): Record<string, TableRow> {
  const rows: Record<string, TableRow> = {};
  for (const node of select(file, mapping.from, report)) {
    if (!isRecord(node.value)) {
      report("source", `source row ${node.key} is not an object`);
      continue;
    }
    const fields = new Fields(node.value, report);
    const own = node.kind === "item" ? fields.take("id") : undefined;
    const id = spec.id?.(node) ?? (node.kind === "entry" ? node.key : own);
    if (typeof id !== "string" || id === "") {
      report("source", `source row ${node.key} has no id`);
      continue;
    }
    fields.at = id;
    if (Object.hasOwn(rows, id)) {
      report("duplicate", `row id "${id}" appears more than once`, { row: id });
      continue;
    }
    const raw = spec.row(fields, node, { file });
    for (const leftover of fields.leftovers()) report("source", `source field "${leftover}" is not mapped to any column`, { row: id });
    // Declared columns first, in declaration order; undeclared ones last so validation can name them.
    const row: TableRow = {};
    for (const name of Object.keys(mapping.columns)) {
      if (raw[name] !== undefined) row[name] = raw[name];
    }
    for (const [name, value] of Object.entries(raw)) {
      if (value !== undefined && !Object.hasOwn(mapping.columns, name)) row[name] = value;
    }
    rows[id] = row;
  }
  spec.check?.(rows, report);
  return rows;
}

/**
 * Builds and validates every mapped table. Throws one `TableBuildError` listing every finding;
 * otherwise returns the tables in mapping order with their revisions.
 */
export function buildTables(sources: Sources, mappings: readonly TableMapping[] = MAPPINGS): DataTable[] {
  const issues: Issue[] = [];
  const tableIds = mappings.map((mapping) => mapping.table);
  const refs: RefUse[] = [];
  const rowsByTable: Record<string, Record<string, TableRow>> = {};
  const built: { mapping: TableMapping; source: TableSource; rows: Record<string, TableRow> }[] = [];

  for (const mapping of mappings) {
    const report = reporter(issues, mapping.table);
    if (Object.hasOwn(rowsByTable, mapping.table)) {
      report("duplicate", "two mappings build this table");
      continue;
    }
    rowsByTable[mapping.table] = {};
    validateMapping(mapping, tableIds, report);
    const file = sources[mapping.file];
    const spec = ROW_SPECS[mapping.table];
    if (!isRecord(file)) {
      report("source", `source file ${mapping.file} is missing or not an object`);
      continue;
    }
    if (!spec) {
      report("source", "no row builder is registered for this table");
      continue;
    }
    if (!LABELS[mapping.table]) report("source", "no label is registered for this table");
    const source = sourceOf(file, mapping, report);
    const rows = buildRows(mapping, spec, file, report);
    validateRows(mapping.table, mapping.columns, rows, report, refs);
    rowsByTable[mapping.table] = rows;
    if (source) built.push({ mapping, source, rows });
  }
  validateRefs(rowsByTable, refs, issues);
  if (issues.length > 0) throw new TableBuildError(issues);

  return built.map(({ mapping, source, rows }) => {
    const columns = structuredClone(mapping.columns);
    const { schema } = mapping;
    return { id: mapping.table, pack: mapping.pack, schema, revision: hashJson({ schema, columns, rows }), label: LABELS[mapping.table] ?? mapping.table, source, columns, rows };
  });
}

/** Stable text for a table: header fields, then one line per column and one per row. */
export function serializeTable(table: DataTable): string {
  const block = (name: string, entries: Record<string, unknown>, last: boolean): string[] => {
    const keys = Object.keys(entries);
    return [
      `  ${JSON.stringify(name)}: {`,
      ...keys.map((key, index) => `    ${JSON.stringify(key)}: ${JSON.stringify(entries[key])}${index < keys.length - 1 ? "," : ""}`),
      last ? "  }" : "  },",
    ];
  };
  const head = (["id", "pack", "schema", "revision", "label"] as const).map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(table[key])},`);
  return ["{", ...head, `  "source": ${JSON.stringify(table.source)},`, ...block("columns", table.columns, false), ...block("rows", table.rows, true), "}", ""].join("\n");
}

/** `src/packs/<pack>/core/tables/modern-us/<table>.json`, the table named without its pack prefix. */
export function outputPath(table: DataTable): string {
  return join(ROOT, "src", "packs", table.pack, "core", "tables", DATA_PACK, `${table.id.slice(table.pack.length + 1)}.json`);
}

function main(): void {
  try {
    for (const table of buildTables(readSources())) {
      const path = outputPath(table);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serializeTable(table));
      console.log(`${table.id.padEnd(22)} ${String(Object.keys(table.rows).length).padStart(4)} rows  ${table.revision}`);
    }
  } catch (error) {
    if (!(error instanceof TableBuildError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.main) main();
