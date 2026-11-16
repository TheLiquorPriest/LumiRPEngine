// The file port stays fast and safe on a long chat (plan §4.7): an append to a session file answers the hash and the `before` of the whole
// file without reading it again, a range of a long file is read with its size, lines and hash, and a pattern that never returns is
// stopped at the grep's time on a thread of the pool while another request is answered. Every name and text is invented.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import { Workers } from "../../src/app";
import { treeFiles } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

const SCOPE = { user: "u1", chat: "c1", session: "s-1" };
const HARNESS = "harness" as const;
const quiet: Log = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Log;

let laid: LaidTree;
let place: string;
let workers: Workers;

beforeAll(async () => {
  place = join(tmpdir(), `rpe-running-${crypto.randomUUID()}`);
  laid = await layTree({ scope: SCOPE, files: [] } as never, place);
  workers = new Workers({ threads: 1, name: "test", log: quiet });
});

afterAll(async () => {
  await workers.close();
  await laid.close();
  await rm(place, { recursive: true, force: true });
});

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

test("a thousand appends to a session file each answer the hash of the whole file and what it was before, and a range of it is read with its size, lines and hash", async () => {
  const port = treeFiles({ files: laid.files, user: SCOPE.user, chats: laid.chats, turnFolder: async () => null, writes: laid.writes, now: () => 1 });
  const path = "sessions/s-1/s-1.jsonl";
  let whole = "";
  for (let i = 1; i <= 1000; i++) {
    const text = `{"n":${i}}${i % 250 === 0 ? "" : "\n"}`;
    const before = whole === "" ? null : sha(whole);
    whole += text;
    const written = await port.write(SCOPE, path, { op: "append", text }, HARNESS);
    expect(written).toMatchObject({ status: "written", bytes: Buffer.byteLength(whole), hash: sha(whole), before });
    // A text with no break leaves its line open, and the next text goes on it.
    if (i % 250 === 0) whole += "\n";
    if (i % 250 === 0) await port.write(SCOPE, path, { op: "append", text: "\n" }, HARNESS);
  }
  const disk = join(laid.levelDir("chat"), path);
  expect(await readFile(disk, "utf8")).toBe(whole);
  const lines = whole.split("\n").length - 1;
  const read = await port.read(SCOPE, path, { start: 10, end: 12 });
  expect(read).toMatchObject({ status: "read", text: '{"n":10}\n{"n":11}\n{"n":12}\n', start: 10, end: 12, lines, bytes: Buffer.byteLength(whole), hash: sha(whole) });
  // A file changed by another hand is read whole once more: what the port kept of it is not trusted.
  await writeFile(disk, "one\ntwo\n");
  expect(await port.read(SCOPE, path, { start: 2 })).toMatchObject({ text: "two\n", lines: 2, bytes: 8, hash: sha("one\ntwo\n") });
});

test("a pattern of nested repeats on a long line stops at the grep's time on the pool, says it stopped for time, and another request is answered meanwhile", async () => {
  await writeFile(join(laid.levelDir("chat"), "RPE.yml"), "files:\n  grepMs: 300\n");
  await writeFile(join(laid.levelDir("chat"), "WORLD.md"), `${"a".repeat(60)}\n`);
  const port = treeFiles({ files: laid.files, user: SCOPE.user, chats: laid.chats, turnFolder: async () => null, writes: laid.writes, now: () => 1, workers });
  const started = performance.now();
  const grep = port.find(SCOPE, { by: "grep", pattern: "(a+)+b", path: "WORLD.md" });
  // Nothing holds the main thread: a read is answered while the pattern runs.
  expect((await port.read(SCOPE, "WORLD.md")).status).toBe("read");
  const found = await grep;
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(found).toMatchObject({ status: "found", hits: [], stopped: { time: { ms: 300 } } });
  // The pool starts another thread for the next task.
  expect(await port.find(SCOPE, { by: "grep", pattern: "aaa", path: "WORLD.md", limit: 1 })).toMatchObject({ status: "found", hits: [{ line: 1 }] });
});
