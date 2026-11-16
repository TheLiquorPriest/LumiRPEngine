// The cast's writes name where they come from: a write that names no source is applied and marked unsourced, one citing a lore
// entry keeps it on its change, a memory with the source character is not marked. Every name and word here is made up.

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
    const unnamed = await b.play("remember", { memories: [{ text: "He said nothing.", gist: "Silence." }] }, turn.id, BRAM);
    expect(unnamed.marks).toContain("unsourced");

    // What the store keeps on each change: the source's kind, and what it cites.
    const rows = b.t.s.changes(turn.id).filter((c) => c.op === "cast.write");
    const kept = rows.map((c) => [(c.value as JsonObject).part, c.source, c.cite]);
    expect(kept).toContainEqual(["knowledge", null, null]);
    expect(kept).toContainEqual(["knowledge", "lore", { lore: "e-12" }]);
    expect(kept).toContainEqual(["perception", null, null]);
    expect(kept).toContainEqual(["memory", "character", null]);
  });
});
