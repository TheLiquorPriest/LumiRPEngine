// The list of fates (PlanSwap-4 item 1): every file of today's build has one fate, settled by its
// path, and what kept code needs of a file that goes is named with its home and the package that
// moves it.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { missing, oldFiles, readFates, unsettled } from "./fates";

describe("the fates of today's files", () => {
  const fates = readFates();
  const scratch = mkdtempSync(join(tmpdir(), "rpe-fates-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** A tree of its own: today's folders with the files named, each an empty module. */
  const tree = (name: string, paths: readonly string[]): string => {
    const root = join(scratch, name);
    for (const path of paths) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "export {};\n");
    }
    return root;
  };

  test("every line says a fate someone can act on", () => {
    expect(fates.problems).toEqual([]);
  });

  test("every file of today's build has exactly one fate, and every kept file is there", () => {
    expect(unsettled(oldFiles(), fates)).toEqual([]);
    expect(missing(fates)).toEqual([]);
  });

  test("a new file with no fate fails, and so does a file given two", () => {
    const root = tree("new-file", ["src/shared/kept.ts", "src/engine/new-thing.ts", "src/backend.ts"]);
    const list = readFates(["src/shared/kept.ts\tkept\tunder", "src/backend.ts\tremoved\tPlanSwap-9\thalves"].join("\n"));
    expect(unsettled(oldFiles(root), list)).toEqual(["src/engine/new-thing.ts"]);
    const twice = readFates(["src/shared/kept.ts\tkept\tunder", "src/shared/kept.ts\tremoved\tPlanSwap-10\ttexts"].join("\n"));
    expect(twice.problems).toEqual(["fates.tsv:2 (src/shared/kept.ts): a second fate (the first is at line 1)"]);
  });

  test("a kept file that is gone fails; a removed one that is gone is the report of what went", () => {
    const root = tree("gone", ["src/engine/here.ts"]);
    const list = readFates(["src/engine/here.ts\tkept\tengine", "src/engine/gone.ts\tkept\tengine", "src/backend/went.ts\tremoved\tPlanSwap-8\tclassic"].join("\n"));
    expect(missing(list, root)).toEqual(["src/engine/gone.ts: kept, and not on disk"]);
  });

  test("files that share a name with a part §15.4 removes are settled by their path", () => {
    for (const path of ["src/engine/steps.ts", "src/shared/claims.ts", "src/shared/sections.ts"]) expect(fates.files.get(path)?.fate).toBe("kept");
    for (const path of ["src/backend/steps.ts", "src/backend/turn-steps.ts", "src/backend/claims.ts", "src/backend/sections-build.ts", "src/backend/section-refs.ts"]) {
      expect(fates.files.get(path)).toMatchObject({ fate: "removed", by: "PlanSwap-8", row: "classic" });
    }
  });

  test("every piece that moves names its home and the package that moves it", () => {
    for (const piece of fates.pieces) {
      expect(piece.home).not.toBe("");
      expect(piece.by).toMatch(/^Plan[A-Z][A-Za-z]*-[A-Z]?\d+$/);
      expect(["removed", "moved"]).toContain(fates.files.get(piece.path)?.fate ?? "");
    }
    const broken = readFates(["src/backend/runtime.ts\tremoved\tPlanSwap-8\thalves", "src/backend/runtime.ts\tpiece\tPlanSwap-5\t\treadRun", "src/backend/runtime.ts\tpiece\t\tsrc/play/unfit.ts\tunfitReason"].join("\n"));
    expect(broken.problems).toEqual(["fates.tsv:2 (src/backend/runtime.ts): the piece has no home", "fates.tsv:3 (src/backend/runtime.ts): the package that moves it is not named"]);
  });

  test("what kept code needs of today's runtime leaves it, and the tidy's only call is not carried", () => {
    const of = (path: string) => fates.pieces.filter((piece) => piece.path === path).map(({ by, home }) => ({ by, home }));
    expect(of("src/backend/runtime.ts")).toEqual([
      { by: "PlanSwap-5", home: "src/migrate/today/" },
      { by: "PlanTurnKinds-21", home: "src/play/unfit.ts" },
    ]);
    expect(of("src/backend/chat-knowledge-prefs.ts")).toEqual([{ by: "PlanSwap-5", home: "src/migrate/today/" }]);
    expect(fates.files.get("src/engine/thing-tidy.ts")?.fate).toBe("kept");
    expect(fates.cuts.filter((cut) => cut.path === "src/engine/thing-tidy.ts").map((cut) => cut.by)).toEqual(["PlanSwap-8"]);
  });

  test("the old protocol and the settings registry move in part before the rest goes, so what still needs them may import them", () => {
    for (const path of ["src/shared/protocol.ts", "src/shared/settings.ts"]) {
      expect(fates.files.get(path)).toMatchObject({ fate: "moved", by: "PlanSwap-13" });
      expect(fates.pieces.filter((piece) => piece.path === path).length).toBeGreaterThan(0);
    }
    expect(fates.files.get("src/frontend/gm/things.tsx")?.fate).toBe("kept");
    expect(fates.files.get("src/frontend/play/gm.tsx")).toMatchObject({ fate: "removed", by: "PlanSwap-9" });
  });
});
