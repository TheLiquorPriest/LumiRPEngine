// The index of vectors for search by meaning, on an index file of its own, with a made-up embedder: one number per letter of the alphabet.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embedded } from "rp-harness/contract";
import { lineLog } from "../../src/app";
import { IndexFile } from "../../src/app/index-file/index-file";
import { Workers } from "../../src/app/workers/pool";
import { MEANING_TABLE, MeaningIndex } from "../../src/search/meaning";

const letters = (text: string): number[] => [..."abcdefghijklmnopqrstuvwxyz"].map((l) => [...text.toLowerCase()].filter((c) => c === l).length);

let dir = "";
let workers: Workers;
let index: IndexFile;
let embedded: string[] = [];
let set = true;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rpe-meaning-"));
  const log = lineLog(() => undefined);
  workers = new Workers({ threads: 1, name: "the meaning test's pool", log });
  index = await IndexFile.open({ path: join(dir, "index.db"), workers, batch: 50, log });
  await index.table(MEANING_TABLE);
  embedded = [];
  set = true;
});

afterEach(async () => {
  await index.close();
  await workers.close();
  rmSync(dir, { recursive: true, force: true });
});

const meaning = (): MeaningIndex =>
  new MeaningIndex({
    index,
    embed: async (_user, texts): Promise<Embedded> => {
      if (!set) return { status: "none", words: "no embedding connection" };
      embedded.push(...texts);
      return { status: "embedded", connection: "c1", model: "m1", vectors: texts.map(letters) };
    },
  });

describe("search by meaning", () => {
  test("no connection, no meaning; a changed entry is embedded again; a dropped chat is rebuilt on next need", async () => {
    const m = meaning();
    set = false;
    let read = 0;
    expect(await m.nearest("u", "c", "lore", "zzz", 2, () => (read++, []))).toBeNull();
    expect(read).toBe(0);
    set = true;
    const docs = [
      { id: "e-1", revision: "1", text: "zzzz quiz" },
      { id: "e-2", revision: "1", text: "aaaa" },
    ];
    expect(await m.nearest("u", "c", "lore", "zzz", 1, () => docs)).toEqual(["e-1"]);
    expect(embedded).toEqual(["zzz", "zzzz quiz", "aaaa"]);
    embedded = [];
    docs[1] = { id: "e-2", revision: "2", text: "zzzzzz" };
    expect(await m.nearest("u", "c", "lore", "zzz", 1, () => docs)).toEqual(["e-2"]);
    expect(embedded).toEqual(["zzz", "zzzzzz"]);
    await m.dropChat("u", "c");
    expect(await index.rows(MEANING_TABLE, "u", "lore:c")).toEqual([]);
    embedded = [];
    expect(await m.nearest("u", "c", "lore", "quiz", 2, () => docs)).toEqual(["e-1", "e-2"]);
    expect(embedded).toEqual(["quiz", "zzzz quiz", "zzzzzz"]);
  });
});
