// What one find may cost RPE's one thread, and that a find stopped by one of its bounds says so: a find
// that names no limit gives at most `files.findHits` (RPH holds a limit an agent names to
// `tools.perCall`), a grep passes over files larger than `files.grepBytes`, tests at most
// `files.grepLineChars` of each line and stops once it has run `files.grepMs`, so a pattern that
// backtracks on the turn folder's very long lines cannot hold every chat and every Stop. Each of
// them stopping is in the answer's `stopped`, never left for the agent to guess.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { FileQuery, Found } from "rp-harness/contract";
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

async function find(query: FileQuery): Promise<Found> {
  const found = await tree.port.find(scope, query);
  if (found.status !== "found") throw new Error(`refused: ${found.reason}`);
  return found;
}

test("a find that names no limit gives at most files.findHits, and one that names a limit gets it: RPE's own listing of a folder of more entries than that is whole", async () => {
  await settings("files:\n  findHits: 3\n");
  for (let n = 0; n < 6; n++) await note(`n${n}.md`, "the tide\n");
  expect((await find({ by: "list", path: "persistent-workspace/bounds" })).hits).toHaveLength(3);
  expect((await find({ by: "glob", pattern: "*.md", path: "persistent-workspace/bounds" })).hits).toHaveLength(3);
  expect((await find({ by: "grep", pattern: "tide", path: "persistent-workspace/bounds" })).hits).toHaveLength(3);
  // As the Turn page's listing of a turn's folder asks: every level down, with no end.
  const whole = await find({ by: "list", path: "persistent-workspace/bounds", depth: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY });
  expect(whole.hits).toHaveLength(6);
  expect(whole.stopped).toBeUndefined();
  expect((await find({ by: "glob", pattern: "*.md", path: "persistent-workspace/bounds", limit: 100 })).hits).toHaveLength(6);
  expect((await find({ by: "grep", pattern: "tide", path: "persistent-workspace/bounds", limit: 100 })).hits).toHaveLength(6);
});

test("a grep tests only files.grepLineChars of a long line, and stops with what it found once it has run files.grepMs", async () => {
  await settings("files:\n  grepLineChars: 400\n  grepMs: 50\n");
  // A pattern with two open repeats takes time that grows with the cube of the text it is tested on.
  const long = "a".repeat(3_000);
  await note("found.md", `needle ${long}\n`);
  await note("slow.md", `${Array.from({ length: 2_000 }, () => "a".repeat(400)).join("\n")}\n`);
  const started = performance.now();
  const found = await find({ by: "grep", pattern: "needle|a.*a.*x", path: "persistent-workspace/bounds", limit: 100 });
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(found.hits.map((h) => [h.path, h.line, h.text?.length])).toEqual([["persistent-workspace/bounds/found.md", 1, 400]]);
});

test("each bound says it stopped: the limit when more hits were there, the files too large, the lines cut, the time", async () => {
  await settings("files:\n  findHits: 2\n  grepBytes: 100\n  grepLineChars: 20\n");
  await note("a.md", "tide one\ntide two\ntide three\n");
  // Exactly the limit is no stop: one past it is looked for.
  expect(await find({ by: "grep", pattern: "tide", path: "persistent-workspace/bounds/a.md", limit: 3 })).toEqual({ status: "found", hits: expect.any(Array) });
  await note("b.md", "tide four\n");
  await note("c.md", "tide five\n");
  for (const query of [{ by: "list" }, { by: "glob", pattern: "*.md" }, { by: "grep", pattern: "tide" }] as const) {
    const found = await find({ ...query, path: "persistent-workspace/bounds" });
    expect({ by: query.by, hits: found.hits.length, stopped: found.stopped }).toEqual({ by: query.by, hits: 2, stopped: { limit: { max: 2 } } });
  }

  await note("big.md", `tide ${"x".repeat(200)}\n`);
  await note("long.md", `tide ${"y".repeat(40)}\n`);
  const grep = await find({ by: "grep", pattern: "tide", path: "persistent-workspace/bounds", glob: "{big,long}.md" });
  expect(grep).toEqual({ status: "found", hits: [expect.objectContaining({ path: "persistent-workspace/bounds/long.md", line: 1, text: `tide ${"y".repeat(15)}` })], stopped: { large: { files: 1, bytes: 100 }, cut: { lines: 1, chars: 20 } } });

  await settings("files:\n  grepLineChars: 400\n  grepMs: 30\n");
  await note("slow.md", `${Array.from({ length: 2_000 }, () => "a".repeat(400)).join("\n")}\n`);
  const late = await find({ by: "grep", pattern: "a.*a.*x", path: "persistent-workspace/bounds/slow.md", limit: 100 });
  expect(late).toEqual({ status: "found", hits: [], stopped: { time: { ms: 30 } } });
});
