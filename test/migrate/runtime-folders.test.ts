// The runtime's folders: where today's runtime keeps them for an account; which runtime there is
// this user's (the one they registered with this Lumiverse, as today's extension tells runtimes
// apart), with every other one left alone and nothing of it read past its config; when the run can't
// tell, and how it is told; and which of the taken runtime's unsent writes today's runtime would
// still send (its copy named by the storage's mark, or another's mark) and which it would throw away
// (no mark, or a copy behind its mark: one restored or moved).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256 } from "../../src/migrate/files";
import { copyFolderOf, readRuntimeFolders, runtimeFoldersOf, type RuntimeFolders, type RuntimeOwner } from "../../src/migrate/runtime-folders";

const IDENT = "lumi_rp_engine";
const BASE = "http://127.0.0.1:7860";

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

const mark = (copy: string, count: number): string => JSON.stringify({ v: 1, kind: "mirror", copy, count, owner: "elsewhere", at: 1 });
const config = (name: string, username: string, base: string, relay: string, secret: string): string => JSON.stringify({ lumiah: 1, runtime: { name, base, extension: IDENT, listen: "127.0.0.1", port: 7861, relay, secret, session: { username, token: `${name}-session` } } });
/** A user's registry in this Lumiverse's storage, holding these registrations: relay id, runtime name, secret. */
const registry = (...relays: [string, string, string][]): string => JSON.stringify({ v: 1, key: null, relays: Object.fromEntries(relays.map(([id, name, secret]) => [id, { id, name, secret: sha256(secret), listen: "127.0.0.1", port: 7861 }])), replied: false });
const player = (registryText: string | null, named: string | null = null): RuntimeOwner => ({ username: "player", registry: registryText, named });

