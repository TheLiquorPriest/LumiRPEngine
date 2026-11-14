// The application's archive: a folder holding a file larger than the piece the writer reads at a
// time reads back byte for byte with a tar reader, long and non-ASCII names included; writing it
// does not grow the process's memory by the file's size, measured in a process of its own against a
// writer that reads each file whole; and an archive given up is closed and removed.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_PIECE_BYTES, TarWriter, walk } from "../../src/app/archive";

const BIG_BYTES = 64 * ARCHIVE_PIECE_BYTES + 12_345;
const LONG_NAME = `notes/${"a-very-long-folder-name/".repeat(5)}scene.md`;
const OTHER_NAME = "persönlich/Café.md";

/** A file's SHA-256, read a piece at a time. */
async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}

describe("the archive", () => {
  let root: string;
  let folder: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "rpe-archive-"));
    folder = join(root, "tree");
    await mkdir(join(folder, "persönlich"), { recursive: true });
    await mkdir(join(folder, LONG_NAME, ".."), { recursive: true });
    // Written a piece at a time, so that making it does not raise this process's memory either.
    const big = await open(join(folder, "rpe.db"), "w");
    for (let left = BIG_BYTES; left > 0; left -= ARCHIVE_PIECE_BYTES) await big.write(randomBytes(Math.min(left, ARCHIVE_PIECE_BYTES)));
    await big.close();
    await writeFile(join(folder, LONG_NAME), "# A scene\n");
    await writeFile(join(folder, OTHER_NAME), "Gift.\n");
    await writeFile(join(folder, "empty.md"), "");
    await symlink(join(folder, "empty.md"), join(folder, "link.md"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("the walk lists every file once, sorted, with links marked and never followed", async () => {
    const found = await walk(folder);
    expect(found.map((f) => f.path)).toEqual(["empty.md", "link.md", LONG_NAME, OTHER_NAME, "rpe.db"].sort());
    expect(found.find((f) => f.path === "link.md")?.link).toBe(true);
    expect(found.find((f) => f.path === "rpe.db")?.bytes).toBe(BIG_BYTES);
    expect(await walk(join(root, "nowhere"))).toEqual([]);
  });

  test("a folder holding a file larger than a piece reads back byte for byte", async () => {
    const out = join(root, "made.tar");
    const tar = TarWriter.open(out);
    const added = new Map<string, string>();
    for (const file of await walk(folder)) if (!file.link) added.set(file.path, (await tar.addFile(file.path, join(folder, file.path))).sha256);
    const closed = await tar.close();
    expect(closed.sha256).toBe(await fileHash(out));
    const entries = await new Bun.Archive(await Bun.file(out).bytes()).files();
    expect([...entries.keys()].sort()).toEqual([...added.keys()].sort());
    for (const [path, entry] of entries) {
      const bytes = await entry.bytes();
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(await fileHash(join(folder, path)));
      expect(added.get(path)).toBe(await fileHash(join(folder, path)));
    }
    expect(entries.get("rpe.db")?.size).toBe(BIG_BYTES);
  });

  test("writing it does not grow memory by the file's size", async () => {
    const script = join(import.meta.dir, "archive-memory.ts");
    const grew = async (mode: "pieces" | "whole"): Promise<number> => {
      const out = join(root, `${mode}.tar`);
      const child = Bun.spawn([process.execPath, script, mode, folder, out], { stdout: "pipe", stderr: "pipe" });
      const [text, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, errors }).toEqual({ code: 0, errors: "" });
      await rm(out, { force: true });
      return (JSON.parse(text) as { grew: number }).grew;
    };
    const whole = await grew("whole");
    const pieces = await grew("pieces");
    // The control: a writer that reads the file whole raises the peak by at least the file's size, so the measure sees it.
    expect(whole).toBeGreaterThanOrEqual(BIG_BYTES);
    // Read in pieces, the peak rises by a fixed few MiB of the runtime's own (measured: about 7 MiB for files of 16, 64 and 256 MiB alike), never by the file.
    expect(pieces).toBeLessThan(BIG_BYTES / 4);
  });

  test("an archive given up after an entry failed is closed and removed", async () => {
    const out = join(root, "given-up.tar");
    const tar = TarWriter.open(out);
    await tar.addFile("empty.md", join(folder, "empty.md"));
    await expect(tar.addFile("gone.md", join(folder, "gone.md"))).rejects.toThrow("ENOENT");
    await tar.discard();
    expect(existsSync(out)).toBe(false);
    // A file left open would be closed by the collector, which Bun reports as an error of the run.
    Bun.gc(true);
  });
});
