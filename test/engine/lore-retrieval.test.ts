// The lore search RPEngine's helpers read (DESIGN §4.2, §5.4): ranking and its stability,
// who may read what (a secret's audience before and after its gate, `known_by` failing closed, the
// GM reading everything), snippets held to the token budget, and the leak check knowing a gated
// secret's text.

import { describe, expect, test } from "bun:test";
import { loreGet, loreList, loreSearch, type LoreReader } from "../../src/engine/lore";
import { createRegistry } from "../../src/engine/registry-impl";
import { findLeaks, unrevealedSecrets } from "../../src/engine/visibility";
import { Working } from "../../src/engine/working";
import type { LoreEntryDef, WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const SECRET = "Maya keeps the stolen ledger under the café counter";

const entry = (id: string, extra: Partial<LoreEntryDef> = {}): LoreEntryDef => ({ id, title: id, content: "Nothing much to say here.", keys: [], links: [], ...extra });

function riverton(entries: LoreEntryDef[], patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("lore", "Riverton");
  for (const e of entries) world.lore[e.id] = e;
  patch(world);
  return new Working(reg, world, startState(world));
}

/** The engine's estimate stands in for the host's count: 3.2 characters a token. */
const reader = (w: Working): LoreReader => ({ reg, world: w.world, state: w.state, tokens: (text) => Math.ceil(text.length / 3.2) });
const ids = (w: Working, q: Parameters<typeof loreSearch>[1]): string[] => loreSearch(reader(w), q).hits.map((h) => h.id);

describe("ranking", () => {
  const w = riverton(
    [
      entry("by_words", { title: "Lighthouse rumors", content: "The lighthouse keeper's lighthouse was a lighthouse." }),
      entry("by_topic", { title: "Harbor rules", topics: ["Harbor law"] }),
      entry("by_link", { title: "The café", links: ["cafe"] }),
      entry("by_alias", { title: "Breakwater Light", aliases: ["the old lighthouse"] }),
      entry("by_table", { title: "Pier notes" }),
      entry("tie_b", { title: "Tie B", links: ["cafe"] }),
      entry("tie_a", { title: "Tie A", links: ["cafe"] }),
      entry("first_choice", { title: "Pier A", links: ["cafe"], group: "pier", priority: 1 }),
      entry("second_choice", { title: "Pier B", links: ["cafe"], group: "pier" }),
    ],
    (world) => {
      world.loreIndex.terms["the pier"] = ["by_table"];
    },
  );
  const q = { query: "I walk past the old lighthouse to the pier, thinking about harbor law and the lighthouse", links: ["cafe"], purpose: "interpret" as const, limit: 10, tokenBudget: 2000 };

  test("exact terms first, then links, topics, words; priority and then id break ties; a group gives its best", () => {
    expect(ids(w, q)).toEqual(["by_alias", "by_table", "first_choice", "by_link", "tie_a", "tie_b", "by_topic", "by_words"]);
  });

  test("the same inputs give the same hits in the same order", () => {
    const first = loreSearch(reader(w), q);
    for (let i = 0; i < 3; i++) expect(loreSearch(reader(w), q)).toEqual(first);
    // Entries listed in another order rank the same.
    const shuffled = riverton(Object.values(w.world.lore).reverse(), (world) => {
      world.loreIndex.terms["the pier"] = ["by_table"];
    });
    expect(ids(shuffled, q)).toEqual(ids(w, q));
  });

  test("an exact term matches a whole name; nothing matching nothing is a hit", () => {
    expect(ids(w, { terms: ["The Old Lighthouse"], purpose: "interpret", limit: 5, tokenBudget: 500 })).toEqual(["by_alias"]);
    expect(ids(w, { terms: ["old"], purpose: "interpret", limit: 5, tokenBudget: 500 })).toEqual([]);
    expect(ids(w, { query: "the weather is fine", purpose: "interpret", limit: 5, tokenBudget: 500 })).toEqual([]);
  });

  test("get and list read one entry and a topic's entries", () => {
    expect(loreGet(reader(w), "by_topic", "interpret", 100)?.snippet).toBe("Harbor rules: Nothing much to say here.");
    expect(loreList(reader(w), "Harbor law", "interpret")).toEqual([{ id: "by_topic", title: "Harbor rules" }]);
    expect(loreGet(reader(w), "nope", "interpret", 100)).toBeNull();
  });
});

describe("who may read an entry", () => {
  const secret = entry("ledger", { title: "The ledger", content: `${SECRET}. Nobody else knows.`, keys: ["ledger"], secret: true, gate: "self.charm >= 15", audience: ["npc.choose", "brief", "extract"] });
  const search = (w: Working, purpose: Parameters<typeof loreSearch>[1]["purpose"], term = "ledger") => loreSearch(reader(w), { terms: [term], purpose, limit: 10, tokenBudget: 800 }).hits;

  test("before its gate holds, a secret reaches only its audience, never a step that writes for the player, and the GM", () => {
    const w = riverton([secret]);
    expect(search(w, "npc.choose").map((h) => [h.id, h.secret])).toEqual([["ledger", true]]);
    expect(search(w, "interpret")).toEqual([]);
    // Listed, but they write what the narrator or the player sees.
    expect(search(w, "brief")).toEqual([]);
    expect(search(w, "extract")).toEqual([]);
    expect(loreSearch(reader(w), { terms: ["ledger"], purpose: "npc.choose", effects: true, limit: 5, tokenBudget: 500 }).hits).toEqual([]);
    expect(search(w, "gm").map((h) => h.id)).toEqual(["ledger"]);
    expect(loreGet(reader(w), "ledger", "interpret", 500)).toBeNull();
  });

  test("once its gate holds, it reads as public", () => {
    const w = riverton([secret]);
    w.apply({ type: "set", entity: "you", field: "charm", value: 15 });
    for (const purpose of ["interpret", "brief", "extract", "npc.choose"] as const) expect(search(w, purpose).map((h) => [h.id, h.secret])).toEqual([["ledger", false]]);
  });

  test("a gate that is missing or can't be read never holds", () => {
    const w = riverton([{ ...secret, gate: undefined }, { ...secret, id: "broken", gate: "self.charm >=" }]);
    w.apply({ type: "set", entity: "you", field: "charm", value: 15 });
    expect(loreSearch(reader(w), { terms: ["ledger"], purpose: "interpret", limit: 5, tokenBudget: 500 }).hits).toEqual([]);
  });

  test("a `secret` that isn't true or false reads as secret: only its audience reads it, and the leak check knows its text", () => {
    for (const value of ["true", "false", 1, null]) {
      const odd = JSON.parse(JSON.stringify({ ...secret, secret: value })) as LoreEntryDef;
      const w = riverton([odd]);
      expect(search(w, "npc.choose").map((h) => [h.id, h.secret])).toEqual([["ledger", true]]);
      expect(search(w, "interpret")).toEqual([]);
      expect(findLeaks(`Maya: ${SECRET}`, unrevealedSecrets(reg, w.world, w.state))).toHaveLength(1);
    }
    // Only false, or no value at all, makes it public.
    for (const open of [{ ...secret, secret: false }, { ...secret, secret: undefined }]) expect(search(riverton([open]), "interpret").map((h) => h.id)).toEqual(["ledger"]);
  });

  test("known_by: only once the POV knows everything it links; no links, odd links or an odd visibility hide it", () => {
    const w = riverton([
      entry("jordan_past", { title: "Jordan's past", keys: ["jordan"], links: ["jordan"], visibility: "known_by" }),
      entry("flat", { title: "Maya's flat", keys: ["jordan"], links: ["maya_flat"], visibility: "known_by" }),
      entry("unlinked", { title: "Nobody's", keys: ["jordan"], visibility: "known_by" }),
      entry("odd_link", { title: "Odd", keys: ["jordan"], links: ["jordan", "not_a_thing"], visibility: "known_by" }),
      JSON.parse(JSON.stringify(entry("odd_visibility", { title: "Rumor", keys: ["jordan"], visibility: "rumor" as "public" }))) as LoreEntryDef,
      entry("open", { title: "Open", keys: ["jordan"] }),
    ]);
    const readable = (): string[] => search(w, "interpret", "jordan").map((h) => h.id);
    expect(readable()).toEqual(["open"]);
    w.apply({ type: "link", rel: "knows", from: "you", to: "jordan" });
    expect(readable()).toEqual(["jordan_past", "open"]);
    w.apply({ type: "link", rel: "knows", from: "you", to: "maya_flat" });
    expect(readable()).toEqual(["flat", "jordan_past", "open"]);
    expect(search(w, "gm", "jordan").map((h) => h.id)).toEqual(["flat", "jordan_past", "odd_link", "odd_visibility", "open", "unlinked"]);
  });

  test("an AI-written entry waiting for review is read by nobody but the GM", () => {
    const w = riverton([entry("draft", { keys: ["jordan"], source: { kind: "ai", status: "pending" } }), entry("kept", { keys: ["jordan"], source: { kind: "ai", status: "accepted" } })]);
    expect(search(w, "interpret", "jordan").map((h) => h.id)).toEqual(["kept"]);
    expect(search(w, "gm", "jordan").map((h) => h.id)).toEqual(["draft", "kept"]);
  });
});

describe("read as a character's mind (DESIGN §24.5)", () => {
  const affair = entry("affair", { title: "The affair", content: "Jordan has been seeing Rosa behind Maya's back; Maya has no idea.", keys: ["affair"], links: ["maya", "jordan", "rosa"], secret: true, gate: "self.charm >= 15", audience: ["npc.choose"] });
  const readAs = (w: Working, who: string): string[] => loreSearch(reader(w), { terms: ["affair"], purpose: "mind", as: who, limit: 10, tokenBudget: 800 }).hits.map((h) => h.id);

  test("a secret that links them isn't theirs, before its gate holds or once the POV's gate opens", () => {
    const w = riverton([affair]);
    expect(readAs(w, "maya")).toEqual([]);
    w.apply({ type: "set", entity: "you", field: "charm", value: 15 });
    // The POV's helpers now read it as public; nobody else learns it from that.
    expect(loreSearch(reader(w), { terms: ["affair"], purpose: "interpret", limit: 10, tokenBudget: 800 }).hits.map((h) => h.id)).toEqual(["affair"]);
    for (const who of ["maya", "jordan", "rosa"]) expect(readAs(w, who)).toEqual([]);
  });

  test("a secret is theirs when its holders name them or a cue of theirs stands for it, gate or no gate", () => {
    const w = riverton([{ ...affair, holders: ["jordan"] }], (world) => {
      const rosa = world.entities.rosa;
      if (rosa) rosa.cues = [{ text: "Goes quiet whenever Maya is mentioned", lore: "affair" }];
    });
    expect(readAs(w, "jordan")).toEqual(["affair"]);
    expect(readAs(w, "rosa")).toEqual(["affair"]);
    expect(readAs(w, "maya")).toEqual([]);
    w.apply({ type: "set", entity: "you", field: "charm", value: 15 });
    expect(readAs(w, "jordan")).toEqual(["affair"]);
    expect(readAs(w, "maya")).toEqual([]);
  });
});

describe("snippets and the token budget", () => {
  const long = (id: string, words: number): LoreEntryDef => entry(id, { keys: ["harbor"], content: Array.from({ length: words }, (_, i) => `word${i}`).join(" ") });

  test("hits stay within the budget: whole entries while they fit, then one cut at a word, then none", () => {
    const w = riverton([long("a_short", 10), long("b_long", 400), long("c_more", 10)]);
    const r = reader(w);
    for (const budget of [40, 120, 300]) {
      const { hits, matched } = loreSearch(r, { terms: ["harbor"], purpose: "interpret", limit: 5, tokenBudget: budget });
      expect(matched).toBe(3);
      expect(hits.reduce((s, h) => s + h.tokens, 0)).toBeLessThanOrEqual(budget);
      for (const h of hits) expect(r.tokens(h.snippet)).toBe(h.tokens);
      expect(hits[0]?.cut).toBe(false);
      expect(hits[1]?.cut).toBe(true);
      expect(hits[1]?.snippet.endsWith("…")).toBe(true);
      // The cut entry used what was left, so nothing after it fits.
      expect(hits.length).toBe(2);
    }
    expect(loreSearch(r, { terms: ["harbor"], purpose: "interpret", limit: 5, tokenBudget: 3 }).hits).toEqual([]);
  });
});

describe("the leak check knows gated secret lore", () => {
  test("a player-facing line carrying a secret entry's sentence is caught until the gate holds", () => {
    const w = riverton([entry("ledger", { title: "The ledger", content: `"${SECRET}." She'd never tell.`, secret: true, gate: "self.charm >= 15" }), entry("public", { content: "The café opens at six every morning." })]);
    const chip = `Maya: ${SECRET.toLowerCase()}, apparently`;
    expect(findLeaks(chip, unrevealedSecrets(reg, w.world, w.state))).toEqual([chip]);
    expect(findLeaks("The café opens at six every morning.", unrevealedSecrets(reg, w.world, w.state))).toEqual([]);
    w.apply({ type: "set", entity: "you", field: "charm", value: 15 });
    expect(findLeaks(chip, unrevealedSecrets(reg, w.world, w.state))).toEqual([]);
  });
});
