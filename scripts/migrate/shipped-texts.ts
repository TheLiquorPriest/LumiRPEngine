// Makes the table of shipped texts the migration reads (PlanSwap-15 item 4): one row for each text
// the old engines sent a model, as today's pushed build, `main` 3b318f02, shipped it. Run from the
// repository's folder:
//
//   bun scripts/migrate/shipped-texts.ts
//
// It takes `src/` as that commit holds it out of git into a temporary folder, loads that build's
// registry of texts (`PROMPTS`, src/shared/prompts.ts) from there, and writes for each text its id,
// the SHA-256 of its exact wording (the string today's reader compares a stored text with), the
// placeholders it may hold and those it requires, and whether it may be blank. Nothing else writes
// src/migrate/today/shipped-texts.ts; the texts themselves are not in it.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The build whose texts the table holds: today's pushed `main`. */
const COMMIT = "3b318f023ac4c5f501eb19b4ca19eaf70dc750cc";

const ROOT = resolve(import.meta.dir, "../..");
const TABLE = join(ROOT, "src/migrate/today/shipped-texts.ts");

interface Def {
  id: string;
  text: string;
  vars: readonly { name: string; required?: true }[];
  nonEmpty?: true;
}

function run(command: string[], cwd: string): Uint8Array {
  const done = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${done.stderr.toString()}`);
  return done.stdout;
}

const work = mkdtempSync(join(tmpdir(), "shipped-texts-"));
try {
  // The commit's `src/` as it stands, untouched by anything the tree has become since.
  const archive = join(work, "src.tar");
  writeFileSync(archive, run(["git", "archive", COMMIT, "src", "package.json"], ROOT));
  run(["tar", "-x", "-f", archive, "-C", work], work);
  // The commit's own registry is loaded by a process of its own, which prints what it holds.
  const dump = ["const { PROMPTS } = await import(process.argv[1]);", "console.log(JSON.stringify(PROMPTS.map((d) => ({ id: d.id, text: d.text, vars: d.vars, nonEmpty: d.nonEmpty }))));"].join("\n");
  const defs = JSON.parse(run([process.execPath, "-e", dump, join(work, "src/shared/prompts.ts")], work).toString()) as Def[];
  const seen = new Set<string>();
  const rows = defs.map((def) => {
    if (seen.has(def.id)) throw new Error(`the text ${def.id} is in the registry twice`);
    seen.add(def.id);
    const sha256 = createHash("sha256").update(def.text).digest("hex");
    const vars = def.vars.map((v) => v.name);
    const required = def.vars.filter((v) => v.required === true).map((v) => v.name);
    return `  [${JSON.stringify(def.id)}, "${sha256}", ${JSON.stringify(vars)}, ${JSON.stringify(required)}, ${def.nonEmpty === true ? 1 : 0}],`;
  });
  const source = [
    `// Made by scripts/migrate/shipped-texts.ts from main ${COMMIT.slice(0, 8)}; nothing else writes this file.`,
    "//",
    "// One row for each text today's build ships to a model: its id, the SHA-256 of its exact wording,",
    "// the placeholders it may hold, those it requires, and whether it may be blank. The carried reader of",
    "// the user's own texts (prompt-texts.ts) sorts what the settings file stores against these rows.",
    "",
    `export const SHIPPED_TEXTS_COMMIT = "${COMMIT}";`,
    "",
    "/** A text's id, the SHA-256 of its shipped wording, the placeholders it may hold, those it requires, and 1 where it may not be blank. */",
    "type Row = readonly [id: string, sha256: string, vars: readonly string[], required: readonly string[], nonEmpty: 0 | 1];",
    "",
    "const ROWS: readonly Row[] = [",
    ...rows,
    "];",
    "",
    "export interface ShippedText {",
    "  id: string;",
    "  sha256: string;",
    "  vars: readonly string[];",
    "  required: readonly string[];",
    "  nonEmpty: boolean;",
    "}",
    "",
    "export const SHIPPED_TEXTS: readonly ShippedText[] = ROWS.map(([id, sha256, vars, required, nonEmpty]) => ({ id, sha256, vars, required, nonEmpty: nonEmpty === 1 }));",
    "",
  ].join("\n");
  writeFileSync(TABLE, source);
  console.log(`${defs.length} texts of ${COMMIT.slice(0, 8)} written to ${TABLE.slice(ROOT.length + 1)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
