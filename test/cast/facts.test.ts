import { describe, expect, test } from "bun:test";
import type { AgentRef, JsonObject, ToolResult } from "rp-harness/contract";
import { factProblems } from "rp-harness/testing/kit";
import { CAST_FACT_DEFS, castFacts } from "../../src/cast/facts";
import { CAST_DEFAULTS } from "../../src/cast/kit";
import { turnFacts } from "../../src/turn/facts";
import { charactersOf } from "../../src/cast/record";
import { CHAT, dataOf, openBench, USER } from "./rig";

/** No scene recorded for any turn, and the cast's settings as shipped. */
const UNSCENED = { scenes: async () => ({ of: new Map(), closed: new Map() }), settings: async () => CAST_DEFAULTS };

describe("stage.unperceived and path.unperceived", () => {
  test("count exactly the characters on stage with no perception of the turn, by casting with their names, this turn and earlier ones", async () => {
    const b = await openBench();
    const stage = new Map<string, string[]>();
    const facts = castFacts({ ...UNSCENED, store: b.t.store, sources: b.t.shelf.reader, playerMind: async () => false, onStage: async (_scope, turns) => new Map(turns.flatMap((t) => (stage.has(t) ? [[t, { who: stage.get(t) ?? [], how: "scene" as const }] as const] : []))) });
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
      ...UNSCENED,
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
    // Nor is a carried turn one since the engine lane last changed: only the turn RPE played is counted.
    const turnSide = turnFacts(b.t.store, { runs: () => [], stopped: () => 0, story: async () => ({ from: "lumiverse", newest: "directive" }) });
    expect((await turnSide.read({ user: USER, chat: CHAT, session: "s-1", turn: next.id }, ["turns.since.engine.change"]))["turns.since.engine.change"]).toEqual({ count: 1 });
  });

  test("a chat with no record yet counts no one", async () => {
    const b = await openBench();
    const facts = castFacts({ ...UNSCENED, store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => false });
    const values = await facts.read({ user: USER, chat: "no-such-chat", session: "s-1" }, ["stage.unperceived", "path.unperceived"]);
    expect(values["stage.unperceived"]?.count).toBe(0);
    expect(values["path.unperceived"]?.count).toBe(0);
  });

  test("an entry bound as her voice changes: cast.base.older names her, the entry and the aspect; a growth a reflection proposed is counted until accepted", async () => {
    const b = await openBench();
    b.t.shelf.put("entry", "e-112", "Bram's way of speaking", "r1");
    const facts = castFacts({ ...UNSCENED, store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => false });
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
    const facts = castFacts({ ...UNSCENED, store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => on });
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

describe("what waits for a character's own agent", () => {
  const BRAM: AgentRef = { id: "character-1", definition: "character", plays: "Bram" };
  const ODILE: AgentRef = { id: "character-2", definition: "character", plays: "Odile" };
  const idOf = (r: ToolResult): string => String(((dataOf(r).perceptions as JsonObject[])[0] as JsonObject).id);

  test("stage.untaken, path.untaken and its turns count who holds perceptions its own agent has not taken in; what it takes in leaves the count; a closed scene's are scene.untaken's; a carried turn's count for none", async () => {
    const b = await openBench();
    const stage = new Map<string, string[]>();
    const scenes = new Map<string, { id: string; title: string | null }>();
    const closed = new Map<string, { id: string; title: string | null }>();
    const facts = castFacts({
      store: b.t.store,
      sources: b.t.shelf.reader,
      playerMind: async () => false,
      settings: async () => CAST_DEFAULTS,
      onStage: async (_scope, turns) => new Map(turns.flatMap((t) => (stage.has(t) ? [[t, { who: stage.get(t) ?? [], how: "scene" as const }] as const] : []))),
      scenes: async (_scope, turns) => ({ of: new Map(turns.map((t) => [t, scenes.get(t) ?? null])), closed }),
    });
    const read = async (turn: string) => {
      const values = await facts.read({ user: USER, chat: CHAT, session: "s-1", turn }, ["stage.untaken", "path.untaken", "path.untaken.turns", "scene.untaken"]);
      expect(factProblems(CAST_FACT_DEFS, values)).toEqual([]);
      return values;
    };

    // A turn the previous build played, carried with a perception of Bram's: it counts for none.
    const old = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "cast", who: "Odile", as: "supporting" }] }, old.id);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "An evening the old build played." }] }, old.id);
    await b.t.tie(old);
    await b.t.writes.run((db) => db.run("UPDATE turn SET imported = 1 WHERE user = ? AND id = ?", [USER, old.id]));

    const first = await b.t.begin();
    stage.set(first.id, ["Bram", "Odile"]);
    scenes.set(first.id, { id: "sc-1", title: "Supper" });
    const perceived = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "Odile drops a plate." }] }, first.id);
    const odile = idOf(await b.call("perceive", { perceptions: [{ who: "Odile", reach: "whole", content: "The plate slips from her hand." }] }, first.id));
    let values = await read(first.id);
    expect(values["stage.untaken"]).toEqual({
      count: 2,
      names: ["Bram", "Odile"],
      by: { principal: 1, supporting: 1, extra: 0, uncast: 0 },
      namesBy: { principal: ["Bram"], supporting: ["Odile"], extra: [], uncast: [] },
      fields: {
        held: [
          { name: "Bram", casting: "principal", perceptions: 1, since: null, turns: 0 },
          { name: "Odile", casting: "supporting", perceptions: 1, since: null, turns: 0 },
        ],
      },
    });
    expect(values["path.untaken"]?.count).toBe(0);
    await b.t.tie(first);

    // The next turn: Bram on stage still holds his; both hold one of an earlier turn, a turn late.
    const second = await b.t.begin();
    stage.set(second.id, ["Bram"]);
    values = await read(second.id);
    expect(values["stage.untaken"]).toMatchObject({ count: 1, names: ["Bram"], fields: { held: [{ name: "Bram", perceptions: 1, since: 3, turns: 1 }] } });
    expect(values["path.untaken"]).toMatchObject({ count: 2, names: ["Bram", "Odile"] });
    expect(values["path.untaken.turns"]).toMatchObject({ count: 1, by: { principal: 1, supporting: 1, extra: 0, uncast: 0 } });

    // Bram's own agent turns his into a memory: nothing of his waits.
    expect((await b.call("remember", { memories: [{ text: "Odile dropped a plate and would not look at me.", gist: "Odile dropped a plate.", from: [idOf(perceived)] }] }, second.id, BRAM)).error).toBeUndefined();
    values = await read(second.id);
    expect(values["stage.untaken"]?.count).toBe(0);
    expect(values["path.untaken"]).toMatchObject({ count: 1, names: ["Odile"] });
    expect(values["path.untaken.turns"]).toMatchObject({ count: 1, by: { principal: 0, supporting: 1 } });

    // The scene the first turn was played in closes: what Odile holds of it is the closed scene's, and no longer counted in turns.
    closed.set("sc-1", { id: "sc-1", title: "Supper" });
    values = await read(second.id);
    expect(values["scene.untaken"]).toMatchObject({ count: 1, names: ["Odile"], namesBy: { supporting: ["Odile"] }, fields: { held: [{ name: "Odile", casting: "supporting", perceptions: 1, since: 3, turns: 1, scenes: ["Supper"] }] } });
    expect(values["path.untaken.turns"]).toMatchObject({ count: 0, names: [], by: { supporting: 0 } });

    // Her agent says it was taken in with nothing to remember: nothing waits for anyone.
    expect((await b.call("remember", { memories: [{ taken: [odile] }] }, second.id, ODILE)).error).toBeUndefined();
    values = await read(second.id);
    expect([values["scene.untaken"]?.count, values["path.untaken"]?.count, values["stage.untaken"]?.count]).toEqual([0, 0, 0]);
  });

  test("dream.due counts who has begun a sleep, or lived the setting's story hours, since it last dreamt; a dream clears it, sleeping on does not bring it back", async () => {
    const b = await openBench();
    const facts = castFacts({ ...UNSCENED, store: b.t.store, sources: b.t.shelf.reader, onStage: async () => new Map(), playerMind: async () => false });
    const due = async (turn: string) => {
      const values = await facts.read({ user: USER, chat: CHAT, session: "s-1", turn }, ["dream.due"]);
      expect(factProblems(CAST_FACT_DEFS, values)).toEqual([]);
      return values["dream.due"];
    };
    const engine = (turn: string, value: JsonObject) => b.t.writes.run(() => b.t.s.addChanges(turn, [{ lane: "engine", op: String(value.type), value }]));

    const first = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "cast", who: "Odile", as: "supporting" }] }, first.id);
    await b.call("perceive", { perceptions: [{ who: "Bram", reach: "whole", content: "The last guest goes up." }, { who: "Odile", reach: "part", content: "Bram bars the door." }] }, first.id);
    expect(await due(first.id)).toMatchObject({ count: 0 });
    await b.t.tie(first);

    // Bram goes to bed: a sleep has begun since he first perceived anything.
    const night = await b.t.begin();
    await engine(night.id, { type: "set", entity: "bram", field: "activity", value: "sleep" });
    expect(await due(night.id)).toMatchObject({ count: 1, names: ["Bram"], namesBy: { principal: ["Bram"] }, fields: { due: [{ name: "Bram", casting: "principal", slept: true, dreamt: null }] } });
    // He dreams, with nothing to settle yet: nothing is due, and sleeping on into the next turn does not make it due again.
    expect((await b.call("dream", {}, night.id, BRAM)).error).toBeUndefined();
    expect(await due(night.id)).toMatchObject({ count: 0 });
    await b.t.tie(night);
    const morning = await b.t.begin();
    expect(await due(morning.id)).toMatchObject({ count: 0 });

    // A day and an hour pass, and he gets up: both are due by the hours, Bram since his dream, Odile since she first perceived.
    await engine(morning.id, { type: "clock", minutes: 25 * 60, cause: "tick" });
    await engine(morning.id, { type: "set", entity: "bram", field: "activity", value: "idle" });
    expect(await due(morning.id)).toMatchObject({
      count: 2,
      names: ["Bram", "Odile"],
      fields: {
        due: [
          { name: "Bram", casting: "principal", hours: 25, slept: false, dreamt: 3 },
          { name: "Odile", casting: "supporting", hours: 25, slept: false, dreamt: null },
        ],
      },
    });
  });
});
