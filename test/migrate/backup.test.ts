// The backup: one archive of today's extension storage, the runtime's files and installed copy, and
// the chats with engine records; every file's checksum in its manifest matches the file it was
// made from, the archive reads back whole, and each run makes a new one without touching the data.
// It holds keys and session tokens, so it is its owner's alone, in a folder only its owner may
// enter, and it is never written over a file already there.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyBackup, type BackupResult } from "../../src/migrate/backup";
import { sha256 } from "../../src/migrate/files";
import { backup } from "../../src/migrate/rehearse";
import { buildFixture, CHAT, treeSums, type Fixture } from "./fixture";

describe("the backup", () => {
  let fixture: Fixture;
  let made: BackupResult;
  let before: Map<string, string>;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    before = await treeSums(join(fixture.root, "lumiverse", "users"));
    // As permissive a umask as an account may have: the backup must still be its owner's alone.
    const umask = process.umask(0o000);
    try {
      made = await backup(fixture.sources, join(fixture.root, "backups"), () => new Date("2026-11-13T12:00:00.000Z"));
    } finally {
      process.umask(umask);
    }
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("is readable by its owner alone, in a folder only its owner may enter: it holds keys and session tokens", async () => {
    expect((await stat(made.path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(fixture.root, "backups"))).mode & 0o777).toBe(0o700);
    expect(made.manifest.files.map((f) => f.name)).toContain("runtime/runtimes/home/secrets.json");
  });

  test("is never written over a file already at its name, which stays as it was", async () => {
    const name = join(fixture.root, "backups", "rpe-migration-backup-2026-11-13T12-10-00-000Z.tar");
    await writeFile(name, "someone else's file");
    await expect(backup(fixture.sources, join(fixture.root, "backups"), () => new Date("2026-11-13T12:10:00.000Z"))).rejects.toThrow("never writes over one");
    expect(await readFile(name, "utf8")).toBe("someone else's file");
  });

  test("holds every file of the user's storage, the extension's storage and the runtime, each with the checksum of the file it was made from", async () => {
    const byName = new Map(made.manifest.files.map((f) => [f.name, f.sha256]));
    for (const [path, sum] of await treeSums(fixture.userFolder)) expect(byName.get(`user/${path}`)).toBe(sum);
    for (const [path, sum] of await treeSums(fixture.extensionFolder)) expect(byName.get(`extension/${path}`)).toBe(sum);
    expect(byName.get("runtime/config/home.json")).toBe(sha256(await readFile(join(fixture.sources.runtime?.configDir ?? "", "home.json"))));
    expect([...byName.keys()].some((n) => n.startsWith("runtime/runtimes/home/store/"))).toBe(true);
    expect(byName.has("runtime/installed/lumiah.js")).toBe(true);
    expect(byName.has("runtime/unit/lumiah-home.service")).toBe(true);
    expect([...byName.keys()].some((n) => n.includes("standalone"))).toBe(false);
  });

  test("reads back whole: its own checksum, and every file against the manifest", async () => {
    expect(sha256(await readFile(made.path))).toBe(made.sha256);
    expect(await verifyBackup(made.path, made.sha256)).toEqual([]);
  });

  test("lists the chats with engine records, one user's only", async () => {
    const files = await new Bun.Archive(await readFile(made.path)).files();
    const chats = JSON.parse((await files.get("chats.json")?.text()) ?? "[]") as { chatId: string; turns: number }[];
    expect(chats.map((c) => c.chatId).sort()).toEqual([CHAT.agents, CHAT.branch, CHAT.classic, CHAT.fresh, CHAT.harness].sort());
    expect(chats.find((c) => c.chatId === CHAT.classic)?.turns).toBe(3);
  });

  test("a second run makes a new archive and leaves the data as it was", async () => {
    const again = await backup(fixture.sources, join(fixture.root, "backups"), () => new Date("2026-11-13T12:05:00.000Z"));
    expect(again.path).not.toBe(made.path);
    expect(await verifyBackup(again.path, again.sha256)).toEqual([]);
    expect(await treeSums(join(fixture.root, "lumiverse", "users"))).toEqual(before);
    await expect(backup(fixture.sources, join(fixture.root, "backups"), () => new Date("2026-11-13T12:05:00.000Z"))).rejects.toThrow("never writes over one");
  });

  test("a file damaged inside the archive is caught by its checksum", async () => {
    const bytes = new Uint8Array(await readFile(made.path));
    // The stray file's text, which sits in the archive as it is: one of its bytes is changed.
    const text = Buffer.from(bytes).indexOf("Who put this here?");
    expect(text).toBeGreaterThan(0);
    bytes[text] = "w".charCodeAt(0);
    const damaged = join(fixture.root, "backups", "damaged.tar");
    await Bun.write(damaged, bytes);
    const problems = await verifyBackup(damaged, made.sha256);
    expect(problems).toContain("The archive's checksum differs from the one reported when it was made.");
    expect(problems).toContain("user/stray-notes.txt doesn't match its checksum.");
  });
});
