// Writes `src/ui/chat/surfaces/list.ts` from the surface files in `src/ui/chat/surfaces/`
// (`bun scripts/ui/surfaces.ts`; the build runs it first). A surface file is a module there, other than
// the list, that exports `surface: SurfaceDef` (`src/ui/chat/surface.ts`); a module that does not is a part
// of some surface. A surface added there needs no edit to the loader or to any shared file.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const FOLDER = join(ROOT, "src", "ui", "chat", "surfaces");
const LIST = join(FOLDER, "list.ts");

/** The modules of the folder that are surface files, by their names without the extension, in name order. */
export function surfaceModules(folder: string = FOLDER): string[] {
  return readdirSync(folder)
    .filter((name) => /\.tsx?$/.test(name) && name !== "list.ts" && /^export const surface\b/m.test(readFileSync(join(folder, name), "utf8")))
    .map((name) => name.replace(/\.tsx?$/, ""))
    .sort();
}

/** `status-line` as an identifier: `statusLineSurface`. */
const identifierOf = (name: string): string => `${name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())}Surface`;

/** The list's source for the modules named. */
export function surfaceListSource(modules: readonly string[]): string {
  return [
    "// Written by `bun scripts/ui/surfaces.ts` from the surface files in this folder, and again by the build: never by hand.",
    "// Every surface file of the chat, in name order.",
    "",
    'import type { SurfaceDef } from "../surface";',
    ...modules.map((name) => `import { surface as ${identifierOf(name)} } from "./${name}";`),
    "",
    `export const SURFACES: readonly SurfaceDef[] = [${modules.map(identifierOf).join(", ")}];`,
    "",
  ].join("\n");
}

/** Writes the list when it is not what the folder gives; whether it was written. */
export function writeSurfaceList(): boolean {
  const next = surfaceListSource(surfaceModules());
  if (existsSync(LIST) && readFileSync(LIST, "utf8") === next) return false;
  writeFileSync(LIST, next);
  return true;
}

if (import.meta.main) console.log(writeSurfaceList() ? "Wrote src/ui/chat/surfaces/list.ts." : "The surface list is as the folder gives it.");
