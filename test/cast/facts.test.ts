import { describe, expect, test } from "bun:test";
import { factProblems } from "rp-harness/testing/kit";
import { CAST_FACT_DEFS, castFacts } from "../../src/cast/facts";
import { charactersOf } from "../../src/cast/record";
import { CHAT, openBench, USER } from "./rig";

describe("stage.unperceived and path.unperceived", () => {
  test("count exactly the characters on stage with no perception of the turn, by casting with their names, this turn and earlier ones", async () => {
    const b = await openBench();
    const stage = new Map<string, string[]>();
    const facts = castFacts({ store: b.t.store, sources: b.t.shelf.reader, playerMind: async () => false, onStage: async (_scope, turns) => new Map(turns.flatMap((t) => (stage.has(t) ? [[t, { who: stage.get(t) ?? [], how: "scene" as const }] as const] : []))) });
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
      fields: { read: "scene" },
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

  test("turns a migration carried owe no perception and their stage is not asked: the count names only the turn RPE played", async () => {
    const b = await openBench();
    const stage = new Map<string, string[]>();
    const asked: string[] = [];
    const facts = castFacts({
      store: b.t.store,
      sources: b.t.shelf.reader,
      playerMind: async () => false,
      onStage: async (_scope, turns) => {
        asked.push(...turns);
        return new Map(turns.flatMap((t) => (stage.has(t) ? [[t, { who: stage.get(t) ?? [], how: "scene" as const }] as const] : [])));
      },
    });
    // Two turns the previous build played, carried with the castings it held: Bram and Odile on stage in both, no perception of RPE's.
    const carried: string[] = [];
    for (let i = 0; i < 2; i++) {
      const turn = await b.t.begin();
      if (i === 0) await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "cast", who: "Odile", as: "supporting" }] }, turn.id);
      await b.t.tie(turn);
      await b.t.writes.run((db) => db.run("UPDATE turn SET imported = 1 WHERE user = ? AND id = ?", [USER, turn.id]));
      stage.set(turn.id, ["Bram", "Odile"]);
      carried.push(turn.id);
    }
    // The first turn RPE plays: Odile is on stage and no perception of it is written.
    const own = await b.t.begin();
    stage.set(own.id, ["Odile"]);
    await b.t.tie(own);

    const next = await b.t.begin();
    const values = await facts.read({ user: USER, chat: CHAT, session: "s-1", turn: next.id }, ["stage.unperceived", "path.unperceived"]);
    expect(factProblems(CAST_FACT_DEFS, values)).toEqual([]);
    expect(values["path.unperceived"]).toMatchObject({ count: 1, names: ["Odile"], namesBy: { principal: [], supporting: ["Odile"] }, fields: { messages: [5], read: { scene: 1, owner: 0, none: 0 } } });
    expect(asked.some((t) => carried.includes(t))).toBe(false);
    // Read at a carried turn, no one is owed a perception of it.
    expect((await facts.read({ user: USER, chat: CHAT, session: "s-1", turn: carried[1] }, ["stage.unperceived"]))["stage.unperceived"]?.count).toBe(0);
  });

  test("a chat with no record yet counts no one", async () => {
    const b = await openBench();
    const facts = castFacts({ store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => false });
    const values = await facts.read({ user: USER, chat: "no-such-chat", session: "s-1" }, ["stage.unperceived", "path.unperceived"]);
    expect(values["stage.unperceived"]?.count).toBe(0);
    expect(values["path.unperceived"]?.count).toBe(0);
  });

  test("an entry bound as her voice changes: cast.base.older names her, the entry and the aspect; a growth a reflection proposed is counted until accepted", async () => {
    const b = await openBench();
    b.t.shelf.put("entry", "e-112", "Bram's way of speaking", "r1");
    const facts = castFacts({ store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => false });
    const read = async (turn: string) => {
      const values = await facts.read({ user: USER, chat: CHAT, session: "s-1", turn }, ["cast.base.older", "cast.growth.proposed"]);
      expect(factProblems(CAST_FACT_DEFS, values)).toEqual([]);
      return values;
    };
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "bind", who: "Bram", entry: "e-112", defines: "voice" }, { op: "base", who: "Bram", seed: "An innkeeper." }] }, turn.id);
    expect((await read(turn.id))["cast.base.older"]).toMatchObject({ count: 0, names: [] });
    b.t.shelf.put("entry", "e-112", "Bram's way of speaking", "r2");
    expect((await read(turn.id))["cast.base.older"]).toMatchObject({ count: 1, names: ["Bram"], fields: { sources: [{ who: "Bram", kind: "entry", id: "e-112", defines: "voice" }] } });
    const [bram] = charactersOf(b.t.db, USER, [CHAT]);
    await b.t.write(turn, [{ character: bram?.id ?? "", part: "growth", item: null, value: { text: "Less trusting.", proposed: true } }], "character");
    expect((await read(turn.id))["cast.growth.proposed"]).toMatchObject({ count: 1, names: ["Bram"] });
  });

  test("a memory entity bound to her is read like any source, its change marks the base older, and cast.playerMind follows his setting", async () => {
    const b = await openBench();
    b.t.shelf.put("memory", "ent-7", "Bram", "100");
    let on = false;
    const facts = castFacts({ store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => on });
    const read = async (turn: string) => {
      const values = await facts.read({ user: USER, chat: CHAT, session: "s-1", turn }, ["cast.base.older", "cast.playerMind"]);
      expect(factProblems(CAST_FACT_DEFS, values)).toEqual([]);
      return values;
    };
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "bind", who: "Bram", memory: "ent-7" }, { op: "base", who: "Bram", seed: "An innkeeper." }] }, turn.id);
    expect(await read(turn.id)).toMatchObject({ "cast.base.older": { count: 0 }, "cast.playerMind": { count: 0 } });
    b.t.shelf.put("memory", "ent-7", "Bram", "101");
    on = true;
    expect(await read(turn.id)).toMatchObject({ "cast.base.older": { count: 1, names: ["Bram"], fields: { sources: [{ kind: "memory", id: "ent-7" }] } }, "cast.playerMind": { count: 1, names: ["on"] } });
  });
});
