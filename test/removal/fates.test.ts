// The list of fates (PlanSwap-4 item 1, and the fix of its landing review): every file of today's
// build has one fate, settled by its path; what kept code needs of a file that goes is named with its
// home and the package that moves it; what the plan removes reads removed, the agents engine's shared
// files among them; and a test of a kept system is never removed with a folder that goes.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { KEPT, missing, NO_PACKAGE, oldFiles, PACKAGE, readFates, ROOT, unsettled } from "./fates";
import { readTree } from "./imports";

describe("the fates of today's files", () => {
  const fates = readFates();
  const scratch = mkdtempSync(join(tmpdir(), "rpe-fates-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const piecesOf = (path: string) => fates.pieces.filter((piece) => piece.path === path);

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

  test("a moved file that is gone counts as moved only at a home that names its file, never at a folder that merely exists", () => {
    const root = tree("moved", ["src/ui/other.tsx", "src/ui/store.ts"]);
    const list = readFates(["src/frontend/gm/ui.tsx\tmoved\tPlanSwap-9\tsrc/ui/\tthe GM's page", "src/frontend/store.ts\tmoved\tPlanSwap-6\tsrc/ui/store.ts\tthe store"].join("\n"));
    expect(missing(list, root)).toEqual(["src/frontend/gm/ui.tsx: gone, and its home src/ui/ is a folder; name the file it moved to"]);
  });

  test("files that share a name with a part §15.4 removes are settled by their path", () => {
    for (const path of ["src/engine/steps.ts", "src/shared/claims.ts", "src/shared/sections.ts"]) expect(fates.files.get(path)?.fate).toBe("kept");
    for (const path of ["src/backend/steps.ts", "src/backend/turn-steps.ts", "src/backend/claims.ts", "src/backend/sections-build.ts", "src/backend/section-refs.ts"]) {
      expect(fates.files.get(path)).toMatchObject({ fate: "removed", by: "PlanSwap-8", row: "classic" });
    }
  });

  test("every piece names its home and the package that moves it, or that no planner's package does yet", () => {
    for (const piece of fates.pieces) {
      expect(piece.home).not.toBe("");
      expect(PACKAGE.test(piece.by) || piece.by === NO_PACKAGE).toBe(true);
      expect(["removed", "moved"]).toContain(fates.files.get(piece.path)?.fate ?? "");
    }
    const broken = readFates(["src/backend/runtime.ts\tremoved\tPlanSwap-8\thalves", "src/backend/runtime.ts\tpiece\tPlanSwap-5\t\treadRun", "src/backend/runtime.ts\tpiece\t\tsrc/play/unfit.ts\tunfitReason", "src/backend/runtime.ts\tpiece\tPlanSwap-5\tsrc/migrate/today/\treadRun\treadRun\t"].join("\n"));
    expect(broken.problems).toEqual(["fates.tsv:2 (src/backend/runtime.ts): the piece has no home", "fates.tsv:3 (src/backend/runtime.ts): the package that moves it is not named", "fates.tsv:4 (src/backend/runtime.ts): an allowance names both its names and the files they are for"]);
  });

  test("what kept code needs of today's runtime leaves it, and the tidy's only call is not carried", () => {
    const of = (path: string) => piecesOf(path).map(({ by, home }) => ({ by, home }));
    expect(of("src/backend/runtime.ts")).toEqual([
      { by: "PlanSwap-5", home: "src/migrate/today/" },
      { by: "PlanTurnKinds-21", home: "src/play/unfit.ts" },
    ]);
    expect(of("src/backend/chat-knowledge-prefs.ts")).toEqual([{ by: "PlanSwap-5", home: "src/migrate/today/" }]);
    expect(fates.files.get("src/engine/thing-tidy.ts")?.fate).toBe("kept");
    expect(fates.cuts.filter((cut) => cut.path === "src/engine/thing-tidy.ts").map((cut) => cut.by)).toEqual(["PlanSwap-8"]);
  });

  test("the agents engine's shared files go, and what kept code takes of them is named as pieces", () => {
    for (const path of ["src/shared/agent-settings.ts", "src/shared/agent-roles.ts", "src/shared/agent-context.ts", "src/shared/agent-tools.ts", "src/shared/agent-tools-read.ts", "src/shared/agent-tools-write.ts", "src/shared/agent-pipeline.ts"]) {
      expect(fates.files.get(path)).toMatchObject({ fate: "removed", by: "PlanSwap-10" });
    }
    expect(fates.files.get("src/shared/agent-pipeline.ts")).toMatchObject({ row: "agents" });
    expect(piecesOf("src/shared/agent-settings.ts").map(({ by, home }) => ({ by, home }))).toEqual([
      { by: "PlanSwap-15", home: "src/engine/ledger/fold.ts" },
      { by: "PlanSwap-15", home: "src/frontend/review-card.tsx" },
      { by: "PlanSwap-15", home: "src/migrate/today/" },
    ]);
    expect(piecesOf("src/shared/agent-tools.ts")).toEqual([expect.objectContaining({ by: "PlanSwap-15", home: "src/engine/workspace.ts", what: expect.stringContaining("isAgentKnowledge, AGENT_KNOWLEDGE and AgentKnowledge") })]);
    // The old engines' diagnostics go the same way: Build's jobs page keeps its formatter; the CLI's one type is PlanOps-15's to end.
    expect(fates.files.get("src/shared/diagnostics.ts")).toMatchObject({ fate: "removed", by: "PlanSwap-10", row: "ui" });
    expect(piecesOf("src/shared/diagnostics.ts").map(({ by, home }) => ({ by, home }))).toEqual([
      { by: "PlanSwap-15", home: "src/frontend/build/jobs.tsx" },
      { by: "PlanSwap-15", home: "src/migrate/today/" },
    ]);
  });

  test("what kept code needs of other files that go is named: the ledger's final edits, the knowledge switch, the kept UI's client; and the HUD's cuts", () => {
    expect(piecesOf("src/shared/final-review.ts")).toEqual([expect.objectContaining({ by: "PlanSwap-15", home: "src/shared/ledger.ts", what: expect.stringContaining("FinalEdit and finalEditsOf") })]);
    expect(piecesOf("src/backend/minds.ts")).toEqual([expect.objectContaining({ by: "PlanSwap-6", home: "src/secrecy/", what: expect.stringContaining("knowledgeSwitch") })]);
    expect(piecesOf("src/frontend/protocol-client.ts")).toEqual([expect.objectContaining({ by: "PlanSwap-9", home: "src/ui/kept/protocol-client.ts", what: expect.stringContaining("ProtocolClient, Transport, SyncState and Timers") })]);
    const cut = (path: string) => fates.cuts.filter((c) => c.path === path).map((c) => c.by);
    for (const path of ["src/frontend/hud.tsx", "src/frontend/play/now.tsx", "src/frontend/play/play.tsx", "src/frontend/play/scene.tsx"]) expect(cut(path)).toEqual(["PlanChatUI-P1"]);
  });

  test("what moves whole reads moved, to its home and by its package, and the Kept line has every item", () => {
    expect(fates.files.get("src/backend/worlds.ts")).toMatchObject({ fate: "moved", by: "PlanSwap-5", home: "src/worlds/worlds.ts" });
    expect(fates.files.get("src/backend/lore-secrets.ts")).toMatchObject({ fate: "moved", by: "PlanSwap-6", home: "src/secrecy/" });
    for (const path of ["src/backend/lore.ts", "src/backend/lore-pins.ts"]) expect(fates.files.get(path)).toMatchObject({ fate: "moved", by: "PlanChatUI-B3", home: "src/build/lore/" });
    expect(KEPT.secrecy).toBe("the secrecy half of the World Info gate (§9.6)");
  });

  test("today's protocol and settings registry move in part, and their pieces say which names go to what needs them", () => {
    for (const path of ["src/shared/protocol.ts", "src/shared/settings.ts"]) {
      expect(fates.files.get(path)).toMatchObject({ fate: "moved", by: "PlanSwap-13" });
      for (const piece of piecesOf(path)) {
        expect(piece.names.length).toBeGreaterThan(0);
        expect(piece.for.length).toBeGreaterThan(0);
      }
    }
    const registry = piecesOf("src/shared/settings.ts").find((piece) => piece.what.startsWith("what kept code reads of the registry"));
    expect(registry?.by).toBe("PlanSwap-13");
    // The old wire is no piece's but the migration's: PROTOCOL_VERSION goes into src/migrate/today/ as today's value (PlanSwap-13 item 3).
    const wire = ["PROTOCOL_VERSION", "AGENT_API", "ENGINE_EXTENSION", "FrontendToBackend", "BackendToFrontend", "ResultBodies"];
    for (const piece of piecesOf("src/shared/protocol.ts").filter((p) => p.home !== "src/migrate/today/")) expect(piece.names.filter((name) => wire.includes(name))).toEqual([]);
  });

  test("a note that says nothing kept reaches a file is true", () => {
    const { edges } = readTree(ROOT);
    const stays = (path: string) => fates.files.get(path)?.fate !== "removed";
    const claimed = [...fates.files.values()].filter((fate) => fate.note.includes("nothing kept reaches it"));
    expect(claimed.length).toBeGreaterThan(0);
    const reached = claimed.filter((fate) => edges.some((edge) => edge.to === fate.path && stays(edge.from)));
    expect(reached.map((fate) => `${fate.path} is imported by ${edges.filter((edge) => edge.to === fate.path && stays(edge.from)).map((edge) => edge.from).join(", ")}`)).toEqual([]);
  });

  test("a test of a kept system is never removed: every removed test reaches something that goes", () => {
    const { edges } = readTree(ROOT);
    const out = new Map<string, string[]>();
    for (const edge of edges) if (edge.to !== null) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
    const goes = (path: string) => fates.files.get(path)?.fate === "removed" && path.startsWith("src/");
    /** Whether a test reaches a removed source file through itself and the test helpers it loads. */
    const reachesRemoved = (test: string): boolean => {
      const seen = new Set([test]);
      const queue = [test];
      for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
        for (const to of out.get(at) ?? []) {
          if (goes(to)) return true;
          if (to.startsWith("test/") && !seen.has(to)) {
            seen.add(to);
            queue.push(to);
          }
        }
      }
      return false;
    };
    const removedTests = [...fates.files.values()].filter((fate) => fate.fate === "removed" && fate.path.startsWith("test/backend/"));
    expect(removedTests.filter((fate) => !reachesRemoved(fate.path)).map((fate) => fate.path)).toEqual([]);
    for (const path of ["test/backend/action-words.test.ts", "test/backend/world-defaults.test.ts"]) expect(fates.files.get(path)?.fate).toBe("moved");
    // A test's line may now say kept or moved, to a home under test/.
    const parsed = readFates(["test/backend/kept.test.ts\tmoved\tno package yet\ttest/engine/\ta check of the pure engine", "test/backend/wrong.test.ts\tmoved\tPlanSwap-7\tsrc/engine/\tnot a test's home"].join("\n"));
    expect(parsed.problems).toEqual(["fates.tsv:2 (test/backend/wrong.test.ts): a moved test's home is a path under test/"]);
  });
});
