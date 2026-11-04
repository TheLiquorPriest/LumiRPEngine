// Starter worlds: converts data-src/templates/*.json into src/packs/starters/*.json, and keeps the
// shipped history of each starter's own tables (`src/packs/starters/shipped.json`, Data updates): a
// table a template swaps in for the packs' Modern US one (Brindlemere's and Harrowmere's prices,
// categories, items and vehicle classes) whose revision changes has the change recorded against
// the committed world it replaces, as the table build records the packs' own (`recordShipped`), so
// a world made from an earlier build of the starter is offered the newer versions.
//
//   bun scripts/templates/build.ts            writes the three worlds and the history (fails on any lint error)
//   bun scripts/templates/build.ts --check    exits 1 when a committed world or the history differs from a fresh build

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { lintWorld } from "../../src/engine/authoring";
import type { TableDef } from "../../src/engine/registry";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import type { LintIssue } from "../../src/shared/protocol";
import type { JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { DataTable, ShippedRevision } from "../../src/shared/tables";
import { isDataTable, tableRevision } from "../../src/shared/tables";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";
import { recordShipped } from "../tables/build";
import { convertTemplate } from "./convert";
import { formatJson } from "./format";
import type { Template } from "./template";

const ROOT = resolve(import.meta.dir, "../..");
export const TEMPLATE_FILES = ["fantasy-town", "mystery-manor", "modern-slice-of-life"] as const;
export const OUT_DIR = join(ROOT, "src/packs/starters");
/** Every starter's own tables' shipped histories, by starter and table, oldest first. */
export const SHIPPED_PATH = join(OUT_DIR, "shipped.json");

/** A starter's own tables' histories, by table. */
export type StarterHistories = Record<string, ShippedRevision[]>;

export interface Built {
  /** The starter id (`fantasy_town`): the file name and the Build tab's template id. */
  id: string;
  path: string;
  doc: WorldDoc;
  text: string;
  issues: LintIssue[];
}

export function buildAll(registry: Registry = createRegistry(ALL_PACKS)): Built[] {
  const tables = defaultTables(ALL_PACKS);
  return TEMPLATE_FILES.map((file) => {
    const tpl = JSON.parse(readFileSync(join(ROOT, "data-src/templates", `${file}.json`), "utf8")) as Template;
    const doc = convertTemplate(tpl, { packs: ALL_PACKS, registry, tables });
    const id = file.replace(/-/g, "_");
    return { id, path: join(OUT_DIR, `${id}.json`), doc, text: `${formatJson(doc as unknown as JsonValue)}\n`, issues: lintWorld(doc, registry) };
  });
}

/** A starter's own tables: those of its tables no pack ships, or has shipped, as they are (a template's prices, items or vehicle classes). */
export function ownTables(doc: Pick<WorldDoc, "tables">, tables: ReadonlyMap<string, TableDef>): Record<string, DataTable> {
  const out: Record<string, DataTable> = {};
  for (const [id, table] of Object.entries(isRecord(doc.tables) ? doc.tables : {})) {
    const def = tables.get(id);
    if (!def?.defaults || !isDataTable(table)) continue;
    const at = tableRevision(table);
    if (at !== def.defaults.revision && !(def.shipped ?? []).some((r) => r.revision === at)) out[id] = table;
  }
  return out;
}

/**
 * A starter's own tables' histories once `doc` replaces `committed` (null when there is none yet):
 * each own table's, recorded against the committed world's own table of that id (`recordShipped`:
 * a history that doesn't end at it is refused). A table no longer its own drops out.
 */
export function recordStarter(kept: Readonly<Record<string, readonly ShippedRevision[]>>, committed: Pick<WorldDoc, "tables"> | null, doc: Pick<WorldDoc, "tables">, tables: ReadonlyMap<string, TableDef>): StarterHistories {
  const was = committed ? ownTables(committed, tables) : {};
  const out: StarterHistories = {};
  for (const [id, table] of Object.entries(ownTables(doc, tables))) out[id] = recordShipped(kept[id] ?? [], was[id] ?? null, table);
  return out;
}

const readJson = (path: string): unknown => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : null);

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let failed = false;
  const registry = createRegistry(ALL_PACKS);
  const built = buildAll(registry);
  const kept = readJson(SHIPPED_PATH);
  const committedHistories = (id: string): Record<string, ShippedRevision[]> => (isRecord(kept) && isRecord(kept[id]) ? (kept[id] as Record<string, ShippedRevision[]>) : {});
  // Every history first, so a history out of step with its world stops the build before anything is written; a world not written keeps its own.
  const histories: Record<string, StarterHistories> = {};
  for (const b of built) {
    const written = b.issues.every((i) => i.severity !== "error");
    const committed = readJson(b.path);
    const own = written ? recordStarter(committedHistories(b.id), isRecord(committed) ? (committed as Pick<WorldDoc, "tables">) : null, b.doc, registry.tables) : committedHistories(b.id);
    if (Object.keys(own).length > 0) histories[b.id] = own;
  }
  // Stable text, as the table build writes the packs' own histories (`serializeShipped`): each starter's own tables, each oldest first.
  const shipped = `${JSON.stringify(histories, null, 2)}\n`;
  for (const b of built) {
    const errors = b.issues.filter((i) => i.severity === "error");
    for (const issue of b.issues) console.log(`${b.id}: ${issue.severity} ${issue.path}: ${issue.message}`);
    if (errors.length > 0) failed = true;
    if (check) {
      if ((existsSync(b.path) ? readFileSync(b.path, "utf8") : "") !== b.text) {
        console.log(`${b.id}: the committed world differs from a fresh build`);
        failed = true;
      }
    } else if (errors.length === 0) {
      writeFileSync(b.path, b.text);
      console.log(`${b.id}: wrote ${b.path} (${b.text.length} bytes, ${b.issues.length} lint issue(s))`);
    }
  }
  if (check) {
    if ((existsSync(SHIPPED_PATH) ? readFileSync(SHIPPED_PATH, "utf8") : "") !== shipped) {
      console.log("the starters' shipped history differs from a fresh build");
      failed = true;
    }
  } else writeFileSync(SHIPPED_PATH, shipped);
  process.exit(failed ? 1 : 0);
}
