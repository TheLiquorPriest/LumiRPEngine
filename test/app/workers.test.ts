// A worker thread with nothing to do ends after the pool's idle time and lets its memory go; the next task starts another, and the
// index file's writer opens the file again on its new thread.

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineLog } from "../../src/app";
import { IndexFile } from "../../src/app/index-file/index-file";
import { Workers } from "../../src/app/workers/pool";

const log = lineLog(() => undefined);
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

/** Waits for a thread to end: real threads end in real time, which no fake clock moves, so the condition is looked at until it holds. */
async function until(what: string, check: () => boolean): Promise<void> {
  const end = Date.now() + 4_000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`waited for ${what}`);
    await Bun.sleep(5);
  }
}

test("a thread with no task ends after the idle time, and the next task starts another; the index file's writer writes on after its thread ended", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rpe-workers-"));
  closing.push(async () => rmSync(dir, { recursive: true, force: true }));
  const workers = new Workers({ threads: 2, name: "the idle test's pool", log, idleMs: 20 });
  closing.push(() => workers.close());
  const index = await IndexFile.open({ path: join(dir, "index.db"), workers, batch: 50, log });
  closing.push(() => index.close());

  expect(await workers.run("parseJson", new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
  expect(workers.running).toBe(1);
  await until("the pool's thread to end", () => workers.running === 0);
  expect(await workers.run("parseJson", new TextEncoder().encode('{"b":2}'))).toEqual({ b: 2 });

  await index.put("messages", "user-ann", [{ id: "m1", revision: "r1", scope: "chat-a", text: "the lamp turns" }]);
  await until("the writer's thread to end", () => index.threads === 0);
  await index.put("messages", "user-ann", [{ id: "m2", revision: "r1", scope: "chat-a", text: "the lamp is lit" }]);
  expect((await index.search("messages", "user-ann", "lamp", { limit: 10 })).map((hit) => hit.id).sort()).toEqual(["m1", "m2"]);
});
