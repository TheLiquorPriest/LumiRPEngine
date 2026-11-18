// RPE's record of its last run: a run that ends as it chose says how in the record, and the next start's first log line says why it began; a
// run that left no word (killed, out of memory) is said to have ended without saying why; no record is a first start.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginRun, endRun, readRun, startedLine } from "../../src/app/run-record";

describe("RPE's record of its last run", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rpe-run-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("each way a run ends is said by the next start, with the build, and no record is a first start", async () => {
    expect(await readRun(root)).toBeNull();
    expect(startedLine(null, "b2", false).message).toContain("first start here");

    await beginRun(root, "b1", 1_000);
    const open = await readRun(root);
    expect(open).toEqual({ build: "b1", started: 1_000, ending: null });
    // Killed, or out of memory: nothing was written.
    expect(startedLine(open, "b1", true)).toMatchObject({ message: expect.stringContaining("started by its service, after its last run, on build b1, ended without saying why"), fields: { why: "the last run ended without saying why", service: true } });

    await endRun(root, { why: "restart" }, 2_000);
    expect(startedLine(await readRun(root), "b1", true).message).toBe("RPE started on build b1, after the restart you asked for.");

    await endRun(root, { why: "update", to: "b2" }, 3_000);
    expect(startedLine(await readRun(root), "b2", true)).toMatchObject({ message: "RPE started on build b2, after an update from build b1.", fields: { why: "an update", previousBuild: "b1", build: "b2" } });

    await endRun(root, { why: "stop" }, 4_000);
    expect(startedLine(await readRun(root), "b1", false).message).toBe("RPE started on build b1 after it was stopped.");

    await endRun(root, { why: "failed", error: "The database is locked." }, 5_000);
    expect(startedLine(await readRun(root), "b1", false).message).toContain("failed: The database is locked.");
  });
});
