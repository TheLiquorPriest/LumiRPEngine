// What one find may cost RPE's one thread: a find that names no limit gives at most `files.findLimit`
// (RPH holds a limit an agent names to `tools.perCall`), and a grep tests at most
// `files.grepLineChars` of each line and stops once it has run `files.grepMs`, so a pattern that
// backtracks on the turn folder's very long lines cannot hold every chat and every Stop.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { FileHit, FileQuery, Refused } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import { type LaidTree, layTree } from "./fixtures";

const scope = KIT_SEED.scope;
let place: string;
let tree: LaidTree;

beforeEach(async () => {
  place = await mkdtemp(join(tmpdir(), "rpe-tree-bounds-"));
  tree = await layTree(KIT_SEED, place);
});

afterEach(async () => {
  await tree.close();
  await rm(place, { recursive: true, force: true });
});

const settings = (yaml: string): Promise<number> => Bun.write(join(tree.levelDir("global"), "RPE-global.yml"), yaml);
const note = (name: string, text: string): Promise<number> => Bun.write(join(tree.levelDir("chat"), "persistent-workspace", "bounds", name), text);

async function find(query: FileQuery): Promise<FileHit[]> {
  const found: FileHit[] | Refused = await tree.port.find(scope, query);
  if (!Array.isArray(found)) throw new Error(`refused: ${found.reason}`);
  return found;
}

test("a find that names no limit gives at most files.findLimit, and one that names a limit gets it: RPE's own listing of a folder of more entries than that is whole", async () => {
  await settings("files:\n  findLimit: 3\n");
  for (let n = 0; n < 6; n++) await note(`n${n}.md`, "the tide\n");
  expect(await find({ by: "list", path: "persistent-workspace/bounds" })).toHaveLength(3);
  expect(await find({ by: "glob", pattern: "*.md", path: "persistent-workspace/bounds" })).toHaveLength(3);
  expect(await find({ by: "grep", pattern: "tide", path: "persistent-workspace/bounds" })).toHaveLength(3);
  // As the Turn page's listing of a turn's folder asks: every level down, with no end.
  expect(await find({ by: "list", path: "persistent-workspace/bounds", depth: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY })).toHaveLength(6);
  expect(await find({ by: "glob", pattern: "*.md", path: "persistent-workspace/bounds", limit: 100 })).toHaveLength(6);
  expect(await find({ by: "grep", pattern: "tide", path: "persistent-workspace/bounds", limit: 100 })).toHaveLength(6);
});

test("a grep tests only files.grepLineChars of a long line, and stops with what it found once it has run files.grepMs", async () => {
  await settings("files:\n  grepLineChars: 400\n  grepMs: 50\n");
  // A pattern with two open repeats takes time that grows with the cube of the text it is tested on.
  const long = "a".repeat(3_000);
  await note("found.md", `needle ${long}\n`);
  await note("slow.md", `${Array.from({ length: 2_000 }, () => "a".repeat(400)).join("\n")}\n`);
  const started = performance.now();
  const hits = await find({ by: "grep", pattern: "needle|a.*a.*x", path: "persistent-workspace/bounds", limit: 100 });
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(hits.map((h) => [h.path, h.line, h.text?.length])).toEqual([["persistent-workspace/bounds/found.md", 1, 400]]);
});
