// Writes `src/ui/page-list.ts` from the pages under `src/ui/pages/` (`bun scripts/ui/pages.ts`; the
// build runs it first). A page is a file `pages/<name>.tsx`, or a folder `pages/<name>/` with an
// `index.tsx`, whose module exports `entry` (`src/ui/page-entry.ts`); a module that does not is a part
// of some page, not a page. The shells offer every entry listed, so a page added under `pages/` needs no
// edit to a shared file.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const PAGES = join(ROOT, "src", "ui", "pages");
const LIST = join(ROOT, "src", "ui", "page-list.ts");

/** The modules of `folder` that are pages, by their names below it, in name order. */
export function pageModules(folder: string = PAGES): string[] {
  const names: string[] = [];
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const file = item.isDirectory() ? join(folder, item.name, "index.tsx") : item.name.endsWith(".tsx") ? join(folder, item.name) : null;
    if (file !== null && existsSync(file) && /^export const entry\b/m.test(readFileSync(file, "utf8"))) names.push(item.isDirectory() ? item.name : item.name.slice(0, -".tsx".length));
  }
  return names.sort();
}

/** `my-page` as an identifier: `myPage`. */
const identifierOf = (name: string): string => `${name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())}Page`;

/** The list's source for the modules named. */
export function pageListSource(modules: readonly string[]): string {
  return [
    "// Written by `bun scripts/ui/pages.ts` from the pages under `src/ui/pages/`, and again by the build: never by hand.",
    "// Every page of the shells, in the order their bars offer them.",
    "",
    'import type { PageEntry } from "./page-entry";',
    ...modules.map((name) => `import { entry as ${identifierOf(name)} } from "./pages/${name}";`),
    "",
    `export const PAGES: readonly PageEntry[] = [${modules.map(identifierOf).join(", ")}].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));`,
    "",
  ].join("\n");
}

/** Writes the list when it is not what the folders give; whether it was written. */
export function writePageList(): boolean {
  const next = pageListSource(pageModules());
  if (existsSync(LIST) && readFileSync(LIST, "utf8") === next) return false;
  writeFileSync(LIST, next);
  return true;
}

if (import.meta.main) console.log(writePageList() ? "Wrote src/ui/page-list.ts." : "src/ui/page-list.ts is as the pages give it.");
