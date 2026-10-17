// World Info candidates, selection, budget and groups (DESIGN §6.1–6.2).

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { InterceptorEntry } from "../../src/backend/host";
import { gatherCandidates, selectLore, type Candidate } from "../../src/backend/selection";

function entry(id: string, over: Partial<InterceptorEntry> = {}): InterceptorEntry {
  return { id, bookId: "user", comment: id, content: `${id} lore text`, keys: [], constant: false, disabled: false, group: null, groupOverride: false, groupWeight: 100, extensions: {}, ...over };
}

function gather(entries: InterceptorEntry[], recent: string[] = [], sceneIds: string[] = []): Candidate[] {
  return gatherCandidates({ entries, engineBookId: "engine", slotIds: new Set(["slot1"]), passThroughBooks: new Set(["pass"]), suppressed: (e) => e.id === "adopted", sceneIds: new Set(sceneIds), recent, revealed: () => false }).candidates;
}

describe("World Info candidates", () => {
  test("only enabled user entries and engine lore are candidates; pins, suppressed and pass-through are sorted out", () => {
    const found = gatherCandidates({
      entries: [entry("off", { disabled: true }), entry("pin", { constant: true }), entry("adopted"), entry("p", { bookId: "pass" }), entry("slot1", { bookId: "engine", disabled: true }), entry("lore", { bookId: "engine", disabled: true }), entry("secret", { bookId: "engine", extensions: { [LEDGER_NAMESPACE]: { secret: true } } })],
      engineBookId: "engine",
      slotIds: new Set(["slot1"]),
      passThroughBooks: new Set(["pass"]),
      suppressed: (e) => e.id === "adopted",
      sceneIds: new Set(),
      recent: [],
      revealed: () => false,
    });
    expect(found.candidates.map((c) => c.entry.id).sort()).toEqual(["lore", "pin"]);
    expect(found.candidates.find((c) => c.entry.id === "pin")?.pinned).toBe(true);
    expect(found.suppressed).toEqual(["adopted"]);
    expect(found.passThrough.map((e) => e.id)).toEqual(["p"]);
  });

  test("keyword hits in the scan window and back-links to the scene form the hit set", () => {
    const c = gather([entry("diner", { keys: ["diner"] }), entry("dev", { bookId: "engine", extensions: { [LEDGER_NAMESPACE]: { links: ["npc_dev"] } } }), entry("moon", { keys: ["moon"] })], ["We walk into the diner."], ["npc_dev"]);
    expect(c.filter((x) => x.hit).map((x) => x.entry.id).sort()).toEqual(["dev", "diner"]);
    expect(c.find((x) => x.entry.id === "dev")?.score).toBe(3);
  });

  test("world lore reads its keys, group and priority from the extension; a secret waits for its gate", () => {
    const lore = (id: string, ns: JsonObject): InterceptorEntry => entry(id, { bookId: "engine", disabled: true, keys: [], extensions: { [LEDGER_NAMESPACE]: ns } });
    const entries = [lore("ferry", { lore: "ferry", keys: ["ferry"], priority: 1, group: "harbor" }), lore("pier", { lore: "pier", keys: ["ferry"], priority: 5, group: "harbor" }), lore("vault", { lore: "vault", keys: ["ferry"], secret: true, gate: "flag.vault_open" })];
    const base = { entries, engineBookId: "engine", slotIds: new Set<string>(), passThroughBooks: new Set<string>(), suppressed: () => false, sceneIds: new Set<string>(), recent: ["The ferry horn sounds."] };
    const closed = gatherCandidates({ ...base, revealed: () => false }).candidates;
    expect(closed.map((c) => c.entry.id)).toEqual(["pier", "ferry"]);
    expect(closed[0]?.entry.group).toBe("harbor");
    expect(gatherCandidates({ ...base, revealed: (g) => g === "flag.vault_open" }).candidates.map((c) => c.entry.id)).toContain("vault");
  });

  test("user entries past the pre-rank cap are listed to be disabled; lore about someone unmet waits for a mention", () => {
    const many = Array.from({ length: 70 }, (_, i) => entry(`u${String(i).padStart(2, "0")}`));
    const lore = (id: string, keys: JsonObject[keyof JsonObject]): InterceptorEntry => entry(id, { bookId: "engine", disabled: true, extensions: { [LEDGER_NAMESPACE]: { lore: id, keys, links: ["vera"] } } });
    const base = { engineBookId: "engine", slotIds: new Set<string>(), passThroughBooks: new Set<string>(), suppressed: () => false, sceneIds: new Set<string>(), revealed: () => false, knows: (id: string) => id !== "vera" };
    const found = gatherCandidates({ ...base, entries: [...many, lore("vera_past", ["vera"])], recent: ["We talk about the weather."] });
    expect(found.candidates.length).toBe(64);
    expect(found.overflow.length).toBe(6);
    expect(found.candidates.some((c) => c.entry.id === "vera_past")).toBe(false);
    const named = gatherCandidates({ ...base, entries: [lore("vera_past", ["vera"])], recent: ["Who is Vera?"] });
    expect(named.candidates.map((c) => c.entry.id)).toEqual(["vera_past"]);
  });
});

