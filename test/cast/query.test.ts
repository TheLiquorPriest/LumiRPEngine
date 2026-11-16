import { describe, expect, test } from "bun:test";
import { charactersOf } from "../../src/cast/record";
import { CHAT, dataOf, openBench, USER } from "./rig";

describe("cast_query's base", () => {
  test("has the growth the Author accepted laid over it, and leaves out what a reflection only proposed", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Mira", as: "principal" }, { op: "base", who: "Mira", seed: "A herbalist who left the guild." }] }, turn.id);
    const mira = charactersOf(b.t.db, USER, [CHAT])[0]?.id ?? "";
    await b.t.write(
      turn,
      [
        { character: mira, part: "growth", item: null, value: { text: "Distrusts the guild.", cause: "The dismissal." } },
        { character: mira, part: "growth", item: null, value: { text: "Might forgive them.", proposed: true } },
      ],
      "author",
    );
    await b.t.tie(turn);
    const data = dataOf(await b.call("cast_query", { who: "Mira", part: "base" }, null));
    expect(data.base).toEqual({ seed: { text: "A herbalist who left the guild.", version: 1 }, growth: [{ text: "Distrusts the guild.", cause: "The dismissal." }] });
  });
});
