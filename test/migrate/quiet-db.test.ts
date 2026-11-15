// A database nobody is writing is read without anything being left beside it, both ways the reader
// has: as an unchanging file where the runtime's SQLite takes a `file:` address, and from a copy in
// memory where it takes none (Bun's SQLite on Linux), which is the way a real migration run made again
// on a server reads RPE's own database and Lumiverse's when it is stopped.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCopy, openQuiet } from "../../src/migrate/quiet-db";

describe("reading a quiet database", () => {
  let folder: string;
  let file: string;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "rpe-quiet-test-"));
    file = join(folder, "story.db");
    const db = new Database(file);
    db.run("PRAGMA journal_mode = WAL");
    db.run("CREATE TABLE line (said TEXT)");
    db.run("INSERT INTO line VALUES ('The lamp is lit.')");
    // As a server stopped cleanly leaves it: everything in the file, no log or index beside it.
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    await rm(`${file}-wal`, { force: true });
    await rm(`${file}-shm`, { force: true });
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const said = (db: Database): string | undefined => db.query<{ said: string }, []>("SELECT said FROM line").get()?.said;

  test("reads it and leaves nothing beside it", async () => {
    expect(await readdir(folder)).toEqual(["story.db"]);
    const opened = openQuiet(file);
    expect(said(opened.db)).toBe("The lamp is lit.");
    opened.close();
    expect(await readdir(folder)).toEqual(["story.db"]);
  });

  test("from a copy in memory: the same rows, nothing beside the original, and no file made in the temporary folder, even while it is open", async () => {
    const before = (await readdir(tmpdir())).filter((name) => name.startsWith("rpe-read-"));
    const opened = openCopy(file);
    expect(said(opened.db)).toBe("The lamp is lit.");
    expect(await readdir(folder)).toEqual(["story.db"]);
    expect((await readdir(tmpdir())).filter((name) => name.startsWith("rpe-read-"))).toEqual(before);
    opened.close();
    expect(await readdir(folder)).toEqual(["story.db"]);
  });
});
