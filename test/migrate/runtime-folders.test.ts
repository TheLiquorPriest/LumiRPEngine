// The runtime's folders: where today's runtime keeps them for an account, which of its unsent writes
// today's runtime would still send (its copy named by the storage's mark, or another's mark) and
// which it would throw away (no mark, or a copy behind its mark: one restored or moved), and a config
// that can't be read, whose owner can't be told.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "../../src/migrate/files";
import { copyFolderOf, readRuntimeFolders, runtimeFoldersOf, type RuntimeFolders } from "../../src/migrate/runtime-folders";

const IDENT = "lumi_rp_engine";
const BASE = "http://127.0.0.1:7860";

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

const mark = (copy: string, count: number): string => JSON.stringify({ v: 1, kind: "mirror", copy, count, owner: "elsewhere", at: 1 });

describe("the runtime's folders", () => {
  let root: string;
  let folders: RuntimeFolders;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rpe-migrate-runtime-"));
    folders = { configDir: join(root, "config"), dataDir: join(root, "data") };
    await put(join(folders.configDir, "home.json"), JSON.stringify({ lumiah: 1, runtime: { name: "home", base: BASE, extension: IDENT, listen: "127.0.0.1", port: 7861, relay: "r", secret: "s", session: { username: "player", token: "t" } } }));
    await put(join(folders.configDir, "broken.json"), "{ not a config");
    const copy = join(folders.dataDir, "runtimes", "home", "store", copyFolderOf(BASE, "player", IDENT));
    await put(join(copy, "identity.json"), JSON.stringify({ v: 1, kind: "working-copy", copy: "copy-a", count: 3 }));
    await put(join(copy, "docs", "upkeep.json"), "{\"v\":1}");
    await put(join(copy, "journal", `d.${sha256("upkeep.json")}`), JSON.stringify({ path: "upkeep.json", at: 1 }));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("are where today's runtime keeps them: absolute XDG folders, else under home", () => {
    expect(runtimeFoldersOf({ XDG_CONFIG_HOME: "/x/config", XDG_DATA_HOME: "/x/data" }, "/home/someone")).toEqual({ configDir: "/x/config/lumiah", dataDir: "/x/data/lumiah" });
    expect(runtimeFoldersOf({ XDG_CONFIG_HOME: "relative", XDG_DATA_HOME: "relative" }, "/home/someone")).toEqual({ configDir: "/home/someone/.config/lumiah", dataDir: "/home/someone/.local/share/lumiah" });
  });

  test("send what the copy hasn't sent when the storage's mark names it and it isn't behind", async () => {
    const read = await readRuntimeFolders(folders, IDENT, "player", mark("copy-a", 3));
    expect(read.unsent.map((u) => [u.kept, [...u.files.keys()]])).toEqual([[true, ["harness/docs/upkeep.json"]]]);
  });

  test("send it too when another copy's mark stands, as the runtime's own writes", async () => {
    expect((await readRuntimeFolders(folders, IDENT, "player", mark("copy-b", 9))).unsent[0]?.kept).toBe(true);
  });

  test("throw it away, as today's runtime would, with no mark or behind its own", async () => {
    expect((await readRuntimeFolders(folders, IDENT, "player", null)).unsent[0]?.kept).toBe(false);
    expect((await readRuntimeFolders(folders, IDENT, "player", mark("copy-a", 4))).unsent[0]?.kept).toBe(false);
  });

  test("a config that can't be read is kept apart: whose it is can't be told", async () => {
    const read = await readRuntimeFolders(folders, IDENT, "player", null);
    expect(read.unreadable.map((f) => f.path)).toEqual(["config/broken.json"]);
    expect(read.runtimes.map((r) => r.name)).toEqual(["home"]);
  });

  test("another user's copy is not this user's: nothing of it is laid over the storage", async () => {
    expect((await readRuntimeFolders(folders, IDENT, "someone-else", mark("copy-a", 3))).unsent).toEqual([]);
  });
});
