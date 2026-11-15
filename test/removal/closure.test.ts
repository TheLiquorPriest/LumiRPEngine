// What the migration runs (PlanSwap-5): `rpe migrate` runs today's own readers and fold from homes of
// its own, so the code it runs holds nothing of the old engines (src/backend/) and nothing of LumiAH
// (READINGS R-85: the importer carries its own copies, and LumiAH stops being a dependency with no
// exception). Its closure is read the way the build reads it, from Bun's metafile: what is started
// when it runs. The old engines' shared texts still come in, only through what the fence allows:
// a line of its list, or a piece's allowance for the names today's carried readers take, each ended by
// the package fates.tsv names.

import { describe, expect, test } from "bun:test";
import { relative, resolve } from "node:path";
import { allowed, readFates, ROOT } from "./fates";
import { isLumiah, readList } from "./fence";
import { readTree } from "./imports";

const CLI = "src/migrate/cli.ts";

describe("the migration stands on homes of its own", () => {
  const fates = readFates();
  const { edges } = readTree(ROOT);
  const listed = readList().entries;

  test("no file under src/migrate/ imports LumiAH", () => {
    const direct = edges.filter((edge) => edge.from.startsWith("src/migrate/") && edge.to === null && isLumiah(edge.spec));
    expect(direct.map((edge) => `${edge.from} → ${edge.spec}`)).toEqual([]);
  });

  test("what rpe migrate runs holds no file of the old engines and no module of LumiAH", async () => {
    const built = await Bun.build({ entrypoints: [resolve(ROOT, CLI)], target: "bun", metafile: true, throw: false, external: ["supports-color"] });
    expect(built.logs.filter((log) => log.level === "error").map(String)).toEqual([]);
    // Bun's metafile names each input by its path from the directory the build ran in.
    const inputs = Object.keys(built.metafile?.inputs ?? {}).map((input) => relative(ROOT, resolve(process.cwd(), input)).split("\\").join("/"));
    expect(inputs).toContain(CLI);
    expect(inputs.filter((path) => path.startsWith("src/backend/"))).toEqual([]);
    expect(inputs.filter((path) => path.includes("node_modules/lumi-ah/"))).toEqual([]);
  });

  test("any other file that goes comes into it only through what the fence allows: a listed line, or a piece's allowance", () => {
    const held = new Set(listed.map((entry) => `${entry.from}\u0000${entry.to}`));
    const allows = (from: string, to: string, names: readonly string[]) => held.has(`${from}\u0000${to}`) || (names.length > 0 && names.every((name) => name !== "*" && allowed(fates, from, to).has(name)));
    const reached = new Set([CLI]);
    const queue = [CLI];
    for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
      for (const edge of edges) {
        if (edge.from !== at || edge.typeOnly || edge.to === null || reached.has(edge.to) || allows(edge.from, edge.to, edge.names)) continue;
        reached.add(edge.to);
        queue.push(edge.to);
      }
    }
    expect([...reached].filter((path) => fates.files.get(path)?.fate === "removed")).toEqual([]);
  });

  test("the fence's list holds none of the migration's imports of the old engines or of LumiAH", () => {
    const own = listed.filter((entry) => entry.from.startsWith("src/migrate/") && (entry.to.startsWith("src/backend/") || isLumiah(entry.to)));
    expect(own.map((entry) => `${entry.from} → ${entry.to}`)).toEqual([]);
  });
});
