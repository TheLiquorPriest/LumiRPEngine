// A name that is not in the cast yet, as the Author met it live: the perception it wrote for someone
// it had not cast. Played as the harness plays a call. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { charactersOf } from "../../src/cast/record";
import { CHAT, dataOf, openBench, texts, USER, wordsFromFiles } from "./rig";

/** The perception sent live, for someone the Author had not cast. */
const MARTA: JsonObject = {
  perceptions: [{ who: "Marta Venn", moment: "Ida climbs the lamp stair", reach: "whole", content: "Boots on the iron stair, then Ida at the hatch, soaked.", missed: "Why she came out in the gale.", knows: ["Ida Pell is on the rock tonight."] }],
};

describe("a name that is not in the cast yet", () => {
  test("perceive makes the character, not yet cast, writes the perception the Author sent, and says so once", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    const r = await b.play("perceive", MARTA, turn.id);
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r).filter((t) => !t.startsWith("{"))).toEqual(["Marta Venn was not in the cast, so they were added to it, not yet cast."]);
    const [marta] = charactersOf(b.t.db, USER, [CHAT]);
    expect(marta?.name).toBe("Marta Venn");
    const [p] = dataOf(r).perceptions as JsonObject[];
    expect(p?.who).toEqual({ id: marta?.id, name: "Marta Venn" });
    const record = b.t.record(turn);
    expect(record.of(marta?.id ?? "", "perception").map((x) => x.fields.content)).toEqual(["Boots on the iron stair, then Ida at the hatch, soaked."]);
    expect(record.of(marta?.id ?? "", "knowledge").map((x) => x.fields.text)).toEqual(["Ida Pell is on the rock tonight."]);
    expect(record.of(marta?.id ?? "", "casting")).toEqual([]);

    // Cast later, she is the same character: nothing is made twice, and nothing more is said of her.
    const cast = await b.play("cast_update", { operations: [{ op: "cast", who: "Marta Venn", as: "principal" }] }, turn.id);
    expect(cast.error).toBeUndefined();
    expect(texts(cast).filter((t) => !t.startsWith("{"))).toEqual([]);
    expect(charactersOf(b.t.db, USER, [CHAT]).map((c) => c.id)).toEqual([marta?.id]);
  });

  test("cast_update's operations that name someone new make them, not yet cast unless the call casts them, whatever the order", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    const r = await b.play(
      "cast_update",
      {
        operations: [
          { op: "knowledge", who: "Ida Pell", text: "The causeway floods at the spring tide." },
          { op: "relationship", who: "Tobin Lorne", with: "Ida Pell", text: "Owes her for the crossing." },
          { op: "cast", who: "Tobin Lorne", as: "supporting" },
        ],
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    expect(texts(r).filter((t) => !t.startsWith("{"))).toEqual(["Ida Pell was not in the cast, so they were added to it, not yet cast."]);
    const made = new Map(charactersOf(b.t.db, USER, [CHAT]).map((c) => [c.name, c.id]));
    expect([...made.keys()].sort()).toEqual(["Ida Pell", "Tobin Lorne"]);
    const record = b.t.record(turn);
    expect(record.of(made.get("Ida Pell") ?? "", "knowledge").map((x) => x.fields.text)).toEqual(["The causeway floods at the spring tide."]);
    expect(record.of(made.get("Ida Pell") ?? "", "casting")).toEqual([]);
    expect(record.of(made.get("Tobin Lorne") ?? "", "casting").map((x) => x.fields.as)).toEqual(["supporting"]);
  });
});
