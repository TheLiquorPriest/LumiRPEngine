// Writes `src/ui/page-list.ts` from the pages under `src/ui/pages/` (`bun scripts/ui/pages.ts`; the
// build runs it first). A page is a file `pages/<name>.tsx`, or a folder `pages/<name>/` with an
// `index.tsx`, whose module exports `entry` (`src/ui/page-entry.ts`); a module that does not is a part
// of some page, not a page. The shells offer every entry listed, so a page added under `pages/` needs no
// edit to a shared file. The same way the Turn page's sections are listed: each module of
// `pages/turns/sections/` that exports `section` (`pages/turns/types.ts`) is in `sections/list.ts`, in
// the order each declares, so a section added there needs no edit to a shared list.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const PAGES = join(ROOT, "src", "ui", "pages");
const LIST = join(ROOT, "src", "ui", "page-list.ts");
const SECTIONS = join(PAGES, "turns", "sections");
const SECTION_LIST = join(SECTIONS, "list.ts");

/** The modules of `folder` that are pages, by their names below it, in name order. */
export function pageModules(folder: string = PAGES): string[] {
  const names: string[] = [];
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const file = item.isDirectory() ? join(folder, item.name, "index.tsx") : item.name.endsWith(".tsx") ? join(folder, item.name) : null;
    if (file !== null && existsSync(file) && /^export const entry\b/m.test(readFileSync(file, "utf8"))) names.push(item.isDirectory() ? item.name : item.name.slice(0, -".tsx".length));
  }
  return names.sort();
}

/** The modules of the Turn page's `sections/` folder, by their names below it, in name order. */
export function sectionModules(folder: string = SECTIONS): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".tsx") && /^export const section\b/m.test(readFileSync(join(folder, name), "utf8")))
    .map((name) => name.slice(0, -".tsx".length))
    .sort();
}

/** `my-page` as an identifier: `myPage`, with `suffix` after it. */
const identifierOf = (name: string, suffix: string): string => `${name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())}${suffix}`;

/** The list's source for the modules named. */
export function pageListSource(modules: readonly string[]): string {
  const id = (name: string): string => identifierOf(name, "Page");
  return [
    "// Written by `bun scripts/ui/pages.ts` from the pages under `src/ui/pages/`, and again by the build: never by hand.",
    "// Every page of the shells, in the order their bars offer them.",
    "",
    'import type { PageEntry } from "./page-entry";',
    ...modules.map((name) => `import { entry as ${id(name)} } from "./pages/${name}";`),
    "",
    `export const PAGES: readonly PageEntry[] = [${modules.map(id).join(", ")}].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));`,
    "",
  ].join("\n");
}

/** The Turn page's list of sections, for the modules named. */
export function sectionListSource(modules: readonly string[]): string {
  const id = (name: string): string => identifierOf(name, "Section");
  return [
    "// Written by `bun scripts/ui/pages.ts` from the modules of this folder, and again by the build: never by hand.",
    "// Every section of the Turn page, in the order each declares.",
    "",
    'import type { TurnSection } from "../types";',
    ...modules.map((name) => `import { section as ${id(name)} } from "./${name}";`),
    "",
    `export const TURN_SECTIONS: readonly TurnSection[] = [${modules.map(id).join(", ")}].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));`,
    "",
  ].join("\n");
}

/** Writes a file when it is not what is given; whether it was written. */
function writeIfChanged(path: string, next: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === next) return false;
  writeFileSync(path, next);
  return true;
}

/** Writes the page list and the Turn page's section list when they are not what the folders give; whether either was written. */
export function writePageList(): boolean {
  const pages = writeIfChanged(LIST, pageListSource(pageModules()));
  const sections = writeIfChanged(SECTION_LIST, sectionListSource(sectionModules()));
  return pages || sections;
}

if (import.meta.main) console.log(writePageList() ? "Wrote src/ui/page-list.ts and the Turn page's section list." : "The page list and the Turn page's section list are as the folders give them.");
