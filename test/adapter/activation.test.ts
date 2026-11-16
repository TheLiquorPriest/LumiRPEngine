import { describe, expect, test } from "bun:test";
import { Activations, activationOf, notTold } from "../../src/adapter/lumiverse/activation";
import type { LvEntry } from "../../src/adapter/lumiverse/rows";
import type { TagLore } from "../../src/adapter/lumiverse/wire";

const entry = (over: Partial<LvEntry>): LvEntry => ({ id: "e", book: "b", uid: "u-e", keys: [], secondaryKeys: [], content: "", comment: "", position: 0, depth: 4, role: null, order: 100, constant: false, disabled: false, selective: false, vectorized: false, sticky: 0, extensions: {}, revision: 1, updatedAt: 0, ...over });
const raw = (id: string, how: TagLore["how"] = "keyword"): TagLore => ({ id, book: "b", bookName: null, title: id, how, told: false });

describe("how an entry activated", () => {
  test("a constant entry, a keyword match, a vector hit and an entry still sticky are each told; an entry matched again while sticky is a keyword match", () => {
    expect(activationOf(entry({ constant: true }), "keyword", {}, undefined).how).toBe("constant");
    expect(activationOf(entry({}), "keyword", {}, undefined).how).toBe("keyword");
    expect(activationOf(entry({ vectorized: true }), "vector", {}, undefined).how).toBe("vector");
    const sticky = entry({ sticky: 3, uid: "u" });
    expect(activationOf(sticky, "keyword", { u: { stickyLeft: 2 } }, undefined)).toMatchObject({ how: "sticky", told: true });
    expect(activationOf(sticky, "keyword", { u: { stickyLeft: 3 } }, undefined)).toMatchObject({ how: "keyword", told: true });
  });

  test("an entry whose sticky setting changed mid-window is reported as not told", () => {
    // Its window left 3 last time; the setting is lowered to 2: a return counts down to 2, and so does a fresh match.
    const lowered = entry({ sticky: 2, uid: "u" });
    const way = activationOf(lowered, "keyword", { u: { stickyLeft: 2 } }, { sticky: 3, left: 3 });
    expect(way).toMatchObject({ how: null, told: false });
    expect(notTold([{ told: way.told }, { told: true }])).toBe(1);
  });

  test("each activated entry carries its book's name", async () => {
    const reads = {
      chat: async () => ({ id: "c", user: "u", character: null, name: "", metadata: { wi_state: { u: { stickyLeft: 1 } } }, updatedAt: 0 }),
      entries: async () => [entry({ id: "s", uid: "u", sticky: 3 }), entry({ id: "k", uid: "k" })],
      entry: async () => null,
      book: async (id: string) => ({ id, name: "Harbor lore", description: "", metadata: {}, updatedAt: 0 }),
    };
    const told = await new Activations(reads, () => {}).tell("c", [raw("s"), raw("k")]);
    expect(told.map((e) => [e.id, e.how, e.bookName, e.told])).toEqual([["s", "sticky", "Harbor lore", true], ["k", "keyword", "Harbor lore", true]]);
  });
});
