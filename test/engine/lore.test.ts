// World lore lint (DESIGN §4.2): a secret entry may hold the secret but needs a gate; a helper that
// writes prose in its audience is flagged; a public entry never holds a track's truth.

import { describe, expect, test } from "bun:test";
import { blankWorld, lintWorld, migrateWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { loreSource } from "../../src/shared/lore";
import type { LintIssue } from "../../src/shared/protocol";
import type { LoreEntryDef, WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";

const registry = createRegistry(ALL_PACKS);
const TRUTH = "The ferryman drowned the old keeper.";

function world(entries: LoreEntryDef[]): WorldDoc {
  const w = blankWorld("w_lore", "Lore");
  w.tracks.keeper = { id: "keeper", kind: "secret", label: "The keeper", start: "hidden", stages: { hidden: { label: "Hidden", next: [], truth: TRUTH } }, visibility: "secret" };
  for (const e of entries) w.lore[e.id] = e;
  return w;
}

const entry = (id: string, extra: Partial<LoreEntryDef> = {}): LoreEntryDef => ({ id, title: id, content: "The lighthouse is dark.", keys: [], links: [], ...extra });
const loreIssues = (w: WorldDoc): Pick<LintIssue, "severity" | "path" | "code">[] => lintWorld(w, registry).filter((i) => i.path.startsWith("lore.")).map(({ severity, path, code }) => ({ severity, path, code }));

describe("world lore lint", () => {
  test("a secret entry may hold the secret, but it needs a gate", () => {
    expect(loreIssues(world([entry("keeper_note", { secret: true, gate: "stage.keeper == 'hidden'", content: TRUTH })]))).toEqual([]);
    expect(loreIssues(world([entry("keeper_note", { secret: true, content: TRUTH })]))).toEqual([{ severity: "error", path: "lore.keeper_note.gate", code: "no_gate" }]);
    expect(loreIssues(world([entry("keeper_note", { secret: true, gate: "  ", content: TRUTH })]))).toEqual([{ severity: "error", path: "lore.keeper_note.gate", code: "no_gate" }]);
  });

  test("a public entry never holds a track's truth", () => {
    expect(loreIssues(world([entry("rumor", { content: `People say: ${TRUTH}` })]))).toEqual([{ severity: "error", path: "lore.rumor.content", code: "secret_truth" }]);
  });

  test("a helper that writes prose in a secret entry's audience is flagged; decision helpers are not", () => {
    const gate = "stage.keeper == 'hidden'";
    expect(loreIssues(world([entry("keeper_note", { secret: true, gate, audience: ["npc.choose", "contradiction"] })]))).toEqual([]);
    expect(loreIssues(world([entry("keeper_note", { secret: true, gate, audience: ["npc.choose", "brief", "choices"] })]))).toEqual([{ severity: "warning", path: "lore.keeper_note.audience", code: "prose_audience" }]);
    // A world file can name a helper this engine doesn't have.
    const odd = JSON.parse(JSON.stringify({ ...entry("keeper_note", { secret: true, gate }), audience: ["narrator"] })) as LoreEntryDef;
    expect(loreIssues(world([odd]))).toEqual([{ severity: "warning", path: "lore.keeper_note.audience", code: "unknown_step" }]);
    // A public entry's audience means nothing: everyone reads it.
    expect(loreIssues(world([entry("harbor", { audience: ["outline"] })]))).toEqual([]);
  });

  test("an entry written before sources existed loads unchanged and counts as authored", () => {
    const old = world([entry("harbor")]);
    expect(migrateWorld(old)).toBe(old);
    expect(loreSource(old.lore.harbor ?? entry("x"))).toEqual({ kind: "authored" });
    expect(loreIssues(old)).toEqual([]);
  });
});