describe("the runtime's folders", () => {
  let root: string;
  let folders: RuntimeFolders;
  const mine = registry(["r-home", "home", "s-home"]);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rpe-migrate-runtime-"));
    folders = { configDir: join(root, "config"), dataDir: join(root, "data") };
    // This user's runtime on this Lumiverse; theirs on another Lumiverse, under the same name; another user's.
    await put(join(folders.configDir, "home.json"), config("home", "player", BASE, "r-home", "s-home"));
    await put(join(folders.configDir, "away.json"), config("away", "player", "http://127.0.0.1:9900", "r-away", "s-away"));
    await put(join(folders.configDir, "neighbour.json"), config("neighbour", "neighbour", BASE, "r-next", "s-next"));
    await put(join(folders.dataDir, "runtimes", "home", "secrets.json"), "home's keys");
    await put(join(folders.dataDir, "runtimes", "away", "secrets.json"), "away's keys");
    await put(join(folders.dataDir, "runtimes", "neighbour", "secrets.json"), "the neighbour's keys");
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

  test("the run takes the one runtime this user registered with this Lumiverse, and reads nothing of the others past their config", async () => {
    const read = await readRuntimeFolders(folders, IDENT, player(mine), null);
    expect(read.runtimes.map((r) => r.name)).toEqual(["home"]);
    expect(read.undecided).toBeNull();
    const paths = read.files.map((f) => f.path);
    expect(paths).toContain("config/home.json");
    expect(paths).toContain("runtimes/home/secrets.json");
    expect(paths.filter((p) => !(p === "config/home.json" || p.startsWith("runtimes/home/") || p.startsWith("installed/")))).toEqual([]);
    expect(read.leftAlone).toEqual([
      { name: "away", why: "signs in as this user's name, but is not registered with this Lumiverse for this user: another Lumiverse's runtime, or one whose registration was replaced" },
      { name: "neighbour", why: "signs in to Lumiverse as another user" },
    ]);
    // A registration whose secret isn't the config's is no registration of that runtime.
    expect((await readRuntimeFolders(folders, IDENT, player(registry(["r-home", "home", "another secret"])), null)).runtimes).toEqual([]);
  });

  test("with two registered, the run can't tell which is the user's and says how to tell it; named, it takes that one", async () => {
    const both = registry(["r-home", "home", "s-home"], ["r-away", "away", "s-away"]);
    const read = await readRuntimeFolders(folders, IDENT, player(both), null);
    expect(read.runtimes).toEqual([]);
    expect(read.files.some((f) => f.path.startsWith("runtimes/"))).toBe(false);
    expect(read.undecided).toBe("Several runtimes of today's build are registered with this Lumiverse for this user (away, home): say which one this run takes with --runtime <name>.");
    const named = await readRuntimeFolders(folders, IDENT, player(both, "away"), null);
    expect(named.runtimes.map((r) => [r.name, r.why])).toEqual([["away", "named with --runtime, and registered with this Lumiverse for this user"]]);
    expect(named.undecided).toBeNull();
  });

  test("a runtime named that signs in as another user, or isn't there, is not taken", async () => {
    expect((await readRuntimeFolders(folders, IDENT, player(mine, "neighbour"), null)).undecided).toBe("The runtime neighbour signs in to Lumiverse as another user, so its connections and keys are not this user's: this run doesn't take it.");
    const none = await readRuntimeFolders(folders, IDENT, player(mine, "nowhere"), null);
    expect(none.runtimes).toEqual([]);
    expect(none.undecided).toBe(`There is no runtime nowhere of this extension in ${folders.configDir}: there are away, home, neighbour.`);
  });

  test("with no registration in the user's storage, a runtime signing in as their name can't be told theirs", async () => {
    const read = await readRuntimeFolders(folders, IDENT, player(null), null);
    expect(read.runtimes).toEqual([]);
    expect(read.undecided).toContain("say which with --runtime <name>, or that none is with --no-runtime");
    // Another user's run, with no registration of its own here: nothing is its, and nothing is undecided.
    const other = await readRuntimeFolders(folders, IDENT, { username: "stranger", registry: null, named: null }, null);
    expect({ runtimes: other.runtimes, undecided: other.undecided, unsent: other.unsent }).toEqual({ runtimes: [], undecided: null, unsent: [] });
  });

  test("a config that can't be read is left alone beside the user's runtime; with none registered, whose it is can't be told", async () => {
    await put(join(folders.configDir, "broken.json"), "{ not a config");
    try {
      const read = await readRuntimeFolders(folders, IDENT, player(mine), null);
      expect(read.runtimes.map((r) => r.name)).toEqual(["home"]);
      expect(read.leftAlone).toContainEqual({ name: "broken", why: "its config can't be read, so whose it is can't be told" });
      expect(read.files.some((f) => f.path.includes("broken"))).toBe(false);
      expect((await readRuntimeFolders(folders, IDENT, player(registry()), null)).undecided).toContain("the config of broken can't be read, so whether it is theirs can't be told");
    } finally {
      await rm(join(folders.configDir, "broken.json"));
    }
  });

  test("for a config written before today's runtime recorded its unit, the unit its install line made is the one that keeps it running, and it is read with the rest", async () => {
    // `lumiah up --systemd` puts it in the account's user units, beside the configs' folder; such a config's memory cap is in it alone.
    const unit = join(root, "systemd", "user", "lumiah-home.service");
    await put(unit, "[Service]\nExecStart=/opt/bun/bin/bun lumiah.js serve\nMemoryMax=3G\n");
    try {
      const read = await readRuntimeFolders(folders, IDENT, player(mine), null);
      expect(read.runtimes[0]?.config.service).toEqual({ unit: "lumiah-home.service", file: unit, script: join(folders.dataDir, IDENT, "lumiah.js") });
      expect(read.files.filter((f) => f.path.startsWith("unit/")).map((f) => [f.path, f.disk])).toEqual([["unit/lumiah-home.service", unit]]);
    } finally {
      await rm(join(root, "systemd"), { recursive: true });
    }
    // With no unit there, nothing keeps it running.
    expect((await readRuntimeFolders(folders, IDENT, player(mine), null)).runtimes[0]?.config.service).toBeNull();
  });

  test("send what the copy hasn't sent when the storage's mark names it and it isn't behind", async () => {
    const read = await readRuntimeFolders(folders, IDENT, player(mine), mark("copy-a", 3));
    expect(read.unsent.map((u) => [u.kept, [...u.files.keys()]])).toEqual([[true, ["harness/docs/upkeep.json"]]]);
  });

  test("send it too when another copy's mark stands, as the runtime's own writes", async () => {
    expect((await readRuntimeFolders(folders, IDENT, player(mine), mark("copy-b", 9))).unsent[0]?.kept).toBe(true);
  });

  test("throw it away, as today's runtime would, with no mark or behind its own", async () => {
    expect((await readRuntimeFolders(folders, IDENT, player(mine), null)).unsent[0]?.kept).toBe(false);
    expect((await readRuntimeFolders(folders, IDENT, player(mine), mark("copy-a", 4))).unsent[0]?.kept).toBe(false);
  });
});
