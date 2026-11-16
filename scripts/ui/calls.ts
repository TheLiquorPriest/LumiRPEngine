// Writes `src/ui/kept/calls/list.ts` from the call files in `src/ui/kept/calls/` (`bun scripts/ui/calls.ts`;
// the build runs it first). A call file is a module there, other than the list and its loader, that exports
// `calls: CallFile` (`src/ui/kept/client.ts`); a module that does not is a part of some file.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const FOLDER = join(ROOT, "src", "ui", "kept", "calls");
const LIST = join(FOLDER, "list.ts");
const NOT_CALLS = new Set(["index.ts", "list.ts"]);

/** The modules of the folder that are call files, by their names without the extension, in name order. */
export function callModules(folder: string = FOLDER): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(".ts") && !NOT_CALLS.has(name) && /^export const calls\b/m.test(readFileSync(join(folder, name), "utf8")))
    .map((name) => name.slice(0, -".ts".length))
    .sort();
}

/** `my-area` as an identifier: `myAreaCalls`. */
const identifierOf = (name: string): string => `${name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())}Calls`;

/** The list's source for the modules named. */
export function callListSource(modules: readonly string[]): string {
  return [
    "// Written by `bun scripts/ui/calls.ts` from the call files in this folder, and again by the build: never by hand.",
    "// Every call file of the kept views, in name order.",
    "",
    'import type { CallFile } from "../client";',
    ...modules.map((name) => `import { calls as ${identifierOf(name)} } from "./${name}";`),
    "",
    `export const CALLS: readonly CallFile[] = [${modules.map(identifierOf).join(", ")}];`,
    "",
  ].join("\n");
}

/** Writes the list when it is not what the folder gives; whether it was written. */
export function writeCallList(): boolean {
  const next = callListSource(callModules());
  if (existsSync(LIST) && readFileSync(LIST, "utf8") === next) return false;
  writeFileSync(LIST, next);
  return true;
}

if (import.meta.main) console.log(writeCallList() ? "Wrote src/ui/kept/calls/list.ts." : "The call list is as the folder gives it.");
