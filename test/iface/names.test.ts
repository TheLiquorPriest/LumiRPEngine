// A text that names more than one ("Odile and Tam", "Odile, Tam") is read as no one name: the call
// is refused with the near names and nothing is recorded, never read as the first name with the rest
// dropped. A name with a note after it ("Bram (the innkeeper)") is still that name. Every name here
// is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-15" };

describe("names joined in one text", () => {
  test("two names in one text name no one: the call is refused with the near names, and nobody moves", async () => {
    const t = await rig();
    for (const operations of [
      [{ op: "move", who: "bram", to: "common_room", with: ["Odile and Tam"], source: SRC }],
      [{ op: "move", who: "bram", to: "common_room", with: ["Odile, Tam"], source: SRC }],
      [{ op: "move", who: "Odile and Tam", to: "common_room", source: SRC }],
    ]) {
      const r = await t.call("world_apply", { operations });
      expect(r.error).toBe(true);
      const said = texts(r)[0] ?? "";
      expect(said).toContain("there is nothing called");
      expect(said).toContain("Near:");
      expect(said).toContain("Odile [odile]");
      expect(said).toContain("Tam [tam]");
      wordsFromFiles(r);
    }
    expect(t.s.changes(t.turn.id)).toEqual([]);
  });

  test("a name with a note after it is still that name", async () => {
    const t = await rig();
    for (const who of ["Bram (the innkeeper)", "Bram: wiping the bar", "Bram — at the door"]) {
      const r = await t.call("world_apply", { operations: [{ op: "move", who, to: "market_square", source: SRC }] });
      expect(r.error).toBeUndefined();
      expect(((dataOf(r).operations as JsonObject[])[0] as JsonObject).applied).toBe(true);
    }
  });
});