describe("lore selection", () => {
  const cacheKey = (c: Candidate): string => c.entry.id;

  test("engine-only selection takes the hit set by score within the lore budget", async () => {
    const candidates = gather([entry("a", { keys: ["alpha"], content: "x".repeat(40) }), entry("b", { keys: ["beta"], content: "y".repeat(400) }), entry("c", { keys: ["gamma"] })], ["alpha beta"]);
    const s = await selectLore({ candidates, loreBudget: 50, mode: "engine", decide: null, cache: new Map(), cacheKey, seed: "s" });
    expect(s.selected.map((c) => c.entry.id)).toEqual(["a"]);
    expect(s.status.get("b")?.reason).toBe("lore budget");
    expect(s.status.get("c")?.reason).toBe("no hit");
  });

  test("Standard asks only about uncached hit candidates and caches model answers, never fallbacks", async () => {
    const candidates = gather([entry("a", { keys: ["alpha"] }), entry("b", { keys: ["beta"] })], ["alpha beta"]);
    const cache = new Map<string, boolean>();
    const asked: string[][] = [];
    const decide = async (asks: readonly Candidate[]): Promise<Map<string, number>> => {
      asked.push(asks.map((c) => c.entry.id));
      return new Map(asks.map((c) => [c.entry.id, c.entry.id === "a" ? 1 : 0]));
    };
    const first = await selectLore({ candidates, loreBudget: 1000, mode: "standard", decide, cache, cacheKey, seed: "s" });
    expect(first.selected.map((c) => c.entry.id)).toEqual(["a"]);
    await selectLore({ candidates, loreBudget: 1000, mode: "standard", decide, cache, cacheKey, seed: "s" });
    // The second run finds every hit candidate cached and makes no call at all.
    expect(asked).toEqual([["a", "b"]]);
    const fresh = new Map<string, boolean>();
    await selectLore({ candidates, loreBudget: 1000, mode: "standard", decide: async () => null, cache: fresh, cacheKey, seed: "s" });
    expect(fresh.size).toBe(0);
  });

  test("pins come first, keep their place over budget, and resolve groups by override then weight", async () => {
    const candidates = gather([entry("p1", { constant: true, group: "g", groupWeight: 10, content: "z".repeat(200) }), entry("p2", { constant: true, group: "g", groupWeight: 90, content: "z".repeat(200) }), entry("h", { keys: ["hit"] })], ["hit"]);
    const s = await selectLore({ candidates, loreBudget: 10, mode: "engine", decide: null, cache: new Map(), cacheKey, seed: "s" });
    expect(s.selected.map((c) => c.entry.id)).toEqual(["p2"]);
    expect(s.status.get("p1")?.reason).toBe("group");
    expect(s.pinsOverBudget).toBe(true);
    expect(s.status.get("h")?.reason).toBe("pins fill the lore budget");
  });
});
