// `unsourced.writes` and `turn.recorded` count only what an agent's own call wrote: RPE's own record of the knowledge switch, which
// names no source and no agent, is neither a write a reminder can ask an agent to source nor a thing the turn's agents recorded; and a
// reminder due for one agent counts that agent's writes, never another's it cannot put right.

import { describe, expect, test } from "bun:test";
import type { AgentRef } from "rp-harness/contract";
import { KNOWLEDGE_BY, KNOWLEDGE_LANE } from "../../src/lore";
import { MINDS_EVENTS } from "../../src/shared/minds";
import { turnFacts } from "../../src/turn/facts";
import { CHAT, openBench, USER } from "../cast/rig";

const AUTHOR: AgentRef = { id: "author-1", definition: "author" };
const GM: AgentRef = { id: "gm-1", definition: "gm", parent: "author-1" };

describe("unsourced.writes", () => {
  test("counts the reminded agent's own writes with no source, never RPE's own record or another agent's", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    // RPE records the knowledge switch and threshold at the turn's start, by itself and with no source.
    const value = { type: MINDS_EVENTS.knowledge, data: { on: true, threshold: 0.8 } };
    await b.t.writes.run(() => b.t.store.user(USER).record(b.t.store.user(USER).writeTarget({ chat: CHAT, turn: turn.id }), [{ lane: KNOWLEDGE_LANE, op: MINDS_EVENTS.knowledge, value, by: KNOWLEDGE_BY }]));
    // The Author casts Bram, the GM casts Odile, neither naming a source.
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id, AUTHOR);
    await b.call("cast_update", { operations: [{ op: "cast", who: "Odile", as: "supporting" }] }, turn.id, GM);
    const changes = b.t.store.user(USER).changes(turn.id);
    const unsourced = (handle: string | null) => changes.filter((c) => c.handle === handle && c.source === null).length;
    // Each agent wrote at least one unsourced change, and RPE's own record is one too: the count the reminder showed before.
    expect(unsourced(AUTHOR.id)).toBeGreaterThan(0);
    expect(unsourced(GM.id)).toBeGreaterThan(0);
    expect(unsourced(null)).toBe(1);

    const facts = turnFacts(b.t.store, { runs: () => [], stopped: () => 0, story: async () => ({ from: "lumiverse", newest: "directive" }) });
    const scope = { user: USER, chat: CHAT, session: "s-1", turn: turn.id };
    const read = async (agent?: AgentRef) => await facts.read(scope, ["unsourced.writes", "turn.recorded"], agent);
    expect((await read(AUTHOR))["unsourced.writes"]).toEqual({ count: unsourced(AUTHOR.id) });
    expect((await read(GM))["unsourced.writes"]).toEqual({ count: unsourced(GM.id) });
    // Read for no agent, every agent's own; RPE's record is in neither count.
    const whole = await read();
    expect(whole["unsourced.writes"]).toEqual({ count: unsourced(AUTHOR.id) + unsourced(GM.id) });
    expect(whole["turn.recorded"]).toEqual({ count: changes.filter((c) => c.handle !== null).length });
    expect(changes.length).toBeGreaterThan(changes.filter((c) => c.handle !== null).length);
  });
});
