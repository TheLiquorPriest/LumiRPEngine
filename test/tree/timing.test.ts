// How long find and grep take over a chat folder holding 2,000 note files (20 folders of 100), each
// a few hundred bytes. The times are printed for the report; the test checks what was found.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { FileHit, FileQuery, Refused } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import { type LaidTree, layTree } from "./fixtures";

const FOLDERS = 20;
const PER_FOLDER = 100;
const FILES = FOLDERS * PER_FOLDER;
const ALL = 20_000;
const scope = KIT_SEED.scope;

let place: string;
let tree: LaidTree;

/** A note of a few hundred bytes; every hundredth names the bell. */
function note(folder: number, n: number): string {
  const lines = Array.from({ length: 8 }, (_, i) => `Folder ${folder}, note ${n}, line ${i + 1}: the tide came in over the harbor stones.`);
  if ((folder * PER_FOLDER + n) % 100 === 0) lines[4] = `The drowned bell was heard from note ${n}.`;
  return `${lines.join("\n")}\n`;
}

beforeAll(async () => {
  place = await mkdtemp(join(tmpdir(), "rpe-tree-timing-"));
  tree = await layTree(KIT_SEED, place);
  for (let f = 0; f < FOLDERS; f++) {
    const folder = join(tree.levelDir("chat"), "persistent-workspace", "bulk", `f${String(f).padStart(2, "0")}`);
    await mkdir(folder, { recursive: true });
    await Promise.all(Array.from({ length: PER_FOLDER }, (_, n) => writeFile(join(folder, `n${String(n).padStart(3, "0")}.md`), note(f, n))));
  }
});

afterAll(async () => {
  await tree.close();
  await rm(place, { recursive: true, force: true });
});

async function timed(label: string, query: FileQuery): Promise<FileHit[]> {
  const started = performance.now();
  const found: FileHit[] | Refused = await tree.port.find(scope, query);
  const ms = performance.now() - started;
  if (!Array.isArray(found)) throw new Error(`${label} was refused: ${found.reason}`);
  console.log(`[tree timing] ${label}: ${found.length} hits in ${ms.toFixed(1)} ms`);
  return found;
}

test(`find and grep over a chat folder of ${FILES} files`, async () => {
  const bulk = "persistent-workspace/bulk";
  const listed = await timed("list, every depth", { by: "list", path: bulk, depth: 3, limit: ALL });
  expect(listed.filter((h) => h.type === "file")).toHaveLength(FILES);

  const globbed = await timed("glob **/*.md under the folder", { by: "glob", pattern: "**/*.md", path: bulk, limit: ALL });
  expect(globbed).toHaveLength(FILES);

  const fromRoot = await timed("glob **/*.md from the chat's root", { by: "glob", pattern: "**/*.md", limit: ALL });
  expect(fromRoot.filter((h) => h.path.startsWith(`${bulk}/`))).toHaveLength(FILES);

  const rare = await timed("grep, 20 matching lines", { by: "grep", pattern: "drowned bell", path: bulk, limit: ALL });
  expect(rare).toHaveLength(FILES / 100);

  const fromRootGrep = await timed("grep from the chat's root, 21 matching lines", { by: "grep", pattern: "drowned bell", limit: ALL });
  expect(fromRootGrep.map((h) => h.path)).toContain("WORLD.md");
  expect(fromRootGrep).toHaveLength(FILES / 100 + 1);

  const every = await timed("grep, every line matching", { by: "grep", pattern: "tide", path: bulk, limit: ALL });
  expect(every).toHaveLength(FILES * 8 - FILES / 100);

  const capped = await timed("grep at a limit of 200", { by: "grep", pattern: "tide", path: bulk, limit: 200 });
  expect(capped).toHaveLength(200);
});
