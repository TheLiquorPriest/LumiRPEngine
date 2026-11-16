// A principal out of view keeps living: the Author records where it is and what it means to do, in its
// own words, with the refs of the places and people they name; a swipe takes them back. Every name here is
// made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { CAST_STORE_AREA, sliceOf } from "../../src/cast/fold";
import { awayItemId, charactersOf, renameCharacter } from "../../src/cast/record";
import { castViews } from "../../src/cast/views";
import { shippedLayouts } from "./rig";
import { CHAT, dataOf, openBench, texts, tokensOf, USER, wordsFromFiles } from "./rig";

describe("a principal away", () => {
  test("the Author records Tam away at the market, meaning to sell the satchel, back by nightfall: the record holds the whereabouts, the intention and its time, the market by ref; a swipe takes them back", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    const r = await b.call(
      "cast_update",
      {
        operations: [
          { op: "cast", who: "Tam", as: "principal" },
          { op: "away", who: "Tam", whereabouts: "Across the square.", place: "Market Square", names: ["Odile", "the Moon Gate"], intention: "Find a buyer for the satchel.", until: "in two days" },
        ],
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    // The Moon Gate is nothing the world holds: it is said, not guessed at.
    expect(texts(r).filter((t) => t.includes("Moon Gate"))).toHaveLength(1);
    await b.t.tie(turn);
    const tam = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Tam");
    expect(tam?.person).toBe("tam");
    const away = b.t.record().items.get(awayItemId(tam?.id ?? ""));
    expect(away?.fields).toMatchObject({ whereabouts: "Across the square.", intention: "Find a buyer for the satchel.", place_ref: "place:market_square", name_refs: ["entity:odile"], until: "in two days", until_at: 3360 });
    // What time brings due is read from the slice alone: the intention, its time, who it is of and the refs its write kept.
    const slice = sliceOf(b.t.s.headState(CHAT).state.areas) as unknown as JsonObject;
    expect(CAST_STORE_AREA.reads?.away?.(slice, {})).toEqual([
      { id: awayItemId(tam?.id ?? ""), character: tam?.id ?? "", name: "Tam", ref: "entity:tam", whereabouts: "Across the square.", place_ref: "place:market_square", names: ["Odile", "the Moon Gate"], name_refs: ["entity:odile"], intention: "Find a buyer for the satchel.", until_at: 3360 },
    ]);

    // While it is away the record shows them, beside where the state places it.
    const { layouts, dispose } = await shippedLayouts();
    const [side] = await castViews(["game-side"], { store: b.t.store, user: USER, chat: CHAT, turn: null, character: "Tam", present: [], sources: b.t.shelf.reader, layouts, tokens: tokensOf });
    dispose();
    expect(side?.text).toContain("- Meaning to: Find a buyer for the satchel.");
    expect(side?.text).toContain("Where: Market Square");

    await b.t.tie(await b.t.swipe());
    expect(b.t.record().items.get(awayItemId(tam?.id ?? ""))).toBeUndefined();
  });

  test("a game side is found by the stored reference: a character named otherwise than the world's person keeps its game side through a rename, and a relationship follows the rename", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    const made = await b.call("cast_update", { operations: [{ op: "cast", who: "Odile", as: "supporting", person: "odile" }, { op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    expect(made.error).toBeUndefined();
    const bram = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Bram")?.id ?? "";
    const rel = await b.play("relate", { relationships: [{ with: "Odile", text: "She keeps the cellar.", trust: 150 }] }, turn.id, { id: "bram-1", definition: "character", plays: "Bram" });
    expect(rel.error).toBeUndefined();
    // Trust 150 is past the scale: kept as sent, and said.
    expect((rel.reports ?? []).some((t) => t.includes("150") && t.includes("kept as sent"))).toBe(true);
    await b.t.tie(turn);
    const odile = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Odile")?.id ?? "";
    await b.t.writes.run((db) => renameCharacter(db, USER, odile, "The Cellarer"));
    const { layouts, dispose } = await shippedLayouts();
    const input = { store: b.t.store, user: USER, chat: CHAT, turn: null, sources: b.t.shelf.reader, layouts, tokens: tokensOf };
    const [game] = await castViews(["game-side"], { ...input, character: "The Cellarer", present: [] });
    const [feeling] = await castViews(["relationships:present"], { ...input, character: "Bram", present: ["The Cellarer", "Bram"] });
    dispose();
    expect(game?.text).toContain("Odile in the world".replace("Odile", "The Cellarer"));
    expect(game?.text).toContain("Where: The Cellar");
    expect(feeling?.text).toContain("- The Cellarer: She keeps the cellar. Trust 150.");
    expect(b.t.record().of(bram, "relationship")).toHaveLength(1);
    expect(dataOf(rel).relationships).toHaveLength(1);
  });
});
