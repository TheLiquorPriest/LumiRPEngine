import { describe, expect, test } from "bun:test";
import { factProblems } from "rp-harness/testing/kit";
import { CAST_FACT_DEFS, castFacts } from "../../src/cast/facts";
import { CHAT, openBench, USER } from "./rig";

describe("stage.unperceived and path.unperceived", () => {
  test("count exactly the characters on stage with no perception of the turn, by casting with their names, this turn and earlier ones", async () => {
    const b = await openBench();
    const stage = new Map<string, string[]>();
    const facts = castFacts({ store: b.t.store, onStage: async (_scope, turns) => new Map(turns.flatMap((t) => (stage.has(t) ? [[t, stage.get(t) ?? []] as const] : []))) });
    const read = async (turn: string) => {
      const values = await facts.read({ user: USER, chat: CHAT, session: "s-1", turn }, ["stage.unperceived", "path.unperceived"]);
      expect(factProblems(CAST_FACT_DEFS, values)).toEqual([]);
      return values;
    };

    const first = await b.t.begin();
    await b.call(
      "cast_update",
      {
        operations: [
          { op: "cast", who: "Bram", as: "principal" },
          { op: "cast", who: "Odile", as: "supporting" },
          { op: "cast", who: "Tam", as: "extra", line: "Rings the market bell." },
        ],
      },
      first.id,
    );
    // Wren, the player's character, is on stage and not cast.
    stage.set(first.id, ["Bram", "Odile", "Tam", "Wren"]);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "Wren comes in from the rain." }] }, first.id);
    const now = (await read(first.id))["stage.unperceived"];
    expect(now).toEqual({
      count: 3,
      names: ["Odile", "Tam", "Wren"],
      by: { principal: 0, supporting: 1, extra: 1, uncast: 1 },
      namesBy: { principal: [], supporting: ["Odile"], extra: ["Tam"], uncast: ["Wren"] },
    });
    // The shipped rule's header picks principal and supporting: Odile alone.
    expect((now?.by?.principal ?? 0) + (now?.by?.supporting ?? 0)).toBe(1);
    await b.t.tie(first);

    const second = await b.t.begin();
    stage.set(second.id, ["Bram", "Odile"]);
    let values = await read(second.id);
    expect(values["stage.unperceived"]?.names).toEqual(["Bram", "Odile"]);
    expect(values["path.unperceived"]).toMatchObject({ count: 3, names: ["Odile", "Tam", "Wren"], namesBy: { supporting: ["Odile"], extra: ["Tam"], uncast: ["Wren"] }, fields: { messages: [1] } });

    // Odile's perception of the earlier reply, written now, fills that gap; Bram's fills this turn's.
    await b.call(
      "perceive",
      {
        perceptions: [
          { who: "Odile", message: 1, reach: "none", content: "Nothing: she was in the cellar." },
          { who: "Bram", reach: "part", content: "Odile comes up the cellar stairs." },
        ],
      },
      second.id,
    );
    values = await read(second.id);
    expect(values["stage.unperceived"]).toMatchObject({ count: 1, names: ["Odile"] });
    expect(values["path.unperceived"]).toMatchObject({ count: 2, names: ["Tam", "Wren"], namesBy: { supporting: [] } });
  });

  test("a chat with no record yet counts no one", async () => {
    const b = await openBench();
    const facts = castFacts({ store: b.t.store, onStage: async () => new Map() });
    const values = await facts.read({ user: USER, chat: "no-such-chat", session: "s-1" }, ["stage.unperceived", "path.unperceived"]);
    expect(values["stage.unperceived"]?.count).toBe(0);
    expect(values["path.unperceived"]?.count).toBe(0);
  });
});
