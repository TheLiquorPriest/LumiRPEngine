// The read-only stand-in for storage: a write, a move and a removal land in memory, where later
// reads and listings see them as the host would show them; each is listed; the folder on the disk
// is never touched; a path that climbs out of the folder is refused as Lumiverse refuses it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageView, type AttemptedWrite } from "../../src/migrate/stand-in";
import { treeSums } from "./fixture";

describe("the stand-in's view of a storage folder", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rpe-migrate-stand-in-"));
    await mkdir(join(root, "runs", "c1"), { recursive: true });
    await writeFile(join(root, "runs", "c1", "journal.json"), "{ damaged");
    await writeFile(join(root, "settings.json"), "{}");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("keeps a move, a write and a removal in memory, shows them to later reads, and leaves the disk alone", async () => {
    const before = await treeSums(root);
    const log: AttemptedWrite[] = [];
    const view = new StorageView("user storage", root, log, new Map([["harness/docs/a.json", "{\"unsent\":true}"]]));
    await view.move("runs/c1/journal.json", "runs/c1/journal.json.corrupt-1");
    view.write("runs/c1/journal.json.tmp", "{}");
    await view.move("runs/c1/journal.json.tmp", "runs/c1/journal.json");
    view.remove("settings.json");
    expect(await view.read("runs/c1/journal.json")).toBe("{}");
    expect(await view.read("runs/c1/journal.json.corrupt-1")).toBe("{ damaged");
    expect(await view.read("settings.json")).toBeNull();
    expect(await view.read("harness/docs/a.json")).toBe("{\"unsent\":true}");
    expect(await view.list("")).toEqual(["harness/docs/a.json", "runs/c1/journal.json", "runs/c1/journal.json.corrupt-1"]);
    expect(await view.list("runs/")).toEqual(["runs/c1/journal.json", "runs/c1/journal.json.corrupt-1"]);
    expect(log.map((w) => [w.op, w.path, w.to ?? null])).toEqual([
      ["move", "runs/c1/journal.json", "runs/c1/journal.json.corrupt-1"],
      ["write", "runs/c1/journal.json.tmp", null],
      ["move", "runs/c1/journal.json.tmp", "runs/c1/journal.json"],
      ["remove", "settings.json", null],
    ]);
    expect(await treeSums(root)).toEqual(before);
  });

  test("a move of a file that isn't there fails, as Lumiverse's does; a path out of the folder is refused", async () => {
    const view = new StorageView("user storage", root, []);
    await expect(view.move("nothing.json", "else.json")).rejects.toThrow("File not found");
    expect(() => view.write("../outside.json", "{}")).toThrow("Path traversal detected");
  });
});
