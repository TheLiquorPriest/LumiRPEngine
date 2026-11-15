// What the migration runs (PlanSwap-5): `rpe migrate` runs today's own readers and fold from homes of
// its own, so the code it runs holds nothing of the old engines (src/backend/) and nothing of LumiAH
// (READINGS R-85: the importer carries its own copies, and LumiAH stops being a dependency with no
// exception). Its closure is read the way the build reads it, from Bun's metafile: what is started
// when it runs. The old engines' shared texts still come in, only through what the fence allows:
// a line of its list, or a piece's allowance for the names today's carried readers take, each ended by
// the package fates.tsv names.
//
// The same holds of what the application and the light extension run (PlanSwap-6 item 4): the closure
// of `src/app/main.ts` and of `src/ext/backend.ts`, read from the build's own metafile, holds no file of
// `src/backend/` and no module of LumiAH; any other file that goes comes into either only through a line
// of the fence's list or a piece's allowance; the list holds no import of `src/backend/` by a file of
// `src/` outside the old engines; and the shell files the new pages stand on live in `src/ui/`.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { allowed, type Fates, readFates, ROOT } from "./fates";
import { isLumiah, readList } from "./fence";
import { type Edge, readTree } from "./imports";

const CLI = "src/migrate/cli.ts";

/** The files that go which `entry` reaches by an import that neither a line of the list nor a piece's allowance holds, type imports apart. */
function removedReachedFrom(entry: string, edges: readonly Edge[], listed: readonly { from: string; to: string }[], fates: Fates): string[] {
  const held = new Set(listed.map((line) => `${line.from}\u0000${line.to}`));
  const allows = (from: string, to: string, names: readonly string[]) => held.has(`${from}\u0000${to}`) || (names.length > 0 && names.every((name) => name !== "*" && allowed(fates, from, to).has(name)));
  const reached = new Set([entry]);
  const queue = [entry];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const edge of edges) {
      if (edge.from !== at || edge.typeOnly || edge.to === null || reached.has(edge.to) || allows(edge.from, edge.to, edge.names)) continue;
      reached.add(edge.to);
      queue.push(edge.to);
    }
  }
  return [...reached].filter((path) => fates.files.get(path)?.fate === "removed");
}

/** What Bun bundles of `entry` for the server, by the paths of its inputs from the root: the metafile `scripts/build.ts` reads. */
async function bundledFrom(entry: string): Promise<string[]> {
  const built = await Bun.build({ entrypoints: [resolve(ROOT, entry)], target: "bun", metafile: true, throw: false, external: ["supports-color"] });
  expect(built.logs.filter((log) => log.level === "error").map(String)).toEqual([]);
  // Bun's metafile names each input by its path from the directory the build ran in.
  return Object.keys(built.metafile?.inputs ?? {}).map((input) => relative(ROOT, resolve(process.cwd(), input)).split("\\").join("/"));
}

describe("the migration stands on homes of its own", () => {
  const fates = readFates();
  const { edges } = readTree(ROOT);
  const listed = readList().entries;

  test("no file under src/migrate/ imports LumiAH", () => {
    const direct = edges.filter((edge) => edge.from.startsWith("src/migrate/") && edge.to === null && isLumiah(edge.spec));
    expect(direct.map((edge) => `${edge.from} → ${edge.spec}`)).toEqual([]);
  });

  test("what rpe migrate runs holds no file of the old engines and no module of LumiAH", async () => {
    const inputs = await bundledFrom(CLI);
    expect(inputs).toContain(CLI);
    expect(inputs.filter((path) => path.startsWith("src/backend/"))).toEqual([]);
    expect(inputs.filter((path) => path.includes("node_modules/lumi-ah/"))).toEqual([]);
  });

  test("any other file that goes comes into it only through what the fence allows: a listed line, or a piece's allowance", () => {
    expect(removedReachedFrom(CLI, edges, listed, fates)).toEqual([]);
  });

  test("the fence's list holds none of the migration's imports of the old engines or of LumiAH", () => {
    const own = listed.filter((entry) => entry.from.startsWith("src/migrate/") && (entry.to.startsWith("src/backend/") || isLumiah(entry.to)));
    expect(own.map((entry) => `${entry.from} → ${entry.to}`)).toEqual([]);
  });
});

const APP = "src/app/main.ts";
const EXTENSION = "src/ext/backend.ts";
const SHELL = ["store.ts", "icons.tsx", "markdown.tsx", "styles/components.ts", "styles/tokens.ts"];

describe("the application and the light extension stand on homes of their own", () => {
  const fates = readFates();
  const { edges } = readTree(ROOT);
  const listed = readList().entries;

  for (const entry of [APP, EXTENSION]) {
    test(`what ${entry} runs holds no file of the old engines and no module of LumiAH`, async () => {
      const inputs = await bundledFrom(entry);
      expect(inputs).toContain(entry);
      expect(inputs.filter((path) => path.startsWith("src/backend/"))).toEqual([]);
      expect(inputs.filter((path) => path.includes("node_modules/lumi-ah/"))).toEqual([]);
    });

    test(`any other file that goes comes into ${entry} only through what the fence allows`, () => {
      expect(removedReachedFrom(entry, edges, listed, fates)).toEqual([]);
    });
  }

  test("the fence's list holds no import of the old engines by a file of src/ that stays", () => {
    const own = listed.filter((line) => line.from.startsWith("src/") && !line.from.startsWith("src/backend/") && fates.files.get(line.from)?.fate !== "removed" && line.to.startsWith("src/backend/"));
    expect(own.map((line) => `${line.from} → ${line.to}`)).toEqual([]);
  });

  test("the shell files the new pages stand on are in src/ui/, and src/ui/ imports nothing that goes but through the fence's list", () => {
    for (const file of SHELL) {
      expect(existsSync(join(ROOT, "src/ui", file))).toBe(true);
      expect(existsSync(join(ROOT, "src/frontend", file))).toBe(false);
    }
    const held = new Set(listed.map((line) => `${line.from}\u0000${line.to}`));
    const taken = edges.filter((edge) => edge.from.startsWith("src/ui/") && edge.to !== null && fates.files.get(edge.to)?.fate === "removed" && !held.has(`${edge.from}\u0000${edge.to}`));
    expect(taken.map((edge) => `${edge.from}:${edge.line} → ${edge.to}`)).toEqual([]);
  });
});
