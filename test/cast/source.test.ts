// The cast's writes name where they come from: a write that names no source is applied and marked unsourced, one citing a lore
// entry keeps it on its change. A character's own agent writing its own mind (a memory, a perception taken in, an entry of the mind,
// a relationship, a dream) writes the character's own: one that names no source is recorded as the character's, never marked, and
// its answer shows the source each write was recorded with. Every name and word here is made up.

import { describe, expect, test } from "bun:test";
import type { AgentRef, JsonObject, ToolResult } from "rp-harness/contract";
import { openBench } from "./rig";

const BRAM: AgentRef = { id: "bram-1", definition: "character", plays: "Bram" };

const said = (r: ToolResult): string => JSON.stringify(r.content);

describe("a cast write's source", () => {
  test("cast_update, perceive, remember: unsourced where none is named, kept where it is", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    const cast = await b.play("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal", source: "author" }] }, turn.id);
    expect(cast.error).toBeUndefined();
    expect(cast.marks).toBeUndefined();

    const bare = await b.play("cast_update", { operations: [{ op: "knowledge", who: "Bram", text: "The cellar floods in spring." }] }, turn.id);
    expect(bare.marks).toContain("unsourced");
    expect(said(bare)).toContain("names no source");

    const cited = await b.play("cast_update", { operations: [{ op: "knowledge", who: "Bram", text: "The reeve has a chipped seal.", source: { from: "lore", lore: "e-12" } }] }, turn.id);
    expect(cited.marks).toBeUndefined();

    const seen = await b.play("perceive", { perceptions: [{ who: "Bram", moment: "Wren leaves", reach: "whole", content: "She goes out into the gale.", told_by: "Odile" }] }, turn.id);
    expect(seen.marks).toContain("unsourced");

    const lived = await b.play("remember", { memories: [{ text: "She went pale.", gist: "Wren went pale.", source: "character" }] }, turn.id, BRAM);
    expect(lived.error).toBeUndefined();
    expect(lived.marks).toBeUndefined();
    // Named or not, a memory of its own is the character's.
    const unnamed = await b.play("remember", { memories: [{ text: "He said nothing.", gist: "Silence." }] }, turn.id, BRAM);
    expect(unnamed.marks).toBeUndefined();
    expect(said(unnamed)).not.toContain("names no source");

    // What the store keeps on each change: the source's kind, and what it cites.
    const rows = b.t.s.changes(turn.id).filter((c) => c.op === "cast.write");
    const kept = rows.map((c) => [(c.value as JsonObject).part, c.source, c.cite]);
    expect(kept).toContainEqual(["knowledge", null, null]);
    expect(kept).toContainEqual(["knowledge", "lore", { lore: "e-12" }]);
    expect(kept).toContainEqual(["perception", null, null]);
    expect(kept).toContainEqual(["memory", "character", null]);
  });

  test("a character's own agent spends no call on sources: what it writes of its own mind is the character's, and the answer says so", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    expect((await b.play("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal", source: "author" }] }, turn.id)).error).toBeUndefined();
    const perceived = await b.play("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "Wren leaves in the gale.", source: "prose" }, { who: "Bram", reach: "part", content: "A door bangs somewhere.", source: "prose" }] }, turn.id);
    const [seen, banged] = [...new Set(JSON.stringify(perceived.content).match(/p-\d+/g) ?? [])];
    if (seen === undefined || banged === undefined) throw new Error("two perceptions were written");
    // A memory from the first, and the second taken in with nothing to remember; an entry of the mind and a relationship from the first; then a dream.
    const writes = [
      await b.play("remember", { memories: [{ text: "She went out into the gale.", gist: "Wren left.", from: [seen] }, { taken: [banged] }] }, turn.id, BRAM),
      await b.play("mind_set", { entries: [{ kind: "feeling", text: "Uneasy.", from: [seen] }] }, turn.id, BRAM),
      await b.play("relate", { relationships: [{ with: "Wren", text: "I worry for her.", from: [seen] }] }, turn.id, BRAM),
      await b.play("dream", {}, turn.id, BRAM),
    ];
    for (const r of writes) {
      expect(r.error).toBeUndefined();
      expect(r.marks).toBeUndefined();
      expect(said(r)).not.toContain("names no source");
    }
    // Each answer shows the source its writes were recorded with.
    expect(said(writes[0]!)).toContain('\\"source\\":\\"character\\"');
    expect(said(writes[1]!)).toContain('\\"source\\":\\"character\\"');
    expect(said(writes[2]!)).toContain('\\"source\\":\\"character\\"');
    // What the store keeps: every write of its own, the taken-in mark and the dream's settling among them, is the character's.
    const own = b.t.s.changes(turn.id).filter((c) => c.op === "cast.write" && c.handle === BRAM.id);
    expect(own.length).toBeGreaterThanOrEqual(5);
    expect(own.filter((c) => c.source !== "character").map((c) => (c.value as JsonObject).part)).toEqual([]);
  });
});
