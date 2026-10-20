// The template validator holds a tipped job to its state's cash wage floor where the regions table
// records one (Michigan's, for Port Alder), not only to the federal floor.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const TEMPLATE = join(ROOT, "data-src/templates/modern-slice-of-life.json");

type Character = { id: string; job?: Record<string, unknown> };

/** The validator's complaints about Jess's wage, for Port Alder with her job's cash wage and tips set. */
function jessWageErrors(rateCents: number, tipsPerHourCents: number): string[] {
  const doc = JSON.parse(readFileSync(TEMPLATE, "utf8")) as { characters: Character[] };
  const jess = doc.characters.find((c) => c.id === "jess_kowalczyk");
  if (!jess?.job) throw new Error("no Jess in Port Alder");
  Object.assign(jess.job, { rateCents, tipsPerHourCents });
  const dir = mkdtempSync(join(tmpdir(), "lre-tipped-"));
  try {
    const file = join(dir, "modern-slice-of-life.json");
    writeFileSync(file, JSON.stringify(doc));
    const run = Bun.spawnSync([process.execPath, join(ROOT, "data-src/templates/validate.ts"), file], { cwd: ROOT });
    return `${run.stdout.toString()}${run.stderr.toString()}`.split("\n").filter((l) => l.includes("jess_kowalczyk") && l.includes("tipped floor"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("templates: tipped wages", () => {
  test("Michigan's tipped floor holds Port Alder's bartender: the federal $2.13 is under it, Michigan's $5.49 isn't", () => {
    expect(jessWageErrors(213, 1437)).toHaveLength(1);
    expect(jessWageErrors(549, 1101)).toEqual([]);
  });
});
