// World lore (DESIGN §4.2): a secret entry may hold the secret but needs a gate; a helper that
// writes prose in its audience is flagged; a public entry never holds a track's truth. The lookup
// table: its migration, its lint, additions and suggestions.

import { describe, expect, test } from "bun:test";
import { blankWorld, lintWorld, migrateWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { addToLoreIndex, loreSourceOf, termSuggestions, topicSuggestions } from "../../src/shared/lore";
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
    expect(loreSourceOf(old.lore.harbor?.source)).toEqual({ kind: "authored" });
    expect(loreSourceOf({ kind: "book", bookId: "b1" })).toEqual({ kind: "authored" });
    expect(loreIssues(old)).toEqual([]);
  });
});

describe("the lore lookup table", () => {
  const lighthouse = entry("lighthouse", { title: "Breakwater Lighthouse", aliases: ["The Old Lighthouse"], topics: ["Harbor"] });
  const ferry = entry("ferry", { title: "The Ferry", keys: ["boat"], topics: ["harbor", "Travel"] });

  test("documents written before it get an empty table; a malformed one keeps its well-formed half", () => {
    // Stored documents are JSON; these are written as an older engine (or a hand edit) left them.
    const old = JSON.parse(JSON.stringify({ ...world([lighthouse]), loreIndex: undefined })) as WorldDoc;
    const migrated = migrateWorld(old);
    expect(migrated.loreIndex).toEqual({ terms: {}, topics: {} });
    expect(migrated.lore).toEqual(old.lore);
    const half = JSON.parse(JSON.stringify({ ...world([lighthouse]), loreIndex: { terms: { lamp: ["lighthouse"] }, topics: null } })) as WorldDoc;
    expect(migrateWorld(half).loreIndex).toEqual({ terms: { lamp: ["lighthouse"] }, topics: {} });
  });

  test("lint: unknown entries, blank and empty terms, terms not as lookups match them, and an alias that leads elsewhere", () => {
    const w = world([lighthouse, ferry]);
    w.loreIndex = { terms: { "the old lighthouse": ["ferry"], boat: ["ferry", "ghost_ship"], "  ": ["ferry"], Ferry: ["ferry"], dock: [] }, topics: { harbor: { label: "Harbor", entries: ["lighthouse", "pier"] }, misc: { label: " ", entries: [] } } };
    expect(lintWorld(w, registry).filter((i) => i.path.startsWith("loreIndex.")).map((i) => [i.path, i.code])).toEqual([
      ["loreIndex.terms.the old lighthouse", "alias_elsewhere"],
      ["loreIndex.terms.boat", "missing_ref"],
      ["loreIndex.terms.  ", "empty_term"],
      ["loreIndex.terms.Ferry", "term_case"],
      ["loreIndex.terms.dock", "empty_term"],
      ["loreIndex.topics.harbor", "missing_ref"],
      ["loreIndex.topics.misc", "topic_label"],
    ]);
    // The alias's own entry among others is fine.
    w.loreIndex = { terms: { "the old lighthouse": ["ferry", "lighthouse"] }, topics: {} };
    expect(lintWorld(w, registry).filter((i) => i.path.startsWith("loreIndex."))).toEqual([]);
  });

  test("additions file an entry without removing or repeating anything; prototype keys are skipped", () => {
    const start = { terms: { lamp: ["ferry"] }, topics: { harbor: { label: "The harbor", entries: ["ferry"] } } };
    const next = addToLoreIndex(start, "lighthouse", { terms: ["Lamp", "  The OLD  lighthouse ", "__proto__"], topics: [{ id: "harbor", label: "Harbor" }, { id: "lights", label: "Lights" }, { id: "constructor", label: "x" }] });
    expect(next).toEqual({ terms: { lamp: ["ferry", "lighthouse"], "the old lighthouse": ["lighthouse"] }, topics: { harbor: { label: "The harbor", entries: ["ferry", "lighthouse"] }, lights: { label: "Lights", entries: ["lighthouse"] } } });
    expect(addToLoreIndex(next, "lighthouse", { terms: ["lamp"], topics: [{ id: "lights", label: "Lights" }] })).toEqual(next);
    expect(start.terms.lamp).toEqual(["ferry"]);
  });

  test("suggestions come from titles, aliases and keywords, and from the topics entries name, until the table has them", () => {
    const w = world([lighthouse, ferry]);
    expect(termSuggestions(w).map((s) => [s.term, s.entry, s.from])).toEqual([
      ["breakwater lighthouse", "lighthouse", "title"],
      ["the old lighthouse", "lighthouse", "alias"],
      ["the ferry", "ferry", "title"],
      ["boat", "ferry", "keyword"],
    ]);
    expect(topicSuggestions(w)).toEqual([
      { id: "harbor", label: "Harbor", entries: ["lighthouse", "ferry"] },
      { id: "travel", label: "Travel", entries: ["ferry"] },
    ]);
    w.loreIndex = { terms: { "the old lighthouse": ["lighthouse"], boat: ["ferry"] }, topics: { harbor: { label: "Harbor and docks", entries: ["lighthouse"] } } };
    expect(termSuggestions(w).map((s) => s.term)).toEqual(["breakwater lighthouse", "the ferry"]);
    expect(topicSuggestions(w)).toEqual([
      { id: "harbor", label: "Harbor and docks", entries: ["ferry"] },
      { id: "travel", label: "Travel", entries: ["ferry"] },
    ]);
  });
});
