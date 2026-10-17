// Starter worlds: converts data-src/templates/*.json into src/packs/starters/*.json.
//
//   bun scripts/templates/build.ts            writes the three worlds (fails on any lint error)
//   bun scripts/templates/build.ts --check    exits 1 when a committed world differs from a fresh build

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { lintWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import type { LintIssue } from "../../src/shared/protocol";
import type { JsonValue } from "../../src/shared/json";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";
import { convertTemplate } from "./convert";
import { formatJson } from "./format";
import type { Template } from "./template";

const ROOT = resolve(import.meta.dir, "../..");
export const TEMPLATE_FILES = ["fantasy-town", "mystery-manor", "modern-slice-of-life"] as const;
export const OUT_DIR = join(ROOT, "src/packs/starters");

export interface Built {
  /** The starter id (`fantasy_town`): the file name and the Build tab's template id. */
  id: string;
  path: string;
  text: string;
  issues: LintIssue[];
}

export function buildAll(): Built[] {
  const registry = createRegistry(ALL_PACKS);
  const tables = defaultTables(ALL_PACKS);
  return TEMPLATE_FILES.map((file) => {
    const tpl = JSON.parse(readFileSync(join(ROOT, "data-src/templates", `${file}.json`), "utf8")) as Template;
    const doc = convertTemplate(tpl, { packs: ALL_PACKS, registry, tables });
    const id = file.replace(/-/g, "_");
    return { id, path: join(OUT_DIR, `${id}.json`), text: `${formatJson(doc as unknown as JsonValue)}\n`, issues: lintWorld(doc, registry) };
  });
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  let failed = false;
  for (const built of buildAll()) {
    const errors = built.issues.filter((i) => i.severity === "error");
    for (const issue of built.issues) console.log(`${built.id}: ${issue.severity} ${issue.path}: ${issue.message}`);
    if (errors.length > 0) failed = true;
    if (check) {
      let current = "";
      try {
        current = readFileSync(built.path, "utf8");
      } catch {
        current = "";
      }
      if (current !== built.text) {
        console.log(`${built.id}: the committed world differs from a fresh build`);
        failed = true;
      }
    } else if (errors.length === 0) {
      writeFileSync(built.path, built.text);
      console.log(`${built.id}: wrote ${built.path} (${built.text.length} bytes, ${built.issues.length} lint issue(s))`);
    }
  }
  process.exit(failed ? 1 : 0);
}
